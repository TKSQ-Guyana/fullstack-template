// Role-based authorization. Only VERIFIED principals are enforced against the
// matrix — a query-param identity (dev modes) is trusted for scoping but not
// worth "authorizing", and refusing it would break tooling that runs without
// a realm.
import type { NextFunction, Request, Response } from 'express'
import { forbidden } from '../http/problem.js'
import { OPERATION_ROLES, personaMay, type Operation } from '../auth/permissions.js'
import type { Persona } from '../auth/claims.js'
import { principalOf } from './auth.js'

export function requireOperation(op: Operation) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const principal = principalOf(req)
    if (!principal.verified) return next()
    if (!principal.personas.length) {
      return next(forbidden('This account has no application role provisioned.'))
    }
    if (!personaMay(principal.personas, OPERATION_ROLES[op])) {
      return next(forbidden(`Your role may not perform ${op}.`))
    }
    return next()
  }
}

/** Per-action check used inside handlers when one endpoint fans out over
 *  several actions with different allowed roles. */
export function assertActionAllowed(
  req: Request,
  action: string,
  matrix: Readonly<Record<string, Persona[]>>,
): void {
  const principal = principalOf(req)
  if (!principal.verified) return
  const allowed = matrix[action]
  // An unknown action falls through to the DB layer; do not invent an
  // authorization for it here.
  if (!allowed) return
  if (!personaMay(principal.personas, allowed)) {
    throw forbidden(`Your role may not perform ${action}.`)
  }
}
