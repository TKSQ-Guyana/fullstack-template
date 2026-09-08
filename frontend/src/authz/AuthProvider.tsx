// Authorization context: builds the Authz engine from the session via the
// injected adapter. Sits BELOW SessionProvider (authn before authz — the
// Principal is built from claims).
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useSession, type SessionContextValue } from '@/auth/SessionProvider'
import { createAuthz, type Authz, type Principal } from './engine'
import { principalFromSession } from './adapters/sessionAdapter'
import { validatePolicy } from './policy'

if (import.meta.env.DEV) {
  // Loud in development, absent from production bundles.
  for (const problem of validatePolicy()) console.error(`[authz] ${problem}`)
}

const AuthzContext = createContext<Authz | null>(null)

export function AuthProvider({
  children,
  adapter = principalFromSession,
}: {
  children: ReactNode
  adapter?: (session: SessionContextValue) => Principal
}) {
  const session = useSession()
  const authz = useMemo(() => createAuthz(adapter(session)), [adapter, session])
  return <AuthzContext.Provider value={authz}>{children}</AuthzContext.Provider>
}

export function useAuthz(): Authz {
  const ctx = useContext(AuthzContext)
  if (!ctx) throw new Error('useAuthz must be used inside <AuthProvider>')
  return ctx
}
