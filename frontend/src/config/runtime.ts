// Deployment configuration, resolved at RUNTIME rather than baked into the bundle.
//
// THE PROBLEM THIS SOLVES. Vite inlines `import.meta.env.VITE_*` at build
// time: the values become literal strings inside the JS chunk. A container
// built for UAT is therefore permanently a UAT container, `docker run -e ...`
// does nothing, and promoting one tested image from UAT to production is
// impossible — production needs its own build, which is a different artifact
// from the one that was tested.
//
// So the container writes `/config.js` at start-up from its real environment,
// and it loads before the app bundle (see index.html). One image, every
// environment.
//
// PRECEDENCE, highest first:
//   1. window.__ENV__   — injected by the container at start-up
//   2. import.meta.env  — a .env file at build time (how `npm run dev` works)
//   3. the defaults below

declare global {
  interface Window {
    __ENV__?: Record<string, string | undefined>
  }
}

const injected: Record<string, string | undefined> =
  (typeof window !== 'undefined' && window.__ENV__) || {}

/**
 * A blank value counts as absent, deliberately.
 *
 * The container writes every key whether or not it was given one, so an
 * environment that sets only KC_URL still produces `API_BASE: ""`. Treating
 * that as a real answer would blank out the build-time default and point the
 * API client at the page itself.
 */
function pick(key: string, buildTime: string | undefined, fallback: string): string {
  const value = injected[key]
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof buildTime === 'string' && buildTime.trim() !== '') return buildTime.trim()
  return fallback
}

// Hoisted out of the object because usersBase below defaults onto it.
const apiBase = pick('API_BASE', import.meta.env.VITE_API_BASE as string | undefined, '/app/v1')

export const RUNTIME_CONFIG = Object.freeze({
  appName: pick('APP_NAME', import.meta.env.VITE_APP_NAME as string | undefined, 'App Portal'),
  kcUrl: pick('KC_URL', import.meta.env.VITE_KC_URL as string | undefined, 'http://localhost:8085'),
  kcRealm: pick('KC_REALM', import.meta.env.VITE_KC_REALM as string | undefined, 'app-realm'),
  apiBase,

  // WHERE THE BROWSER SENDS PROVISIONING CALLS — the backend's /kcadmin
  // pass-through, on the same API base as everything else. The pass-through
  // substitutes nothing: Keycloak authorises every operation against the
  // signed-in administrator's own realm-management roles.
  usersBase: pick(
    'USERS_BASE',
    import.meta.env.VITE_USERS_BASE as string | undefined,
    `${apiBase}/kcadmin`,
  ),

  // The second factor gate between a correct password and the app. The string
  // is compared rather than coerced, so a typo reads as "on" instead of
  // silently disabling a security control.
  mfaEnabled:
    pick('MFA_ENABLED', import.meta.env.VITE_MFA_ENABLED as string | undefined, 'true') !== 'false',

  // WHERE THE USER'S PHONE GOES for enrolment links — not where the app sends
  // its API calls (those are relative, proxied, same-origin). Must be
  // reachable FROM THE PHONE: `localhost` is the phone itself. Empty means
  // "this origin", which is the deployed shape.
  mfaBase: pick('MFA_BASE', import.meta.env.VITE_MFA_BASE as string | undefined, ''),
})

/**
 * Where the configuration for each key actually came from. Useful in a debug
 * panel, because "the container is serving the wrong realm" and "nobody set
 * KC_REALM so it fell back to the default" look identical from the outside.
 */
export const configSource = (key: string): 'runtime' | 'build' =>
  typeof injected[key] === 'string' && injected[key]!.trim() !== '' ? 'runtime' : 'build'
