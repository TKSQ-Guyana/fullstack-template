// The one place errors become HTTP. Everything is answered as RFC-7807
// problem+json; Postgres errors are translated to the statuses the contract
// promises instead of leaking as 500s with constraint names in them.
import type { NextFunction, Request, Response } from 'express'
import { ProblemError } from '../http/problem.js'
import { logger } from '../logger.js'

export interface PgError extends Error {
  code?: string
  detail?: string
  constraint?: string
}

export function fromPgError(err: PgError): ProblemError | null {
  switch (err.code) {
    case '23505': // unique_violation — duplicate row / idempotency-key replay
      return new ProblemError(409, `Duplicate record: ${err.detail ?? err.message}`)
    case '23503': // foreign_key_violation — a referenced record does not exist
      return new ProblemError(
        422,
        `A referenced record does not exist: ${err.detail ?? err.message}`,
      )
    case '23514': // check_violation — schema-level business rule
      return new ProblemError(422, `A business rule was violated: ${err.constraint ?? err.message}`)
    case '23502': // not_null_violation
      return new ProblemError(422, `A required field is missing: ${err.message}`)
    case '22023': // invalid_parameter_value — e.g. unknown reference resource
      return new ProblemError(400, err.message)
    case '22P02': // invalid_text_representation — bad enum/uuid/number in the body
      return new ProblemError(400, `A field has an invalid value: ${err.message}`)
    case 'P0001': // raise_exception — business rules raised inside api_* functions
      return new ProblemError(422, err.message)
    default:
      return null
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res
    .status(404)
    .type('application/problem+json')
    .json({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: `No endpoint at ${req.method} ${req.path}.`,
    })
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const problem = err instanceof ProblemError ? err : (fromPgError(err as PgError) ?? internal(err))

  if (problem.status >= 500) {
    logger.error({ err, path: req.path }, 'unhandled error')
  }

  res.status(problem.status).type('application/problem+json').json(problem.toBody())
}

function internal(err: unknown): ProblemError {
  const message = err instanceof Error ? err.message : String(err)
  return new ProblemError(500, `Unexpected error: ${message}`)
}
