// Document presenters — the JSON of /document/list and /document/view?meta.
// The DMS's own record shapes (integrations/mayan/dms.ts) stop here: callers
// only ever see the DOC-<id> reference and these fields, never Mayan's ids or
// its field names.
import type { CabinetDocument, MayanFile } from '../integrations/mayan/dms.js'
import type { Json } from './json.js'

/** The documents filed in one folder. */
export const presentFolder = (docs: CabinetDocument[]): Json =>
  docs.map((d) => ({
    documentId: `DOC-${d.id}`,
    fileName: d.file_latest?.filename ?? d.label,
    mimeType: d.file_latest?.mimetype ?? null,
    size: d.file_latest?.size ?? null,
    documentType: d.document_type?.label ?? null,
    createdAt: d.datetime_created ?? null,
  }))

/** One document's version history, oldest first (v1 is the original). */
export const presentVersions = (documentId: string, files: MayanFile[]): Json => ({
  documentId,
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
