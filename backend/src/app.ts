// The Express app. Assembled here (no listening) so tests and the server share
// one construction path.
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { env } from './config/env.js'
import { logger } from './logger.js'
import { buildRateLimiter } from './middleware/rateLimit.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { authenticate } from './middleware/auth.js'
import { healthRouter } from './routes/health.js'
import { authRouter } from './routes/auth.js'
import { kcadminRouter } from './routes/kcadmin.js'
import { meRouter } from './routes/me.js'

export function buildApp(): express.Express {
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', 1) // behind nginx / an edge proxy

  app.use(helmet())
  app.use(
    cors({
      origin: env.corsOrigins === '*' ? true : env.corsOrigins,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    }),
  )
  app.use(express.json({ limit: env.JSON_BODY_LIMIT }))
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  )

  app.use(healthRouter)
  app.use(buildRateLimiter())

  // The API surface, mounted at every configured base path
  // (/app/v1 for the frontend proxy, /api/v1 for direct callers).
  const api = express.Router()
  // /auth sits BEFORE authenticate: login and session-lookup cannot demand
  // the session they exist to establish. Everything else requires it.
  api.use(authRouter)
  api.use(authenticate)
  api.use(kcadminRouter)
  api.use(meRouter)

  for (const basePath of env.basePaths) app.use(basePath, api)

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
