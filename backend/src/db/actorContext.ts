// Who is acting, for the audit columns — carried on AsyncLocalStorage so the
// identity set once per request (or per job run) reaches every query that
// request makes, without threading an actor argument through every service
// signature.
//
// The value is the Keycloak USERNAME from the verified token
// (preferred_username): the audit columns are read by people, and the
// username is the identity people recognise. The token subject is the
// fallback for a token without one, and jobs run as 'system'.
//
// withTransaction (db/transaction.ts) publishes it to SQL as the
// per-transaction setting `app.actor`, which the audit-stamp trigger
// (app.fn_stamp_audit_fields, migration 0001) reads for created_by /
// updated_by — so a value set here reaches every row a use-case writes.
import { AsyncLocalStorage } from 'node:async_hooks'
import type { NextFunction, Request, Response } from 'express'
import type { Principal } from '../auth/claims.js'

const store = new AsyncLocalStorage<string>()

/** The acting identity for the current request/job, or null outside both. */
export const currentActor = (): string | null => store.getStore() ?? null

/** Run `work` (a job, a script) as a named actor — jobs pass 'system'. */
export const runAsActor = <T>(actor: string, work: () => T): T => store.run(actor, work)

/**
 * Express middleware: everything downstream of `authenticate` acts as the
 * signed-in principal. Mounted after it, so `req.principal` is resolved.
 */
export function actorContext(req: Request, _res: Response, next: NextFunction): void {
  const p: Principal | undefined = req.principal
  const actor = p?.username || p?.subject || null
  if (!actor) return next()
  store.run(actor, next)
}
