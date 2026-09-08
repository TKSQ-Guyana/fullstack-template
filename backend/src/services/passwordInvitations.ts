// Single-use set-password links — mint, claim, release.
//
// Provisioning issues no password (migration 0001's password_invitations
// section has the story), so this is the only way into a new account. Which
// makes every line here a credential path, and the three rules below are what
// keep it one:
//
//   1. THE TOKEN IS NEVER STORED. Only its SHA-256 reaches Postgres, so a
//      database copy — a dump, a replica, a backup on somebody's laptop —
//      cannot be turned into a set of working links. The token exists in the
//      email and in the URL the recipient opens, and nowhere else.
//   2. THE CLAIM IS ONE UPDATE. `SET used_at = now() WHERE token_hash = $1 AND
//      used_at IS NULL AND expires_at > now() RETURNING kc_user_id` — no row
//      returned means spent or stale, whatever two browsers do at the same
//      moment. SELECT-then-UPDATE would let both of them win.
//   3. EXPIRY IS CHECKED IN THE QUERY, not in JavaScript. A row read as valid
//      and acted on a second later cannot slip past the boundary, and no
//      instance's clock can disagree with another's about it.
//
// The claim is RELEASABLE, and that is deliberate rather than a loophole: the
// Keycloak write happens after it, and if Keycloak refuses, a link burnt for
// nothing would leave the account unreachable with no way back except another
// administrator. Releasing puts the recipient back where they were — able to
// press the button again — and the window it opens is the milliseconds between
// two calls in one request handler.
import crypto from 'node:crypto'
import { pool } from '../db/pool.js'
import { env } from '../config/env.js'
import { logger } from '../logger.js'

export type InvitationPurpose = 'provision' | 'reset'

export interface MintedInvitation {
  /** The raw token. Goes into the email; never logged, never stored. */
  token: string
  expiresAt: Date
}

export interface ClaimedInvitation {
  kcUserId: string
  username: string
  email: string
}

/** SHA-256, hex. The stored form of a token. */
const hash = (token: string): string =>
  crypto.createHash('sha256').update(token, 'utf8').digest('hex')

/**
 * 32 random bytes, base64url — 43 characters, no padding, URL-safe.
 *
 * `randomBytes` rather than anything derived from the account: a token that
 * could be computed from a username is not a token. 256 bits is far past
 * guessable, and the length still leaves the whole link under ~90 characters.
 */
const newToken = (): string => crypto.randomBytes(32).toString('base64url')

/**
 * Issue a link for one account.
 *
 * PREVIOUS UNUSED INVITATIONS FOR THE SAME ACCOUNT ARE EXPIRED, not left
 * alongside. Two live links for one account means the older one still works
 * after the newer is used — so "resend" would widen the window rather than
 * replace it.
 */
export async function mintInvitation(input: {
  kcUserId: string
  username: string
  email: string
  purpose: InvitationPurpose
  createdBy: string | null
}): Promise<MintedInvitation> {
  const token = newToken()
  const expiresAt = new Date(Date.now() + env.PASSWORD_INVITE_TTL_HOURS * 3600_000)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Revoke, don't accumulate. now() rather than a delete so the register can
    // still show that an invitation was issued and superseded.
    await client.query(
      `UPDATE app.password_invitations
          SET expires_at = now()
        WHERE kc_user_id = $1 AND used_at IS NULL AND expires_at > now()`,
      [input.kcUserId],
    )
    await client.query(
      `INSERT INTO app.password_invitations
         (token_hash, kc_user_id, username, email, purpose, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        hash(token),
        input.kcUserId,
        input.username,
        input.email,
        input.purpose,
        input.createdBy,
        expiresAt,
      ],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }

  // Opportunistic housekeeping: spent and long-expired rows are of no interest
  // to anybody, and a sweep on mint costs nothing anybody is waiting for. Kept
  // for 30 days so "was this person ever invited, and by whom" survives a
  // support question.
  void pool
    .query(`DELETE FROM app.password_invitations WHERE expires_at < now() - interval '30 days'`)
    .catch(() => undefined)

  return { token, expiresAt }
}

/** Record that the relay accepted the message. */
export async function markMailed(token: string): Promise<void> {
  await pool.query(`UPDATE app.password_invitations SET mailed = TRUE WHERE token_hash = $1`, [
    hash(token),
  ])
}

/**
 * What the set-password PAGE may know before anything is set.
 *
 * NO EMAIL ADDRESS IS RETURNED. The page is public and the token is the only
 * credential, so anything it echoes is readable by whoever holds the link —
 * which is fine for the username (they are about to sign in with it) and is
 * not fine for a mailbox. Answers null for expired, spent and unknown alike:
 * the page has one message for all three, because distinguishing them tells a
 * stranger which tokens once existed.
 */
export async function describeInvitation(
  token: string,
): Promise<{ username: string; expiresAt: Date } | null> {
  const { rows } = await pool.query<{ username: string; expires_at: Date }>(
    `SELECT username, expires_at
       FROM app.password_invitations
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [hash(token)],
  )
  const row = rows[0]
  return row ? { username: row.username, expiresAt: row.expires_at } : null
}

/**
 * Spend the link, atomically. Null means it was already spent, expired, or
 * never existed — all one answer to the caller, on purpose.
 */
export async function claimInvitation(token: string): Promise<ClaimedInvitation | null> {
  const { rows } = await pool.query<{ kc_user_id: string; username: string; email: string }>(
    `UPDATE app.password_invitations
        SET used_at = now()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING kc_user_id, username, email`,
    [hash(token)],
  )
  const row = rows[0]
  return row ? { kcUserId: row.kc_user_id, username: row.username, email: row.email } : null
}

/**
 * Un-spend a claim whose Keycloak write then failed.
 *
 * Only ever called on the failure path, and only for a token this process just
 * claimed — so it cannot resurrect somebody else's spent link. Logged either
 * way: a release means a recipient saw an error on a link that is still good,
 * and that is worth being able to correlate with the Keycloak failure above it.
 */
export async function releaseInvitation(token: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE app.password_invitations SET used_at = NULL WHERE token_hash = $1`,
    [hash(token)],
  )
  logger.warn({ released: rowCount }, 'set-password claim released after a failed write')
}

/** Every account's latest invitation, for the register's Password column. */
export async function listInvitations(): Promise<unknown> {
  const { rows } = await pool.query<{ rows: unknown }>(
    'SELECT app.api_password_invitations() AS rows',
  )
  return rows[0]?.rows ?? []
}
