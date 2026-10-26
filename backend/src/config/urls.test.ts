import { describe, expect, it } from 'vitest'
import { urlWithoutPassword } from './urls.js'

describe('urlWithoutPassword', () => {
  it('masks the password of a Redis with AUTH', () => {
    expect(urlWithoutPassword('redis://:s3cret@redis.app.svc:6379/0')).toBe(
      'redis://:***@redis.app.svc:6379/0',
    )
  })

  it('keeps an ACL user and masks only the password', () => {
    expect(urlWithoutPassword('rediss://app:s3cret@cache.example:6380')).toBe(
      'rediss://app:***@cache.example:6380',
    )
  })

  it('leaves a credential-less URL as it is', () => {
    expect(urlWithoutPassword('redis://redis:6379')).toBe('redis://redis:6379')
  })

  it('answers empty for empty', () => {
    expect(urlWithoutPassword('')).toBe('')
  })

  it('never echoes a string it cannot parse', () => {
    expect(urlWithoutPassword('not a url :s3cret@')).toBe('[unparseable URL]')
  })
})
