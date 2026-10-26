// One database transaction per use-case.
//
// The work runs on ONE checked-out client with the acting identity published
// as the per-transaction setting `app.actor` — `set_config(..., true)` dies
// with the transaction, so nothing leaks across the pool's shared connections
// — and the audit-stamp trigger fills created_by / updated_by on every row the
// work touches. Commit on return, rollback on throw; errors propagate
// untouched so the error handler still maps Postgres codes and DomainErrors to
// problem+json.
//
// A READ that must agree with itself across several statements (a list's
// total and its rows) runs in withReadSnapshot instead: one client, one
// REPEATABLE READ READ ONLY snapshot, no actor.
//
// A WRITE that decides from what it read — a workflow verb that checks the
// current state before moving it on — runs in withRetryingTransaction: one
// write-capable REPEATABLE READ snapshot, run again whole on a fresh client
// when Postgres rolls it back for a serialization failure (40001) or a
// deadlock (40P01). Where the decision hangs on one aggregate, lockRow takes
// its row FOR UPDATE first, so two writers queue rather than collide.
//
// Work that must happen only once the data is saved — a mail, a file sent to
// the DMS — is registered with afterCommit inside either write mode and runs
// after COMMIT, never on a rollback, and on a retried transaction only for the
// attempt that committed.
import { AsyncLocalStorage } from 'node:async_hooks'
import type pg from 'pg'
import { logger } from '../logger.js'
import { pool } from './pool.js'
import { currentActor } from './actorContext.js'
import type { DB } from './schema.generated.js'

export type Tx = pg.PoolClient

export interface TransactionOptions {
  /** Overrides the AsyncLocalStorage actor — jobs pass 'system'. */
  actor?: string | null
}

export interface RetryingTransactionOptions extends TransactionOptions {
  /** How many times `work` may run in all, the first included (default 3). */
  attempts?: number
}

/** The write-capable snapshot withRetryingTransaction opens. */
export const RETRYING_BEGIN = 'BEGIN ISOLATION LEVEL REPEATABLE READ'
const DEFAULT_ATTEMPTS = 3
/** serialization_failure and deadlock_detected: Postgres rolled the transaction
 *  back, and the same work succeeds when it runs again. */
const RETRYABLE_CODES = new Set(['40001', '40P01'])
const BACKOFF_STEP_MS = 25
const BACKOFF_JITTER_MS = 15

/** The after-commit actions of the write transaction the caller is inside — one
 *  list per transaction scope (per attempt, for a retried one). */
const afterCommitScope = new AsyncLocalStorage<Array<() => unknown>>()

/**
 * `work` on one checked-out client between `begin` and COMMIT (ROLLBACK on a
 * throw), with `app.actor` published first when there is an actor. The client
 * goes back to the pool either way.
 */
async function onOneClient<T>(
  begin: string,
  actor: string | null,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query(begin)
    if (actor) await client.query(`SELECT set_config('app.actor', $1, true)`, [actor])
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * Run `work` inside BEGIN … COMMIT on one client, as the current actor.
 * Nested calls are NOT savepoints: a use-case owns exactly one transaction,
 * and repositories receive the client rather than opening their own.
 */
export function withTransaction<T>(
  work: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const actor = options.actor === undefined ? currentActor() : options.actor
  return runningAfterCommit(() => onOneClient('BEGIN', actor, work))
}

/**
 * Run `work` inside `BEGIN ISOLATION LEVEL REPEATABLE READ` … COMMIT on one
 * client, as the current actor — withTransaction's contract on a write-capable
 * snapshot. When Postgres answers a serialization failure (40001) or a
 * deadlock (40P01), the attempt is rolled back and its client released, and
 * after a short backoff (25 ms × the attempt number, plus up to 15 ms of
 * jitter) `work` runs again on a fresh client and a fresh snapshot, up to
 * `options.attempts` (default 3) runs in all. Any other error, or the last
 * attempt's, propagates untouched (the error handler answers 40001/40P01 with
 * its 409).
 *
 * `work` runs again WHOLE, so it must be re-runnable: it decides from what it
 * reads inside the transaction, and anything it does outside the database (a
 * mail, a DMS upload) is registered with afterCommit, which keeps only the
 * committing attempt's actions.
 */
export async function withRetryingTransaction<T>(
  work: (tx: Tx) => Promise<T>,
  options: RetryingTransactionOptions = {},
): Promise<T> {
  const actor = options.actor === undefined ? currentActor() : options.actor
  const attempts = Math.max(1, Math.floor(options.attempts ?? DEFAULT_ATTEMPTS))
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await runningAfterCommit(() => onOneClient(RETRYING_BEGIN, actor, work))
    } catch (err) {
      if (attempt >= attempts || !isRetryable(err)) throw err
      await sleep(BACKOFF_STEP_MS * attempt + Math.random() * BACKOFF_JITTER_MS)
    }
  }
}

/**
 * Register `fn` to run once the enclosing write transaction (withTransaction or
 * withRetryingTransaction) has COMMITted: never on a rollback, and on a retried
 * transaction only for the attempt that commits. Actions run in the order they
 * were registered, each awaited, before the use-case's promise resolves. One
 * that throws is logged and the rest still run — the commit has already
 * happened, so it never fails the use-case.
 *
 * Outside a write transaction (inside withReadSnapshot alone, too) it THROWS:
 * there is no commit to wait for, and running the action at once would hide a
 * caller that meant it to follow one.
 */
export function afterCommit(fn: () => unknown): void {
  const pending = afterCommitScope.getStore()
  if (!pending) {
    throw new Error('afterCommit was called outside withTransaction / withRetryingTransaction')
  }
  pending.push(fn)
}

/** Run `attempt` with a fresh after-commit list; once it resolves (COMMIT done),
 *  run the list in order. A rejection discards the list. */
async function runningAfterCommit<T>(attempt: () => Promise<T>): Promise<T> {
  const pending: Array<() => unknown> = []
  const out = await afterCommitScope.run(pending, attempt)
  for (const fn of pending) {
    try {
      await fn()
    } catch (err) {
      logger.error({ err }, 'after-commit action failed — the transaction had committed')
    }
  }
  return out
}

function isRetryable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && RETRYABLE_CODES.has(code)
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Run a multi-statement READ on one client inside
 * `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` … COMMIT. Every statement
 * `work` issues sees the snapshot its first statement took, so the parts of
 * one answer agree even when a write commits between two of them, and the
 * read holds ONE pool slot however many statements it runs. Queries on the
 * client run one after another, so `work` awaits them in turn rather than in
 * parallel. Nothing is written, so there is no actor; Postgres refuses a write
 * attempted inside (25006).
 */
export function withReadSnapshot<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return onOneClient('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', null, work)
}

/** A bare SQL identifier — the only shape lockRow will put into its statement. */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i

/**
 * Lock one aggregate root for the rest of the transaction; whether the row
 * exists. A write use-case that decides from the aggregate's current state
 * starts here, so two concurrent writers on the same row serialise instead of
 * both reading the same state.
 *
 * The table and the key column are written INTO the statement (Postgres takes
 * no parameter for an identifier), so neither may come from a request: the
 * table must be one the generated schema knows, and the column a bare
 * identifier. Only the key is a parameter.
 */
export async function lockRow(
  tx: Tx,
  table: keyof DB,
  keyColumn: string,
  key: string,
): Promise<boolean> {
  if (!IDENTIFIER.test(keyColumn)) {
    throw new Error(`lockRow: "${keyColumn}" is not a column name`)
  }
  const { rowCount } = await tx.query(`SELECT 1 FROM ${table} WHERE ${keyColumn} = $1 FOR UPDATE`, [
    key,
  ])
  return (rowCount ?? 0) > 0
}
