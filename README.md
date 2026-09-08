# fullstack-template

Fork-and-start full-stack TypeScript template:

- **backend/** — Node 20+ / Express 5 / TypeScript over Postgres (thin routes → SQL
  `app.api_*` functions), Keycloak server-side auth (HttpOnly cookies), RFC-7807 errors,
  mailer with a closed-by-default delivery policy, optional document store (Mayan) and
  MFA/WebAuthn.
- **frontend/** — React 18 + Vite + TypeScript, Tailwind v4 tokens, one route manifest,
  pure authz engine, cookie-session facade.
- **One-command dev stack** — `docker compose -f docker-compose.dev.yml up -d --build`
  self-bootstraps Postgres, Keycloak (realm + demo users), Redis, Mailpit, backend, frontend.

> Full quickstart, fork checklist and architecture notes land with the build phases;
> see `docs/` and `CLAUDE.md`.
