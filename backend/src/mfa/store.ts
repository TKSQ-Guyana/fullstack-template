// The WebAuthn second factor's state — enrolled passkeys, one-time login
// tokens, and in-flight enrolment challenges. POSTGRES-BACKED on purpose: an
// in-memory store cannot ship — a login token minted by one backend pod is
// invisible to the replica answering the status poll, and every
// restart/redeploy erases all enrolled passkeys. Postgres rather than Redis
// because the database is the one store every environment already has.
//
// TTL semantics live in the rows (expires_at, checked on every read), and
// the single-use guarantees are DELETE ... RETURNING — atomic across any
// number of instances, where a Map delete is atomic only within one process.
import crypto from 'node:crypto'
import type { AuthenticatorTransportFuture, CredentialDeviceType } from '@simplewebauthn/types'
import { pool } from '../db/pool.js'

export const LOGIN_TOKEN_TTL_MS = 3 * 60 * 1000 // 3 minutes to scan + verify
const TTL_INTERVAL = "interval '3 minutes'"

/** A stored passkey: what verifyAuthenticationResponse needs, plus bookkeeping. */
export interface MfaCredential {
  credentialID: string
  credentialPublicKey: Uint8Array
  counter: number
  credentialDeviceType?: CredentialDeviceType
  credentialBackedUp?: boolean
  transports?: AuthenticatorTransportFuture[]
}

export interface LoginTokenEntry {
  username: string
  status: 'pending' | 'verified'
  challenge: string | null
}

interface CredentialRow {
  credential_id: string
  username: string
  public_key: Buffer
  counter: string | number
  device_type: CredentialDeviceType | null
  backed_up: boolean | null
  transports: AuthenticatorTransportFuture[] | null
}

const toCredential = (r: CredentialRow): MfaCredential => ({
  credentialID: r.credential_id,
  credentialPublicKey: r.public_key,
  counter: Number(r.counter),
  credentialDeviceType: r.device_type ?? undefined,
  credentialBackedUp: r.backed_up ?? undefined,
  transports: r.transports ?? undefined,
})

// --- passkeys ---------------------------------------------------------------

/** Every passkey enrolled for `username` (empty array = not enrolled). */
export async function getCredentials(username: string): Promise<MfaCredential[]> {
  const { rows } = await pool.query<CredentialRow>(
    'SELECT * FROM app.mfa_credentials WHERE username = $1 ORDER BY created_at',
    [username],
  )
  return rows.map(toCredential)
}

export async function addCredentialToUser(
  username: string,
  credential: MfaCredential,
): Promise<void> {
  await pool.query(
    `INSERT INTO app.mfa_credentials
       (credential_id, username, public_key, counter, device_type, backed_up, transports)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (credential_id) DO NOTHING`,
    [
      credential.credentialID,
      username,
      Buffer.from(credential.credentialPublicKey),
      credential.counter,
      credential.credentialDeviceType ?? null,
      credential.credentialBackedUp ?? null,
      credential.transports ?? null,
    ],
  )
}

export async function findUserByCredentialId(
  credentialID: string | undefined,
): Promise<{ username: string; credential: MfaCredential } | null> {
  if (!credentialID) return null
  const { rows } = await pool.query<CredentialRow>(
    'SELECT * FROM app.mfa_credentials WHERE credential_id = $1',
    [credentialID],
  )
  if (!rows[0]) return null
  return { username: rows[0].username, credential: toCredential(rows[0]) }
}

export async function updateCredentialCounter(
  credentialID: string,
  newCounter: number,
): Promise<void> {
  await pool.query('UPDATE app.mfa_credentials SET counter = $2 WHERE credential_id = $1', [
    credentialID,
    newCounter,
  ])
}

// --- enrolment challenges (one in flight per username) -----------------------

export async function setRegistrationChallenge(username: string, challenge: string): Promise<void> {
  await pool.query(
    `INSERT INTO app.mfa_registration_challenges (username, challenge, created_at, expires_at)
     VALUES ($1, $2, now(), now() + ${TTL_INTERVAL})
     ON CONFLICT (username)
     DO UPDATE SET challenge = $2, created_at = now(), expires_at = now() + ${TTL_INTERVAL}`,
    [username, challenge],
  )
}

/**
 * SINGLE-USE read: the challenge is deleted whether or not the verification
 * that follows succeeds — atomic across instances.
 */
export async function takeRegistrationChallenge(username: string): Promise<string | null> {
  const { rows } = await pool.query<{ challenge: string; live: boolean }>(
    `DELETE FROM app.mfa_registration_challenges WHERE username = $1
     RETURNING challenge, (expires_at > now()) AS live`,
    [username],
  )
  return rows[0]?.live ? rows[0].challenge : null
}

// --- login tokens ------------------------------------------------------------

export async function createLoginToken(username: string): Promise<string> {
  const token = crypto.randomBytes(24).toString('base64url')
  // Opportunistic sweep: minting a token is rare enough that clearing the
  // expired rows here keeps both TTL tables from growing unbounded without a
  // scheduled job.
  await pool.query('DELETE FROM app.mfa_login_tokens WHERE expires_at < now()')
  await pool.query('DELETE FROM app.mfa_registration_challenges WHERE expires_at < now()')
  await pool.query(
    `INSERT INTO app.mfa_login_tokens (token, username, expires_at)
     VALUES ($1, $2, now() + ${TTL_INTERVAL})`,
    [token, username],
  )
  return token
}

export async function getLoginToken(token: string): Promise<LoginTokenEntry | null> {
  const { rows } = await pool.query<LoginTokenEntry>(
    `SELECT username, status, challenge FROM app.mfa_login_tokens
     WHERE token = $1 AND expires_at > now()`,
    [token],
  )
  return rows[0] ?? null
}

export async function setLoginChallenge(token: string, challenge: string): Promise<void> {
  await pool.query(
    'UPDATE app.mfa_login_tokens SET challenge = $2 WHERE token = $1 AND expires_at > now()',
    [token, challenge],
  )
}

export async function markLoginVerified(token: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE app.mfa_login_tokens SET status = 'verified'
     WHERE token = $1 AND expires_at > now()`,
    [token],
  )
  return (rowCount ?? 0) > 0
}

/**
 * SINGLE-USE completion: deletes and returns the token only if it is verified
 * and still live — one atomic statement, so two racing /complete calls (or
 * two replicas) can never both succeed.
 */
export async function consumeVerifiedToken(token: string): Promise<{ username: string } | null> {
  const { rows } = await pool.query<{ username: string }>(
    `DELETE FROM app.mfa_login_tokens
     WHERE token = $1 AND status = 'verified' AND expires_at > now()
     RETURNING username`,
    [token],
  )
  return rows[0] ?? null
}
