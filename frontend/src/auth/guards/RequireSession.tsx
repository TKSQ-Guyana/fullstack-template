// Coarsest gate first: is anyone signed in?
//
// Holds (renders null) while the session is being restored so a reload never
// flashes the sign-in form; then either passes or redirects to the sign-in
// page, remembering where the person was headed.
import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useSession } from '@/auth/SessionProvider'
import { PATHS } from '@/routes/paths'

export function RequireSession({ children }: { children: ReactNode }) {
  const { authenticated, restoring } = useSession()
  const location = useLocation()

  if (restoring) return null
  if (!authenticated) {
    return <Navigate to={PATHS.signIn} replace state={{ from: location }} />
  }
  return <>{children}</>
}
