import type postgres from 'postgres'
import sql from '@/lib/db'
import { creditsMode, EXTRA_READING_CREDITS } from '@/lib/credits'
import { allowanceSince, readingQuote } from '@/lib/aiLimits'
import { readingLabel } from '@/lib/planFeatures'
import { PLANS } from '@/lib/plans'
import { balance, charge, ensureCreditsSchema, ensureFreeGrant, settle } from './credits'
import { getUserPlan } from './quota'

// The plan's hours of video read and its uploads (plans.ts readingMinutes, uploadsPerMonth). Our
// transcriber reads a video at upload, whatever is done with it after, so the count is made there
// and outlives the video: deleting one gives nothing back (before this, delete and upload again was
// unlimited reading). Past the hours, credits pay for the part over (lib/credits.ts). Like credits,
// all of it follows CREDITS_MODE: off = nothing counted or refused; shadow = counted, never
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
  })().catch(e => { ready = null; throw e })
  return ready
}

const minutes = (ms: number) => Math.ceil(ms / 60_000)
const fail = (message: string, status: number) => Object.assign(new Error(message), { status, expose: true })

/** What this user has used: since the month began (Free: ever). Lengths the worker has found since are counted, and paid for, first. */
export async function readingUse(userId: string): Promise<{ uploads: number; usedMs: number }> {
  await ensureSchema()
  const plan = await getUserPlan(userId)
  const since = allowanceSince(plan)
  const found = await sql<{ id: string; video_id: string; duration_ms: number }[]>`
    SELECT r.id, r.video_id, v.duration_ms FROM reading_usage r JOIN videos v ON v.id = r.video_id
    WHERE r.user_id = ${userId} AND r.duration_ms IS NULL AND v.duration_ms IS NOT NULL ORDER BY r.id`
  for (const row of found) {
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`reading:${userId}`}))`
      const [taken] = await tx`UPDATE reading_usage SET duration_ms = ${row.duration_ms} WHERE id = ${row.id} AND duration_ms IS NULL RETURNING id`
      if (!taken) return
      const [u] = await tx<{ uploads: number; used: string }[]>`
        SELECT count(*)::int AS uploads, COALESCE(SUM(duration_ms), 0) AS used FROM reading_usage
        WHERE user_id = ${userId} AND created_at >= ${since} AND id <> ${row.id}`
      const { credits } = readingQuote(PLANS[plan], { uploads: u.uploads, usedMs: Number(u.used) }, Number(row.duration_ms))
      // The video is already being read: if this cannot be paid, it stays, and what is used up stops the next upload
      if (credits > 0) await chargeOver(userId, row.video_id, row.id, credits, tx).catch(e => { if (e?.status !== 402) throw e })
    })
  }
  const [r] = await sql<{ uploads: number; used: string }[]>`
    SELECT count(*)::int AS uploads, COALESCE(SUM(duration_ms), 0) AS used FROM reading_usage
    WHERE user_id = ${userId} AND created_at >= ${since}`
  return { uploads: r.uploads, usedMs: Number(r.used) }
}

async function chargeOver(userId: string, videoId: string, rowId: string, credits: number, tx: postgres.TransactionSql) {
  const hold = await charge(userId, { amount: credits, refType: 'reading', refId: videoId }, tx)
  if (hold) await settle(hold.id, tx)
  await tx`UPDATE reading_usage SET credits = ${credits} WHERE id = ${rowId}`
}

/** The price of uploading a video this long, for asking before the upload starts */
export async function readingPrice(userId: string, durationMs: number | null | undefined) {
  const plan = PLANS[await getUserPlan(userId)]
  const mode = creditsMode()
  if (mode === 'off') return { on: false as const }
  const quote = readingQuote(plan, await readingUse(userId), durationMs)
  await ensureFreeGrant(userId)
  return { on: true as const, ...quote, balance: (await balance(userId)).balance, durationMs: durationMs ?? null }
}

/** Refuses an upload the plan cannot take: out of uploads (403), or past the hours without the credits (402) */
export async function checkBeforeUpload(userId: string, durationMs: number | null | undefined): Promise<void> {
  if (creditsMode() !== 'on') return
  const planKey = await getUserPlan(userId)
  const plan = PLANS[planKey]
  const per = plan.allowancesOnce ? 'on the Free plan' : 'this month'
  const quote = readingQuote(plan, await readingUse(userId), durationMs)
  if (quote.uploadsLeft <= 0) {
    throw fail(`You've used your ${plan.uploadsPerMonth} uploads ${per}. ${plan.allowancesOnce ? 'Upgrade to upload more.' : 'More next month, or upgrade.'}`, 403)
  }
  await ensureFreeGrant(userId)
  const have = (await balance(userId)).balance
  if (quote.credits > have) {
    const hours = readingLabel(plan.readingMinutes)
    throw fail(`This video is ${minutes(durationMs ?? 0)} min and ${quote.msLeft > 0 ? `only ${minutes(quote.msLeft)} min` : 'none'} of your ${hours} ${quote.msLeft > 0 ? 'is' : 'are'} left. The rest needs ${quote.credits} credits and you have ${have}. Top up or upgrade to continue.`, 402)
  }
  // No length yet (a link, a file the browser can't read): with nothing left, at least one 10-minute price must be there
  if (durationMs == null && quote.msLeft <= 0 && have < EXTRA_READING_CREDITS) {
    throw fail(`You've used your ${readingLabel(plan.readingMinutes)} ${per}. More reading needs credits: ${EXTRA_READING_CREDITS} per 10 minutes of video, and you have ${have}. Top up or upgrade to continue.`, 402)
  }
}

/**
 * A new video is counted (once, however many times it is asked), and the part past the hours paid
 * for. No length yet (a link, a file the browser can't read): what the plan and the credits still
 * cover is written on the video, and the worker refuses it if it turns out longer, before reading it
 * (chai-cut-backend lib/readingLimit.ts); it is charged when the length is found (readingUse).
 */
export async function recordReading(userId: string, videoId: string, durationMs: number | null | undefined): Promise<void> {
  if (creditsMode() === 'off') return
  await ensureSchema()
  const plan = await getUserPlan(userId)
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`reading:${userId}`}))`
    const [u] = await tx<{ uploads: number; used: string }[]>`
      SELECT count(*)::int AS uploads, COALESCE(SUM(duration_ms), 0) AS used FROM reading_usage
      WHERE user_id = ${userId} AND created_at >= ${allowanceSince(plan)}`
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO reading_usage (user_id, video_id, duration_ms) VALUES (${userId}, ${videoId}, ${durationMs ?? null})
      ON CONFLICT (video_id) DO NOTHING RETURNING id`
    if (!row) return
    const { credits, msLeft } = readingQuote(PLANS[plan], { uploads: u.uploads, usedMs: Number(u.used) }, durationMs)
    if (credits > 0) await chargeOver(userId, videoId, row.id, credits, tx)
    if (durationMs == null && creditsMode() === 'on') {
      const bought = Math.floor((await balance(userId, tx)).balance / EXTRA_READING_CREDITS) * 10 * 60_000
      await tx`UPDATE videos SET reading_limit_ms = ${msLeft + bought} WHERE id = ${videoId}`
    }
  })
}
