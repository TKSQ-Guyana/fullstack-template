// Outbound SMS, through the SMS Gateway for Android (api.sms-gate.app) or any
// compatible gateway.
//
// One caller today: the MFA approval link, texted to the number on the user's
// account so the ordinary sign-in never shows a usable link on the desktop
// (src/mfa/loginRoutes.ts).
//
// THIS MUST NEVER FAIL A SIGN-IN. The gateway can be slow, offline or out of
// credit, and none of that is a reason to refuse a login the password and the
// passkey would otherwise allow. Every path here returns a result object —
// nothing throws past this module — and the caller degrades to the on-screen
// copy link.
//
// The API is documented at https://docs.sms-gate.app: POST the message, get
// 202 Accepted with an id and a per-recipient state. Delivery is asynchronous
// and 202 means QUEUED, not delivered — so a true result here says "handed to
// the gateway", which is all this module can honestly claim.
import { env } from '../config/env.js'
import { logger } from '../logger.js'

export interface SmsResult {
  /** The gateway accepted the message for delivery (HTTP 202). */
  sent: boolean
  /** The gateway's message id, when it gave one — useful for support. */
  messageId?: string
  /** Why not, for the log. Never surfaced to the browser verbatim. */
  reason?: string
}

/** Is outbound SMS configured at all? */
export const smsConfigured = (): boolean =>
  env.SMS_ENABLED && !!env.SMS_API_URL && !!env.SMS_USERNAME && !!env.SMS_PASSWORD

/**
 * `+5927126852` -> `+592••••852`. Logs and API responses carry this, never the
 * whole number: the log is aggregated and the response reaches a browser, and
 * neither needs to be able to read back anybody's mobile number.
 */
export function maskNumber(phoneNumber: string): string {
  const trimmed = phoneNumber.trim()
  if (trimmed.length <= 7) return '•'.repeat(trimmed.length)
  return `${trimmed.slice(0, 4)}${'•'.repeat(Math.max(0, trimmed.length - 7))}${trimmed.slice(-3)}`
}

/**
 * E.164 as the gateway wants it: a leading + and digits only. Returns null for
 * anything that cannot be one, so a malformed attribute in the realm becomes a
 * silent fallback to the copy link rather than a 400 from the gateway.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^\d+]/g, '')
  const digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned
  if (!/^\d{8,15}$/.test(digits)) return null
  return `+${digits}`
}

/**
 * Hand one message to the gateway.
 *
 * The timeout is the point of the AbortController: without it a wedged gateway
 * holds the sign-in request open until the platform's own timeout, and the
 * user sits on a spinner for a message that was never going to arrive.
 */
export async function sendSms(phoneNumbers: string[], text: string): Promise<SmsResult> {
  if (!smsConfigured()) return { sent: false, reason: 'sms not configured' }
  if (phoneNumbers.length === 0) return { sent: false, reason: 'no recipients' }

  const auth = Buffer.from(`${env.SMS_USERNAME}:${env.SMS_PASSWORD}`).toString('base64')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), env.SMS_TIMEOUT_MS)

  try {
    const res = await fetch(env.SMS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ textMessage: { text }, phoneNumbers }),
      signal: controller.signal,
    })

    // 202 is the documented success; accept the 2xx family so a gateway
    // upgrade answering 200 does not read as a failure.
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      logger.warn(
        { status: res.status, to: phoneNumbers.map(maskNumber), body: body.slice(0, 300) },
        'sms gateway refused the message',
      )
      return { sent: false, reason: `gateway returned ${res.status}` }
    }

    const body = (await res.json().catch(() => null)) as { id?: string } | null
    logger.info(
      { messageId: body?.id, to: phoneNumbers.map(maskNumber) },
      'sms handed to the gateway',
    )
    return { sent: true, messageId: body?.id }
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError'
    logger.warn(
      { err: (err as Error).message, to: phoneNumbers.map(maskNumber) },
      aborted ? 'sms gateway timed out' : 'sms gateway unreachable',
    )
    return { sent: false, reason: aborted ? 'gateway timed out' : 'gateway unreachable' }
  } finally {
    clearTimeout(timer)
  }
}
