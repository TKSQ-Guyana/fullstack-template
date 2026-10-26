// Notes — the example entity's SQL, and nothing but SQL: no rule decides
// anything here (domain/notes.ts does) and no JSON is shaped here
// (presenters/note.presenter.ts does).
//
// Every function takes the Kysely instance it runs on, defaulting to the
// pool's: a service inside withTransaction / withReadSnapshot passes
// `onTx(tx)`, so the use-case's statements share one connection and one
// snapshot. created_by / updated_by are never written here — the audit-stamp
// trigger fills them from the transaction's `app.actor`.
import type { Kysely } from 'kysely'
import { db, type DB } from '../db/kysely.js'
import type { NewNote, NotePatch } from '../domain/notes.js'

/**
 * One row as the driver hands it over. Timestamps are TEXT in jsonb's form
 * (db/pool.ts's type parsers), not the Date the generated schema assumes —
 * hence the `$castTo<NoteRow>()` on every read below.
 */
export interface NoteRow {
  note_id: string
  title: string
  body: string
  tags: string[]
  created_by: string
  created_at: string
  updated_by: string | null
  updated_at: string | null
}

const COLUMNS = [
  'note_id',
  'title',
  'body',
  'tags',
  'created_by',
  'created_at',
  'updated_by',
  'updated_at',
] as const

/** The list's own WHERE — one place, shared by the count and the page. A
 *  blank search matches everything; otherwise a substring of title or body,
 *  case-insensitive. */
function matching(k: Kysely<DB>, q: string | null) {
  const notes = k.selectFrom('app.notes')
  if (!q) return notes
  return notes.where((eb) => eb.or([eb('title', 'ilike', `%${q}%`), eb('body', 'ilike', `%${q}%`)]))
}

export async function count(q: string | null, k: Kysely<DB> = db): Promise<number> {
  const row = await matching(k, q)
    .select((eb) => eb.fn.countAll<string>().as('total'))
    .executeTakeFirstOrThrow()
  return Number(row.total)
}

/** One page, newest first. */
export function page(
  q: string | null,
  { limit, offset }: { limit: number; offset: number },
  k: Kysely<DB> = db,
): Promise<NoteRow[]> {
  return matching(k, q)
    .select(COLUMNS)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .$castTo<NoteRow>()
    .execute()
}

export function findById(noteId: string, k: Kysely<DB> = db): Promise<NoteRow | undefined> {
  return k
    .selectFrom('app.notes')
    .select(COLUMNS)
    .where('note_id', '=', noteId)
    .$castTo<NoteRow>()
    .executeTakeFirst()
}

export function insert(note: NewNote, k: Kysely<DB> = db): Promise<NoteRow> {
  return k
    .insertInto('app.notes')
    .values({ title: note.title, body: note.body, tags: note.tags })
    .returning(COLUMNS)
    .$castTo<NoteRow>()
    .executeTakeFirstOrThrow()
}

/** The changed row, or undefined when there is no such note. */
export function update(
  noteId: string,
  patch: NotePatch,
  k: Kysely<DB> = db,
): Promise<NoteRow | undefined> {
  return k
    .updateTable('app.notes')
    .set(patch)
    .where('note_id', '=', noteId)
    .returning(COLUMNS)
    .$castTo<NoteRow>()
    .executeTakeFirst()
}

/** Whether a row was there to delete. */
export async function remove(noteId: string, k: Kysely<DB> = db): Promise<boolean> {
  const result = await k.deleteFrom('app.notes').where('note_id', '=', noteId).executeTakeFirst()
  return result.numDeletedRows > 0n
}
