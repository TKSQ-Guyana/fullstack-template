// The set-password invitation's wording and layout.
//
// The invitation is the app's OWN message — provisioning issues no password,
// so this is the one way into a new account. Apps with a specified
// notification catalogue (a BA's email templates) should render those from
// Handlebars files in src/templates/email/runtime/ instead of writing them
// out in TypeScript here; this file is for messages the app owns outright.
//
// EVERY MESSAGE IS TEXT AND HTML, and the text part is not a courtesy: a
// message with only an HTML part scores as spam with most filters and reads as
// blank in a text client. Both parts carry the same information, and the link
// appears as a full URL in the text part so it survives a client that strips
// markup.
//
// HTML FOR EMAIL, NOT FOR A BROWSER. Everything is inline styles on tables and
// divs, no stylesheet, no custom fonts, no media queries: Outlook renders a
// subset of CSS from 1999 and Gmail strips <style> in some clients. Colours
// are literal hex, deliberately — there is no theme to read here, and a mail
// client in dark mode inverts what it likes regardless of what we ask for.
import { env } from '../config/env.js'

const INK = '#131C2E'
const MUTED = '#5A6472'
const BRAND = '#0F6E64'
const RULE = '#E2E7EB'

export interface RenderedMail {
  subject: string
  text: string
  html: string
}

/** HTML-escape. Names and usernames come from a realm somebody else administers. */
const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The shell every message sits in: a rule, the app's name, the body, and a
 * footer saying where the message came from.
 *
 * 600px, centred, on a white card — the width every mail client has agreed on
 * for twenty years.
 */
function layout(bodyHtml: string): string {
  return [
    `<div style="margin:0;padding:24px 12px;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid ${RULE};border-radius:6px;">`,
    `<tr><td style="padding:24px 28px 18px;border-bottom:2px solid ${BRAND};">`,
    `<div style="font-size:13px;line-height:1.4;font-weight:700;color:${INK};">${esc(env.APP_NAME)}</div>`,
    `</td></tr>`,
    `<tr><td style="padding:26px 28px 28px;font-size:15px;line-height:1.6;color:${INK};">`,
    bodyHtml,
    `</td></tr>`,
    `<tr><td style="padding:16px 28px 20px;border-top:1px solid ${RULE};font-size:12px;line-height:1.5;color:${MUTED};">`,
    `This message was sent automatically by ${esc(env.APP_NAME)}. Please do not reply to it.`,
    `</td></tr>`,
    `</table></div>`,
  ].join('')
}

/** A button that is also a link, because half of email cannot render a button. */
function action(href: string, label: string): string {
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;"><tr>`,
    `<td style="background:${BRAND};border-radius:6px;">`,
    `<a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">${esc(label)}</a>`,
    `</td></tr></table>`,
    `<p style="margin:0 0 4px;font-size:12px;color:${MUTED};">If the button does not work, paste this into your browser:</p>`,
    `<p style="margin:0;font-size:12px;word-break:break-all;"><a href="${esc(href)}" style="color:${BRAND};">${esc(href)}</a></p>`,
  ].join('')
}

/** `/set-password?token=…` on the origin the RECIPIENT can reach (APP_PUBLIC_URL). */
export const passwordSetupLink = (token: string): string =>
  `${env.appPublicUrl}/set-password?token=${encodeURIComponent(token)}`

/**
 * The invitation.
 *
 * IT NAMES THE USERNAME, because the recipient has to type it at sign-in — an
 * invitation that sets a password without saying which account it belongs to
 * leaves somebody guessing.
 *
 * IT DOES NOT SAY WHO SENT IT. The administrator's name would be friendlier
 * and is also the sentence a phishing message copies most easily; "your
 * administrator" is what the recipient can verify by asking around.
 */
export function invitationMail(input: {
  firstName: string
  username: string
  token: string
  expiresAt: Date
  purpose: 'provision' | 'reset'
}): RenderedMail {
  const link = passwordSetupLink(input.token)
  const hours = Math.max(1, Math.round((input.expiresAt.getTime() - Date.now()) / 3600_000))
  const greeting = input.firstName ? `Hello ${input.firstName},` : 'Hello,'

  const opening =
    input.purpose === 'reset'
      ? `A new password has been requested for your ${env.APP_NAME} account.`
      : `An account has been created for you on ${env.APP_NAME}.`

  const subject =
    input.purpose === 'reset'
      ? `Set a new password for ${env.APP_NAME}`
      : `Set your password for ${env.APP_NAME}`

  const text = [
    greeting,
    '',
    opening,
    '',
    `Your sign-in name is: ${input.username}`,
    '',
    'Choose your password using the link below. It can be used once and expires',
    `in ${hours} hours. Until it is used, the account cannot sign in.`,
    '',
    link,
    '',
    'If you were not expecting this, tell your IT administrator — do not use the link.',
    '',
    '—',
    env.APP_NAME,
    'This message was sent automatically. Please do not reply to it.',
  ].join('\n')

  const html = layout(
    [
      `<p style="margin:0 0 14px;">${esc(greeting)}</p>`,
      `<p style="margin:0 0 14px;">${esc(opening)}</p>`,
      `<p style="margin:0 0 6px;">Your sign-in name is:</p>`,
      `<p style="margin:0 0 16px;font-size:19px;font-weight:700;letter-spacing:.04em;color:${INK};">${esc(input.username)}</p>`,
      `<p style="margin:0;">Choose your password using the button below. It can be used <b>once</b> and expires in <b>${hours} hours</b>. Until it is used, the account cannot sign in.</p>`,
      action(link, 'Set your password'),
      `<p style="margin:18px 0 0;font-size:13px;color:${MUTED};">If you were not expecting this, tell your IT administrator and do not use the link.</p>`,
    ].join(''),
  )

  return { subject, text, html }
}
