# Deployment environment

Every variable the two images read, what each is for, and — the part that
matters at cutover — the smallest set that produces a working deployment and
how to tell it worked. Env vars configure the IMAGES; operational dials that
should change without a redeploy belong in `app.config` rows instead.

## Backend (`backend/Dockerfile`)

The complete reference is `backend/.env.example` (kept exhaustive — every
variable `src/config/env.ts` reads, with its default). The deployment-shaping
ones:

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | The one hard dependency. The entrypoint applies migrations against it on every boot. |
| `KC_URL`, `KC_REALM`, `KC_CLIENT_ID` | The realm and the public SPA client the password grant runs against (Direct Access Grants ON, no secret). |
| `KC_ISSUER` | Set when browsers and the backend reach Keycloak at DIFFERENT addresses — it must equal the issuer browsers' tokens carry. |
| `KC_SERVICE_CLIENT_ID/SECRET` | The confidential service account. Needs realm-management grants: `view-realm`, `view-users`, `manage-realm`, `manage-users` (granted BY HAND once per realm). |
| `AUTH_COOKIE_SECURE` | Image default `true`. Override to `false` only on a plain-http trial, where Secure cookies silently never return. |
| `BASE_PATHS` | Default `/app/v1,/api/v1`. Changing the first segment requires rebuilding the image (the MFA UI bakes it). |
| `MFA_RP_ID`, `MFA_ORIGINS`, `MFA_PUBLIC_URL` | MUST name the app's public origin — a passkey is bound to the exact host the phone's browser shows; localhost defaults fit only the dev stack. |
| `MAIL_*` | See the delivery wall below. |
| `DMS_*` | `DMS_ENABLED=false` (default) is supported placeholder mode. |
| `REDIS_*` | Optional; off = in-memory rate limit + DB idempotency. On = shared across replicas. |
| `API_DOCS_ENABLED` | Default off. A deployed instance should not serve its own map. |

### The mail delivery wall (deliberate, per environment)

Delivery is CLOSED even with a working relay. Exactly one of:

- `MAIL_REDIRECT_TO=<one test inbox>` — QA/UAT: every message goes only
  there, original recipients ride as `X-Original-*` headers.
- `MAIL_RECIPIENT_ALLOWLIST=@your-domain.tld` (or full addresses, or `*` for
  open delivery — production).

Neither set = every recipient refused, loudly, in the logs.

## Frontend (`frontend/Dockerfile`)

| Variable | Why |
| --- | --- |
| `KC_URL`, `KC_REALM` | What the BROWSER uses — the public edge. Written into `/config.js` at container start. |
| `KC_INTERNAL_URL` | What NGINX dials for `/kcadmin` — Keycloak's inside address when the public edge cannot be hairpinned. Defaults to `KC_URL`. |
| `API_UPSTREAM` | Origin only — no path, no trailing slash. Feeds `proxy_pass ${API_UPSTREAM}/app/v1/`. |
| `API_BASE`, `USERS_BASE` | Paths the browser uses; `USERS_BASE` must stay a PATH (an absolute URL skips the proxy — the start-up script warns). |
| `MFA_ENABLED` | Default `true`; `false` is the only string that disables the gate. Fails CLOSED against an unreachable upstream. |
| `MFA_BASE` | Empty = "this origin" (deployed shape). Set only for tunnel-based phone testing. |
| `UPLOAD_MAX` | Body ceiling on the `/app/v1/` proxy (document uploads ride it). Default `25m`. |
| `APP_NAME` | Display name in the chrome and mail. |

## Smallest working set

A single host, https at `https://app.example.org`, managed Postgres, Keycloak
at `https://id.example.org`:

```bash
# backend
DATABASE_URL=postgres://app:***@db-host:5432/app_db
KC_URL=https://id.example.org
KC_REALM=app-realm
KC_SERVICE_CLIENT_SECRET=***             # after regenerating it in the realm
MFA_RP_ID=app.example.org
MFA_ORIGINS=https://app.example.org
MFA_PUBLIC_URL=https://app.example.org
MAIL_ENABLED=true SMTP_HOST=... SMTP_USER=... SMTP_PASSWORD=...
MAIL_REDIRECT_TO=qa-inbox@example.org    # until go-live; then the allowlist

# frontend
KC_URL=https://id.example.org
KC_INTERNAL_URL=http://keycloak.internal:8080   # if the edge cannot hairpin
KC_REALM=app-realm
API_UPSTREAM=http://backend:8081
```

Realm prep (once): import a clean export (no dev users), regenerate the
`app-provisioning-service` secret, grant its service account the four
realm-management roles, enable Direct Access Grants on `web-app`, and add the
app's origin to that client's Web Origins.

## How to tell it worked

1. `GET /health` on the backend answers 200 with `db: true`.
2. The backend's boot log shows `migrations applied`, the realm-ensure
   report, and `mail relay ready` with the policy line (a `delivery is
   CLOSED` warning here means the wall is up and nobody stated the policy).
3. The frontend container's log shows `40-runtime-config.sh: wrote ...` with
   the right KC_URL/KC_REALM and no warnings.
4. Sign in with a provisioned account; `GET /app/v1/me` (via the browser's
   network tab) shows the expected role and permissions.
5. Send a set-password invitation; it arrives where the delivery policy says
   it must (the redirect inbox, or the real mailbox on an allowlisted domain).
