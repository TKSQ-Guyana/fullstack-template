// The per-route permission gate, applied by deriveRoutes to every guarded
// entry. DENIES BY RENDERING IN PLACE, never redirecting — the URL and the
// sidebar stay intact, so the person can see where they are and why the
// content is refused.
import type { ReactNode } from 'react'
import { useAuthz } from '@/authz/AuthProvider'
import type { Permission } from '@/authz/permissions'
import ForbiddenPage from '@/pages/ForbiddenPage'

export function RequirePermission({
  permission,
  children,
}: {
  /** `null` = any signed-in principal (an audited manifest decision). */
  permission: Permission | null
  children: ReactNode
}) {
  const { can } = useAuthz()
  if (!can(permission)) return <ForbiddenPage />
  return <>{children}</>
}
