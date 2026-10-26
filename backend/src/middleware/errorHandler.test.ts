import type { Request, Response } from 'express'
import { describe, expect, it } from 'vitest'
import { notFound, refused } from '../domain/errors.js'
import { errorHandler, fromPgError, type PgError } from './errorHandler.js'

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

describe('errorHandler', () => {
  function answer(err: unknown) {
    const sent: { status?: number; type?: string; body?: unknown } = {}
    const res = {
      status(code: number) {
        sent.status = code
        return this
      },
      type(t: string) {
        sent.type = t
        return this
      },
      json(body: unknown) {
        sent.body = body
        return this
      },
    } as unknown as Response
    errorHandler(err, { path: '/x' } as Request, res, () => undefined)
    return sent
  }

  it('answers a DomainError with its status and its sentence verbatim', () => {
    expect(answer(refused('A note needs a title.'))).toEqual({
      status: 422,
      type: 'application/problem+json',
      body: {
        type: 'about:blank',
        title: 'Validation failed',
        status: 422,
        detail: 'A note needs a title.',
      },
    })
    expect(answer(notFound('No such note.')).status).toBe(404)
  })
})
