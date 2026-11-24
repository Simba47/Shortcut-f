import sql from '@/lib/db'
import { creditsMode } from '@/lib/credits'
import {
  aiLimitsFor, allowanceSince, videoClipCap, extraSearchCredits, istDayStart, rewriteCredits,
  askAiCredits, AI_REQUESTS_PER_MINUTE, CLIP_CREDITS, SAFETY_PER_DAY, SAFETY_NOTE,
} from '@/lib/aiLimits'
import { charge, release, settle, type Hold } from './credits'
import { getUserPlan, NO_PLAN_AI_MESSAGE } from './quota'

// Keeping AI cost bounded (lib/aiLimits.ts has the rules, plans.ts the numbers):
//   - Moments found once per video are saved (video_moments): "Make more clips" and Best moments
//     pick from them instead of asking Gemini again. A fresh search is what costs, so it is counted
//     per video (moment_searches): included per plan, then paid in credits.
//   - Clips made per day and per video are counted from the clips themselves.
//   - Ask AI and hook/title rewrites are counted (ai_actions) and paid in credits; no monthly limit since
//     2026-11-21 (plans v2), only the day's safety limit (SAFETY_PER_DAY) and a per-minute speed limit.
//   - Every Gemini call's tokens and estimated price are written down (ai_usage), so the
//     allowances can be set from real costs.
// Like credits, all of it follows CREDITS_MODE: off = nothing counted or refused; shadow = counted,
// never refused or charged; on = enforced.

let ready: Promise<void> | null = null
export function ensureAiUsageSchema(): Promise<void> {
  ready ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS video_moments (
        video_id UUID PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
        moments JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`
      CREATE TABLE IF NOT EXISTS moment_searches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        ai_edit_job_id UUID,
        credits INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`CREATE INDEX IF NOT EXISTS moment_searches_video_idx ON moment_searches (video_id)`
    await sql`
      CREATE TABLE IF NOT EXISTS ai_actions (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        video_id UUID,
        credits INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    // What an Ask AI search counted as (aiLimits askAiUnits)
    await sql`ALTER TABLE ai_actions ADD COLUMN IF NOT EXISTS units INTEGER NOT NULL DEFAULT 1`
    await sql`CREATE INDEX IF NOT EXISTS ai_actions_user_idx ON ai_actions (user_id, kind, created_at DESC)`
    await sql`
      CREATE TABLE IF NOT EXISTS ai_usage (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        video_id UUID,
        purpose TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_micro_usd BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`CREATE INDEX IF NOT EXISTS ai_usage_user_idx ON ai_usage (user_id, created_at DESC)`
    // Who bills each call: 'key' = the Gemini key's prepaid credits (AI Studio), 'vertex' = Google
    // Cloud (the worker adds the same: shortcut-b index.ts)
    await sql`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS via TEXT`
    await sql`
      CREATE TABLE IF NOT EXISTS gemini_key_events (
        id BIGSERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        source TEXT,
        message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
  })().catch(e => { ready = null; throw e })
  return ready
}

const fail = (message: string, status: number, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { status, expose: true, ...extra })

// ── Saved moments ─────────────────────────────────────────────────────────────

export interface SavedMoment {
  start_ms: number; end_ms: number; title: string; summary: string
  score?: number; reason?: string; subscores?: unknown
}

/** All the good moments one fresh search found for this video, best first (replaces what was saved) */
export async function saveMoments(videoId: string, moments: SavedMoment[]): Promise<void> {
  await ensureAiUsageSchema()
  const sorted = [...moments].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  await sql`
    INSERT INTO video_moments (video_id, moments, updated_at) VALUES (${videoId}, ${sql.json(sorted as never)}, now())
    ON CONFLICT (video_id) DO UPDATE SET moments = EXCLUDED.moments, updated_at = now()`
}

/** Saved moments that are not already a clip of this video (overlapping by more than half of the shorter one), best first */
export async function unusedMoments(videoId: string, extraExclude: Array<[number, number]> = []): Promise<SavedMoment[]> {
  await ensureAiUsageSchema()
  const [row] = await sql<{ moments: SavedMoment[] }[]>`SELECT moments FROM video_moments WHERE video_id = ${videoId}`
  if (!row || !Array.isArray(row.moments)) return []
  const clips = await sql<{ start_ms: number; end_ms: number }[]>`SELECT start_ms, end_ms FROM clips WHERE video_id = ${videoId}`
  const taken: Array<[number, number]> = [...clips.map(c => [c.start_ms, c.end_ms] as [number, number]), ...extraExclude]
  return row.moments.filter(m => !taken.some(([s, e]) => overlaps(m.start_ms, m.end_ms, s, e)))
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  const shared = Math.min(a1, b1) - Math.max(a0, b0)
  return shared > 0 && shared > 0.5 * Math.min(a1 - a0, b1 - b0)
}

/** A fresh moment search was made (Make my clips: tied to its run, so a failed run does not count) */
export async function recordSearch(userId: string, videoId: string, source: 'make_clips' | 'best_moments', aiEditJobId: string | null, credits: number): Promise<void> {
  await ensureAiUsageSchema()
  await sql`INSERT INTO moment_searches (user_id, video_id, source, ai_edit_job_id, credits) VALUES (${userId}, ${videoId}, ${source}, ${aiEditJobId}, ${credits})`
}

// ── What is left ──────────────────────────────────────────────────────────────

export interface ClipAllowance {
  /** How long the video is (Ask AI counts 1 per started hour of it) */
  durationMs: number | null
  perRun: number
  /** Today's safety limit (SAFETY_PER_DAY, every plan) */
  clipsPerDay: number; clipsToday: number; dayLeft: number
  /** What each AI clip costs */
  clipCredits: number
  videoCap: number; videoClips: number; videoLeft: number
  savedLeft: number
  searchesIncluded: number; searchesUsed: number
  /** What the next fresh search costs: 0 while included searches are left */
  nextSearchCredits: number
}

/**
 * Clips a run made or is making: a finished or stopped run counts the clips it really made; one
 * still going (or waiting for a yes) counts what it asked for, so two quick runs cannot both pass.
 */
const runClips = sql`
  CASE WHEN j.status IN ('done', 'failed') THEN (SELECT count(*) FROM clips c WHERE c.ai_edit_job_id = j.id)
       ELSE GREATEST(j.clip_count, (SELECT count(*) FROM clips c WHERE c.ai_edit_job_id = j.id)) END`

export async function clipAllowance(userId: string, videoId: string): Promise<ClipAllowance> {
  await ensureAiUsageSchema()
  const planKey = await getUserPlan(userId)
  const limits = aiLimitsFor(planKey)
  const [video] = await sql<{ duration_ms: number | null }[]>`SELECT duration_ms FROM videos WHERE id = ${videoId} AND user_id = ${userId}`
  if (!video) throw fail('Not found', 404)
  const [today] = await sql<{ n: string }[]>`
    SELECT COALESCE(SUM(${runClips}), 0) AS n FROM ai_edit_jobs j JOIN videos v ON v.id = j.video_id
    WHERE v.user_id = ${userId} AND j.created_at >= ${istDayStart()}`
  const [forVideo] = await sql<{ n: string }[]>`SELECT COALESCE(SUM(${runClips}), 0) AS n FROM ai_edit_jobs j WHERE j.video_id = ${videoId}`
  const [searches] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM moment_searches s LEFT JOIN ai_edit_jobs j ON j.id = s.ai_edit_job_id
    WHERE s.video_id = ${videoId} AND (s.ai_edit_job_id IS NULL OR j.status IS DISTINCT FROM 'failed')`
  const clipsToday = Number(today.n), videoClips = Number(forVideo.n)
  const videoCap = videoClipCap(video.duration_ms)
  return {
    perRun: limits.clipsPerRun,
    clipsPerDay: SAFETY_PER_DAY.aiClips, clipsToday, dayLeft: Math.max(0, SAFETY_PER_DAY.aiClips - clipsToday),
    clipCredits: CLIP_CREDITS,
    videoCap, videoClips, videoLeft: Math.max(0, videoCap - videoClips), durationMs: video.duration_ms,
    savedLeft: (await unusedMoments(videoId)).length,
    searchesIncluded: limits.searchesPerVideo, searchesUsed: searches.n,
    nextSearchCredits: searches.n < limits.searchesPerVideo ? 0 : extraSearchCredits(video.duration_ms),
  }
}

// ── Ask AI and rewrites ───────────────────────────────────────────────────────

export type AiActionKind = 'ask_ai' | 'rewrite'

export async function aiActionCounts(userId: string): Promise<{ askAiToday: number; rewritesThisMonth: number; rewritesToday: number; lastMinute: number }> {
  await ensureAiUsageSchema()
  // (rewrites since the month began: what their "1 credit per 5" counts from)
  const since = allowanceSince(await getUserPlan(userId))
  const day = istDayStart()
  const [r] = await sql<{ ad: number; rm: number; rd: number; lm: number }[]>`
    SELECT
      COALESCE(sum(units) FILTER (WHERE kind = 'ask_ai' AND created_at >= ${day}), 0)::int AS ad,
      count(*) FILTER (WHERE kind = 'rewrite' AND created_at >= ${since})::int AS rm,
      count(*) FILTER (WHERE kind = 'rewrite' AND created_at >= ${day})::int AS rd,
      count(*) FILTER (WHERE created_at >= now() - interval '1 minute')::int AS lm
    FROM ai_actions WHERE user_id = ${userId}`
  return { askAiToday: r.ad, rewritesThisMonth: r.rm, rewritesToday: r.rd, lastMinute: r.lm }
}

/** A search is refused with no plan, or past today's safety limit (whatever credits are left). `units`: what it counts as (aiLimits askAiUnits) */
function refuseAskAi(plan: string, counts: { askAiToday: number }, units: number) {
  if (plan === 'free') throw fail(NO_PLAN_AI_MESSAGE, 403)
  if (counts.askAiToday + units > SAFETY_PER_DAY.askAi) throw fail(`You've reached today's limit of ${SAFETY_PER_DAY.askAi} Ask AI searches. ${SAFETY_NOTE}`, 429)
}

/** The credits one Ask AI search takes (0 unless credits are on); refused first if it can't be done at all */
export async function askAiPrice(userId: string, units: number): Promise<number> {
  if (creditsMode() !== 'on') return 0
  const plan = await getUserPlan(userId)
  refuseAskAi(plan, await aiActionCounts(userId), units)
  return askAiCredits(units)
}

export interface AiActionHandle {
  /** Credits taken for this one (0 while within the allowance) */
  credits: number
  /** The AI answered: the use and its credits stand */
  done(): Promise<void>
  /** The AI call failed: the use is not counted and its credits come back */
  fail(): Promise<void>
}

/**
 * Starts one Ask AI search or rewrite (`units`: what it counts as, aiLimits askAiUnits): checks the speed limit and the
 * day's safety limit, counts it, and takes its credits (402 if there are not enough).
 * Call done() when the AI answered, fail() when it did not.
 */
export async function beginAiAction(userId: string, kind: AiActionKind, videoId: string | null = null, units = 1): Promise<AiActionHandle> {
  const mode = creditsMode()
  const noop: AiActionHandle = { credits: 0, done: async () => {}, fail: async () => {} }
  if (mode === 'off') return noop
  await ensureAiUsageSchema()
  const plan = await getUserPlan(userId)
  const counts = await aiActionCounts(userId)
  const enforce = mode === 'on'
  if (enforce && counts.lastMinute >= AI_REQUESTS_PER_MINUTE) throw fail('Too many AI requests in a minute. Wait a moment and try again.', 429)
  if (enforce && kind === 'ask_ai') refuseAskAi(plan, counts, units)
  if (enforce && kind === 'rewrite' && plan === 'free') throw fail(NO_PLAN_AI_MESSAGE, 403)
  if (enforce && kind === 'rewrite' && counts.rewritesToday >= SAFETY_PER_DAY.rewrites) {
    throw fail(`You've reached today's limit of ${SAFETY_PER_DAY.rewrites} rewrites. ${SAFETY_NOTE}`, 429)
  }
  const price = kind === 'ask_ai' ? askAiCredits(units) : rewriteCredits(counts.rewritesThisMonth)

  let hold: Hold | null = null
  if (enforce && price > 0) hold = await charge(userId, { amount: price, refType: kind, refId: videoId ?? undefined })
  const [row] = await sql<{ id: string }[]>`INSERT INTO ai_actions (user_id, kind, video_id, credits, units) VALUES (${userId}, ${kind}, ${videoId}, ${hold ? price : 0}, ${units}) RETURNING id`
  return {
    credits: hold ? price : 0,
    done: async () => { if (hold) await settle(hold.id) },
    fail: async () => {
      await sql`DELETE FROM ai_actions WHERE id = ${row.id}`
      if (hold) await release(hold.id)
    },
  }
}

// ── What each Gemini call cost ────────────────────────────────────────────────

/**
 * US dollars per million tokens (input, output; thinking is billed as output). From Google's
 * price list as we understood it; check before relying on the totals. A model not listed is
 * recorded with its tokens and no price.
 */
export const AI_PRICES: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
  // (the key's default model, and Vertex's with VERTEX_MODEL on the shortcutapp.in project: 2.5 Flash's price, gemini.ts)
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
}

/**
 * Priority PayGo (gemini.ts: a Vertex answer served at priority, model "<model>:priority") costs more
 * per token: 1.8x until the real price is known (VERTEX_PRIORITY_PRICE_FACTOR sets it), as in the worker
 */
const PRIORITY_FACTOR = Number(process.env.VERTEX_PRIORITY_PRICE_FACTOR) > 0 ? Number(process.env.VERTEX_PRIORITY_PRICE_FACTOR) : 1.8

/** The cost in millionths of a dollar, or null for a model with no price listed */
export function costMicroUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const priority = model.endsWith(':priority')
  const price = AI_PRICES[priority ? model.slice(0, -':priority'.length) : model]
  return price ? Math.round((inputTokens * price.input + outputTokens * price.output) * (priority ? PRIORITY_FACTOR : 1)) : null
}

export async function recordAiUsage(u: { userId?: string | null; videoId?: string | null; purpose: string; model: string; inputTokens: number; outputTokens: number; via?: 'key' | 'vertex' }): Promise<void> {
  await ensureAiUsageSchema()
  const cost = costMicroUsd(u.model, u.inputTokens, u.outputTokens)
  await sql`
    INSERT INTO ai_usage (user_id, video_id, purpose, model, input_tokens, output_tokens, cost_micro_usd, via)
    VALUES (${u.userId ?? null}, ${u.videoId ?? null}, ${u.purpose}, ${u.model}, ${u.inputTokens}, ${u.outputTokens}, ${cost}, ${u.via ?? null})`
}

/**
 * The Gemini key said its prepaid credits are gone (lib/gemini.ts onKeyCreditsEmpty, set up in
 * instrumentation.ts): one row in gemini_key_events, at most every 5 minutes per copy of the site.
 * The admin's Gemini credits page turns red and emails the admins. (The worker does the same:
 * shortcut-b lib/aiUsage.ts.)
 */
let lastEmptyAt = 0
export function keyCreditsEmptyRecorder(source: string) {
  return (message: string) => {
    if (Date.now() - lastEmptyAt < 5 * 60_000) return
    lastEmptyAt = Date.now()
    ensureAiUsageSchema()
      .then(() => sql`INSERT INTO gemini_key_events (kind, source, message) VALUES ('credits_empty', ${source}, ${message})`)
      .catch(e => console.warn('[gemini] credits-empty not recorded:', e instanceof Error ? e.message : e))
  }
}
