// The landing screen — deliberately thin: it proves the session, shows the
// permissions the backend vouches for (GET /me), and points at the example.
import { Link } from 'react-router-dom'
import { useSession } from '@/auth/SessionProvider'
import { useAuthz } from '@/authz/AuthProvider'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { PATHS } from '@/routes/paths'

export default function HomePage() {
  const { displayName, roleIds } = useSession()
  const { can } = useAuthz()

  return (
    <>
      <PageHeader
        title={`Welcome, ${displayName}`}
        subtitle="This is the template's landing screen — replace it with your product's dashboard."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-rule bg-surface p-5 shadow-card">
          <p className="text-xs font-semibold tracking-wide text-ink-400 uppercase">Your roles</p>
          <div className="mt-2 flex gap-2">
            {roleIds.length ? (
              roleIds.map((r) => (
                <Badge key={r} tone="info">
                  {r}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-ink-400">none</span>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-rule bg-surface p-5 shadow-card">
          <p className="text-xs font-semibold tracking-wide text-ink-400 uppercase">
            The example feature
          </p>
          <p className="mt-2 text-sm text-ink-500">
            <Link to={PATHS.notes} className="font-semibold text-brand-700">
              Notes
            </Link>{' '}
            is wired through every layer — migration, SQL api functions, route, typed client, list
            hook, permission-gated UI.{' '}
            {can('notes:write')
              ? 'Your role can create and edit them.'
              : 'Your role is read-only there.'}
          </p>
        </div>
      </div>
    </>
  )
}
