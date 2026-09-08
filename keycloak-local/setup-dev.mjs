// Provision what the app needs into the LOCAL Keycloak — dev seeder.
//
// The realm this container imports (realm-export.json) already carries the
// clients, the realm roles and the protocol mappers. What an export cannot
// carry, this script ensures on every `docker compose up` (the kc-bootstrap
// one-shot sidecar runs it):
//
//   1. LOCAL WEB ORIGINS on the SPA client (the nginx door at :3000 and the
//      vite loop at :5173) — without them Keycloak refuses the token CORS
//      preflight and sign-in fails with "Could not reach the sign-in service".
//   2. REALM ROLES newer than the export (shared structure module).
//   3. SERVICE-ACCOUNT GRANTS for app-provisioning-service, so the backend's
//      boot-time realm ensure and server-side user lookups work: view-realm,
//      view-users, manage-realm, manage-users. Deployed realms get these
//      granted BY HAND once (docs/DEPLOYMENT-ENV.md); the local realm gets
//      them here so a wiped volume comes back self-sufficient.
//   4. TENANT GROUPS, when the shared module declares any.
//   5. DEMO USERS — one per persona, password from APP_DEV_PASSWORD. These
//      must NEVER reach a deployed realm; that is why they live here and not
//      in kc-ensure-realm.mjs.
//
// IDEMPOTENT. Re-run as often as you like; `docker compose down -v` discards
// the Keycloak volume and the next `up` reseeds from nothing.
//
//   APP_DEV_PASSWORD=... node setup-dev.mjs
//
// Override if your Keycloak is elsewhere:
//   KC=http://localhost:8085  REALM=app-realm  KC_ADMIN=admin  KC_ADMIN_PASSWORD=admin

// THE STRUCTURE (realm roles, tenants) IS SHARED with the backend's boot-time
// realm ensure — one module, so a deployed realm and this dev seeder can never
// disagree about what must exist. The kc-bootstrap compose sidecar mounts the
// module beside /seed so this relative import resolves inside the container.
import {
  REQUIRED_REALM_ROLES,
  TENANT_GROUP_PARENT,
  TENANTS,
} from '../backend/scripts/kc-realm-structure.mjs'

const KC = (process.env.KC || 'http://localhost:8085').replace(/\/+$/, '')
const REALM = process.env.REALM || 'app-realm'
const ADMIN = process.env.KC_ADMIN || 'admin'
const ADMIN_PW = process.env.KC_ADMIN_PASSWORD || 'admin'

// Shared by every seeded account. NO DEFAULT ON PURPOSE: the value is stated
// once, in the repo-root .env (copied from .env.dev.example), never in a
// committed script — a template that ships a literal dev password ships it to
// every fork forever.
const PASSWORD = process.env.APP_DEV_PASSWORD
if (!PASSWORD) {
  console.error(
    'setup-dev: APP_DEV_PASSWORD is not set. Copy .env.dev.example to .env at the repo root and retry.',
  )
  process.exit(1)
}

const SPA_CLIENT = 'web-app'
const SERVICE_ACCOUNT_CLIENT = 'app-provisioning-service'
const SERVICE_ACCOUNT_ROLES = ['view-realm', 'view-users', 'manage-realm', 'manage-users']

// One account per persona, so every screen can be reached.
// ═══ REPLACE WITH YOUR PERSONAS ═══ alongside backend/src/auth/claims.ts.
const USERS = [
  {
    username: 'admin@example.dev',
    first: 'Ada',
    last: 'Admin',
    roles: ['APP_ADMIN'],
    // What the Users screen needs: the /kcadmin proxy forwards this person's
    // own token and Keycloak authorises against these roles.
    clientRoles: { 'realm-management': ['manage-users', 'view-users', 'view-realm'] },
  },
  { username: 'manager@example.dev', first: 'Mona', last: 'Manager', roles: ['APP_MANAGER'] },
  { username: 'user@example.dev', first: 'Uri', last: 'User', roles: ['APP_USER'] },
]

let token
const log = (m) => console.log(m)

async function api(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(`${KC}/admin/realms/${REALM}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok && res.status !== 409) {
    throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`)
  }
  if (raw || res.status === 204 || res.status === 409) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

async function authenticate() {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: ADMIN,
      password: ADMIN_PW,
    }),
  })
  if (!res.ok) throw new Error(`Admin sign-in failed (${res.status}). Is Keycloak up at ${KC}?`)
  token = (await res.json()).access_token
}

// --- 0. local origins on the SPA client -------------------------------------

const LOCAL_ORIGINS = ['http://localhost:5173', 'http://localhost:3000']

async function ensureLocalOrigins() {
  const [client] = await api(`/clients?clientId=${encodeURIComponent(SPA_CLIENT)}`)
  if (!client) {
    log(`  !! client ${SPA_CLIENT} not found — skipping`)
    return
  }
  const webOrigins = new Set(client.webOrigins || [])
  const redirectUris = new Set(client.redirectUris || [])
  const before = webOrigins.size + redirectUris.size
  for (const origin of LOCAL_ORIGINS) {
    webOrigins.add(origin)
    redirectUris.add(`${origin}/*`)
  }
  if (webOrigins.size + redirectUris.size === before) {
    log(`  ${SPA_CLIENT}: local origins already listed`)
    return
  }
  client.webOrigins = [...webOrigins]
  client.redirectUris = [...redirectUris]
  await api(`/clients/${client.id}`, { method: 'PUT', raw: true, body: client })
  log(`  ${SPA_CLIENT}: + ${LOCAL_ORIGINS.join(', ')}`)
}

// --- 1. realm roles the export may predate -----------------------------------

async function ensureRealmRoles() {
  const existing = new Set((await api('/roles')).map((r) => r.name))
  for (const role of REQUIRED_REALM_ROLES) {
    if (existing.has(role.name)) {
      log(`  ${role.name} — present`)
      continue
    }
    await api('/roles', { method: 'POST', body: role })
    log(`  ${role.name} — created`)
  }
}

// --- 2. the service account's own grants -------------------------------------

async function ensureServiceAccountGrants() {
  const [client] = await api(`/clients?clientId=${encodeURIComponent(SERVICE_ACCOUNT_CLIENT)}`)
  if (!client) {
    log(`  !! client ${SERVICE_ACCOUNT_CLIENT} not found — skipping`)
    return
  }
  const [rm] = await api('/clients?clientId=realm-management')
  const user = await api(`/clients/${client.id}/service-account-user`)
  // `available` lists only what the account does NOT already hold, so this is
  // idempotent the same way the user-role grants below are.
  const available = await api(`/users/${user.id}/role-mappings/clients/${rm.id}/available`)
  const want = available.filter((r) => SERVICE_ACCOUNT_ROLES.includes(r.name))
  if (!want.length) {
    log(`  ${SERVICE_ACCOUNT_CLIENT}: grants already present`)
    return
  }
  await api(`/users/${user.id}/role-mappings/clients/${rm.id}`, {
    method: 'POST',
    raw: true,
    body: want,
  })
  log(`  ${SERVICE_ACCOUNT_CLIENT}: + ${want.map((r) => r.name).join(', ')}`)
}

// --- 3. tenants under /App-Tenants (multi-tenant apps only) -------------------

async function ensureTenants() {
  if (TENANTS.length === 0) {
    log('  none declared (single-tenant) — skipped')
    return new Map()
  }
  const groups = await api(`/groups?search=${encodeURIComponent(TENANT_GROUP_PARENT)}`)
  let parent = groups.find((g) => g.name === TENANT_GROUP_PARENT)
  if (!parent) {
    await api('/groups', { method: 'POST', body: { name: TENANT_GROUP_PARENT } })
    parent = (await api(`/groups?search=${encodeURIComponent(TENANT_GROUP_PARENT)}`)).find(
      (g) => g.name === TENANT_GROUP_PARENT,
    )
    log(`  created /${TENANT_GROUP_PARENT}`)
  }

  // Keycloak 23+ serves children from their own endpoint rather than inline.
  const children = (await api(`/groups/${parent.id}/children`)) || parent.subGroups || []
  const present = (tenant) => children.find((c) => c.name === tenant.id || c.name === tenant.name)

  for (const tenant of TENANTS) {
    if (present(tenant)) {
      log(`  /${TENANT_GROUP_PARENT}/${present(tenant).name} — present`)
      continue
    }
    await api(`/groups/${parent.id}/children`, {
      method: 'POST',
      body: {
        name: tenant.id,
        attributes: { tenant_id: [tenant.id], tenant_name: [tenant.name] },
      },
    })
    log(`  /${TENANT_GROUP_PARENT}/${tenant.id} — created (${tenant.name})`)
  }

  const refreshed = (await api(`/groups/${parent.id}/children`)) || []
  const map = new Map()
  for (const child of refreshed) {
    map.set(child.name, child)
    const tenant = TENANTS.find((t) => t.id === child.name || t.name === child.name)
    if (tenant) {
      map.set(tenant.id, child)
      map.set(tenant.name, child)
    }
  }
  return map
}

// --- 4. users ----------------------------------------------------------------

async function ensureUsers(specs, tenantGroups) {
  const roleByName = new Map((await api('/roles')).map((r) => [r.name, r]))

  for (const spec of specs) {
    let [user] = await api(`/users?username=${encodeURIComponent(spec.username)}&exact=true`)

    // An explicit `email`, or the username when the username itself is one.
    // EVERY ACCOUNT NEEDS ONE: a realm whose user profile marks email required
    // validates it during AUTHENTICATION, so an account with no email is
    // created happily and then answers the password grant with
    // `invalid_grant: "Account is not fully set up"` — which reads like a
    // credentials problem and is neither.
    const email = spec.email ?? (spec.username.includes('@') ? spec.username : null)

    if (!user) {
      await api('/users', {
        method: 'POST',
        body: {
          username: spec.username,
          ...(email ? { email } : {}),
          firstName: spec.first,
          lastName: spec.last,
          enabled: true,
          emailVerified: true,
          ...(spec.attributes ? { attributes: spec.attributes } : {}),
        },
      })
      ;[user] = await api(`/users?username=${encodeURIComponent(spec.username)}&exact=true`)
      log(`  ${spec.username} — created`)
    } else {
      log(`  ${spec.username} — exists`)
      // Backfill, so an account created by an earlier run — or by hand in the
      // console — is repaired rather than left in a state that fails the grant.
      const needsEmail = email && user.email !== email
      if (spec.attributes || needsEmail) {
        if (needsEmail) log(`    + email: ${email}`)
        await api(`/users/${user.id}`, {
          method: 'PUT',
          raw: true,
          body: {
            ...user,
            ...(needsEmail ? { email, emailVerified: true } : {}),
            attributes: { ...(user.attributes || {}), ...(spec.attributes || {}) },
          },
        })
      }
    }

    // Always reset, so the documented password holds even for an account
    // someone changed.
    await api(`/users/${user.id}/reset-password`, {
      method: 'PUT',
      raw: true,
      body: { type: 'password', value: PASSWORD, temporary: false },
    })

    const held = new Set((await api(`/users/${user.id}/role-mappings/realm`)).map((r) => r.name))
    const missing = spec.roles
      .filter((r) => !held.has(r))
      .map((r) => roleByName.get(r))
      .filter(Boolean)
    if (missing.length) {
      await api(`/users/${user.id}/role-mappings/realm`, {
        method: 'POST',
        raw: true,
        body: missing,
      })
      log(`    + realm roles: ${missing.map((r) => r.name).join(', ')}`)
    }

    for (const [clientId, roles] of Object.entries(spec.clientRoles || {})) {
      const [client] = await api(`/clients?clientId=${encodeURIComponent(clientId)}`)
      if (!client) continue
      const available = await api(`/users/${user.id}/role-mappings/clients/${client.id}/available`)
      const want = available.filter((r) => roles.includes(r.name))
      if (want.length) {
        await api(`/users/${user.id}/role-mappings/clients/${client.id}`, {
          method: 'POST',
          raw: true,
          body: want,
        })
        log(`    + ${clientId} roles: ${want.map((r) => r.name).join(', ')}`)
      }
    }

    // Group membership only — no user attributes: the aggregate.attrs mappers
    // are what turn membership into a claim.
    if (spec.group) {
      const group = tenantGroups.get(spec.group)
      if (group) {
        await api(`/users/${user.id}/groups/${group.id}`, { method: 'PUT', raw: true })
        log(`    + group: /${TENANT_GROUP_PARENT}/${spec.group}`)
      }
    }
  }
}

// --- run -----------------------------------------------------------------------

log(`\nProvisioning into ${KC} (realm ${REALM})\n`)
await authenticate()
log('[0] local web origins')
await ensureLocalOrigins()
log('\n[1] realm roles')
await ensureRealmRoles()
log('\n[2] service-account grants (boot-time realm ensure + server-side lookups)')
await ensureServiceAccountGrants()
log('\n[3] tenants')
const tenantGroups = await ensureTenants()
log('\n[4] users')
await ensureUsers(USERS, tenantGroups)

log('\nDone. Every seeded account signs in with the APP_DEV_PASSWORD from your .env.')
log('Sign in at http://localhost:5173 (vite) or http://localhost:3000 (nginx).\n')
