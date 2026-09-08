// Redis, behind the REDIS_ENABLED toggle.
//
// Nothing in the app *requires* it: with the toggle off, the rate limiter
// uses its in-memory store and idempotency falls back to the database table.
// With it on, both become Redis-backed and safe across multiple instances.
import { Redis } from 'ioredis'
import { env } from '../config/env.js'
import { logger } from '../logger.js'

export const redis: Redis | null = env.REDIS_ENABLED
  ? new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      // Keep retrying the connection in the background; the app stays up
      // (memory fallbacks) while Redis is away.
      retryStrategy: (times) => Math.min(times * 500, 10000),
    })
  : null

export async function connectRedis(): Promise<void> {
  if (!redis) return
  try {
    await redis.connect()
    logger.info({ url: env.REDIS_URL }, 'redis connected')
  } catch (err) {
    logger.warn({ err }, 'redis unreachable — continuing with in-memory fallbacks')
  }
  redis.on('error', (err) => logger.warn({ err: err.message }, 'redis error'))
}

export async function redisHealthy(): Promise<boolean | null> {
  if (!redis) return null
  try {
    return (await redis.ping()) === 'PONG'
  } catch {
    return false
  }
}
