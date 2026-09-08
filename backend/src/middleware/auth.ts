// Authentication — Keycloak RS256 JWT verified against the realm's JWKS.
//
// AUTH_MODE:
//   enforce  — a valid Bearer token/cookie or 401. Production posture.
//   optional — verify when a token is present; otherwise synthesize identity
//              from ?role=&tenantId=&actor=, so tooling can exercise the API
//              without a realm.
//   disabled — never verify; query-param identity only. Local tooling.
import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { JwksClient } from 'jwks-rsa'
import { env } from '../config/env.js'
import { logger } from '../logger.js'
import { unauthorized } from '../http/problem.js'
import {
  principalFromClaims,
  principalFromParams,
  type KeycloakClaims,
  type Principal,
} from '../auth/claims.js'
import { COOKIE_ACCESS, cookiesOf } from '../services/kcSession.js'

declare module 'express-serve-static-core' {
  interface Request {
    principal?: Principal
    /** The raw verified access token — the /kcadmin proxy forwards it. */
    accessToken?: string
  }
}

const jwks = new JwksClient({
  jwksUri: env.kcJwksUri,
  cache: true,
  cacheMaxAge: 10 * 60 * 1000,
  rateLimit: true,
})

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void {
  jwks
    .getSigningKey(header.kid)
    .then((key) => callback(null, key.getPublicKey()))
    .catch((err: Error) => callback(err))
}

export function verifyToken(token: string): Promise<KeycloakClaims> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        algorithms: ['RS256'],
        issuer: env.kcIssuer,
        ...(env.KC_AUDIENCE ? { audience: env.KC_AUDIENCE } : {}),
      },
      (err, decoded) => {
        if (err || !decoded || typeof decoded === 'string') {
          reject(err ?? new Error('empty token payload'))
        } else {
          resolve(decoded)
        }
      },
    )
  })
}

function queryIdentity(req: Request): Principal {
  const q = req.query
  const s = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)
  return principalFromParams({
    role: s(q.role),
    tenantId: s(q.tenantId),
    actor: s(q.actor),
  })
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? ''
  // A Bearer header wins (Postman, service callers); the browser sends the
  // HttpOnly session cookie instead — /auth/login set it, no script can read
  // it, and same-origin requests carry it without the frontend doing anything.
  const token =
    (header.startsWith('Bearer ') ? header.slice(7).trim() : null) ||
    cookiesOf(req)[COOKIE_ACCESS] ||
    null

  if (env.AUTH_MODE === 'disabled') {
    req.principal = queryIdentity(req)
    return next()
  }

  if (token) {
    try {
      req.principal = principalFromClaims(await verifyToken(token))
      req.accessToken = token
      return next()
    } catch (err) {
      // In optional mode an *invalid* token is still a refusal — a garbled
      // credential must not silently downgrade to query-param identity.
      logger.debug({ err: (err as Error).message }, 'jwt verification failed')
      return next(unauthorized('The bearer token is invalid or expired.'))
    }
  }

  if (env.AUTH_MODE === 'optional') {
    req.principal = queryIdentity(req)
    return next()
  }

  return next(unauthorized('This endpoint needs a Bearer token (Keycloak).'))
}

/** The principal, guaranteed. Routes run behind authenticate, so absence is a bug. */
export function principalOf(req: Request): Principal {
  if (!req.principal) throw unauthorized('Not authenticated.')
  return req.principal
}
