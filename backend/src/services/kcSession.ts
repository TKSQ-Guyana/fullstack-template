// The Keycloak session, held server-side on the browser's behalf.
//
// The SPA posts credentials to /auth/login on THIS service, which runs the
// Resource Owner Password grant and answers with HttpOnly cookies. No token
// ever reaches JavaScript: the browser authenticates every API call by
// cookie, refreshes through /auth/refresh, and learns WHO is signed in from
// /auth/session's claims — which are the verified JWT payload, never the JWT
// itself. What the browser cannot hold, script cannot leak.
//
// STATELESS ON PURPOSE. The cookies carry the Keycloak tokens themselves, so
// this service stores no session table and every instance can answer any
// request. Keycloak remains the single authority: a revoked session dies at
// the next refresh.
//
// CSRF POSTURE, recorded: the cookies are SameSite=Strict, the state-changing
// /auth routes accept only JSON bodies, and CORS is restricted — a cross-site
// form post can neither carry the cookie nor produce the content type. That
// combination is the deliberate defence; no separate CSRF token is issued.
//
// ONE CLIENT. A multi-portal app (two SPAs against two Keycloak clients)
// extends this by carrying a third cookie naming which client the refresh
// token is bound to — a refresh presented to the wrong client is refused.
import type { Request, Response } from 'express'
import { env } from '../config/env.js'
import { logger } from '../logger.js'
import { ProblemError, unauthorized } from '../http/problem.js'

export const COOKIE_ACCESS = 'app_access'
export const COOKIE_REFRESH = 'app_refresh'

/** Minimal cookie parsing — one header, no dependency. */
export function cookiesOf(req: Request): Record<string, string> {
  const header = req.headers.cookie
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=')
    if (eq < 0) continue
    const key = pair.slice(0, eq).trim()
    if (key) out[key] = decodeURIComponent(pair.slice(eq + 1).trim())
  }
  return out
}

interface TokenPayload {
  access_token: string
  refresh_token?: string
  expires_in?: number
  refresh_expires_in?: number
}

/**
 * Keycloak's OAuth errors, translated once, server-side — these sentences are
 * shown verbatim by the sign-in form.
 *
 * `invalid_grant` deliberately stays ambiguous between a wrong password and
 * a disabled account: Keycloak does not distinguish them, and doing better
 * here would be an account-enumeration oracle.
 */
function describeKeycloakError(status: number, body: { error?: string } | null, clientId: string) {
  const code = body?.error ?? ''
  if (code === 'invalid_grant') {
    return unauthorized('Incorrect username or password.')
  }
  if (code === 'unauthorized_client' || code === 'invalid_client') {
    return new ProblemError(
      502,
      `The sign-in service is not configured for password sign-in. Enable Direct Access Grants on the "${clientId}" client.`,
    )
  }
  if (status === 0) {
    return new ProblemError(502, 'Could not reach the sign-in service (Keycloak).')
  }
  return new ProblemError(status >= 500 ? 502 : 401, 'Sign-in failed. Please try again.')
}

async function postForm(path: string, params: Record<string, string>) {
  let res: globalThis.Response
  try {
    res = await fetch(`${env.kcOidcBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    })
  } catch (err) {
    // Server-side the cause is knowable, so name it in the log even though
    // the user-facing sentence stays generic.
    logger.warn(
      {
        err: (err as Error).message,
        cause: ((err as Error).cause as Error | undefined)?.message,
        url: `${env.kcOidcBase}${path}`,
      },
      'keycloak endpoint unreachable',
    )
    throw describeKeycloakError(0, null, env.KC_CLIENT_ID)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw describeKeycloakError(res.status, body, env.KC_CLIENT_ID)
  }
  return res.status === 204 ? null : ((await res.json()) as TokenPayload)
}

/** Exchange credentials for tokens. `scope: openid` is what makes custom
 *  client scopes emit their claims into the token. */
export function passwordGrant(username: string, password: string) {
  return postForm('/token', {
    grant_type: 'password',
    client_id: env.KC_CLIENT_ID,
    username,
    password,
    scope: 'openid profile email',
  }) as Promise<TokenPayload>
}

export function refreshGrant(refreshToken: string) {
  return postForm('/token', {
    grant_type: 'refresh_token',
    client_id: env.KC_CLIENT_ID,
    refresh_token: refreshToken,
  }) as Promise<TokenPayload>
}

/** Tell Keycloak the session is over. Best-effort: the cookies are cleared
 *  regardless, and an unreachable realm must not strand a sign-out. */
export async function logoutGrant(refreshToken: string): Promise<void> {
  try {
    await postForm('/logout', { client_id: env.KC_CLIENT_ID, refresh_token: refreshToken })
  } catch {
    // Deliberately swallowed — see above.
  }
}

const cookieBase = (req: Request) => ({
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: env.AUTH_COOKIE_SECURE || req.secure,
  path: '/',
})

/** Write the session cookies from a token response. */
export function setSessionCookies(req: Request, res: Response, payload: TokenPayload): void {
  const base = cookieBase(req)
  res.cookie(COOKIE_ACCESS, payload.access_token, {
    ...base,
    maxAge: (payload.expires_in ?? 60) * 1000,
  })
  if (payload.refresh_token) {
    const refreshMs = (payload.refresh_expires_in ?? 900) * 1000
    res.cookie(COOKIE_REFRESH, payload.refresh_token, { ...base, maxAge: refreshMs })
  }
}

export function clearSessionCookies(req: Request, res: Response): void {
  const base = cookieBase(req)
  res.clearCookie(COOKIE_ACCESS, base)
  res.clearCookie(COOKIE_REFRESH, base)
}
