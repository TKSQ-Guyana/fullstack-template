// Provider composition. ORDER IS LOAD-BEARING:
//   BrowserRouter    — everything below may read the location
//   SessionProvider  — authentication (the Principal is built from claims)
//   AuthProvider     — authorization, which consumes the session above it
// No loading gate here: sign-in is a form, not a redirect, so first paint
// never waits on Keycloak.
import { BrowserRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { SessionProvider } from '@/auth/SessionProvider'
import { AuthProvider } from '@/authz/AuthProvider'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <BrowserRouter>
      <SessionProvider>
        <AuthProvider>{children}</AuthProvider>
      </SessionProvider>
    </BrowserRouter>
  )
}
