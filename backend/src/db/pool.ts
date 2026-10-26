// The one pg.Pool. Every query in the app goes through this — Kysely
// (db/kysely.ts) for the repositories, plain pool.query in the self-contained
// stores (mfa/, middleware/idempotency.ts); use-cases check out one client via
// withTransaction, and multi-statement reads via withReadSnapshot
// (db/transaction.ts).
import pg from 'pg'
import { env } from '../config/env.js'
import { logger } from '../logger.js'

// VALUE FORMS ARE CONTRACT. The JSON the API answers carries dates as
// 'YYYY-MM-DD' and timestamps as '2026-09-23T07:08:50.936571+00:00' — the
// form Postgres's own jsonb prints. The driver's defaults would hand the
// repositories JavaScript Dates (local-time DATEs, millisecond timestamps)
// and the presenters would emit something else. So the driver keeps DATE as
// text and renders timestamps in jsonb's form here, once, for every query —
// repositories and presenters pass the strings through. jsonb columns keep
// the driver's default parse; NUMERIC stays text and the presenters turn it
// into a number (presenters/json.ts).
const DATE_OID = 1082
const TIMESTAMP_OID = 1114
const TIMESTAMPTZ_OID = 1184
pg.types.setTypeParser(DATE_OID, (text) => text)
pg.types.setTypeParser(TIMESTAMP_OID, (text) => text.replace(' ', 'T'))
pg.types.setTypeParser(TIMESTAMPTZ_OID, (text) =>
  text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'),
)

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.PG_POOL_MAX,
  idleTimeoutMillis: env.PG_IDLE_TIMEOUT_MS,
  // Fail fast instead of queueing forever when the DB is down.
  connectionTimeoutMillis: 5000,
})

pool.on('error', (err) => {
  // An idle client dying (DB restart, network blip) must not crash the process.
  logger.error({ err }, 'idle postgres client error')
})

/** Does the database answer `SELECT 1`? (/health's one hard dependency.) */
export async function healthcheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}
