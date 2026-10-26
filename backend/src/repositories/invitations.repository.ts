// Set-password invitations — the SQL of app.password_invitations. The rules
// that make these rows a credential path (hash-only storage, the one-UPDATE
// claim, expiry judged by the database's clock) are spelled out in
// services/passwordInvitations.ts; this file is where each one becomes a
// statement, and it is written so that none can be broken by a caller:
// every "live" test is `used_at IS NULL AND expires_at > now()` IN the query.
import { sql, type Kysely } from 'kysely'
import { db, type DB } from '../db/kysely.js'

/** The register's row — the latest invitation per account. Timestamps are
 *  jsonb-form text (db/pool.ts). */
export interface InvitationRow {
  kc_user_id: string
  username: string
  email: string
  purpose: string
  created_by: string | null
  created_at: string
  expires_at: string
  used_at: string | null
  mailed: boolean
}

// Typed as the column's declared type so Kysely accepts it in comparisons;
// the value never reaches JavaScript.
const now = sql<Date>`now()`

/** Expire every still-usable invitation for the account (revoke, don't delete:
 *  the register still shows one was issued and superseded). */
export async function expireLive(kcUserId: string, k: Kysely<DB> = db): Promise<void> {
  await k
    .updateTable('app.password_invitations')
    .set({ expires_at: now })
    .where('kc_user_id', '=', kcUserId)
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .execute()
}

export async function insert(
  row: {
    tokenHash: string
    kcUserId: string
    username: string
    email: string
    purpose: string
    createdBy: string | null
    expiresAt: Date
  },
  k: Kysely<DB> = db,
): Promise<void> {
  await k
    .insertInto('app.password_invitations')
    .values({
      token_hash: row.tokenHash,
      kc_user_id: row.kcUserId,
      username: row.username,
      email: row.email,
      purpose: row.purpose,
      created_by: row.createdBy,
      expires_at: row.expiresAt,
    })
    .execute()
}

/** Spent and long-expired rows, kept 30 days for "was this person ever invited". */
export async function sweepExpired(k: Kysely<DB> = db): Promise<void> {
  await k
    .deleteFrom('app.password_invitations')
    .where('expires_at', '<', sql<Date>`now() - interval '30 days'`)
    .execute()
}

export async function markMailed(tokenHash: string, k: Kysely<DB> = db): Promise<void> {
  await k
    .updateTable('app.password_invitations')
    .set({ mailed: true })
    .where('token_hash', '=', tokenHash)
    .execute()
}

/** The live invitation behind a token hash, or undefined (spent, stale, unknown alike). */
export function findLive(
  tokenHash: string,
  k: Kysely<DB> = db,
): Promise<{ username: string; expires_at: string } | undefined> {
  return k
    .selectFrom('app.password_invitations')
    .select(['username', 'expires_at'])
    .where('token_hash', '=', tokenHash)
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .$castTo<{ username: string; expires_at: string }>()
    .executeTakeFirst()
}

/** Spend the invitation in ONE statement — two racing claims cannot both win. */
export function claim(
  tokenHash: string,
  k: Kysely<DB> = db,
): Promise<{ kc_user_id: string; username: string; email: string } | undefined> {
  return k
    .updateTable('app.password_invitations')
    .set({ used_at: now })
    .where('token_hash', '=', tokenHash)
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .returning(['kc_user_id', 'username', 'email'])
    .executeTakeFirst()
}

/** Un-spend a claim; how many rows it touched. */
export async function release(tokenHash: string, k: Kysely<DB> = db): Promise<number> {
  const result = await k
    .updateTable('app.password_invitations')
    .set({ used_at: null })
    .where('token_hash', '=', tokenHash)
    .executeTakeFirst()
  return Number(result.numUpdatedRows)
}

/** Every account's LATEST invitation, whatever became of it. */
export function latestPerAccount(k: Kysely<DB> = db): Promise<InvitationRow[]> {
  return k
    .selectFrom('app.password_invitations')
    .distinctOn('kc_user_id')
    .select([
      'kc_user_id',
      'username',
      'email',
      'purpose',
      'created_by',
      'created_at',
      'expires_at',
      'used_at',
      'mailed',
    ])
    .orderBy('kc_user_id')
    .orderBy('created_at', 'desc')
    .$castTo<InvitationRow>()
    .execute()
}
