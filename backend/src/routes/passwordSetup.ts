// /password-setup — the recipient's half of the invitation. PUBLIC.
//
// MOUNTED BEFORE `authenticate`, exactly as /mfa is, and for the same reason:
// the person holding this link HAS NO SESSION. That is not a gap in the gate,
// it is the state the link exists to resolve — the account has no password, so
// there is nothing to sign in with. The single-use token is the credential,
// and it is checked in Postgres before anything happens
// (services/passwordInvitations.ts).
//
// EVERY REFUSAL SOUNDS THE SAME. Expired, already used, and never existed all
// answer 410 with one sentence. Distinguishing them would tell a stranger
// which tokens once existed, and there is nothing a legitimate recipient can
// do differently with the more precise answer — the fix is the same in all
// three cases: ask IT to send another.
//
// NOTHING HERE LOGS A TOKEN OR A PASSWORD, and nothing echoes the email
// address the link was sent to. The page is public; anything it returns is
// readable by whoever holds the URL, which is fine for the username they are
// about to sign in with and is not fine for a mailbox.
import { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { ProblemError, badRequest } from '../http/problem.js'
import {
  claimInvitation,
  describeInvitation,
  releaseInvitation,
} from '../services/passwordInvitations.js'
import { resetUserPassword } from '../services/kcServiceAccount.js'
import { logger } from '../logger.js'

export const passwordSetupRouter = Router()

/** One sentence for spent, stale and unknown alike. */
const GONE =
  'This link is no longer valid. It may have been used already, or it may have expired. Ask your IT administrator to send a new one.'

/**
 * A HARDER LIMIT THAN THE REST OF THE API, because this is the one public
 * endpoint that takes a secret and says whether it was right. 20 a minute per
 * address is plenty for a person who mistyped and useless for anything else.
 * (The token is 256 bits, so this is defence in depth rather than the thing
 * standing between a guess and an account.)
 */
const setupLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: 'Too many attempts. Wait a minute and try again.' },
})

passwordSetupRouter.use('/password-setup', setupLimiter)

const tokenOf = (req: Request): string => {
  // Express 5 types a route param as string | string[]; a repeated param is
  // not a token this service minted, so it is refused with everything else.
  const raw = req.params.token
  const token = typeof raw === 'string' ? raw : ''
  if (!token || token.length < 20 || token.length > 200) {
    // Not a token this service ever minted. Refused before it reaches a query,
    // and with the same wording as a real miss.
    throw new ProblemError(410, GONE)
  }
  return token
}

/**
 * Is this link still good, and whose account is it?
 *
 * The page calls this on load so it can name the account before asking for a
 * password — "set a password for <username>" is the difference between a form
 * somebody trusts and one they do not.
 */
passwordSetupRouter.get('/password-setup/:token', async (req: Request, res: Response) => {
  const invitation = await describeInvitation(tokenOf(req))
  if (!invitation) {
    res.status(410).json({ valid: false, detail: GONE })
    return
  }
  res.json({
    valid: true,
    username: invitation.username,
    expiresAt: invitation.expiresAt.toISOString(),
  })
})

/**
 * Spend the link and write the password.
 *
 * ORDER MATTERS AND IS DELIBERATE: claim first, write second. Claiming first
 * means two simultaneous submissions cannot both write — the second gets
 * nothing back from the UPDATE and is refused. Writing first would leave a
 * live link on an account that already has a password.
 *
 * AND THE CLAIM IS RELEASED IF THE WRITE FAILS. Otherwise a Keycloak hiccup
 * would burn the recipient's only way in and leave them waiting on an
 * administrator. The window this opens is the milliseconds between two calls
 * in this handler.
 *
 * THE POLICY IS NOT RE-IMPLEMENTED HERE. A length floor stops an obviously
 * pointless round trip; everything else is the realm's to judge, and
 * Keycloak's refusal names the rule that failed better than any paraphrase.
 */
passwordSetupRouter.post('/password-setup/:token', async (req: Request, res: Response) => {
  const token = tokenOf(req)
  const password = (req.body as { password?: unknown } | undefined)?.password

  if (typeof password !== 'string' || password.length < 10) {
    throw badRequest('Choose a password of at least 10 characters.')
  }

  const claimed = await claimInvitation(token)
  if (!claimed) {
    res.status(410).json({ ok: false, detail: GONE })
    return
  }

  const written = await resetUserPassword(claimed.kcUserId, password)
  if (!written.ok) {
    await releaseInvitation(token)
    logger.warn(
      { username: claimed.username, status: written.status },
      'set-password write refused — link released',
    )
    // 422 rather than 500: the usual cause is the realm's password policy, and
    // that is something the person at the screen can act on. Keycloak's own
    // wording is passed through because it names the rule.
    res.status(422).json({
      ok: false,
      detail: written.detail
        ? `The password was not accepted: ${written.detail}`
        : 'The password could not be set. Try the link again, or ask your IT administrator.',
    })
    return
  }

  logger.info({ username: claimed.username }, 'password set from an invitation link')
  // The username goes back so the page can send them to sign-in knowing what
  // to type. No token, no address, no password.
  res.json({ ok: true, username: claimed.username })
})
