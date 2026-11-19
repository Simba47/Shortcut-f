// What a payment bought, in words, for its invoice / receipt and its email (user, 2026-11-18: a one-time
// pack must not read like a monthly plan). Pure: tested in purchase.test.ts.
import { PLANS } from './plans'
import { findTopupPack, TOPUP_CREDIT_DAYS, TRIAL_DAYS } from './credits'

const DAY = 86_400_000

export interface Purchase {
  /** The invoice line and the email: "Creator plan", "Trial pack", "500 credits top-up" */
  name: string
  /** Under the name: what it gives */
  detail: string
  /** subscription: renews every month until cancelled; one-time: paid once, never renews */
  kind: 'subscription' | 'one-time' | 'other'
  /** Credits it gave (a plan: each month) */
  credits: number | null
  /** One-time packs: the day their credits run out */
  validUntil: Date | null
}

const n = (x: number) => x.toLocaleString('en-IN')
const credits = (x: number) => `${n(x)} credit${x === 1 ? '' : 's'}`

/** `plan` as stored on the payment: a plan key ("creator") or "topup:<pack>" ("topup:trial", "topup:medium") */
export function describePurchase(plan: string, paidAt: Date): Purchase {
  const p = PLANS[plan as keyof typeof PLANS]
  if (p && !p.oneTime && p.price > 0) {
    return {
      name: `${p.name} plan`,
      detail: `Monthly subscription · ${credits(p.monthlyCredits)} every month`,
      kind: 'subscription', credits: p.monthlyCredits, validUntil: null,
    }
  }
  const key = plan.startsWith('topup:') ? plan.slice(6) : plan
  const pack = findTopupPack(key, { test: true })
  if (pack) {
    const trial = pack.key === 'trial'
    const days = trial ? TRIAL_DAYS : TOPUP_CREDIT_DAYS
    return {
      name: trial ? 'Trial pack' : `${credits(pack.credits)} top-up`,
      detail: trial
        ? `One-time pack · ${credits(pack.credits)} to try everything, for ${days} days`
        : `One-time credit pack · ${credits(pack.credits)}, valid for ${days} days`,
      kind: 'one-time', credits: pack.credits, validUntil: new Date(paidAt.getTime() + days * DAY),
    }
  }
  return { name: plan, detail: '', kind: 'other', credits: null, validUntil: null }
}

/** The last line of an invoice and of the email: whether anything more will be charged */
export function renewalNote(p: Purchase): string | null {
  if (p.kind === 'subscription') return 'Your plan renews every month until you cancel it on the Plans page.'
  if (p.kind === 'one-time') return 'This was a one-time payment. It does not renew and nothing more will be charged.'
  return null
}
