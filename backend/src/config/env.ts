// Environment, validated once at startup. A missing or malformed value fails
// the boot with a message naming the variable, rather than surfacing later as
// an undefined somewhere in a request.
//
// This is the ONLY place src/ reads process.env. Standalone scripts
// (scripts/*.mjs) read it directly because they run outside the app.
import { z } from 'zod'

const booleanish = z
  .string()
  .optional()
  .transform((v) => (v ?? 'false').toLowerCase() === 'true')

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  // The product's display name — mail subjects and bodies use it, so a fork
  // rebrands every outbound message in one place.
  APP_NAME: z.string().default('App Portal'),
  PORT: z.coerce.number().int().positive().default(8081),
  // Every base path serves the same API: /app/v1 for the frontend (proxied by
  // vite/nginx), /api/v1 for direct callers (Postman, smoke tests).
  BASE_PATHS: z.string().default('/app/v1,/api/v1'),
  CORS_ORIGINS: z.string().default('*'),
  JSON_BODY_LIMIT: z.string().default('10mb'),
  UPLOAD_MAX_MB: z.coerce.number().positive().default(25),

  // Default matches the dev stack: compose Postgres publishes on HOST port
  // 5433 so a machine's own PostgreSQL service can keep 5432.
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5433/app_db'),
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),
  PG_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  // enforce = 401 without a valid token/cookie. optional = a missing token
  // falls back to a synthetic identity from query params (dev convenience —
  // RBAC only bites on verified identities). disabled = query identity only.
  AUTH_MODE: z.enum(['enforce', 'optional', 'disabled']).default('enforce'),
  KC_URL: z.string().default('http://localhost:8085'),
  KC_REALM: z.string().default('app-realm'),
  KC_ISSUER: z.string().optional().default(''),
  KC_AUDIENCE: z.string().optional().default(''),
  // The SPA client, as Keycloak spells it. The BACKEND performs the password
  // grant against it on the browser's behalf (/auth/login), so it is the
  // backend's configuration, not the bundle's. A public client with Direct
  // Access Grants enabled — no secret exists and none goes here.
  KC_CLIENT_ID: z.string().default('web-app'),
  // Set true when the app is served over https so the session cookies carry
  // Secure. Local http development leaves it false — a Secure cookie over
  // http would silently never come back.
  AUTH_COOKIE_SECURE: booleanish,

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  // --- the WebAuthn second factor (src/mfa/*) ------------------------------
  // A passkey is bound to the exact host the browser shows when it is
  // registered, so these must name the public origin the phone actually loads
  // /enroll and /verify from — in deployment, the app's own origin. The
  // defaults cover BOTH local fronts (the nginx door at :3000 and the vite
  // loop at :5173): rpID `localhost` matches either port, and expectedOrigin
  // takes the whole list.
  MFA_RP_ID: z.string().default('localhost'),
  MFA_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173'),
  // Builds the /verify?token=… links the phone opens. :3000 rather than :5173
  // even for vite development — the verify PAGE is only served where the
  // built MFA UI is (this container behind nginx), never by the app's vite.
  MFA_PUBLIC_URL: z.string().default('http://localhost:3000'),
  // Where the built phone-facing UI lives (the Dockerfile puts it at ./mfa-ui).
  MFA_UI_DIR: z.string().default('mfa-ui'),

  // THE APPROVAL LINK MUST NOT OPEN WHERE THE SIGN-IN STARTED, or the second
  // factor is the first factor wearing a hat. The same-browser refusal is
  // server-enforced and always on; the desktop refusal below reads the
  // User-Agent and client hints, which a determined person can spoof — it
  // stops the honest mistake, and the passkey itself stops the attacker.
  // Default ON, because a security control that has to be switched on is one
  // that will be found switched off. The dev stack sets it false so a laptop
  // can still walk the flow (docker-compose.dev.yml).
  MFA_REQUIRE_MOBILE: z
    .string()
    .optional()
    .transform((v) => (v ?? 'true').toLowerCase() !== 'false'),

  // --- the approval link by SMS (src/services/sms.ts) ----------------------
  // Off unless configured: an unconfigured deployment falls back to the
  // on-screen copy link rather than failing sign-in.
  SMS_ENABLED: booleanish,
  SMS_API_URL: z.string().default('https://api.sms-gate.app/3rdparty/v1/message'),
  SMS_USERNAME: z.string().default(''),
  SMS_PASSWORD: z.string().default(''),
  // Never let the gateway hold up a sign-in. On timeout the link is still
  // issued and the screen falls back to the copy link.
  SMS_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  // {link} is substituted. Kept to one GSM-7 segment (160 chars).
  MFA_SMS_TEMPLATE: z
    .string()
    .default('App sign-in: approve (3 min, one use):\n{link}\nNot you? Ignore.'),
  MFA_ENROL_SMS_TEMPLATE: z
    .string()
    .default('App: register this phone for sign-in approval:\n{link}\nNot you? Tell IT.'),

  // Which Keycloak USER ATTRIBUTE holds the mobile number. Read server-side
  // through the service account below — never taken from the browser.
  // NOTE: Keycloak 26 silently drops any attribute the realm's declarative
  // user profile does not declare, so declare this one in the realm.
  MFA_PHONE_ATTRIBUTE: z.string().default('mobile'),

  // The confidential client whose service account may read users
  // (realm-management: view-users / query-users) and provision accounts.
  KC_SERVICE_CLIENT_ID: z.string().default('app-provisioning-service'),
  KC_SERVICE_CLIENT_SECRET: z.string().default(''),

  // --- outbound email (src/services/mailer.ts) -----------------------------
  // OFF UNLESS CONFIGURED. An environment with no relay must still work —
  // callers say plainly that no mail was sent, rather than failing the act.
  MAIL_ENABLED: booleanish,
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // false = STARTTLS on 587 (what most relays want); true = implicit TLS on
  // 465. Getting this backwards HANGS the connection rather than failing it,
  // which is why it is a dial and not an inference from the port.
  SMTP_SECURE: booleanish,
  // Permit a relay that offers NO TLS at all. Exists for one relay only: the
  // dev stack's Mailpit sink, plain SMTP on the compose-internal network with
  // nothing leaving the machine. Anywhere a credential crosses the wire this
  // stays false and the mailer refuses a relay without STARTTLS.
  SMTP_ALLOW_PLAINTEXT: booleanish,
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  // The envelope sender. Empty falls back to SMTP_USER (what Gmail requires
  // anyway: it REWRITES a From it does not own).
  MAIL_FROM: z.string().default(''),
  MAIL_REPLY_TO: z.string().default(''),
  // The delivery wall (services/mailer.ts): resolved addresses may be REAL
  // people, so a relay credential alone never opens delivery. Every
  // environment states its policy: redirect everything to one test inbox, or
  // allowlist who it may mail ('*' = open — production, and the dev sink).
  // Both empty = every recipient refused, loudly.
  MAIL_REDIRECT_TO: z.string().default(''),
  MAIL_RECIPIENT_ALLOWLIST: z.string().default(''),
  // Never let a wedged relay hold a request open.
  MAIL_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

  // Where the LINKS IN MAIL point. Must name the origin the RECIPIENT's
  // browser can reach — a wrong value produces links that resolve for the
  // server and for nobody else.
  APP_PUBLIC_URL: z.string().default('http://localhost:3000'),

  // How long a set-password link stays usable. THREE DAYS, not three minutes:
  // it is mailed to a new starter who may be reading it on Monday.
  PASSWORD_INVITE_TTL_HOURS: z.coerce.number().int().positive().default(72),

  REDIS_ENABLED: booleanish,
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // --- external document store (src/services/dms.ts, Mayan EDMS) -----------
  DMS_ENABLED: booleanish,
  DMS_URL: z.string().default(''),
  DMS_USERNAME: z.string().default(''),
  DMS_PASSWORD: z.string().default(''),
  DMS_DOCUMENT_TYPE: z.string().default('Default'),
  // true = skip TLS verification on the DMS hop ONLY (an internal-CA cert);
  // every other outbound connection keeps full verification.
  DMS_TLS_INSECURE: booleanish,

  // Swagger UI + the OpenAPI spec at <base>/docs. OFF unless configured: an
  // image never serves its own map unless the stack explicitly asks
  // (docker-compose.dev.yml does). Deliberately NOT gated on NODE_ENV — the
  // Dockerfile hardcodes NODE_ENV=production even for the dev stack, so that
  // signal cannot tell dev from deployed.
  API_DOCS_ENABLED: booleanish,

  LOG_LEVEL: z.string().default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('json'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
  throw new Error(`Invalid environment: ${detail}`)
}

const raw = parsed.data

export const env = {
  ...raw,
  basePaths: raw.BASE_PATHS.split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('/') ? p : `/${p}`)),
  corsOrigins:
    raw.CORS_ORIGINS.trim() === '*'
      ? ('*' as const)
      : raw.CORS_ORIGINS.split(',')
          .map((o) => o.trim())
          .filter(Boolean),
  mfaOrigins: raw.MFA_ORIGINS.split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  kcIssuer: raw.KC_ISSUER || `${raw.KC_URL.replace(/\/+$/, '')}/realms/${raw.KC_REALM}`,
  kcJwksUri: `${raw.KC_URL.replace(/\/+$/, '')}/realms/${raw.KC_REALM}/protocol/openid-connect/certs`,
  kcOidcBase: `${raw.KC_URL.replace(/\/+$/, '')}/realms/${raw.KC_REALM}/protocol/openid-connect`,
  kcAdminBase: `${raw.KC_URL.replace(/\/+$/, '')}/admin/realms/${raw.KC_REALM}`,
  mailFrom: raw.MAIL_FROM || raw.SMTP_USER,
  appPublicUrl: raw.APP_PUBLIC_URL.replace(/\/+$/, ''),
  isProduction: raw.NODE_ENV === 'production',
}

export type Env = typeof env
