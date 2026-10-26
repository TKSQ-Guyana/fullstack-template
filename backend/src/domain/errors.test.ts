import { describe, expect, it } from 'vitest'
import { DomainError, conflict, ensure, forbidden, invalid, notFound, refused } from './errors.js'

describe('DomainError', () => {
  it('carries the status each kind answers with', () => {
    expect(invalid('x').status).toBe(400)
    expect(forbidden('x').status).toBe(403)
    expect(notFound('x').status).toBe(404)
    expect(conflict('x').status).toBe(409)
    expect(refused('x').status).toBe(422)
  })

  it('ensure() passes a holding condition and refuses a failing one verbatim', () => {
    expect(() => ensure(true, 'never')).not.toThrow()
    expect(() => ensure(0, 'No.')).toThrow(DomainError)
    expect(() => ensure('', 'No.')).toThrow('No.')
  })
})
