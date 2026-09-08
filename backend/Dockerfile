# Backend — multi-stage build.
#   build:   full dev deps, tsc compile
#   mfa-ui:  the phone-facing WebAuthn pages (the mfa-ui workspace, Vite)
#   runtime: prod deps only, non-root, migrations then serve
#
# BUILT FROM THE REPO ROOT, because npm workspaces keep ONE lockfile there:
#   docker build -f backend/Dockerfile -t app-backend .
# (docker-compose.dev.yml and .github/workflows/docker-release.yml both do.)

FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY backend/package.json backend/
# The workspace's dependency tree from the ROOT lockfile — reproducible, and
# the only place the tree is recorded.
RUN npm ci --workspace=backend --include-workspace-root=false --no-audit --no-fund
COPY backend/tsconfig.json backend/tsconfig.build.json backend/
COPY backend/src backend/src
# scripts/ too: `npm run build` is tsc PLUS copy-templates.mjs, which lifts the
# email templates and the OpenAPI spec into dist. tsc emits .ts and nothing
# else, so without that step the image ships a dist whose template reads fail
# at the first send.
COPY backend/scripts backend/scripts
WORKDIR /repo/backend
RUN npm run build

# --- the phone-facing MFA UI (/enroll, /verify) -------------------------------
# The WebAuthn service lives IN this backend (src/mfa), so this image also
# carries the pages a PHONE opens. Their source is the mfa-ui workspace in the
# same build context. No lockfile exists at the workspace level (workspaces
# hoist to the root), so this stage installs from the root lockfile too.
FROM node:22-alpine AS mfa-ui
WORKDIR /repo
COPY package.json package-lock.json ./
COPY mfa-ui/package.json mfa-ui/
RUN npm ci --workspace=mfa-ui --include-workspace-root=false --no-audit --no-fund
COPY mfa-ui/tsconfig.json mfa-ui/vite.config.ts mfa-ui/index.html mfa-ui/
COPY mfa-ui/src mfa-ui/src
WORKDIR /repo/mfa-ui
# The pages live UNDER THE PRIMARY API BASE PATH (src/mfa/index.ts): the base
# prefixes every asset URL with /app/v1/mfa/ so the hashed build output rides
# the same door as the API. A deployment that changes BASE_PATHS[0] must
# rebuild with a matching MFA_BASE_PATH.
RUN MFA_BASE_PATH=/app/v1/mfa/ npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    LOG_FORMAT=json \
    # Secure on the session cookies. TRUE here because this image is the real
    # deployment and real deployments sit behind https — a cookie without
    # Secure on a public edge is the mistake this default prevents. Local
    # plain-http stacks (docker-compose.dev.yml) override it to false, or the
    # browser silently never returns the cookie.
    AUTH_COOKIE_SECURE=true
WORKDIR /repo
COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci --workspace=backend --include-workspace-root=false --omit=dev --no-audit --no-fund \
  && npm cache clean --force
WORKDIR /repo/backend
COPY --from=build /repo/backend/dist ./dist
# Where src/mfa looks for the built pages (env MFA_UI_DIR, default ./mfa-ui).
# A deployment must also set MFA_RP_ID / MFA_ORIGINS / MFA_PUBLIC_URL to the
# app's public origin — a passkey is bound to the exact host the phone's
# browser shows, and the localhost defaults only fit the local stack.
COPY --from=mfa-ui /repo/mfa-ui/dist ./mfa-ui
COPY backend/migrations ./migrations
COPY backend/scripts/migrate.mjs ./scripts/migrate.mjs
# The realm's own "migrations" — the entrypoint ensures the Keycloak structure
# (realm roles, tenant groups) the same way it applies the schema.
COPY backend/scripts/kc-ensure-realm.mjs backend/scripts/kc-realm-structure.mjs ./scripts/
# And the DMS's: run at boot when DMS_ENABLED, so a deployed image provisions
# Mayan the way it provisions Keycloak (non-fatal; SKIP_DMS_ENSURE=true).
COPY backend/scripts/dms-ensure.mjs ./scripts/
COPY backend/docker-entrypoint.sh ./docker-entrypoint.sh

# Run as the unprivileged node user the base image ships.
USER node
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-8081}/health || exit 1

ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
