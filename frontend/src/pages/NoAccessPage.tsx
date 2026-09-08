// The landing for a signed-in account that maps to NO role. Lives in the
// PUBLIC area by construction, so the redirect that brings people here can
// never loop through a guard.
import { useSession } from '@/auth/SessionProvider'
import { Button } from '@/components/ui/Button'

export default function NoAccessPage() {
  const { authenticated, signOut } = useSession()
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md rounded-2xl border border-rule bg-surface p-8 text-center shadow-card">
        <p className="text-sm font-semibold text-ink-900">This account has no role yet</p>
        <p className="mt-2 text-sm text-ink-500">
          You signed in, but no application role is provisioned for this account. Ask an
          administrator to assign one, then sign in again.
        </p>
        {authenticated && (
          <Button variant="secondary" className="mt-5" onClick={() => void signOut()}>
            Sign out
          </Button>
        )}
      </div>
    </div>
  )
}
