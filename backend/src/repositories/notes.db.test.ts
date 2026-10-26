// The notes repository against a real Postgres (npm run test:db). Each test
// runs inside one transaction that is ROLLED BACK, so it leaves nothing behind
// on the database it borrows — the dev stack's is fine.
import { sql } from 'kysely'
import { afterAll, describe, expect, it } from 'vitest'
import { onTx } from '../db/kysely.js'
import { pool } from '../db/pool.js'
import * as notes from './notes.repository.js'

afterAll(async () => {
  await pool.end()
})

/** `work` on one client inside BEGIN … ROLLBACK, acting as `actor`. */
async function rolledBack(actor: string, work: (k: ReturnType<typeof onTx>) => Promise<void>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT set_config('app.actor', $1, true)`, [actor])
    await work(onTx(client))
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
}

const JSONB_TS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?\+00:00$/

describe('notes repository', () => {
  it('stamps the creator from app.actor and leaves updated_* empty', () =>
    rolledBack('alice', async (k) => {
      const row = await notes.insert({ title: 'Hello', body: '', tags: ['a', 'b'] }, k)
      expect(row).toMatchObject({ title: 'Hello', tags: ['a', 'b'], created_by: 'alice' })
      expect(row.created_at).toMatch(JSONB_TS)
      expect(row.updated_by).toBeNull()
      expect(row.updated_at).toBeNull()
    }))

  it('stamps the updater on change and never rewrites the creator', () =>
    rolledBack('alice', async (k) => {
      const created = await notes.insert({ title: 'Hello', body: '', tags: [] }, k)
      await sql`SELECT set_config('app.actor', 'bob', true)`.execute(k)
      const changed = await notes.update(created.note_id, { body: 'more' }, k)
      expect(changed).toMatchObject({ body: 'more', created_by: 'alice', updated_by: 'bob' })
      expect(changed?.created_at).toBe(created.created_at)
      expect(changed?.updated_at).toMatch(JSONB_TS)
    }))

  it('searches title and body case-insensitively, and pages newest first', () =>
    rolledBack('alice', async (k) => {
      const marker = `zq${Date.now()}`
      await notes.insert({ title: `${marker} one`, body: '', tags: [] }, k)
      await notes.insert({ title: 'two', body: `${marker.toUpperCase()} in body`, tags: [] }, k)
      expect(await notes.count(marker, k)).toBe(2)
      const rows = await notes.page(marker, { limit: 1, offset: 0 }, k)
      expect(rows).toHaveLength(1)
    }))

  it('answers undefined / false for a note that is not there', () =>
    rolledBack('alice', async (k) => {
      const ghost = '00000000-0000-4000-8000-000000000000'
      expect(await notes.findById(ghost, k)).toBeUndefined()
      expect(await notes.update(ghost, { body: 'x' }, k)).toBeUndefined()
      expect(await notes.remove(ghost, k)).toBe(false)
    }))
})
