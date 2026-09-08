// /health — liveness + dependency readiness. Mounted at the root (outside the
// versioned base paths) so infrastructure needs no API knowledge to probe it.
import { Router } from 'express'
import { healthcheck } from '../db/pool.js'
import { redisHealthy } from '../redis/client.js'
import { env } from '../config/env.js'

export const healthRouter = Router()

healthRouter.get('/health', async (_req, res) => {
  const [db, redis] = await Promise.all([healthcheck(), redisHealthy()])
  const ok = db // db is the only hard dependency
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    db,
    redis: redis === null ? 'disabled' : redis,
    authMode: env.AUTH_MODE,
    uptimeSeconds: Math.round(process.uptime()),
  })
})
