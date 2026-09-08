// The WebAuthn ceremonies — enrolment (phone registers a passkey) and
// authentication (phone approves a desktop's login token). The ceremony logic
// is @simplewebauthn/server's, untouched; the state behind it lives in
// Postgres (see ./store.ts) — same requests, same answers, any replica.
//
// Mounted at <base>/mfa/webauthn (see ./index.ts): the phone-facing enroll
// and verify pages call these with the baked-in VITE_API_URL prefix
// (<primary base>/mfa), so their requests ride the API base path like
// everything else.
import { Router, type Request, type Response } from 'express'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/types'
import { env } from '../config/env.js'
import { accountLabel } from './identity.js'
import {
  getCredentials,
  addCredentialToUser,
  findUserByCredentialId,
  updateCredentialCounter,
  getLoginToken,
  setLoginChallenge,
  markLoginVerified,
  setRegistrationChallenge,
  takeRegistrationChallenge,
} from './store.js'
import { notifyLoginVerified } from './ws.js'

export const webauthnRouter = Router()

// --- Enrolment: run this from the phone that should own the passkey ---

webauthnRouter.post('/register/options', async (req: Request, res: Response) => {
  const { username } = (req.body ?? {}) as { username?: string }
  if (!username) {
    res.status(400).json({ error: 'username is required' })
    return
  }

  const credentials = await getCredentials(username)

  // WHAT THE PHONE'S PASSKEY DIALOG SHOWS, and why it is worth getting right.
  // A relying party cannot choose WHICH credential manager stores a passkey,
  // and no API reports which account one syncs to, so "save it in your own
  // account" cannot be enforced by this server. What it CAN do is make a
  // misfiling visible: the dialog shows this name when saving and again on
  // every use. The account's email is a far better label than an opaque id.
  const label = (await accountLabel(username)) ?? username

  const options = await generateRegistrationOptions({
    rpName: env.APP_NAME,
    rpID: env.MFA_RP_ID,
    userName: label,
    userDisplayName: label,
    attestationType: 'none',
    excludeCredentials: credentials.map((c) => ({
      id: c.credentialID,
      transports: c.transports,
    })),
    authenticatorSelection: {
      authenticatorAttachment: 'platform', // built-in Face ID / fingerprint, not USB keys
      residentKey: 'required',
      userVerification: 'required',
    },
  })

  await setRegistrationChallenge(username, options.challenge)
  res.json(options)
})

webauthnRouter.post('/register/verify', async (req: Request, res: Response) => {
  const { username, attestationResponse } = (req.body ?? {}) as {
    username?: string
    attestationResponse?: RegistrationResponseJSON
  }
  if (!username || !attestationResponse) {
    res.status(400).json({ error: 'username and attestationResponse are required' })
    return
  }

  // SINGLE-USE: taken (deleted) up front, so a failed verification burns the
  // challenge.
  const expectedChallenge = await takeRegistrationChallenge(username)
  if (!expectedChallenge) {
    res.status(400).json({ error: 'No registration in progress for this user' })
    return
  }

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: attestationResponse,
      expectedChallenge,
      expectedOrigin: env.mfaOrigins,
      expectedRPID: env.MFA_RP_ID,
    })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
    return
  }

  if (!verification.verified || !verification.registrationInfo) {
    res.status(400).json({ verified: false })
    return
  }

  const { credentialID, credentialPublicKey, counter, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo

  await addCredentialToUser(username, {
    credentialID,
    credentialPublicKey,
    counter,
    credentialDeviceType,
    credentialBackedUp,
    transports: attestationResponse.response?.transports,
  })

  res.json({ verified: true })
})

// --- Login: the mobile /verify page calls these against the desktop's loginToken ---

webauthnRouter.get('/authenticate/options', async (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : ''
  const loginToken = token ? await getLoginToken(token) : null
  if (!loginToken) {
    res.status(400).json({ error: 'Invalid or expired login link' })
    return
  }

  const credentials = await getCredentials(loginToken.username)
  if (credentials.length === 0) {
    res.status(400).json({ error: 'No passkey enrolled for this account yet' })
    return
  }

  const options = await generateAuthenticationOptions({
    rpID: env.MFA_RP_ID,
    userVerification: 'required',
    allowCredentials: credentials.map((c) => ({
      id: c.credentialID,
      transports: c.transports,
    })),
  })

  await setLoginChallenge(token, options.challenge)
  res.json(options)
})

webauthnRouter.post('/authenticate/verify', async (req: Request, res: Response) => {
  const { token, assertionResponse } = (req.body ?? {}) as {
    token?: string
    assertionResponse?: AuthenticationResponseJSON
  }
  const loginToken = token ? await getLoginToken(token) : null
  if (!token || !loginToken) {
    res.status(400).json({ error: 'Invalid or expired login link' })
    return
  }
  if (!loginToken.challenge) {
    res.status(400).json({ error: 'Call /authenticate/options first' })
    return
  }

  const match = await findUserByCredentialId(assertionResponse?.id)
  if (!match || match.username !== loginToken.username) {
    res.status(400).json({ error: 'Unknown credential' })
    return
  }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: assertionResponse as AuthenticationResponseJSON,
      expectedChallenge: loginToken.challenge,
      expectedOrigin: env.mfaOrigins,
      expectedRPID: env.MFA_RP_ID,
      authenticator: {
        credentialID: match.credential.credentialID,
        credentialPublicKey: match.credential.credentialPublicKey,
        counter: match.credential.counter,
        transports: match.credential.transports,
      },
    })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
    return
  }

  if (!verification.verified) {
    res.status(400).json({ verified: false })
    return
  }

  await updateCredentialCounter(
    match.credential.credentialID,
    verification.authenticationInfo.newCounter,
  )

  await markLoginVerified(token)
  await notifyLoginVerified(token)

  res.json({ verified: true })
})
