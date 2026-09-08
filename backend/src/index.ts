// Boot: connect the optional Redis, prove the mail relay, build the app,
// serve, attach the MFA WebSocket.
import { buildApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './logger.js'
import { pool } from './db/pool.js'
import { connectRedis, redis } from './redis/client.js'
import { attachWebSocketServer, stopMfaListener } from './mfa/index.js'
import { closeMailer, verifyMailer } from './services/mailer.js'

await connectRedis()

// Prove the mail relay at boot, so a bad app password is a startup log line
// rather than a surprise the first time somebody provisions an account. Never
// blocks the boot — an unverified relay is still tried on the first message.
void verifyMailer()

const app = buildApp()
const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      basePaths: env.basePaths,
      authMode: env.AUTH_MODE,
      redis: env.REDIS_ENABLED,
      dms: env.DMS_ENABLED,
    },
    'backend listening',
  )
})

// The MFA "approved" push at <base>/mfa/ws (src/mfa/ws.ts) — WebSocket
// upgrades never enter Express, so the socket server rides the HTTP server.
attachWebSocketServer(server)

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down')
  server.close(() => undefined)
  await stopMfaListener()
  closeMailer()
  await pool.end().catch(() => undefined)
  if (redis) await redis.quit().catch(() => undefined)
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
