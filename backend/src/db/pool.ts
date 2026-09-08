// The one pg.Pool. Every query in the app goes through this — the contract's
// api_* functions are all single statements, so the pool's implicit
// connection-per-query is the right shape; anything transactional checks out
// a client explicitly.
import pg from 'pg'
import { env } from '../config/env.js'
import { logger } from '../logger.js'

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

/**
 * Call one of the app.api_* functions and return its JSONB result, already
 * parsed by the driver. This is the whole data-access pattern: the SQL layer
 * shapes the contract's camelCase responses, the app passes them through.
 */
export async function callApi<T = unknown>(fn: string, params: unknown[]): Promise<T | null> {
  const placeholders = params.map((_, i) => `$${i + 1}`).join(', ')
  const { rows } = await pool.query<{ response: T | null }>(
    `SELECT ${fn}(${placeholders}) AS response`,
    params,
  )
  return rows[0]?.response ?? null
}

export async function healthcheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}
