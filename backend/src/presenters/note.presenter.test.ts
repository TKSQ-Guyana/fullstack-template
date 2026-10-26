import { describe, expect, it } from 'vitest'
import type { NoteRow } from '../repositories/notes.repository.js'
import { presentNote, presentNoteList } from './note.presenter.js'

const row: NoteRow = {
  note_id: '6f1c4f0e-3a51-4c43-9a8e-1f2d3c4b5a69',
  title: 'Hello',
  body: '',
  tags: ['a'],
  created_by: 'alice',
  created_at: '2026-09-23T07:08:50.936571+00:00',
  updated_by: null,
  updated_at: null,
}

describe('note presenter', () => {
  it('shapes one row as the contract camelCase', () => {
    expect(presentNote(row)).toEqual({
      noteId: row.note_id,
      title: 'Hello',
      body: '',
      tags: ['a'],
      createdBy: 'alice',
      createdAt: '2026-09-23T07:08:50.936571+00:00',
      updatedBy: null,
      updatedAt: null,
    })
  })

  it('wraps a page with the whole list’s total', () => {
    expect(presentNoteList([row], 7)).toEqual({ items: [presentNote(row)], total: 7 })
    expect(presentNoteList([], 0)).toEqual({ items: [], total: 0 })
  })
})
