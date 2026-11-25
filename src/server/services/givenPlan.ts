import type postgres from 'postgres'
import sql from '@/lib/db'

// Plans given by Shortcut's admin (the Shortcut-Admin-f website writes admin_plan_grants: a plan,
// from when, until when or "until removed"). The site counts a given plan while it is on, and the
// higher of it and the paid plan wins; the paid plan (users.plan, Razorpay) is never changed by it,
// so when a given plan ends the user is simply back on what they pay for.
// KEEP IN STEP with Shortcut-Admin-f/src/server/admin/plans.ts (the same table and "on now" rule).

/** Plans from lowest to highest (the higher one wins) */
const ORDER = ['free', 'trial', 'starter', 'creator', 'agency', 'unlimited']
export function higherPlan(a: string | null | undefined, b: string | null | undefined): string {
  const ra = ORDER.indexOf(a ?? 'free'), rb = ORDER.indexOf(b ?? 'free')
  return (rb > ra ? b : a) ?? 'free'
}

/** Whether the table exists yet (the admin makes it): kept once seen, looked for again each minute until then */
let ready: { ok: boolean; at: number } | null = null
export async function givenPlansReady(): Promise<boolean> {
  if (ready?.ok) return true
  if (ready && Date.now() - ready.at < 60_000) return false
  const [r] = await sql<{ ok: boolean }[]>`SELECT to_regclass('public.admin_plan_grants') IS NOT NULL AS ok`
  ready = { ok: r.ok, at: Date.now() }
  return r.ok
}

/** Forget whether the table exists (tests that make it) */
export function forgetGivenPlansReady(): void { ready = null }

/** The plan Shortcut gave this user that is on right now, or null */
export async function givenPlan(userId: string): Promise<string | null> {
  if (!(await givenPlansReady())) return null
  const [r] = await sql<{ plan: string }[]>`
    SELECT plan FROM admin_plan_grants
    WHERE user_id = ${userId} AND ended_at IS NULL AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
    ORDER BY created_at DESC LIMIT 1`
  return r?.plan ?? null
}

/**
 * SQL for "this user (a users row by its alias) has one of these plans, paid or given" — for the
 * queries that check a kit owner's plan themselves (brandKits.ts, teams). `ready` from givenPlansReady().
 */
export function hasPlanSql(alias: string, plans: readonly string[], ready: boolean): postgres.PendingQuery<postgres.Row[]> {
  const u = sql(alias)
  return ready
    ? sql`(${u}.plan = ANY(${plans as string[]}) OR EXISTS (SELECT 1 FROM admin_plan_grants g WHERE g.user_id = ${u}.id AND g.plan = ANY(${plans as string[]})
        AND g.ended_at IS NULL AND g.starts_at <= now() AND (g.ends_at IS NULL OR g.ends_at > now())))`
    : sql`(${u}.plan = ANY(${plans as string[]}))`
}

/** SQL: the plan given to this user (a users row by its alias) that is on now, or NULL */
export function givenPlanSql(alias: string, ready: boolean): postgres.PendingQuery<postgres.Row[]> {
  const u = sql(alias)
  return ready
    ? sql`(SELECT g.plan FROM admin_plan_grants g WHERE g.user_id = ${u}.id AND g.ended_at IS NULL AND g.starts_at <= now()
        AND (g.ends_at IS NULL OR g.ends_at > now()) ORDER BY g.created_at DESC LIMIT 1)`
    : sql`(NULL::text)`
}
