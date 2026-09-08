# fullstack-template

A fork-and-start full-stack TypeScript template, extracted from a production
government portal. The point is not the code volume — it is the set of
patterns that survived contact with deployment, each carried over with the
comment that explains why it exists.

## The stack

| Piece         | Choice                                                                    |
| ------------- | ------------------------------------------------------------------------- |
| **backend/**  | Node 20+ · Express 5 · TypeScript · Postgres (thin routes → `app.api_*` SQL functions) |
| **frontend/** | React 18 · Vite 7 · TypeScript · Tailwind v4 tokens · Zustand              |
| **mfa-ui/**   | The phone-facing WebAuthn pages, built into the backend image              |
| **Identity**  | Keycloak — the backend runs the password grant and holds the session in HttpOnly cookies; the browser never sees a token |
| **Dev stack** | One command: Postgres, Keycloak (auto-imported + auto-seeded), Redis, Mailpit, backend, frontend — Mayan EDMS behind a profile |

## Quickstart

```bash
cp .env.dev.example .env          # set APP_DEV_PASSWORD (the demo accounts' password)
docker compose -f docker-compose.dev.yml up -d --build
```

| Where     | What                                                          |
| --------- | ------------------------------------------------------------- |
| :3000     | the app (sign in: `manager@example.dev` / your APP_DEV_PASSWORD) |
| :8081     | the backend — `/health`, `/app/v1`, `/api/v1`, Swagger at `/api/v1/docs/` |
| :8085     | Keycloak (admin/admin, realm `app-realm`)                      |
| :5433     | Postgres (postgres/postgres, db `app_db`)                      |
| :8025     | Mailpit — every mail the stack sends lands here                |

Frontend dev loop (hot reload — don't rebuild docker for frontend changes):

```bash
npm install
npm run dev --workspace=frontend      # vite at :5173, proxying /app/v1 to :8081
```

Demo accounts (seeded by `keycloak-local/setup-dev.mjs` on every `up`):
`admin@example.dev` (ADMIN), `manager@example.dev` (MANAGER),
`user@example.dev` (USER — read-only, to see the permission gates work).

## The example feature

**Notes** is one entity wired through every layer, so each convention is
demonstrated rather than described. Follow it end to end, then delete or
rename it:

1. `backend/migrations/0002_notes.sql` — the table AND the contract
   (`app.api_notes_*` returning camelCase JSONB; business rules as
   `RAISE EXCEPTION` → 422 problem+json)
2. `backend/src/services/notes.ts` — one `callApi()` wrapper per operation
3. `backend/src/routes/notes.ts` — RBAC gate → validate → service → answer
4. `backend/src/docs/openapi.yaml` + `docs/postman/` — the maintained pair
5. `frontend/src/services/api/notes.ts` — the typed client
6. `frontend/src/hooks/useNotes.ts` — the list-hook contract
7. `frontend/src/pages/notes/` — `<Can>`-gated writes, confirm on delete
8. `frontend/src/routes/manifest.tsx` — the route + nav entry

## Fork checklist

1. **Use as a GitHub template** (or clone and re-init git).
2. `node scripts/init-template.mjs my-product "My Product"` — renames the
   repo identity, realm, clients and display name (it prints what changed).
3. Define your vocabulary — the four files that change together:
   `backend/src/auth/claims.ts` + `backend/src/auth/permissions.ts`,
   `frontend/src/auth/claims.ts` + `frontend/src/authz/policy.ts` —
   and the realm roles in `backend/scripts/kc-realm-structure.mjs`.
4. Replace the notes example with your first real entity (same eight files).
5. Configure CI: repo variables `REGISTRY`, `IMAGE_PREFIX`; secrets
   `REGISTRY_USERNAME`, `REGISTRY_PASSWORD` (`.github/workflows/docker-release.yml`).
6. For deployment, read `docs/DEPLOYMENT-ENV.md` — the smallest working set
   and how to tell it worked.

## Working agreements the template assumes

- **Migrations are the only schema channel.** Add new numbered files; never
  edit one applied anywhere. Every migration has a `.down.sql`; every new one
  regenerates `docs/sql/` (`node backend/scripts/build-single-migration.mjs`).
- **The API contract is maintained pairwise**: any route change updates
  `backend/src/docs/openapi.yaml` AND `docs/postman/` in the same commit
  (`npm run docs:lint` validates the spec).
- **Postgres + backend are the only data source.** No fixtures, no fallbacks:
  a failed read renders as a failure, never as an empty list.
- **Mail delivery is closed by default** even with a working relay — every
  environment states its policy (`MAIL_REDIRECT_TO` or
  `MAIL_RECIPIENT_ALLOWLIST`). The dev stack delivers into Mailpit.

## Gates

Per workspace: `npm run pre-push-check` = lint + format:check + typecheck +
test + build. The pre-push hook runs it; CI runs the same set — CI must not
be weaker than a developer's own hook. Smoke against a running stack:
`node backend/scripts/smoke.mjs` (writes one note and deletes it).

## More

- `docs/ARCHITECTURE.md` — how the pieces fit and why
- `docs/DEPLOYMENT-ENV.md` — every environment variable, and the smallest working set
- `keycloak-local/README.md` — the realm, the seeder, the lifecycle
- `CLAUDE.md` — the working agreements for AI-assisted sessions
