// Dates: FORMAT IS A DISPLAY FACT, NEVER A STORAGE ONE. Storage and the API
// stay ISO; display goes through the two formatters here, so changing the
// locale is one edit. (The reference project hardwired MM-DD-YYYY across 150
// lines; the template keeps the split and leaves the format a dial.)

const DAY: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' }
const STAMP: Intl.DateTimeFormatOptions = { ...DAY, hour: '2-digit', minute: '2-digit' }

/** The display locale. 'en-CA' renders YYYY-MM-DD; switch to taste. */
export const DATE_LOCALE = 'en-CA'

function parseLoose(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string' || !value.trim()) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** A calendar date for display, or an em dash for empty/unparseable. */
export function day(value: unknown): string {
  const d = parseLoose(value)
  return d ? d.toLocaleDateString(DATE_LOCALE, DAY) : '—'
}

/** Date + time for display, or an em dash. */
export function stamp(value: unknown): string {
  const d = parseLoose(value)
  return d ? d.toLocaleString(DATE_LOCALE, STAMP) : '—'
}

/** Comparators that tolerate missing dates: undated sorts LAST either way. */
export const byNewest = (a: unknown, b: unknown): number =>
  (parseLoose(b)?.getTime() ?? -Infinity) - (parseLoose(a)?.getTime() ?? -Infinity)
export const byOldest = (a: unknown, b: unknown): number =>
  (parseLoose(a)?.getTime() ?? Infinity) - (parseLoose(b)?.getTime() ?? Infinity)
