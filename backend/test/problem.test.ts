import { describe, expect, it } from 'vitest'
import { ProblemError, unprocessable } from '../src/http/problem.js'
import { fromPgError, type PgError } from '../src/middleware/errorHandler.js'

describe('ProblemError', () => {
  it('serialises to RFC-7807 problem+json', () => {
    const err = new ProblemError(409, 'Duplicate thing')
    expect(err.toBody()).toEqual({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: 'Duplicate thing',
    })
  })

  it('carries field violations only when present', () => {
    const err = unprocessable('Validation failed', [{ field: 'title', message: 'required' }])
    expect(err.toBody().violations).toEqual([{ field: 'title', message: 'required' }])
    expect(new ProblemError(400, 'plain').toBody()).not.toHaveProperty('violations')
  })
})

describe('fromPgError', () => {
  const pg = (code: string, message = 'boom'): PgError =>
    Object.assign(new Error(message), { code })

  it('maps unique_violation to 409', () => {
    expect(fromPgError(pg('23505'))?.status).toBe(409)
  })

  it('maps FK / check / not-null violations to 422', () => {
    for (const code of ['23503', '23514', '23502', 'P0001']) {
      expect(fromPgError(pg(code))?.status).toBe(422)
    }
  })

  it('maps bad input representations to 400', () => {
    for (const code of ['22023', '22P02']) {
      expect(fromPgError(pg(code))?.status).toBe(400)
    }
  })

  it('leaves unknown codes to the 500 fallback', () => {
    expect(fromPgError(pg('XX000'))).toBeNull()
    expect(fromPgError(new Error('no code'))).toBeNull()
  })
})
