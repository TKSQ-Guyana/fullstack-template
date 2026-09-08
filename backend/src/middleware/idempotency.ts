// Idempotency — actionUuid answers 409 on replay.
//
// Creates carrying a natural unique key are enforced by the DB regardless.
// actionUuid has no natural constraint, so it is recorded here: Redis SET NX
// when available (fast, shared), otherwise the app.action_idempotency table
// (durable, single- or multi-instance).
import { pool } from '../db/pool.js'
import { redis } from '../redis/client.js'
import { conflict } from '../http/problem.js'

const TTL_SECONDS = 24 * 60 * 60

/**
 * Record the action UUID; throw 409 when it was already seen.
 * A null/undefined uuid passes through — callers decide whether to require it.
 */
export async function assertFirstUse(
  actionUuid: unknown,
  meta: { actor: string; action: string; subject?: string },
): Promise<void> {
  if (typeof actionUuid !== 'string' || !actionUuid.trim()) return

  if (redis && redis.status === 'ready') {
    const key = `app:idem:${actionUuid}`
    const set = await redis.set(key, meta.action, 'EX', TTL_SECONDS, 'NX')
    if (set === null) throw replay(actionUuid)
    return
  }

  const { rowCount } = await pool.query(
    `INSERT INTO app.action_idempotency (action_uuid, subject, actor, action)
     VALUES ($1, $2, $3, $4) ON CONFLICT (action_uuid) DO NOTHING`,
    [actionUuid, meta.subject ?? null, meta.actor, meta.action],
  )
  if (!rowCount) throw replay(actionUuid)
}

const replay = (uuid: string) =>
  conflict(`actionUuid ${uuid} was already processed — this is a replay of an earlier call.`)
