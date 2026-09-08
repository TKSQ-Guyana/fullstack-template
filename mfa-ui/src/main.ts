// The phone's two pages, decided by the path the backend served this SPA on:
//
//   …/mfa/enroll?username=…   register a passkey for that account
//   …/mfa/verify?token=…      approve a pending desktop sign-in
//
// The ceremony calls go to VITE_API_URL (baked at build; defaults to the
// page's own /mfa prefix) — the same door the page itself was served from.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? apiFromLocation()

function apiFromLocation(): string {
  // …/app/v1/mfa/verify -> …/app/v1/mfa
  return window.location.pathname.replace(/\/(enroll|verify)\/?$/, '')
}

const el = {
  title: document.getElementById('title') as HTMLHeadingElement,
  copy: document.getElementById('copy') as HTMLParagraphElement,
  action: document.getElementById('action') as HTMLButtonElement,
  status: document.getElementById('status') as HTMLParagraphElement,
}

function say(status: string, tone: 'ok' | 'err' | '' = ''): void {
  el.status.textContent = status
  el.status.className = `status ${tone}`.trim()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`)
  return json
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`)
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`)
  return json
}

// --- /enroll -----------------------------------------------------------------

function enrollPage(): void {
  const username = new URLSearchParams(window.location.search).get('username') ?? ''
  el.title.textContent = 'Register this phone'
  el.copy.textContent = username
    ? `A passkey will be created on this phone for ${username}. You will confirm with your fingerprint or face unlock.`
    : 'Missing account. Open the link exactly as it was sent to you.'
  if (!username) return

  el.action.textContent = 'Create passkey'
  el.action.hidden = false
  el.action.onclick = async () => {
    el.action.disabled = true
    say('Waiting for your fingerprint or face unlock…')
    try {
      const options = await post<Parameters<typeof startRegistration>[0]>(
        '/webauthn/register/options',
        { username },
      )
      const attestationResponse = await startRegistration(options)
      await post('/webauthn/register/verify', { username, attestationResponse })
      el.action.hidden = true
      say('Passkey registered. You can close this page and sign in on your computer.', 'ok')
    } catch (err) {
      el.action.disabled = false
      say((err as Error).message, 'err')
    }
  }
}

// --- /verify -----------------------------------------------------------------

function verifyPage(): void {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  el.title.textContent = 'Approve sign-in'
  el.copy.textContent = token
    ? 'Someone is signing in to your account on a computer. Approve it with the passkey on this phone.'
    : 'Missing or incomplete link. Open it exactly as it was sent to you.'
  if (!token) return

  el.action.textContent = 'Approve with passkey'
  el.action.hidden = false
  el.action.onclick = async () => {
    el.action.disabled = true
    say('Waiting for your fingerprint or face unlock…')
    try {
      const options = await get<Parameters<typeof startAuthentication>[0]>(
        `/webauthn/authenticate/options?token=${encodeURIComponent(token)}`,
      )
      const assertionResponse = await startAuthentication(options)
      await post('/webauthn/authenticate/verify', { token, assertionResponse })
      el.action.hidden = true
      say('Approved. Your computer will continue by itself.', 'ok')
    } catch (err) {
      el.action.disabled = false
      say((err as Error).message, 'err')
    }
  }
}

if (window.location.pathname.endsWith('/enroll')) enrollPage()
else if (window.location.pathname.endsWith('/verify')) verifyPage()
else {
  el.title.textContent = 'Nothing here'
  el.copy.textContent = 'Open the enrolment or approval link exactly as it was sent to you.'
}
