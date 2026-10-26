// /document — the generic facade over the external document store. The
// frontend's whole DMS integration lives behind these three routes; nothing
// in the browser ever talks to Mayan.
//
//   POST /document/upload   multipart: file, documentType?, folder?, comment?
//                           -> { documentId }
//   GET  /document/list?folder=…   -> [{ documentId, fileName, … }]
//   GET  /document/view?docId=DOC-… (&meta=true for the version history)
//                           -> the latest binary (or JSON metadata)
//
// The docRefId (DOC-<mayan id>) is the only thing callers hold; Mayan's
// numeric ids stay behind this facade. A richer per-entity filing layer
// (per-person folders, canonical document-type codes, versioned re-upload,
// ZIP export) layers on top of services/documents.ts the same way this does.
import { Router } from 'express'
import multer from 'multer'
import { Readable } from 'node:stream'
import { env } from '../config/env.js'
import { badRequest } from '../http/problem.js'
import { principalOf } from '../middleware/auth.js'
import { documentVersions, listFolder, openDocument, storeDocument } from '../services/documents.js'
import { qbool, qstr } from '../utils/query.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_MB * 1024 * 1024 },
})

export const documentsRouter = Router()

documentsRouter.post('/document/upload', upload.single('file'), async (req, res) => {
  const principal = principalOf(req)
  if (!req.file) throw badRequest('Attach the file in the multipart field "file".')
  const body = (req.body ?? {}) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

  const documentId = await storeDocument(
    {
      buffer: req.file.buffer,
      filename: req.file.originalname || 'upload.bin',
      mimetype: req.file.mimetype || 'application/octet-stream',
    },
    {
      documentType: s(body.documentType),
      folder: s(body.folder),
      comment: s(body.comment),
      uploadedBy: principal.username || principal.subject,
    },
  )
  res.status(201).json({ documentId })
})

documentsRouter.get('/document/list', async (req, res) => {
  const folder = qstr(req.query.folder)
  if (!folder) throw badRequest('Name the folder to list (?folder=path/of/cabinet).')
  res.json(await listFolder(folder))
})

documentsRouter.get('/document/view', async (req, res) => {
  const docId = qstr(req.query.docId)
  if (!docId) throw badRequest('Name the document (?docId=DOC-…).')

  if (qbool(req.query.meta)) {
    res.json(await documentVersions(docId))
    return
  }

  const result = await openDocument(docId)
  res.setHeader('Content-Type', result.contentType)
  res.setHeader('Content-Disposition', `inline; filename="${result.filename.replace(/"/g, '')}"`)
  Readable.fromWeb(result.stream as import('node:stream/web').ReadableStream).pipe(res)
})
