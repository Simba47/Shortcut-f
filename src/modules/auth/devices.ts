import crypto from 'node:crypto'
import sql from '@/lib/db'
import { PLANS, type PlanKey } from '@/lib/plans'

// ── Devices signed in at once ─────────────────────────────────────────────────
// (plans v2, user 2026-11-21: Trial 1, Starter 2, Pro 3 — plans.ts `devices`; it was one device for everyone.)
// Each sign-in gets a new id, kept in that device's session (its JWT cookie, token.sid) and as a row of
// user_sessions. When a sign-in takes the account past its plan's number, the device used least recently is
// signed out (its row ended): auth.ts marks its session `replaced`, the site sends it to /api/auth/signed-out,
// and the sign-in page says why. Signing out ends the row, so the place is free again. A plan with fewer
// devices (leaving Pro) is applied as the devices are next used.
// users.session_id still holds the latest sign-in's id: Shortcut's admin signs a person out everywhere (and on
// a block) by writing a new one there (Shortcut-Admin-f actions.ts); an id that is none of the account's
// sign-ins ends them all. Sessions from before ids were kept (no sid) count until the account next signs in.

/** How long a device's "still signed in" is trusted: a signed-out device notices within this (plus its next request) */
const CHECK_TTL_MS = 10_000
/** A device's "last used" is written at most this often */
const TOUCH_MS = 10 * 60_000
const checked = new Map<string, number>()
const touched = new Map<string, number>()

export function devicesFor(plan: string | null | undefined): number {
  return (PLANS[plan as PlanKey] ?? PLANS.free).devices
}

let ready: Promise<void> | null = null
export function ensureDevicesSchema(): Promise<void> {
  ready ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        user_agent TEXT,
        ended_at TIMESTAMPTZ,
        end_reason TEXT
      )`
    await sql`CREATE INDEX IF NOT EXISTS user_sessions_live_idx ON user_sessions (user_id, last_seen_at DESC) WHERE ended_at IS NULL`
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS session_id TEXT`
    // The one sign-in each account had under the one-device rule stays signed in. Once only, ever: run again, it
    // would take a sign-out everywhere made by Shortcut's admin since (a new users.session_id) for a sign-in
    await sql`CREATE TABLE IF NOT EXISTS app_flags (key TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now())`
    const [first] = await sql`INSERT INTO app_flags (key) VALUES ('devices_from_one_device') ON CONFLICT (key) DO NOTHING RETURNING key`
    if (first) {
      await sql`
        INSERT INTO user_sessions (id, user_id) SELECT session_id, id FROM users WHERE session_id IS NOT NULL
        ON CONFLICT (id) DO NOTHING`
    }
  })().catch(e => { ready = null; throw e })
  return ready
}

/** Signs out the account's devices past `limit`, the least recently used first (`reason` kept on them) */
async function endExtra(userId: string, limit: number, reason: string): Promise<number> {
  const ended = await sql`
    UPDATE user_sessions SET ended_at = now(), end_reason = ${reason}
    WHERE id IN (
      SELECT id FROM user_sessions WHERE user_id = ${userId} AND ended_at IS NULL
      ORDER BY last_seen_at DESC, created_at DESC OFFSET ${Math.max(1, limit)}
    ) RETURNING id`
  return ended.length
}

/**
 * A new sign-in: its id (undefined when it can't be kept: no rule then). Past the plan's devices, the least
 * recently used other device is signed out.
 */
export async function startSession(userId: string, userAgent?: string | null): Promise<string | undefined> {
  const sid = crypto.randomUUID()
  try {
    await ensureDevicesSchema()
    const { getUserPlan } = await import('@/server/services/quota')
    const plan = await getUserPlan(userId).catch(() => 'free' as PlanKey)
    await sql.begin(async tx => {
      // A sign-out everywhere by Shortcut's admin not yet noticed by every device: applied first, so a quick
      // sign-in after it can't keep the others in
      await tx`
        UPDATE user_sessions SET ended_at = now(), end_reason = 'admin'
        WHERE user_id = ${userId} AND ended_at IS NULL
          AND EXISTS (SELECT 1 FROM users u WHERE u.id = ${userId} AND u.session_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM user_sessions x WHERE x.id = u.session_id))`
      await tx`INSERT INTO user_sessions (id, user_id, user_agent) VALUES (${sid}, ${userId}, ${userAgent?.slice(0, 300) ?? null})`
      await tx`UPDATE users SET session_id = ${sid} WHERE id = ${userId}`
    })
    await endExtra(userId, devicesFor(plan), 'limit')
    checked.set(sid, Date.now()); touched.set(sid, Date.now())
    return sid
  } catch (err) {
    console.error('[auth] Could not record the sign-in:', err instanceof Error ? err.message : err)
    return undefined
  }
}

/** Is this device still signed in? (Yes when the database can't say: a hiccup never signs anyone out) */
export async function isCurrentSession(userId: string, sid: string | undefined): Promise<boolean> {
  if (!sid) return true
  const at = checked.get(sid)
  if (at && Date.now() - at <= CHECK_TTL_MS) return true
  try {
    await ensureDevicesSchema()
    const [r] = await sql<{ latest: string | null; latest_known: boolean; live: boolean | null }[]>`
      SELECT u.session_id AS latest,
        EXISTS (SELECT 1 FROM user_sessions x WHERE x.id = u.session_id) AS latest_known,
        (SELECT s.ended_at IS NULL FROM user_sessions s WHERE s.id = ${sid} AND s.user_id = u.id) AS live
      FROM users u WHERE u.id = ${userId}`
    if (!r) return false   // the account was deleted
    // The account's latest sign-in from before devices were kept (one device each): it becomes a device here
    // (whether or not the once-only copy has run yet)
    if (r.live === null && r.latest === sid) {
      await sql`INSERT INTO user_sessions (id, user_id) VALUES (${sid}, ${userId}) ON CONFLICT (id) DO NOTHING`
      checked.set(sid, Date.now())
      return true
    }
    // Shortcut's admin signed the account out everywhere (a new users.session_id that is no sign-in)
    if (r.latest && !r.latest_known) {
      await sql`UPDATE user_sessions SET ended_at = now(), end_reason = 'admin' WHERE user_id = ${userId} AND ended_at IS NULL`
      await sql`INSERT INTO user_sessions (id, user_id, ended_at, end_reason) VALUES (${r.latest}, ${userId}, now(), 'admin') ON CONFLICT (id) DO NOTHING`
      checked.delete(sid)
      return false
    }
    if (!r.live) { checked.delete(sid); return false }
    // Used now: its "last used" (what decides who goes first), and the plan's number again (it may have gone down)
    if (Date.now() - (touched.get(sid) ?? 0) > TOUCH_MS) {
      touched.set(sid, Date.now())
      await sql`UPDATE user_sessions SET last_seen_at = now() WHERE id = ${sid}`
      const { getUserPlan } = await import('@/server/services/quota')
      const ended = await endExtra(userId, devicesFor(await getUserPlan(userId)), 'plan')
      if (ended) {
        const [me] = await sql<{ live: boolean }[]>`SELECT ended_at IS NULL AS live FROM user_sessions WHERE id = ${sid}`
        if (!me?.live) return false
      }
    }
    checked.set(sid, Date.now())
    return true
  } catch {
    return true
  }
}

/** Signed out on this device: its place is free again */
export async function endSession(sid: string | undefined): Promise<void> {
  if (!sid) return
  checked.delete(sid)
  try {
    await ensureDevicesSchema()
    await sql`UPDATE user_sessions SET ended_at = now(), end_reason = 'signed_out' WHERE id = ${sid} AND ended_at IS NULL`
  } catch (err) {
    console.warn('[auth] Could not record the sign-out:', err instanceof Error ? err.message : err)
  }
}
