// Logging, and what must never reach a log line.
//
// THE LOG IS NOT A TRUSTED PLACE. It is aggregated, it lands in support
// bundles, it is read over shoulders and pasted into tickets. Anything in it
// should be assumed readable by more people than the request was.
//
// Two mechanisms, and they are deliberately different in kind:
//
//   httpSerializers  an ALLOWLIST for request/response logs (used by
//                    pino-http in app.ts). A denylist there grows forever —
//                    cookie, then authorization, then proxy-authorization,
//                    then whatever header the next integration invents — and
//                    is wrong the moment somebody forgets one. An allowlist is
//                    wrong only in the safe direction: a header nobody thought
//                    about is simply absent.
//   redact           a denylist on the logger ITSELF, for our own
//                    `logger.info({...})` calls, which pass arbitrary objects
//                    and are not covered by the serializers above. Belt and
//                    braces: if the serializers are ever loosened, the common
//                    credential-shaped keys are still censored — and an `email`
//                    key is masked, whichever call site forgot to.
//
// WHAT THIS CLOSES. pino-http's default request serializer emits
// `req.headers` whole, and this app's session rides HttpOnly cookies — so
// every ordinary log line would carry `app_access` (a live RS256 JWT) and
// `app_refresh`, and `set-cookie` on the sign-in response mints both. The
// set-password token and the MFA login token are PATH parameters
// (`/password-setup/:token`, `/mfa/login/status/:token`), so they ride in
// `req.url`; the MFA approval link carries its token in the query
// (`/mfa/verify?token=`). And a `referer` is a URL too: a page opened from
// such a link carries its token into every request it makes, so the referer
// goes through the same sanitising as `req.url`. (The reference project
// measured each of these leaking before it closed them.)
import { pino } from 'pino'
import { env } from './config/env.js'
import { maskEmail } from './utils/mask.js'

/**
 * Credential-shaped keys, censored wherever they appear in a logged object.
 *
 * Each name is paired with a `*.name` wildcard so it is caught one level down
 * as well — `logger.warn({ grant: { client_secret } })` is as easy to write by
 * accident as a top-level one.
 */
const SECRET_KEYS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'access_token',
  'refresh_token',
  'id_token',
  'clientSecret',
  'client_secret',
  'secret',
  'authorization',
  'cookie',
]

/**
 * The logger's own redaction: SECRET_KEYS censored outright, and an `email`
 * key (top level or one down) MASKED rather than blanked — the domain is what
 * helps with a mail question.
 *
 * ONE CENSOR FOR EVERY PATH, so it chooses by the KEY, never by the value:
 * judged by the value, a password containing an `@` would come out as a
 * masked "address", half readable. `to` and `username` are not here on
 * purpose — the call sites mask what they put there (utils/mask.ts,
 * integrations/sms maskNumber).
 */
export const logRedaction = {
  paths: [
    ...SECRET_KEYS,
    ...SECRET_KEYS.map((key) => `*.${key}`),
    'email',
    '*.email',
    // The request/response shapes, for any pino usage that does not go
    // through the serializers below.
    'req.headers.cookie',
    'req.headers.authorization',
    'res.headers["set-cookie"]',
  ],
  censor: (value: unknown, path: string[]): unknown => {
    if (path[path.length - 1] !== 'email') return '[redacted]'
    if (value === null || value === undefined) return value
    return typeof value === 'string' ? maskEmail(value) : '[redacted]'
  },
}

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: logRedaction,
  ...(env.LOG_FORMAT === 'pretty'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
})

// --- what a request log line may contain -------------------------------------

/** Request headers worth having when something goes wrong. Nothing else survives. */
const SAFE_REQUEST_HEADERS = [
  'content-type',
  'content-length',
  'user-agent',
  'referer',
  // Behind nginx / an edge proxy this is the only way to know who called.
  'x-forwarded-for',
]

/**
 * Of those, the headers whose value is a URL — and a URL can carry a secret.
 * Each goes through sanitizeUrl like `req.url`.
 */
const URL_HEADERS = ['referer']

/** Response headers worth having. `set-cookie` is absent ON PURPOSE — it is
 *  where the session cookies are MINTED, so it carries the same tokens the
 *  request's `cookie` header does. */
const SAFE_RESPONSE_HEADERS = ['content-type', 'content-length']

/**
 * Query parameters that carry a secret.
 *
 * A DENYLIST HERE, unlike the headers, and the asymmetry is deliberate: a log
 * line without its query string often cannot be read at all (which page,
 * which filter), and the parameters that carry secrets are few and named.
 */
const SECRET_QUERY_PARAMS = new Set([
  'token',
  'code',
  'password',
  'secret',
  'key',
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'signature',
])

/**
 * Query parameters that carry a PERSON, and how much of each a log line
 * keeps. A search box's text keeps nothing — it is usually somebody's name.
 * The parameter name stays, so the line still says what was asked. ADD TO IT
 * when a route takes a personal identifier in its query.
 */
const PERSONAL_QUERY_PARAMS = new Map<string, (value: string) => string>([
  ['q', () => '[redacted]'],
])

/**
 * Route prefixes whose NEXT PATH SEGMENT is a credential.
 *
 *   /mfa/login/status/:token   the MFA one-time login token. Single-use and
 *                              three minutes long, and for those three minutes
 *                              it is the whole of the second factor.
 *   /password-setup/:token     the set-password link's token — which IS the
 *                              account until it is used.
 *
 * Neither can be kept out of `req.url` by filtering headers or query strings,
 * which is the whole reason this list exists. ADD TO IT when a route puts a
 * secret in its path; `routes` names the words after the prefix that are
 * route, not secret. Matched without regard to case, as Express routes.
 */
const SECRET_PATH_PREFIXES: { prefix: string; routes: string[] }[] = [
  { prefix: '/mfa/login/status/', routes: [] },
  { prefix: '/password-setup/', routes: [] },
]

/** A query parameter's name as a reader would decode it — `to%6Ben` is `token`. */
function paramName(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' ')).trim().toLowerCase()
  } catch {
    return raw.trim().toLowerCase()
  }
}

/**
 * `…/status/abc123?x=1` -> `…/status/[redacted]?x=1`, secret params
 * `[redacted]` and personal ones masked. Takes a path or a whole URL (a
 * referer); anything that is not a string comes back empty.
 */
export function sanitizeUrl(url: unknown): string {
  if (typeof url !== 'string' || !url) return ''
  const split = url.indexOf('?')
  let pathname = split === -1 ? url : url.slice(0, split)
  const search = split === -1 ? '' : url.slice(split + 1)

  const lower = pathname.toLowerCase()
  for (const { prefix, routes } of SECRET_PATH_PREFIXES) {
    const at = lower.indexOf(prefix)
    if (at === -1) continue
    const start = at + prefix.length
    const slash = pathname.indexOf('/', start)
    const end = slash === -1 ? pathname.length : slash
    // Only the one segment: anything after it is route, not secret.
    if (start === end || routes.includes(lower.slice(start, end))) continue
    pathname = `${pathname.slice(0, start)}[redacted]${pathname.slice(end)}`
    break
  }

  if (!search) return pathname

  // Hand-parsed rather than via URLSearchParams so the query string comes back
  // in the shape it arrived in — re-encoding it would make log lines stop
  // matching the requests they describe.
  const params = search
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=')
      if (eq === -1) return pair
      const raw = pair.slice(0, eq)
      const name = paramName(raw)
      if (SECRET_QUERY_PARAMS.has(name)) return `${raw}=[redacted]`
      const personal = PERSONAL_QUERY_PARAMS.get(name)
      return personal ? `${raw}=${personal(pair.slice(eq + 1))}` : pair
    })
    .join('&')

  return `${pathname}?${params}`
}

const pick = (
  headers: Record<string, unknown> | undefined,
  allowed: string[],
): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  if (!headers) return out
  for (const name of allowed) {
    const value = headers[name]
    if (value !== undefined) out[name] = value
  }
  return out
}

/** The allowed request headers, each URL one sanitised — anything but a string is not logged. */
const requestHeaders = (headers: Record<string, unknown> | undefined): Record<string, unknown> => {
  const out = pick(headers, SAFE_REQUEST_HEADERS)
  for (const name of URL_HEADERS) {
    if (name in out)
      out[name] = typeof out[name] === 'string' ? sanitizeUrl(out[name]) : '[redacted]'
  }
  return out
}

interface SerializedRequest {
  id?: unknown
  method?: string
  url?: string
  headers?: Record<string, unknown>
  remoteAddress?: string
  query?: unknown
  params?: unknown
}

interface SerializedResponse {
  statusCode?: number
  headers?: Record<string, unknown>
}

/**
 * The request/response serializers pino-http uses (app.ts).
 *
 * They receive pino-std-serializers' already-prepared object — id, method,
 * url, query, params, headers, remoteAddress — and return a reduced one. Note
 * what is dropped besides the headers: `params` and `query`, because a route
 * parameter is exactly where the path-borne tokens live and the sanitised
 * `url` already carries what is safe of both.
 */
export const httpSerializers = {
  req: (req: SerializedRequest) => ({
    id: req.id,
    method: req.method,
    url: sanitizeUrl(req.url),
    remoteAddress: req.remoteAddress,
    headers: requestHeaders(req.headers),
  }),
  res: (res: SerializedResponse) => ({
    statusCode: res.statusCode,
    headers: pick(res.headers, SAFE_RESPONSE_HEADERS),
  }),
}
