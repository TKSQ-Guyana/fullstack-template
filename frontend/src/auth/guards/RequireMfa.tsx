// Second gate: has this tab satisfied the second factor?
//
// Sits between RequireSession and the portal so a deep link with a live
// cookie but no approval still meets the challenge. The challenge itself is
// part of the sign-in page (which sees an authenticated-but-unapproved
// session and shows the approval step), so the redirect is simply "back to
// the front door".
import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useSession } from '@/auth/SessionProvider'
import { mfaEnabled, mfaSatisfied } from '@/auth/mfa'
import { PATHS } from '@/routes/paths'

export function RequireMfa({ children }: { children: ReactNode }) {
  const { username } = useSession()
  if (mfaEnabled() && !mfaSatisfied(username)) {
    return <Navigate to={PATHS.signIn} replace />
  }
  return <>{children}</>
}
