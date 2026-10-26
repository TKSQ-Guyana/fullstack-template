// The transaction helpers against a real Postgres (npm run test:db): two
// writers that read a row and then change it, at the same moment. Each test
// creates its own note and deletes it afterwards.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pool } from './pool.js'
import { lockRow, withRetryingTransaction, withTransaction, type Tx } from './transaction.js'

let noteId = ''

beforeEach(async () => {
  const { rows } = await pool.query<{ note_id: string }>(
    `INSERT INTO app.notes (title, body) VALUES ('concurrency probe', '') RETURNING note_id`,
  )
  noteId = rows[0]!.note_id
})

afterEach(async () => {
  await pool.query('DELETE FROM app.notes WHERE note_id = $1', [noteId])
})

afterAll(async () => {
  await pool.end()
})

/** Resolves once `count` callers have arrived — every first attempt reads
 *  before any of them writes. */
function barrier(count: number) {
  let arrived = 0
  let open!: () => void
  const opened = new Promise<void>((resolve) => (open = resolve))
  return () => {
    arrived += 1
    if (arrived === count) open()
    return opened
  }
}

const bodyOf = async () =>
  (await pool.query<{ body: string }>('SELECT body FROM app.notes WHERE note_id = $1', [noteId]))
    .rows[0]!.body

/** Read the body, wait for the other writer to have read too (first attempt
 *  only), then write it back with one more letter — a read-decide-write. */
async function append(tx: Tx, letter: string, firstRead: () => Promise<void>, attempt: number) {
  const { rows } = await tx.query<{ body: string }>(
    'SELECT body FROM app.notes WHERE note_id = $1',
    [noteId],
  )
  if (attempt === 1) await firstRead()
  await tx.query('UPDATE app.notes SET body = $2 WHERE note_id = $1', [
    noteId,
    rows[0]!.body + letter,
  ])
}

describe('withRetryingTransaction against Postgres', () => {
  it('turns a real serialization failure into a retry, and no write is lost', async () => {
    const bothRead = barrier(2)
    const attempts = { a: 0, b: 0 }
    const writer = (letter: 'a' | 'b') =>
      withRetryingTransaction((tx) => append(tx, letter, bothRead, (attempts[letter] += 1)), {
        actor: 'test',
      })

    await Promise.all([writer('a'), writer('b')])

    // One writer committed first; the other met 40001 on its UPDATE and ran again.
    expect(attempts.a + attempts.b).toBe(3)
    expect((await bodyOf()).split('').sort().join('')).toBe('ab')
  })
})

describe('lockRow against Postgres', () => {
  it('queues the second writer behind the first, so neither needs a retry', async () => {
    const attempts = { a: 0, b: 0 }
    const writer = (letter: 'a' | 'b') =>
      withTransaction(
        async (tx) => {
          attempts[letter] += 1
          expect(await lockRow(tx, 'app.notes', 'note_id', noteId)).toBe(true)
          await append(tx, letter, () => Promise.resolve(), attempts[letter])
        },
        { actor: 'test' },
      )

    await Promise.all([writer('a'), writer('b')])

    expect(attempts).toEqual({ a: 1, b: 1 })
    expect((await bodyOf()).split('').sort().join('')).toBe('ab')
  })

  it('answers false for a row that is not there', async () => {
    await withTransaction(async (tx) => {
      expect(
        await lockRow(tx, 'app.notes', 'note_id', '00000000-0000-4000-8000-000000000000'),
      ).toBe(false)
    })
  })
})
