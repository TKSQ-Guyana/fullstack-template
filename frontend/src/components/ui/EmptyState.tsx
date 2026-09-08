import type { ReactNode } from 'react'

/** For screens with nothing to show — a sentence, not a blank pane. Only for
 *  the true empty state: a FAILED read renders its error, never this. */
export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-rule bg-surface p-10 text-center shadow-card">
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-400">{hint}</p>}
    </div>
  )
}
