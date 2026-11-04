import type postgres from 'postgres'
import sql from '@/lib/db'
import { ensureCreditsSchema } from './creditsSchema'
import { PLANS, type PlanKey } from '@/lib/plans'
import { allocate, creditsMode, freeSignupCredits, HOLD_TTL_HOURS, type GrantKind, type SpendableGrant } from '@/lib/credits'

export { ensureCreditsSchema }

/** A plain connection, or the transaction a caller is already inside (so a spend is undone with it) */
type Db = postgres.Sql | postgres.TransactionSql

/** Runs `fn` in a transaction: the caller's own when it passed one, else a new one */
function inTx<T>(db: Db, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return 'savepoint' in db ? fn(db as postgres.TransactionSql) : (db as postgres.Sql).begin(fn) as Promise<T>
}

export interface Hold { id: string; amount: number }
export interface ReserveArgs { amount: number; refType: 'transcribe' | 'caption' | 'render' | 'search' | 'ai_clips' | 'ask_ai' | 'rewrite'; refId?: string; jobId?: string | null }

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

/** The one-time free credits, given the first time an account is seen with credits switched on */
export async function ensureFreeGrant(userId: string): Promise<void> {
  const amount = freeSignupCredits()
  if (creditsMode() === 'off' || amount <= 0) return
  await grant(userId, { kind: 'free', amount, expiresAt: null, sourceRef: `free:${userId}` })
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
      const [hold] = await tx<{ id: string }[]>`
        INSERT INTO credit_holds (user_id, amount, ref_type, ref_id, job_id, status, shadow, settled_at)
        VALUES (${userId}, ${a.amount}, ${a.refType}, ${a.refId ?? null}, ${a.jobId ?? null}, 'settled', true, now()) RETURNING id`
      await tx`INSERT INTO credit_ledger (user_id, delta, reason, ref_type, ref_id, hold_id, shadow) VALUES (${userId}, ${-a.amount}, 'spend', ${a.refType}, ${a.refId ?? null}, ${hold.id}, true)`
      return { id: hold.id, amount: a.amount }
    }
    await lockUser(tx, userId)
    const rows = await tx<GrantRow[]>`
      SELECT id, remaining, expires_at, kind, created_at FROM credit_grants
      WHERE user_id = ${userId} AND remaining > 0 AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE`
    const plan = allocate(rows.map(toSpendable), a.amount, new Date())
    if (!plan) {
      const have = rows.reduce((n, r) => n + r.remaining, 0)
      throw Object.assign(new Error(`This needs ${a.amount} credits and you have ${have}. Top up or upgrade to continue.`), { status: 402, expose: true, needed: a.amount, balance: have })
    }
    for (const p of plan) await tx`UPDATE credit_grants SET remaining = remaining - ${p.take} WHERE id = ${p.grantId}`
    const [hold] = await tx<{ id: string }[]>`
      INSERT INTO credit_holds (user_id, amount, ref_type, ref_id, job_id, allocations)
      VALUES (${userId}, ${a.amount}, ${a.refType}, ${a.refId ?? null}, ${a.jobId ?? null}, ${tx.json(plan as never)}) RETURNING id`
    await tx`INSERT INTO credit_ledger (user_id, delta, reason, ref_type, ref_id, hold_id) VALUES (${userId}, ${-a.amount}, 'spend', ${a.refType}, ${a.refId ?? null}, ${hold.id})`
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
    const [hold] = await tx<{ user_id: string; amount: number; allocations: { grantId: string; take: number }[]; ref_type: string; ref_id: string | null }[]>`
      UPDATE credit_holds SET status = 'released', settled_at = now()
      WHERE id = ${holdId} AND status = 'held' RETURNING user_id, amount, allocations, ref_type, ref_id`
    if (!hold) return
    await lockUser(tx, hold.user_id)
    for (const p of hold.allocations) await tx`UPDATE credit_grants SET remaining = remaining + ${p.take} WHERE id = ${p.grantId}`
    await tx`INSERT INTO credit_ledger (user_id, delta, reason, ref_type, ref_id, hold_id) VALUES (${hold.user_id}, ${hold.amount}, 'release', ${hold.ref_type}, ${hold.ref_id}, ${holdId})`
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
  const open = await sql<{ id: string; status: string | null; stale: boolean }[]>`
    SELECT h.id, j.status, (h.created_at < now() - make_interval(hours => ${HOLD_TTL_HOURS})) AS stale
    FROM credit_holds h LEFT JOIN jobs j ON j.id = h.job_id
    WHERE h.status = 'held' ${userId ? sql`AND h.user_id = ${userId}` : sql``}`
  for (const h of open) {
    if (h.status === 'done') await settle(h.id)
    else if (h.status === 'failed' || h.stale) await release(h.id)
  }
}

export interface LedgerRow { id: string; delta: number; reason: string; refType: string | null; refId: string | null; shadow: boolean; createdAt: Date }
export async function recentLedger(userId: string, limit = 30): Promise<LedgerRow[]> {
  await ensureCreditsSchema()
  const rows = await sql<{ id: string; delta: number; reason: string; ref_type: string | null; ref_id: string | null; shadow: boolean; created_at: Date }[]>`
    SELECT id, delta, reason, ref_type, ref_id, shadow, created_at FROM credit_ledger WHERE user_id = ${userId} ORDER BY id DESC LIMIT ${limit}`
  return rows.map(r => ({ id: r.id, delta: r.delta, reason: r.reason, refType: r.ref_type, refId: r.ref_id, shadow: r.shadow, createdAt: r.created_at }))
}
