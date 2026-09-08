// The session, as the browser sees it — WHICH IS NOT A TOKEN.
//
// The whole Keycloak conversation lives in the backend (/auth/* — see
// backend/src/routes/auth.ts): the sign-in form posts credentials to
// /auth/login, the backend runs the password grant, and the session comes
// back as HTTPONLY COOKIES this script cannot read. What this module holds is
// only what the backend's answers vouch for — the VERIFIED CLAIMS of the
// access token and when it expires — so an XSS on this origin cannot read a
// token or a refresh token, because neither exists anywhere a script can
// look. (It could still CALL the API as the user; that residual is inherent
// to any browser session and is why the cookies are SameSite=Strict and
// short-lived.)
//
// THE SURFACE IS keycloak-js-SHAPED on purpose: login(), logout(),
// updateToken(minValidity), isTokenExpired(), onTokenExpired,
// restoreSession() — everything upstream (the API client, the guards,
// SessionProvider) is written against this shape and none of it knows where
// the tokens live.
import { RUNTIME_CONFIG } from '@/config/runtime'
import type { SessionClaims } from './claims'

const AUTH = `${RUNTIME_CONFIG.apiBase}/auth`

interface SessionBody {
  authenticated: boolean
  claims?: SessionClaims
  expiresIn?: number
}

// --- state ----------------------------------------------------------------

const state: { claims: SessionClaims | null; expiresAt: number } = {
  claims: null,
  expiresAt: 0,
}

/** Called when the access token lapses. Assigned by SessionProvider. */
let onTokenExpired: (() => void) | null = null
export const setOnTokenExpired = (fn: (() => void) | null) => {
  onTokenExpired = fn
}

const listeners = new Set<() => void>()

/** Subscribe to session changes. Returns an unsubscribe — useSyncExternalStore fits. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export interface SessionSnapshot {
  authenticated: boolean
  claims: SessionClaims | null
  expiresAt: number
}

// A STABLE snapshot object: useSyncExternalStore compares by identity and
// would loop forever if a fresh object were built on every read. Replaced
// only when state moves (emit()).
let snapshot: SessionSnapshot = buildSnapshot()

function buildSnapshot(): SessionSnapshot {
  return Object.freeze({
    authenticated: !!state.claims,
    claims: state.claims,
    expiresAt: state.expiresAt,
  })
}

export const getSnapshot = (): SessionSnapshot => snapshot

function emit(): void {
  snapshot = buildSnapshot()
  listeners.forEach((l) => l())
}

// --- session plumbing -------------------------------------------------------

let expiryTimer: ReturnType<typeof setTimeout> | undefined

function scheduleExpiry(): void {
  clearTimeout(expiryTimer)
  if (!state.expiresAt) return
  // Fire slightly early so a caller acting on the notification still holds a
  // valid session while the refresh is in flight.
  const delay = Math.max(0, state.expiresAt - Date.now() - 5000)
  expiryTimer = setTimeout(() => onTokenExpired?.(), delay)
}

/** Adopt a session body from /auth/login, /auth/refresh or /auth/session. */
function adopt(body: SessionBody): void {
  state.claims = body.claims ?? null
  state.expiresAt = Date.now() + (body.expiresIn ?? 0) * 1000
  scheduleExpiry()
  emit()
}

function clear(): void {
  clearTimeout(expiryTimer)
  state.claims = null
  state.expiresAt = 0
  emit()
}

/** An auth failure with a message worth showing a user. */
export class AuthError extends Error {
  code: string | null
  status: number
  constructor(
    message: string,
    { code = null, status = 0 }: { code?: string | null; status?: number } = {},
  ) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.status = status
  }
}

/**
 * Call one /auth endpoint. Same-origin, so the session cookies ride along and
 * come back without this code touching them. Errors arrive as RFC-7807
 * problem+json whose `detail` is already a sentence for the user — the
 * backend translated Keycloak's OAuth codes (kcSession.ts).
 */
async function call(path: string, options: RequestInit = {}): Promise<SessionBody | null> {
  let res: Response
  try {
    res = await fetch(`${AUTH}${path}`, {
      cache: 'no-store',
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      ...options,
    })
  } catch {
    throw new AuthError(
      'Could not reach the app service. Check that the backend is running and the API proxy points at it.',
      { code: 'network', status: 0 },
    )
  }
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as {
      detail?: string
      title?: string
    } | null
    throw new AuthError(problem?.detail ?? 'Sign-in failed. Please try again.', {
      code: problem?.title ?? null,
      status: res.status,
    })
  }
  return res.status === 204 ? null : ((await res.json()) as SessionBody)
}

// --- public surface -------------------------------------------------------

/** Exchange credentials for a server-held session. */
export async function login({ username, password }: { username: string; password: string }) {
  const body = await call('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  if (body) adopt(body)
  return snapshot
}

export const isAuthenticated = (): boolean => !!state.claims

export const isTokenExpired = (minValidity = 0): boolean =>
  !state.claims || state.expiresAt - Date.now() < minValidity * 1000

// One refresh at a time: a screen firing six requests funnels into one
// /auth/refresh, so Keycloak's refresh-token rotation never sees a retired
// token presented twice.
let inFlight: Promise<boolean> | null = null

/**
 * Refresh the session if it is close to expiry.
 *
 * Mirrors keycloak-js: resolves true when a refresh happened, false when the
 * session was still good. A negative minValidity forces one. Rejects with an
 * AuthError when the backend answers 401 — the refresh token has lapsed
 * realm-side and only a fresh sign-in will do.
 */
export async function updateToken(minValidity = 5): Promise<boolean> {
  if (!state.claims) throw new AuthError('Not signed in.', { code: 'no_session' })

  if (minValidity >= 0 && !isTokenExpired(minValidity)) return false

  inFlight ??= call('/refresh', { method: 'POST' })
    .then((body) => {
      if (body) adopt(body)
      return true
    })
    .catch((err: unknown) => {
      // A refused refresh is terminal: the backend has already cleared the
      // cookies, so mirror it locally rather than retrying into a dead session.
      clear()
      throw err instanceof AuthError && err.status === 401
        ? new AuthError('Your session has expired. Please sign in again.', {
            code: 'idle_timeout',
            status: 401,
          })
        : err
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

/**
 * End the session. The backend tells Keycloak first (the server-side session
 * dies too) and clears the cookies either way; the local clear here is
 * unconditional for the same reason — a network failure must not strand
 * someone in an app they asked to leave.
 */
export async function logout(): Promise<void> {
  clear()
  try {
    await call('/logout', { method: 'POST' })
  } catch {
    // Deliberately swallowed — see above.
  }
}

// --- reload survival --------------------------------------------------------

let restoreInFlight: Promise<boolean> | null = null

/**
 * Re-establish the session after a page load: one GET /auth/session.
 * Verification is entirely server-side (JWKS, transparent refresh). Deduped
 * while in flight — StrictMode's dev double-effect, or any second caller
 * racing the first, shares one answer. NEVER REJECTS: "nobody signed in" is a
 * normal way for a page load to start.
 */
export function restoreSession(): Promise<boolean> {
  restoreInFlight ??= (async () => {
    try {
      const body = await call('/session')
      if (body?.authenticated) {
        adopt(body)
        return true
      }
    } catch {
      // Backend unreachable — treated as signed out; the sign-in form's own
      // error handling reports connectivity when the user actually tries.
    }
    return false
  })().finally(() => {
    restoreInFlight = null
  })
  return restoreInFlight
}

/** Verified claims from the access token, or null when signed out. */
export const getClaims = (): SessionClaims | null => state.claims

/** Test seam. Not used by the app. */
export const __setSessionForTests = (body: SessionBody | null): void =>
  body ? adopt(body) : clear()
