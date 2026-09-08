// The second factor's client: drive the phone-approval flow against the
// backend's /mfa surface, and remember (per tab) that it was satisfied.
//
// The verdict lives in sessionStorage keyed by username — a TAB-scoped fact,
// deliberately: a shared machine's next user gets their own challenge, and
// closing the tab forgets the approval.
import { RUNTIME_CONFIG } from '@/config/runtime'

const MFA = `${RUNTIME_CONFIG.apiBase}/mfa`
const KEY = 'app_mfa_ok'

export const mfaEnabled = (): boolean => RUNTIME_CONFIG.mfaEnabled

export function mfaSatisfied(username: string): boolean {
  if (!mfaEnabled()) return true
  try {
    return sessionStorage.getItem(KEY) === username
  } catch {
    return false
  }
}

export function markSatisfied(username: string): void {
  try {
    sessionStorage.setItem(KEY, username)
  } catch {
    // Storage unavailable — the gate will re-challenge, which is safe.
  }
}

export function reset(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

export class MfaError extends Error {
  notEnrolled: boolean
  constructor(message: string, notEnrolled = false) {
    super(message)
    this.name = 'MfaError'
    this.notEnrolled = notEnrolled
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${MFA}${path}`, {
    cache: 'no-store',
    // credentials omitted intentionally: nothing here reads the session — the
    // one-time token is the credential, and lean headers keep the calls under
    // strict edge header limits.
    credentials: 'omit',
    headers: init.body ? { 'Content-Type': 'application/json' } : {},
    ...init,
  })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    const message = body.error ?? `The approval service answered ${res.status}.`
    throw new MfaError(message, /no passkey enrolled/i.test(message))
  }
  return body
}

export interface Challenge {
  token: string
  verifyUrl: string
  sms: { sent: boolean; to?: string; reason?: string }
}

/** Start a challenge: the backend texts the approval link (or the screen
 *  shows the copy link as a fallback). */
export const requestChallenge = (username: string): Promise<Challenge> =>
  call('/login/request', { method: 'POST', body: JSON.stringify({ username }) })

/** Text the ENROLMENT link to the number on the account. Never throws over
 *  delivery — {sent:false, reason} keeps the copy link path working. */
export const requestEnrolLink = (
  username: string,
): Promise<{ sent: boolean; to?: string; reason?: string }> =>
  call('/login/enrol-link', { method: 'POST', body: JSON.stringify({ username }) })

/** The enrolment page's address, for the on-screen copy link. */
export function enrolUrl(username: string): string {
  const origin = RUNTIME_CONFIG.mfaBase || window.location.origin
  return `${origin}${RUNTIME_CONFIG.apiBase}/mfa/enroll?username=${encodeURIComponent(username)}`
}

/**
 * Wait for the phone's verdict: a WebSocket push when the connection holds,
 * with a 2s status poll as the fallback (and the only path when the socket
 * cannot connect). Resolves when the token is verified; rejects on expiry.
 */
export function waitForApproval(token: string, { timeoutMs = 3 * 60 * 1000 } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    let ws: WebSocket | null = null

    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(deadline)
      ws?.close()
      if (err) reject(err)
      else resolve()
    }

    // finish() closes over these two consts; nothing can call it before they
    // are initialised (both the socket and the timers answer asynchronously).
    const deadline = setTimeout(
      () => finish(new MfaError('The approval link expired. Start the sign-in again.')),
      timeoutMs,
    )

    try {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(
        `${proto}://${window.location.host}${RUNTIME_CONFIG.apiBase}/mfa/ws?token=${encodeURIComponent(token)}`,
      )
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as { event?: string }
          if (data.event === 'verified') finish()
        } catch {
          // Not ours; the poll still decides.
        }
      }
    } catch {
      // No socket — the poll below carries the verdict alone.
    }

    const poll = setInterval(() => {
      void fetch(`${MFA}/login/status/${encodeURIComponent(token)}`, {
        cache: 'no-store',
        credentials: 'omit',
      })
        .then((res) => (res.ok ? (res.json() as Promise<{ status?: string }>) : null))
        .then((body) => {
          if (body?.status === 'verified') finish()
        })
        .catch(() => undefined)
    }, 2000)
  })
}

/** Consume the verified token (single-use, server-side) and mark this tab. */
export async function complete(token: string): Promise<string> {
  const body = await call<{ success: boolean; username: string }>('/login/complete', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
  markSatisfied(body.username)
  return body.username
}
