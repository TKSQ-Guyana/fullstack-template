# keycloak-local

The local Keycloak realm and its seeder.

## Start it

Nothing to do by hand — `docker compose -f docker-compose.dev.yml up -d --build`
imports `realm-export.json` into the Keycloak container (:8085, admin/admin)
and the one-shot `kc-bootstrap` sidecar runs `setup-dev.mjs` against it.

## Accounts

Three demo users, one per persona; every one signs in with the
`APP_DEV_PASSWORD` from your repo-root `.env` (copy `.env.dev.example`):

| Username              | Persona | Notes                                             |
| --------------------- | ------- | ------------------------------------------------- |
| `admin@example.dev`   | ADMIN   | also holds realm-management roles for /kcadmin    |
| `manager@example.dev` | MANAGER | writes notes                                      |
| `user@example.dev`    | USER    | read-only                                         |

## What setup-dev.mjs does and why

A realm export cannot carry everything. On every `up` the seeder (idempotent)
ensures: local web origins on the `web-app` client, the `APP_*` realm roles
(from the shared `backend/scripts/kc-realm-structure.mjs` module — the same
declaration the backend's boot-time realm ensure applies to DEPLOYED realms),
the `app-provisioning-service` service-account grants, tenant groups when the
module declares any, and the demo users with their password reset.

## Lifecycle

- `docker compose down` keeps the Keycloak volume — realm and users survive.
- `docker compose down -v` discards it; the next `up` re-imports and reseeds.
- Targeted re-seed without a restart:
  `KC=http://localhost:8085 APP_DEV_PASSWORD=... node keycloak-local/setup-dev.mjs`

## Deployed realms

Import a NEW export without the dev pieces, regenerate the
`app-provisioning-service` secret, and grant that service account
`view-realm`, `view-users`, `manage-realm`, `manage-users` by hand — the
backend entrypoint's `kc-ensure-realm.mjs` then keeps the structure current
(non-fatal when a grant is missing; `SKIP_REALM_ENSURE=true` disables).
