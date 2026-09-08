// The route tree. Gate nesting is COARSEST-FIRST and the order is load-bearing:
//
//   RequireSession   signed in?           (redirects to the front door)
//     RequireMfa     second factor done?  (redirects to the front door)
//       PortalLayout the shell
//         portalRoutes() -> RequirePermission per leaf (renders Forbidden in place)
//
// Public routes sit outside all of it.
import { Route, Routes } from 'react-router-dom'
import { RequireSession } from '@/auth/guards/RequireSession'
import { RequireMfa } from '@/auth/guards/RequireMfa'
import PortalLayout from '@/layouts/PortalLayout'
import { fallbackRoutes, portalRoutes, publicRoutes } from './deriveRoutes'

export function AppRoutes() {
  return (
    <Routes>
      {publicRoutes()}
      <Route
        element={
          <RequireSession>
            <RequireMfa>
              <PortalLayout />
            </RequireMfa>
          </RequireSession>
        }
      >
        {portalRoutes()}
      </Route>
      {fallbackRoutes()}
    </Routes>
  )
}
