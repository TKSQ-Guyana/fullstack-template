// Dev-only manifest audit — REPORTS, NEVER THROWS. A malformed entry should
// be loud in development and invisible in production. Imported dynamically
// from main.tsx behind import.meta.env.DEV, so none of this ships.
import { isPermission } from '@/authz/permissions'
import { GUARDED_AREAS, MANIFEST } from './manifest'

export function auditManifest(): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  const paths = new Set<string>()

  for (const entry of MANIFEST) {
    if (ids.has(entry.id)) problems.push(`duplicate id "${entry.id}"`)
    ids.add(entry.id)

    if (entry.path) {
      if (paths.has(entry.path)) problems.push(`duplicate path "${entry.path}" (${entry.id})`)
      paths.add(entry.path)
    }

    if (GUARDED_AREAS.has(entry.area) && !('permission' in entry)) {
      problems.push(
        `${entry.id}: guarded entries must WRITE OUT their permission (null = any signed-in principal)`,
      )
    }
    if (entry.permission != null && !isPermission(entry.permission)) {
      problems.push(`${entry.id}: unknown permission "${entry.permission}"`)
    }
    if (!entry.path && !entry.nav?.length) {
      problems.push(`${entry.id}: no path and no nav row — the entry is unreachable`)
    }
  }
  return problems
}

export function reportManifestIntegrity(): void {
  for (const problem of auditManifest()) console.error(`[routes] ${problem}`)
}
