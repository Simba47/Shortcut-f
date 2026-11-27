import sql from '@/lib/db'
import { PLANS, isTopPlan, type PlanKey } from '@/lib/plans'
import { creditsMode } from '@/lib/credits'
import { RENEWAL_FAILED_DAYS, type AccountFacts, type FinishedJob } from '@/lib/notices'
import { getUserPlan } from './quota'
import { ensureBillingSchema } from './billingSchema'

// Alerts and notifications (user, 2026-11-26): the facts behind the account banners, the user's work that
// finished since the page last looked, and the credits a job gave back. The words are made in lib/notices.ts.

const READING_STOPPED = 'Stopped by the user'
const RENDER_CANCELLED = 'Cancelled by the user'
const AI_EDIT_CANCELLED = 'Cancelled by you'

/** What the account banners need (GET /api/notices) */
export async function accountFacts(userId: string): Promise<AccountFacts> {
  const plan = await getUserPlan(userId)
  const mode = creditsMode()
  const [credits, trial, renewalFailed, storage] = await Promise.all([
    mode === 'off' ? null : (async () => {
      const { balance, sweep } = await import('./credits')
      // (jobs that finished since the last look settle or give their credits back first, as /api/credits does)
      await sweep(userId).catch(() => {})
      const b = await balance(userId)
      return { balance: b.balance, expiring: b.nextExpiry ? { amount: b.nextExpiry.amount, at: new Date(b.nextExpiry.at).toISOString() } : null }
    })(),
    (async () => {
      const { trialSummary } = await import('./billing')
      const t = await trialSummary(userId)
      return { active: t.active, endsAt: t.endsAt ? t.endsAt.toISOString() : null }
    })().catch(() => ({ active: false, endsAt: null })),
    lastRenewalFailed(userId).catch(() => null),
    (async () => {
      const { storageUsed } = await import('./storage')
      const p = PLANS[plan as PlanKey] ?? PLANS.free
      return p.storageBytes > 0 ? { usedBytes: await storageUsed(userId), totalBytes: p.storageBytes } : null
    })().catch(() => null),
  ])
  return { plan, topPlan: isTopPlan(plan), credits, trial, renewalFailed, storage }
}

/**
 * The paid plan whose renewal Razorpay couldn't charge (subscription.halted: billing.ts endSubscription),
 * within RENEWAL_FAILED_DAYS. A subscription ended because the account was deleted, or cancelled by its
 * person, has no ended_reason and doesn't count.
 */
async function lastRenewalFailed(userId: string): Promise<AccountFacts['renewalFailed']> {
  await ensureBillingSchema()
  const [row] = await sql<{ plan: string; expires_at: Date }[]>`
    SELECT plan, expires_at FROM subscriptions
    WHERE user_id = ${userId} AND razorpay_subscription_id IS NOT NULL AND status = 'ended' AND ended_reason = 'renewal_failed'
      AND expires_at > now() - make_interval(days => ${RENEWAL_FAILED_DAYS})
    ORDER BY created_at DESC LIMIT 1`
  if (!row) return null
  // (a plan bought after it: nothing to tell)
  const [later] = await sql`
    SELECT 1 FROM subscriptions WHERE user_id = ${userId} AND razorpay_subscription_id IS NOT NULL
      AND status IN ('active', 'cancelled') AND created_at > ${row.expires_at} LIMIT 1`
  if (later) return null
  return { planName: PLANS[row.plan as PlanKey]?.name ?? 'paid', at: new Date(row.expires_at).toISOString() }
}

/** How far back a page that comes back can still be told what finished */
const MAX_LOOKBACK_MS = 60 * 60_000

interface ActivityRow {
  id: string; type: 'transcribe' | 'ai_edit' | 'render'; status: string; error: string | null
  video_id: string; video_title: string | null; video_status: string | null
  clip_id: string | null; clip_title: string | null
  run_status: string | null; run_error: string | null; made: number | null
}

/**
 * The user's work: how many of their readings, Make my clips runs and exports are waiting or running, and
 * those that finished after `since` (none when `since` is null: a page just opened is told only what
 * finishes from now on). `cursor` is the database's time, to send as the next `since`.
 * Stopped / cancelled ones are left out (their person knows), as is a reading waiting on its credits OK.
 */
export async function activity(userId: string, since: Date | null): Promise<{ cursor: string; running: number; finished: FinishedJob[] }> {
  const [{ now }] = await sql<{ now: Date }[]>`SELECT now() AS now`
  const from = since ? new Date(Math.max(since.getTime(), now.getTime() - MAX_LOOKBACK_MS)) : now
  const rows = await sql<ActivityRow[]>`
    SELECT j.id, j.type, j.status, j.error,
      v.id AS video_id, v.title AS video_title, v.status AS video_status,
      c.id AS clip_id, c.title AS clip_title,
      a.status AS run_status, a.error AS run_error,
      (SELECT count(*)::int FROM clips m WHERE a.id IS NOT NULL AND m.ai_edit_job_id = a.id) AS made
    FROM jobs j
      LEFT JOIN clips c ON j.type = 'render' AND c.id::text = j.payload->>'clip_id'
      LEFT JOIN ai_edit_jobs a ON j.type = 'ai_edit' AND a.id::text = j.payload->>'ai_edit_job_id'
      JOIN videos v ON v.id::text = COALESCE(c.video_id::text, j.payload->>'video_id')
    WHERE v.user_id = ${userId}
      AND j.type IN ('transcribe', 'ai_edit', 'render')
      -- (a reading is of the whole video: a clip's captions are a transcribe job too)
      AND (j.type <> 'transcribe' OR COALESCE(j.payload->>'clip_id', '') = '')
      AND (j.status IN ('queued', 'processing') OR (j.status IN ('done', 'failed') AND j.updated_at > ${from}))
    ORDER BY j.updated_at`
  let running = 0
  const finished: (FinishedJob & { raw: ActivityRow })[] = []
  for (const r of rows) {
    // (a job at work is 'processing' — the worker's word, queue.ts; 'running' is ai_edit_jobs')
    if (r.status === 'queued' || r.status === 'processing') { running++; continue }
    if (!since) continue
    if (r.type === 'transcribe') {
      if (r.error === READING_STOPPED) continue
      const ok = r.status === 'done' && r.video_status === 'ready'
      // (done but not ready: waiting on the person, e.g. a Drive import's credits OK; or still going on)
      if (r.status === 'done' && !ok && r.video_status !== 'failed') continue
      finished.push({ ...base(r), kind: 'reading', ok, raw: r })
    } else if (r.type === 'ai_edit') {
      // (the run's own state: its job can be done while it waits on "found fewer: make these?")
      if (r.run_status !== 'done' && r.run_status !== 'failed') continue
      if (r.run_error === AI_EDIT_CANCELLED) continue
      finished.push({ ...base(r), kind: 'clips', ok: r.run_status === 'done', made: r.made ?? 0, raw: r })
    } else {
      if (r.error === RENDER_CANCELLED || !r.clip_id) continue
      finished.push({ ...base(r), kind: 'export', ok: r.status === 'done', raw: r })
    }
  }
  // What came back for the ones that failed (and the clips a run didn't make): only where credits are on
  if (finished.some(f => !f.ok || f.kind === 'clips') && creditsMode() !== 'off') {
    const { sweep } = await import('./credits')
    await sweep(userId).catch(() => {})
    for (const f of finished) {
      if (f.ok && f.kind !== 'clips') continue
      f.refunded = await refundForJob(f.raw.id, f.kind, f.videoId).catch(() => 0)
    }
  }
  return { cursor: now.toISOString(), running, finished: finished.map(({ raw: _raw, ...f }) => f) }
}

function base(r: ActivityRow): FinishedJob {
  return {
    id: r.id, kind: 'reading', ok: false, videoId: r.video_id, videoTitle: r.video_title,
    clipId: r.clip_id, clipTitle: r.clip_title, made: null, refunded: 0,
  }
}

/** Credits a job gave back: an export's released hold, a run's refund for clips it didn't make, a failed reading's */
async function refundForJob(jobId: string, kind: FinishedJob['kind'], videoId: string): Promise<number> {
  const { ensureCreditsSchema } = await import('./creditsSchema')
  await ensureCreditsSchema()
  if (kind === 'export') {
    const [r] = await sql<{ n: number }[]>`SELECT COALESCE(SUM(amount), 0)::int AS n FROM credit_holds WHERE job_id = ${jobId} AND status = 'released'`
    return r?.n ?? 0
  }
  if (kind === 'clips') {
    const [r] = await sql<{ n: number }[]>`
      SELECT COALESCE(SUM(g.amount), 0)::int AS n FROM credit_holds h JOIN credit_grants g ON g.source_ref = 'clips:' || h.id::text
      WHERE h.job_id = ${jobId}`
    return r?.n ?? 0
  }
  const [r] = await sql<{ n: number }[]>`SELECT COALESCE(SUM(amount), 0)::int AS n FROM credit_grants WHERE source_ref = ${`reading:${videoId}`}`
  return r?.n ?? 0
}

/** The credits a clip's latest export gave back when it failed (the editor's card: "Your 2 credits came back") */
export async function exportRefund(userId: string, clipId: string): Promise<number> {
  if (creditsMode() === 'off') return 0
  const [job] = await sql<{ id: string; status: string; error: string | null }[]>`
    SELECT j.id, j.status, j.error FROM jobs j
      JOIN clips c ON c.id::text = j.payload->>'clip_id' JOIN videos v ON v.id = c.video_id
    WHERE j.type = 'render' AND c.id = ${clipId} AND v.user_id = ${userId}
    ORDER BY j.created_at DESC LIMIT 1`
  if (!job || job.status !== 'failed' || job.error === RENDER_CANCELLED) return 0
  const { sweep } = await import('./credits')
  await sweep(userId).catch(() => {})
  return refundForJob(job.id, 'export', '')
}
