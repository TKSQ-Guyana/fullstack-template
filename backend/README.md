# backend

Express 5 / TypeScript over Postgres. Thin routes call `app.api_*` SQL
functions; errors are RFC-7807 problem+json throughout.

## Surface

- `/auth/*` — server-side Keycloak session (HttpOnly cookies)
- `/mfa/*` — the WebAuthn second factor (pre-auth; the one-time token is the credential)
- `/password-setup/*` — the set-password link's public half
- `/docs/` — Swagger UI, only when `API_DOCS_ENABLED`
- `/kcadmin/*` — Keycloak admin pass-through (the caller's own token)
- `/accounts/*` — set-password invitations (gated on the caller's manage-users)
- `/me`, `/notes*`, `/document/*` — behind `authenticate`
- `/health` — root-mounted, outside the base paths

## Run it locally

```bash
cp .env.example .env       # defaults point at the dev stack (Postgres :5433, Keycloak :8085)
npm run dev                # tsx watch
```

Or as part of the whole stack: `docker compose -f docker-compose.dev.yml up
-d --build` from the repo root (the image applies migrations on boot).

## Tooling

| Command                                               | What                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run migrate` / `migrate:down` / `migrate:status` | the plain-SQL runner                                                |
| `npm run test`                                        | vitest (unit + supertest against `buildApp()`; needs no DB)         |
| `npm run smoke`                                       | end-to-end walk against a RUNNING stack (writes a note, deletes it) |
| `npm run docs:lint`                                   | validate `src/docs/openapi.yaml` (redocly)                          |
| `node scripts/build-single-migration.mjs`             | regenerate `docs/sql/` after any migration                          |
| `npm run pre-push-check`                              | the full gate (lint, format, typecheck, test, build)                |

## Conventions

Migrations are the only schema channel (numbered, paired `.down.sql`, never
edit an applied one). Any route/contract change updates `src/docs/openapi.yaml`
AND `docs/postman/` in the same commit. `src/config/env.ts` is the only
`process.env` reader in `src/` — and `.env.example` documents every key it has.
