// When a video expires, in words, and who may keep one (plans v2, user 2026-11-21). Pure: the dashboard and the
// server's emails say the same. The rules themselves are server/services/expiry.ts.

const DAY = 86_400_000

/** Days before it goes that a video is flagged and the email is sent: the Trial 2 (it lasts 7), the plans 3 */
export function warnDays(plan: string | null | undefined): number {
  return plan === 'trial' ? 2 : 3
}

/** "★ Keep" (the video never expires, still counted in the storage): Pro (and Agency, no longer sold) */
export function canKeep(plan: string | null | undefined): boolean {
  return plan === 'creator' || plan === 'agency'
}

/** Days left (whole days, rounded up: 0 when it is past), null when it never expires */
export function daysLeft(expiresAt: string | Date | null | undefined, now: number = Date.now()): number | null {
  if (!expiresAt) return null
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / DAY))
}

/** "Expires today", "Expires tomorrow", "Expires in 3 days" */
export function expiresLabel(expiresAt: string | Date, now: number = Date.now()): string {
  const d = daysLeft(expiresAt, now) ?? 0
  return d <= 0 ? 'Expires today' : d === 1 ? 'Expires tomorrow' : `Expires in ${d} days`
}

/** Whether the card flags it (in its last warnDays) */
export function expiresSoon(expiresAt: string | Date | null | undefined, plan: string | null | undefined, now: number = Date.now()): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() - now <= warnDays(plan) * DAY
}
