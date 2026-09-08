// The notes example's data access — the thin chain in full: one callApi()
// wrapper per operation, no SQL here, no shaping here. The app.api_notes_*
// functions (migration 0002) own the contract.
import { callApi } from '../db/pool.js'

export interface Note {
  noteId: string
  title: string
  body: string
  tags: string[]
  createdBy: string
  createdAt: string
  updatedBy: string | null
  updatedAt: string | null
}

export interface NoteList {
  items: Note[]
  total: number
}

export function listNotes(q: string | undefined, limit: number, offset: number) {
  return callApi<NoteList>('app.api_notes_list', [q ?? null, limit, offset])
}

export function getNote(noteId: string) {
  return callApi<Note>('app.api_notes_get', [noteId])
}

export function createNote(input: {
  title: string
  body?: string
  tags?: string[]
  actor: string
}) {
  return callApi<Note>('app.api_notes_create', [JSON.stringify(input)])
}

export function updateNote(
  noteId: string,
  patch: { title?: string; body?: string; tags?: string[]; actor: string },
) {
  return callApi<Note>('app.api_notes_update', [noteId, JSON.stringify(patch)])
}

export function deleteNote(noteId: string) {
  return callApi<{ deleted: boolean }>('app.api_notes_delete', [noteId])
}
