// The role POLICY: role -> permissions (with inheritance). Pure data — the
// engine interprets it, nothing here executes.
//
// ═══ REPLACE WITH YOUR ROLES ═══ alongside permissions.ts and auth/claims.ts.
import type { RoleId } from '@/auth/claims'
import { PERMISSIONS, type Permission } from './permissions'

export interface RolePolicy {
  /** '*' = every catalogued permission (use sparingly). */
  permissions: Permission[] | '*'
  inherits?: RoleId[]
}

export const ROLE_POLICY: Readonly<Record<RoleId, RolePolicy>> = Object.freeze({
  user: {
    permissions: ['notes:read', 'reference:read'],
  },
  manager: {
    permissions: ['notes:write'],
    inherits: ['user'],
  },
  admin: {
    permissions: '*',
  },
})

/**
 * Every permission a role grants, inheritance resolved, cycles guarded.
 * A role's permissions are the UNION across everything it holds — never a
 * precedence pick: precedence chooses what the chrome DISPLAYS, not what the
 * person may do.
 */
export function permissionsOf(role: RoleId, seen: Set<RoleId> = new Set()): Set<Permission> {
  if (seen.has(role)) return new Set()
  seen.add(role)
  const policy = ROLE_POLICY[role]
  if (!policy) return new Set()
  const out = new Set<Permission>(policy.permissions === '*' ? PERMISSIONS : policy.permissions)
  for (const parent of policy.inherits ?? []) {
    for (const p of permissionsOf(parent, seen)) out.add(p)
  }
  return out
}

/** Dev-time sanity: every policy entry names catalogued permissions and known
 *  roles. Reports (console.error) rather than throws — a bad policy should be
 *  loud in development, not take production down. */
export function validatePolicy(): string[] {
  const problems: string[] = []
  for (const [role, policy] of Object.entries(ROLE_POLICY)) {
    if (policy.permissions !== '*') {
      for (const p of policy.permissions) {
        if (!(PERMISSIONS as readonly string[]).includes(p)) {
          problems.push(`role ${role}: unknown permission "${p}"`)
        }
      }
    }
    for (const parent of policy.inherits ?? []) {
      if (!(parent in ROLE_POLICY)) problems.push(`role ${role}: inherits unknown role "${parent}"`)
    }
  }
  return problems
}
