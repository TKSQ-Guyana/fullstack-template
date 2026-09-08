// Rename the template's identity for a fork — step 1 after "Use this template".
//
//   node scripts/init-template.mjs <slug> ["Display Name"]
//   e.g. node scripts/init-template.mjs payroll "Payroll Portal"
//
// WHAT IT RENAMES (consistent literals, safe to replace project-wide):
//   fullstack-template          -> <slug>                (repo/package identity)
//   App Portal                  -> <Display Name>        (chrome + mail wording)
//   app-realm                   -> <slug>-realm          (Keycloak realm)
//   web-app                     -> <slug>-web            (the SPA client)
//   app-provisioning-service    -> <slug>-provisioning-service
//   app-dev- (container names)  -> <slug>-dev-
//
// WHAT IT LEAVES ALONE, deliberately: the `app.` database schema, the
// app_access/app_refresh cookies, the app_* notify channels, the APP_* env
// prefix and realm roles, and the /app/v1 base path. Those are internal
// spellings a product never shows anybody; renaming them buys nothing and
// touches migrations. If you want them renamed anyway, grep for `app` — every
// occurrence is a deliberate, documented literal.
//
// Idempotent-ish: running it twice finds nothing left to replace.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [slug, displayName] = process.argv.slice(2)
if (!slug || !/^[a-z][a-z0-9-]{1,40}$/.test(slug)) {
  console.error('usage: node scripts/init-template.mjs <slug> ["Display Name"]')
  console.error('       slug: lowercase letters, digits, hyphens (e.g. payroll-portal)')
  process.exit(1)
}
const title = displayName || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage'])
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.yml', '.yaml', '.html', '.css',
  '.sh', '.envsh', '.env', '.example', '.sql', '.template', '.dev',
])

const REPLACEMENTS = [
  ['fullstack-template', slug],
  ['app-provisioning-service', `${slug}-provisioning-service`],
  ['app-realm', `${slug}-realm`],
  ['web-app', `${slug}-web`],
  ['app-dev-', `${slug}-dev-`],
  ['App Portal', title],
]

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name))
    } else {
      yield path.join(dir, entry.name)
    }
  }
}

let filesChanged = 0
let total = 0
for await (const file of walk(ROOT)) {
  const ext = path.extname(file) || path.basename(file)
  const named = path.basename(file)
  if (!TEXT_EXT.has(ext) && !named.startsWith('.env') && named !== 'Dockerfile') continue
  if (path.resolve(file) === path.resolve(ROOT, 'scripts', 'init-template.mjs')) continue

  const before = await readFile(file, 'utf8').catch(() => null)
  if (before == null) continue
  let after = before
  for (const [from, to] of REPLACEMENTS) after = after.split(from).join(to)
  if (after !== before) {
    await writeFile(file, after, 'utf8')
    const count = REPLACEMENTS.reduce(
      (n, [from]) => n + (before.split(from).length - 1),
      0,
    )
    total += count
    filesChanged += 1
    console.log(`  ${path.relative(ROOT, file)} (${count})`)
  }
}

console.log(`\nRenamed to "${title}" (${slug}): ${total} replacements across ${filesChanged} files.`)
console.log('Next: review the diff, run the gates (npm run pre-push-check per workspace),')
console.log('then `docker compose -f docker-compose.dev.yml down -v` and a fresh `up --build`')
console.log('(the realm import and the seeder must run against the new names).')
