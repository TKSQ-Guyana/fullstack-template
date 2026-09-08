// The Suspense fallback while a route chunk loads — quiet, not a spinner
// carnival: chunk loads are fast and a flash of spinner reads as jank.
export function RouteFallback() {
  return <div className="p-8 text-sm text-ink-400">Loading…</div>
}
