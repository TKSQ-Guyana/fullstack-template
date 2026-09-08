// Boot: connect the optional Redis, build the app, serve.
import { buildApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './logger.js'
import { pool } from './db/pool.js'
import { connectRedis, redis } from './redis/client.js'

await connectRedis()

const app = buildApp()
const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      basePaths: env.basePaths,
      authMode: env.AUTH_MODE,
      redis: env.REDIS_ENABLED,
    },
    'backend listening',
  )
})

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down')
  server.close(() => undefined)
  await pool.end().catch(() => undefined)
  if (redis) await redis.quit().catch(() => undefined)
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
