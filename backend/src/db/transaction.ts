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
// Work that must happen only once the data is saved — a mail, a file sent to
// the DMS — is registered with afterCommit inside withTransaction and runs
// after COMMIT, never on a rollback.
import { AsyncLocalStorage } from 'node:async_hooks'
import type pg from 'pg'
import { logger } from '../logger.js'
import { pool } from './pool.js'
import { currentActor } from './actorContext.js'

export type Tx = pg.PoolClient

export interface TransactionOptions {
  /** Overrides the AsyncLocalStorage actor — jobs pass 'system'. */
  actor?: string | null
}

/** The after-commit actions of the write transaction the caller is inside. */
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
export async function withTransaction<T>(
  work: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const actor = options.actor === undefined ? currentActor() : options.actor
  const pending: Array<() => unknown> = []
  const out = await afterCommitScope.run(pending, () => onOneClient('BEGIN', actor, work))
  for (const fn of pending) {
    try {
      await fn()
    } catch (err) {
      logger.error({ err }, 'after-commit action failed — the transaction had committed')
    }
  }
  return out
}

/**
 * Register `fn` to run once the enclosing withTransaction has COMMITted —
 * never on a rollback. Actions run in the order they were registered, each
 * awaited, before the use-case's promise resolves. One that throws is logged
 * and the rest still run: the commit has already happened, so it never fails
 * the use-case.
 *
 * Outside a write transaction it THROWS: there is no commit to wait for, and
 * running the action at once would hide a caller that meant it to follow one.
 */
export function afterCommit(fn: () => unknown): void {
  const pending = afterCommitScope.getStore()
  if (!pending) throw new Error('afterCommit was called outside withTransaction')
  pending.push(fn)
}

/**
 * Run a multi-statement READ on one client inside
 * `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` … COMMIT. Every statement
 * `work` issues sees the snapshot its first statement took, so the parts of
 * one answer agree even when a write commits between two of them, and the
 * read holds ONE pool slot however many statements it runs. Queries on the
 * client run one after another, so `work` awaits them in turn rather than in
 * parallel. Postgres refuses a write attempted inside (25006).
 */
export function withReadSnapshot<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return onOneClient('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', null, work)
}
