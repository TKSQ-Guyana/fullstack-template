// Who an MFA username actually is, resolved SERVER-SIDE.
//
// Two facts the ceremony needs about an account, and neither may come from
// the browser:
//
//   phoneFor()     where the approval link is texted. A caller who could name
//                  the destination could point somebody else's approval link
//                  at their own phone — which would turn this feature into
//                  the very hole it exists to close.
//   accountLabel() what the phone's passkey dialog calls this account.
//
// Both come from Keycloak through the service account (see
// ../services/kcServiceAccount.ts), and both answer null on any failure. Null
// is a supported state, not an error: no phone means the screen falls back to
// the copy link, and no email means the dialog shows the username as before.
//
// Cached briefly. These are read on every challenge, they change when an
// administrator edits the account, and a minute of staleness costs nothing
// next to a Keycloak round trip on the sign-in path.
import { env } from '../config/env.js'
import {
  attributeOf,
  findUser,
  serviceAccountConfigured,
  type KeycloakUser,
} from '../services/kcServiceAccount.js'
import { toE164 } from '../services/sms.js'

const TTL_MS = 60_000

interface Entry {
  user: KeycloakUser | null
  at: number
}

const records = new Map<string, Entry>()

/** One Keycloak round trip per username per minute, shared by both readers. */
async function record(username: string): Promise<KeycloakUser | null> {
  if (!serviceAccountConfigured()) return null
  const hit = records.get(username)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.user
  const user = await findUser(username)
  records.set(username, { user, at: Date.now() })
  return user
}

/**
 * The mobile number on the account, in E.164, or null.
 *
 * The attribute name is configurable because realms differ
 * (MFA_PHONE_ATTRIBUTE). A value that cannot be an E.164 number is treated as
 * absent rather than handed to the gateway to be rejected.
 */
export async function phoneFor(username: string): Promise<string | null> {
  return toE164(attributeOf(await record(username), env.MFA_PHONE_ATTRIBUTE))
}

/**
 * The account's email, for the passkey dialog's label — so the credential the
 * phone stores reads as the person's own work account rather than an opaque
 * username. Null falls back to the username the caller already has.
 */
export async function accountLabel(username: string): Promise<string | null> {
  const email = (await record(username))?.email
  return email && email.trim() !== '' ? email.trim() : null
}
