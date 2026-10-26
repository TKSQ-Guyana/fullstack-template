import { describe, expect, it } from 'vitest'
import { pino } from 'pino'
import { httpSerializers, logRedaction, sanitizeUrl } from './logger.js'

describe('sanitizeUrl — what a logged URL may carry', () => {
  it('redacts a secret query parameter, whatever its case or encoding', () => {
    expect(sanitizeUrl('/api/v1/mfa/verify?token=abc')).toBe('/api/v1/mfa/verify?token=[redacted]')
    expect(sanitizeUrl('/x?TOKEN=abc&view=all')).toBe('/x?TOKEN=[redacted]&view=all')
    expect(sanitizeUrl('/x?to%6Ben=abc')).toBe('/x?to%6Ben=[redacted]')
    expect(sanitizeUrl('/x?token=a&token=b')).toBe('/x?token=[redacted]&token=[redacted]')
  })

  it('redacts the segment after a secret path prefix, without regard to case', () => {
    expect(sanitizeUrl('/api/v1/mfa/login/status/abc123?x=1')).toBe(
      '/api/v1/mfa/login/status/[redacted]?x=1',
    )
    expect(sanitizeUrl('/API/V1/MFA/Login/Status/abc123')).toBe(
      '/API/V1/MFA/Login/Status/[redacted]',
    )
    expect(sanitizeUrl('/app/v1/password-setup/zkew7mTd6UZV6Tk')).toBe(
      '/app/v1/password-setup/[redacted]',
    )
    expect(sanitizeUrl('/api/v1/PASSWORD-SETUP/abc123/x')).toBe(
      '/api/v1/PASSWORD-SETUP/[redacted]/x',
    )
  })

  it('leaves a prefix with nothing after it alone', () => {
    expect(sanitizeUrl('/api/v1/password-setup')).toBe('/api/v1/password-setup')
    expect(sanitizeUrl('/api/v1/password-setup/')).toBe('/api/v1/password-setup/')
  })

  it("redacts a search box's text but keeps the rest of the query", () => {
    expect(sanitizeUrl('/api/v1/notes?q=Jane%20Doe&limit=20')).toBe(
      '/api/v1/notes?q=[redacted]&limit=20',
    )
  })

  it('takes a whole URL — a referer — as well as a path', () => {
    expect(sanitizeUrl('https://app.example.dev/set-password/abc?token=abc')).toBe(
      'https://app.example.dev/set-password/abc?token=[redacted]',
    )
    expect(sanitizeUrl('https://h/app/v1/mfa/verify?token=abc&u=1')).toBe(
      'https://h/app/v1/mfa/verify?token=[redacted]&u=1',
    )
  })

  it('leaves an ordinary URL exactly as it arrived', () => {
    expect(sanitizeUrl('/api/v1/notes?limit=20&offset=40')).toBe('/api/v1/notes?limit=20&offset=40')
    expect(sanitizeUrl('https://h/admin/users')).toBe('https://h/admin/users')
  })

  it('answers empty for nothing, or for anything that is not a string', () => {
    expect(sanitizeUrl('')).toBe('')
    expect(sanitizeUrl(undefined)).toBe('')
    expect(sanitizeUrl(['/mfa/verify?token=abc'])).toBe('')
  })
})

describe('httpSerializers — the request and response a log line describes', () => {
  const serialise = (headers: Record<string, unknown>) =>
    httpSerializers.req({ id: 1, method: 'GET', url: '/api/v1/auth/session', headers }).headers

  it('never carries the session headers', () => {
    expect(
      serialise({
        cookie: 'app_access=eyJ; app_refresh=eyJ',
        authorization: 'Bearer eyJ',
        'proxy-authorization': 'Basic Zm9v',
        'x-forwarded-for': '1.2.3.4',
      }),
    ).toEqual({ 'x-forwarded-for': '1.2.3.4' })
  })

  it("sanitises the referer: a page opened from a link carries the link's token", () => {
    expect(serialise({ referer: 'https://h/app/v1/mfa/verify?token=zkew7mTd6UZV6Tk' })).toEqual({
      referer: 'https://h/app/v1/mfa/verify?token=[redacted]',
    })
    expect(serialise({ referer: 'https://h/app/v1/password-setup/abc' })).toEqual({
      referer: 'https://h/app/v1/password-setup/[redacted]',
    })
  })

  it('keeps an ordinary referer, and adds none when there was none', () => {
    expect(serialise({ referer: 'https://h/notes' })).toEqual({ referer: 'https://h/notes' })
    expect(serialise({ 'user-agent': 'ua' })).toEqual({ 'user-agent': 'ua' })
  })

  it('does not log a referer that is not a string', () => {
    expect(serialise({ referer: ['https://h/mfa/verify?token=abc'] })).toEqual({
      referer: '[redacted]',
    })
  })

  it('sanitises the URL itself and drops params and query', () => {
    const line = httpSerializers.req({
      method: 'GET',
      url: '/api/v1/mfa/login/status/abc',
      params: { token: 'abc' },
      query: { token: 'abc' },
    })
    expect(line.url).toBe('/api/v1/mfa/login/status/[redacted]')
    expect(line).not.toHaveProperty('params')
    expect(line).not.toHaveProperty('query')
  })

  it('never carries the cookies a response mints', () => {
    expect(
      httpSerializers.res({
        statusCode: 200,
        headers: {
          'set-cookie': ['app_access=eyJ; HttpOnly', 'app_refresh=eyJ; HttpOnly'],
          'content-type': 'application/json',
        },
      }),
    ).toEqual({ statusCode: 200, headers: { 'content-type': 'application/json' } })
  })
})

describe("the logger's own redaction — our logger.info({...}) calls", () => {
  const lines: Record<string, unknown>[] = []
  const log = pino(
    { redact: logRedaction },
    { write: (chunk: string) => void lines.push(JSON.parse(chunk) as Record<string, unknown>) },
  )
  const last = (): Record<string, unknown> => lines[lines.length - 1] ?? {}

  it('masks an email key at the top level and one level down', () => {
    log.info({ username: 'ada', email: 'ada.admin@example.dev' }, 'account')
    expect(last().email).toBe('a••••••••@example.dev')
    expect(last().username).toBe('ada')
    log.info({ account: { email: 'ada.admin@example.dev' } }, 'nested')
    expect((last().account as { email: string }).email).toBe('a••••••••@example.dev')
  })

  it('censors a secret key outright — an @ in a password does not make it an address', () => {
    log.info({ password: 'P@ssw0rd!', grant: { client_secret: 's3cret' }, token: 'abc' }, 'x')
    expect(last().password).toBe('[redacted]')
    expect(last().token).toBe('[redacted]')
    expect((last().grant as { client_secret: string }).client_secret).toBe('[redacted]')
  })

  it('leaves an absent email absent, and blanks an email that is not a string', () => {
    log.info({ email: null }, 'no email')
    expect(last().email).toBeNull()
    log.info({ email: ['a@b.dev'] }, 'odd email')
    expect(last().email).toBe('[redacted]')
  })

  it('does not touch the keys the call sites mask themselves', () => {
    log.info({ to: ['a••@example.dev'], username: 'ada' }, 'invitation')
    expect(last().to).toEqual(['a••@example.dev'])
    expect(last().username).toBe('ada')
  })
})
