// Query-param readers. Express parses ?a=1&a=2 into arrays; csv values are
// also accepted — both are handled.

export function qstr(v: unknown): string | undefined {
  if (typeof v === 'string' && v !== '') return v
  if (Array.isArray(v)) return qstr(v[v.length - 1])
  return undefined
}

export function qint(v: unknown): number | undefined {
  const s = qstr(v)
  if (s === undefined) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? Math.trunc(n) : undefined
}

export function qbool(v: unknown): boolean | undefined {
  const s = qstr(v)
  if (s === undefined) return undefined
  return s.toLowerCase() === 'true'
}

/** Repeatable-or-csv parameter -> string[] (undefined when absent). */
export function qlist(v: unknown): string[] | undefined {
  const parts: string[] = []
  const push = (s: string) => {
    for (const p of s.split(',')) if (p.trim()) parts.push(p.trim())
  }
  if (typeof v === 'string') push(v)
  else if (Array.isArray(v)) for (const item of v) if (typeof item === 'string') push(item)
  return parts.length ? parts : undefined
}
