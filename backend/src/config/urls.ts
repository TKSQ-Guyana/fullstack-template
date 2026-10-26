/**
 * A connection URL safe to log: the password, when there is one, reads `***`.
 *
 * `REDIS_URL` is a secret because a Redis with AUTH carries its password inside
 * the URL (`redis://:<password>@<host>:6379`), yet the connect line names the
 * server so an operator can see which one was reached. The host, port, user
 * and database number stay; only the password goes.
 */
export function urlWithoutPassword(url: string): string {
  if (url === '') return ''
  try {
    const parsed = new URL(url)
    if (parsed.password) parsed.password = '***'
    return parsed.toString()
  } catch {
    // Unparseable: say so rather than echo something that may hold a secret.
    return '[unparseable URL]'
  }
}
