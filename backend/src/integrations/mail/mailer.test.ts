import { describe, expect, it } from 'vitest'
import { deliveryPolicy, looksLikeEmail, maskEmail, sendMail } from './mailer.js'

describe('the delivery wall', () => {
  it('is CLOSED by default — no redirect, no allowlist', () => {
    expect(deliveryPolicy().mode).toBe('closed')
  })

  it('refuses to send when mail is not configured, without throwing', async () => {
    const result = await sendMail({ to: 'someone@example.dev', subject: 'x', text: 'x' })
    expect(result.sent).toBe(false)
    expect(result.reason).toBe('mail not configured')
  })
})

describe('address helpers', () => {
  it('masks the local part and keeps the domain', () => {
    expect(maskEmail('ada.admin@example.dev')).toBe('a••••••••@example.dev')
  })

  it('validates shapes permissively', () => {
    expect(looksLikeEmail('a@b.co')).toBe(true)
    expect(looksLikeEmail('not-an-address')).toBe(false)
    expect(looksLikeEmail('')).toBe(false)
  })
})
