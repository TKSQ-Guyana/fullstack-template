// Notes — the example's use-cases, and the service pattern to copy: apply the
// domain's rules, run the repository calls in ONE transaction (or one read
// snapshot), answer with the presenter's JSON. A missing note is a
// DomainError here, so the controller never inspects a result to decide its
// status.
import { onTx } from '../db/kysely.js'
import { withReadSnapshot, withTransaction } from '../db/transaction.js'
import { newNote, noteNotFound, notePage, notePatch } from '../domain/notes.js'
import { presentNote, presentNoteList } from '../presenters/note.presenter.js'
import * as notes from '../repositories/notes.repository.js'

/** A page of notes and the whole list's size — both read from one snapshot,
 *  so the total always describes the rows beside it. */
export function listNotes(opts: { q?: string; limit?: number; offset?: number }) {
  const q = opts.q || null
  const page = notePage(opts.limit, opts.offset)
  return withReadSnapshot(async (tx) => {
    const k = onTx(tx)
    const total = await notes.count(q, k)
    const rows = await notes.page(q, page, k)
    return presentNoteList(rows, total)
  })
}

export async function getNote(noteId: string) {
  const row = await notes.findById(noteId)
  if (!row) throw noteNotFound()
  return presentNote(row)
}

export async function createNote(input: { title: string; body?: string; tags?: string[] }) {
  const note = newNote(input)
  const row = await withTransaction((tx) => notes.insert(note, onTx(tx)))
  return presentNote(row)
}

export async function updateNote(
  noteId: string,
  input: { title?: string; body?: string; tags?: string[] },
) {
  const patch = notePatch(input)
  const row = await withTransaction((tx) => notes.update(noteId, patch, onTx(tx)))
  if (!row) throw noteNotFound()
  return presentNote(row)
}

export async function deleteNote(noteId: string): Promise<void> {
  const deleted = await withTransaction((tx) => notes.remove(noteId, onTx(tx)))
  if (!deleted) throw noteNotFound()
}
