import { PLANS, type PlanKey } from './plans'
import { extraReadingCredits } from './credits'

// How much AI work each plan includes, and the rules that keep its cost bounded. Pure (no
// database), so the rules are tested on their own (aiLimits.test.ts) and the page can show the
// same numbers the server applies. The numbers themselves live in plans.ts (`ai`).
//
// What is limited is what costs money: clips made (each needs text and framing on the worker)
// and fresh moment searches (Gemini reads the whole transcript). Clicks are not: "Make more
// clips" picks from moments already found and saved, which costs almost nothing.

export type AiLimits = (typeof PLANS)[PlanKey]['ai']

export function aiLimitsFor(plan: string | null | undefined): AiLimits {
  return (PLANS[plan as PlanKey] ?? PLANS.free).ai
}

const MINUTE = 60_000

/** At most 1 AI clip per minute of video: a 5-minute video does not hold 30 good clips */
export function videoClipCap(durationMs: number | null | undefined): number {
  return Math.max(1, Math.floor((durationMs ?? 0) / MINUTE))
}

/** A fresh moment search past the included ones: 5 credits per started 10 minutes of video (its cost grows with length; about ₹1.48) */
export function extraSearchCredits(durationMs: number | null | undefined): number {
  return 5 * Math.max(1, Math.ceil((durationMs ?? 0) / (10 * MINUTE)))
}

/** An AI clip past the month's included ones (about ₹1.50) */
export const EXTRA_CLIP_CREDITS = 5
/** What a run of `count` clips costs when `monthLeft` included clips are left: those are used first */
export function extraClipCredits(count: number, monthLeft: number): { extra: number; credits: number } {
  const extra = Math.max(0, count - Math.max(0, monthLeft))
  return { extra, credits: extra * EXTRA_CLIP_CREDITS }
}

/** Ask AI past the month's allowance, per search (about ₹2 on a 1-hour video) */
export const ASK_AI_EXTRA_CREDITS = 7
/** What one Ask AI search counts as: 1 per started hour of the video, since it reads all of it (a 5-hour video costs us 5 times as much) */
export function askAiUnits(durationMs: number | null | undefined): number {
  return Math.max(1, Math.ceil((durationMs ?? 0) / (60 * MINUTE)))
}
/** A search that counts as `units`, with `used` of `perMonth` used: only the part past the month costs credits */
export function askAiCredits(used: number, perMonth: number, units: number): number {
  return ASK_AI_EXTRA_CREDITS * Math.min(units, Math.max(0, used + units - perMonth))
}
/** Rewrites past the allowance: 1 credit for every 5 */
export const REWRITES_PER_CREDIT = 5
/** AI requests one person can send in a minute (Ask AI, rewrites, Best moments): only scripts ever reach it */
export const AI_REQUESTS_PER_MINUTE = 10

export type LimitedBy = null | 'run' | 'day' | 'video'
/** How many clips a run makes: the lowest of what was asked, the plan's per-run limit, and what is left today and for this video */
export function clipsAllowed(a: { requested: number; perRun: number; dayLeft: number; videoLeft: number }): { count: number; limitedBy: LimitedBy } {
  const options: Array<[number, LimitedBy]> = [[a.requested, null], [a.perRun, 'run'], [Math.max(0, a.dayLeft), 'day'], [Math.max(0, a.videoLeft), 'video']]
  let best = options[0]
  for (const o of options) if (o[0] < best[0]) best = o
  return { count: best[0], limitedBy: best[1] }
}

/** For the 1st, 6th, 11th… paid rewrite, a credit; the 4 after it are covered */
export function rewriteCredits(paidSoFar: number): number {
  return paidSoFar % REWRITES_PER_CREDIT === 0 ? 1 : 0
}

/** What the Post panel says beside Regenerate: what is left this month, or what the next rewrite costs */
export function rewriteNote(used: number, perMonth: number): string {
  if (used < perMonth) return `${perMonth - used} of ${perMonth} rewrites left this month`
  const covered = (REWRITES_PER_CREDIT - (used - perMonth) % REWRITES_PER_CREDIT) % REWRITES_PER_CREDIT
  if (covered === 0) return `Next rewrite: 1 credit, and the ${REWRITES_PER_CREDIT - 1} after it are covered`
  return `${covered} more rewrite${covered === 1 ? '' : 's'} covered by your last credit`
}

// Days and months run on India time, so "today" resets at midnight for the user
const IST_MS = (5 * 60 + 30) * 60_000
export function istDayStart(now: Date = new Date()): Date {
  const local = new Date(now.getTime() + IST_MS)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - IST_MS)
}
export function istMonthStart(now: Date = new Date()): Date {
  const local = new Date(now.getTime() + IST_MS)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - IST_MS)
}

/** Allowances count from here: the start of the India month, or for ever on Free (its allowances are once only) */
export function allowanceSince(plan: string | null | undefined, now: Date = new Date()): Date {
  return (PLANS[plan as PlanKey] ?? PLANS.free).allowancesOnce ? new Date(0) : istMonthStart(now)
}

/**
 * One more upload against the plan's hours and uploads: what is left, how much of this video is past
 * the hours, and what that part costs. A length not known yet (the browser couldn't read it; a link)
 * is priced when the worker has found it.
 */
export function readingQuote(
  plan: { uploadsPerMonth: number; readingMinutes: number },
  used: { uploads: number; usedMs: number },
  durationMs: number | null | undefined,
): { uploadsLeft: number; msLeft: number; overMs: number; credits: number } {
  const msLeft = Math.max(0, plan.readingMinutes * MINUTE - used.usedMs)
  const overMs = Math.max(0, (durationMs ?? 0) - msLeft)
  return { uploadsLeft: Math.max(0, plan.uploadsPerMonth - used.uploads), msLeft, overMs, credits: extraReadingCredits(overMs) }
}
