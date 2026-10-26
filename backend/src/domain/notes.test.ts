import { describe, expect, it } from 'vitest'
import { DomainError } from './errors.js'
import { DEFAULT_PAGE_SIZE, NOTE_TITLE_REQUIRED, newNote, notePage, notePatch } from './notes.js'

const refusal = (fn: () => unknown) => {
  try {
    fn()
  } catch (err) {
    return err instanceof DomainError ? { status: err.status, message: err.message } : err
  }
  return null
}

describe('newNote', () => {
  it('trims the title and defaults body and tags', () => {
    expect(newNote({ title: '  Hello  ' })).toEqual({ title: 'Hello', body: '', tags: [] })
  })

  it('keeps the body and tags it is given', () => {
    expect(newNote({ title: 't', body: ' b ', tags: ['x'] })).toEqual({
      title: 't',
      body: ' b ',
      tags: ['x'],
    })
  })

  it('refuses a blank title with 422 and the contract sentence', () => {
    expect(refusal(() => newNote({ title: '   ' }))).toEqual({
      status: 422,
      message: NOTE_TITLE_REQUIRED,
    })
  })
})

describe('notePatch', () => {
  it('names only the fields the change names', () => {
    expect(notePatch({})).toEqual({})
    expect(notePatch({ body: '' })).toEqual({ body: '' })
    expect(notePatch({ tags: [] })).toEqual({ tags: [] })
  })

  it('applies the title rule to a renamed note', () => {
    expect(notePatch({ title: ' New ' })).toEqual({ title: 'New' })
    expect(refusal(() => notePatch({ title: '' }))).toEqual({
      status: 422,
      message: NOTE_TITLE_REQUIRED,
    })
  })
})

describe('notePage', () => {
  it('reads the default page when no limit (or zero) is asked for', () => {
    expect(notePage(undefined, undefined)).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 })
    expect(notePage(0, 0)).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 })
  })

  it('never pages from before the first row', () => {
    expect(notePage(-5, -1)).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 })
    expect(notePage(10, 20)).toEqual({ limit: 10, offset: 20 })
  })
})
