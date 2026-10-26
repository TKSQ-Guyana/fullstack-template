import { describe, expect, it } from 'vitest'
import { date, jsonbTimestamp, num, ts } from './json.js'

describe('json value helpers', () => {
  it('turns numeric text into numbers and keeps null', () => {
    expect(num('12.50')).toBe(12.5)
    expect(num(3)).toBe(3)
    expect(num(null)).toBeNull()
  })

  it('prints timestamps in jsonb form', () => {
    expect(jsonbTimestamp('2026-09-23 07:08:50.936571+00')).toBe('2026-09-23T07:08:50.936571+00:00')
    expect(jsonbTimestamp('2026-09-23T07:08:50.000Z')).toBe('2026-09-23T07:08:50.000+00:00')
    expect(ts(new Date('2026-09-23T07:08:50.000Z'))).toBe('2026-09-23T07:08:50.000+00:00')
    expect(ts('2026-09-23T07:08:50.1+00:00')).toBe('2026-09-23T07:08:50.1+00:00')
    expect(ts(null)).toBeNull()
  })

  it('prints dates as YYYY-MM-DD', () => {
    expect(date('2026-09-23')).toBe('2026-09-23')
    expect(date(new Date('2026-09-23T10:00:00Z'))).toBe('2026-09-23')
    expect(date(undefined)).toBeNull()
  })
})
