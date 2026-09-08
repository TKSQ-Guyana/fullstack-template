// GET /me — the backend's own verdict on who the caller is and what they may
// do. The frontend's authz engine answers the same questions locally; this is
// the runtime cross-check when the two must be compared.
import { apiClient } from '../apiClient'
import { PATHS } from './paths'

export interface Me {
  subject: string
  username: string
  email: string
  displayName: string
  role: 'ADMIN' | 'MANAGER' | 'USER'
  personas: ('ADMIN' | 'MANAGER' | 'USER')[]
  tenantId: string | null
  tenantName: string | null
  verified: boolean
  permissions: Record<string, boolean>
}

export const fetchMe = () => apiClient.get<Me>(PATHS.me)
