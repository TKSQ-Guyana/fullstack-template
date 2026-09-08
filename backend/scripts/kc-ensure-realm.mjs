// The Keycloak counterpart of `migrate.mjs up` — run by the container
// entrypoint on every boot, after the database migrations.
//
// WHY IT EXISTS. A deployed realm is imported once and then only ever touched
// by hand, so every realm role or tenant group a NEW build needs is missing
// there until somebody remembers the console. The schema gets this for free —
// migrations run on boot — and the realm gets the same: whatever structure
// kc-realm-structure.mjs declares is checked and created, idempotently.
//
// STRUCTURE ONLY, NEVER USERS. This creates realm roles and tenant groups —
// facts a deployed realm must have for the app to function. It never creates
// accounts, never touches credentials, never edits clients: the dev test
// users belong to keycloak-local/setup-dev.mjs and must never reach a
// deployed realm.
//
// AUTHENTICATED AS THE SERVICE ACCOUNT the backend already holds
// (KC_SERVICE_CLIENT_ID/SECRET). Creating roles needs `manage-realm` and
// creating groups needs `manage-users` on that service account, alongside
// `view-realm`. Where a grant is missing, this DOES NOT BLOCK BOOT: the app
// must not go down over realm housekeeping — it logs exactly which grant is
// missing and what was skipped.
//
//   node scripts/kc-ensure-realm.mjs
//
// Env (all already in the backend's environment): KC_URL, KC_REALM,
// KC_SERVICE_CLIENT_ID, KC_SERVICE_CLIENT_SECRET. Exits 0 in every outcome
// short of a crash; the log lines are the report.

import { REQUIRED_REALM_ROLES, TENANT_GROUP_PARENT, TENANTS } from './kc-realm-structure.mjs'

const KC_URL = (process.env.KC_URL || '').replace(/\/+$/, '')
const REALM = process.env.KC_REALM || 'app-realm'
const CLIENT_ID = process.env.KC_SERVICE_CLIENT_ID || ''
const CLIENT_SECRET = process.env.KC_SERVICE_CLIENT_SECRET || ''

const log = (m) => console.log(`[kc-ensure] ${m}`)

if (!KC_URL || !CLIENT_ID || !CLIENT_SECRET) {
  // A deployment that has not configured the service account simply skips,
  // said plainly. A wrong secret fails the token grant below and skips just
  // as gracefully.
  log('skipped — KC_URL / KC_SERVICE_CLIENT_ID / KC_SERVICE_CLIENT_SECRET not configured')
  process.exit(0)
}

let token
try {
  const res = await fetch(`${KC_URL}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  })
  if (!res.ok) throw new Error(`token endpoint answered ${res.status}`)
  token = (await res.json()).access_token
} catch (err) {
  log(`skipped — could not authenticate as ${CLIENT_ID}: ${err.message}`)
  process.exit(0)
}

/** One admin call. 409 answers as success — somebody else created it first. */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${KC_URL}/admin/realms/${REALM}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (res.status === 409) return { conflict: true }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`)
    err.status = res.status
    throw err
  }
  const text = await res.text().catch(() => '')
  return text ? JSON.parse(text) : null
}

/** A 403 means a grant is missing — reported once with the fix, never fatal. */
const grantHint = (what, needs, err) =>
  log(
    `SKIPPED ${what} — the ${CLIENT_ID} service account lacks the realm-management ` +
      `role "${needs}" (grant it in the Keycloak console, Service accounts roles). ${err.message}`,
  )

// ---------------------------------------------------------------- realm roles
let rolesOk = 0
for (const role of REQUIRED_REALM_ROLES) {
  try {
    await api(`/roles/${encodeURIComponent(role.name)}`)
    rolesOk += 1
    continue
  } catch (err) {
    if (err.status !== 404) {
      if (err.status === 403) grantHint(`realm-role check (${role.name})`, 'view-realm', err)
      else log(`realm role ${role.name}: check failed — ${err.message}`)
      continue
    }
  }
  try {
    await api('/roles', { method: 'POST', body: role })
    log(`created realm role ${role.name}`)
    rolesOk += 1
  } catch (err) {
    if (err.status === 403) grantHint(`creating realm role ${role.name}`, 'manage-realm', err)
    else log(`realm role ${role.name}: create failed — ${err.message}`)
  }
}
log(`realm roles: ${rolesOk}/${REQUIRED_REALM_ROLES.length} present`)

// -------------------------------------------------------------- tenant groups
if (TENANTS.length === 0) {
  log('tenant groups: none declared (single-tenant) — skipped')
} else {
  try {
    const found = await api(`/groups?search=${encodeURIComponent(TENANT_GROUP_PARENT)}&max=50`)
    let parent = (Array.isArray(found) ? found : []).find((g) => g.name === TENANT_GROUP_PARENT)
    if (!parent) {
      await api('/groups', { method: 'POST', body: { name: TENANT_GROUP_PARENT } })
      log(`created group /${TENANT_GROUP_PARENT}`)
      const again = await api(`/groups?search=${encodeURIComponent(TENANT_GROUP_PARENT)}&max=50`)
      parent = (Array.isArray(again) ? again : []).find((g) => g.name === TENANT_GROUP_PARENT)
    }

    // Children come inline (`subGroups`) on older Keycloaks and from their own
    // endpoint on newer ones — read both ways.
    let children = Array.isArray(parent.subGroups) ? parent.subGroups : []
    if (children.length === 0) {
      try {
        children = (await api(`/groups/${parent.id}/children?max=200`)) ?? []
      } catch (err) {
        if (err.status !== 404) throw err
      }
    }
    const present = (tenant) => children.some((c) => c.name === tenant.id || c.name === tenant.name)

    let created = 0
    for (const tenant of TENANTS) {
      if (present(tenant)) continue
      await api(`/groups/${parent.id}/children`, {
        method: 'POST',
        body: {
          name: tenant.id,
          attributes: { tenant_id: [tenant.id], tenant_name: [tenant.name] },
        },
      })
      created += 1
      log(`created group /${TENANT_GROUP_PARENT}/${tenant.id} (${tenant.name})`)
    }
    log(`tenant groups: ${TENANTS.length - created} present, ${created} created`)
  } catch (err) {
    if (err.status === 403) grantHint('tenant groups', 'manage-users', err)
    else log(`tenant groups: failed — ${err.message}`)
  }
}

log('done')
