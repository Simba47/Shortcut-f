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

test('Free: 30 minutes in total; a video inside them costs nothing and is counted', opts, async () => {
  const u = await user('free')
  const v = await video(u, 20 * MIN)
  await reading.checkBeforeUpload(u, 20 * MIN)
  await reading.recordReading(u, v, 20 * MIN)
  const a = await reading.readingUse(u)
  assert.equal(a.usedMs, 20 * MIN)
  assert.equal(a.uploads, 1)
})

test('the same video recorded twice (a repeated request) counts once', opts, async () => {
  const u = await user('free')
  const v = await video(u, 5 * MIN)
  await reading.recordReading(u, v, 5 * MIN)
  await reading.recordReading(u, v, 5 * MIN)
  assert.equal((await reading.readingUse(u)).uploads, 1)
})

test('deleting a video gives no reading back', opts, async () => {
  const u = await user('free')
  const v = await video(u, 10 * MIN)
  await reading.recordReading(u, v, 10 * MIN)
  await sql`DELETE FROM videos WHERE id = ${v}`
  const a = await reading.readingUse(u)
  assert.equal(a.usedMs, 10 * MIN)
  assert.equal(a.uploads, 1)
})

test('past the hours: refused without the credits, saying what it needs and what there is', opts, async () => {
  const u = await user('free')
  await reading.recordReading(u, await video(u, 30 * MIN), 30 * MIN)
  await assert.rejects(reading.checkBeforeUpload(u, 20 * MIN), (e: { status?: number; message?: string }) =>
    e.status === 402 && /30 credits/.test(e.message ?? '') && /you have 0/.test(e.message ?? ''))
})

test('past the hours with the credits: the part past them is charged, once', opts, async () => {
  const u = await user('free', 100)
  await reading.recordReading(u, await video(u, 25 * MIN), 25 * MIN)      // 5 minutes left
  const v = await video(u, 15 * MIN)                                       // 10 minutes over: 15 credits
  await reading.checkBeforeUpload(u, 15 * MIN)
  await reading.recordReading(u, v, 15 * MIN)
  await reading.recordReading(u, v, 15 * MIN)
  assert.equal(await left(u), 85)
})

test('the uploads run out, even with short videos', opts, async () => {
  const u = await user('free', 100)
  for (let i = 0; i < 3; i++) await reading.recordReading(u, await video(u, MIN), MIN)
  await assert.rejects(reading.checkBeforeUpload(u, MIN), (e: { status?: number; message?: string }) => e.status === 403 && /3 uploads/.test(e.message ?? ''))
})

test('a length found later (a link, an MKV) is counted and charged then; short of credits, the video stays', opts, async () => {
  const u = await user('free', 20)
  await reading.recordReading(u, await video(u, 30 * MIN), 30 * MIN)
  const v = await video(u, null)
  await reading.recordReading(u, v, null)
  assert.equal((await reading.readingUse(u)).usedMs, 30 * MIN, 'nothing to count until the worker finds the length')
  await sql`UPDATE videos SET duration_ms = ${10 * MIN} WHERE id = ${v}`
  assert.equal((await reading.readingUse(u)).usedMs, 40 * MIN)
  assert.equal(await left(u), 5, '15 credits for 10 minutes over')
  await reading.readingUse(u)
  assert.equal(await left(u), 5, 'charged once')
  const w = await video(u, null)
  await reading.recordReading(u, w, null)
  await sql`UPDATE videos SET duration_ms = ${60 * MIN} WHERE id = ${w}`
  assert.equal((await reading.readingUse(u)).usedMs, 100 * MIN)
  assert.equal(await left(u), 5, 'cannot pay: nothing taken, and it counts against what comes next')
})

test('a link or unreadable file with no hours left needs at least one 10-minute price in credits', opts, async () => {
  const u = await user('free', 5)
  await reading.recordReading(u, await video(u, 30 * MIN), 30 * MIN)
  await assert.rejects(reading.checkBeforeUpload(u, null), (e: { status?: number; message?: string }) => e.status === 402 && /15 per 10 minutes/.test(e.message ?? ''))
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
