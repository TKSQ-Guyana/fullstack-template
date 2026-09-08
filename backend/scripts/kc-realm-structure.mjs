// THE REALM STRUCTURE THIS BUILD REQUIRES — one module, two consumers.
//
// A Keycloak realm imported before a feature shipped simply does not have the
// realm roles or groups that feature needs. This module is the single
// statement of what must exist, read by:
//
//   * backend/scripts/kc-ensure-realm.mjs — the DEPLOY gate: runs in the
//     backend container's entrypoint after the DB migrations, as the
//     app-provisioning-service service account, and creates whatever is
//     missing. Structure ONLY.
//   * keycloak-local/setup-dev.mjs — the DEV seeder: everything here PLUS the
//     test accounts, passwords and local web origins that must never reach a
//     deployed realm.
//
// STRUCTURE MEANS: realm roles and tenant groups. Never users, never
// credentials, never client configuration — those stay where they are
// (provisioning screens, dev seeder, console).

/** Realm roles the application maps to personas (backend/src/auth/claims.ts). */
export const REQUIRED_REALM_ROLES = [
  {
    name: 'APP_ADMIN',
    description: 'Administers accounts, reference data and settings.',
  },
  {
    name: 'APP_MANAGER',
    description: 'Writes domain data (the notes example).',
  },
  {
    name: 'APP_USER',
    description: 'Reads.',
  },
]

/** The group every tenant lives under; its children carry the tenant claims
 *  (tenant_id / tenant_name group attributes). */
export const TENANT_GROUP_PARENT = 'App-Tenants'

/**
 * Multi-tenant apps list their tenants here — id and name EXACTLY as the
 * database spells them, because the group's tenant_id attribute is what the
 * token carries and every per-tenant scope keys on it. The template ships
 * single-tenant: an empty list creates no groups and emits no tenant claims.
 */
export const TENANTS = []
