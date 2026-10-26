# Frontend — build once, promote everywhere.
#
# BUILT FROM THE REPO ROOT (the workspaces' one lockfile lives there):
#   docker build -f frontend/Dockerfile -t app-frontend .

# --- Build stage ---
FROM node:22-alpine AS build
WORKDIR /repo

ENV HUSKY=0
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
RUN npm ci --workspace=frontend --include-workspace-root=false --ignore-scripts --no-audit --no-fund

COPY frontend frontend

# No --mode and no .env.production, deliberately. Keycloak's URL and realm are
# NOT baked in here: they are written into /config.js when the container
# starts (docker/40-runtime-config.sh), so this image is not tied to the
# environment that built it and a tested UAT image is promoted to production
# unchanged.
WORKDIR /repo/frontend
RUN npm run build

# --- Runtime stage ---
FROM nginx:1.29-alpine AS runtime

# A TEMPLATE, not a finished config: the proxy targets (backend, Keycloak)
# only exist at run time. nginx's own 20-envsubst script fills it in.
COPY frontend/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/frontend/dist /usr/share/nginx/html

# The official image runs every /docker-entrypoint.d/*.sh before starting
# nginx, so there is no custom ENTRYPOINT to write — which also leaves nginx
# as PID 1 with its own signal handling. `chmod` because a checkout on Windows
# carries no exec bit.
#
# The 40- prefix runs it after the image's own 20-envsubst (which fills the
# nginx template), and it writes the browser's /config.js.
COPY frontend/docker/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh

# Only these prefixes are substituted into the nginx template. WITHOUT THE
# FILTER, envsubst would also eat nginx's own runtime variables —
# $http_authorization, $remote_addr, $proxy_add_x_forwarded_for — and replace
# them with empty strings, quietly breaking the proxy it is meant to configure.
ENV NGINX_ENVSUBST_FILTER="^(KC_|API_|MFA_|UPLOAD_|APP_)"

# Defaults for a plain `docker run` with no -e flags. Override per environment;
# the app falls back to its build-time values if these are blanked.
ENV KC_URL=http://localhost:8085 \
    KC_REALM=app-realm \
    API_BASE=/api/v1 \
    # Where /api/v1/ is forwarded. It goes straight into proxy_pass, so it can
    # never be empty; an unconfigured deployment 502s on API calls, which is
    # the honest answer — the app is live-only and has no seed to hide behind.
    API_UPSTREAM=http://backend:8081 \
    # Upload ceiling on the /api/v1 proxy — document uploads ride it.
    UPLOAD_MAX=25m \
    # The second factor. ON by default: a security control that has to be
    # switched on is one that will be found switched off. With an unreachable
    # upstream the gate fails CLOSED, never open.
    MFA_ENABLED=true
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
