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
import { Kysely, PostgresDialect } from 'kysely'
import type pg from 'pg'
import { pool } from './pool.js'
import type { DB } from './schema.generated.js'

export type { DB }

/** The pool-backed instance for reads and single-statement writes. */
export const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
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
  })
}
