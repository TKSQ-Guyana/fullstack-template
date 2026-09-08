// Declarative permission gate. HIDES by default — a control someone may not
// use should not exist for them; `fallback` covers the places where absence
// needs explaining. A "disable" mode is deliberately not offered: a disabled
// button invites the question a hidden one never raises.
import type { ReactNode } from 'react'
import { useAuthz } from './AuthProvider'
import type { Permission } from './permissions'

export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission
  children: ReactNode
  fallback?: ReactNode
}) {
  const { can } = useAuthz()
  return <>{can(permission) ? children : fallback}</>
}

/** The inverse, for explanatory copy ("ask a manager to add one"). */
export function Cannot({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuthz()
  return <>{can(permission) ? null : children}</>
}
