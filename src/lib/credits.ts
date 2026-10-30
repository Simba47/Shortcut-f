// Credits: what each action costs and how spending picks which credits to use. Pure (no database,
// no React) so the prices and the order of spending are tested on their own (credits.test.ts) and
// the pricing page can read the same numbers the server charges.

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
export const FREE_SIGNUP_CREDITS = 30
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

/** Edit with AI: the whole video is read once, 1 credit per started minute */
export const readingCredits = (videoMs: number | null | undefined) => minutesStarted(videoMs)
/** Manual edit: captions for one clip only, 1 credit per started clip minute */
export const captionCredits = (clipMs: number | null | undefined) => minutesStarted(clipMs)

/** Exports up to this length cost EXPORT_CREDITS; up to MAX_CLIP_MS they cost LONG_EXPORT_CREDITS */
export const SHORT_EXPORT_MS = 3 * MINUTE
export const MAX_CLIP_MS = 5 * MINUTE
export const EXPORT_CREDITS = 2
export const LONG_EXPORT_CREDITS = 3
export function exportCredits(clipMs: number | null | undefined): number {
  const ms = clipMs ?? 0
  if (ms > MAX_CLIP_MS) {
    throw Object.assign(new Error(`Clips can be up to ${MAX_CLIP_MS / MINUTE} minutes. Trim it to export.`), { status: 400, expose: true })
  }
  return ms > SHORT_EXPORT_MS ? LONG_EXPORT_CREDITS : EXPORT_CREDITS
}

/** Credit packs: always dearer per credit than any plan, so heavy users move up a plan */
export const TOPUP_PACKS = [
  { key: 'small', credits: 50, price: 199 },
  { key: 'medium', credits: 150, price: 499 },
  { key: 'large', credits: 400, price: 1199 },
  { key: 'bulk', credits: 1000, price: 2799 },
] as const
export type TopupPackKey = typeof TOPUP_PACKS[number]['key']

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
