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
  const { userId, videoId } = await setup('starter', 60 * MIN)
  const r = await videos.createAutoClips(userId, videoId, 15)
  assert.equal(r.clip_count, 10); assert.equal(r.limited_by, 'run'); assert.equal(r.search, 'new'); assert.equal(r.credits, 0)
  assert.equal((await lastPayload(videoId))?.search, 'new')
  assert.equal((await ai.clipAllowance(userId, videoId)).searchesUsed, 1)
})

test('"Make more clips" picks from saved moments: free, no search counted, at most what is saved', opts, async () => {
  const { userId, videoId } = await setup('starter', 60 * MIN)
  await ai.saveMoments(videoId, moments(4))
  const r = await videos.createAutoClips(userId, videoId, 10)
  assert.equal(r.search, 'saved'); assert.equal(r.clip_count, 4); assert.equal(r.limited_by, 'saved')
  assert.equal((await lastPayload(videoId))?.search, 'saved')
  assert.equal((await ai.clipAllowance(userId, videoId)).searchesUsed, 0)
})

test('the day\'s clips run out: a run makes what is left, then is refused until tomorrow', opts, async () => {
  const { userId, videoId } = await setup('starter', 60 * MIN)
  await doneRun(videoId, 28)
  const r = await videos.createAutoClips(userId, videoId, 10)
  assert.equal(r.clip_count, 2); assert.equal(r.limited_by, 'day')
  await sql`UPDATE ai_edit_jobs SET status = 'done' WHERE video_id = ${videoId}`
  await sql`INSERT INTO clips (video_id, start_ms, end_ms, status, ai_edit_job_id) SELECT ${videoId}, 0, 10, 'draft', id FROM ai_edit_jobs WHERE video_id = ${videoId} AND clip_count = 2`
  await sql`INSERT INTO clips (video_id, start_ms, end_ms, status, ai_edit_job_id) SELECT ${videoId}, 20, 30, 'draft', id FROM ai_edit_jobs WHERE video_id = ${videoId} AND clip_count = 2`
  await assert.rejects(videos.createAutoClips(userId, videoId, 5), (e: { status?: number; message?: string }) => e.status === 429 && /today/i.test(e.message ?? ''))
})

test('a 5-minute video holds at most 5 AI clips', opts, async () => {
  const { userId, videoId } = await setup('creator', 5 * MIN)
  await doneRun(videoId, 5)
  await assert.rejects(videos.createAutoClips(userId, videoId, 3), (e: { status?: number; message?: string }) => e.status === 429 && /this video/i.test(e.message ?? ''))
})

test('a fresh search past the included ones asks first, then takes its credits when confirmed', opts, async () => {
  const { userId, videoId } = await setup('starter', 20 * MIN, 10)
  for (let i = 0; i < 3; i++) await ai.recordSearch(userId, videoId, 'best_moments', null, 0)
  await assert.rejects(videos.createAutoClips(userId, videoId, 3, false, { search: 'new' }),
    (e: { status?: number; code?: string; credits?: number }) => e.status === 402 && e.code === 'search_costs' && e.credits === 2)
  const r = await videos.createAutoClips(userId, videoId, 3, false, { search: 'new', pay: true })
  assert.equal(r.credits, 2); assert.equal(r.search, 'new')
  assert.equal((await credits.balance(userId)).balance, 8)
  const [hold] = await sql<{ job_id: string | null; ref_type: string }[]>`SELECT job_id, ref_type FROM credit_holds WHERE user_id = ${userId}`
  assert.equal(hold.ref_type, 'search'); assert.ok(hold.job_id, 'tied to the job, so a failed run gives it back')
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
    (e: { status?: number; code?: string; credits?: number }) => e.status === 402 && e.code === 'search_costs' && e.credits === 2)
})

test('Ask AI past the daily cap is refused before any AI call', opts, async () => {
  const { userId, videoId } = await setup('free', 20 * MIN, 10)
  await sql`INSERT INTO ai_actions (user_id, kind) SELECT ${userId}, 'ask_ai' FROM generate_series(1, 5)`
  await sql`UPDATE ai_actions SET created_at = now() - interval '2 minutes' WHERE user_id = ${userId}`
  await assert.rejects(videos.getVideoSuggestionsByCriteria(userId, videoId, 'funny moments'), (e: { status?: number }) => e.status === 429)
})

test('a rewrite past the allowance with no credits is refused (402)', opts, async () => {
  const { userId, videoId } = await setup('free', 20 * MIN)
  await sql`INSERT INTO ai_actions (user_id, kind, created_at) SELECT ${userId}, 'rewrite', now() - interval '1 day' FROM generate_series(1, 20)`
  const [c] = await sql<{ id: string }[]>`INSERT INTO clips (video_id, start_ms, end_ms, status) VALUES (${videoId}, 0, 1000, 'draft') RETURNING id`
  const { regenerateClipText } = await import('./clips')
  await assert.rejects(regenerateClipText(userId, c.id), (e: { status?: number }) => e.status === 402)
})
