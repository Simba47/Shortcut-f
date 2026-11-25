import { PLANS, type PlanKey } from './plans'
import { readingCredits } from './credits'

// How much AI work each plan includes, and the rules that keep its cost bounded. Pure (no
// database), so the rules are tested on their own (aiLimits.test.ts) and the page can show the
// same numbers the server applies. The numbers themselves live in plans.ts (`ai`).
//
// Since 2026-11-21 (user, plans v2) credits are the only limit on the AI actions (the hours of video read have
// a monthly limit again since 2026-11-22: readingQuote): every AI action is
// priced above its cost. What stays is safety: a run's size (clipsPerRun), 1 AI clip per minute of video,
// AI requests a minute, and a high daily limit (SAFETY_PER_DAY) no real person reaches, so a script or a
// stolen account can't drain the prepaid Gemini balance for everyone. (How many jobs one person runs at
// once is the worker's: shortcut-b queue.ts, 2 Make my clips and 1 whole-video reading per person.)
// "Make more clips" picks from moments already found and saved, which costs almost nothing.

export type AiLimits = (typeof PLANS)[PlanKey]['ai']

export function aiLimitsFor(plan: string | null | undefined): AiLimits {
  return (PLANS[plan as PlanKey] ?? PLANS.free).ai
}

const MINUTE = 60_000

/** At most 1 AI clip per minute of video: a 5-minute video does not hold 30 good clips */
export function videoClipCap(durationMs: number | null | undefined): number {
  return Math.max(1, Math.floor((durationMs ?? 0) / MINUTE))
}

/** A fresh moment search past the free one for each video: 5 credits per started 10 minutes of video (its cost grows with length; about ₹1.55) */
export function extraSearchCredits(durationMs: number | null | undefined): number {
  return 5 * Math.max(1, Math.ceil((durationMs ?? 0) / (10 * MINUTE)))
}

/** An AI clip: about ₹1.65 with its framing, and ₹0.33 more for the second look at its start and end by a stronger
 * model (gemini-3.6-flash, ₹0.67 from 2027) when it is made (user, 2026-11-12: 6 credits keeps plans at 60%).
 * 7 from 2026-11-21 (user): its first export is included, so the clip board doesn't ask for export credits
 * again (ai_edit_jobs.export_included, server/services/export.ts freeExports) */
export const CLIP_CREDITS = 7
/** What a clip cost before the export was included: runs charged then are refunded at this price (credits.sweep) */
export const CLIP_CREDITS_BEFORE_EXPORT = 6
export const clipCredits = (count: number) => count * CLIP_CREDITS

/** An Ask AI search, per started hour of the video (about ₹2 an hour) */
export const ASK_AI_CREDITS = 7
/** What one Ask AI search counts as: 1 per started hour of the video, since it reads all of it (a 5-hour video costs us 5 times as much) */
export function askAiUnits(durationMs: number | null | undefined): number {
  return Math.max(1, Math.ceil((durationMs ?? 0) / (60 * MINUTE)))
}
export const askAiCredits = (units: number) => units * ASK_AI_CREDITS
/** Rewrites: 1 credit for every 5 */
export const REWRITES_PER_CREDIT = 5
/** AI requests one person can send in a minute (Ask AI, rewrites, Best moments): only scripts ever reach it */
export const AI_REQUESTS_PER_MINUTE = 10

/**
 * The most one account does in a day (India time), on every plan: far past real use (300 AI clips is 2,100
 * credits, more than two months of Pro), there only to stop a script or a stolen account. Past one, the
 * refusal says it comes back tomorrow and to write to us.
 */
export const SAFETY_PER_DAY = { aiClips: 300, askAi: 100, rewrites: 300, readingMinutes: 20 * 60 } as const
export const SAFETY_NOTE = 'It comes back at midnight (India time). Need more? Write to us.'

export interface Safety { aiClips: number; askAi: number; rewrites: number; readingMinutes: number; requestsPerMinute: number }
/** Unlimited (Shortcut's own test accounts, plans.ts): numbers no test reaches (kept as numbers: what is left is written down) */
const NO_SAFETY: Safety = { aiClips: 1_000_000, askAi: 1_000_000, rewrites: 1_000_000, readingMinutes: 1_000_000 * 60, requestsPerMinute: 1_000_000 }
/** The day's safety limits and the AI requests a minute for this plan: the same on every plan but Unlimited */
export function safetyFor(plan: string | null | undefined): Safety {
  return plan === 'unlimited' ? NO_SAFETY : { ...SAFETY_PER_DAY, requestsPerMinute: AI_REQUESTS_PER_MINUTE }
}

export type LimitedBy = null | 'run' | 'day' | 'video'
/** How many clips a run makes: the lowest of what was asked, the plan's per-run limit, what is left for this video, and today's safety limit */
export function clipsAllowed(a: { requested: number; perRun: number; dayLeft: number; videoLeft: number }): { count: number; limitedBy: LimitedBy } {
  const options: Array<[number, LimitedBy]> = [[a.requested, null], [a.perRun, 'run'], [Math.max(0, a.dayLeft), 'day'], [Math.max(0, a.videoLeft), 'video']]
  let best = options[0]
  for (const o of options) if (o[0] < best[0]) best = o
  return { count: best[0], limitedBy: best[1] }
}

/** For the 1st, 6th, 11th… rewrite of the month, a credit; the 4 after it are covered */
export function rewriteCredits(soFar: number): number {
  return soFar % REWRITES_PER_CREDIT === 0 ? 1 : 0
}

/** What the Post panel says beside Regenerate: what the next rewrite costs (no monthly limit since 2026-11-21) */
export function rewriteNote(used: number): string {
  const covered = (REWRITES_PER_CREDIT - used % REWRITES_PER_CREDIT) % REWRITES_PER_CREDIT
  return covered === 0 ? `Next rewrite: 1 credit, and it covers ${REWRITES_PER_CREDIT}` : `${covered} more covered by your last credit`
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

/** Counts run from here: the start of the India month, or for ever on the Trial (its uploads are once only;
 * also where rewrites' "1 credit per 5" and a deleted file's free re-upload are counted from) */
export function allowanceSince(plan: string | null | undefined, now: Date = new Date()): Date {
  return (PLANS[plan as PlanKey] ?? PLANS.free).allowancesOnce ? new Date(0) : istMonthStart(now)
}

/**
 * One more upload: the uploads left (null: no limit; only the Trial has one), the minutes of video it may still
 * read, how much of this video is past them (then it is refused), and what the video costs. The minutes left are
 * the lower of the plan's hours (readingMinutes: a month, the Trial's in total; back since 2026-11-22) and today's
 * safety limit; `limitedBy` says which one ('plan' or 'day'). `used`: uploads and minutes counted so far
 * (allowanceSince) and minutes read today. A length not known yet (the browser couldn't read it; a link) is
 * priced when the worker has found it.
 */
export function readingQuote(
  plan: { uploadsLimit: number | null; readingMinutes: number; key?: string },
  used: { uploads: number; usedMs: number; todayMs: number },
  durationMs: number | null | undefined,
): { uploadsLeft: number | null; msLeft: number; overMs: number; credits: number; limitedBy: 'plan' | 'day' } {
  const planLeft = Math.max(0, plan.readingMinutes * MINUTE - used.usedMs)
  const dayLeft = Math.max(0, safetyFor(plan.key).readingMinutes * MINUTE - used.todayMs)
  // (the plan's before the day: when both are used up the refusal names the one that lasts)
  const limitedBy = planLeft <= dayLeft ? 'plan' : 'day'
  const msLeft = Math.min(planLeft, dayLeft)
  const overMs = Math.max(0, (durationMs ?? 0) - msLeft)
  return { uploadsLeft: plan.uploadsLimit == null ? null : Math.max(0, plan.uploadsLimit - used.uploads), msLeft, overMs, credits: readingCredits(durationMs ?? 0), limitedBy }
}
