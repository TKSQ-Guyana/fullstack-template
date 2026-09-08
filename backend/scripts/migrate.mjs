// Plain-SQL migration runner over pg.
//
// Why not a framework: the migrations ARE the SQL files (schema + api
// functions) and they must run verbatim, dollar-quoted bodies and all. This
// runner applies migrations/NNNN_name.sql in filename order, each inside its
// own transaction, and records what ran in public.app_migrations. `down` runs
// the paired NNNN_name.down.sql when one exists.
//
// Usage: node scripts/migrate.mjs up | down | status
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(here, '..', 'migrations')

// .env is read by the app through --env-file; this script runs standalone
// (CI, container entrypoint), so it loads the file itself when present.
if (!process.env.DATABASE_URL && existsSync(path.join(here, '..', '.env'))) {
  const dotenv = await import('dotenv')
  dotenv.config({ path: path.join(here, '..', '.env') })
}

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/app_db'

const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()

async function ensureTable() {
  // Not every target database HAS a public schema (a shared database where it
  // was dropped fails the very first `migrate up` on this table). IF NOT
  // EXISTS keeps every existing environment untouched, and a user privileged
  // enough to create the app schema (0001) can create this one too. The
  // bookkeeping table stays in public deliberately: it must exist before any
  // app-schema migration has run.
  await client.query('CREATE SCHEMA IF NOT EXISTS public')
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.app_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
}

async function appliedNames() {
  const { rows } = await client.query('SELECT name FROM public.app_migrations ORDER BY name')
  return new Set(rows.map((r) => r.name))
}

async function migrationFiles() {
  const files = await readdir(migrationsDir)
  return files.filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql')).sort()
}

const command = process.argv[2] ?? 'up'

try {
  await ensureTable()
  const applied = await appliedNames()
  const files = await migrationFiles()

  if (command === 'status') {
    for (const f of files) console.log(`${applied.has(f) ? '[x]' : '[ ]'} ${f}`)
  } else if (command === 'up') {
    const pending = files.filter((f) => !applied.has(f))
    if (!pending.length) console.log('migrations: nothing to apply')
    for (const f of pending) {
      const sql = await readFile(path.join(migrationsDir, f), 'utf8')
      console.log(`applying ${f} ...`)
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO public.app_migrations (name) VALUES ($1)', [f])
        await client.query('COMMIT')
        console.log(`applied  ${f}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`migration ${f} failed: ${err.message}`)
      }
    }
  } else if (command === 'down') {
    const done = files.filter((f) => applied.has(f))
    const last = done[done.length - 1]
    if (!last) {
      console.log('migrations: nothing applied')
    } else {
      const downFile = path.join(migrationsDir, last.replace(/\.sql$/, '.down.sql'))
      if (!existsSync(downFile)) throw new Error(`no down file for ${last}`)
      const sql = await readFile(downFile, 'utf8')
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('DELETE FROM public.app_migrations WHERE name = $1', [last])
      await client.query('COMMIT')
      console.log(`reverted ${last}`)
    }
  } else {
    throw new Error(`unknown command: ${command} (use up | down | status)`)
  }
} finally {
  await client.end()
}
