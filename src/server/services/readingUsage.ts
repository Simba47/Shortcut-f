import type postgres from 'postgres'
import sql from '@/lib/db'
import { creditsMode, PLAN_CREDIT_DAYS, READING_CREDITS, readingCredits } from '@/lib/credits'
import { allowanceSince, istDayStart, readingQuote, safetyFor, SAFETY_NOTE } from '@/lib/aiLimits'
import { PLANS } from '@/lib/plans'
import { balance, charge, ensureCreditsSchema, ensureFreeGrant, grant, settle } from './credits'
import { getUserPlan, NO_PLAN_MESSAGE } from './quota'

// Every video read, and what it was paid. Our transcriber reads a video at upload, whatever is done with it
// after, so it is counted and paid for there (lib/credits.ts readingCredits) and outlives the video: deleting
// one gives nothing back. Since 2026-11-21 (plans v2) credits are the only limit: no monthly hours or uploads.
// What stays: the Trial's 2 uploads (plans.ts uploadsLimit, its whole life) and the day's safety limit on
// minutes read (aiLimits SAFETY_PER_DAY). A video that fails gives everything back (refundFailedReadings). The
// same file uploaded again after its video was deleted, in the same month, is not counted again (againOf).
// Like credits, all of it follows CREDITS_MODE: off = nothing counted or refused; shadow = counted, never
// refused or charged; on = enforced.

let ready: Promise<void> | null = null
function ensureSchema(): Promise<void> {
  ready ??= (async () => {
    await ensureCreditsSchema()
    await sql`
      CREATE TABLE IF NOT EXISTS reading_usage (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        video_id UUID NOT NULL UNIQUE,
        duration_ms BIGINT,
        credits INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`CREATE INDEX IF NOT EXISTS reading_usage_user_idx ON reading_usage (user_id, created_at DESC)`
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS reading_limit_ms BIGINT`
    // The file's size (bytes) and, for an upload of a file already counted, the video it is again (againOf)
    await sql`ALTER TABLE reading_usage ADD COLUMN IF NOT EXISTS file_size BIGINT`
    await sql`ALTER TABLE reading_usage ADD COLUMN IF NOT EXISTS same_as UUID`
  })().catch(e => { ready = null; throw e })
  return ready
}

const minutes = (ms: number) => Math.ceil(ms / 60_000)
const fail = (message: string, status: number) => Object.assign(new Error(message), { status, expose: true })

/** What this user has used: uploads and length read since the month began (the Trial: ever), and length read today (India time). Lengths the worker has found since are counted, and paid for, first (credits.ts sweep does this too, so the balance is current). */
export async function readingUse(userId: string): Promise<{ uploads: number; usedMs: number; todayMs: number }> {
  await payFoundReadings(userId)
  const since = allowanceSince(await getUserPlan(userId))
  const [r] = await sql<{ uploads: number; used: string; today: string }[]>`
    SELECT count(*) FILTER (WHERE same_as IS NULL AND created_at >= ${since})::int AS uploads,
      COALESCE(SUM(duration_ms) FILTER (WHERE created_at >= ${since}), 0) AS used,
      COALESCE(SUM(duration_ms) FILTER (WHERE created_at >= ${istDayStart()}), 0) AS today
    FROM reading_usage WHERE user_id = ${userId}`
  return { uploads: r.uploads, usedMs: Number(r.used), todayMs: Number(r.today) }
}

/** Videos whose length the worker has found since: counted and paid for now (credits.ts sweep, on every look at the balance) */
export async function payFoundReadings(userId: string): Promise<void> {
  await ensureSchema()
  const found = await sql<{ id: string; video_id: string; duration_ms: number }[]>`
    SELECT r.id, r.video_id, v.duration_ms FROM reading_usage r JOIN videos v ON v.id = r.video_id
    WHERE r.user_id = ${userId} AND r.duration_ms IS NULL AND v.duration_ms IS NOT NULL ORDER BY r.id`
  if (!found.length) return
  for (const row of found) {
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`reading:${userId}`}))`
      const [taken] = await tx`UPDATE reading_usage SET duration_ms = ${row.duration_ms} WHERE id = ${row.id} AND duration_ms IS NULL RETURNING id`
      if (!taken) return
      const credits = readingCredits(Number(row.duration_ms))
      // The video is already being read: if this cannot be paid, it stays, and what is used up stops the next upload
      if (credits > 0) await chargeReading(userId, row.video_id, row.id, credits, tx).catch(e => { if (e?.status !== 402) throw e })
    })
  }
}

async function chargeReading(userId: string, videoId: string, rowId: string, credits: number, tx: postgres.TransactionSql) {
  const hold = await charge(userId, { amount: credits, refType: 'reading', refId: videoId }, tx)
  if (hold) await settle(hold.id, tx)
  await tx`UPDATE reading_usage SET credits = ${credits} WHERE id = ${rowId}`
}

/** The price of uploading a video this long, for asking before the upload starts (a file uploaded again after its video was deleted: nothing, againOf) */
export async function readingPrice(userId: string, durationMs: number | null | undefined, fileSize?: number | null) {
  const planKey = await getUserPlan(userId)
  const plan = PLANS[planKey]
  const mode = creditsMode()
  if (mode === 'off') return { on: false as const }
  const use = await readingUse(userId)
  const again = await againOf(userId, durationMs, fileSize, planKey)
  const quote = again ? { ...readingQuote(plan, use, 0), credits: 0, overMs: 0 } : readingQuote(plan, use, durationMs)
  await ensureFreeGrant(userId)
  return { on: true as const, ...quote, balance: (await balance(userId)).balance, durationMs: durationMs ?? null }
}

/**
 * A video that failed (a link that would not download, a reading that could not finish): its credits
 * come back, and it no longer counts against the hours or uploads. Once: its row goes.
 */
export async function refundFailedReadings(userId: string): Promise<void> {
  await ensureSchema()
  const failed = await sql<{ id: string; video_id: string; credits: number }[]>`
    SELECT r.id, r.video_id, r.credits FROM reading_usage r JOIN videos v ON v.id = r.video_id
    WHERE r.user_id = ${userId} AND v.status = 'failed'`
  for (const row of failed) {
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`reading:${userId}`}))`
      const [gone] = await tx`DELETE FROM reading_usage WHERE id = ${row.id} RETURNING id`
      if (!gone || row.credits <= 0) return
      await grant(userId, { kind: 'refund', amount: row.credits, expiresAt: new Date(Date.now() + PLAN_CREDIT_DAYS * 86_400_000), sourceRef: `reading:${row.video_id}` }, tx)
    })
  }
}

/** Lengths within this are one file's (the browser and the worker read a length a little differently) */
const SAME_LENGTH_MS = 1_000

/**
 * The reading this file was already counted as (user, 2026-11-17: a 3-hour video uploaded, deleted and
 * uploaded again was counted twice, 364 of the month's 840 minutes): one this month (the Trial: ever) of
 * a file of the same size in bytes and length, whose video has been deleted, and not already taken by
 * another upload — so each deleted video gives one upload again, never copies side by side. Null when
 * there is none, or the size or length isn't known (a link).
 */
async function againOf(userId: string, durationMs: number | null | undefined, fileSize: number | null | undefined,
  plan: string, db: postgres.Sql | postgres.TransactionSql = sql): Promise<{ video_id: string } | null> {
  if (durationMs == null || !(Number(fileSize) > 0)) return null
  await ensureSchema()
  const [row] = await db<{ video_id: string }[]>`
    SELECT r.video_id FROM reading_usage r
    WHERE r.user_id = ${userId} AND r.created_at >= ${allowanceSince(plan)} AND r.same_as IS NULL
      AND r.file_size = ${Number(fileSize)} AND abs(r.duration_ms - ${Math.round(durationMs)}) <= ${SAME_LENGTH_MS}
      AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.id = r.video_id)
      AND NOT EXISTS (SELECT 1 FROM reading_usage o WHERE o.same_as = r.video_id)
    ORDER BY r.created_at DESC LIMIT 1`
  return row ?? null
}

/** Refuses an upload the plan cannot take: the Trial's uploads used up (403), past today's safety limit (429), whatever credits are left; or without the credits for it (402). A file uploaded again after its video was deleted (againOf) is let through: it was counted already */
export async function checkBeforeUpload(userId: string, durationMs: number | null | undefined, fileSize?: number | null): Promise<void> {
  if (creditsMode() !== 'on') return
  const planKey = await getUserPlan(userId)
  const plan = PLANS[planKey]
  if (planKey === 'free') throw fail(NO_PLAN_MESSAGE, 403)
  if (await againOf(userId, durationMs, fileSize, planKey)) return
  const quote = readingQuote(plan, await readingUse(userId), durationMs)
  if (quote.uploadsLeft != null && quote.uploadsLeft <= 0) {
    throw fail(`You've used the ${plan.uploadsLimit} upload${plan.uploadsLimit === 1 ? '' : 's'} on your ${plan.name}. Choose a plan to upload more.`, 403)
  }
  const day = `${safetyFor(planKey).readingMinutes / 60} hours`
  if (quote.msLeft <= 0) throw fail(`You've uploaded ${day} of video today, the most for one day. ${SAFETY_NOTE}`, 429)
  if (quote.overMs > 0) throw fail(`This video is ${minutes(durationMs ?? 0)} min, and only ${minutes(quote.msLeft)} min of today's ${day} are left. ${SAFETY_NOTE}`, 429)
  await ensureFreeGrant(userId)
  const have = (await balance(userId)).balance
  if (quote.credits > have) throw fail(`Reading this video needs ${quote.credits} credits and you have ${have}. Top up or upgrade to continue.`, 402)
  // No length yet (a link, a file the browser can't read): at least one 10-minute price must be there
  if (durationMs == null && have < READING_CREDITS) throw fail(`Reading a video needs at least ${READING_CREDITS} credits and you have ${have}. Top up or upgrade to continue.`, 402)
}

/**
 * A new video is counted (once, however many times it is asked) and paid for. No length yet (a link,
 * a file the browser can't read): the lower of what today's safety limit and the credits still cover is written on the video, and the worker refuses it if it turns out longer, before reading it
 * (chai-cut-backend lib/readingLimit.ts); it is charged when the length is found (readingUse).
 */
export async function recordReading(userId: string, videoId: string, durationMs: number | null | undefined, fileSize?: number | null): Promise<void> {
  if (creditsMode() === 'off') return
  await ensureSchema()
  const plan = await getUserPlan(userId)
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`reading:${userId}`}))`
    const size = Number(fileSize) > 0 ? Number(fileSize) : null
    // The same file again after its video was deleted: written down (so it is taken once), not counted or charged
    const again = await againOf(userId, durationMs, size, plan, tx)
    if (again) {
      await tx`
        INSERT INTO reading_usage (user_id, video_id, duration_ms, file_size, same_as) VALUES (${userId}, ${videoId}, 0, ${size}, ${again.video_id})
        ON CONFLICT (video_id) DO NOTHING`
      return
    }
    const [u] = await tx<{ today: string }[]>`
      SELECT COALESCE(SUM(duration_ms), 0) AS today FROM reading_usage
      WHERE user_id = ${userId} AND created_at >= ${istDayStart()}`
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO reading_usage (user_id, video_id, duration_ms, file_size) VALUES (${userId}, ${videoId}, ${durationMs ?? null}, ${size})
      ON CONFLICT (video_id) DO NOTHING RETURNING id`
    if (!row) return
    // (uploads don't matter here: checkBeforeUpload refused already)
    const { credits, msLeft } = readingQuote(PLANS[plan], { uploads: 0, todayMs: Number(u.today) }, durationMs)
    if (credits > 0) await chargeReading(userId, videoId, row.id, credits, tx)
    if (durationMs == null && creditsMode() === 'on') {
      const bought = Math.floor((await balance(userId, tx)).balance / READING_CREDITS) * 10 * 60_000
      await tx`UPDATE videos SET reading_limit_ms = ${Math.min(msLeft, bought)} WHERE id = ${videoId}`
    }
  })
}
