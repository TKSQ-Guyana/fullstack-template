// The set-password page — /set-password?token=…, the recipient's half of the
// invitation. PUBLIC by design: the single-use token is the credential, and
// the backend has one uniform 410 for spent/stale/unknown.
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { RUNTIME_CONFIG } from '@/config/runtime'
import AuthLayout from '@/layouts/AuthLayout'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PATHS } from '@/routes/paths'

const SETUP = `${RUNTIME_CONFIG.apiBase}/password-setup`

type State =
  | { phase: 'checking' }
  | { phase: 'gone'; detail: string }
  | { phase: 'form'; username: string }
  | { phase: 'done'; username: string }

export default function SetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [state, setState] = useState<State>({ phase: 'checking' })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!token) {
        setState({ phase: 'gone', detail: 'The link is incomplete — open it exactly as sent.' })
        return
      }
      try {
        const res = await fetch(`${SETUP}/${encodeURIComponent(token)}`, { cache: 'no-store' })
        const body = (await res.json().catch(() => ({}))) as {
          valid?: boolean
          username?: string
          detail?: string
        }
        if (!alive) return
        if (res.ok && body.valid && body.username) {
          setState({ phase: 'form', username: body.username })
        } else {
          setState({ phase: 'gone', detail: body.detail ?? 'This link is no longer valid.' })
        }
      } catch {
        if (alive) setState({ phase: 'gone', detail: 'Could not reach the app service.' })
      }
    })()
    return () => {
      alive = false
    }
  }, [token])

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (state.phase !== 'form') return
    if (password !== confirm) {
      setError('The two entries do not match.')
      return
    }
    setError('')
    setBusy(true)
    try {
      const res = await fetch(`${SETUP}/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        username?: string
        detail?: string
      }
      if (res.ok && body.ok && body.username) {
        setState({ phase: 'done', username: body.username })
      } else {
        setError(body.detail ?? 'The password could not be set.')
      }
    } catch {
      setError('Could not reach the app service. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      {state.phase === 'checking' && <p className="text-sm text-ink-400">Checking the link…</p>}

      {state.phase === 'gone' && (
        <div className="space-y-3">
          <h1 className="text-lg font-semibold tracking-tight">Link not valid</h1>
          <p className="text-sm text-ink-500">{state.detail}</p>
        </div>
      )}

      {state.phase === 'form' && (
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Choose your password</h1>
            <p className="mt-1 text-sm text-ink-500">
              For the account <span className="font-semibold text-ink-900">{state.username}</span>.
              At least 10 characters.
            </p>
          </div>
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Input
            label="Repeat it"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Setting…' : 'Set password'}
          </Button>
        </form>
      )}

      {state.phase === 'done' && (
        <div className="space-y-3">
          <h1 className="text-lg font-semibold tracking-tight">Password set</h1>
          <p className="text-sm text-ink-500">
            Sign in as <span className="font-semibold text-ink-900">{state.username}</span> with
            your new password.
          </p>
          <Link to={PATHS.signIn} className="text-sm font-semibold text-brand-700">
            Go to sign-in
          </Link>
        </div>
      )}
    </AuthLayout>
  )
}
