// Access-token claims -> the app's identity vocabulary. The mirror of
// backend/src/auth/claims.ts — the two files change together.
//
// ═══ REPLACE WITH YOUR ROLES ═══ alongside src/authz/policy.ts and the
// backend's claims/permissions pair.

export type RoleId = 'admin' | 'manager' | 'user'

export interface SessionClaims {
  sub?: string
  app_roles?: string[]
  realm_access?: { roles?: string[] }
  tenant_id?: string
  tenant_name?: string
  preferred_username?: string
  email?: string
  name?: string
  exp?: number
  [key: string]: unknown
}

/** Keycloak realm role -> role id, in PRECEDENCE order (first match = active). */
export const ROLE_MAP: ReadonlyArray<readonly [kcRole: string, roleId: RoleId]> = [
  ['APP_ADMIN', 'admin'],
  ['APP_MANAGER', 'manager'],
  ['APP_USER', 'user'],
]

export function rolesFrom(claims: SessionClaims | null): string[] {
  const raw = claims?.app_roles ?? claims?.realm_access?.roles ?? []
  return Array.isArray(raw) ? raw.filter((r): r is string => typeof r === 'string') : []
}

/** All mapped role ids this token carries, in precedence order. */
export function roleIdsFrom(claims: SessionClaims | null): RoleId[] {
  const held = new Set(rolesFrom(claims))
  return ROLE_MAP.filter(([kc]) => held.has(kc)).map(([, id]) => id)
}

export interface Identity {
  username: string
  email: string
  displayName: string
  roleIds: RoleId[]
  /** The precedence pick — what the chrome displays. */
  activeRole: RoleId | null
  tenantId: string | null
  tenantName: string | null
}

export function identityFrom(claims: SessionClaims | null): Identity {
  const roleIds = roleIdsFrom(claims)
  return {
    username: claims?.preferred_username ?? '',
    email: claims?.email ?? '',
    displayName: claims?.name ?? claims?.preferred_username ?? '',
    roleIds,
    activeRole: roleIds[0] ?? null,
    tenantId: claims?.tenant_id ?? null,
    tenantName: claims?.tenant_name ?? null,
  }
}
