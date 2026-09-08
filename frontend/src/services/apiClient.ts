/**
 * Shared HTTP client. Feature code calls through this so base URL, headers
 * and error handling live in one place; services/api is the only layer that
 * knows an API path.
 *
 * EVERY REQUEST RIDES THE HTTPONLY SESSION COOKIE — same-origin fetch carries
 * it without this module touching anything, and no Authorization header is
 * built because no token exists in the page (see @/auth/keycloak). What
 * remains here is FRESHNESS: `updateToken(30)` is awaited before each call,
 * so a session within half a minute of expiry is refreshed (server-side, new
 * cookie) first. The renewal is shared across concurrent callers, so a screen
 * firing six requests triggers one refresh rather than six.
 *
 * `fetch` rather than axios with interceptors: the two behaviours an
 * interceptor pair would give — freshness on the way out, a retry on the way
 * back — are the lines below, and this module is already the single funnel
 * they need to sit in.
 */
import { updateToken, isAuthenticated, logout } from '@/auth/keycloak'
import { RUNTIME_CONFIG } from '@/config/runtime'

const BASE_URL = RUNTIME_CONFIG.apiBase

export interface Violation {
  field: string
  message: string
}

export class ApiError extends Error {
  status: number
  /** The 422 field errors, when the backend sent any — carried on the error
   *  rather than flattened into the message so a form can place each one
   *  against its own field. */
  violations: Violation[]
  constructor(status: number, message: string, violations: Violation[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.violations = violations
  }
}

/**
 * 403 — authenticated, but not allowed to do this. Its own type so a screen
 * can catch it and explain itself. Deliberately NOT treated as a sign-out:
 * 403 is authorization on a valid session, and signing the user out would
 * turn "you may not do this" into "your session broke", losing whatever they
 * had typed on the way.
 */
export class ForbiddenError extends ApiError {
  constructor(message = 'You do not have permission to do this.') {
    super(403, message)
    this.name = 'ForbiddenError'
  }
}

/** Keep the session fresh before a call. The cookie itself needs no help. */
async function ensureFreshSession(): Promise<void> {
  if (!isAuthenticated()) return
  try {
    await updateToken(30)
  } catch {
    // The session has lapsed. Send the call anyway and let the 401 branch
    // below decide — the server is the authority on whether it needed one.
  }
}

export type QueryValue = string | number | boolean | null | undefined
export type QueryParams = Record<string, QueryValue | QueryValue[]>

/**
 * Query string builder. OMITTED, NOT EMPTIED: null / undefined / '' drop out
 * rather than being sent blank, because `?id=` present-but-empty can select a
 * different endpoint than `?id` absent. An ARRAY repeats the key
 * (`status=A&status=B`).
 */
export function qs(params: QueryParams = {}): string {
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue
    if (Array.isArray(value)) {
      for (const v of value) if (v != null && v !== '') q.append(key, String(v))
    } else {
      q.append(key, String(value))
    }
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

interface RequestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  raw?: boolean
}

async function send(path: string, { method, body, headers }: RequestOptions): Promise<Response> {
  await ensureFreshSession()
  // A FormData body is a file upload. The browser must be left to set
  // Content-Type itself — only it knows the multipart boundary it generated.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData

  return fetch(`${BASE_URL}${path}`, {
    method,
    // NOTHING HERE IS CACHEABLE. Every response is state other people are
    // changing, so a reply from the browser cache is a reply about the past.
    cache: 'no-store',
    headers: {
      ...(isForm || body == null ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body == null ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  })
}

interface ProblemShape {
  detail?: string
  title?: string
  message?: string
  violations?: Violation[]
}

/**
 * Turn an error body into a sentence a person can act on. `detail` is
 * preferred over `title` because it is the specific one; violations are
 * appended so a caller showing a single line still names the fields. A body
 * that is not problem+json falls through unchanged.
 */
export async function problemFrom(
  res: Response,
): Promise<{ message: string; violations: Violation[] }> {
  const text = await res.text().catch(() => '')
  if (!text.trim()) return { message: res.statusText, violations: [] }
  let problem: ProblemShape
  try {
    problem = JSON.parse(text) as ProblemShape
  } catch {
    return { message: text, violations: [] }
  }
  if (!problem || typeof problem !== 'object') return { message: text, violations: [] }

  const violations = Array.isArray(problem.violations) ? problem.violations : []
  const fields = violations
    .map((v) => [v.field, v.message].filter(Boolean).join(': '))
    .filter(Boolean)
  const headline = problem.detail || problem.title || problem.message || text
  return {
    message: fields.length ? `${headline} (${fields.join('; ')})` : headline,
    violations,
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res = await send(path, options)

  // ONE forced refresh, ONE retry. A 401 on a session we believed was valid
  // means the server disagrees — clock skew, a realm restart, a key rotation —
  // and a forced refresh is the cheap fix. Once and no more is what stops a
  // genuinely rejected session becoming an infinite loop.
  if (res.status === 401 && isAuthenticated()) {
    try {
      await updateToken(-1)
      res = await send(path, options)
    } catch {
      // Refresh itself failed — the session is over; handled just below.
    }
  }

  if (res.status === 401) {
    // Still refused. Drop the session: the guards react to an unauthenticated
    // principal by rendering the sign-in form, which is the only thing that
    // can help now. The throw still happens so the caller does not carry on
    // as though it had data.
    await logout()
    throw new ApiError(401, 'Your session has ended. Please sign in again.')
  }

  if (res.status === 403) {
    const { message } = await problemFrom(res)
    throw new ForbiddenError(message || undefined)
  }

  if (!res.ok) {
    const { message, violations } = await problemFrom(res)
    throw new ApiError(res.status, message, violations)
  }

  // The caller wants the Response itself — a binary download, where the
  // filename is in Content-Disposition. Returned before any body is read,
  // because a stream can only be consumed once.
  if (options.raw) return res as unknown as T

  // A SUCCESSFUL response with nothing in it resolves to null rather than
  // throwing: res.json() on an empty body surfaces as a failed submission for
  // a record the server already created — so the user sends it again and
  // there are two. 204 is not the only empty body: a 201 with no
  // representation and a proxy dropping a body do it too.
  if (res.status === 204) return null as T
  const text = await res.text()
  if (text.trim() === '') return null as T
  try {
    return JSON.parse(text) as T
  } catch {
    // A 2xx that is not JSON is a web server answering where the API was
    // expected — an error page, or an SPA fallback in front of a missing
    // proxy. Named as that, rather than as a parse error nobody can place.
    throw new ApiError(
      res.status,
      `The service answered ${res.status} with a body that is not JSON. This usually means the request reached a web server rather than the API.`,
    )
  }
}

export const apiClient = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  del: <T = null>(path: string, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
  /** The raw Response, for binary downloads. */
  getRaw: (path: string, opts?: RequestOptions) =>
    request<Response>(path, { ...opts, method: 'GET', raw: true }),
}
