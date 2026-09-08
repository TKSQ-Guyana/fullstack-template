// Keeping the approval off the device that is signing in.
//
// A second factor is only a second factor if approving it needs something the
// password does not. Open the approval link in the same browser that just
// typed the password and the two collapse into one, so this module refuses
// that — and says plainly which refusals are real and which are guardrails.
//
// WHAT ACTUALLY PROTECTS, in order of strength:
//
//   1. THE PASSKEY ITSELF (cryptographic, not in this file). The ceremony
//      needs a credential registered for that user, resident on the
//      authenticator being used. A device holding no enrolled passkey cannot
//      complete the approval however it opened the link. This is the real
//      boundary, and it is why texting the link is safe: the link is a
//      POINTER TO A CEREMONY, not a bearer credential.
//
//   2. THE SAME-BROWSER REFUSAL (server-enforced, in this file). The browser
//      that ran the password grant is marked with a cookie at /auth/login;
//      /verify refuses any request that presents it. It cannot be spoofed
//      from the page — the cookie is HttpOnly and the check happens before a
//      byte of the approval UI is served. It is defeatable by someone who
//      clears their own cookies, which is worth stating: it stops the flow
//      being casually defeated, and layer 1 is what stops an attacker.
//
//   3. THE DESKTOP REFUSAL (advisory, in this file). Client hints and the
//      User-Agent, both of which the person holding the browser may lie
//      about. It prevents the honest mistake — "I'll just open it here" —
//      and makes the intent explicit in the product. It is NOT a security
//      control and must never be described as one.
//
// The root control sits earlier than any of these: if the laptop is allowed
// to ENROL as the second factor (Windows Hello is a platform authenticator
// too), the factor is collapsed permanently and no check here can recover it.
// So the same two guards run on /enroll as well as /verify.
import crypto from 'node:crypto'
import type { Request, Response } from 'express'
import { env } from '../config/env.js'
import { cookiesOf } from '../services/kcSession.js'

/**
 * Marks the browser that ran a password grant. Read only by this guard, so
 * HttpOnly; SameSite=Lax rather than Strict because it has to survive the one
 * navigation that matters — a link pasted into the address bar of that same
 * browser, which is exactly the case being refused.
 */
export const COOKIE_MFA_DEVICE = 'app_mfa_device'

/**
 * Long enough to outlive the sign-in it belongs to (the approval link itself
 * lives three minutes), short enough that a shared workstation does not carry
 * the mark all day.
 */
const DEVICE_COOKIE_MAX_AGE_MS = 20 * 60 * 1000

/** Stamp the current browser as one that has just authenticated with a password. */
export function markSignInDevice(req: Request, res: Response): void {
  res.cookie(COOKIE_MFA_DEVICE, crypto.randomBytes(9).toString('base64url'), {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.AUTH_COOKIE_SECURE || req.secure,
    path: '/',
    maxAge: DEVICE_COOKIE_MAX_AGE_MS,
  })
}

/** Drop the mark — the ceremony is over, or the session ended. */
export function clearSignInDevice(req: Request, res: Response): void {
  res.clearCookie(COOKIE_MFA_DEVICE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.AUTH_COOKIE_SECURE || req.secure,
    path: '/',
  })
}

/** Is this the browser that signed in? (No cookie-parser here — see cookiesOf.) */
export function isSignInDevice(req: Request): boolean {
  return (cookiesOf(req)[COOKIE_MFA_DEVICE] ?? '') !== ''
}

/**
 * What the request claims to run on. Three answers, because the honest state
 * of the art is three-valued: everything here is self-reported, so this
 * classifies claims, not hardware.
 *
 * Tier 1 — Chromium's low-entropy client hints, sent by default with no
 * Accept-CH negotiation. `Sec-CH-UA-Mobile: ?1` is a phone; **`?0` alone is
 * NOT a desktop** — Chrome on an Android TABLET sends `?0` too, so `?0` only
 * reads as desktop alongside a desktop `Sec-CH-UA-Platform`.
 *
 * Tier 2 — the User-Agent, for the hint-less browsers (Safari, Firefox):
 * phone/tablet markers first (iPad included — older iPadOS and "Request
 * Mobile Website" still say so), then desktop markers.
 *
 * Anything else is 'unknown', and the caller treats unknown as allowed: an
 * exotic phone browser is far more likely than a desktop that hides every
 * desktop marker, and refusing it locks a real person out of enrolment while
 * the passkey and the same-browser check still protect.
 */
export function readDevice(req: Request): 'non-desktop' | 'desktop' | 'unknown' {
  const mobileHint = req.get('sec-ch-ua-mobile')
  if (mobileHint === '?1') return 'non-desktop'
  const platform = (req.get('sec-ch-ua-platform') ?? '').replace(/"/g, '')
  if (mobileHint === '?0') {
    if (platform === 'Android') return 'non-desktop'
    if (['Windows', 'macOS', 'Linux', 'Chrome OS', 'Chromium OS'].includes(platform)) {
      return 'desktop'
    }
  }
  const ua = req.get('user-agent') ?? ''
  if (
    /Android|iPhone|iPad|iPod|Windows Phone|IEMobile|Opera Mini|Opera Mobi|Mobile|Tablet|Silk|KaiOS/i.test(
      ua,
    )
  ) {
    return 'non-desktop'
  }
  // "Macintosh" is also what iPadOS Safari says in its DEFAULT desktop-website
  // mode — indistinguishable from a Mac at the server, which is exactly what
  // the refusal page's touch self-rescue below exists for.
  if (/Windows NT|Macintosh|CrOS|X11.*Linux/i.test(ua)) return 'desktop'
  return 'unknown'
}

/**
 * The desktop refusal's self-rescue, served by the /mfa router as its own
 * file (helmet's `script-src 'self'` blocks inline scripts, so it cannot ride
 * inside the page). An iPad in Safari's default desktop mode presents a Mac
 * user-agent the server cannot see through — but the page can: a touch-FIRST
 * screen (multi-touch AND a coarse primary pointer, which passes tablets and
 * not touch-screen laptops) re-opens the URL with `touch=1` and the guard
 * takes its word. As spoofable as a User-Agent, and exactly as advisory.
 */
export const deviceCheckScript = `(function () {
  var touchFirst =
    (navigator.maxTouchPoints || 0) > 1 && matchMedia('(pointer: coarse)').matches
  var url = new URL(location.href)
  if (touchFirst && url.searchParams.get('touch') !== '1') {
    url.searchParams.set('touch', '1')
    location.replace(url.toString())
  }
})()
`

export type GuardVerdict = { allowed: true } | { allowed: false; reason: 'same-device' | 'desktop' }

/** The two checks, in the order that matters: the real one first. */
export function checkApprovalDevice(req: Request): GuardVerdict {
  if (isSignInDevice(req)) return { allowed: false, reason: 'same-device' }
  if (!env.MFA_REQUIRE_MOBILE) return { allowed: true }
  // The touch self-rescue's answer — only ever reaches here for the DESKTOP
  // refusal; the same-device refusal above is server-enforced and unaffected.
  if (req.query.touch === '1') return { allowed: true }
  if (readDevice(req) === 'desktop') return { allowed: false, reason: 'desktop' }
  return { allowed: true }
}

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )

/**
 * The refusal, as a page rather than a status code: whoever hits this is a
 * person holding a phone (or a laptop they should not be using), not an API
 * client, and a bare 403 would read as the app being broken.
 *
 * Self-contained — no asset from the MFA UI build, which may not even be
 * present — and it names what to do next rather than what went wrong.
 */
export function refusalPage(reason: 'same-device' | 'desktop'): string {
  const copy =
    reason === 'same-device'
      ? {
          title: 'Open this on your phone',
          body: 'This is the same browser you are signing in from, so approving here would not confirm anything the password has not already claimed. Open the link on the phone that holds your passkey.',
        }
      : {
          title: 'This link needs a phone',
          body: 'Approval uses the fingerprint or face unlock on your registered phone, so it cannot be completed on a computer. Open the link on that phone instead. On an iPad or tablet? It will continue by itself in a moment.',
        }

  // Only the desktop refusal gets the touch self-rescue: rescuing the
  // same-device refusal would defeat the one check that is server-enforced.
  const rescue = reason === 'desktop' ? '<script src="device-check.js"></script>' : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(copy.title)}</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    padding: 24px; background: #eef2f8; color: #131c2e;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.55;
  }
  main {
    max-width: 26rem; background: #fff; border: 1px solid #e4eaf2; border-radius: 16px;
    padding: 28px 24px;
    box-shadow: 0 6px 16px rgba(19, 28, 46, 0.08), 0 2px 6px rgba(19, 28, 46, 0.05);
  }
  h1 { margin: 0 0 12px; font-size: 20px; font-weight: 600; letter-spacing: -.03em; color: #131c2e; }
  p { margin: 0; font-size: 14px; color: #4e5d75; }
  .mark { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #1e7488; font-weight: 600; margin: 0 0 14px; }
</style>
</head>
<body>
  <main>
    <p class="mark">Security check</p>
    <h1>${escapeHtml(copy.title)}</h1>
    <p>${escapeHtml(copy.body)}</p>
  </main>
  ${rescue}
</body>
</html>`
}
