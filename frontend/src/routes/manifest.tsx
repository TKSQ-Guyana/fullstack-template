// THE ROUTE MANIFEST — one registry from which everything derives: the router
// (deriveRoutes), the sidebar (deriveNav), and the dev-time integrity audit.
// Before a registry like this, a page had to be declared in several places
// (router, sidebar, nav config, home-for-role) and they drifted; now an entry
// is one object and nothing else has an opinion.
//
// Entry contract:
//   id          unique slug
//   path        the URL (null = a nav row whose screen is not built yet)
//   page        React.lazy component (lazy for EVERY page except the ones a
//               guard redirects to — a lazy chunk there would put a round
//               trip between a denial and the screen explaining it)
//   area        'public' | 'portal' | 'fallback' — portal entries are wrapped
//               in the guard stack by derivation, so "no route bypasses
//               authorization" is a property, not a convention
//   permission  REQUIRED on guarded areas. `null` must be WRITTEN OUT and
//               means "any signed-in principal" — an audited decision, not an
//               omission (integrity.ts enforces the key's presence).
//   home        role ids whose post-sign-in landing this is
//   nav         sidebar rows, one per role that sees it: {role, label, order}
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { RoleId } from '@/auth/claims'
import type { Permission } from '@/authz/permissions'
import { PATHS } from './paths'
import NotFoundPage from '@/pages/NotFoundPage'
import NoAccessPage from '@/pages/NoAccessPage'

export type Area = 'public' | 'portal' | 'fallback'

export interface NavRow {
  role: RoleId
  label: string
  order: number
}

export interface ManifestEntry {
  id: string
  path: string | null
  page: LazyExoticComponent<ComponentType> | ComponentType
  area: Area
  permission?: Permission | null
  home?: RoleId[]
  nav?: NavRow[]
}

/** Areas whose entries the derivation wraps in the guard stack. */
export const GUARDED_AREAS: ReadonlySet<Area> = new Set<Area>(['portal'])

export const MANIFEST: ManifestEntry[] = [
  // --- public -----------------------------------------------------------
  {
    id: 'sign-in',
    path: PATHS.signIn,
    // NOT lazy: the landing page is the first paint.
    page: lazy(() => import('@/pages/SignIn/SignInPage')),
    area: 'public',
  },
  {
    id: 'set-password',
    path: PATHS.setPassword,
    page: lazy(() => import('@/pages/SetPasswordPage')),
    area: 'public',
  },

  // --- portal -----------------------------------------------------------
  {
    id: 'home',
    path: PATHS.home,
    page: lazy(() => import('@/pages/HomePage')),
    area: 'portal',
    permission: null, // any signed-in principal — written out, not omitted
    home: ['admin', 'manager', 'user'],
    nav: [
      { role: 'admin', label: 'Home', order: 10 },
      { role: 'manager', label: 'Home', order: 10 },
      { role: 'user', label: 'Home', order: 10 },
    ],
  },
  {
    id: 'notes',
    path: PATHS.notes,
    page: lazy(() => import('@/pages/notes/NotesPage')),
    area: 'portal',
    permission: 'notes:read',
    nav: [
      { role: 'admin', label: 'Notes', order: 20 },
      { role: 'manager', label: 'Notes', order: 20 },
      { role: 'user', label: 'Notes', order: 20 },
    ],
  },

  // --- fallbacks ---------------------------------------------------------
  // NOT lazy: guard-redirect destinations must not cost a round trip.
  {
    id: 'no-access',
    path: PATHS.noAccess,
    page: NoAccessPage,
    area: 'public',
  },
  {
    id: 'not-found',
    path: '*',
    page: NotFoundPage,
    area: 'fallback',
  },
]

// --- helpers -------------------------------------------------------------

export const entriesInArea = (area: Area): ManifestEntry[] =>
  MANIFEST.filter((e) => e.area === area)

/** The post-sign-in landing for a role; every role must have one (audited). */
export function resolveHome(role: RoleId | null): string {
  if (role) {
    const entry = MANIFEST.find((e) => e.home?.includes(role) && e.path)
    if (entry?.path) return entry.path
  }
  return PATHS.noAccess
}
