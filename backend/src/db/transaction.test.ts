import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runAsActor } from './actorContext.js'
import {
  afterCommit,
  lockRow,
  RETRYING_BEGIN,
  withReadSnapshot,
  withRetryingTransaction,
  withTransaction,
  type Tx,
} from './transaction.js'

// The pool is replaced by one fake client that records every statement, so
// the helpers' BEGIN … COMMIT / ROLLBACK sequence is checked without Postgres.
// `failures` queues an error for the next statement of that text — each entry
// is used once, as Postgres failing one attempt.
const fake = vi.hoisted(() => {
  const state = {
    statements: [] as string[],
    params: [] as unknown[],
    releases: 0,
    connects: 0,
    rowCount: 0,
    failures: [] as Array<{ text: string; err: Error }>,
  }
  const client = {
    query: (text: string, params?: unknown[]) => {
      state.statements.push(text)
      state.params.push(params)
      const at = state.failures.findIndex((f) => f.text === text)
      if (at >= 0) {
        const failure = state.failures.splice(at, 1)[0]!
        return Promise.reject(failure.err)
      }
      return Promise.resolve({ rows: [], rowCount: state.rowCount })
    },
    release: () => {
      state.releases += 1
    },
  }
  return { state, client }
})

const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }))
vi.mock('../logger.js', () => ({ logger: log }))

vi.mock('./pool.js', () => ({
  pool: {
    connect: () => {
      fake.state.connects += 1
      return Promise.resolve(fake.client)
    },
  },
}))

beforeEach(() => {
  fake.state.statements = []
  fake.state.params = []
  fake.state.releases = 0
  fake.state.connects = 0
  fake.state.rowCount = 0
  fake.state.failures = []
  log.error.mockClear()
})

/** A Postgres error as node-postgres raises it: a message and a SQLSTATE. */
const pgError = (code: string) => Object.assign(new Error(`postgres ${code}`), { code })

const SET_ACTOR = "SELECT set_config('app.actor', $1, true)"

describe('withReadSnapshot', () => {
  it('runs every statement on one client inside one REPEATABLE READ READ ONLY snapshot', async () => {
    const out = await withReadSnapshot(async (tx) => {
      await tx.query('SELECT 1')
      await tx.query('SELECT 2')
      return 'answer'
    })
    expect(out).toBe('answer')
    expect(fake.state.connects).toBe(1)
    expect(fake.state.statements).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      'SELECT 1',
      'SELECT 2',
      'COMMIT',
    ])
    expect(fake.state.releases).toBe(1)
  })

  it('publishes no actor, even inside an acting identity', async () => {
    await runAsActor('alice', () => withReadSnapshot((tx) => tx.query('SELECT 1')))
    expect(fake.state.statements).not.toContain(SET_ACTOR)
  })

  it('rolls back, releases the client and rethrows when the read throws', async () => {
    const boom = new Error('read failed')
    await expect(
      withReadSnapshot(async (tx) => {
        await tx.query('SELECT 1')
        throw boom
      }),
    ).rejects.toBe(boom)
    expect(fake.state.statements).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      'SELECT 1',
      'ROLLBACK',
    ])
    expect(fake.state.releases).toBe(1)
  })
})

describe('withTransaction', () => {
  it('opens a plain BEGIN and publishes the acting identity before the work', async () => {
    await runAsActor('alice', () => withTransaction((tx) => tx.query('UPDATE x')))
    expect(fake.state.statements).toEqual(['BEGIN', SET_ACTOR, 'UPDATE x', 'COMMIT'])
    expect(fake.state.params[1]).toEqual(['alice'])
    expect(fake.state.releases).toBe(1)
  })

  it('takes the actor option over the ambient one, and none when it is null', async () => {
    await runAsActor('alice', () => withTransaction((tx) => tx.query('UPDATE x'), { actor: null }))
    expect(fake.state.statements).toEqual(['BEGIN', 'UPDATE x', 'COMMIT'])
  })

  it("publishes a named actor option (a job's 'system') over the ambient one", async () => {
    await runAsActor('alice', () =>
      withTransaction((tx) => tx.query('UPDATE x'), { actor: 'system' }),
    )
    expect(fake.state.statements).toEqual(['BEGIN', SET_ACTOR, 'UPDATE x', 'COMMIT'])
    expect(fake.state.params[1]).toEqual(['system'])
  })

  it('does NOT retry: a serialization failure propagates for the error handler', async () => {
    fake.state.failures.push({ text: 'UPDATE x', err: pgError('40001') })
    await expect(
      withTransaction((tx) => tx.query('UPDATE x'), { actor: null }),
    ).rejects.toMatchObject({ code: '40001' })
    expect(fake.state.connects).toBe(1)
  })
})

describe('withRetryingTransaction', () => {
  it('opens a write-capable REPEATABLE READ snapshot and publishes the acting identity', async () => {
    const out = await runAsActor('alice', () =>
      withRetryingTransaction(async (tx) => {
        await tx.query('UPDATE x')
        return 'done'
      }),
    )
    expect(out).toBe('done')
    expect(RETRYING_BEGIN).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ')
    expect(fake.state.statements).toEqual([RETRYING_BEGIN, SET_ACTOR, 'UPDATE x', 'COMMIT'])
    expect(fake.state.params[1]).toEqual(['alice'])
    expect(fake.state.connects).toBe(1)
    expect(fake.state.releases).toBe(1)
  })

  it.each(['40001', '40P01'])(
    'rolls back on %s and runs the work again on a fresh client, which commits',
    async (code) => {
      fake.state.failures.push({ text: 'UPDATE x', err: pgError(code) })
      let runs = 0
      const out = await withRetryingTransaction(
        async (tx) => {
          runs += 1
          await tx.query('UPDATE x')
          return runs
        },
        { actor: null },
      )
      expect(out).toBe(2)
      expect(fake.state.statements).toEqual([
        RETRYING_BEGIN,
        'UPDATE x',
        'ROLLBACK',
        RETRYING_BEGIN,
        'UPDATE x',
        'COMMIT',
      ])
      expect(fake.state.connects).toBe(2)
      expect(fake.state.releases).toBe(2)
    },
  )

  it('retries a serialization failure raised at COMMIT', async () => {
    fake.state.failures.push({ text: 'COMMIT', err: pgError('40001') })
    await withRetryingTransaction((tx) => tx.query('UPDATE x'), { actor: null })
    expect(fake.state.statements).toEqual([
      RETRYING_BEGIN,
      'UPDATE x',
      'COMMIT',
      'ROLLBACK',
      RETRYING_BEGIN,
      'UPDATE x',
      'COMMIT',
    ])
  })

  it('propagates any other error after ROLLBACK, with no second attempt', async () => {
    const unique = pgError('23505')
    fake.state.failures.push({ text: 'UPDATE x', err: unique })
    await expect(
      withRetryingTransaction((tx) => tx.query('UPDATE x'), { actor: null }),
    ).rejects.toBe(unique)
    expect(fake.state.statements).toEqual([RETRYING_BEGIN, 'UPDATE x', 'ROLLBACK'])
    expect(fake.state.connects).toBe(1)
    expect(fake.state.releases).toBe(1)
  })

  it('propagates the last error untouched once the attempts are used up', async () => {
    const first = pgError('40001')
    const second = pgError('40P01')
    fake.state.failures.push({ text: 'UPDATE x', err: first })
    fake.state.failures.push({ text: 'UPDATE x', err: second })
    await expect(
      withRetryingTransaction((tx) => tx.query('UPDATE x'), { actor: null, attempts: 2 }),
    ).rejects.toBe(second)
    expect(fake.state.statements).toEqual([
      RETRYING_BEGIN,
      'UPDATE x',
      'ROLLBACK',
      RETRYING_BEGIN,
      'UPDATE x',
      'ROLLBACK',
    ])
    expect(fake.state.releases).toBe(2)
  })

  it('makes three attempts by default', async () => {
    for (let i = 0; i < 3; i += 1) {
      fake.state.failures.push({ text: 'UPDATE x', err: pgError('40001') })
    }
    await expect(
      withRetryingTransaction((tx) => tx.query('UPDATE x'), { actor: null }),
    ).rejects.toMatchObject({ code: '40001' })
    expect(fake.state.connects).toBe(3)
    expect(fake.state.statements.filter((s) => s === RETRYING_BEGIN)).toHaveLength(3)
  })
})

describe('afterCommit', () => {
  it('runs the registered actions in order once withTransaction has committed', async () => {
    const seen: string[] = []
    const out = await withTransaction(
      async (tx) => {
        afterCommit(() => {
          seen.push(`first, after ${fake.state.statements.at(-1)}`)
        })
        afterCommit(async () => {
          await Promise.resolve()
          seen.push('second')
        })
        await tx.query('UPDATE x')
        seen.push('work done')
        return 'answer'
      },
      { actor: null },
    )
    expect(out).toBe('answer')
    expect(seen).toEqual(['work done', 'first, after COMMIT', 'second'])
  })

  it('never runs an action when the transaction rolls back', async () => {
    const action = vi.fn()
    const boom = new Error('work failed')
    await expect(
      withTransaction(
        () => {
          afterCommit(action)
          return Promise.reject(boom)
        },
        { actor: null },
      ),
    ).rejects.toBe(boom)
    expect(fake.state.statements).toEqual(['BEGIN', 'ROLLBACK'])
    expect(action).not.toHaveBeenCalled()
  })

  it('runs only the committing attempt’s actions on a retried transaction', async () => {
    fake.state.failures.push({ text: 'UPDATE x', err: pgError('40001') })
    const ran: number[] = []
    let attempt = 0
    await withRetryingTransaction(
      async (tx) => {
        attempt += 1
        const mine = attempt
        afterCommit(() => {
          ran.push(mine)
        })
        await tx.query('UPDATE x')
      },
      { actor: null },
    )
    expect(attempt).toBe(2)
    expect(ran).toEqual([2])
  })

  it('logs an action that throws, runs the rest, and does not fail the use-case', async () => {
    const later = vi.fn()
    const out = await withTransaction(
      () => {
        afterCommit(() => {
          throw new Error('mail relay down')
        })
        afterCommit(later)
        return Promise.resolve('saved')
      },
      { actor: null },
    )
    expect(out).toBe('saved')
    expect(later).toHaveBeenCalledOnce()
    expect(log.error).toHaveBeenCalledOnce()
  })

  it('throws outside a write transaction, and inside a read snapshot alone', async () => {
    expect(() => afterCommit(() => undefined)).toThrow(/outside withTransaction/)
    await expect(
      withReadSnapshot(() => {
        afterCommit(() => undefined)
        return Promise.resolve()
      }),
    ).rejects.toThrow(/outside withTransaction/)
  })
})

describe('lockRow', () => {
  const tx = fake.client as unknown as Tx

  it('takes the row FOR UPDATE with the key as a parameter, and says whether it exists', async () => {
    fake.state.rowCount = 1
    await expect(lockRow(tx, 'app.notes', 'note_id', 'abc')).resolves.toBe(true)
    expect(fake.state.statements).toEqual(['SELECT 1 FROM app.notes WHERE note_id = $1 FOR UPDATE'])
    expect(fake.state.params).toEqual([['abc']])
    fake.state.rowCount = 0
    await expect(lockRow(tx, 'app.notes', 'note_id', 'missing')).resolves.toBe(false)
  })

  it('refuses a key column that is not a bare identifier, before any SQL', async () => {
    await expect(lockRow(tx, 'app.notes', 'note_id = note_id OR 1', 'x')).rejects.toThrow(
      /not a column name/,
    )
    expect(fake.state.statements).toEqual([])
  })
})
