// Domain errors — a rule said no.
//
// A refusal's sentence is CONTRACT: the frontend shows it verbatim to the
// person who pressed the button, and tests assert it by its status and its
// text. So a rule refuses by throwing one of these, never by returning a
// flag the controller has to translate.
//
// `domain/` imports nothing from the HTTP layer on purpose (eslint
// boundaries); the error handler knows this class and turns it into
// problem+json. The layers below the HTTP one (repositories, services) throw
// these rather than an HTTP problem, so none of them depends on http/.
export type DomainErrorKind = 'invalid' | 'refused' | 'conflict' | 'forbidden' | 'not_found'

const STATUS: Record<DomainErrorKind, number> = {
  invalid: 400, // the call names something the contract does not have
  refused: 422, // a rule refused the action
  conflict: 409, // the action was already taken / a replay
  forbidden: 403, // this persona may not act here
  not_found: 404, // the aggregate does not exist for this caller
}

export class DomainError extends Error {
  readonly kind: DomainErrorKind
  readonly status: number

  constructor(kind: DomainErrorKind, message: string) {
    super(message)
    this.name = 'DomainError'
    this.kind = kind
    this.status = STATUS[kind]
  }
}

/** The call names something the contract does not have — 400, message verbatim. */
export const invalid = (message: string) => new DomainError('invalid', message)
/** A rule refused the action — 422, message shown to the person verbatim. */
export const refused = (message: string) => new DomainError('refused', message)
/** The action conflicts with the aggregate's current state — 409. */
export const conflict = (message: string) => new DomainError('conflict', message)
/** This persona may not do this here — 403. */
export const forbidden = (message: string) => new DomainError('forbidden', message)
/** The aggregate does not exist, or not for this caller — 404. */
export const notFound = (message: string) => new DomainError('not_found', message)

/** Throw `refused(message)` unless the condition holds — the guard idiom. */
export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw refused(message)
}
