// /kcadmin — the account-administration pass-through to Keycloak's Admin API.
//
// The browser holds no token (HttpOnly cookies), so the frontend's Users
// screens call this instead of Keycloak directly: authenticate (cookie or
// Bearer) has already verified the caller, and the SAME token is forwarded on.
//
// AUTHORIZATION IS STILL KEYCLOAK'S. This proxy adds no privilege: Keycloak
// authorises every call against the realm-management roles carried by the
// forwarded token. A caller without manage-users gets Keycloak's own 403,
// passed through untouched.
import { Router, type Request, type Response } from 'express'
import { env } from '../config/env.js'
import { ProblemError, unauthorized } from '../http/problem.js'

export const kcadminRouter = Router()

kcadminRouter.all('/kcadmin{/*splat}', async (req: Request, res: Response) => {
  if (!req.accessToken) {
    // Query-param identity (AUTH_MODE optional/disabled) carries no token to
    // forward, and inventing one is not this proxy's job.
    throw unauthorized('Account administration needs a signed-in session.')
  }

  const rest = req.path.replace(/^\/kcadmin/, '') || '/'
  const query = req.originalUrl.includes('?')
    ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
    : ''

  let upstream: globalThis.Response
  try {
    upstream = await fetch(`${env.kcAdminBase}${rest}${query}`, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${req.accessToken}`,
        ...(req.body && Object.keys(req.body as object).length
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      body:
        req.method === 'GET' || req.method === 'HEAD' || req.body == null
          ? undefined
          : JSON.stringify(req.body),
    })
  } catch {
    throw new ProblemError(502, 'Could not reach Keycloak’s admin API.')
  }

  // Pass the status and body through untouched — the frontend's transport
  // speaks Keycloak's own error shapes ({errorMessage: ...}).
  res.status(upstream.status)
  const location = upstream.headers.get('location')
  if (location) res.setHeader('Location', location)
  const text = await upstream.text()
  if (!text) {
    res.end()
    return
  }
  res.type(upstream.headers.get('content-type') ?? 'application/json')
  res.send(text)
})
