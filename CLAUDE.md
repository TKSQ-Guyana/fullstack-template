# <Your product> — project instructions

<One paragraph: what the product is, who runs it, and the one official name
to use everywhere. If a design reference spells the name differently, say so
here and say which spelling wins.>

## Working agreements (standing rules)

- **Commit at every working logic state** — each task, and any intermediate
  point where the code works. One commit per unit of work; the history is the
  review trail. Conventional-commit subjects naming the area.
- **Never `git push` unless explicitly asked.** "Create a PR" implies the one
  push that creates it; later commits wait locally.
- **Maintained API docs**: `backend/src/docs/openapi.yaml` (the contract,
  Swagger UI at `<base>/docs/` when `API_DOCS_ENABLED`) AND
  `docs/postman/*.postman_collection.json` (the exerciser). Any route/param/
  contract change updates BOTH in the same session and commits them — every
  time, no asking. Validate with `npm run docs:lint` (backend workspace).
- **Maintained SQL bundle**: `docs/sql/app_single_migration.sql` is the whole
  lineage as one psql file. Any new migration regenerates it
  (`node backend/scripts/build-single-migration.mjs`) and commits it.
- **Migrations are the only schema channel.** Add new numbered files with
  paired `.down.sql`; never edit one that has been applied anywhere.
- **Postgres + backend are the ONLY data source.** No mock/seed data in the
  frontend; failure is loud — never fall back to fixtures when a call fails.
- **Mail secret lives in `backend/.env.mail`** (gitignored) and nowhere else;
  compose loads it AFTER the committed `backend/mail.dev.env` so a real relay
  overrides the Mailpit sink key by key. **Delivery is CLOSED by default even
  with a relay** — each environment states `MAIL_REDIRECT_TO` (one test
  inbox) or `MAIL_RECIPIENT_ALLOWLIST` (`@domain`/address entries; `*` =
  open). Neither set = every recipient refused.
- **Deployed realms need grants on `app-provisioning-service`**:
  `view-realm`, `view-users`, `manage-realm`, `manage-users` — or the
  boot-time realm ensure and server-side lookups silently skip
  (`SKIP_REALM_ENSURE=true` disables; the entrypoint is non-fatal about it).
- **Ask before touching a deployment database.** <Name the hosts here.>
  The local stack's `app_db` (localhost:5433) is fair game.

## Architecture

`backend/` (Node 20+/Express 5/TS) serves `/app/v1` (frontend, via
vite/nginx proxy) and `/api/v1` (Postman), calling `app.api_*` SQL functions
(`callApi` in `src/db/pool.ts`). Errors are RFC-7807 problem+json throughout.

- **Auth is server-side**: the browser holds NO tokens. `POST /auth/login`
  runs the Keycloak password grant and sets HttpOnly SameSite=Strict cookies;
  middleware accepts cookie or Bearer; `/kcadmin/*` is a pass-through
  forwarding the caller's own token. Frontend `@/auth/keycloak.ts` is a thin
  `/auth/*` client with a keycloak-js-shaped surface.
- **Roles**: Keycloak `APP_ADMIN/APP_MANAGER/APP_USER` → personas
  `ADMIN/MANAGER/USER`. Backend matrix in `src/auth/permissions.ts`; frontend
  policy in `src/authz/policy.ts`; `GET /me` is the runtime cross-check.
- **Routes derive from one manifest** (`frontend/src/routes/manifest.tsx`):
  router, sidebar and the dev integrity audit all read it.
- **Documents** ride the backend's `/document/upload|list|view` facade over
  Mayan (`DMS_ENABLED=false` = placeholder mode).
- **MFA** (WebAuthn phone approval) lives in `backend/src/mfa`; the phone
  pages are the `mfa-ui` workspace, served at `<base>/mfa/*`.

## Local stack

**One-click, self-bootstrapping**: `cp .env.dev.example .env` once (sets
APP_DEV_PASSWORD), then `docker compose -f docker-compose.dev.yml up -d
--build` → Postgres in-stack (**host port 5433** — 5432 stays with the
machine's own PostgreSQL; db `app_db`; the backend applies migrations on
start), Keycloak :8085 (admin/admin, realm `app-realm`, auto-imported AND
auto-seeded by the one-shot `kc-bootstrap`), backend :8081 (`/health`),
nginx frontend :3000, Mailpit :8025. Mayan :8888 only with `--profile dms`
(+ `APP_DMS_ENABLED=true`; first boot ~5 min). `down` keeps the volumes;
`down -v` is the genuine cold start. Frontend dev loop: vite at **:5173**
(hot reload — don't rebuild docker for frontend changes). Demo accounts:
`admin|manager|user@example.dev`, password = your APP_DEV_PASSWORD.

## After every task

Backend change: `docker compose -f docker-compose.dev.yml up -d --build backend`
then check `/health`. Frontend: vite hot-reloads. Gates (each workspace):
`npm run lint && npm run typecheck && npm run test && npm run build`.
Avoid `backend/scripts/smoke.mjs` casually — it writes test data.
