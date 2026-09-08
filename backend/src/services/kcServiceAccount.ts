// Reading and writing Keycloak users, server-side, as the app's own
// service account.
//
// WHY A SERVICE ACCOUNT rather than the caller's own token, which is the
// pattern /kcadmin uses: some callers HAVE no token. The person opening a
// set-password link has no session — that is the whole point of the link —
// and the MFA flow must read the phone number from the identity provider
// rather than from the browser (a caller who could name the destination could
// point somebody else's approval link at their own phone).
//
// `app-provisioning-service` needs, on its service account: query-users /
// view-users for the lookups, manage-users for the password write. The local
// realm gets these from the dev seeder; deployed realms grant them by hand.
//
// NO SECRET, NO LOOKUP — and that is a supported state, not a failure: every
// function answers null / a refusal object rather than throwing.
import { env } from '../config/env.js'
import { logger } from '../logger.js'

interface TokenState {
  accessToken: string
  /** epoch ms; refreshed before this with a margin. */
  expiresAt: number
}

let token: TokenState | null = null
let inFlight: Promise<string | null> | null = null

/** Refresh a little before expiry so a call never races the boundary. */
const EXPIRY_MARGIN_MS = 30_000

export const serviceAccountConfigured = (): boolean =>
  !!env.KC_SERVICE_CLIENT_ID && !!env.KC_SERVICE_CLIENT_SECRET

/**
 * A client-credentials access token for the service account, cached until it
 * is nearly expired. Concurrent callers share one in-flight request rather
 * than each asking Keycloak for their own.
 */
async function serviceToken(): Promise<string | null> {
  if (!serviceAccountConfigured()) return null
  if (token && Date.now() < token.expiresAt - EXPIRY_MARGIN_MS) return token.accessToken
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const res = await fetch(`${env.kcOidcBase}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: env.KC_SERVICE_CLIENT_ID,
          client_secret: env.KC_SERVICE_CLIENT_SECRET,
        }),
      })
      if (!res.ok) {
        logger.warn({ status: res.status }, 'keycloak service-account token refused')
        return null
      }
      const body = (await res.json()) as { access_token?: string; expires_in?: number }
      if (!body.access_token) return null
      token = {
        accessToken: body.access_token,
        expiresAt: Date.now() + (body.expires_in ?? 60) * 1000,
      }
      return token.accessToken
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'keycloak service-account token failed')
      return null
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

export interface KeycloakUser {
  id: string
  username: string
  email?: string
  firstName?: string
  lastName?: string
  attributes?: Record<string, string[] | undefined>
}

/**
 * One user, by exact username.
 *
 * EXACT MATCH ONLY (`exact=true`), and the username is compared AGAIN on the
 * way out: Keycloak's user search is a prefix match by default, and acting on
 * whoever happens to sort first is precisely the near-miss this must never
 * make. More than one row is treated as no row for the same reason.
 *
 * Answers null for every failure — not configured, Keycloak unreachable, no
 * such user — because they all mean the same thing to the caller: nothing to
 * go on, so fall back.
 */
export async function findUser(username: string): Promise<KeycloakUser | null> {
  const access = await serviceToken()
  if (!access) return null

  try {
    // briefRepresentation=false OR THE ATTRIBUTES ARE ABSENT. Keycloak's user
    // search returns a brief record by default — username and email but no
    // `attributes` object at all — so custom attributes read as 'not set' on
    // every account.
    const query = new URLSearchParams({
      username,
      exact: 'true',
      max: '2',
      briefRepresentation: 'false',
    })
    const res = await fetch(`${env.kcAdminBase}/users?${query}`, {
      headers: { Authorization: `Bearer ${access}` },
    })
    if (!res.ok) {
      logger.warn({ status: res.status }, 'keycloak user lookup refused')
      return null
    }
    const rows = (await res.json()) as KeycloakUser[]
    if (!Array.isArray(rows) || rows.length !== 1) return null
    const row = rows[0]
    return row && row.username === username ? row : null
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'keycloak user lookup failed')
    return null
  }
}

/** One custom attribute off that record; '' and absent are both null. */
export function attributeOf(user: KeycloakUser | null, attribute: string): string | null {
  const values = user?.attributes?.[attribute]
  const value = Array.isArray(values) ? values[0] : undefined
  return value && value.trim() !== '' ? value.trim() : null
}

/** One user by their realm uuid. Null for every failure, as everything here does. */
export async function findUserById(kcUserId: string): Promise<KeycloakUser | null> {
  const access = await serviceToken()
  if (!access) return null
  try {
    const res = await fetch(`${env.kcAdminBase}/users/${encodeURIComponent(kcUserId)}`, {
      headers: { Authorization: `Bearer ${access}` },
    })
    if (!res.ok) {
      logger.warn({ status: res.status }, 'keycloak user-by-id lookup refused')
      return null
    }
    return (await res.json()) as KeycloakUser
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'keycloak user-by-id lookup failed')
    return null
  }
}

export interface PasswordWriteResult {
  ok: boolean
  /** Keycloak's own wording when it refuses — a password-policy rejection
   *  names the rule that failed, which no paraphrase does as well. */
  detail?: string
  status?: number
}

/**
 * Write a password onto an account.
 *
 * `temporary: false` — the holder just chose it, so requiring them to choose
 * again on first sign-in would be absurd.
 *
 * THE POLICY IS KEYCLOAK'S TO ENFORCE. The page states the realm's rules so
 * somebody is not guessing, but nothing here re-implements them: the realm is
 * the authority, it can be changed without redeploying this, and its refusal
 * names the specific rule. A 400 comes back as `detail` and reaches the page
 * verbatim.
 */
export async function resetUserPassword(
  kcUserId: string,
  password: string,
): Promise<PasswordWriteResult> {
  const access = await serviceToken()
  if (!access) return { ok: false, detail: 'The app cannot reach the account service.' }

  try {
    const res = await fetch(
      `${env.kcAdminBase}/users/${encodeURIComponent(kcUserId)}/reset-password`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'password', value: password, temporary: false }),
      },
    )
    if (res.status === 204 || res.ok) return { ok: true }

    const body = (await res.json().catch(() => null)) as {
      errorMessage?: string
      error?: string
    } | null
    const detail = body?.errorMessage ?? body?.error ?? undefined
    // The password is NEVER in this log line, and neither is the token.
    logger.warn({ status: res.status, detail }, 'keycloak refused the password write')
    return { ok: false, status: res.status, detail }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'keycloak password write failed')
    return { ok: false, detail: 'The account service could not be reached.' }
  }
}
