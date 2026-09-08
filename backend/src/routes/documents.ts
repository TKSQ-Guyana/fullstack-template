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
// ZIP export) layers on top of services/dms.ts the same way this does.
import { Router } from 'express'
import multer from 'multer'
import { Readable } from 'node:stream'
import { env } from '../config/env.js'
import { badRequest, notFound } from '../http/problem.js'
import { principalOf } from '../middleware/auth.js'
import {
  addDocumentToCabinet,
  downloadDocument,
  ensureCabinetPath,
  listCabinetDocuments,
  listDocumentFiles,
  resolveCabinetPath,
  setDocumentMetadata,
  uploadDocument,
} from '../services/dms.js'
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

  const documentId = await uploadDocument(
    {
      buffer: req.file.buffer,
      filename: req.file.originalname || 'upload.bin',
      mimetype: req.file.mimetype || 'application/octet-stream',
    },
    s(body.documentType),
  )

  // Optional filing + provenance, both best-effort once the binary is stored.
  const folder = s(body.folder)
  if (folder && env.DMS_ENABLED) {
    const cabinetId = await ensureCabinetPath(folder)
    await addDocumentToCabinet(cabinetId, Number(documentId.replace(/^DOC-/, '')))
  }
  if (env.DMS_ENABLED) {
    await setDocumentMetadata(Number(documentId.replace(/^DOC-/, '')), {
      uploaded_by: principal.username || principal.subject,
      ...(s(body.comment) ? { comment: s(body.comment) } : {}),
    })
  }

  res.status(201).json({ documentId })
})

documentsRouter.get('/document/list', async (req, res) => {
  const folder = qstr(req.query.folder)
  if (!folder) throw badRequest('Name the folder to list (?folder=path/of/cabinet).')
  if (!env.DMS_ENABLED) {
    res.json([])
    return
  }
  const cabinetId = await resolveCabinetPath(folder)
  if (cabinetId == null) {
    // An unknown folder is an empty listing, not an error: "no documents yet"
    // and "folder never created" are the same state to a reader.
    res.json([])
    return
  }
  const docs = await listCabinetDocuments(cabinetId)
  res.json(
    docs.map((d) => ({
      documentId: `DOC-${d.id}`,
      fileName: d.file_latest?.filename ?? d.label,
      mimeType: d.file_latest?.mimetype ?? null,
      size: d.file_latest?.size ?? null,
      documentType: d.document_type?.label ?? null,
      createdAt: d.datetime_created ?? null,
    })),
  )
})

documentsRouter.get('/document/view', async (req, res) => {
  const docId = qstr(req.query.docId)
  if (!docId) throw badRequest('Name the document (?docId=DOC-…).')

  if (qbool(req.query.meta)) {
    const mayanId = Number(docId.replace(/^DOC-/, ''))
    if (!Number.isFinite(mayanId)) throw notFound(`Document ${docId} has no DMS binary.`)
    const files = await listDocumentFiles(mayanId)
    res.json({
      documentId: docId,
      versions: files.map((f, i) => ({
        version: `v${i + 1}`,
        fileId: f.id,
        fileName: f.filename,
        mimeType: f.mimetype,
        size: f.size ?? null,
        uploadedAt: f.timestamp ?? null,
        comment: f.comment ?? null,
      })),
    })
    return
  }

  const result = await downloadDocument(docId)
  res.setHeader('Content-Type', result.contentType)
  res.setHeader('Content-Disposition', `inline; filename="${result.filename.replace(/"/g, '')}"`)
  Readable.fromWeb(result.stream as import('node:stream/web').ReadableStream).pipe(res)
})
