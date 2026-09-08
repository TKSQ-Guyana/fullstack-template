// The notes example's API functions — typed, thin, path-owning.
import { apiClient, qs } from '../apiClient'
import { PATHS } from './paths'

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

export interface NotePage {
  items: Note[]
  total: number
}

export const fetchNotes = (params: { q?: string; limit?: number; offset?: number } = {}) =>
  apiClient.get<NotePage>(`${PATHS.notes}${qs(params)}`)

export const fetchNote = (noteId: string) => apiClient.get<Note>(PATHS.note(noteId))

export const createNote = (input: { title: string; body?: string; tags?: string[] }) =>
  apiClient.post<Note>(PATHS.notes, { ...input, actionUuid: crypto.randomUUID() })

export const updateNote = (
  noteId: string,
  patch: { title?: string; body?: string; tags?: string[] },
) => apiClient.patch<Note>(PATHS.note(noteId), patch)

export const deleteNote = (noteId: string) => apiClient.del(PATHS.note(noteId))
