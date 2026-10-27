import type { LogEvent } from 'kysely'
import { afterAll, describe, expect, it } from 'vitest'
import { db, queryLogEntry } from './kysely.js'

afterAll(async () => {
  await db.destroy()
})

// A real compiled query (nothing is run), so the event carries the SQL and
// parameters exactly as Kysely would hand them to the log hook.
const query = db
  .selectFrom('app.notes')
  .select(['note_id', 'title'])
  .where('title', 'ilike', '%ada.admin@example.dev%')
  .limit(5)
  .compile()

const ran: LogEvent = { level: 'query', query, queryDurationMillis: 3.14159 }

describe('queryLogEntry — one query as a debug log line', () => {
  it('carries the SQL, its parameters and the time it took', () => {
    expect(queryLogEntry(ran, true)).toEqual({
      sql: 'select "note_id", "title" from "app"."notes" where "title" ilike $1 limit $2',
      parameters: ['%ada.admin@example.dev%', 5],
      durationMs: 3.1,
    })
  })

  it('keeps the SQL but only counts the parameters where they may not be printed', () => {
    const entry = queryLogEntry(ran, false)
    expect(entry).toEqual({ sql: query.sql, parameterCount: 2, durationMs: 3.1 })
    expect(JSON.stringify(entry)).not.toContain('ada.admin')
  })

  it("names a failed query's SQLSTATE and never its message", () => {
    const failed: LogEvent = {
      level: 'error',
      query,
      queryDurationMillis: 1,
      error: Object.assign(new Error('Key (email)=(ada.admin@example.dev) already exists.'), {
        code: '23505',
      }),
    }
    const entry = queryLogEntry(failed, false)
    expect(entry.code).toBe('23505')
    expect(JSON.stringify(entry)).not.toContain('ada.admin')
  })
})
