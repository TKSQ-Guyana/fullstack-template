#!/bin/sh
# Write the app's runtime configuration from this container's environment.
#
# Dropped into /docker-entrypoint.d/, which the official nginx image runs, in
# order, before it starts nginx. That is why there is no custom ENTRYPOINT in
# the Dockerfile: the base image already has the hook, and using it keeps
# nginx as PID 1 with its signal handling intact. The numeric prefix orders it
# after the image's own scripts (10-listen-on-ipv6, 20-envsubst-on-templates,
# 30-tune-worker-processes).
#
# WHY THIS EXISTS: Vite inlines VITE_* variables into the JS bundle at build
# time, so a built image is otherwise permanently pinned to whatever
# environment built it. This writes the values into a small script the page
# loads before the bundle, which lets one tested image be promoted from UAT to
# production unchanged.

set -eu

CONFIG_FILE="${RUNTIME_CONFIG_FILE:-/usr/share/nginx/html/config.js}"

# JS string escaping. Values are URLs and realm names in practice, but a stray
# backslash or quote would otherwise produce a config.js that fails to parse —
# and a syntax error here takes the whole app down with a blank page, since
# nothing after it loads. Backslashes first, or the escaping escapes itself.
esc() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

KC_URL_VALUE="$(esc "${KC_URL:-}")"
KC_REALM_VALUE="$(esc "${KC_REALM:-}")"
API_BASE_VALUE="$(esc "${API_BASE:-}")"
USERS_BASE_VALUE="$(esc "${USERS_BASE:-}")"
MFA_ENABLED_VALUE="$(esc "${MFA_ENABLED:-}")"
MFA_BASE_VALUE="$(esc "${MFA_BASE:-}")"
APP_NAME_VALUE="$(esc "${APP_NAME:-}")"

# NO CREDENTIALS HERE, and there must never be: this file is served to
# browsers. Anything secret belongs in the BACKEND's environment.
cat > "$CONFIG_FILE" <<EOF
// Generated at container start-up by docker/40-runtime-config.sh. Do not edit.
window.__ENV__ = {
  "KC_URL": "${KC_URL_VALUE}",
  "KC_REALM": "${KC_REALM_VALUE}",
  "API_BASE": "${API_BASE_VALUE}",
  "USERS_BASE": "${USERS_BASE_VALUE}",
  "MFA_ENABLED": "${MFA_ENABLED_VALUE}",
  "MFA_BASE": "${MFA_BASE_VALUE}",
  "APP_NAME": "${APP_NAME_VALUE}"
};
EOF

# Provisioning pointed somewhere other than this origin. `usersBase` is a PATH
# nginx proxies; an absolute URL bypasses the proxy and needs CORS on
# Keycloak's admin endpoints, which is not something this image can arrange.
case "${USERS_BASE:-}" in
  http://* | https://*)
    echo "40-runtime-config.sh: WARNING USERS_BASE=${USERS_BASE} is absolute, so provisioning calls will skip this container's /kcadmin proxy and need CORS on Keycloak." >&2
    ;;
esac

# The gate on, but the enrolment link pointing at localhost — which on the
# user's PHONE is the phone itself, so "register a device" opens nothing.
case "${MFA_BASE:-}" in
  *localhost* | *127.0.0.1*)
    if [ "${MFA_ENABLED:-true}" != "false" ]; then
      echo "40-runtime-config.sh: WARNING MFA_BASE=${MFA_BASE} names localhost, which on a phone is the phone itself — the enrolment link will not reach the enrolment pages." >&2
    fi
    ;;
esac

# An unset variable is written as "" and the app falls through to its
# build-time default, so this is a warning rather than a failure — but an
# unnoticed fallback to a development Keycloak is exactly the kind of thing
# that should be loud in the logs.
for name in KC_URL KC_REALM; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "40-runtime-config.sh: WARNING $name is not set; the bundle's build-time default will be used" >&2
  fi
done

echo "40-runtime-config.sh: wrote $CONFIG_FILE (KC_URL=${KC_URL:-<unset>}, KC_REALM=${KC_REALM:-<unset>}, API_BASE=${API_BASE:-<unset>})"
