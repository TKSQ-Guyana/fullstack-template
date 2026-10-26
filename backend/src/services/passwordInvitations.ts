// Single-use set-password links — issue, mint, claim, release.
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
//   2. THE CLAIM IS ONE UPDATE (repositories/invitations.repository.ts
//      `claim`) — no row returned means spent or stale, whatever two browsers
//      do at the same moment. SELECT-then-UPDATE would let both of them win.
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
import { env } from '../config/env.js'
import { onTx } from '../db/kysely.js'
import { withTransaction } from '../db/transaction.js'
import { notFound, refused } from '../domain/errors.js'
import { findUserById } from '../integrations/keycloak/serviceAccount.js'
import { looksLikeEmail, mailConfigured, maskEmail, sendMail } from '../integrations/mail/mailer.js'
import { invitationMail } from '../integrations/mail/mailTemplates.js'
import { logger } from '../logger.js'
import { presentInvitations } from '../presenters/invitation.presenter.js'
import * as invitations from '../repositories/invitations.repository.js'

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
 * alongside — in the same transaction as the new row. Two live links for one
 * account means the older one still works after the newer is used, so
 * "resend" would widen the window rather than replace it.
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

  await withTransaction(async (tx) => {
    const k = onTx(tx)
    await invitations.expireLive(input.kcUserId, k)
    await invitations.insert({ ...input, tokenHash: hash(token), expiresAt }, k)
  })

  // Opportunistic housekeeping: spent and long-expired rows are of no interest
  // to anybody, and a sweep on mint costs nothing anybody is waiting for.
  void invitations.sweepExpired().catch(() => undefined)

  return { token, expiresAt }
}

/**
 * Send (or resend) the set-password link for one account, named by its
 * Keycloak id.
 *
 * WHY IT TAKES A KEYCLOAK USER ID and reads the rest from the realm, rather
 * than taking a name and an address from the caller: the address the link
 * goes to must be the one ON THE ACCOUNT. A caller who could name the
 * destination could point somebody else's set-password link at their own
 * inbox.
 *
 * A MAIL FAILURE IS NOT AN ERROR HERE. The account exists and the invitation
 * row exists; only the delivery did not happen. The outcome says so
 * (`mailed: false` and the reason), and the screen offers a resend.
 */
export async function issueInvitation(input: {
  kcUserId: string
  purpose: InvitationPurpose
  createdBy: string | null
}) {
  const user = await findUserById(input.kcUserId)
  if (!user) throw notFound('No such account in this realm.')

  const email = user.email?.trim() ?? ''
  if (!looksLikeEmail(email)) {
    // A real and reachable state: an account created in the Keycloak console
    // without an address. Named as itself rather than reported as a mail
    // failure, because no amount of resending will fix it.
    throw refused(
      `The account “${user.username}” has no email address on it, so there is nowhere to send the link. Add one to the account first.`,
    )
  }

  const { token, expiresAt } = await mintInvitation({
    kcUserId: input.kcUserId,
    username: user.username,
    email,
    purpose: input.purpose,
    createdBy: input.createdBy,
  })

  const mail = invitationMail({
    firstName: user.firstName ?? '',
    username: user.username,
    token,
    expiresAt,
    purpose: input.purpose,
  })
  const result = await sendMail({
    to: email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  })
  if (result.sent) await markMailed(token)

  logger.info(
    { username: user.username, to: maskEmail(email), purpose: input.purpose, sent: result.sent },
    'set-password invitation issued',
  )

  return {
    mailed: result.sent,
    reason: result.sent ? null : (result.reason ?? 'mail could not be sent'),
    maskedTo: maskEmail(email),
    expiresAt,
    mailConfigured: mailConfigured(),
  }
}

/** Record that the relay accepted the message. */
export function markMailed(token: string): Promise<void> {
  return invitations.markMailed(hash(token))
}

/**
 * What the set-password PAGE may know before anything is set: the username
 * and the expiry, never the mailbox. Undefined for expired, spent and unknown
 * alike — the page has one message for all three, because distinguishing them
 * tells a stranger which tokens once existed.
 */
export function describeInvitation(token: string) {
  return invitations.findLive(hash(token))
}

/**
 * Spend the link, atomically. Null means it was already spent, expired, or
 * never existed — all one answer to the caller, on purpose.
 */
export async function claimInvitation(token: string): Promise<ClaimedInvitation | null> {
  const row = await invitations.claim(hash(token))
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
  const released = await invitations.release(hash(token))
  logger.warn({ released }, 'set-password claim released after a failed write')
}

/**
 * Every account's latest invitation, for the register's Password column.
 *
 * ONE READ FOR THE WHOLE TABLE. The obvious alternative, asking Keycloak
 * whether each account has a credential, is a request per row and gets slower
 * exactly as the realm grows.
 */
export async function listInvitations() {
  return presentInvitations(await invitations.latestPerAccount())
}
