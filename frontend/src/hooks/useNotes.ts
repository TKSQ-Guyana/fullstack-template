// The LIST-HOOK CONTRACT, demonstrated once — copy this shape for every list
// screen:
//
//   { rows, total, loaded, error, reload }
//
//   * `error` is RETURNED, never thrown and never swallowed: an empty list
//     must stay distinguishable from a failed read — "you have no notes" is
//     the most reassuring possible way to render a broken backend.
//   * `let alive = true` + cleanup on the effect, so a response landing after
//     unmount writes nothing.
//   * IN-FLIGHT DEDUP keyed by the query, so two components asking the same
//     question at the same moment cost one request.
import { useCallback, useEffect, useState } from 'react'
import { fetchNotes, type Note, type NotePage } from '@/services/api/notes'

const inflight = new Map<string, Promise<NotePage | null>>()

function load(q: string): Promise<NotePage | null> {
  let p = inflight.get(q)
  if (!p) {
    p = fetchNotes({ q: q || undefined }).finally(() => inflight.delete(q))
    inflight.set(q, p)
  }
  return p
}

export function useNotes(q = '') {
  const [rows, setRows] = useState<Note[]>([])
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let alive = true
    setLoaded(false)
    load(q)
      .then((page) => {
        if (!alive) return
        setRows(page?.items ?? [])
        setTotal(page?.total ?? 0)
        setError(null)
      })
      .catch((err: Error) => {
        if (!alive) return
        setError(err.message)
      })
      .finally(() => {
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [q, generation])

  /** Re-read after a write — status and stamps are server-owned. */
  const reload = useCallback(() => setGeneration((g) => g + 1), [])

  return { rows, total, loaded, error, reload }
}
