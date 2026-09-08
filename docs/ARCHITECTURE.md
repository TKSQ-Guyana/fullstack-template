# Architecture

How the pieces fit, and why each boundary sits where it does. Numbered so a
review can point at a section.

## 1. Overview

Two deployable images and an identity provider:

```
browser ── nginx (frontend image) ──┬── static SPA (built once, configured at runtime)
                                    ├── /app/v1/*  ──→ backend (Express 5)
                                    └── /kcadmin/* ──→ Keycloak admin API (caller's own token)
backend ──→ Postgres (app.api_* SQL functions)
        ──→ Keycloak (password grant, JWKS, service account)
        ──→ SMTP relay (closed-by-default delivery policy)
        ──→ Mayan EDMS (optional, /document facade)
```

In development, vite replaces nginx and proxies the same two prefixes.

## 2. Identity

The browser holds NO tokens. `POST /auth/login` runs the Resource Owner
Password grant server-side and answers HttpOnly SameSite=Strict cookies that
carry the Keycloak tokens themselves — stateless: any backend instance can
answer any request, and Keycloak stays the single authority (a revoked
session dies at the next refresh). CSRF posture: SameSite=Strict + JSON-only
auth routes + restricted CORS; no separate CSRF token.

Roles: realm roles `APP_*` map to personas in `backend/src/auth/claims.ts`
(mirror: `frontend/src/auth/claims.ts`). The backend enforces the operation
matrix (`auth/permissions.ts`, `requireOperation`); the frontend's pure authz
engine (`src/authz/`) answers the same questions for show/hide; `GET /me`
returns the backend's verdict so the two can be cross-checked at runtime.

`/kcadmin` adds no privilege: it forwards the CALLER's own verified token, so
Keycloak authorises account administration against their realm-management
roles. The service account (`app-provisioning-service`) exists for the calls
that have no caller: boot-time realm ensure, the set-password write, the MFA
phone-number lookup.

## 3. Data

### 3.1 Migrations as the only schema channel

Plain SQL files, `backend/migrations/NNNN_name.sql` with paired `.down.sql`,
applied by `scripts/migrate.mjs` in filename order, each in its own
transaction, ledgered in `public.app_migrations`. The container entrypoint
runs `up` on every boot (bounded retries, fatal on exhaustion). Never edit an
applied migration; regenerate `docs/sql/app_single_migration.sql` after every
new one — the bundle and the runner are interchangeable by construction.

### 3.2 The thin chain

Business logic lives in `app.api_*` SQL functions returning contract-shaped
camelCase JSONB. Routes are: RBAC gate → shape validation → one `callApi()`
→ answer. Postgres errors translate centrally (SQLSTATE → problem+json:
23505→409, FK/check/not-null/P0001→422, bad input→400). A `RAISE EXCEPTION`
in a function IS the business-rule refusal.

### 3.3 Config-not-code

Operational dials live in `app.config` rows; every console change appends to
`app.config_audit`, which is append-only BY TRIGGER — an audit trail whose
rows can be edited is a diary.

## 4. External systems get boot-time ensure scripts

The database is not special: Keycloak structure (`kc-ensure-realm.mjs`,
reading the shared `kc-realm-structure.mjs` declaration) and the DMS
(`dms-ensure.mjs`) are ensured at boot the same way — idempotent
get-or-create. Their failure posture differs from migrations ON PURPOSE:
realm and DMS housekeeping is never worth taking the app down for, so both
log and continue (`SKIP_*` overrides exist for all three phases).

## 5. The frontend's load-bearing patterns

- **Runtime config triangle**: a classic `/config.js` populates
  `window.__ENV__` before the module bundle; `config/runtime.ts` resolves
  runtime → build-time → default (blank = absent). One image, every
  environment; the vite dev middleware mirrors the container's script so one
  `.env` drives both.
- **One route manifest** (`routes/manifest.tsx`): the router, the sidebar and
  the dev integrity audit derive from it; guarded areas are wrapped in
  `RequirePermission` inside the derivation, so no route bypasses
  authorization by construction. Guards nest coarsest-first; permission
  denial renders in place (URL and shell intact), never redirects.
- **The session facade** (`auth/keycloak.ts`) keeps a keycloak-js-shaped
  surface over the cookie session: identity-stable snapshots for
  `useSyncExternalStore`, single-flight refresh, deduped restore.
- **The list-hook contract** (`hooks/useNotes.ts` is the exemplar):
  `{rows, loaded, error, reload}` — error returned, never thrown or
  swallowed; alive-flag cleanup; in-flight dedup.
- **apiClient**: one funnel — freshness before the call, one forced refresh +
  one retry on 401, 403 is never a sign-out, empty 2xx is null, non-JSON 2xx
  is named as "you reached a web server, not the API".

## 6. MFA (WebAuthn phone approval)

Lives IN the backend (`src/mfa`), under the API base path on purpose: one
edge door, no extra WAF/ingress rule. Three protections in honest order: the
passkey (cryptographic), the same-browser refusal (server-enforced marker
cookie), the desktop refusal (advisory UA/client-hints, with the iPad touch
self-rescue). State is Postgres — single-use is `DELETE … RETURNING`, atomic
across replicas; the "approved" push is a WebSocket with pg_notify fan-out
and a polling fallback.

## 7. Mail

One pooled transport; nothing throws past the mailer — every path returns
`{sent, reason}` so the act that triggered the mail never fails over
delivery. THE DELIVERY WALL: with no `MAIL_REDIRECT_TO` and no
`MAIL_RECIPIENT_ALLOWLIST`, every recipient is refused loudly — a relay
credential alone never opens delivery, because resolved addresses are real
people. The dev stack's "relay" is Mailpit (`backend/mail.dev.env`), and a
real credential in the gitignored `backend/.env.mail` overrides it key by key.

## 8. Environments & operations

Dev: `docker-compose.dev.yml` (self-bootstrapping, `${APP_*}` overrides,
one-shot seeder sidecars). Deployment: the two images (built from the repo
root — the workspaces' one lockfile lives there) via `docker-compose.yml` or
Kubernetes; `docs/DEPLOYMENT-ENV.md` carries the variable reference and the
smallest working set. CI runs the same gates as the pre-push hook, per
workspace; `docker-release.yml` publishes images with registry/prefix from
repo variables.

## 9. Known gaps

- No E2E browser-test workspace (the reference project keeps Playwright in a
  separate workspace; add one on the same pattern).
- The notes example demonstrates CRUD but not a workflow state machine —
  transition functions + audit trail + notifications are the natural next
  pattern to port when a fork needs them.
- Single SPA client; a dual-portal split (two Keycloak clients, two route
  trees) is a documented extension of `kcSession.ts`.
