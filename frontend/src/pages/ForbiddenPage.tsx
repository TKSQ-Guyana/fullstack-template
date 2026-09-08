// Rendered IN PLACE by RequirePermission — never a redirect, so the URL and
// the shell stay intact and the person can see where they are.
export default function ForbiddenPage() {
  return (
    <div className="rounded-2xl border border-rule bg-surface p-10 text-center shadow-card">
      <p className="text-sm font-semibold text-ink-900">You can’t open this screen</p>
      <p className="mt-1 text-sm text-ink-500">
        Your role doesn’t include this permission. If you think it should, ask an administrator.
      </p>
    </div>
  )
}
