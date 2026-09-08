// The identity adapter: session claims -> Principal. AuthProvider injects
// this; a different identity source (a dev store, a test double) is a
// different adapter and nothing downstream changes.
import type { SessionContextValue } from '@/auth/SessionProvider'
import { ANONYMOUS, type Principal } from '../engine'

export function principalFromSession(session: SessionContextValue): Principal {
  if (!session.authenticated) return ANONYMOUS
  return {
    authenticated: true,
    username: session.username,
    displayName: session.displayName,
    roleIds: session.roleIds,
    tenantId: session.tenantId,
  }
}
