import { NextResponse } from 'next/server'

// The database (or the network to it) was unreachable — nothing is wrong with the request,
// so answer 503 and let the client retry (the editor's save does, with backoff)
const CONNECTION_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE',
  'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED', 'CONNECT_TIMEOUT', // postgres.js
])

function isConnectionError(err: unknown): boolean {
  for (let e = err as { code?: string; cause?: unknown } | undefined, i = 0; e && i < 4; e = e.cause as typeof e, i++) {
    if (e.code && CONNECTION_CODES.has(e.code)) return true
  }
  return false
}

/**
 * An error as the API's answer. A server error's message isn't shown (it could leak database
 * details) — unless the error was made to be read (`expose: true`, e.g. "Brand kits are being set up").
 */
export function apiError(err: unknown) {
  const e = err as { message?: string; status?: number; expose?: boolean; needed?: number; balance?: number; code?: string; credits?: number }
  const offline = isConnectionError(err)
  const status = offline ? 503 : (e.status ?? 500)
  // The client only gets a generic message, so the real cause has to reach the server log
  if (status >= 500) console.error('[api]', err)
  // Never leak raw server/DB errors to the client
  const message = offline
    ? 'Connection problem — retrying.'
    : status < 500 || (e.expose && e.message)
      ? (e.message ?? 'Something went wrong')
      : 'Something went wrong. Please try again.'
  // Out of credits: the page shows what the action needs and what is left, with Top up and Upgrade
  // or a fresh moment search past the included ones: the page asks before paying
  const credits = status === 402 && typeof e.needed === 'number' ? { code: 'insufficient_credits', needed: e.needed, balance: e.balance ?? 0 }
    : status === 402 && (e.code === 'search_costs' || e.code === 'clips_cost') ? { code: e.code, credits: e.credits } : {}
  return NextResponse.json({ error: message, ...credits }, { status, ...(offline ? { headers: { 'Retry-After': '2' } } : {}) })
}
