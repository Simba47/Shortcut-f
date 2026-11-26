import type postgres from 'postgres'
import sql from '@/lib/db'
import { ensureCreditsSchema } from './creditsSchema'
import { PLANS, type PlanKey } from '@/lib/plans'
import { allocate, creditsMode, freeSignupCredits, HOLD_TTL_HOURS, PLAN_CREDIT_DAYS, type GrantKind, type SpendableGrant } from '@/lib/credits'
import { CLIP_CREDITS, CLIP_CREDITS_BEFORE_EXPORT } from '@/lib/aiLimits'

export { ensureCreditsSchema }

/** A plain connection, or the transaction a caller is already inside (so a spend is undone with it) */
type Db = postgres.Sql | postgres.TransactionSql

/** Runs `fn` in a transaction: the caller's own when it passed one, else a new one */
function inTx<T>(db: Db, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return 'savepoint' in db ? fn(db as postgres.TransactionSql) : (db as postgres.Sql).begin(fn) as Promise<T>
}

export interface Hold { id: string; amount: number }

/**
 * Why an export stopped by its person failed (jobs.error, set by export.ts cancelRender). Such a job
 * keeps its credits (user, 2026-11-17: "if he stops, the credit is used"); one that failed by itself
 * gives them back.
 */
export const RENDER_CANCELLED = 'Cancelled by the user'
export interface ReserveArgs {
  amount: number; refType: 'transcribe' | 'caption' | 'render' | 'search' | 'ai_clips' | 'ask_ai' | 'rewrite' | 'subjects' | 'reading'; refId?: string; jobId?: string | null
  /** The action in a few words, for the credit history ("Searched “funny moments”", "5 clips", "2 min") */
  note?: string | null
}

/** Spends whose ref_id is a clip; the rest name a video */
const CLIP_REFS = new Set(['render', 'caption', 'transcribe', 'subjects'])
const VIDEO_REFS = new Set(['reading', 'search', 'ai_clips', 'ask_ai', 'rewrite'])
/** What a spend was for, by name, as it is now: a clip's own title, else its video's; a video's title */
function refName(db: postgres.Sql | postgres.TransactionSql, refType: string, refId: string | null | undefined) {
  if (!refId) return db`NULL::text`
  if (CLIP_REFS.has(refType)) return db`(SELECT COALESCE(NULLIF(c.title, ''), v.title) FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id::text = ${refId})`
  if (VIDEO_REFS.has(refType)) return db`(SELECT title FROM videos WHERE id::text = ${refId})`
  return db`NULL::text`
}
const cleanNote = (n: string | null | undefined) => (n ? n.replace(/\s+/g, ' ').trim().slice(0, 140) || null : null)

type GrantRow = { id: string; remaining: number; expires_at: Date | null; kind: GrantKind; created_at: Date }
const toSpendable = (r: GrantRow): SpendableGrant => ({ id: r.id, remaining: r.remaining, expiresAt: r.expires_at, kind: r.kind, createdAt: r.created_at })

/** One spend at a time per user: a second spend waits for the first, so the balance is never counted twice */
const lockUser = (tx: postgres.TransactionSql, userId: string) => tx`SELECT pg_advisory_xact_lock(hashtext(${`credits:${userId}`}))`

/**
 * Gives credits. `sourceRef` is what makes it happen once: a payment id, a "plan:SUBSCRIPTION:CYCLE"
 * or "free:USER". Returns granted false when that source was already granted.
 */
export async function grant(userId: string, g: { kind: GrantKind; amount: number; expiresAt: Date | null; sourceRef: string }, db: Db = sql): Promise<{ granted: boolean }> {
  await ensureCreditsSchema()
  return inTx(db, async tx => {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO credit_grants (user_id, kind, amount, remaining, expires_at, source_ref)
      VALUES (${userId}, ${g.kind}, ${g.amount}, ${g.amount}, ${g.expiresAt}, ${g.sourceRef})
      ON CONFLICT (source_ref) DO NOTHING RETURNING id`
    if (!row) return { granted: false }
    await tx`INSERT INTO credit_ledger (user_id, delta, reason, grant_id) VALUES (${userId}, ${g.amount}, ${`grant:${g.kind}`}, ${row.id})`
    return { granted: true }
  })
}

/**
 * A paid billing cycle's credits (plans.ts monthlyCredits). `cycleRef` names the cycle, e.g. the
 * Razorpay subscription id and month, so a webhook delivered twice grants once. They last until the
 * end of the next cycle: that is the one-month rollover.
 */
export async function grantPlanCredits(userId: string, plan: PlanKey, cycleRef: string, cycleEnd: Date, db: Db = sql): Promise<{ granted: boolean }> {
  const amount = PLANS[plan].monthlyCredits
  if (amount <= 0) return { granted: false }
  const expiresAt = new Date(cycleEnd.getTime() + 31 * 86_400_000)
  return grant(userId, { kind: 'plan', amount, expiresAt, sourceRef: `plan:${cycleRef}` }, db)
}

/**
 * A paid plan after the Trial pack (user, 2026-11-16): the trial's unused credits are not lost when it
 * ends, they last until `until` (the plan credits' own end). Only ever lengthens their life.
 */
export async function carryTrialCredits(userId: string, until: Date, db: Db = sql): Promise<void> {
  await ensureCreditsSchema()
  await db`
    UPDATE credit_grants SET expires_at = ${until}
    WHERE user_id = ${userId} AND kind = 'trial' AND remaining > 0 AND expires_at > now() AND expires_at < ${until}`
}

/** The one-time free credits, given the first time an account is seen with credits switched on (none since the Trial pack) */
export async function ensureFreeGrant(userId: string): Promise<void> {
  const amount = freeSignupCredits()
  if (creditsMode() === 'off' || amount <= 0) return
  await grant(userId, { kind: 'free', amount, expiresAt: null, sourceRef: `free:${userId}` })
}

/**
 * The balance as the header's pill shows it (useCredits' CreditsInfo), or null with credits off — sent back
 * with whatever just spent or added credits (an upload), so the pill shows the new number at once
 */
export async function creditsNow(userId: string): Promise<{ balance: number; held: number; nextExpiry: { amount: number; at: Date } | null } | null> {
  if (creditsMode() === 'off') return null
  return balance(userId)
}

/**
 * For "450 / 599 credits" on the Buy credits page (user, 2026-11-19): `total` is what the credits still in
 * force came as (every grant not yet expired, used up or not), and `expiries` when the credits left run out,
 * soonest first (by day and kind: a month's plan credits and a top-up show apart).
 */
export async function grantsSummary(userId: string, db: Db = sql): Promise<{ total: number; expiries: { amount: number; at: Date; kind: string }[] }> {
  await ensureCreditsSchema()
  const [row] = await db<{ total: string }[]>`
    SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM credit_grants
    WHERE user_id = ${userId} AND (expires_at IS NULL OR expires_at > now())`
  const rows = await db<{ amount: string; at: Date; kind: string }[]>`
    SELECT SUM(remaining)::bigint AS amount, MIN(expires_at) AS at, kind FROM credit_grants
    WHERE user_id = ${userId} AND remaining > 0 AND expires_at > now()
    GROUP BY kind, date_trunc('day', expires_at) ORDER BY MIN(expires_at) LIMIT 5`
  return { total: Number(row.total), expiries: rows.map(r => ({ amount: Number(r.amount), at: r.at, kind: r.kind })) }
}

/** Credits the user can spend right now (what is held for running jobs is already taken out) */
export async function balance(userId: string, db: Db = sql): Promise<{ balance: number; held: number; nextExpiry: { amount: number; at: Date } | null }> {
  await ensureCreditsSchema()
  const [row] = await db<{ balance: string }[]>`
    SELECT COALESCE(SUM(remaining), 0)::bigint AS balance FROM credit_grants
    WHERE user_id = ${userId} AND remaining > 0 AND (expires_at IS NULL OR expires_at > now())`
  const [held] = await db<{ held: string }[]>`SELECT COALESCE(SUM(amount), 0)::bigint AS held FROM credit_holds WHERE user_id = ${userId} AND status = 'held' AND NOT shadow`
  const [next] = await db<{ remaining: number; expires_at: Date }[]>`
    SELECT remaining, expires_at FROM credit_grants
    WHERE user_id = ${userId} AND remaining > 0 AND expires_at > now() ORDER BY expires_at LIMIT 1`
  return { balance: Number(row.balance), held: Number(held.held), nextExpiry: next ? { amount: next.remaining, at: next.expires_at } : null }
}

/**
 * Sets credits aside for a job. null when credits are off. In shadow mode the spend is written to
 * the ledger and nothing is taken or refused. When it is on and the balance is short it throws a
 * 402 carrying what was needed and what there is. Pass `tx` to make the hold part of the caller's
 * transaction (a job that cannot be queued then leaves no hold behind).
 */
export async function reserve(userId: string, a: ReserveArgs, db: Db = sql): Promise<Hold | null> {
  const mode = creditsMode()
  if (mode === 'off' || a.amount <= 0) return null
  await ensureCreditsSchema()
  return inTx(db, async tx => {
    if (mode === 'shadow') {
      const [hold] = await tx<{ id: string; ref_name: string | null }[]>`
        INSERT INTO credit_holds (user_id, amount, ref_type, ref_id, job_id, status, shadow, settled_at, note, ref_name)
        VALUES (${userId}, ${a.amount}, ${a.refType}, ${a.refId ?? null}, ${a.jobId ?? null}, 'settled', true, now(), ${cleanNote(a.note)}, ${refName(tx, a.refType, a.refId)}) RETURNING id, ref_name`
      await tx`INSERT INTO credit_ledger (user_id, delta, reason, ref_type, ref_id, hold_id, shadow, note, ref_name) VALUES (${userId}, ${-a.amount}, 'spend', ${a.refType}, ${a.refId ?? null}, ${hold.id}, true, ${cleanNote(a.note)}, ${hold.ref_name})`
      return { id: hold.id, amount: a.amount }
    }
    await lockUser(tx, userId)
    const rows = await tx<GrantRow[]>`
      SELECT id, remaining, expires_at, kind, created_at FROM credit_grants
      WHERE user_id = ${userId} AND remaining > 0 AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE`
    const plan = allocate(rows.map(toSpendable), a.amount, new Date())
    if (!plan) {
      const have = rows.reduce((n, r) => n + r.remaining, 0)
      throw Object.assign(new Error(`This needs ${a.amount} credit${a.amount === 1 ? '' : 's'} and you have ${have}. Top up or upgrade to continue.`), { status: 402, expose: true, needed: a.amount, balance: have })
    }
    for (const p of plan) await tx`UPDATE credit_grants SET remaining = remaining - ${p.take} WHERE id = ${p.grantId}`
    const [hold] = await tx<{ id: string; ref_name: string | null }[]>`
      INSERT INTO credit_holds (user_id, amount, ref_type, ref_id, job_id, allocations, note, ref_name)
      VALUES (${userId}, ${a.amount}, ${a.refType}, ${a.refId ?? null}, ${a.jobId ?? null}, ${tx.json(plan as never)}, ${cleanNote(a.note)}, ${refName(tx, a.refType, a.refId)}) RETURNING id, ref_name`
    await tx`INSERT INTO credit_ledger (user_id, delta, reason, ref_type, ref_id, hold_id, note, ref_name) VALUES (${userId}, ${-a.amount}, 'spend', ${a.refType}, ${a.refId ?? null}, ${hold.id}, ${cleanNote(a.note)}, ${hold.ref_name})`
    return { id: hold.id, amount: a.amount }
  })
}

/** What the features call: the free credits first (given once), then the hold */
export async function charge(userId: string, a: ReserveArgs, db: Db = sql): Promise<Hold | null> {
  if (creditsMode() === 'off') return null
  await ensureFreeGrant(userId)
  return reserve(userId, a, db)
}

/** Ties a hold to the job that will report back on it */
export async function linkJob(holdId: string, jobId: string, db: Db = sql): Promise<void> {
  await db`UPDATE credit_holds SET job_id = ${jobId} WHERE id = ${holdId}`
}

/** The job worked: the spend stands */
export async function settle(holdId: string, db: Db = sql): Promise<void> {
  await db`UPDATE credit_holds SET status = 'settled', settled_at = now() WHERE id = ${holdId} AND status = 'held'`
}

/** The job did not work: the credits go back to the grants they came from (once, however often it is called) */
export async function release(holdId: string, db: Db = sql): Promise<void> {
  await inTx(db, async tx => {
    const [hold] = await tx<{ user_id: string; amount: number; allocations: { grantId: string; take: number }[]; ref_type: string; ref_id: string | null; note: string | null; ref_name: string | null }[]>`
      UPDATE credit_holds SET status = 'released', settled_at = now()
      WHERE id = ${holdId} AND status = 'held' RETURNING user_id, amount, allocations, ref_type, ref_id, note, ref_name`
    if (!hold) return
    await lockUser(tx, hold.user_id)
    for (const p of hold.allocations) await tx`UPDATE credit_grants SET remaining = remaining + ${p.take} WHERE id = ${p.grantId}`
    await tx`INSERT INTO credit_ledger (user_id, delta, reason, ref_type, ref_id, hold_id, note, ref_name) VALUES (${hold.user_id}, ${hold.amount}, 'release', ${hold.ref_type}, ${hold.ref_id}, ${holdId}, ${hold.note}, ${hold.ref_name})`
  })
}

/**
 * Closes open holds from what the jobs did: a job that is done settles its hold, one that failed
 * releases it, and a hold with no job (or a job that never finished) is let go after HOLD_TTL_HOURS.
 * Run when a balance is read, so the numbers a user sees are current without a separate timer.
 */
export async function sweep(userId?: string): Promise<void> {
  if (creditsMode() === 'off') return
  await ensureCreditsSchema()
  const open = await sql<{ id: string; user_id: string; amount: number; ref_type: string; status: string | null; job_type: string | null; error: string | null; stale: boolean; run: string | null; run_status: string | null; made: number; very_stale: boolean; export_included: boolean | null }[]>`
    SELECT h.id, h.user_id, h.amount, h.ref_type, j.status, j.type AS job_type, j.error, (h.created_at < now() - make_interval(hours => ${HOLD_TTL_HOURS})) AS stale,
      (h.created_at < now() - interval '7 days') AS very_stale, a.id AS run, a.status AS run_status, a.export_included,
      (SELECT count(*)::int FROM clips c WHERE c.ai_edit_job_id = a.id) AS made
    FROM credit_holds h LEFT JOIN jobs j ON j.id = h.job_id
      LEFT JOIN ai_edit_jobs a ON h.ref_type = 'ai_clips' AND a.id::text = j.payload->>'ai_edit_job_id'
    WHERE h.status = 'held' ${userId ? sql`AND h.user_id = ${userId}` : sql``}`
  // (the holds, and the reading of videos below, are separate tables and separate credits: done side by side,
  // so the balance comes back sooner — user 2026-11-18)
  const holds = (async () => { for (const h of open) {
    if (h.run) {
      // A Make my clips run's clips: paid for what it made. It may wait a long time on "found fewer: make these?", with its first job done
      if (h.run_status === 'done' || h.run_status === 'failed') {
        await settle(h.id)
        // (at the price it was charged at: a run from before the export was included paid 6 a clip)
        const back = h.amount - h.made * (h.export_included ? CLIP_CREDITS : CLIP_CREDITS_BEFORE_EXPORT)
        if (back > 0) await grant(h.user_id, { kind: 'refund', amount: back, expiresAt: new Date(Date.now() + PLAN_CREDIT_DAYS * 86_400_000), sourceRef: `clips:${h.id}` })
      } else if (h.very_stale) await release(h.id)
      continue
    }
    // (an export its person stopped is paid for: only one that failed by itself gives its credits back)
    if (h.status === 'done' || (h.status === 'failed' && h.job_type === 'render' && h.error === RENDER_CANCELLED)) await settle(h.id)
    else if (h.status === 'failed' || h.stale) await release(h.id)
  } })()
  // The reading of videos: a video that failed gives its credits back, then lengths the worker has found since
  // are paid for (in this order: one refund and one charge of the same video must never cross)
  const reading = userId ? (async () => {
    const { payFoundReadings, refundFailedReadings } = await import('./readingUsage')
    await refundFailedReadings(userId)
    await payFoundReadings(userId)
  })() : Promise.resolve()
  await Promise.all([holds, reading])
}

export interface LedgerRow {
  id: string; delta: number; reason: string; refType: string | null; refId: string | null; shadow: boolean; createdAt: Date
  /** The action in words ("Searched “funny moments”"), and the video's or clip's name (credit history, user 2026-11-25) */
  note: string | null; refName: string | null
}
export async function recentLedger(userId: string, limit = 30): Promise<LedgerRow[]> {
  await ensureCreditsSchema()
  // (a row from before names were kept: its video's or clip's name now, when it is still there)
  const rows = await sql<{ id: string; delta: number; reason: string; ref_type: string | null; ref_id: string | null; shadow: boolean; created_at: Date; note: string | null; ref_name: string | null }[]>`
    SELECT l.id, l.delta, l.reason, l.ref_type, l.ref_id, l.shadow, l.created_at, l.note,
      COALESCE(l.ref_name,
        CASE WHEN l.ref_type IN ('render', 'caption', 'transcribe', 'subjects')
          THEN (SELECT COALESCE(NULLIF(c.title, ''), v.title) FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id::text = l.ref_id)
        WHEN l.ref_type IN ('reading', 'search', 'ai_clips', 'ask_ai', 'rewrite')
          THEN (SELECT v.title FROM videos v WHERE v.id::text = l.ref_id) END) AS ref_name
    FROM credit_ledger l WHERE l.user_id = ${userId} ORDER BY l.id DESC LIMIT ${limit}`
  return rows.map(r => ({ id: r.id, delta: r.delta, reason: r.reason, refType: r.ref_type, refId: r.ref_id, shadow: r.shadow, createdAt: r.created_at, note: r.note, refName: r.ref_name }))
}
