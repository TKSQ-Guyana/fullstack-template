// Renders what deriveNav hands it — the sidebar performs NO authorization
// itself; whether a row may show was already answered by can().
import { NavLink } from 'react-router-dom'
import { useSession } from '@/auth/SessionProvider'
import { useAuthz } from '@/authz/AuthProvider'
import { navForRole } from '@/routes/deriveNav'
import { RUNTIME_CONFIG } from '@/config/runtime'
import { cn } from '@/utils/cn'

export function Sidebar() {
  const { activeRole } = useSession()
  const authz = useAuthz()
  const items = navForRole(activeRole, authz)

  return (
    <aside className="z-20 flex w-56 shrink-0 flex-col border-r border-rule bg-surface">
      <div className="border-b border-rule px-5 py-4">
        <div className="text-xs font-semibold tracking-[0.14em] text-brand-700 uppercase">
          {RUNTIME_CONFIG.appName}
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) =>
          item.to ? (
            <NavLink
              key={item.id}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'block rounded-lg px-3 py-2 text-sm font-medium',
                  isActive ? 'bg-brand-50 text-brand-800' : 'text-ink-700 hover:bg-canvas',
                )
              }
            >
              {item.label}
            </NavLink>
          ) : (
            // A manifest entry with no path yet: an inert row, so the IA can
            // be reviewed before the screen exists.
            <span
              key={item.id}
              className="block cursor-default rounded-lg px-3 py-2 text-sm text-ink-300"
            >
              {item.label}
            </span>
          ),
        )}
      </nav>
    </aside>
  )
}
