// /accounts — the administrator's half of the set-password invitation.
//
// AUTHORISATION IS THE INTERESTING PART. These endpoints cannot simply forward
// the caller's token to Keycloak and let it decide: minting a set-password
// token is an act in OUR database, and spending it later writes a password
// using the APP's service account. The app is therefore the thing granting
// privilege, and it must not grant what Keycloak has not.
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
import { forbidden, unauthorized } from '../http/problem.js'
import { principalOf } from '../middleware/auth.js'
import { presentIssuedInvitation } from '../presenters/invitation.presenter.js'
import { issueInvitation, listInvitations } from '../services/passwordInvitations.js'

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
 * Send (or resend) the set-password link for one account. The address is read
 * from the account, never from the request (services/passwordInvitations.ts
 * issueInvitation says why), and a mail failure answers 200 with
 * `mailed: false` and the reason — the account and the invitation exist; only
 * the delivery did not happen, and the screen offers a resend.
 */
accountsRouter.post('/accounts/:kcUserId/password-email', async (req: Request, res: Response) => {
  requireManageUsers(req)

  // Express 5 types a route param as string | string[]. A repeated param means
  // no single account was named, which the account lookup then answers 404 for.
  const rawId = req.params.kcUserId
  const kcUserId = typeof rawId === 'string' ? rawId : ''
  const purpose =
    (req.body as { purpose?: string } | undefined)?.purpose === 'reset'
      ? ('reset' as const)
      : ('provision' as const)

  const outcome = await issueInvitation({
    kcUserId,
    purpose,
    createdBy: principalOf(req).username,
  })
  res.json(presentIssuedInvitation(outcome))
})

/** Every account's latest invitation — the register's Password column. */
accountsRouter.get('/accounts/password-invitations', async (req: Request, res: Response) => {
  requireManageUsers(req)
  res.json(await listInvitations())
})
