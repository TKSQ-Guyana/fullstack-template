// Access-token claims — the same contract the frontend reads
// (frontend/src/auth/claims.ts), translated to the app's persona vocabulary.
//
// ═══ REPLACE WITH YOUR ROLES ═══ This file (with auth/permissions.ts and the
// realm's roles in keycloak-local/) is where a forked project defines its own
// vocabulary. The template ships three generic roles:
//
//   APP_ADMIN   → ADMIN     administers accounts, reference data, settings
//   APP_MANAGER → MANAGER   writes domain data (the notes example)
//   APP_USER    → USER      reads
//
// Keycloak realm roles arrive in `app_roles` when the realm defines a custom
// client scope emitting them, falling back to the token's standard
// `realm_access.roles`. Multi-tenant apps additionally carry `tenant_id` /
// `tenant_name` from a group mapper — the fields exist on Principal and are
// simply null until your realm emits the claims.

export type Persona = 'ADMIN' | 'MANAGER' | 'USER'

export interface KeycloakClaims {
  sub?: string
  app_roles?: string[]
  realm_access?: { roles?: string[] }
  tenant_id?: string
  tenant_name?: string
  preferred_username?: string
  email?: string
  name?: string
  [key: string]: unknown
}

export interface Principal {
  subject: string
  username: string
  email: string
  displayName: string
  /** Realm roles exactly as Keycloak spells them (APP_*). */
  realmRoles: string[]
  /** All personas this token maps to, in precedence order. */
  personas: Persona[]
  /** The persona passed to the app.api_* functions (single-role contract). */
  role: Persona
  tenantId: string | null
  tenantName: string | null
  /** true when this principal came from a VERIFIED token; false when it was
   *  synthesized from query params in a dev auth mode. RBAC only bites on
   *  verified principals — an unverifiable identity cannot be authorized. */
  verified: boolean
}

/** Keycloak realm role -> persona. */
export const ROLE_MAP: Readonly<Record<string, Persona>> = Object.freeze({
  APP_ADMIN: 'ADMIN',
  APP_MANAGER: 'MANAGER',
  APP_USER: 'USER',
})

/** Precedence when one account carries several personas: the most privileged
 *  wins; `role` (the single-role contract) is the first match. */
const PRECEDENCE: readonly Persona[] = ['ADMIN', 'MANAGER', 'USER']

export const ALL_PERSONAS: readonly Persona[] = PRECEDENCE

export function rolesFrom(claims: KeycloakClaims): string[] {
  const raw = claims.app_roles ?? claims.realm_access?.roles ?? []
  return Array.isArray(raw) ? raw.filter((r): r is string => typeof r === 'string') : []
}

export function personasFrom(realmRoles: string[]): Persona[] {
  const mapped = new Set(realmRoles.map((r) => ROLE_MAP[r]).filter((p): p is Persona => !!p))
  return PRECEDENCE.filter((p) => mapped.has(p))
}

export function principalFromClaims(claims: KeycloakClaims): Principal {
  const realmRoles = rolesFrom(claims)
  const personas = personasFrom(realmRoles)
  const username = claims.preferred_username ?? ''
  return {
    subject: claims.sub ?? username ?? 'unknown',
    username,
    email: claims.email ?? '',
    displayName: claims.name ?? username,
    realmRoles,
    personas,
    // No mapped persona -> the least privileged, and the RBAC layer refuses
    // an empty persona list before this default ever authorizes anything.
    role: personas[0] ?? 'USER',
    tenantId: claims.tenant_id ?? null,
    tenantName: claims.tenant_name ?? null,
    verified: true,
  }
}

const PERSONA_SET = new Set<string>(PRECEDENCE)

/** Dev-mode principal from ?role=&tenantId=&actor= (AUTH_MODE optional/disabled). */
export function principalFromParams(params: {
  role?: string
  tenantId?: string
  actor?: string
}): Principal {
  const roleParam = (params.role ?? 'USER').toUpperCase()
  const role: Persona = PERSONA_SET.has(roleParam) ? (roleParam as Persona) : 'USER'
  return {
    subject: params.actor ?? 'system',
    username: params.actor ?? 'system',
    email: '',
    displayName: params.actor ?? 'system',
    realmRoles: [],
    personas: [role],
    role,
    tenantId: params.tenantId ?? null,
    tenantName: null,
    verified: false,
  }
}
