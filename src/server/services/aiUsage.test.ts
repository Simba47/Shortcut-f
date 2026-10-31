import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

//   DATABASE_URL=postgresql://postgres@localhost:5433/shortcut_local npx tsx --test src/server/services/aiUsage.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }
const MIN = 60_000

let sql: typeof import('@/lib/db').default
let ai: typeof import('./aiUsage')
let credits: typeof import('./credits')
const users: string[] = []

// "Earlier this month": the first instant of the month (on the 1st that is also today, so a test
// that needs the month used up but not the day lifts the daily cap with withAskAiDayCap)
const monthStart = async () => (await import('@/lib/aiLimits')).istMonthStart()
async function withAskAiDayCap<T>(plan: 'free' | 'starter', n: number, fn: () => Promise<T>): Promise<T> {
  const { PLANS } = await import('@/lib/plans')
  const ai = PLANS[plan].ai as { askAiPerDay: number }
  const was = ai.askAiPerDay
  ai.askAiPerDay = n
  try { return await fn() } finally { ai.askAiPerDay = was }
}

async function setup(plan = 'starter', videoMs = 20 * MIN, grantCredits = 0) {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan) VALUES (${`ai-test-${Math.random().toString(36).slice(2)}@example.test`}, ${plan}) RETURNING id`
  users.push(u.id)
  if (grantCredits) await credits.grant(u.id, { kind: 'plan', amount: grantCredits, expiresAt: new Date(Date.now() + 30 * 86_400_000), sourceRef: `ai-test:${u.id}` })
  const [v] = await sql<{ id: string }[]>`INSERT INTO videos (user_id, source_type, storage_path, duration_ms, status) VALUES (${u.id}, 'upload', 'raw/x.mp4', ${videoMs}, 'ready') RETURNING id`
  return { userId: u.id, videoId: v.id }
}
/** A Make my clips run of `asked` clips, `made` of them made, with this status */
async function run(videoId: string, asked: number, made: number, status = 'done', createdAt = 'now()') {
  const [j] = await sql<{ id: string }[]>`INSERT INTO ai_edit_jobs (video_id, clip_count, status, created_at) VALUES (${videoId}, ${asked}, ${status}, ${sql.unsafe(createdAt)}) RETURNING id`
  for (let i = 0; i < made; i++) await sql`INSERT INTO clips (video_id, start_ms, end_ms, status, ai_edit_job_id, created_at) VALUES (${videoId}, ${i * 30_000}, ${i * 30_000 + 20_000}, 'draft', ${j.id}, ${sql.unsafe(createdAt)})`
  return j.id
}

before(async () => {
  if (!HAS_DB) return
  Object.assign(process.env, { CREDITS_MODE: 'on', CREDITS_FREE_SIGNUP: '0' })
  sql = (await import('@/lib/db')).default
  credits = await import('./credits')
  ai = await import('./aiUsage')
  await ai.ensureAiUsageSchema()
})
after(async () => {
  if (!HAS_DB) return
  if (users.length) await sql`DELETE FROM users WHERE id = ANY(${users})`
  await sql.end({ timeout: 2 })
})

test('clips today count every AI clip made today, and a run still going counts what it asked for', opts, async () => {
  const { userId, videoId } = await setup('starter', 60 * MIN)
  await run(videoId, 10, 10)
  await run(videoId, 5, 0, 'running')
  await run(videoId, 8, 8, 'done', "now() - interval '2 days'")   // another day: not today
  const a = await ai.clipAllowance(userId, videoId)
  assert.equal(a.clipsToday, 15)
  assert.equal(a.dayLeft, 15)
  assert.equal(a.videoClips, 10 + 5 + 8)
  assert.equal(a.videoCap, 60)
  assert.equal(a.perRun, 10)
})

test('a failed or cancelled run counts only the clips it really made', opts, async () => {
  const { userId, videoId } = await setup()
  await run(videoId, 10, 3, 'failed')
  assert.equal((await ai.clipAllowance(userId, videoId)).clipsToday, 3)
})

test('saved moments left are the saved ones not already made into a clip', opts, async () => {
  const { userId, videoId } = await setup()
  await ai.saveMoments(videoId, [
    { start_ms: 0, end_ms: 20_000, title: 'a', summary: '', score: 90 },
    { start_ms: 100_000, end_ms: 130_000, title: 'b', summary: '', score: 80 },
    { start_ms: 200_000, end_ms: 230_000, title: 'c', summary: '', score: 70 },
  ])
  await run(videoId, 1, 1)   // a clip at 0–20 s: moment "a" is used
  const a = await ai.clipAllowance(userId, videoId)
  assert.equal(a.savedLeft, 2)
  assert.deepEqual((await ai.unusedMoments(videoId)).map(m => m.title), ['b', 'c'])
})

test('fresh searches: included per plan, then priced by the video length; a failed run does not count', opts, async () => {
  const { userId, videoId } = await setup('starter', 60 * MIN)
  assert.deepEqual(pick(await ai.clipAllowance(userId, videoId)), { searchesUsed: 0, searchesIncluded: 3, nextSearchCredits: 0 })
  const j1 = await run(videoId, 1, 1); await ai.recordSearch(userId, videoId, 'make_clips', j1, 0)
  await ai.recordSearch(userId, videoId, 'best_moments', null, 0)
  const bad = await run(videoId, 1, 0, 'failed'); await ai.recordSearch(userId, videoId, 'make_clips', bad, 0)
  assert.deepEqual(pick(await ai.clipAllowance(userId, videoId)), { searchesUsed: 2, searchesIncluded: 3, nextSearchCredits: 0 })
  await ai.recordSearch(userId, videoId, 'best_moments', null, 0)
  assert.deepEqual(pick(await ai.clipAllowance(userId, videoId)), { searchesUsed: 3, searchesIncluded: 3, nextSearchCredits: 6 })
})
const pick = (a: { searchesUsed: number; searchesIncluded: number; nextSearchCredits: number }) =>
  ({ searchesUsed: a.searchesUsed, searchesIncluded: a.searchesIncluded, nextSearchCredits: a.nextSearchCredits })

test('Ask AI: free within the month\'s allowance, then 1 credit each; refused with 402 when credits run out', opts, async () => {
  const { userId, videoId } = await setup('free', 20 * MIN, 1)   // free plan: 10 a month, 5 a day
  await sql`INSERT INTO ai_actions (user_id, kind, created_at) SELECT ${userId}, 'ask_ai', ${await monthStart()} FROM generate_series(1, 10)`
  await withAskAiDayCap('free', 1000, async () => {
    const a1 = await ai.beginAiAction(userId, 'ask_ai', videoId)
    assert.equal(a1.credits, 1)
    await a1.done()
    assert.equal((await credits.balance(userId)).balance, 0)
    await assert.rejects(ai.beginAiAction(userId, 'ask_ai', videoId), (e: { status?: number }) => e.status === 402)
  })
})

test('Ask AI: the daily cap holds even with credits, and a failed search gives its credit and count back', opts, async () => {
  const { userId, videoId } = await setup('free', 20 * MIN, 50)
  for (let i = 0; i < 5; i++) await (await ai.beginAiAction(userId, 'ask_ai', videoId)).done()
  await assert.rejects(ai.beginAiAction(userId, 'ask_ai', videoId), (e: { status?: number; message?: string }) => e.status === 429 && /today/i.test(e.message ?? ''))
  // a failure: back to where it was
  const { userId: u2, videoId: v2 } = await setup('starter', 20 * MIN, 5)
  await sql`INSERT INTO ai_actions (user_id, kind, created_at) SELECT ${u2}, 'ask_ai', ${await monthStart()} FROM generate_series(1, 100)`
  const h = await withAskAiDayCap('starter', 1000, () => ai.beginAiAction(u2, 'ask_ai', v2))
  assert.equal((await credits.balance(u2)).balance, 4)
  await h.fail()
  assert.equal((await credits.balance(u2)).balance, 5)
  assert.equal((await ai.aiActionCounts(u2)).askAiThisMonth, 100)
})

test('rewrites: the allowance, then 1 credit for every 5', opts, async () => {
  const { userId } = await setup('free', 20 * MIN, 10)   // free: 20 rewrites a month
  await sql`INSERT INTO ai_actions (user_id, kind, created_at) SELECT ${userId}, 'rewrite', ${await monthStart()} FROM generate_series(1, 20)`
  const charged: number[] = []
  for (let i = 0; i < 6; i++) { const h = await ai.beginAiAction(userId, 'rewrite'); charged.push(h.credits); await h.done() }
  assert.deepEqual(charged, [1, 0, 0, 0, 0, 1])
  assert.equal((await credits.balance(userId)).balance, 8)
})

test('more than 10 AI requests in a minute are slowed down (429)', opts, async () => {
  const { userId } = await setup('agency', 20 * MIN)
  for (let i = 0; i < 10; i++) await (await ai.beginAiAction(userId, 'rewrite')).done()
  await assert.rejects(ai.beginAiAction(userId, 'rewrite'), (e: { status?: number; message?: string }) => e.status === 429 && /minute/i.test(e.message ?? ''))
})

test('with credits off nothing is counted or refused; in shadow mode it is counted but never refused', opts, async () => {
  const { userId } = await setup('free')
  process.env.CREDITS_MODE = 'off'
  try {
    for (let i = 0; i < 12; i++) await (await ai.beginAiAction(userId, 'ask_ai')).done()
    assert.equal((await ai.aiActionCounts(userId)).askAiThisMonth, 0)
    process.env.CREDITS_MODE = 'shadow'
    for (let i = 0; i < 7; i++) { const h = await ai.beginAiAction(userId, 'ask_ai'); assert.equal(h.credits, 0); await h.done() }
    assert.equal((await ai.aiActionCounts(userId)).askAiThisMonth, 7)
  } finally { process.env.CREDITS_MODE = 'on' }
})

test('AI cost is recorded per call with its tokens and an estimated price', opts, async () => {
  const { userId, videoId } = await setup()
  await ai.recordAiUsage({ userId, videoId, purpose: 'ask_ai', model: 'gemini-2.5-flash', inputTokens: 1_000_000, outputTokens: 100_000 })
  await ai.recordAiUsage({ userId, videoId, purpose: 'ask_ai', model: 'some-unknown-model', inputTokens: 10, outputTokens: 10 })
  const rows = await sql<{ model: string; cost_micro_usd: string | null }[]>`SELECT model, cost_micro_usd FROM ai_usage WHERE user_id = ${userId} ORDER BY id`
  assert.equal(Number(rows[0].cost_micro_usd), 300_000 + 250_000)   // $0.30 in + $0.25 out
  assert.equal(rows[1].cost_micro_usd, null)                          // no price known: tokens only
})
