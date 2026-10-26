// The notes example's RULES — pure TypeScript, no IO, unit-tested beside it
// (notes.test.ts). This is the layer to copy for your first real entity:
// whatever a note must be, and whatever a change to one may do, is decided
// here and nowhere else. The service (services/notes.ts) applies these inside
// a transaction; the repository only stores what they produce.

import { ensure, notFound } from './errors.js'

/** The sentences a refusal answers with — contract, shown verbatim. */
export const NOTE_TITLE_REQUIRED = 'A note needs a title.'
export const NOTE_NOT_FOUND = 'No such note.'

/** What a new note is made of, once the rules have had their say. */
export interface NewNote {
  title: string
  body: string
  tags: string[]
}

/** The fields a change touches — absent means "leave as it is". */
export type NotePatch = Partial<NewNote>

/** A title is trimmed, and a blank one is refused. */
export function noteTitle(raw: string): string {
  const title = raw.trim()
  ensure(title.length > 0, NOTE_TITLE_REQUIRED)
  return title
}

/** A new note: a title it cannot do without, an empty body and no tags by default. */
export function newNote(input: { title: string; body?: string; tags?: string[] }): NewNote {
  return {
    title: noteTitle(input.title),
    body: input.body ?? '',
    tags: input.tags ?? [],
  }
}

/** A change to a note: only the fields it names, the title under the same rule. */
export function notePatch(input: { title?: string; body?: string; tags?: string[] }): NotePatch {
  const patch: NotePatch = {}
  if (input.title !== undefined) patch.title = noteTitle(input.title)
  if (input.body !== undefined) patch.body = input.body
  if (input.tags !== undefined) patch.tags = input.tags
  return patch
}

export const DEFAULT_PAGE_SIZE = 50

/**
 * The page a list reads: no limit (or zero) is the default page, and nothing
 * pages from before the first row. The controller caps the upper end.
 */
export function notePage(limit: number | undefined, offset: number | undefined) {
  return {
    limit: limit && limit > 0 ? limit : DEFAULT_PAGE_SIZE,
    offset: offset && offset > 0 ? offset : 0,
  }
}

/** The one way a missing note is reported, whichever use-case missed it. */
export const noteNotFound = () => notFound(NOTE_NOT_FOUND)
