// Kysely over the ONE pg.Pool — the typed query builder the repositories use.
//
// Kysely OWNS NO SCHEMA. Migrations stay plain SQL under backend/migrations/
// run by scripts/migrate.mjs, and the types here are GENERATED from a live
// database by `npm run db:types` (kysely-codegen against DATABASE_URL — the
// dev stack's Postgres on 5433) into ./schema.generated.ts, which is
// committed. A schema change therefore has one path: a numbered migration,
// then `db:types`, both in the same commit — and a column the code names but
// the schema lacks does not type-check.
//
// Repositories take a `Kysely<DB>` argument defaulting to `db`; inside a
// use-case transaction the service passes `onTx(tx)` instead, so the whole
// use-case shares one connection and the `app.actor` setting the audit-stamp
// trigger reads (db/transaction.ts).
//
// LOG_LEVEL=debug prints every query Kysely runs — its SQL with `$n`
// placeholders, the parameters, the time it took — through the app's pino
// logger, beside the request lines. Paste the SQL into psql and bind the
// parameters (`… \bind 'a' 'b' \g`). Below debug nothing is wired in at all.
// Statements sent with plain `query()` (BEGIN / set_config / COMMIT in
// db/transaction.ts, lockRow, the MFA store, idempotency) do not pass through
// Kysely and are not printed.
import { Kysely, PostgresDialect, type LogEvent } from 'kysely'
import type pg from 'pg'
import { env } from '../config/env.js'
import { logger } from '../logger.js'
import { pool } from './pool.js'
import type { DB } from './schema.generated.js'

export type { DB }

/**
 * One query as a debug log line. The PARAMETERS ARE A PERSON'S DATA as often
 * as not — an email, a name, a token's hash — so a production process keeps
 * the SQL and only counts them: debug switched on to chase a problem there
 * must not turn the log into a copy of the tables. A failed query names its
 * SQLSTATE and never its message, which can quote the row ("Key (email)=(…)").
 */
export function queryLogEntry(event: LogEvent, withParameters: boolean): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    sql: event.query.sql,
    ...(withParameters
      ? { parameters: event.query.parameters }
      : { parameterCount: event.query.parameters.length }),
    durationMs: Math.round(event.queryDurationMillis * 10) / 10,
  }
  if (event.level === 'error') {
    const code = (event.error as { code?: unknown } | null)?.code
    entry.code = typeof code === 'string' ? code : null
  }
  return entry
}

/** Kysely's log hook — present only when the logger would print debug. */
const queryLog = logger.isLevelEnabled('debug')
  ? {
      log: (event: LogEvent) =>
        logger.debug(
          queryLogEntry(event, !env.isProduction),
          event.level === 'error' ? 'sql failed' : 'sql',
        ),
    }
  : {}

/** The pool-backed instance for reads and single-statement writes. */
export const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
  ...queryLog,
})

/**
 * A Kysely instance bound to ONE already checked-out client — the shape a
 * repository receives inside `withTransaction` or `withReadSnapshot`. The
 * client's lifetime stays with the transaction helper; this wrapper never
 * connects or releases.
 */
export function onTx(client: pg.PoolClient): Kysely<DB> {
  // Kysely "connects" and "releases" per query; both must be no-ops here, or
  // the first query would hand the transaction's client back to the pool.
  const leased = {
    query: (...args: Parameters<pg.PoolClient['query']>) =>
      (client.query as (...a: unknown[]) => unknown)(...args),
    release: () => undefined,
  }
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: {
        connect: () => Promise.resolve(leased),
        end: () => Promise.resolve(),
      } as unknown as pg.Pool,
    }),
    ...queryLog,
  })
}
