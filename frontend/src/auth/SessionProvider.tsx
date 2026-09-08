// The React face of the session facade (auth/keycloak.ts).
//
// `restoring` starts TRUE: the cookies are HttpOnly, so whether a session
// exists is only knowable by asking the backend — and RequireSession renders
// nothing during that window so a reload never flashes the sign-in form.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import * as kc from './keycloak'
import * as mfa from './mfa'
import { identityFrom, type Identity, type SessionClaims } from './claims'

export interface SessionContextValue extends Identity {
  authenticated: boolean
  restoring: boolean
  claims: SessionClaims | null
  expiresAt: number
  signIn: (credentials: { username: string; password: string }) => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(kc.subscribe, kc.getSnapshot)
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    // Transparent background renewal: the expiry clock fires ~5s early and
    // the refresh is server-side. A failure is swallowed — the next API call's
    // 401 handling decides what it means.
    kc.setOnTokenExpired(() => void kc.updateToken(60).catch(() => undefined))
    void kc.restoreSession().finally(() => setRestoring(false))
    return () => kc.setOnTokenExpired(null)
  }, [])

  const value = useMemo<SessionContextValue>(() => {
    const identity = identityFrom(snapshot.claims)
    return {
      ...identity,
      authenticated: snapshot.authenticated,
      restoring,
      claims: snapshot.claims,
      expiresAt: snapshot.expiresAt,
      signIn: async (credentials) => {
        await kc.login(credentials)
      },
      signOut: async () => {
        mfa.reset()
        await kc.logout()
        // A FULL page load, so every in-memory draft is discarded with the
        // session; `replace` so Back cannot strand the next user on a stale
        // address.
        window.location.replace('/')
      },
    }
  }, [snapshot, restoring])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}
