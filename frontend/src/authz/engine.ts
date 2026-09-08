// The pure authorization engine. No React, no fetch, no identity source —
// createAuthz() takes a principal and answers can(). The identity ARRIVES
// through an adapter (adapters/), which is the whole point: swapping where
// identity comes from changes no page, guard or nav row.
import type { RoleId } from '@/auth/claims'
import type { Permission } from './permissions'
import { permissionsOf } from './policy'

export interface Principal {
  authenticated: boolean
  username: string
  displayName: string
  roleIds: RoleId[]
  tenantId: string | null
}

export const ANONYMOUS: Principal = Object.freeze({
  authenticated: false,
  username: '',
  displayName: '',
  roleIds: [],
  tenantId: null,
})

export interface Authz {
  principal: Principal
  can: (permission: Permission | null) => boolean
  canAny: (permissions: Permission[]) => boolean
  canAll: (permissions: Permission[]) => boolean
  isAuthenticated: boolean
}

export function createAuthz(principal: Principal): Authz {
  const granted = new Set<Permission>()
  for (const role of principal.roleIds) {
    for (const p of permissionsOf(role)) granted.add(p)
  }

  // `null` is the audited "any signed-in principal" — a manifest entry must
  // write it out rather than omit the key (integrity check enforces that).
  const can = (permission: Permission | null): boolean =>
    principal.authenticated && (permission === null || granted.has(permission))

  return Object.freeze({
    principal,
    can,
    canAny: (permissions: Permission[]) => permissions.some((p) => can(p)),
    canAll: (permissions: Permission[]) => permissions.every((p) => can(p)),
    isAuthenticated: principal.authenticated,
  })
}
