# backend

Express 5 / TypeScript over Postgres, layered MVC: thin controllers, use-case
services, pure domain rules, SQL-only repositories, JSON-only presenters.
Errors are RFC-7807 problem+json throughout.

## Layout

| Folder                         | What lives there                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| `src/controllers/`             | one Router per resource — parse, authorise, call a service, answer                   |
| `src/services/`                | use-cases — one transaction each (`db/transaction.ts`)                               |
| `src/domain/`                  | pure rules and `DomainError` — no IO, unit-tested beside them                        |
| `src/repositories/`            | the only SQL (Kysely; types in `src/db/schema.generated.ts`)                         |
| `src/presenters/`              | rows → the contract's JSON                                                           |
| `src/integrations/`            | Keycloak (session, service account), mail, SMS, Mayan                                |
| `src/db/`                      | the pool, Kysely, the transaction helpers (`db/transaction.ts`), the acting identity |
| `src/http/`, `src/middleware/` | problem+json, auth, RBAC, idempotency, rate limit, the error handler                 |
| `src/auth/`                    | claims → personas, the operation matrix                                              |
| `src/mfa/`                     | the WebAuthn second factor — a self-contained module                                 |

The layer rules are enforced by `eslint-plugin-boundaries` (`eslint.config.js`);
`docs/ARCHITECTURE.md` §3.2 has the table and the reasons.

## Surface

- `/auth/*` — server-side Keycloak session (HttpOnly cookies)
- `/mfa/*` — the WebAuthn second factor (pre-auth; the one-time token is the credential)
- `/password-setup/*` — the set-password link's public half
- `/docs/` — Swagger UI, only when `API_DOCS_ENABLED`
- `/accounts/*` — set-password invitations (gated on the caller's manage-users)
- `/me`, `/notes*`, `/document/*` — behind `authenticate`
- `/health` — root-mounted, outside the API root

## Run it locally

```bash
cp .env.example .env       # defaults point at the dev stack (Postgres :5433, Keycloak :8085)
npm run dev                # tsx watch
```

Or as part of the whole stack: `docker compose -f docker-compose.dev.yml up
-d --build` from the repo root (the image applies migrations on boot).

## Tooling

| Command                                               | What                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm run migrate` / `migrate:down` / `migrate:status` | the plain-SQL runner                                                     |
| `npm run db:types`                                    | regenerate `src/db/schema.generated.ts` from `DATABASE_URL`              |
| `npm run db:types:check`                              | fail when the committed schema types no longer match the database        |
| `npm run test`                                        | vitest — domain, presenters, HTTP via `buildApp()`; needs no DB          |
| `npm run test:db`                                     | the `*.db.test.ts` repository tests against `DATABASE_URL` (rolled back) |
| `npm run smoke`                                       | end-to-end walk against a RUNNING stack (writes a note, deletes it)      |
| `npm run docs:lint`                                   | validate `src/docs/openapi.yaml` (redocly)                               |
| `node scripts/build-single-migration.mjs`             | regenerate `docs/sql/` after any migration                               |
| `npm run pre-push-check`                              | the full gate (lint, format, typecheck, test, build)                     |

## Conventions

Migrations are the only schema channel (numbered, paired `.down.sql`, never
edit an applied one); each is followed by `npm run db:types` in the same
commit. A business rule is a pure function in `src/domain/` with a test
beside it, and refuses by throwing a `DomainError`. Any route/contract change
updates `src/docs/openapi.yaml` AND `docs/postman/` in the same commit.
`src/config/env.ts` is the only `process.env` reader in `src/` — and
`.env.example` documents every key it has.
