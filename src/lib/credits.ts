// Credits: what each action costs and how spending picks which credits to use. Pure (no database,
// no React) so the prices and the order of spending are tested on their own (credits.test.ts) and
// the pricing page can read the same numbers the server charges.
//
// 1 credit = ₹1 (about ₹0.83 reaches us after GST and fees). Each price keeps 60%+ even on the
// biggest top-up pack, from the 5 Nov costs (Shortcut-Unit-Economics-Nov-2026.pdf).

/**
 * off:    nothing is recorded or checked (how the site ran before credits)
 * shadow: every spend is written to the ledger but never refused — to watch real numbers first
 * on:     a spend the balance cannot cover is refused with 402
 */
export type CreditsMode = 'off' | 'shadow' | 'on'
export function creditsMode(env: Record<string, string | undefined> = process.env): CreditsMode {
  const v = (env.CREDITS_MODE ?? '').trim().toLowerCase()
  return v === 'shadow' || v === 'on' ? v : 'off'
}

/** Given once, when an account is first seen with credits switched on (CREDITS_FREE_SIGNUP changes it; 0 gives none) */
export const FREE_SIGNUP_CREDITS = 10
export function freeSignupCredits(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.CREDITS_FREE_SIGNUP)
  return env.CREDITS_FREE_SIGNUP !== undefined && env.CREDITS_FREE_SIGNUP.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : FREE_SIGNUP_CREDITS
}
/** Unused plan credits roll over one month, then expire; a top-up lasts a year */
export const PLAN_CREDIT_DAYS = 62
export const TOPUP_CREDIT_DAYS = 365
/** A hold on credits for a job that never reported back is let go after this long */
export const HOLD_TTL_HOURS = 6

const MINUTE = 60_000
const minutesStarted = (ms: number | null | undefined) => Math.max(1, Math.ceil((ms ?? 0) / MINUTE))

/** Reading past the plan's hours (the first search of that part included): per started 10 minutes. Costs us about ₹4.10 */
export const EXTRA_READING_CREDITS = 15
export const extraReadingCredits = (overMs: number) => (overMs > 0 ? EXTRA_READING_CREDITS * Math.ceil(overMs / (10 * MINUTE)) : 0)

/** Manual edit: captions for one clip only, per started clip minute. Costs us about ₹0.59 */
export const CAPTION_CREDITS_PER_MINUTE = 2
export const captionCredits = (clipMs: number | null | undefined) => CAPTION_CREDITS_PER_MINUTE * minutesStarted(clipMs)

/** Silence this long at a clip's start or end means that part has no captions yet */
export const CAPTION_GAP_MS = 4000

/** Subjects: finding and following people on the worker, per started minute of the part not paid for yet. About ₹0.10-0.30 a minute to run */
export const SUBJECTS_CREDITS_PER_MINUTE = 2
export const subjectsCredits = (newMs: number) => (newMs > 0 ? SUBJECTS_CREDITS_PER_MINUTE * minutesStarted(newMs) : 0)
/**
 * How much of [startMs, endMs] no earlier payment covers. Once per clip: only a clip made longer
 * pays again, for the new part. Under a second isn't counted (as the editor's "the clip grew": a
 * scan reads a little either side).
 */
export function subjectsNewMs(startMs: number, endMs: number, paid: { start_ms: number; end_ms: number }[]): number {
  let at = startMs, uncovered = 0
  for (const p of [...paid].sort((a, b) => a.start_ms - b.start_ms)) {
    if (p.end_ms <= at) continue
    if (p.start_ms >= endMs) break
    if (p.start_ms > at) uncovered += p.start_ms - at
    at = Math.max(at, p.end_ms)
  }
  if (at < endMs) uncovered += endMs - at
  return uncovered < 1000 ? 0 : uncovered
}
/**
 * The part of a clip that "Get CC" reads and charges for: all of it with no words; only the new
 * part when it was made longer at one end; all of it when made longer at both; null when it has
 * its captions. Used by the editor for the price and by the server for the job, so they agree.
 */
export function captionSpan(startMs: number, endMs: number, words: { start_ms: number; end_ms: number }[]): { start_ms: number; end_ms: number } | null {
  const inside = words.filter(w => w.start_ms >= startMs && w.start_ms < endMs)
  if (!inside.length) return { start_ms: startMs, end_ms: endMs }
  const first = Math.min(...inside.map(w => w.start_ms)), last = Math.max(...inside.map(w => w.end_ms))
  const head = first - startMs > CAPTION_GAP_MS, tail = endMs - last > CAPTION_GAP_MS
  if (head && tail) return { start_ms: startMs, end_ms: endMs }
  if (head) return { start_ms: startMs, end_ms: first }
  if (tail) return { start_ms: last, end_ms: endMs }
  return null
}

export const MAX_CLIP_MS = 5 * MINUTE
/** An export, per started clip minute: about ₹0.15 a minute to make (measured on clips of about a minute) */
export const EXPORT_CREDITS_PER_MINUTE = 1
export function exportCredits(clipMs: number | null | undefined): number {
  const ms = clipMs ?? 0
  if (ms > MAX_CLIP_MS) {
    throw Object.assign(new Error(`Clips can be up to ${MAX_CLIP_MS / MINUTE} minutes. Trim it to export.`), { status: 400, expose: true })
  }
  return EXPORT_CREDITS_PER_MINUTE * minutesStarted(ms)
}

/** Credit packs: about ₹1 a credit, a little less on the bigger ones */
export const TOPUP_PACKS = [
  { key: 'small', credits: 200, price: 199 },
  { key: 'medium', credits: 500, price: 489 },
  { key: 'large', credits: 1250, price: 1199 },
  { key: 'bulk', credits: 3000, price: 2799 },
] as const
export type TopupPackKey = typeof TOPUP_PACKS[number]['key']

const SPENT_ON: Record<string, string> = {
  render: 'Export', caption: 'Captions', transcribe: 'Captions', subjects: 'Subjects', ask_ai: 'Ask AI', rewrite: 'Rewrites',
  search: 'New moment search', ai_clips: 'AI clips', reading: 'Reading past your plan',
}
const GRANTED: Record<string, string> = {
  plan: 'Monthly plan credits', topup: 'Top-up', free: 'Free credits', bonus: 'Bonus credits', refund: 'Credits refunded',
}
/** One row of the credit history in plain words (billing page) */
export function ledgerLabel(reason: string, refType: string | null): string {
  if (reason.startsWith('grant:')) return GRANTED[reason.slice(6)] ?? 'Credits added'
  const what = (refType && SPENT_ON[refType]) || 'Credits used'
  if (reason === 'spend') return what
  if (reason === 'release') return `${what}: credits returned`
  return 'Credits changed'
}

export type GrantKind = 'free' | 'plan' | 'topup' | 'bonus' | 'refund'
export interface SpendableGrant { id: string; remaining: number; expiresAt: Date | null; kind: GrantKind; createdAt: Date }

/**
 * Which grants a spend of `amount` comes out of: the ones that run out soonest first (so plan
 * credits go before a top-up, which lasts longer), credits that never expire last, and ties by
 * age. Null when the usable grants do not add up to the amount.
 */
export function allocate(grants: SpendableGrant[], amount: number, now: Date): { grantId: string; take: number }[] | null {
  if (amount <= 0) return []
  const usable = grants
    .filter(x => x.remaining > 0 && (!x.expiresAt || x.expiresAt > now))
    .sort((a, b) => {
      const ea = a.expiresAt?.getTime() ?? Infinity, eb = b.expiresAt?.getTime() ?? Infinity
      return ea - eb || a.createdAt.getTime() - b.createdAt.getTime()
    })
  const out: { grantId: string; take: number }[] = []
  let need = amount
  for (const grant of usable) {
    if (need <= 0) break
    const take = Math.min(grant.remaining, need)
    out.push({ grantId: grant.id, take })
    need -= take
  }
  return need > 0 ? null : out
}
