// Note presenters — the JSON of /notes. One row → the contract's camelCase
// shape, defined once and reused by every answer so the list and the detail
// can never disagree (openapi.yaml `Note` / `NoteList`).
import type { NoteRow } from '../repositories/notes.repository.js'
import { ts, type Json } from './json.js'

export const presentNote = (n: NoteRow): Json => ({
  noteId: n.note_id,
  title: n.title,
  body: n.body,
  tags: n.tags,
  createdBy: n.created_by,
  createdAt: ts(n.created_at),
  updatedBy: n.updated_by,
  updatedAt: ts(n.updated_at),
})

/** A page of notes and the size of the whole list, so a client can page without a second count. */
export const presentNoteList = (rows: NoteRow[], total: number): Json => ({
  items: rows.map(presentNote),
  total,
})
