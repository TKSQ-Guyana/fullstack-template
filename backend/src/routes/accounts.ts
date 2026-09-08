// /accounts — the administrator's half of the set-password invitation.
//
// AUTHORISATION IS THE INTERESTING PART, and it is not the same problem
// /kcadmin has. That proxy forwards the caller's own token and lets Keycloak
// decide, so it adds no privilege and needs no rule of its own. These endpoints
// cannot do that: minting a set-password token is an act in OUR database, and
// spending it later writes a password using the APP's service account. The app
// is therefore the thing granting privilege, and it must not grant what
// Keycloak has not.
//
// So the gate reads `realm-management: manage-users` off the caller's own
// verified token — the same claim Keycloak itself authorises its admin API
// with, from the same RS256-verified token, so this is not a weaker check than
// Keycloak's, it is the same input.
//
// THE FAILURE MODE WORTH KNOWING: client roles ride in `resource_access` only
// while the client keeps "Full scope allowed" switched on. If somebody
// switches it off, a genuine administrator is refused here, and the 403 below
// says exactly that rather than leaving them to guess.
import { Router, type Request, type Response } from 'express'
import jwt from 'jsonwebtoken'
import { forbidden, notFound, unauthorized, unprocessable } from '../http/problem.js'
import { principalOf } from '../middleware/auth.js'
import { findUserById } from '../services/kcServiceAccount.js'
import { looksLikeEmail, mailConfigured, maskEmail, sendMail } from '../services/mailer.js'
import { invitationMail } from '../services/mailTemplates.js'
import { listInvitations, markMailed, mintInvitation } from '../services/passwordInvitations.js'
import { logger } from '../logger.js'

export const accountsRouter = Router()

/** The realm-management client role that may administer accounts. */
const MANAGE_USERS = 'manage-users'

/**
 * Refuse unless the caller's own token carries manage-users.
 *
 * The token is already RS256-verified by `authenticate`, so decoding it without
 * re-verifying is reading a value we have already established — not trusting
 * the browser.
 */
function requireManageUsers(req: Request): void {
  const token = req.accessToken
  if (!token) {
    // Query-param identity (AUTH_MODE optional/disabled) carries no roles at
    // all, and inventing authority for it is not this route's job.
    throw unauthorized('Account administration needs a signed-in session.')
  }

  const claims = jwt.decode(token)
  const resourceAccess =
    claims && typeof claims === 'object'
      ? (claims as { resource_access?: Record<string, { roles?: string[] }> }).resource_access
      : undefined
  const roles = resourceAccess?.['realm-management']?.roles ?? []

  if (!roles.includes(MANAGE_USERS)) {
    throw forbidden(
      'This account may not administer other accounts. It needs the realm-management role “manage-users”, and the SPA client needs “Full scope allowed” switched on so that role is carried in its token.',
    )
  }
}

/**
 * Send (or resend) the set-password link for one account.
 *
 * WHY IT TAKES A KEYCLOAK USER ID and reads the rest from the realm, rather
 * than taking a name and an address from the body: the address the link goes
 * to must be the one ON THE ACCOUNT. A caller who could name the destination
 * could point somebody else's set-password link at their own inbox, which is
 * the whole attack this endpoint would otherwise create.
 *
 * A MAIL FAILURE IS NOT AN ERROR HERE. The account exists and the invitation
 * row exists; only the delivery did not happen. Answering 500 would make the
 * screen report a failed provision for an account that was created, so this
 * answers 200 with `mailed: false` and the reason, and the screen offers a
 * resend.
 */
accountsRouter.post('/accounts/:kcUserId/password-email', async (req: Request, res: Response) => {
  requireManageUsers(req)

  // Express 5 types a route param as string | string[]. A repeated param means
  // no single account was named, which findUserById then answers null for.
  const rawId = req.params.kcUserId
  const kcUserId = typeof rawId === 'string' ? rawId : ''
  const purpose =
    (req.body as { purpose?: string } | undefined)?.purpose === 'reset'
      ? ('reset' as const)
      : ('provision' as const)

  const user = await findUserById(kcUserId)
  if (!user) throw notFound('No such account in this realm.')

  const email = user.email?.trim() ?? ''
  if (!looksLikeEmail(email)) {
    // A real and reachable state: an account created in the Keycloak console
    // without an address. Named as itself rather than reported as a mail
    // failure, because no amount of resending will fix it.
    throw unprocessable(
      `The account “${user.username}” has no email address on it, so there is nowhere to send the link. Add one to the account first.`,
    )
  }

  const { token, expiresAt } = await mintInvitation({
    kcUserId,
    username: user.username,
    email,
    purpose,
    createdBy: principalOf(req).username,
  })

  const mail = invitationMail({
    firstName: user.firstName ?? '',
    username: user.username,
    token,
    expiresAt,
    purpose,
  })

  const result = await sendMail({
    to: email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  })
  if (result.sent) await markMailed(token)

  logger.info(
    { username: user.username, to: maskEmail(email), purpose, sent: result.sent },
    'set-password invitation issued',
  )

  // THE TOKEN IS NOT IN THE RESPONSE. It would let an administrator open
  // somebody else's link — and having created the account, they could then
  // sign in as them. The one way to the link is the mailbox on the account.
  res.json({
    mailed: result.sent,
    reason: result.sent ? null : (result.reason ?? 'mail could not be sent'),
    maskedTo: maskEmail(email),
    expiresAt: expiresAt.toISOString(),
    mailConfigured: mailConfigured(),
  })
})

/**
 * Every account's latest invitation — the register's Password column.
 *
 * ONE CALL FOR THE WHOLE TABLE. The obvious alternative, asking Keycloak
 * whether each account has a credential, is a request per row and gets slower
 * exactly as the realm grows. This is a single read of our own table.
 */
accountsRouter.get('/accounts/password-invitations', async (req: Request, res: Response) => {
  requireManageUsers(req)
  res.json({ invitations: await listInvitations() })
})
