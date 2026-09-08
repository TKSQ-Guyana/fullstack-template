// GET /me — who am I, and what may I do. The frontend drives its show/hide
// from the permissions map so the UI never hardcodes role names.
import { Router } from 'express'
import { principalOf } from '../middleware/auth.js'
import { permissionsFor } from '../auth/permissions.js'

export const meRouter = Router()

meRouter.get('/me', (req, res) => {
  const p = principalOf(req)
  res.json({
    subject: p.subject,
    username: p.username,
    email: p.email,
    displayName: p.displayName,
    role: p.role,
    personas: p.personas,
    tenantId: p.tenantId,
    tenantName: p.tenantName,
    verified: p.verified,
    permissions: permissionsFor(p.personas),
  })
})
