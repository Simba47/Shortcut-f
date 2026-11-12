/**
 * Why something failed, in plain words (user, 2026-11-12) — shared by the clip board's banner and the editor's
 * export banner. No connection → say so; a clear reason from the server ("The clip is too short") → as it is;
 * anything technical (a database message, "NaN", "Failed to fetch", broken JSON, a stack line) or nothing at
 * all → a plain "something went wrong", never the raw text.
 */
export function friendlyError(e: unknown): string {
  const msg = (e instanceof Error ? e.message : typeof e === 'string' ? e : '').trim()
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  if (offline || /failed to fetch|networkerror|network request failed|load failed|err_internet/i.test(msg)) {
    return 'Check your connection and try again.'
  }
  const technical = !msg || msg.length > 160 || /\bNaN\b/.test(msg) ||
    /\bundefined\b|\bnull\b|syntax|unexpected token|json|invalid input|violates|constraint|relation |column |type integer|uuid|econn|timeout|internal server|stack|\bat \S+ \(|^\d{3}\b|^error:?$/i.test(msg)
  if (technical) return 'Something went wrong on our side. Please try again.'
  return /[.!?]$/.test(msg) ? msg : `${msg}.`
}
