import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

// The plan's monthly hours and uploads. Real Postgres (the local rig):
//   DATABASE_URL=postgresql://postgres@localhost:5433/shortcut_local npx tsx --test src/server/services/readingUsage.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }
const MIN = 60_000

let sql: typeof import('@/lib/db').default
let credits: typeof import('./credits')
let reading: typeof import('./readingUsage')
const users: string[] = []

async function user(plan: string, balance = 0) {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan) VALUES (${`reading-test-${Math.random().toString(36).slice(2)}@example.test`}, ${plan}) RETURNING id`
  users.push(u.id)
  if (balance > 0) await credits.grant(u.id, { kind: 'plan', amount: balance, expiresAt: new Date(Date.now() + 30 * 86_400_000), sourceRef: `reading-test:${u.id}` })
  return u.id
}
async function video(userId: string, durationMs: number | null) {
  const [v] = await sql<{ id: string }[]>`INSERT INTO videos (user_id, source_type, storage_path, duration_ms) VALUES (${userId}, 'upload', ${`raw/${userId}/${Math.random()}.mp4`}, ${durationMs}) RETURNING id`
  return v.id
}
const left = async (userId: string) => (await credits.balance(userId)).balance

before(async () => {
  if (!HAS_DB) return
  process.env.CREDITS_MODE = 'on'
  process.env.CREDITS_FREE_SIGNUP = '0'
  sql = (await import('@/lib/db')).default
  credits = await import('./credits')
  reading = await import('./readingUsage')
  await credits.ensureCreditsSchema()
})
after(async () => {
  if (!HAS_DB) return
  if (users.length) await sql`DELETE FROM users WHERE id = ANY(${users})`
  await sql.end({ timeout: 2 })
})

test('every video costs credits when it is uploaded, and is counted', opts, async () => {
  const u = await user('free', 95)
  const v = await video(u, 20 * MIN)
  await reading.checkBeforeUpload(u, 20 * MIN)
  await reading.recordReading(u, v, 20 * MIN)
  const a = await reading.readingUse(u)
  assert.equal(a.usedMs, 20 * MIN)
  assert.equal(a.uploads, 1)
  assert.equal(await left(u), 65, '30 credits for 20 minutes')
})

test('the same video recorded twice (a repeated request) counts once', opts, async () => {
  const u = await user('free', 95)
  const v = await video(u, 5 * MIN)
  await reading.recordReading(u, v, 5 * MIN)
  await reading.recordReading(u, v, 5 * MIN)
  assert.equal((await reading.readingUse(u)).uploads, 1)
  assert.equal(await left(u), 80, 'charged once')
})

test('deleting a video gives no reading or credits back', opts, async () => {
  const u = await user('free', 95)
  const v = await video(u, 10 * MIN)
  await reading.recordReading(u, v, 10 * MIN)
  await sql`DELETE FROM videos WHERE id = ${v}`
  const a = await reading.readingUse(u)
  assert.equal(a.usedMs, 10 * MIN)
  assert.equal(a.uploads, 1)
  assert.equal(await left(u), 80)
})

test('past the hours: refused, even with credits, and told to upgrade', opts, async () => {
  const u = await user('free', 500)
  await reading.recordReading(u, await video(u, 25 * MIN), 25 * MIN)
  await assert.rejects(reading.checkBeforeUpload(u, 20 * MIN), (e: { status?: number; message?: string }) =>
    e.status === 403 && /20 min/.test(e.message ?? '') && /only 5 min/.test(e.message ?? '') && /upgrade/i.test(e.message ?? ''))
  await reading.recordReading(u, await video(u, 5 * MIN), 5 * MIN)
  await assert.rejects(reading.checkBeforeUpload(u, MIN), (e: { status?: number }) => e.status === 403)
  await assert.rejects(reading.checkBeforeUpload(u, null), (e: { status?: number }) => e.status === 403)
})

test('not enough credits for a video inside the hours: refused, saying what it needs and what there is', opts, async () => {
  const u = await user('starter', 80)
  await assert.rejects(reading.checkBeforeUpload(u, 60 * MIN), (e: { status?: number; message?: string }) =>
    e.status === 402 && /90 credits/.test(e.message ?? '') && /you have 80/.test(e.message ?? '') && /Top up or upgrade/.test(e.message ?? ''))
  await reading.checkBeforeUpload(u, 50 * MIN)
})

test('a video that fails gives its credits, hours and upload back, once', opts, async () => {
  const u = await user('starter', 100)
  const v = await video(u, 20 * MIN)
  await reading.recordReading(u, v, 20 * MIN)
  assert.equal(await left(u), 70)
  await sql`UPDATE videos SET status = 'failed' WHERE id = ${v}`
  await credits.sweep(u)
  await credits.sweep(u)
  assert.equal(await left(u), 100)
  const a = await reading.readingUse(u)
  assert.equal(a.usedMs, 0); assert.equal(a.uploads, 0)
})

test('the uploads run out, even with short videos', opts, async () => {
  const u = await user('free', 500)
  for (let i = 0; i < 3; i++) await reading.recordReading(u, await video(u, MIN), MIN)
  await assert.rejects(reading.checkBeforeUpload(u, MIN), (e: { status?: number; message?: string }) => e.status === 403 && /3 uploads/.test(e.message ?? ''))
})

test('a length found later (a link, an MKV) is counted and charged then, by the balance check too; short of credits, the video stays', opts, async () => {
  const u = await user('starter', 20)
  const v = await video(u, null)
  await reading.recordReading(u, v, null)
  assert.equal((await reading.readingUse(u)).usedMs, 0, 'nothing to count until the worker finds the length')
  assert.equal(await left(u), 20)
  await sql`UPDATE videos SET duration_ms = ${10 * MIN} WHERE id = ${v}`
  await credits.sweep(u)
  assert.equal(await left(u), 5, '15 credits for 10 minutes')
  assert.equal((await reading.readingUse(u)).usedMs, 10 * MIN)
  assert.equal(await left(u), 5, 'charged once')
  const w = await video(u, null)
  await reading.recordReading(u, w, null)
  await sql`UPDATE videos SET duration_ms = ${60 * MIN} WHERE id = ${w}`
  assert.equal((await reading.readingUse(u)).usedMs, 70 * MIN)
  assert.equal(await left(u), 5, 'cannot pay: nothing taken, and it counts against what comes next')
})

test('a link or unreadable file needs at least one 10-minute price in credits', opts, async () => {
  const u = await user('starter', 5)
  await assert.rejects(reading.checkBeforeUpload(u, null), (e: { status?: number; message?: string }) => e.status === 402 && /15 credits/.test(e.message ?? ''))
})

test('a length not known yet: the lower of the hours and what the credits buy is written on the video, for the worker to check', opts, async () => {
  const a = await user('starter', 40)                                      // 40 credits buy 2 × 10 minutes; 3 hours left
  const v = await video(a, null)
  await reading.recordReading(a, v, null)
  const [row] = await sql<{ reading_limit_ms: string }[]>`SELECT reading_limit_ms FROM videos WHERE id = ${v}`
  assert.equal(Number(row.reading_limit_ms), 20 * MIN)
  const b = await user('free', 500)                                        // plenty of credits, 5 minutes left
  await reading.recordReading(b, await video(b, 25 * MIN), 25 * MIN)
  const w = await video(b, null)
  await reading.recordReading(b, w, null)
  const [row2] = await sql<{ reading_limit_ms: string }[]>`SELECT reading_limit_ms FROM videos WHERE id = ${w}`
  assert.equal(Number(row2.reading_limit_ms), 5 * MIN)
})

test('a length known at upload needs no limit on the video', opts, async () => {
  const u = await user('free', 95)
  const v = await video(u, 5 * MIN)
  await reading.recordReading(u, v, 5 * MIN)
  const [row] = await sql<{ reading_limit_ms: string | null }[]>`SELECT reading_limit_ms FROM videos WHERE id = ${v}`
  assert.equal(row.reading_limit_ms, null)
})

test('credits off: nothing is checked or counted', opts, async () => {
  process.env.CREDITS_MODE = 'off'
  try {
    const u = await user('free')
    await reading.recordReading(u, await video(u, 300 * MIN), 300 * MIN)
    await reading.checkBeforeUpload(u, 300 * MIN)
    process.env.CREDITS_MODE = 'on'
    assert.equal((await reading.readingUse(u)).usedMs, 0)
  } finally { process.env.CREDITS_MODE = 'on' }
})

test('shadow: counted, never refused', opts, async () => {
  process.env.CREDITS_MODE = 'shadow'
  try {
    const u = await user('free')
    await reading.recordReading(u, await video(u, 300 * MIN), 300 * MIN)
    await reading.checkBeforeUpload(u, 300 * MIN)
    assert.equal((await reading.readingUse(u)).usedMs, 300 * MIN)
  } finally { process.env.CREDITS_MODE = 'on' }
})
