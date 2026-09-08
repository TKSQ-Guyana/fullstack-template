// Outbound email, over SMTP.
//
// RULES THIS MODULE KEEPS:
//
//   * NOTHING THROWS PAST THIS MODULE. Every path returns a result object.
//     A relay that is down, slow, out of credit or misconfigured must never
//     fail the act that triggered the mail — provisioning still creates the
//     account — and the caller says plainly that the message did not go
//     rather than reporting a failure that did not happen.
//   * AN ABORT TIMEOUT, because the invitation is sent inline with the
//     administrator's click. Without one a wedged relay holds the request
//     open until the platform's own timeout. nodemailer takes three socket
//     timeouts rather than an AbortSignal, so the budget is spent across
//     connect / greeting / socket instead of on one clock.
//   * ADDRESSES ARE MASKED IN LOGS. The log is aggregated; it does not need
//     to be able to read back anybody's email address.
//
// ONE TRANSPORT, REUSED. nodemailer pools connections, and building a
// transport per message means a fresh TLS handshake and a fresh AUTH for
// every message — which is exactly the pattern relays rate-limit.
//
// GMAIL NOTES, for stacks pointed at it: port 587 with STARTTLS
// (SMTP_SECURE=false), an app password rather than the account password, and
// a From that Gmail REWRITES to the authenticated mailbox — the display name
// is the only part of MAIL_FROM it honours. It also caps a free account near
// 500 recipients a day. Deployment should point at the organisation's own
// relay; that is one env change and no code.
import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../config/env.js'
import { logger } from '../logger.js'

export interface MailResult {
  /** The relay accepted the message for delivery. */
  sent: boolean
  /** The relay's message id, when it gave one — useful for support. */
  messageId?: string
  /** Why not, for the log. Never surfaced to the browser verbatim. */
  reason?: string
}

export interface MailMessage {
  to: string | string[]
  /** Carbon copies. Undeliverable entries are dropped; an empty result sends
   *  with no CC header at all. */
  cc?: string[]
  subject: string
  /** Always required. A text/plain part is not a courtesy — a message with
   *  only an HTML part scores as spam and reads as blank in a text client. */
  text: string
  html?: string
}

/** Is outbound email configured at all? */
export const mailConfigured = (): boolean => env.MAIL_ENABLED && !!env.SMTP_HOST && !!env.mailFrom

/**
 * `ada.admin@example.dev` -> `a•••••••••@example.dev`. The domain stays
 * because it is the part that helps when somebody asks why their mail did not
 * arrive; the local part does not.
 */
export function maskEmail(address: string): string {
  const trimmed = address.trim()
  const at = trimmed.lastIndexOf('@')
  if (at < 1) return '•'.repeat(Math.max(trimmed.length, 1))
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at)
  return `${local[0]}${'•'.repeat(Math.max(local.length - 1, 1))}${domain}`
}

/** Deliberately permissive — an address the relay accepts is not this app's
 *  to define. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const looksLikeEmail = (value: string | null | undefined): boolean =>
  !!value && EMAIL_SHAPE.test(value.trim())

/**
 * The one field this module reads off a successful send.
 *
 * NAMED LOCALLY rather than imported: a bare `Transporter` defaults its result
 * type to `any`, and the deep import that would narrow it
 * (nodemailer/lib/smtp-pool) is a CommonJS `export =` shape this ESM build
 * cannot type cleanly. Declaring what we use is both narrower and honest.
 */
interface SentInfo {
  messageId: string
}

let transport: Transporter<SentInfo> | null = null

function getTransport(): Transporter<SentInfo> {
  if (transport) return transport
  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    // requireTLS matters on the non-secure path: without it a relay that does
    // not advertise STARTTLS would be talked to in the clear, and the app
    // password would cross the wire unencrypted. Refusing to send is the
    // right answer there. The one exception is SMTP_ALLOW_PLAINTEXT — the dev
    // stack's Mailpit sink, credential-less and network-internal (env.ts).
    requireTLS: !env.SMTP_SECURE && !env.SMTP_ALLOW_PLAINTEXT,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    // The timeout budget, spent across the three phases a wedged relay can
    // stall in. Together they bound one send by roughly MAIL_TIMEOUT_MS.
    connectionTimeout: env.MAIL_TIMEOUT_MS,
    greetingTimeout: env.MAIL_TIMEOUT_MS,
    socketTimeout: env.MAIL_TIMEOUT_MS,
    pool: true,
    maxConnections: 2,
    // A relay's per-connection message cap is lower than its per-day one;
    // capping here makes the pool recycle rather than get throttled.
    maxMessages: 50,
  })
  return transport
}

/**
 * THE DELIVERY POLICY — the wall between test environments and real mailboxes.
 *
 * The addresses a live directory resolves are REAL people, so a test
 * environment pointed at a working relay would mail them the moment somebody
 * exercises a flow — which is why delivery is CLOSED BY DEFAULT and every
 * environment states its policy out loud:
 *
 *   MAIL_REDIRECT_TO=qa-inbox@…   every message goes ONLY there (the original
 *                                 To/Cc ride along as X-Original-* headers) —
 *                                 the QA/UAT mode: testers read everything in
 *                                 one mailbox, nobody real is mailed.
 *   MAIL_RECIPIENT_ALLOWLIST      otherwise, only matching recipients are
 *                                 delivered: `@domain` (suffix), a full
 *                                 address, or `*` for open delivery
 *                                 (production — and the dev stack, whose
 *                                 "relay" is the Mailpit sink).
 *   neither set                   every recipient is refused, loudly. A relay
 *                                 credential alone never opens delivery.
 */
const policyEntries = (): string[] =>
  env.MAIL_RECIPIENT_ALLOWLIST.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

const allowedByPolicy = (address: string): boolean =>
  policyEntries().some(
    (entry) =>
      entry === '*' ||
      (entry.startsWith('@')
        ? address.toLowerCase().endsWith(entry)
        : address.toLowerCase() === entry),
  )

/** One line at boot saying which wall is up — see verifyMailer. */
export function deliveryPolicy(): { mode: 'redirect' | 'allowlist' | 'closed'; detail: string } {
  if (env.MAIL_REDIRECT_TO) return { mode: 'redirect', detail: env.MAIL_REDIRECT_TO }
  const entries = policyEntries()
  if (entries.length > 0) return { mode: 'allowlist', detail: entries.join(',') }
  return { mode: 'closed', detail: 'set MAIL_REDIRECT_TO or MAIL_RECIPIENT_ALLOWLIST' }
}

/**
 * Hand one message to the relay.
 *
 * A `true` result means the relay ACCEPTED it, which is all this module can
 * honestly claim — a bounce arrives later and lands in the sending mailbox,
 * not here.
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  let recipients = (Array.isArray(message.to) ? message.to : [message.to])
    .map((a) => a.trim())
    .filter((a) => looksLikeEmail(a))
  // CC never rescues a message with nobody in To — the check below stays on
  // the recipients alone, and a CC-only message is a bug upstream.
  let copies = (message.cc ?? []).map((a) => a.trim()).filter((a) => looksLikeEmail(a))

  if (!mailConfigured()) return { sent: false, reason: 'mail not configured' }
  if (recipients.length === 0) return { sent: false, reason: 'no deliverable recipients' }

  // The delivery policy, applied AFTER the shape checks so the reasons stay
  // distinct: "nothing deliverable" is a data problem, what follows is policy.
  const headers: Record<string, string> = {}
  if (env.MAIL_REDIRECT_TO) {
    // The redirected message says who it WOULD have gone to — that is the
    // whole point of reading a QA inbox.
    headers['X-Original-To'] = recipients.join(', ')
    if (copies.length > 0) headers['X-Original-Cc'] = copies.join(', ')
    recipients = [env.MAIL_REDIRECT_TO]
    copies = []
  } else {
    const droppedTo = recipients.filter((a) => !allowedByPolicy(a))
    const droppedCc = copies.filter((a) => !allowedByPolicy(a))
    recipients = recipients.filter(allowedByPolicy)
    copies = copies.filter(allowedByPolicy)
    if (droppedTo.length > 0 || droppedCc.length > 0) {
      logger.warn(
        {
          droppedTo: droppedTo.map(maskEmail),
          droppedCc: droppedCc.map(maskEmail),
          policy: deliveryPolicy(),
        },
        'recipients outside the delivery policy were dropped — this environment does not mail them',
      )
    }
    if (recipients.length === 0) {
      return { sent: false, reason: 'delivery policy blocked every recipient' }
    }
  }

  const masked = recipients.map(maskEmail)
  const maskedCc = copies.map(maskEmail)

  try {
    const info = await getTransport().sendMail({
      from: env.mailFrom,
      ...(env.MAIL_REPLY_TO ? { replyTo: env.MAIL_REPLY_TO } : {}),
      to: recipients,
      ...(copies.length > 0 ? { cc: copies } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    })
    logger.info(
      { messageId: info.messageId, to: masked, ...(maskedCc.length ? { cc: maskedCc } : {}) },
      'mail handed to the relay',
    )
    return { sent: true, messageId: info.messageId }
  } catch (err) {
    // nodemailer's errors carry a `code` (EAUTH, ECONNECTION, ETIMEDOUT,
    // EENVELOPE) that says which of the four things went wrong, and it is
    // worth far more in a log than the message text.
    const code = (err as { code?: string }).code
    logger.warn({ err: (err as Error).message, code, to: masked }, 'mail relay refused the message')
    return { sent: false, reason: code ? `relay error ${code}` : 'relay unreachable' }
  }
}

/**
 * Prove the relay works, without sending anything.
 *
 * Called once at boot so a bad credential or an unreachable host is a line in
 * the startup log rather than a surprise the first time somebody provisions an
 * account. Never throws, and never blocks the boot: an unverified relay is
 * still tried on the first real message.
 */
export async function verifyMailer(): Promise<boolean> {
  if (!mailConfigured()) {
    logger.info('mail disabled (MAIL_ENABLED=false, or no SMTP_HOST / sender)')
    return false
  }
  try {
    await getTransport().verify()
    // The SENDER IS NOT MASKED, unlike recipients. It is the app's own service
    // identity, it rides the headers of every message anyway, and "which
    // mailbox is this sending from" is exactly the question this line answers.
    logger.info(
      { host: env.SMTP_HOST, port: env.SMTP_PORT, from: env.mailFrom, policy: deliveryPolicy() },
      'mail relay ready',
    )
    if (deliveryPolicy().mode === 'closed') {
      // A working relay and a closed policy is a configured environment that
      // will refuse every send — almost certainly someone forgot the policy,
      // and the first symptom would otherwise be a mail that quietly never came.
      logger.warn(
        'mail is enabled but delivery is CLOSED — every recipient will be refused until MAIL_REDIRECT_TO or MAIL_RECIPIENT_ALLOWLIST says who this environment may mail',
      )
    }
    return true
  } catch (err) {
    const code = (err as { code?: string }).code
    logger.warn(
      { err: (err as Error).message, code, host: env.SMTP_HOST, port: env.SMTP_PORT },
      'mail relay did not verify — messages will still be attempted',
    )
    return false
  }
}

/** Close the pool on shutdown, so in-flight sends finish and sockets close. */
export function closeMailer(): void {
  transport?.close()
  transport = null
}
