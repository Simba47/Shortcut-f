// Paying in rupees or US dollars (user, 2026-11-22: international payments through Razorpay International).
// Pure (no database, no React) so the prices and the choice are tested on their own (currency.test.ts), and the
// pricing pages and the server read the same numbers.
//
// Every amount here is in the currency's smallest unit, as Razorpay counts it: paise for ₹, cents for $. The
// tables still call their columns amount_paise; read them as "smallest unit of the row's currency".
//
// Credits are the same everywhere: a plan or a pack gives the same credits in both currencies, only the price
// differs. The dollar prices are the user's "Global prices" (2026-11-22): at about ₹88 to the dollar, after
// Razorpay's ~3.5% international fee and no GST (an export under LUT), each keeps about 70-80% at full use.

import { PLANS, type PlanKey } from './plans'
import { findTopupPack } from './credits'

export const CURRENCIES = ['INR', 'USD'] as const
export type Currency = typeof CURRENCIES[number]
export const isCurrency = (v: unknown): v is Currency => (CURRENCIES as readonly unknown[]).includes(v)

/** Plans in dollars, in cents. A plan not listed (Agency, no longer sold) is not offered in dollars. */
export const USD_PLAN_CENTS: Partial<Record<PlanKey, number>> = {
  trial: 199, // $1.99 once, 99 credits
  starter: 900, // $9 a month, 599 credits
  creator: 1500, // Pro, $15 a month, 999 credits
}

/** Credit packs in dollars, in cents (same credits as in rupees: 200 / 500 / 1,250 / 3,000) */
export const USD_PACK_CENTS: Record<string, number> = {
  small: 300,
  medium: 700,
  large: 1700,
  bulk: 3900,
  // the test pack (TEST_PACK_EMAILS only): Razorpay's smallest order
  test: 100,
}

/** A plan's price in the smallest unit of `currency`; null when it is not sold in that currency */
export function planPriceMinor(plan: string, currency: Currency): number | null {
  const p = PLANS[plan as PlanKey]
  if (!p) return null
  if (currency === 'INR') return Math.round(p.price * 100)
  return USD_PLAN_CENTS[plan as PlanKey] ?? null
}

/** A pack's price (the Trial pack's too) in the smallest unit of `currency`; null when there is none */
export function packPriceMinor(packKey: string, currency: Currency): number | null {
  if (packKey === 'trial') return planPriceMinor('trial', currency)
  const pack = findTopupPack(packKey, { test: true })
  if (!pack) return null
  if (currency === 'INR') return Math.round(pack.price * 100)
  return USD_PACK_CENTS[packKey] ?? null
}

/**
 * Money to show: "₹599", "₹2,599", "$9", "$1.99". Whole amounts drop the ".00" unless `cents` is set (an
 * invoice always shows them: "₹599.00", "$9.00"). Rupees use Indian grouping (1,00,000), dollars US (100,000).
 */
export function formatMoney(minor: number, currency: Currency | string, opts: { cents?: boolean } = {}): string {
  const major = Math.round(minor) / 100
  const whole = Number.isInteger(major) && !opts.cents
  const digits = whole ? 0 : 2
  if (currency === 'USD') return `$${major.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
  return `₹${major.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

/** "$9/month" style price of a plan for a page; '' when it is not sold in that currency */
export function planPriceLabel(plan: string, currency: Currency): string {
  const m = planPriceMinor(plan, currency)
  return m === null ? '' : formatMoney(m, currency)
}

/**
 * The browser's guess: India's time zone pays in rupees, anywhere else in dollars. No time zone (an old
 * browser, a server render) is rupees, as before.
 */
export function currencyFromTimeZone(tz: string | null | undefined): Currency {
  if (!tz) return 'INR'
  return tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta' ? 'INR' : 'USD'
}

/**
 * Dollar payments switched on (NEXT_PUBLIC_USD_PAYMENTS=1, user 2026-11-22: "add an off switch"): only once
 * Razorpay has enabled international payments and USD on the account. Off, everyone sees and pays rupees. Read
 * on the server at run time and built into the pages (NEXT_PUBLIC_), so changing it needs a redeploy (Railway
 * redeploys on a variable change).
 */
export function usdPaymentsOn(): boolean {
  return process.env.NEXT_PUBLIC_USD_PAYMENTS === '1'
}

/**
 * The currency a purchase is made in: the account's, once it has paid (`locked`, from its payments), so an
 * account never switches between rupees and dollars; before that, what the page asked for; else rupees.
 * Dollars only while they are switched on (`usdOn`), except for an account that already pays in them.
 */
export function chooseCurrency(locked: Currency | null | undefined, asked: unknown, usdOn: boolean = usdPaymentsOn()): Currency {
  if (locked) return locked
  if (asked === 'USD' && !usdOn) return 'INR'
  return isCurrency(asked) ? asked : 'INR'
}

/**
 * The struck-out price beside a pack (billing page): the same credits at Starter's rate in that currency
 * (₹1 a credit; $9 for 599 credits). Null when the pack saves too little to show (under ₹5, or 25¢).
 */
export function packSavingIn(pack: { key: string; credits: number }, currency: Currency): { was: number; saved: number; percent: number } | null {
  const price = packPriceMinor(pack.key, currency)
  const starter = planPriceMinor('starter', currency)
  if (price === null || starter === null) return null
  const was = Math.round((pack.credits * starter) / PLANS.starter.monthlyCredits)
  const saved = was - price
  if (saved < (currency === 'INR' ? 500 : 25)) return null
  return { was, saved, percent: Math.round((saved / was) * 100) }
}

/**
 * GST's code for a place of supply outside India ("Foreign Country" on the GST portal): a payment in dollars is
 * an export of services, zero-rated under the LUT, so it carries no GST.
 */
export const OUTSIDE_INDIA = '96'
