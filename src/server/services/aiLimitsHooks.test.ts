import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

// Where the AI limits apply: Make my clips, Best moments, Ask AI, rewrites. Real Postgres (the local rig),
// and only paths that answer before any Gemini call:
//   DATABASE_URL=postgresql://postgres@localhost:5433/shortcut_local npx tsx --test src/server/services/aiLimitsHooks.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }
const MIN = 60_000

let sql: typeof import('@/lib/db').default
let ai: typeof import('./aiUsage')
let credits: typeof import('./credits')
let videos: typeof import('./videos')
const users: string[] = []

async function setup(plan = 'starter', videoMs = 20 * MIN, grantCredits = 0) {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan) VALUES (${`hook-ai-${Math.random().toString(36).slice(2)}@example.test`}, ${plan}) RETURNING id`
  users.push(u.id)
  if (grantCredits) await credits.grant(u.id, { kind: 'plan', amount: grantCredits, expiresAt: new Date(Date.now() + 30 * 86_400_000), sourceRef: `hook-ai:${u.id}` })
  const [v] = await sql<{ id: string }[]>`INSERT INTO videos (user_id, source_type, storage_path, duration_ms, status) VALUES (${u.id}, 'upload', 'raw/x.mp4', ${videoMs}, 'ready') RETURNING id`
  // the whole video is read (so Best moments and Ask AI do not start a reading)
  const [t] = await sql<{ id: string }[]>`INSERT INTO transcripts (video_id, language, whole_video) VALUES (${v.id}, 'te', true) RETURNING id`
  await sql`INSERT INTO transcript_words (transcript_id, word, start_ms, end_ms) VALUES (${t.id}, 'hello', 0, 500), (${t.id}, 'world', 600, 1000)`
  return { userId: u.id, videoId: v.id }
}
async function doneRun(videoId: string, made: number) {
  const [j] = await sql<{ id: string }[]>`INSERT INTO ai_edit_jobs (video_id, clip_count, status) VALUES (${videoId}, ${made}, 'done') RETURNING id`
  for (let i = 0; i < made; i++) await sql`INSERT INTO clips (video_id, start_ms, end_ms, status, ai_edit_job_id) VALUES (${videoId}, ${900_000 + i * 30_000}, ${900_000 + i * 30_000 + 20_000}, 'draft', ${j.id})`
}
const moments = (n: number) => Array.from({ length: n }, (_, i) => ({ start_ms: i * 60_000, end_ms: i * 60_000 + 30_000, title: `m${i}`, summary: '', score: 90 - i }))
const lastPayload = async (videoId: string) =>
  (await sql<{ payload: Record<string, unknown> }[]>`SELECT payload FROM jobs WHERE type = 'ai_edit' AND payload->>'video_id' = ${videoId} ORDER BY created_at DESC LIMIT 1`)[0]?.payload

before(async () => {
  if (!HAS_DB) return
  Object.assign(process.env, { CREDITS_MODE: 'on', CREDITS_FREE_SIGNUP: '0' })
  sql = (await import('@/lib/db')).default
  credits = await import('./credits')
  ai = await import('./aiUsage')
  videos = await import('./videos')
  await Promise.all([credits.ensureCreditsSchema(), ai.ensureAiUsageSchema()])
})
after(async () => {
  if (!HAS_DB) return
  if (users.length) {
    await sql`DELETE FROM jobs WHERE type = 'ai_edit' AND payload->>'video_id' IN (SELECT id::text FROM videos WHERE user_id = ANY(${users}))`
    await sql`DELETE FROM users WHERE id = ANY(${users})`
  }
  await sql.end({ timeout: 2 })
})

test('Make my clips, first run: a fresh search (the 1st included), cut to the plan\'s clips per run', opts, async () => {
  const { userId, videoId } = await setup('starter', 60 * MIN, 100)
  const r = await videos.createAutoClips(userId, videoId, 15)
  assert.equal(r.clip_count, 10); assert.equal(r.limited_by, 'run'); assert.equal(r.search, 'new'); assert.equal(r.credits, 50)
  assert.equal((await credits.balance(userId)).balance, 50)
  assert.equal((await lastPayload(videoId))?.search, 'new')
  assert.equal((await ai.clipAllowance(userId, videoId)).searchesUsed, 1)
})

test('"Make more clips" picks from saved moments: no search counted, at most what is saved, 5 credits a clip', opts, async () => {
  const { userId, videoId } = await setup('starter', 60 * MIN, 100)
  await ai.saveMoments(videoId, moments(4))
  const r = await videos.createAutoClips(userId, videoId, 10)
  assert.equal(r.search, 'saved'); assert.equal(r.clip_count, 4); assert.equal(r.limited_by, 'saved')
  assert.equal((await lastPayload(videoId))?.search, 'saved')
  assert.equal((await ai.clipAllowance(userId, videoId)).searchesUsed, 0)
})

test('the day\'s clips run out: a run makes what is left, then is refused until tomorrow', opts, async () => {
  const { userId, videoId } = await setup('starter', 60 * MIN, 100)
  await doneRun(videoId, 4)
  await withDayCap('starter', 6, async () => {
    const r = await videos.createAutoClips(userId, videoId, 10, false, { pay: true })
    assert.equal(r.clip_count, 2); assert.equal(r.limited_by, 'day')
    await sql`UPDATE ai_edit_jobs SET status = 'done' WHERE video_id = ${videoId}`
    await sql`INSERT INTO clips (video_id, start_ms, end_ms, status, ai_edit_job_id) SELECT ${videoId}, 0, 10, 'draft', id FROM ai_edit_jobs WHERE video_id = ${videoId} AND clip_count = 2`
    await sql`INSERT INTO clips (video_id, start_ms, end_ms, status, ai_edit_job_id) SELECT ${videoId}, 20, 30, 'draft', id FROM ai_edit_jobs WHERE video_id = ${videoId} AND clip_count = 2`
    await assert.rejects(videos.createAutoClips(userId, videoId, 5), (e: { status?: number; message?: string }) => e.status === 429 && /today/i.test(e.message ?? ''))
  })
})

test('a 5-minute video holds at most 5 AI clips', opts, async () => {
  const { userId, videoId } = await setup('creator', 5 * MIN)
  await doneRun(videoId, 5)
  await assert.rejects(videos.createAutoClips(userId, videoId, 3), (e: { status?: number; message?: string }) => e.status === 429 && /this video/i.test(e.message ?? ''))
})

test('a fresh search past the included ones asks first, then takes its credits when confirmed', opts, async () => {
  const { userId, videoId } = await setup('starter', 20 * MIN, 25)
  for (let i = 0; i < 3; i++) await ai.recordSearch(userId, videoId, 'best_moments', null, 0)
  await assert.rejects(videos.createAutoClips(userId, videoId, 3, false, { search: 'new' }),
    (e: { status?: number; code?: string; credits?: number }) => e.status === 402 && e.code === 'search_costs' && e.credits === 10)
  const r = await videos.createAutoClips(userId, videoId, 3, false, { search: 'new', pay: true })
  assert.equal(r.credits, 25); assert.equal(r.search, 'new')                 // 10 for the search, 15 for 3 clips
  assert.equal((await credits.balance(userId)).balance, 0)
  const holds = await sql<{ job_id: string | null; ref_type: string }[]>`SELECT job_id, ref_type FROM credit_holds WHERE user_id = ${userId} ORDER BY ref_type`
  assert.deepEqual(holds.map(h => h.ref_type), ['ai_clips', 'search']); assert.ok(holds.every(h => h.job_id), 'tied to the job, so a failed run gives them back')
})

/** The day's cap is lower than the month's, so a test that fills the month lifts it (and puts it back) */
async function withDayCap<T>(plan: 'starter' | 'free', n: number, fn: () => Promise<T>): Promise<T> {
  const { PLANS } = await import('@/lib/plans')
  const ai = PLANS[plan].ai as { clipsPerDay: number }
  const was = ai.clipsPerDay
  ai.clipsPerDay = n
  try { return await fn() } finally { ai.clipsPerDay = was }
}

test('AI clips cost 5 credits each, and a run stops at the month\'s limit even with credits', opts, async () => {
  const { userId, videoId } = await setup('starter', 120 * MIN, 500)
  await ai.saveMoments(videoId, moments(20))
  await doneRun(videoId, 18)                                   // 2 of Starter's 20 left
  await withDayCap('starter', 1000, async () => {
    const r = await videos.createAutoClips(userId, videoId, 5)
    assert.equal(r.clip_count, 2); assert.equal(r.limited_by, 'month'); assert.equal(r.credits, 10)
    assert.equal((await credits.balance(userId)).balance, 490)
    await sql`UPDATE ai_edit_jobs SET status = 'failed' WHERE video_id = ${videoId} AND status = 'queued'`
    await doneRun(videoId, 2)
    await assert.rejects(videos.createAutoClips(userId, videoId, 1), (e: { status?: number; message?: string }) => e.status === 403 && /upgrade/i.test(e.message ?? ''))
  })
})

test('a run that makes fewer clips than it took credits for gives the difference back, once it has finished', opts, async () => {
  const { userId, videoId } = await setup('starter', 60 * MIN, 100)
  await ai.saveMoments(videoId, moments(10))
  await videos.createAutoClips(userId, videoId, 5)
  assert.equal((await credits.balance(userId)).balance, 75)
  const [ae] = await sql<{ id: string }[]>`SELECT id FROM ai_edit_jobs WHERE video_id = ${videoId} ORDER BY created_at DESC LIMIT 1`
  // Waiting on the customer ("found fewer: make these?"): nothing is settled yet, though its first job is done
  await sql`UPDATE jobs SET status = 'done' WHERE payload->>'ai_edit_job_id' = ${ae.id}`
  await sql`UPDATE ai_edit_jobs SET status = 'confirm' WHERE id = ${ae.id}`
  await credits.sweep(userId)
  assert.equal((await credits.balance(userId)).balance, 75)
  await sql`INSERT INTO clips (video_id, start_ms, end_ms, status, ai_edit_job_id) SELECT ${videoId}, 0, 1000, 'draft', ${ae.id} FROM generate_series(1, 3)`
  await sql`UPDATE ai_edit_jobs SET status = 'done' WHERE id = ${ae.id}`
  await credits.sweep(userId)
  await credits.sweep(userId)
  assert.equal((await credits.balance(userId)).balance, 85, '3 clips made: 15 of the 25 stand')
})

test('a run that fails with nothing made gives all its credits back', opts, async () => {
  const { userId, videoId } = await setup('starter', 60 * MIN, 100)
  await ai.saveMoments(videoId, moments(10))
  await videos.createAutoClips(userId, videoId, 5)
  const [ae] = await sql<{ id: string }[]>`SELECT id FROM ai_edit_jobs WHERE video_id = ${videoId} ORDER BY created_at DESC LIMIT 1`
  await sql`UPDATE jobs SET status = 'failed' WHERE payload->>'ai_edit_job_id' = ${ae.id}`
  await sql`UPDATE ai_edit_jobs SET status = 'failed' WHERE id = ${ae.id}`
  await credits.sweep(userId)
  assert.equal((await credits.balance(userId)).balance, 100)
})

test('the free plan stops at its 3 clips in total', opts, async () => {
  const { userId, videoId } = await setup('free', 60 * MIN, 30)
  await ai.saveMoments(videoId, moments(5))
  await doneRun(videoId, 3)
  await withDayCap('free', 1000, async () => {
    await assert.rejects(videos.createAutoClips(userId, videoId, 2), (e: { status?: number }) => e.status === 403)
  })
})

test('Best moments shows saved moments without asking AI again', opts, async () => {
  const { userId, videoId } = await setup('starter', 20 * MIN)
  await ai.saveMoments(videoId, moments(12))
  const r = await videos.getVideoSuggestions(userId, videoId)
  assert.equal(r.suggestions.length, 8)
  assert.equal(r.suggestions[0].title, 'm0')
  // "View more": the next ones
  const more = await videos.getVideoSuggestions(userId, videoId, r.suggestions.map(s => [s.start_ms, s.end_ms] as [number, number]))
  assert.deepEqual(more.suggestions.map(s => s.title), ['m8', 'm9', 'm10', 'm11'])
})

test('Best moments with nothing saved and no included searches left asks before paying', opts, async () => {
  const { userId, videoId } = await setup('free', 20 * MIN, 10)
  await ai.recordSearch(userId, videoId, 'make_clips', null, 0)   // free: 1 search per video
  await assert.rejects(videos.getVideoSuggestions(userId, videoId),
    (e: { status?: number; code?: string; credits?: number }) => e.status === 402 && e.code === 'search_costs' && e.credits === 10)
})

test('Ask AI past the daily cap is refused before any AI call', opts, async () => {
  const { userId, videoId } = await setup('free', 20 * MIN, 10)
  await sql`INSERT INTO ai_actions (user_id, kind) SELECT ${userId}, 'ask_ai' FROM generate_series(1, 5)`
  await sql`UPDATE ai_actions SET created_at = now() - interval '2 minutes' WHERE user_id = ${userId}`
  await assert.rejects(videos.getVideoSuggestionsByCriteria(userId, videoId, 'funny moments'), (e: { status?: number }) => e.status === 429)
})

test('Ask AI on a long video asks its price first; one hour or less just shows it', opts, async () => {
  const { apiError } = await import('@/lib/api-error')
  const { userId, videoId } = await setup('starter', 150 * MIN, 50)
  const asked = await videos.getVideoSuggestionsByCriteria(userId, videoId, 'funny moments').catch(e => e)
  assert.equal(asked.status, 402); assert.equal(asked.code, 'ask_costs'); assert.equal(asked.credits, 21)
  const body = await apiError(asked).json()
  assert.equal(body.code, 'ask_costs'); assert.equal(body.credits, 21)
  assert.equal((await credits.balance(userId)).balance, 50)   // nothing taken for asking
  // Agreed to: it goes on past the question (no AI here, so it fails there and gives the credits back)
  const went = await videos.getVideoSuggestionsByCriteria(userId, videoId, 'funny moments', { pay: true }).catch(e => e)
  assert.notEqual(went.code, 'ask_costs')
  assert.equal((await credits.balance(userId)).balance, 50)
  const short = await setup('starter', 20 * MIN, 50)
  const noAsk = await videos.getVideoSuggestionsByCriteria(short.userId, short.videoId, 'funny moments').catch(e => e)
  assert.notEqual(noAsk.code, 'ask_costs')
})

test('a rewrite with no credits is refused (402)', opts, async () => {
  const { userId, videoId } = await setup('free', 20 * MIN)
  const [c] = await sql<{ id: string }[]>`INSERT INTO clips (video_id, start_ms, end_ms, status) VALUES (${videoId}, 0, 1000, 'draft') RETURNING id`
  const { regenerateClipText } = await import('./clips')
  await assert.rejects(regenerateClipText(userId, c.id), (e: { status?: number }) => e.status === 402)
})

