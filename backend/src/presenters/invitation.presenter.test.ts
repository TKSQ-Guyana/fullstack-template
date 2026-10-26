import { describe, expect, it } from 'vitest'
import type { InvitationRow } from '../repositories/invitations.repository.js'
import {
  invitationState,
  presentInvitations,
  presentIssuedInvitation,
  presentLinkCheck,
} from './invitation.presenter.js'

const NOW = new Date('2026-10-01T12:00:00Z')
const row = (over: Partial<InvitationRow>): InvitationRow => ({
  kc_user_id: 'u-1',
  username: 'ann',
  email: 'ann@example.dev',
  purpose: 'provision',
  created_by: 'admin',
  created_at: '2026-10-01T11:00:00.123456+00:00',
  expires_at: '2026-10-02T11:00:00.123456+00:00',
  used_at: null,
  mailed: true,
  ...over,
})

describe('invitationState', () => {
  it('spent beats expired beats unsent', () => {
    expect(
      invitationState(
        row({ used_at: '2026-10-01T11:30:00+00:00', expires_at: '2026-09-01T00:00:00+00:00' }),
        NOW,
      ),
    ).toBe('set')
    expect(
      invitationState(row({ expires_at: '2026-10-01T12:00:00+00:00', mailed: false }), NOW),
    ).toBe('expired')
    expect(invitationState(row({ mailed: false }), NOW)).toBe('not_sent')
    expect(invitationState(row({}), NOW)).toBe('invited')
  })
})

describe('invitation presenters', () => {
  it('shapes the register rows in camelCase with the derived state', () => {
    expect(presentInvitations([row({})], NOW)).toEqual({
      invitations: [
        {
          kcUserId: 'u-1',
          username: 'ann',
          email: 'ann@example.dev',
          purpose: 'provision',
          createdBy: 'admin',
          createdAt: '2026-10-01T11:00:00.123456+00:00',
          expiresAt: '2026-10-02T11:00:00.123456+00:00',
          usedAt: null,
          mailed: true,
          state: 'invited',
        },
      ],
    })
  })

  it('answers the link check with the username and an ISO expiry, never the mailbox', () => {
    expect(
      presentLinkCheck({ username: 'ann', expires_at: '2026-10-02T11:00:00.123456+00:00' }),
    ).toEqual({ valid: true, username: 'ann', expiresAt: '2026-10-02T11:00:00.123Z' })
  })

  it('answers an issued invitation without the token', () => {
    const body = presentIssuedInvitation({
      mailed: false,
      reason: 'mail not configured',
      maskedTo: 'a••@example.dev',
      expiresAt: new Date('2026-10-04T12:00:00Z'),
      mailConfigured: false,
    })
    expect(body).toEqual({
      mailed: false,
      reason: 'mail not configured',
      maskedTo: 'a••@example.dev',
      expiresAt: '2026-10-04T12:00:00.000Z',
      mailConfigured: false,
    })
  })
})
