// /auth — the browser's whole Keycloak conversation, moved server-side.
//
//   POST /auth/login    {username, password} -> session cookies (HttpOnly)
//                                               + the session body
//   POST /auth/refresh  rotate the tokens from the refresh cookie
//   POST /auth/logout   end the Keycloak session, clear the cookies (204)
//   GET  /auth/session  who is signed in, from the cookie — the reload path
//
// Mounted BEFORE the authenticate middleware: login and session cannot
// require the very session they establish or report on.
//
// The session body is {authenticated, claims, expiresIn}. `claims` is the
// VERIFIED payload of the access token — everything the frontend's
// identity mapping reads (preferred_username, roles, tenant_id …) — never
// the token itself. What the browser cannot hold, script cannot leak.
import { Router, type Request, type Response } from 'express'
import { badRequest, unauthorized } from '../http/problem.js'
import { verifyToken } from '../middleware/auth.js'
import { type KeycloakClaims } from '../auth/claims.js'
import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  clearSessionCookies,
  cookiesOf,
  logoutGrant,
  passwordGrant,
  refreshGrant,
  setSessionCookies,
} from '../services/kcSession.js'

export const authRouter = Router()

const sessionBody = (claims: KeycloakClaims & { exp?: number }) => ({
  authenticated: true,
  claims,
  expiresIn: claims.exp ? Math.max(0, claims.exp - Math.floor(Date.now() / 1000)) : 0,
})

authRouter.post('/auth/login', async (req: Request, res: Response) => {
  const { username, password } = (req.body ?? {}) as Record<string, unknown>
  if (typeof username !== 'string' || !username.trim()) throw badRequest('username is required.')
  if (typeof password !== 'string' || !password) throw badRequest('password is required.')

  const payload = await passwordGrant(username.trim(), password)
  // Verified rather than merely decoded, so the claims this answer vouches
  // for went through the same JWKS check every API call goes through.
  const claims = await verifyToken(payload.access_token)
  setSessionCookies(req, res, payload)
  res.json(sessionBody(claims))
})

/** Rotate the session from the refresh cookie. 401 clears everything —
 *  a refused refresh means the Keycloak session is gone for good. */
authRouter.post('/auth/refresh', async (req: Request, res: Response) => {
  const cookies = cookiesOf(req)
  const refreshToken = cookies[COOKIE_REFRESH]
  if (!refreshToken) {
    clearSessionCookies(req, res)
    throw unauthorized('No session to refresh. Please sign in.')
  }
  let payload
  try {
    payload = await refreshGrant(refreshToken)
  } catch (err) {
    clearSessionCookies(req, res)
    throw err
  }
  const claims = await verifyToken(payload.access_token)
  setSessionCookies(req, res, payload)
  res.json(sessionBody(claims))
})

authRouter.post('/auth/logout', async (req: Request, res: Response) => {
  const cookies = cookiesOf(req)
  if (cookies[COOKIE_REFRESH]) {
    await logoutGrant(cookies[COOKIE_REFRESH])
  }
  clearSessionCookies(req, res)
  res.status(204).end()
})

/**
 * The reload path: is anyone signed in?
 *
 * Answers 200 either way — an anonymous visitor asking is a normal page
 * load, not an error. A lapsed access token with a live refresh token is
 * refreshed transparently, so a reload inside the SSO idle window comes
 * back signed in without the frontend orchestrating two calls.
 */
authRouter.get('/auth/session', async (req: Request, res: Response) => {
  const cookies = cookiesOf(req)

  if (cookies[COOKIE_ACCESS]) {
    try {
      res.json(sessionBody(await verifyToken(cookies[COOKIE_ACCESS])))
      return
    } catch {
      // Expired or invalid — fall through to the refresh attempt.
    }
  }

  const refreshToken = cookies[COOKIE_REFRESH]
  if (refreshToken) {
    try {
      const payload = await refreshGrant(refreshToken)
      const claims = await verifyToken(payload.access_token)
      setSessionCookies(req, res, payload)
      res.json(sessionBody(claims))
      return
    } catch {
      // The Keycloak session is over; answer signed-out below.
    }
  }

  clearSessionCookies(req, res)
  res.json({ authenticated: false })
})
