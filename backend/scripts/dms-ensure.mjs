// The DMS's own "migrations" — idempotent provisioning of the structure the
// app expects in Mayan, run at boot when DMS_ENABLED (never fatal;
// SKIP_DMS_ENSURE=true disables) and by the dev stack's mayan-bootstrap
// one-shot once Mayan turns healthy.
//
// THE TEMPLATE'S STRUCTURE IS MINIMAL ON PURPOSE: the default document type
// and the root cabinet. A real project extends this the way it extends the
// SQL migrations — one entry per document type / metadata type / cabinet /
// index template, each get-or-create, so a fresh Mayan and a provisioned one
// converge on the same structure.
//
// Env: DMS_URL, DMS_USERNAME, DMS_PASSWORD, DMS_DOCUMENT_TYPE (default
// 'Default'), DMS_TLS_INSECURE.

const base = (process.env.DMS_URL || '').replace(/\/+$/, '')
const username = process.env.DMS_USERNAME || ''
const password = process.env.DMS_PASSWORD || ''
const documentType = process.env.DMS_DOCUMENT_TYPE || 'Default'
const ROOT_CABINET = 'app'

const log = (m) => console.log(`[dms-ensure] ${m}`)

if (!base || !username || !password) {
  log('skipped — DMS_URL / DMS_USERNAME / DMS_PASSWORD not configured')
  process.exit(0)
}

if ((process.env.DMS_TLS_INSECURE || '').toLowerCase() === 'true') {
  // Node's global toggle is acceptable here: this SCRIPT talks to exactly one
  // host. The app itself scopes the exemption per-client (src/services/dms.ts).
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

let token
try {
  const res = await fetch(`${base}/auth/token/obtain/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) throw new Error(`token endpoint answered ${res.status}`)
  token = (await res.json()).token
} catch (err) {
  log(`skipped — could not authenticate: ${err.message}`)
  process.exit(0)
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Token ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

/** Every page of a Mayan listing — a single page read is a truncation bug. */
async function listAll(path) {
  const out = []
  const sep = path.includes('?') ? '&' : '?'
  for (let page = 1; ; page += 1) {
    const body = await api(`${path}${sep}page=${page}`)
    out.push(...(body.results ?? []))
    if (!body.next) return out
  }
}

try {
  // 1. The default document type.
  const types = await listAll('/document_types/?page_size=100')
  if (types.some((t) => t.label.toLowerCase() === documentType.toLowerCase())) {
    log(`document type "${documentType}" — present`)
  } else {
    await api('/document_types/', { method: 'POST', body: { label: documentType } })
    log(`document type "${documentType}" — created`)
  }

  // 2. The root cabinet the /document facade files under.
  const cabinets = await listAll('/cabinets/?page_size=200')
  if (cabinets.some((c) => (c.full_path ?? c.label) === ROOT_CABINET)) {
    log(`cabinet /${ROOT_CABINET} — present`)
  } else {
    await api('/cabinets/', { method: 'POST', body: { label: ROOT_CABINET, parent: null } })
    log(`cabinet /${ROOT_CABINET} — created`)
  }

  log('done')
} catch (err) {
  // Never fatal — the entrypoint treats any exit as continue-anyway, and the
  // app's own lazy get-or-create covers the gap until the next boot.
  log(`failed — ${err.message}`)
  process.exit(0)
}
