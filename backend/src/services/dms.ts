// Mayan EDMS (v4 API) — the external document store. Binaries live here; the
// database holds only the docRefId.
//
// DMS_ENABLED=false is a supported placeholder mode: uploads mint a
// DOC-<timestamp> reference and store metadata only, downloads answer 501.
// That makes the store an add-on, not a prerequisite — an environment without
// Mayan still runs everything else.
import { Agent, fetch as undiciFetch, FormData as UndiciFormData } from 'undici'
import { env } from '../config/env.js'
import { logger } from '../logger.js'
import { ProblemError } from '../http/problem.js'

// A Mayan behind an internal CA this process does not trust: DMS_TLS_INSECURE
// scopes the exemption to THIS client only — Keycloak/JWKS and everything
// else keep full verification.
const insecureDispatcher = env.DMS_TLS_INSECURE
  ? new Agent({ connect: { rejectUnauthorized: false } })
  : null

// EVERY DMS request goes through undici's own fetch, whether or not the
// insecure dispatcher is active: a FormData built from one undici realm and
// posted through another is silently serialized as text/plain (Mayan answers
// 415), so the client sticks to a single realm — undici's fetch + the
// UndiciFormData below.
function dmsHttp(url: string, init: RequestInit = {}): Promise<Response> {
  return undiciFetch(url, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    ...(insecureDispatcher ? { dispatcher: insecureDispatcher } : {}),
  }) as unknown as Promise<Response>
}

/** Multipart body for dmsHttp — MUST be undici's FormData (see above). */
export function dmsForm(): FormData {
  return new UndiciFormData() as unknown as FormData
}

interface UploadInput {
  buffer: Buffer
  filename: string
  mimetype: string
}

export interface DownloadResult {
  stream: ReadableStream<Uint8Array>
  contentType: string
  filename: string
}

const base = env.DMS_URL.replace(/\/+$/, '')

let cachedToken: string | null = null
let cachedDocumentTypeId: number | null = null

async function authToken(): Promise<string> {
  if (cachedToken) return cachedToken
  const res = await dmsHttp(`${base}/auth/token/obtain/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: env.DMS_USERNAME, password: env.DMS_PASSWORD }),
  })
  if (!res.ok) {
    throw new ProblemError(
      502,
      `DMS sign-in failed (${res.status}) — check DMS_USERNAME/DMS_PASSWORD.`,
    )
  }
  const body = (await res.json()) as { token?: string }
  if (!body.token) throw new ProblemError(502, 'DMS sign-in returned no token.')
  cachedToken = body.token
  return cachedToken
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function dmsFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await authToken()
  let res = await dmsHttp(`${base}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.headers ?? {}),
      Authorization: `Token ${token}`,
    },
  })
  if (res.status === 401 && retry) {
    cachedToken = null // token rotated/expired — one re-auth, one retry
    return dmsFetch(path, init, false)
  }
  // Mayan 4.12 throttles the REST API. An upload is a burst (type list,
  // upload, cabinets, metadata, files list), so a 429 mid-burst would
  // otherwise silently degrade it. Retry with the advertised backoff instead.
  for (let attempt = 0; res.status === 429 && attempt < 6; attempt++) {
    const text = await res.text().catch(() => '')
    const advertised = /in (\d+(?:\.\d+)?) second/.exec(text)?.[1]
    await sleep(Math.min(advertised ? Number(advertised) * 1000 : 1000, 5000) + 250)
    res = await dmsHttp(`${base}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.headers ?? {}),
        Authorization: `Token ${token}`,
      },
    })
  }
  return res
}

/**
 * EVERY result of a paginated Mayan listing, not just the first page.
 *
 * Mayan pages everything, and a single `?page_size=N` read is a truncation bug
 * waiting on growth. Following `next` makes the page size a batch size instead
 * of a ceiling. One failed page fails the whole read (`what` names it); a 404
 * on the first page answers `notFound` where the caller distinguishes it.
 */
async function dmsFetchAll<T>(path: string, what: string, notFound?: string): Promise<T[]> {
  const out: T[] = []
  const sep = path.includes('?') ? '&' : '?'
  for (let page = 1; ; page += 1) {
    const res = await dmsFetch(`${path}${sep}page=${page}`)
    if (page === 1 && res.status === 404 && notFound) throw new ProblemError(404, notFound)
    if (!res.ok) throw new ProblemError(502, `DMS ${what} failed (${res.status}).`)
    const body = (await res.json()) as { results?: T[]; next?: string | null }
    out.push(...(body.results ?? []))
    if (!body.next) return out
  }
}

async function documentTypeId(): Promise<number> {
  if (cachedDocumentTypeId != null) return cachedDocumentTypeId
  const types = await dmsFetchAll<{ id: number; label: string }>(
    '/document_types/?page_size=100',
    'document type list',
  )
  const wanted = types.find((t) => t.label.toLowerCase() === env.DMS_DOCUMENT_TYPE.toLowerCase())
  let chosen = wanted ?? types[0]
  if (!chosen) {
    // A fresh Mayan ships no document types at all — create the configured one
    // instead of failing every upload until somebody clicks through the admin
    // UI.
    const createRes = await dmsFetch('/document_types/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: env.DMS_DOCUMENT_TYPE }),
    })
    if (!createRes.ok) {
      throw new ProblemError(
        502,
        `The DMS has no document types and creating one failed (${createRes.status}).`,
      )
    }
    chosen = (await createRes.json()) as { id: number; label: string }
    logger.info({ label: chosen.label, id: chosen.id }, 'created the DMS document type')
  } else if (!wanted) {
    logger.warn(
      { wanted: env.DMS_DOCUMENT_TYPE, using: chosen.label },
      'DMS document type not found — using the first available',
    )
  }
  cachedDocumentTypeId = chosen.id
  return cachedDocumentTypeId
}

/** Resolve a Mayan document type by label; canonical codes are snake_case, so
 *  this is normally an exact match — the separator/case folding keeps older
 *  labels ('bank details') resolving too. Falls back to the configured
 *  default type when nothing matches. */
const labelKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_\s-]+/g, ' ')
    .trim()
let cachedTypeLabels: Map<string, number> | null = null

async function documentTypeIdFor(typeLabel?: string): Promise<number> {
  if (!typeLabel) return documentTypeId()
  if (!cachedTypeLabels) {
    try {
      const types = await dmsFetchAll<{ id: number; label: string }>(
        '/document_types/?page_size=100',
        'document type list',
      )
      cachedTypeLabels = new Map(types.map((t) => [labelKey(t.label), t.id]))
    } catch {
      // Unreadable list -> the default-type fallback below.
    }
  }
  return cachedTypeLabels?.get(labelKey(typeLabel)) ?? documentTypeId()
}

/** Stamp metadata onto a document (what index templates route on).
 *  Create-or-update per entry; an explicit NULL value REMOVES the entry.
 *  Best-effort: a metadata type that does not exist or is not attached to the
 *  document type is logged, never fatal. */
let cachedMetadataTypes: Map<string, number> | null = null

interface MayanMetadataEntry {
  id: number
  value: string
  metadata_type?: { name?: string }
}

export async function setDocumentMetadata(
  mayanDocId: number,
  entries: Record<string, string | null | undefined>,
): Promise<void> {
  if (!env.DMS_ENABLED) return
  try {
    if (!cachedMetadataTypes) {
      const types = await dmsFetchAll<{ id: number; name: string }>(
        '/metadata_types/?page_size=100',
        'metadata type list',
      )
      cachedMetadataTypes = new Map(types.map((t) => [t.name, t.id]))
    }
    const current = await dmsFetchAll<MayanMetadataEntry>(
      `/documents/${mayanDocId}/metadata/?page_size=100`,
      'document metadata list',
    )
    const byName = new Map(current.map((e) => [e.metadata_type?.name ?? '', e]))

    for (const [name, value] of Object.entries(entries)) {
      if (value === undefined) continue // not this upload's business
      const existing = byName.get(name)
      let res: Response | null = null
      if (value === null || value === '') {
        if (!existing) continue
        res = await dmsFetch(`/documents/${mayanDocId}/metadata/${existing.id}/`, {
          method: 'DELETE',
        })
      } else if (existing) {
        if (existing.value === value) continue
        res = await dmsFetch(`/documents/${mayanDocId}/metadata/${existing.id}/`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        })
      } else {
        const typeId = cachedMetadataTypes.get(name)
        if (typeId == null) continue
        res = await dmsFetch(`/documents/${mayanDocId}/metadata/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metadata_type_id: typeId, value }),
        })
      }
      if (res && !res.ok && res.status !== 409) {
        logger.warn(
          { mayanDocId, name, status: res.status },
          'could not stamp document metadata (continuing)',
        )
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'document metadata stamping failed (continuing)')
  }
}

/** Upload a binary; returns the docRefId the database stores.
 *  typeLabel picks the Mayan document type by name. */
export async function uploadDocument(file: UploadInput, typeLabel?: string): Promise<string> {
  if (!env.DMS_ENABLED) {
    // Placeholder mode: a reference is minted, no binary is stored.
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17)
    return `DOC-${stamp}`
  }

  const typeId = await documentTypeIdFor(typeLabel)
  const form = dmsForm()
  form.append('document_type_id', String(typeId))
  form.append(
    'file',
    new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
    file.filename,
  )

  const res = await dmsFetch('/documents/upload/', { method: 'POST', body: form })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ProblemError(502, `DMS upload failed (${res.status}): ${text.slice(0, 300)}`)
  }
  const body = (await res.json()) as { id?: number }
  if (body.id == null) throw new ProblemError(502, 'DMS upload returned no document id.')
  return `DOC-${body.id}`
}

/** Stream a stored binary back. docRefId is DOC-<mayan id>. */
export async function downloadDocument(docRefId: string): Promise<DownloadResult> {
  if (!env.DMS_ENABLED) {
    throw new ProblemError(
      501,
      'Document downloads need the DMS connection (DMS_ENABLED=true); this deployment stores metadata only.',
    )
  }
  const id = docRefId.replace(/^DOC-/, '')
  if (!/^\d+$/.test(id)) {
    throw new ProblemError(
      404,
      `Document ${docRefId} has no DMS binary — it predates the DMS connection.`,
    )
  }

  const metaRes = await dmsFetch(`/documents/${id}/`)
  if (metaRes.status === 404) throw new ProblemError(404, `Document ${docRefId} is not in the DMS.`)
  if (!metaRes.ok) throw new ProblemError(502, `DMS document lookup failed (${metaRes.status}).`)
  const meta = (await metaRes.json()) as {
    label?: string
    file_latest?: { id?: number; mimetype?: string; filename?: string }
  }
  const fileId = meta.file_latest?.id
  if (fileId == null) throw new ProblemError(404, `Document ${docRefId} has no stored file.`)

  const fileRes = await dmsFetch(`/documents/${id}/files/${fileId}/download/`, {
    headers: { Accept: '*/*' },
  })
  if (!fileRes.ok || !fileRes.body) {
    throw new ProblemError(502, `DMS download failed (${fileRes.status}).`)
  }
  return {
    stream: fileRes.body,
    contentType:
      fileRes.headers.get('content-type') ??
      meta.file_latest?.mimetype ??
      'application/octet-stream',
    filename: meta.file_latest?.filename ?? meta.label ?? docRefId,
  }
}

/* ------------------------------------------------------------------------
 * Versions & cabinets.
 * A Mayan DOCUMENT holds many FILES; each new file IS a new version.
 * Cabinets are the folder tree (e.g. app/uploads/<subject>).
 * ---------------------------------------------------------------------- */

export interface MayanFile {
  id: number
  filename: string
  mimetype: string | null
  size?: number | null
  timestamp?: string | null
  comment?: string | null
}

/** The version list of a Mayan document, oldest first (index 0 = v1). */
export async function listDocumentFiles(mayanDocId: number): Promise<MayanFile[]> {
  const files = await dmsFetchAll<MayanFile>(
    `/documents/${mayanDocId}/files/?page_size=100`,
    'file list',
    `Document ${mayanDocId} is not in the DMS.`,
  )
  return files.sort((a, b) => a.id - b.id)
}

/** Upload a new FILE onto an existing document — Mayan's new-version
 *  semantics. action_name 'replace' keeps every previous file; despite the
 *  name nothing is lost. */
export async function uploadNewVersion(
  mayanDocId: number,
  file: UploadInput,
  comment?: string,
): Promise<void> {
  const form = dmsForm()
  form.append(
    'file_new',
    new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
    file.filename,
  )
  form.append('action_name', 'replace')
  form.append('filename', file.filename)
  if (comment) form.append('comment', comment)
  const res = await dmsFetch(`/documents/${mayanDocId}/files/`, { method: 'POST', body: form })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ProblemError(502, `DMS version upload failed (${res.status}): ${text.slice(0, 300)}`)
  }
}

/** Stream one specific stored file (version) of a document. */
export async function downloadDocumentFile(
  mayanDocId: number,
  file: MayanFile,
): Promise<DownloadResult> {
  const res = await dmsFetch(`/documents/${mayanDocId}/files/${file.id}/download/`, {
    headers: { Accept: '*/*' },
  })
  if (!res.ok || !res.body) throw new ProblemError(502, `DMS download failed (${res.status}).`)
  return {
    stream: res.body,
    // The file RECORD's mimetype is authoritative — Mayan's download endpoint
    // answers application/octet-stream for everything, and trusting that
    // would make every PDF fall back to a download prompt in the viewer.
    contentType: file.mimetype ?? res.headers.get('content-type') ?? 'application/octet-stream',
    filename: file.filename,
  }
}

interface MayanCabinet {
  id: number
  label: string
  full_path?: string
  parent_id?: number | null
}

async function walkCabinetPath(path: string, create: boolean): Promise<number | null> {
  const segments = path
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!segments.length) throw new ProblemError(400, 'The folder path is empty.')

  // The WHOLE tree, not one page of it: a truncated read here mints duplicate
  // cabinets (create) or silently skips re-filing (resolve).
  const all = await dmsFetchAll<MayanCabinet>('/cabinets/?page_size=200', 'cabinet list')
  const byPath = new Map(all.map((c) => [c.full_path ?? c.label, c.id]))

  let parentId: number | null = null
  let walked = ''
  for (const segment of segments) {
    walked = walked ? `${walked} / ${segment}` : segment
    const existing = byPath.get(walked)
    if (existing != null) {
      parentId = existing
      continue
    }
    if (!create) return null
    const createRes = await dmsFetch('/cabinets/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `parent` is REQUIRED by Mayan's serializer, null meaning a root cabinet.
      body: JSON.stringify({ label: segment, parent: parentId }),
    })
    if (!createRes.ok) {
      const text = await createRes.text().catch(() => '')
      throw new ProblemError(
        502,
        `DMS cabinet create failed (${createRes.status}): ${text.slice(0, 200)}`,
      )
    }
    const created = (await createRes.json()) as MayanCabinet
    byPath.set(walked, created.id)
    parentId = created.id
  }
  return parentId
}

/** Ensure the cabinet path (e.g. app/uploads/123) exists; returns the leaf id. */
export async function ensureCabinetPath(path: string): Promise<number> {
  return (await walkCabinetPath(path, true)) as number
}

/** The leaf cabinet id of an existing path, or null — nothing is created. */
export function resolveCabinetPath(path: string): Promise<number | null> {
  return walkCabinetPath(path, false)
}

/** Documents filed in one cabinet (id + label + latest file), for listings. */
export interface CabinetDocument {
  id: number
  label: string
  datetime_created?: string
  file_latest?: { filename?: string; mimetype?: string | null; size?: number | null }
  document_type?: { label?: string }
}

export async function listCabinetDocuments(cabinetId: number): Promise<CabinetDocument[]> {
  return dmsFetchAll<CabinetDocument>(
    `/cabinets/${cabinetId}/documents/?page_size=100`,
    'cabinet document list',
  )
}

/** Take a document out of a cabinet (re-filing after a category correction).
 *  Already-absent answers 400 on this instance — not a failure. */
export async function removeDocumentFromCabinet(
  cabinetId: number,
  mayanDocId: number,
): Promise<void> {
  const res = await dmsFetch(`/cabinets/${cabinetId}/documents/remove/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: mayanDocId }),
  })
  if (!res.ok && res.status !== 400 && res.status !== 404) {
    logger.warn({ cabinetId, mayanDocId, status: res.status }, 'cabinet remove failed (continuing)')
  }
}

/** File the document into a cabinet (idempotent — already-present is fine). */
export async function addDocumentToCabinet(cabinetId: number, mayanDocId: number): Promise<void> {
  const res = await dmsFetch(`/cabinets/${cabinetId}/documents/add/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: mayanDocId }),
  })
  // Mayan answers 400 when the document is already in the cabinet — not a failure.
  if (!res.ok && res.status !== 400) {
    throw new ProblemError(502, `DMS cabinet filing failed (${res.status}).`)
  }
}

export async function dmsHealthy(): Promise<boolean | null> {
  if (!env.DMS_ENABLED) return null
  try {
    await authToken()
    return true
  } catch {
    return false
  }
}
