// Value helpers for the presenters — the "View" of the JSON contract.
//
// The contract's value forms are jsonb's: dates as `YYYY-MM-DD`, timestamps
// as `2026-09-23T07:08:50.936571+00:00`, numerics as numbers. The pool's type
// parsers (db/pool.ts) already hand dates and timestamps over as strings in
// exactly those forms, so a presenter mostly passes values through; these
// helpers cover the conversions that remain (numeric text → number, and the
// occasional Date a caller still holds).
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** NUMERIC / BIGINT arrive as text from the driver; the contract carries numbers. */
export function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return typeof value === 'number' ? value : Number(value)
}

/** A timestamp as jsonb prints it (db/pool.ts parses TIMESTAMPTZ to this form). */
export function ts(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return jsonbTimestamp(value.toISOString())
  return value
}

/** A DATE as `YYYY-MM-DD` (db/pool.ts parses DATE to text). */
export function date(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value.slice(0, 10)
}

/**
 * Postgres text → jsonb form for a timestamp with time zone:
 *   '2026-09-23 07:08:50.936571+00' → '2026-09-23T07:08:50.936571+00:00'
 *   '2026-09-23 07:08:50+00'        → '2026-09-23T07:08:50+00:00'
 * An ISO string with `Z` becomes `+00:00`, which is how jsonb spells UTC.
 */
export function jsonbTimestamp(text: string): string {
  let s = text.replace(' ', 'T')
  if (s.endsWith('Z')) s = s.slice(0, -1) + '+00:00'
  return s.replace(/([+-]\d{2})$/, '$1:00')
}
