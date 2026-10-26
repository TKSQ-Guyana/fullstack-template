import { describe, expect, it } from 'vitest'
import { maskEmail } from './mask.js'

describe('maskEmail', () => {
  it('masks the local part and keeps the domain', () => {
    expect(maskEmail('ada.admin@example.dev')).toBe('a••••••••@example.dev')
  })

  it('changes nothing about an address already masked', () => {
    expect(maskEmail(maskEmail('ada.admin@example.dev'))).toBe('a••••••••@example.dev')
  })

  it('blanks something that is not an address at all', () => {
    expect(maskEmail('no-at-sign')).toBe('••••••••••')
  })
})
