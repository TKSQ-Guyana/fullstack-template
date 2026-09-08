// The Role & Access Matrix, in code. One table per decision point; the RBAC
// middleware and GET /me both read from here so the API and the UI agree.
//
// ═══ REPLACE WITH YOUR OPERATIONS ═══ alongside auth/claims.ts. The shape to
// keep: frozen objects mapping operation -> allowed personas, a
// requireOperation() gate per route, and permissionsFor() feeding GET /me so
// the frontend never hardcodes who may do what.
import type { Persona } from './claims.js'

const EVERYONE: Persona[] = ['ADMIN', 'MANAGER', 'USER']
const WRITERS: Persona[] = ['ADMIN', 'MANAGER']

export const OPERATION_ROLES = Object.freeze({
  // The notes example: everyone reads, managers and admins write.
  'notes.read': EVERYONE,
  'notes.write': WRITERS,
  'reference.read': EVERYONE,
  'reference.write': ['ADMIN'] as Persona[],
})

export type Operation = keyof typeof OPERATION_ROLES

export function personaMay(personas: Persona[], allowed: Persona[]): boolean {
  return personas.some((p) => allowed.includes(p))
}

/** Effective permission map for GET /me — drives UI show/hide without hardcoding. */
export function permissionsFor(personas: Persona[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const [op, allowed] of Object.entries(OPERATION_ROLES)) {
    out[op] = personaMay(personas, allowed)
  }
  return out
}
