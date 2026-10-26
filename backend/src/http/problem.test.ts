import { describe, expect, it } from 'vitest'
import { ProblemError, unprocessable } from './problem.js'

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
