// Rate limiting — express-rate-limit, Redis-backed when REDIS_ENABLED so the
// window survives restarts and is shared across instances; in-memory otherwise.
import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit'
import { RedisStore, type RedisReply } from 'rate-limit-redis'
import { env } from '../config/env.js'
import { redis } from '../redis/client.js'

export function buildRateLimiter(): RateLimitRequestHandler {
  const client = redis
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Health is exempt: it is infrastructure. The docs pages join it only
    // where they exist at all — a Swagger UI load fans out over half a dozen
    // assets and must not eat the same per-IP window a developer is
    // exercising the API with.
    skip: (req) =>
      req.path === '/health' || (env.API_DOCS_ENABLED && /\/docs(\/|$)/.test(req.path)),
    ...(client
      ? {
          store: new RedisStore({
            sendCommand: (...args: string[]) =>
              client.call(...(args as [string, ...string[]])) as Promise<RedisReply>,
            prefix: 'app:rl:',
          }),
        }
      : {}),
    handler: (_req, res) => {
      res.status(429).type('application/problem+json').json({
        type: 'about:blank',
        title: 'Too Many Requests',
        status: 429,
        detail: 'Rate limit exceeded — slow down and retry shortly.',
      })
    },
  })
}
