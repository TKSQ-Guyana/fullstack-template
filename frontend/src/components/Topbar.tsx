import { LogOut } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { Badge } from '@/components/ui/Badge'

export function Topbar() {
  const { displayName, activeRole, signOut } = useSession()
  return (
    <header className="flex items-center justify-between border-b border-rule bg-surface px-6 py-3">
      <div className="text-sm text-ink-500">
        Signed in as <span className="font-medium text-ink-900">{displayName}</span>{' '}
        {activeRole && <Badge tone="info">{activeRole}</Badge>}
      </div>
      <button
        type="button"
        onClick={() => void signOut()}
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900"
      >
        <LogOut size={15} /> Sign out
      </button>
    </header>
  )
}
