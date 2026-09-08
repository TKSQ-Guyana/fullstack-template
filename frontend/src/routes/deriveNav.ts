// Manifest -> the sidebar model. Two separate questions, deliberately:
//   WHERE a row belongs  — information architecture, per role, in the manifest
//   WHETHER it may show  — authorization, answered by can(entry.permission)
// The sidebar renders what this hands it and performs no authorization itself.
import type { RoleId } from '@/auth/claims'
import type { Authz } from '@/authz/engine'
import { GUARDED_AREAS, MANIFEST } from './manifest'

export interface NavItem {
  id: string
  label: string
  to: string | null
  order: number
}

export function navForRole(role: RoleId | null, authz: Authz): NavItem[] {
  if (!role) return []
  return MANIFEST.flatMap((entry) => {
    const row = entry.nav?.find((n) => n.role === role)
    if (!row) return []
    if (GUARDED_AREAS.has(entry.area) && !authz.can(entry.permission ?? null)) return []
    return [{ id: entry.id, label: row.label, to: entry.path, order: row.order }]
  }).sort((a, b) => a.order - b.order)
}
