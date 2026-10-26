// /notes — the example feature's HTTP surface, and the controller pattern to
// copy: RBAC gate -> read and shape-check the request -> one service call ->
// answer. Nothing else: the rules are the domain's (domain/notes.ts), the SQL
// the repository's, the JSON the presenter's, and a refusal or a missing note
// arrives as a DomainError the error handler answers.
import { Router, type Request, type Response } from 'express'
import { badRequest, notFound } from '../http/problem.js'
import { principalOf } from '../middleware/auth.js'
import { requireOperation } from '../middleware/rbac.js'
import { assertFirstUse } from '../middleware/idempotency.js'
import * as notes from '../services/notes.js'
import { qint, qstr } from '../utils/query.js'

export const notesRouter = Router()

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const idOf = (req: Request): string => {
  const raw = req.params.noteId
  const id = typeof raw === 'string' ? raw : ''
  // Checked here so a malformed id is a clean 404 instead of a Postgres
  // 22P02 dressed up as a 400.
  if (!UUID_SHAPE.test(id)) throw notFound('No such note.')
  return id
}

interface NoteBody {
  title?: unknown
  body?: unknown
  tags?: unknown
  actionUuid?: unknown
}

/** The body's SHAPE — types only. What the values may be is the domain's call. */
function readBody(body: NoteBody): { title?: string; body?: string; tags?: string[] } {
  const out: { title?: string; body?: string; tags?: string[] } = {}
  if ('title' in body) {
    if (typeof body.title !== 'string') throw badRequest('title must be a string.')
    out.title = body.title
  }
  if ('body' in body) {
    if (typeof body.body !== 'string') throw badRequest('body must be a string.')
    out.body = body.body
  }
  if ('tags' in body && body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== 'string')) {
      throw badRequest('tags must be an array of strings.')
    }
    out.tags = body.tags as string[]
  }
  return out
}

notesRouter.get('/notes', requireOperation('notes.read'), async (req: Request, res: Response) => {
  res.json(
    await notes.listNotes({
      q: qstr(req.query.q),
      limit: Math.min(qint(req.query.limit) ?? 50, 200),
      offset: qint(req.query.offset),
    }),
  )
})

notesRouter.get(
  '/notes/:noteId',
  requireOperation('notes.read'),
  async (req: Request, res: Response) => {
    res.json(await notes.getNote(idOf(req)))
  },
)

notesRouter.post('/notes', requireOperation('notes.write'), async (req: Request, res: Response) => {
  const principal = principalOf(req)
  const body = (req.body ?? {}) as NoteBody
  const input = readBody(body)
  if (!input.title?.trim()) throw badRequest('title is required.')

  // Optional replay protection: a client that sends an actionUuid gets a 409
  // on the second attempt instead of a duplicate row.
  await assertFirstUse(body.actionUuid, {
    actor: principal.username || principal.subject,
    action: 'notes.create',
  })

  res.status(201).json(await notes.createNote({ ...input, title: input.title }))
})

notesRouter.patch(
  '/notes/:noteId',
  requireOperation('notes.write'),
  async (req: Request, res: Response) => {
    const input = readBody((req.body ?? {}) as NoteBody)
    if (!('title' in input) && !('body' in input) && !('tags' in input)) {
      throw badRequest('Nothing to change — send title, body and/or tags.')
    }
    res.json(await notes.updateNote(idOf(req), input))
  },
)

notesRouter.delete(
  '/notes/:noteId',
  requireOperation('notes.write'),
  async (req: Request, res: Response) => {
    await notes.deleteNote(idOf(req))
    res.status(204).end()
  },
)
