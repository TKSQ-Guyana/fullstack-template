// Password-invitation presenters — the Users screen's Password column (every
// account's latest invitation), the set-password page's link check, and the
// administrator's answer when a link is issued.
import type { InvitationRow } from '../repositories/invitations.repository.js'
import { ts, type Json } from './json.js'

export type InvitationState = 'set' | 'expired' | 'not_sent' | 'invited'

/**
 * Whether a link still works, derived HERE so the browser cannot disagree
 * with the server about it: spent beats expired beats unsent.
 */
export function invitationState(r: InvitationRow, now: Date = new Date()): InvitationState {
  if (r.used_at !== null) return 'set'
  if (Date.parse(r.expires_at) <= now.getTime()) return 'expired'
  if (!r.mailed) return 'not_sent'
  return 'invited'
}

/** GET /accounts/password-invitations. */
export function presentInvitations(rows: InvitationRow[], now: Date = new Date()): Json {
  return {
    invitations: rows.map((r) => ({
      kcUserId: r.kc_user_id,
      username: r.username,
      email: r.email,
      purpose: r.purpose,
      createdBy: r.created_by,
      createdAt: ts(r.created_at),
      expiresAt: ts(r.expires_at),
      usedAt: ts(r.used_at),
      mailed: r.mailed,
      state: invitationState(r, now),
    })),
  }
}

/**
 * GET /password-setup/:token for a live link: the username the page names and
 * when the link lapses. Never the mailbox — the page is public, and anything
 * it returns is readable by whoever holds the URL.
 */
export function presentLinkCheck(invitation: { username: string; expires_at: string }): Json {
  return {
    valid: true,
    username: invitation.username,
    expiresAt: new Date(invitation.expires_at).toISOString(),
  }
}

/**
 * POST /accounts/:kcUserId/password-email. THE TOKEN IS NOT HERE: it would let
 * an administrator open somebody else's link — and having created the
 * account, sign in as them. The one way to the link is the mailbox on the
 * account.
 */
export function presentIssuedInvitation(outcome: {
  mailed: boolean
  reason: string | null
  maskedTo: string
  expiresAt: Date
  mailConfigured: boolean
}): Json {
  return {
    mailed: outcome.mailed,
    reason: outcome.reason,
    maskedTo: outcome.maskedTo,
    expiresAt: outcome.expiresAt.toISOString(),
    mailConfigured: outcome.mailConfigured,
  }
}
