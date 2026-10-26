// What a log line may show of a person — pure, so the logger and every
// integration mask the same way. The log is aggregated and read by more people
// than the request was; it does not need to read back anybody's address.

/**
 * `ada.admin@example.dev` -> `a•••••••••@example.dev`. The domain stays
 * because it is the part that helps when somebody asks why their mail did not
 * arrive; the local part does not. Masking a masked address changes nothing.
 */
export function maskEmail(address: string): string {
  const trimmed = address.trim()
  const at = trimmed.lastIndexOf('@')
  if (at < 1) return '•'.repeat(Math.max(trimmed.length, 1))
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at)
  return `${local[0]}${'•'.repeat(Math.max(local.length - 1, 1))}${domain}`
}
