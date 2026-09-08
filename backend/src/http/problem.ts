// RFC-7807 problem+json — the error shape the contract promises and the
// frontend's apiClient parses ({type, title, status, detail, violations}).

export interface Violation {
  field: string
  message: string
}

export class ProblemError extends Error {
  readonly status: number
  readonly title: string
  readonly violations: Violation[]

  constructor(
    status: number,
    detail: string,
    { title, violations }: Partial<{ title: string; violations: Violation[] }> = {},
  ) {
    super(detail)
    this.name = 'ProblemError'
    this.status = status
    this.title = title ?? defaultTitle(status)
    this.violations = violations ?? []
  }

  toBody() {
    return {
      type: 'about:blank',
      title: this.title,
      status: this.status,
      detail: this.message,
      ...(this.violations.length ? { violations: this.violations } : {}),
    }
  }
}

function defaultTitle(status: number): string {
  const titles: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Validation failed',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
  }
  return titles[status] ?? 'Error'
}

export const badRequest = (detail: string) => new ProblemError(400, detail)
export const unauthorized = (detail: string) => new ProblemError(401, detail)
export const forbidden = (detail: string) => new ProblemError(403, detail)
export const notFound = (detail: string) => new ProblemError(404, detail)
export const conflict = (detail: string) => new ProblemError(409, detail)
export const unprocessable = (detail: string, violations?: Violation[]) =>
  new ProblemError(422, detail, { violations })
