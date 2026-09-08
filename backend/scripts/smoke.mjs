// End-to-end smoke against a RUNNING backend — dependency-free, prints
// PASS/FAIL per check and exits non-zero on any failure.
//
//   node scripts/smoke.mjs [baseUrl]
//
// Defaults to the dev stack: http://localhost:8081/api/v1, signing in as the
// seeded manager account. NOTE: this WRITES data (one note, deleted at the
// end) — don't point it at an environment whose data matters.
//
// Env: SMOKE_USERNAME (default manager@example.dev), SMOKE_PASSWORD
// (default: APP_DEV_PASSWORD).

const base = (process.argv[2] ?? 'http://localhost:8081/api/v1').replace(/\/+$/, '')
const serverRoot = base.replace(/\/(app|api)\/v1$/, '')
const username = process.env.SMOKE_USERNAME ?? 'manager@example.dev'
const password = process.env.SMOKE_PASSWORD ?? process.env.APP_DEV_PASSWORD

let failures = 0
let cookies = ''

const ok = (name) => console.log(`PASS  ${name}`)
const bad = (name, detail) => {
  failures += 1
  console.error(`FAIL  ${name} — ${detail}`)
}

/** One call. Carries the session cookies the login below collected. */
async function call(name, method, url, { body, expect = 200, raw = false } = {}) {
  let res
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookies ? { Cookie: cookies } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (err) {
    bad(name, `unreachable: ${err.message}`)
    return null
  }
  // Collect cookies (node fetch has no jar). Good enough for one host.
  const setCookies = res.headers.getSetCookie?.() ?? []
  if (setCookies.length) {
    const jar = new Map(
      cookies
        .split('; ')
        .filter(Boolean)
        .map((c) => [c.split('=')[0], c]),
    )
    for (const sc of setCookies) {
      const pair = sc.split(';')[0]
      jar.set(pair.split('=')[0], pair)
    }
    cookies = [...jar.values()].join('; ')
  }
  if (res.status !== expect) {
    const text = await res.text().catch(() => '')
    bad(name, `expected ${expect}, got ${res.status}: ${text.slice(0, 200)}`)
    return null
  }
  ok(name)
  if (raw || res.status === 204) return res
  return res.json().catch(() => null)
}

console.log(`\nSmoke against ${base} as ${username}\n`)

// --- health -------------------------------------------------------------------
await call('GET /health', 'GET', `${serverRoot}/health`)

// --- auth ---------------------------------------------------------------------
if (!password) {
  bad('POST /auth/login', 'no password — set SMOKE_PASSWORD or APP_DEV_PASSWORD')
} else {
  const session = await call('POST /auth/login', 'POST', `${base}/auth/login`, {
    body: { username, password },
  })
  if (session && session.authenticated !== true) bad('login body', 'authenticated !== true')
}

const me = await call('GET /me', 'GET', `${base}/me`)
if (me && me.permissions?.['notes.write'] !== true) {
  bad('GET /me permissions', `expected notes.write=true for ${username} (role ${me.role})`)
}

// --- notes CRUD -----------------------------------------------------------------
const created = await call('POST /notes', 'POST', `${base}/notes`, {
  body: { title: 'smoke note', body: 'written by scripts/smoke.mjs', tags: ['smoke'] },
  expect: 201,
})
const noteId = created?.noteId

if (noteId) {
  await call('GET /notes/:id', 'GET', `${base}/notes/${noteId}`)
  const list = await call('GET /notes?q=smoke', 'GET', `${base}/notes?q=smoke`)
  if (list && !list.items?.some((n) => n.noteId === noteId)) {
    bad('list contains the note', 'created note missing from the search')
  }
  const patched = await call('PATCH /notes/:id', 'PATCH', `${base}/notes/${noteId}`, {
    body: { body: 'edited by smoke' },
  })
  if (patched && patched.body !== 'edited by smoke') bad('patch body', 'edit did not land')
  await call('DELETE /notes/:id', 'DELETE', `${base}/notes/${noteId}`, { expect: 204, raw: true })
  await call('GET /notes/:id after delete', 'GET', `${base}/notes/${noteId}`, { expect: 404 })
} else {
  bad('notes CRUD', 'create failed — the rest of the walk was skipped')
}

// --- sign out -------------------------------------------------------------------
await call('POST /auth/logout', 'POST', `${base}/auth/logout`, { expect: 204, raw: true })

console.log(failures ? `\n${failures} failure(s)\n` : '\nAll checks passed.\n')
process.exit(failures ? 1 : 0)
