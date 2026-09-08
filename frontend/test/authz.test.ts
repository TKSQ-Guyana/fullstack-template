import { describe, expect, it } from 'vitest'
import { createAuthz, ANONYMOUS } from '@/authz/engine'
import { validatePolicy } from '@/authz/policy'
import { auditManifest } from '@/routes/integrity'

const principal = (roleIds: ('admin' | 'manager' | 'user')[]) => ({
  authenticated: true,
  username: 'test',
  displayName: 'Test',
  roleIds,
  tenantId: null,
})

describe('the authz engine', () => {
  it('answers from the union of all held roles, inheritance resolved', () => {
    const authz = createAuthz(principal(['manager']))
    expect(authz.can('notes:write')).toBe(true)
    expect(authz.can('notes:read')).toBe(true) // inherited from user
    expect(authz.can('reference:write')).toBe(false)
  })

  it("admin's '*' grants every catalogued permission", () => {
    const authz = createAuthz(principal(['admin']))
    expect(authz.can('reference:write')).toBe(true)
    expect(authz.can('accounts:manage')).toBe(true)
  })

  it('null means "any signed-in principal" — and anonymous gets nothing', () => {
    expect(createAuthz(principal(['user'])).can(null)).toBe(true)
    const anon = createAuthz(ANONYMOUS)
    expect(anon.can(null)).toBe(false)
    expect(anon.can('notes:read')).toBe(false)
  })
})

describe('policy + manifest integrity', () => {
  it('the shipped policy validates clean', () => {
    expect(validatePolicy()).toEqual([])
  })

  it('the shipped manifest audits clean', () => {
    expect(auditManifest()).toEqual([])
  })
})
