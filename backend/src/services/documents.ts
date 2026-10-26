// Documents — the use-cases behind the /document facade over the external
// store (integrations/mayan/dms.ts). With DMS_ENABLED=false the store runs in
// placeholder mode: an upload is answered with a minted reference, a listing
// is empty, and a download is refused with 501 — the facade's shape never
// changes, so the frontend has one code path.
import { env } from '../config/env.js'
import {
  addDocumentToCabinet,
  downloadDocument,
  ensureCabinetPath,
  listCabinetDocuments,
  listDocumentFiles,
  resolveCabinetPath,
  setDocumentMetadata,
  uploadDocument,
  type UploadInput,
} from '../integrations/mayan/dms.js'
import { notFound } from '../domain/errors.js'
import { presentFolder, presentVersions } from '../presenters/document.presenter.js'

/** DOC-<mayan id> → the Mayan id (NaN for a placeholder reference). */
const mayanIdOf = (docRefId: string): number => Number(docRefId.replace(/^DOC-/, ''))

/**
 * Store a binary; answers its DOC-… reference. Filing into a folder and the
 * provenance stamp are best-effort once the binary is stored.
 */
export async function storeDocument(
  file: UploadInput,
  opts: { documentType?: string; folder?: string; comment?: string; uploadedBy: string },
): Promise<string> {
  const documentId = await uploadDocument(file, opts.documentType)
  if (!env.DMS_ENABLED) return documentId

  if (opts.folder) {
    const cabinetId = await ensureCabinetPath(opts.folder)
    await addDocumentToCabinet(cabinetId, mayanIdOf(documentId))
  }
  await setDocumentMetadata(mayanIdOf(documentId), {
    uploaded_by: opts.uploadedBy,
    ...(opts.comment ? { comment: opts.comment } : {}),
  })
  return documentId
}

/**
 * The documents filed in one folder. An unknown folder is an empty listing,
 * not an error: "no documents yet" and "folder never created" are the same
 * state to a reader.
 */
export async function listFolder(folder: string) {
  if (!env.DMS_ENABLED) return presentFolder([])
  const cabinetId = await resolveCabinetPath(folder)
  if (cabinetId == null) return presentFolder([])
  return presentFolder(await listCabinetDocuments(cabinetId))
}

/** One document's version history. */
export async function documentVersions(docRefId: string) {
  const mayanId = mayanIdOf(docRefId)
  if (!Number.isFinite(mayanId)) throw notFound(`Document ${docRefId} has no DMS binary.`)
  return presentVersions(docRefId, await listDocumentFiles(mayanId))
}

/** The latest binary, as a stream with its type and name. */
export const openDocument = downloadDocument
