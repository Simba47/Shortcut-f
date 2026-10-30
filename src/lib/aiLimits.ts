import { PLANS, type PlanKey } from './plans'

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

/** A fresh moment search past the included ones: 1 credit per started 10 minutes of video (its cost grows with length) */
export function extraSearchCredits(durationMs: number | null | undefined): number {
  return Math.max(1, Math.ceil((durationMs ?? 0) / (10 * MINUTE)))
}

/** Ask AI past the month's allowance: 1 credit per search */
export const ASK_AI_EXTRA_CREDITS = 1
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
