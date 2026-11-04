import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

// Where credits are charged: picking Edit with AI, a clip's captions, and an export. Real Postgres (the local rig):
//   DATABASE_URL=postgresql://postgres@localhost:5433/shortcut_local npx tsx --test src/server/services/creditsHooks.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }
const MIN = 60_000

let sql: typeof import('@/lib/db').default
let credits: typeof import('./credits')
const users: string[] = []

async function setup(opts2: { credits: number; videoMs: number; clipMs?: number }) {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan) VALUES (${`hooks-test-${Math.random().toString(36).slice(2)}@example.test`}, 'free') RETURNING id`
  users.push(u.id)
  if (opts2.credits > 0) await credits.grant(u.id, { kind: 'plan', amount: opts2.credits, expiresAt: new Date(Date.now() + 30 * 86_400_000), sourceRef: `hooks:${u.id}` })
  const [v] = await sql<{ id: string }[]>`INSERT INTO videos (user_id, source_type, storage_path, duration_ms) VALUES (${u.id}, 'upload', 'raw/test.mp4', ${opts2.videoMs}) RETURNING id`
  const [c] = await sql<{ id: string }[]>`INSERT INTO clips (video_id, start_ms, end_ms, status) VALUES (${v.id}, 0, ${opts2.clipMs ?? 60_000}, 'draft') RETURNING id`
  return { userId: u.id, videoId: v.id, clipId: c.id }
}

before(async () => {
  if (!HAS_DB) return
  process.env.CREDITS_MODE = 'on'
  process.env.CREDITS_FREE_SIGNUP = '0'  // balances below are exactly what each test grants
  sql = (await import('@/lib/db')).default
  credits = await import('./credits')
  await credits.ensureCreditsSchema()
})
after(async () => {
  if (!HAS_DB) return
  if (users.length) {
    await sql`DELETE FROM jobs WHERE payload->>'user_id' = ANY(${users}) OR payload->>'video_id' IN (SELECT id::text FROM videos WHERE user_id = ANY(${users}))`
    await sql`DELETE FROM users WHERE id = ANY(${users})`
  }
  await sql.end({ timeout: 2 })
})

test('Edit with AI charges the whole reading once, however many times it is asked', opts, async () => {
  const { userId, videoId } = await setup({ credits: 50, videoMs: 40 * MIN })
  const { ensureVideoTranscript } = await import('./transcribe')
  assert.equal(await ensureVideoTranscript(videoId), 'running')
  assert.equal(await ensureVideoTranscript(videoId), 'running')
  // a Gemini reading: 1 credit per started 10 minutes
  assert.equal((await credits.balance(userId)).balance, 46)
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM jobs WHERE payload->>'video_id' = ${videoId}`
  assert.equal(n, 1)
  const [hold] = await sql<{ job_id: string }[]>`SELECT job_id FROM credit_holds WHERE user_id = ${userId}`
  assert.ok(hold.job_id)
})

test('a brand-new user can read a 2 hour video with the free credits alone', opts, async () => {
  const before = process.env.CREDITS_FREE_SIGNUP
  delete process.env.CREDITS_FREE_SIGNUP
  try {
    const { userId, videoId } = await setup({ credits: 0, videoMs: 120 * MIN })
    const { ensureVideoTranscript } = await import('./transcribe')
    assert.equal(await ensureVideoTranscript(videoId), 'running')
    assert.equal((await credits.balance(userId)).balance, 18)
  } finally { if (before !== undefined) process.env.CREDITS_FREE_SIGNUP = before }
})

test('Edit with AI with too few credits queues nothing and says what is needed', opts, async () => {
  const { userId, videoId } = await setup({ credits: 2, videoMs: 40 * MIN })
  const { ensureVideoTranscript } = await import('./transcribe')
  await assert.rejects(ensureVideoTranscript(videoId), (e: { status?: number; needed?: number }) => e.status === 402 && e.needed === 4)
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM jobs WHERE payload->>'video_id' = ${videoId}`
  assert.equal(n, 0)
  assert.equal((await credits.balance(userId)).balance, 2)
})

test('picking Edit with AI without enough credits says so (402), not a silent "none"', opts, async () => {
  const { userId, videoId } = await setup({ credits: 2, videoMs: 40 * MIN })
  const { startVideoTranscript } = await import('./transcribe')
  await assert.rejects(startVideoTranscript(userId, videoId), (e: { status?: number; needed?: number; balance?: number }) => e.status === 402 && e.needed === 4 && e.balance === 2)
})

test('a reading that fails gives the credits back, and asking again charges again', opts, async () => {
  const { userId, videoId } = await setup({ credits: 50, videoMs: 20 * MIN })
  const { ensureVideoTranscript } = await import('./transcribe')
  await ensureVideoTranscript(videoId)
  await sql`UPDATE jobs SET status = 'failed', error = 'quota' WHERE payload->>'video_id' = ${videoId}`
  await credits.sweep(userId)
  assert.equal((await credits.balance(userId)).balance, 50)
  await assert.rejects(ensureVideoTranscript(videoId), /Reading your video failed/)
  assert.equal(await ensureVideoTranscript(videoId), 'running')
  assert.equal((await credits.balance(userId)).balance, 48)
})

test('a video our own speech model reads costs nothing to read, and no Gemini reading is queued', opts, async () => {
  const { userId, videoId } = await setup({ credits: 10, videoMs: 70 * MIN })
  const { ensureVideoTranscript } = await import('./transcribe')
  // being read by the worker's reference transcriber (marked for picking): shown as reading, free
  await sql`INSERT INTO reference_transcripts (video_id, status, for_picking) VALUES (${videoId}, 'submitted', true)`
  assert.equal(await ensureVideoTranscript(videoId), 'running')
  await sql`UPDATE reference_transcripts SET status = 'done', words = ${sql.json([{ word: 'ఒకటి', start_ms: 0, end_ms: 400 }] as never)} WHERE video_id = ${videoId}`
  assert.equal(await ensureVideoTranscript(videoId), 'ready')
  assert.equal((await credits.balance(userId)).balance, 10)
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM jobs WHERE payload->>'video_id' = ${videoId}`
  assert.equal(n, 0)
})

test('clip captions cost one credit per clip minute', opts, async () => {
  const { userId, clipId } = await setup({ credits: 10, videoMs: 30 * MIN, clipMs: 2 * MIN + 5_000 })
  const { queueRetranscribe } = await import('./transcribe')
  await queueRetranscribe(userId, clipId, 'te')
  assert.equal((await credits.balance(userId)).balance, 7)
})

test('an export costs 1 credit for a 90 second clip and 2 for a 4 minute clip', opts, async () => {
  const a = await setup({ credits: 10, videoMs: 30 * MIN, clipMs: 90_000 })
  const b = await setup({ credits: 10, videoMs: 30 * MIN, clipMs: 4 * MIN })
  const { queueRender } = await import('./export')
  await queueRender(a.userId, a.clipId, '1080p')
  await queueRender(b.userId, b.clipId, '1080p')
  assert.equal((await credits.balance(a.userId)).balance, 9)
  assert.equal((await credits.balance(b.userId)).balance, 8)
  const [hold] = await sql<{ job_id: string | null }[]>`SELECT job_id FROM credit_holds WHERE user_id = ${a.userId}`
  assert.ok(hold.job_id, 'the hold is tied to the render job')
})

test('an export of a clip over 5 minutes is refused and charges nothing', opts, async () => {
  const { userId, clipId } = await setup({ credits: 10, videoMs: 30 * MIN, clipMs: 6 * MIN })
  const { queueRender } = await import('./export')
  await assert.rejects(queueRender(userId, clipId, '1080p'), (e: { status?: number }) => e.status === 400)
  assert.equal((await credits.balance(userId)).balance, 10)
  const [clip] = await sql<{ status: string }[]>`SELECT status FROM clips WHERE id = ${clipId}`
  assert.equal(clip.status, 'draft')
})

test('an export with no credits left is refused and the clip stays a draft', opts, async () => {
  const { userId, clipId } = await setup({ credits: 1, videoMs: 30 * MIN, clipMs: 4 * MIN })
  const { queueRender } = await import('./export')
  await assert.rejects(queueRender(userId, clipId, '1080p'), (e: { status?: number }) => e.status === 402)
  const [clip] = await sql<{ status: string }[]>`SELECT status FROM clips WHERE id = ${clipId}`
  assert.equal(clip.status, 'draft')
})
