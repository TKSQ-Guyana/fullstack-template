#!/bin/sh
# Apply pending migrations, then serve. Idempotent — a replica racing another
# replica loses the migration transaction and continues; the schema is safe.
#
# The migrate step RETRIES rather than dying: on a cold `up --build` this
# container can win the race against Postgres (compose's service_healthy gate
# notwithstanding — a first boot of the postgres image initdb's before it
# answers), and `set -e` would turn that into a crash-loop. Bounded, so a
# genuinely unreachable database still fails loudly instead of hanging.
set -e

if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  attempt=0
  until node scripts/migrate.mjs up; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
      echo "[entrypoint] migrations failed after ${attempt} attempts — giving up" >&2
      exit 1
    fi
    echo "[entrypoint] database not ready (attempt ${attempt}) — retrying in 2s"
    sleep 2
  done
  echo "[entrypoint] migrations applied"
fi

# The realm's own migrations: ensure the Keycloak structure this build needs
# (realm roles, tenant groups) exists, as the service account. NEVER FATAL —
# the app must not go down over realm housekeeping, so a missing grant is
# logged by the script and boot continues.
if [ "${SKIP_REALM_ENSURE:-false}" != "true" ]; then
  echo "[entrypoint] ensuring keycloak realm structure"
  node scripts/kc-ensure-realm.mjs || echo "[entrypoint] realm ensure failed — continuing" >&2
fi

# The DMS's own migrations, same posture as the realm's. Only when the DMS is
# actually connected, and NEVER FATAL — a Mayan that is still booting (the dev
# stack's cold start takes minutes) or unreachable must not take the app down;
# the dev stack's mayan-bootstrap one-shot re-runs the same script once Mayan
# turns healthy, and any later boot heals a deployment the same way.
if [ "${DMS_ENABLED:-false}" = "true" ] && [ "${SKIP_DMS_ENSURE:-false}" != "true" ]; then
  echo "[entrypoint] ensuring dms structure"
  node scripts/dms-ensure.mjs || echo "[entrypoint] dms ensure failed — continuing" >&2
fi

echo "[entrypoint] starting backend"
exec node dist/index.js
