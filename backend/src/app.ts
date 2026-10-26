// The Express app. Assembled here (no listening) so tests and the server share
// one construction path.
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { env } from './config/env.js'
import { httpSerializers, logger } from './logger.js'
import { buildRateLimiter } from './middleware/rateLimit.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { authenticate } from './middleware/auth.js'
import { actorContext } from './db/actorContext.js'
import { healthRouter } from './controllers/health.controller.js'
import { authRouter } from './controllers/auth.controller.js'
import { meRouter } from './controllers/me.controller.js'
import { accountsRouter } from './controllers/accounts.controller.js'
import { passwordSetupRouter } from './controllers/passwordSetup.controller.js'
import { documentsRouter } from './controllers/documents.controller.js'
import { notesRouter } from './controllers/notes.controller.js'
import { buildDocsRouter } from './controllers/docs.controller.js'
import { buildMfaRouter } from './mfa/index.js'

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
      // AN ALLOWLIST, NOT THE DEFAULT SERIALIZER. pino-http's default emits
      // req.headers whole — and the session rides HttpOnly cookies, so every
      // line would carry a live access token and its refresh token in plain
      // text. See src/logger.ts for what survives and why.
      serializers: httpSerializers,
      autoLogging: { ignore: (req) => req.url === '/health' },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  )

  app.use(healthRouter)
  app.use(buildRateLimiter())

  // The API surface, mounted ONCE at `${BASE_PATH}/${API_VERSION}` — /api/v1
  // (config/env.ts apiRoot) — for the frontend's proxy and Postman alike.
  const api = express.Router()
  // /auth sits BEFORE authenticate: login and session-lookup cannot demand
  // the session they exist to establish. Everything else requires it.
  api.use(authRouter)
  // The WebAuthn second factor, likewise pre-authenticate: the ceremony runs
  // BEFORE the sign-in is finished, and the one-time token is the credential.
  // Under the base path on purpose — it rides the same ingress/edge door as
  // the API, needing no nginx rewrite and no edge rule (src/mfa/index.ts).
  api.use('/mfa', buildMfaRouter())
  // The set-password link, likewise pre-authenticate: the person holding it
  // has no session BECAUSE the account has no password yet, and the
  // single-use token is the credential (src/controllers/passwordSetup.controller.ts).
  api.use(passwordSetupRouter)
  // API documentation, dev stacks only (API_DOCS_ENABLED, default off). Not
  // mounted at all when off, so a deployed instance answers the ordinary
  // problem+json 404. Pre-authenticate: the map of the API must not demand a
  // session to read.
  if (env.API_DOCS_ENABLED) api.use('/docs', buildDocsRouter())
  api.use(authenticate)
  // Everything behind authenticate acts as the signed-in username — the
  // identity the audit columns record (db/actorContext.ts).
  api.use(actorContext)
  api.use(accountsRouter)
  api.use(meRouter)
  api.use(notesRouter)
  api.use(documentsRouter)

  app.use(env.apiRoot, api)

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
