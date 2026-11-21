import sql from '@/lib/db'
import { PLANS, type PlanKey } from '@/lib/plans'
import { canKeep, warnDays } from '@/lib/expiry'
import { getUserPlan } from './quota'

// Videos expire (plans v2, user 2026-11-21): a video, its clips and their exports go a plan's days after the
// upload (Trial 7, Starter and Pro 30: plans.ts retentionDays). On Pro a video can be kept ("★ Keep"): it never
// expires, and still counts in the 30 GB. The rules:
//   - the clock starts at the upload, or on the day expiry was switched on for a video uploaded before it
//     (app_flags 'video_expiry_launch'), so nothing older vanishes the day it starts
//   - Keep taken off (by the user, or by leaving Pro): the video gets at least 7 more days
//   - no plan any more (a plan cancelled and its paid time over, a Trial ended): every video goes 7 days after
//     (users.videos_grace_from), unless it would go sooner anyway; a plan bought again before then gives them back
//     their plan's days
//   - a plan's paid time ends when billing.ts says so (effectivePlan): until then nothing changes
// The card shows it in the video's last days (lib/expiry.ts warnDays: Trial 2, plans 3), and one email lists what
// is about to go. An expired video is deleted like a deleted one (videos.ts deleteVideos: its files too).
// VIDEO_EXPIRY=on|off; not set: on in production, off on a computer (a local copy may point at the real database).

const DAY = 86_400_000
/** Days a video still gets when its Keep is taken off, or after the account has no plan */
export const GRACE_DAYS = 7

export function expiryOn(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.VIDEO_EXPIRY?.trim().toLowerCase()
  if (v === 'on') return true
  if (v === 'off') return false
  return env.NODE_ENV === 'production'
}

let ready: Promise<void> | null = null
export function ensureExpirySchema(): Promise<void> {
  ready ??= (async () => {
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS kept BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS keep_released_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS expiry_warned_at TIMESTAMPTZ`
    await sql`CREATE INDEX IF NOT EXISTS videos_expires_idx ON videos (expires_at) WHERE expires_at IS NOT NULL`
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS videos_grace_from TIMESTAMPTZ`
    await sql`CREATE TABLE IF NOT EXISTS app_flags (key TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now())`
  })().catch(e => { ready = null; throw e })
  return ready
}

/** The dashboard asks often (every few seconds while a video is processing): an account is brought up to date at most once a minute from there */
const REFRESH_EVERY_MS = 60_000
const refreshedAt = new Map<string, number>()

/** The day expiry was first switched on here: older videos count from it (written the first time, then kept) */
let launchKnown: Date | null = null
async function launchAt(): Promise<Date> {
  if (launchKnown) return launchKnown
  await sql`INSERT INTO app_flags (key) VALUES ('video_expiry_launch') ON CONFLICT (key) DO NOTHING`
  const [r] = await sql<{ at: Date }[]>`SELECT at FROM app_flags WHERE key = 'video_expiry_launch'`
  launchKnown = r.at
  return r.at
}
/** For the tests, which move the launch day: what this copy remembers is forgotten */
export function forgetExpiryCaches(): void { launchKnown = null; refreshedAt.clear() }



/**
 * Brings one account's videos' dates up to its plan now. Cheap (a few updates): run on every dashboard visit and by
 * the hourly sweep. Returns the plan it used. Nothing with expiry off.
 */
export async function refreshExpiry(userId: string, opts: { soon?: boolean } = {}): Promise<PlanKey | null> {
  if (!expiryOn()) return null
  if (opts.soon) {
    const at = refreshedAt.get(userId)
    if (at && Date.now() - at < REFRESH_EVERY_MS) return null
  }
  refreshedAt.set(userId, Date.now())
  await ensureExpirySchema()
  const launch = await launchAt()
  const plan = await getUserPlan(userId)
  const grace = `${GRACE_DAYS} days`
  if (plan === 'free') {
    // No plan: everything goes GRACE_DAYS after it ended (or sooner, as it would have), Keep or not
    await sql`UPDATE users SET videos_grace_from = now() WHERE id = ${userId} AND videos_grace_from IS NULL`
    const [u] = await sql<{ from: Date }[]>`SELECT videos_grace_from AS from FROM users WHERE id = ${userId}`
    if (!u) return plan
    const end = sql`${u.from}::timestamptz + ${grace}::interval`
    // (only rows that change are written)
    await sql`
      UPDATE videos SET
        keep_released_at = CASE WHEN kept THEN now() ELSE keep_released_at END,
        kept = false,
        expires_at = LEAST(COALESCE(expires_at, ${end}), ${end})
      WHERE user_id = ${userId} AND role IS DISTINCT FROM 'asset'
        AND (kept OR expires_at IS NULL OR expires_at > ${end})`
  } else {
    await sql`UPDATE users SET videos_grace_from = NULL WHERE id = ${userId} AND videos_grace_from IS NOT NULL`
    // Kept, on a plan that can't keep (left Pro): the Keep goes, with GRACE_DAYS more
    if (!canKeep(plan)) {
      await sql`UPDATE videos SET kept = false, keep_released_at = now() WHERE user_id = ${userId} AND kept`
    }
    const days = `${PLANS[plan].retentionDays} days`
    const due = sql`CASE WHEN kept THEN NULL ELSE GREATEST(
          GREATEST(created_at, ${launch}::timestamptz) + ${days}::interval,
          COALESCE(keep_released_at + ${grace}::interval, '-infinity'::timestamptz)) END`
    // (only rows whose date changes are written)
    await sql`
      UPDATE videos SET expires_at = ${due}
      WHERE user_id = ${userId} AND role IS DISTINCT FROM 'asset' AND expires_at IS DISTINCT FROM ${due}`
  }
  // A date moved later (a plan bought, a Keep): warned again when it comes near
  await sql`
    UPDATE videos SET expiry_warned_at = NULL
    WHERE user_id = ${userId} AND expiry_warned_at IS NOT NULL
      AND (expires_at IS NULL OR expires_at > now() + ${`${warnDays(plan)} days`}::interval)`
  return plan
}

/** "★ Keep" on Pro: the video never expires (it still counts in the storage). Off: it gets at least GRACE_DAYS more. */
export async function setKept(userId: string, videoId: string, keep: boolean): Promise<{ kept: boolean; expires_at: Date | null }> {
  if (!expiryOn()) throw Object.assign(new Error('Videos don’t expire here, so there is nothing to keep.'), { status: 409, expose: true })
  await ensureExpirySchema()
  const plan = await getUserPlan(userId)
  if (keep && !canKeep(plan)) throw Object.assign(new Error('Keeping a video for good comes with the Pro plan.'), { status: 403, expose: true })
  const [v] = await sql<{ id: string }[]>`
    UPDATE videos SET kept = ${keep}, keep_released_at = CASE WHEN ${keep} THEN NULL WHEN kept THEN now() ELSE keep_released_at END
    WHERE id = ${videoId} AND user_id = ${userId} AND role IS DISTINCT FROM 'asset' RETURNING id`
  if (!v) throw Object.assign(new Error('Not found'), { status: 404 })
  await refreshExpiry(userId)
  const [row] = await sql<{ kept: boolean; expires_at: Date | null }[]>`SELECT kept, expires_at FROM videos WHERE id = ${videoId}`
  return row
}

export interface ExpiringVideo { id: string; title: string | null; expiresAt: Date; clips: number }
export type ExpiryNotice = (to: { email: string; name: string | null; plan: PlanKey }, videos: ExpiringVideo[]) => Promise<void>

/**
 * The hourly sweep (one copy of the site at a time: a lease in app_flags): every account's dates brought up to
 * its plan, the emails for what goes in its last days, then what has expired deleted with its files.
 * `notify`: sends the email (mailer.ts); `remove`: deletes videos (videos.ts deleteVideos). Both passed in, for the tests.
 */
export async function sweepExpiry(deps: {
  notify: ExpiryNotice
  remove: (userId: string, ids: string[]) => Promise<unknown>
  /** Run even if another copy swept within the hour (the tests) */
  force?: boolean
}): Promise<{ users: number; warned: number; deleted: number } | null> {
  if (!expiryOn()) return null
  await ensureExpirySchema()
  if (!deps.force) {
    await sql`INSERT INTO app_flags (key, at) VALUES ('video_expiry_sweep', now() - interval '1 day') ON CONFLICT (key) DO NOTHING`
    const [lease] = await sql`UPDATE app_flags SET at = now() WHERE key = 'video_expiry_sweep' AND at < now() - interval '50 minutes' RETURNING key`
    if (!lease) return null
  }
  const owners = await sql<{ user_id: string }[]>`SELECT DISTINCT user_id FROM videos WHERE role IS DISTINCT FROM 'asset' AND user_id IS NOT NULL`
  const plans = new Map<string, PlanKey>()
  for (const o of owners) {
    try { const p = await refreshExpiry(o.user_id); if (p) plans.set(o.user_id, p) } catch (e) { console.warn('[expiry] could not bring up to date', o.user_id, e instanceof Error ? e.message : e) }
  }

  // The emails: each account once for what has come into its last days and hasn't been told
  let warned = 0
  const soon = await sql<{ id: string; user_id: string; title: string | null; expires_at: Date; clips: number; email: string | null; name: string | null }[]>`
    SELECT v.id, v.user_id, v.title, v.expires_at, (SELECT count(*)::int FROM clips c WHERE c.video_id = v.id) AS clips, u.email, u.name
    FROM videos v JOIN users u ON u.id = v.user_id
    WHERE v.expires_at IS NOT NULL AND v.expiry_warned_at IS NULL AND v.expires_at > now()
      AND v.expires_at <= now() + interval '3 days' AND v.role IS DISTINCT FROM 'asset'
    ORDER BY v.user_id, v.expires_at`
  const byUser = new Map<string, Array<(typeof soon)[number]>>()
  for (const r of soon) {
    const plan = plans.get(r.user_id) ?? 'free'
    if (r.expires_at.getTime() - Date.now() > warnDays(plan) * DAY) continue
    byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r])
  }
  for (const [userId, rows] of byUser) {
    const email = rows[0].email
    if (!email) continue
    try {
      await deps.notify({ email, name: rows[0].name, plan: plans.get(userId) ?? 'free' }, rows.map(r => ({ id: r.id, title: r.title, expiresAt: r.expires_at, clips: r.clips })))
      await sql`UPDATE videos SET expiry_warned_at = now() WHERE id = ANY(${rows.map(r => r.id)})`
      warned += rows.length
    } catch (e) {
      console.warn('[expiry] email not sent to', userId, e instanceof Error ? e.message : e)
    }
  }

  // What has expired goes, like a deleted video (its clips, exports and files)
  let deleted = 0
  const gone = await sql<{ id: string; user_id: string }[]>`
    SELECT id, user_id FROM videos WHERE expires_at <= now() AND NOT kept AND role IS DISTINCT FROM 'asset' ORDER BY user_id`
  const goneBy = new Map<string, string[]>()
  for (const g of gone) goneBy.set(g.user_id, [...(goneBy.get(g.user_id) ?? []), g.id])
  for (const [userId, ids] of goneBy) {
    for (let i = 0; i < ids.length; i += 50) {
      try { await deps.remove(userId, ids.slice(i, i + 50)); deleted += Math.min(50, ids.length - i) } catch (e) {
        console.warn('[expiry] could not delete', userId, e instanceof Error ? e.message : e)
      }
    }
  }
  if (warned || deleted) console.log(`[expiry] ${owners.length} account(s) checked; ${warned} video(s) warned, ${deleted} expired and deleted`)
  return { users: owners.length, warned, deleted }
}

/** Started once per copy of the site (instrumentation.ts): the sweep every hour, the first a minute after start */
export function startExpirySweep(deps: Parameters<typeof sweepExpiry>[0]): void {
  if (!expiryOn()) { console.log('[expiry] off (VIDEO_EXPIRY): videos are not expired here'); return }
  const run = () => { sweepExpiry(deps).catch(e => console.warn('[expiry] sweep failed:', e instanceof Error ? e.message : e)) }
  setTimeout(run, 60_000).unref?.()
  setInterval(run, 60 * 60_000).unref?.()
}
