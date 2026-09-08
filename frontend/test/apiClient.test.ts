import { describe, expect, it } from 'vitest'
import { qs, problemFrom } from '@/services/apiClient'

describe('qs', () => {
  it('omits null/undefined/empty rather than sending them blank', () => {
    expect(qs({ a: '1', b: null, c: undefined, d: '' })).toBe('?a=1')
    expect(qs({})).toBe('')
  })

  it('repeats the key for arrays', () => {
    expect(qs({ status: ['A', 'B'] })).toBe('?status=A&status=B')
  })
})

describe('problemFrom', () => {
  const res = (body: string, init: ResponseInit = { status: 422 }) => new Response(body, init)

  it('prefers detail and appends field violations', async () => {
    const problem = await problemFrom(
      res(
        JSON.stringify({
          title: 'Validation failed',
          detail: 'A note needs a title.',
          violations: [{ field: 'title', message: 'required' }],
        }),
      ),
    )
    expect(problem.message).toBe('A note needs a title. (title: required)')
    expect(problem.violations).toHaveLength(1)
  })

  it('passes non-JSON bodies through unchanged', async () => {
    const problem = await problemFrom(res('<html>gateway error</html>', { status: 502 }))
    expect(problem.message).toContain('gateway error')
    expect(problem.violations).toEqual([])
  })
})
