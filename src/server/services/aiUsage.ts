import sql from '@/lib/db'
import { creditsMode } from '@/lib/credits'
import {
  aiLimitsFor, allowanceSince, videoClipCap, extraSearchCredits, istDayStart, rewriteCredits,
  askAiCredits, AI_REQUESTS_PER_MINUTE, EXTRA_CLIP_CREDITS,
} from '@/lib/aiLimits'
import { charge, release, settle, type Hold } from './credits'
import { getUserPlan } from './quota'

// Keeping AI cost bounded (lib/aiLimits.ts has the rules, plans.ts the numbers):
//   - Moments found once per video are saved (video_moments): "Make more clips" and Best moments
//     pick from them instead of asking Gemini again. A fresh search is what costs, so it is counted
//     per video (moment_searches): included per plan, then paid in credits.
//   - Clips made per day and per video are counted from the clips themselves.
//   - Ask AI and hook/title rewrites have a monthly allowance (ai_actions), then credits, with a
//     daily cap and a per-minute speed limit on top.
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
  clipsPerDay: number; clipsToday: number; dayLeft: number
  /** AI clips included a month; past them each clip costs credits (EXTRA_CLIP_CREDITS) */
  clipsPerMonth: number; clipsThisMonth: number; monthLeft: number; extraClipCredits: number
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
  const [month] = await sql<{ n: string }[]>`
    SELECT COALESCE(SUM(${runClips}), 0) AS n FROM ai_edit_jobs j JOIN videos v ON v.id = j.video_id
    WHERE v.user_id = ${userId} AND j.created_at >= ${allowanceSince(planKey)}`
  const [forVideo] = await sql<{ n: string }[]>`SELECT COALESCE(SUM(${runClips}), 0) AS n FROM ai_edit_jobs j WHERE j.video_id = ${videoId}`
  const [searches] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM moment_searches s LEFT JOIN ai_edit_jobs j ON j.id = s.ai_edit_job_id
    WHERE s.video_id = ${videoId} AND (s.ai_edit_job_id IS NULL OR j.status IS DISTINCT FROM 'failed')`
  const clipsToday = Number(today.n), videoClips = Number(forVideo.n), clipsThisMonth = Number(month.n)
  const videoCap = videoClipCap(video.duration_ms)
  return {
    perRun: limits.clipsPerRun,
    clipsPerDay: limits.clipsPerDay, clipsToday, dayLeft: Math.max(0, limits.clipsPerDay - clipsToday),
    clipsPerMonth: limits.clipsPerMonth, clipsThisMonth, monthLeft: Math.max(0, limits.clipsPerMonth - clipsThisMonth),
    extraClipCredits: EXTRA_CLIP_CREDITS,
    videoCap, videoClips, videoLeft: Math.max(0, videoCap - videoClips), durationMs: video.duration_ms,
    savedLeft: (await unusedMoments(videoId)).length,
    searchesIncluded: limits.searchesPerVideo, searchesUsed: searches.n,
    nextSearchCredits: searches.n < limits.searchesPerVideo ? 0 : extraSearchCredits(video.duration_ms),
  }
}

// ── Ask AI and rewrites ───────────────────────────────────────────────────────

export type AiActionKind = 'ask_ai' | 'rewrite'

export async function aiActionCounts(userId: string): Promise<{ askAiThisMonth: number; askAiToday: number; rewritesThisMonth: number; lastMinute: number }> {
  await ensureAiUsageSchema()
  const since = allowanceSince(await getUserPlan(userId))
  const [r] = await sql<{ am: number; ad: number; rm: number; lm: number }[]>`
    SELECT
      COALESCE(sum(units) FILTER (WHERE kind = 'ask_ai' AND created_at >= ${since}), 0)::int AS am,
      COALESCE(sum(units) FILTER (WHERE kind = 'ask_ai' AND created_at >= ${istDayStart()}), 0)::int AS ad,
      count(*) FILTER (WHERE kind = 'rewrite' AND created_at >= ${since})::int AS rm,
      count(*) FILTER (WHERE created_at >= now() - interval '1 minute')::int AS lm
    FROM ai_actions WHERE user_id = ${userId}`
  return { askAiThisMonth: r.am, askAiToday: r.ad, rewritesThisMonth: r.rm, lastMinute: r.lm }
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
 * Starts one Ask AI search or rewrite (`units`: what it counts as, aiLimits askAiUnits): checks the speed limit and daily cap, counts it against
 * the month's allowance, and past the allowance takes its credits (402 if there are not enough).
 * Call done() when the AI answered, fail() when it did not.
 */
export async function beginAiAction(userId: string, kind: AiActionKind, videoId: string | null = null, units = 1): Promise<AiActionHandle> {
  const mode = creditsMode()
  const noop: AiActionHandle = { credits: 0, done: async () => {}, fail: async () => {} }
  if (mode === 'off') return noop
  await ensureAiUsageSchema()
  const limits = aiLimitsFor(await getUserPlan(userId))
  const counts = await aiActionCounts(userId)
  const enforce = mode === 'on'
  if (enforce && counts.lastMinute >= AI_REQUESTS_PER_MINUTE) throw fail('Too many AI requests in a minute. Wait a moment and try again.', 429)
  if (enforce && kind === 'ask_ai' && counts.askAiToday >= limits.askAiPerDay) {
    throw fail(`You've used today's ${limits.askAiPerDay} Ask AI searches. More tomorrow.`, 429)
  }
  let price = 0
  if (kind === 'ask_ai') price = askAiCredits(counts.askAiThisMonth, limits.askAiPerMonth, units)
  if (kind === 'rewrite' && counts.rewritesThisMonth >= limits.rewritesPerMonth) price = rewriteCredits(counts.rewritesThisMonth - limits.rewritesPerMonth)

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
}

export async function recordAiUsage(u: { userId?: string | null; videoId?: string | null; purpose: string; model: string; inputTokens: number; outputTokens: number }): Promise<void> {
  await ensureAiUsageSchema()
  const price = AI_PRICES[u.model]
  const cost = price ? Math.round(u.inputTokens * price.input + u.outputTokens * price.output) : null
  await sql`
    INSERT INTO ai_usage (user_id, video_id, purpose, model, input_tokens, output_tokens, cost_micro_usd)
    VALUES (${u.userId ?? null}, ${u.videoId ?? null}, ${u.purpose}, ${u.model}, ${u.inputTokens}, ${u.outputTokens}, ${cost})`
}
