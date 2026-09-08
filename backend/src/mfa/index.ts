// The WebAuthn second factor, IN this backend. One process serves the app API
// and the whole MFA surface, so the stack needs no extra pod.
//
// Everything lives UNDER THE API BASE PATHS (`/app/v1/mfa/...`,
// `/api/v1/mfa/...`), riding the exact same door as the rest of the API. That
// is deliberate deployment strategy, not tidiness: an edge that routes the
// base path to this backend while its WAF 403s unknown root paths needs no
// extra rule for a base-pathed MFA surface.
//
//   <base>/mfa/login/*     the app's own challenge calls (frontend auth/mfa)
//   <base>/mfa/ws          the "approved" push — attached to the HTTP server
//                          in ../index.ts, upgrades bypass Express
//   <base>/mfa/webauthn/*  the ceremony API the phone-facing pages call
//                          (their build bakes VITE_API_URL=<primary base>/mfa)
//   <base>/mfa/enroll      those pages, when the built UI is present
//   <base>/mfa/verify      (vite `--base` prefixes their asset URLs to match)
//   <base>/mfa/mfa-assets/ the pages' hashed build output
//
// The UI comes from the mfa-ui workspace, built by this backend's Dockerfile
// into ./mfa-ui. In development the directory may not exist — mfa-ui's own
// vite serves the pages — so skipping it silently is the normal case.
import fs from 'node:fs'
import path from 'node:path'
import express, { type Router } from 'express'
import { env } from '../config/env.js'
import { logger } from '../logger.js'
import { checkApprovalDevice, deviceCheckScript, refusalPage } from './deviceGuard.js'
import { mfaLoginRouter } from './loginRoutes.js'
import { webauthnRouter } from './webauthnRoutes.js'

export { attachWebSocketServer, stopMfaListener } from './ws.js'

/**
 * The /mfa sub-router, mounted inside the API router BEFORE `authenticate`:
 * the ceremony runs before the app considers the sign-in finished, so no
 * session exists to demand. The one-time token in each request is the
 * credential.
 */
export function buildMfaRouter(): Router {
  const mfa = express.Router()
  mfa.use('/webauthn', webauthnRouter)
  mfa.use('/login', mfaLoginRouter)

  // The desktop refusal page's touch self-rescue (see deviceGuard.ts). Its
  // own route rather than an inline script — helmet's `script-src 'self'`
  // blocks inline — and registered unconditionally so the refusal page never
  // depends on the UI build being present.
  mfa.get('/device-check.js', (_req, res) => {
    res.type('application/javascript').send(deviceCheckScript)
  })

  const uiDir = path.resolve(env.MFA_UI_DIR)
  const uiIndex = path.join(uiDir, 'index.html')
  if (!fs.existsSync(uiIndex)) {
    logger.info({ uiDir }, 'MFA UI build not present — enroll/verify pages not served here')
    return mfa
  }

  // express.static serves <base>/mfa/mfa-assets/* (and the favicon); the two
  // page routes send the SPA's index. An explicit page list rather than a
  // catch-all, so the API's own 404s stay 404s.
  mfa.use(express.static(uiDir))
  for (const page of ['/enroll', '/verify']) {
    mfa.get(page, (req, res) => {
      // THE DEVICE GUARD RUNS BEFORE A BYTE OF THE CEREMONY UI IS SERVED, on
      // BOTH pages. /verify is the obvious one; /enroll matters more, because
      // a laptop allowed to register itself as the second factor collapses the
      // factor permanently for that account and no later check can recover it.
      // See ./deviceGuard.ts for which of the two refusals is real.
      const verdict = checkApprovalDevice(req)
      if (!verdict.allowed) {
        logger.info({ page, reason: verdict.reason }, 'mfa: refused the ceremony on this device')
        res.status(403).type('html').send(refusalPage(verdict.reason))
        return
      }
      res.sendFile(uiIndex)
    })
  }
  logger.info({ uiDir }, 'MFA UI mounted at <base>/mfa/enroll and <base>/mfa/verify')
  return mfa
}
