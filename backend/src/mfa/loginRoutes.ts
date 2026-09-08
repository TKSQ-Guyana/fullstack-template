// The login-link flow the APP drives: /request mints a one-time token and
// the /verify URL for the phone, /status and the WebSocket report the verdict,
// /complete consumes the token (single-use).
//
// Mounted at <base>/mfa/login (see ./index.ts) — the frontend calls these
// paths directly on the API base path, same door as every other backend call.
import { Router, type Request, type Response } from 'express'
import { env } from '../config/env.js'
import { logger } from '../logger.js'
import { maskNumber, sendSms, smsConfigured } from '../services/sms.js'
import { phoneFor } from './identity.js'
import { getCredentials, createLoginToken, getLoginToken, consumeVerifiedToken } from './store.js'

export const mfaLoginRouter = Router()

/**
 * Desktop calls this to kick off a login.
 *
 * THE LINK IS TEXTED to the number on the user's Keycloak account, so in the
 * ordinary path the desktop never displays a usable link at all — the phone
 * that receives it is itself a possession check, and the on-screen copy link
 * becomes a fallback for "the message did not arrive" rather than the primary
 * route.
 *
 * WHY TEXTING A LINK IS NOT HANDING OUT A CREDENTIAL. The token in the URL
 * opens a ceremony; it does not complete one. Approving still requires the
 * passkey resident on the enrolled phone, so an intercepted message buys an
 * attacker a page they cannot finish — and /verify additionally refuses the
 * browser that ran the password grant (src/mfa/deviceGuard.ts).
 *
 * The destination is resolved SERVER-SIDE from the username. It is never
 * taken from the request: a caller who could name the number could point
 * somebody else's approval link at their own phone.
 */
mfaLoginRouter.post('/request', async (req: Request, res: Response) => {
  const { username } = (req.body ?? {}) as { username?: string }
  if (!username) {
    res.status(400).json({ error: 'username is required' })
    return
  }

  const credentials = await getCredentials(username)
  if (credentials.length === 0) {
    // The exact sentence matters: the frontend matches it to tell "register
    // your device" apart from "something broke".
    res
      .status(400)
      .json({ error: 'No passkey enrolled for this account. Enroll from your phone first.' })
    return
  }

  const token = await createLoginToken(username)
  // The phone opens this on the PRIMARY base path — the same door the rest of
  // the MFA surface rides, so no edge/WAF rule has to know the pages exist.
  const verifyUrl = `${env.MFA_PUBLIC_URL}${env.basePaths[0]}/mfa/verify?token=${token}`

  // Never blocks the answer for longer than SMS_TIMEOUT_MS, and never fails
  // it: a gateway that is down must not stop a sign-in the password and the
  // passkey would allow.
  const sms = await deliverBySms(username, verifyUrl)

  res.json({ token, verifyUrl, sms })
})

interface SmsOutcome {
  /** Handed to the gateway for delivery. */
  sent: boolean
  /** Masked destination, for the screen to name. Present only when sent. */
  to?: string
  /** Why the screen is falling back to the copy link. */
  reason?: 'not-configured' | 'no-number' | 'gateway-failed'
}

async function deliverBySms(username: string, verifyUrl: string): Promise<SmsOutcome> {
  if (!smsConfigured()) return { sent: false, reason: 'not-configured' }

  const phone = await phoneFor(username)
  if (!phone) {
    // Not an error worth failing on — plenty of accounts will have no number
    // until the realm is populated — but worth seeing in the log, because it
    // is the difference between "SMS is broken" and "this user has no number".
    logger.info({ username }, 'mfa: no mobile number on the account, falling back to copy link')
    return { sent: false, reason: 'no-number' }
  }

  const text = env.MFA_SMS_TEMPLATE.replace(/\\n/g, '\n').replace('{link}', verifyUrl)
  const result = await sendSms([phone], text)
  return result.sent
    ? { sent: true, to: maskNumber(phone) }
    : { sent: false, to: maskNumber(phone), reason: 'gateway-failed' }
}

/**
 * Text the ENROLMENT link — registering a passkey, not approving a sign-in.
 *
 * This is the closest thing to "prove the passkey is going onto your own
 * account". A relying party cannot choose which credential manager stores a
 * passkey, nor learn which account it syncs to, so where it ends up is not
 * enforceable. What IS enforceable is WHO GETS TO ENROL AT ALL: sending the
 * registration link to the number on the account means the device doing the
 * registering is a device holding that person's SIM.
 *
 * Deliberately answers 200 with {sent:false} rather than an error when there
 * is no number or no gateway — the screen still shows the copy link.
 */
mfaLoginRouter.post('/enrol-link', async (req: Request, res: Response) => {
  const { username, enrolUrl } = (req.body ?? {}) as { username?: string; enrolUrl?: string }
  if (!username) {
    res.status(400).json({ error: 'username is required' })
    return
  }
  // The URL is REBUILT here, never trusted from the body: an attacker-supplied
  // link texted to a real user's phone would be a phishing message sent with
  // the app's own voice. `enrolUrl` is accepted and ignored for exactly that
  // reason — the caller may say what origin it saw, it does not decide.
  void enrolUrl
  const url = `${env.MFA_PUBLIC_URL}${env.basePaths[0]}/mfa/enroll?username=${encodeURIComponent(username)}`

  if (!smsConfigured()) {
    res.json({ sent: false, reason: 'not-configured' })
    return
  }
  const phone = await phoneFor(username)
  if (!phone) {
    res.json({ sent: false, reason: 'no-number' })
    return
  }
  const text = env.MFA_ENROL_SMS_TEMPLATE.replace(/\\n/g, '\n').replace('{link}', url)
  const result = await sendSms([phone], text)
  res.json(
    result.sent
      ? { sent: true, to: maskNumber(phone) }
      : { sent: false, to: maskNumber(phone), reason: 'gateway-failed' },
  )
})

// Fallback for clients that can't hold a WebSocket open (or while it's (re)connecting).
mfaLoginRouter.get('/status/:token', async (req: Request, res: Response) => {
  const loginToken = await getLoginToken(req.params.token as string)
  if (!loginToken) {
    res.status(404).json({ status: 'expired' })
    return
  }
  res.json({ status: loginToken.status })
})

/**
 * Desktop calls this once it learns (via WebSocket or by polling status) that
 * the mobile verification succeeded.
 *
 * SINGLE-USE, one atomic statement: delete-and-return succeeds only for a
 * verified, still-live token, so a replayed /complete — or two racing
 * replicas — can never both succeed. The frontend's gate reads the verified
 * username from THIS RESPONSE; no MFA session cookie is issued.
 */
mfaLoginRouter.post('/complete', async (req: Request, res: Response) => {
  const { token } = (req.body ?? {}) as { token?: string }
  const consumed = token ? await consumeVerifiedToken(token) : null

  if (!consumed) {
    res.status(400).json({ error: 'Login not verified yet' })
    return
  }

  res.json({ success: true, username: consumed.username })
})
