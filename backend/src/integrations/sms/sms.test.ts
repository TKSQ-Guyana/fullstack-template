import { describe, expect, it } from 'vitest'
import { maskNumber, toE164 } from './sms.js'

describe('sms helpers', () => {
  it('normalises to E.164 or answers null', () => {
    expect(toE164('+592 712-6852')).toBe('+5927126852')
    expect(toE164('5927126852')).toBe('+5927126852')
    expect(toE164('12')).toBeNull()
    expect(toE164(null)).toBeNull()
  })

  it('masks numbers for logs', () => {
    expect(maskNumber('+5927126852')).toBe('+592••••852')
  })
})
