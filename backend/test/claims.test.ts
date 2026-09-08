import { describe, expect, it } from 'vitest'
import { personasFrom, principalFromClaims, rolesFrom } from '../src/auth/claims.js'
import { permissionsFor } from '../src/auth/permissions.js'

describe('claims mapping', () => {
  it('prefers app_roles over realm_access.roles', () => {
    expect(rolesFrom({ app_roles: ['APP_USER'], realm_access: { roles: ['APP_ADMIN'] } })).toEqual([
      'APP_USER',
    ])
    expect(rolesFrom({ realm_access: { roles: ['APP_ADMIN'] } })).toEqual(['APP_ADMIN'])
  })

  it('orders personas by precedence and picks the most privileged as role', () => {
    expect(personasFrom(['APP_USER', 'APP_ADMIN', 'unrelated-role'])).toEqual(['ADMIN', 'USER'])
    const p = principalFromClaims({
      preferred_username: 'ada',
      app_roles: ['APP_USER', 'APP_MANAGER'],
    })
    expect(p.role).toBe('MANAGER')
    expect(p.verified).toBe(true)
  })

  it('maps no roles to an empty persona list (RBAC refuses it later)', () => {
    const p = principalFromClaims({ preferred_username: 'nobody' })
    expect(p.personas).toEqual([])
    expect(p.role).toBe('USER')
  })
})

describe('permissionsFor', () => {
  it('reflects the operation matrix', () => {
    expect(permissionsFor(['USER'])).toMatchObject({ 'notes.read': true, 'notes.write': false })
    expect(permissionsFor(['MANAGER'])).toMatchObject({
      'notes.write': true,
      'reference.write': false,
    })
    expect(permissionsFor(['ADMIN'])).toMatchObject({
      'notes.write': true,
      'reference.write': true,
    })
  })
})
