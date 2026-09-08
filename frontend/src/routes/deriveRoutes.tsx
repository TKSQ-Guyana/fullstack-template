// Manifest -> <Route> elements. Guarded areas are wrapped in RequirePermission
// INSIDE the derivation, which makes "no route bypasses authorization" a
// property of the system rather than a convention per page.
//
// ONE <Suspense> PER LEAF (inside the permission gate) so navigation swaps
// the content pane and never blanks the shell around it.
import { Suspense } from 'react'
import { Route } from 'react-router-dom'
import { GUARDED_AREAS, MANIFEST, type ManifestEntry } from './manifest'
import { RequirePermission } from './RequirePermission'
import { RouteFallback } from './RouteFallback'

function leaf(entry: ManifestEntry) {
  const Page = entry.page
  const content = (
    <Suspense fallback={<RouteFallback />}>
      <Page />
    </Suspense>
  )
  if (!GUARDED_AREAS.has(entry.area)) return content
  return <RequirePermission permission={entry.permission ?? null}>{content}</RequirePermission>
}

const routesFor = (predicate: (e: ManifestEntry) => boolean) =>
  MANIFEST.filter((e) => e.path && predicate(e)).map((e) => (
    <Route key={e.id} path={e.path!} element={leaf(e)} />
  ))

export const publicRoutes = () => routesFor((e) => e.area === 'public')
export const portalRoutes = () => routesFor((e) => e.area === 'portal')
export const fallbackRoutes = () => routesFor((e) => e.area === 'fallback')
