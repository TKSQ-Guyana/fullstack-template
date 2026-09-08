// The front door: credentials, then (when MFA is on) the phone-approval step.
//
// The page also handles the redirect-back contract: RequireSession remembers
// where an unauthenticated visitor was headed (location.state.from), and a
// successful sign-in returns them there — or to their role's home.
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '@/auth/SessionProvider'
import { AuthError, getClaims } from '@/auth/keycloak'
import { identityFrom } from '@/auth/claims'
import * as mfa from '@/auth/mfa'
import AuthLayout from '@/layouts/AuthLayout'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { resolveHome } from '@/routes/manifest'

type Step = 'credentials' | 'approval'

export default function SignInPage() {
  const session = useSession()
  const location = useLocation()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('credentials')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [challenge, setChallenge] = useState<mfa.Challenge | null>(null)

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname

  // COMPUTED FROM THE LIVE SNAPSHOT, not from this render's session: onSubmit
  // runs after signIn resolves, and a destination captured at render time
  // would still see the signed-out activeRole (null -> /no-access — the bug
  // the first cold-start verification caught).
  const destination = () => from ?? resolveHome(identityFrom(getClaims()).activeRole)

  // Already fully signed in (session + factor) — nothing to do here.
  if (!session.restoring && session.authenticated && mfa.mfaSatisfied(session.username)) {
    return <Navigate to={destination()} replace />
  }

  async function runChallenge(user: string): Promise<void> {
    const c = await mfa.requestChallenge(user)
    setChallenge(c)
    setStep('approval')
    await mfa.waitForApproval(c.token)
    await mfa.complete(c.token)
    navigate(destination(), { replace: true })
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await session.signIn({ username: username.trim(), password })
      if (mfa.mfaEnabled()) {
        await runChallenge(username.trim())
      } else {
        navigate(destination(), { replace: true })
      }
    } catch (err) {
      setStep('credentials')
      if (err instanceof mfa.MfaError && err.notEnrolled) {
        setError(
          'No passkey is enrolled for this account yet. Open the enrolment link on your phone first.',
        )
      } else {
        setError(err instanceof AuthError || err instanceof Error ? err.message : 'Sign-in failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      {step === 'credentials' ? (
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-ink-500">Use the account your administrator set up.</p>
          </div>
          <Input
            label="Username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Approve on your phone</h1>
            <p className="mt-1 text-sm text-ink-500">
              {challenge?.sms.sent
                ? `We texted an approval link to ${challenge.sms.to}. Open it and confirm with your passkey.`
                : 'Open the link below on the phone that holds your passkey and confirm.'}
            </p>
          </div>
          {!challenge?.sms.sent && challenge?.verifyUrl && (
            <p className="rounded-lg bg-canvas p-3 text-xs break-all">{challenge.verifyUrl}</p>
          )}
          <p className="text-xs text-ink-400">
            Waiting for approval… the link works once and expires in 3 minutes.
          </p>
        </div>
      )}
    </AuthLayout>
  )
}
