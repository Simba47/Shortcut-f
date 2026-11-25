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
  // The Trial counts while its paid order is under 14 days old (billing.ts trialSummary)
  if (plan === 'trial') await sql`INSERT INTO topup_orders (order_id, user_id, pack, credits, amount_paise, status, paid_at) VALUES (${`order_rt_${u.id}`}, ${u.id}, 'trial', 99, 5000, 'paid', now())`
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
  const u = await user('trial', 95)
  const v = await video(u, 20 * MIN)
  await reading.checkBeforeUpload(u, 20 * MIN)
  await reading.recordReading(u, v, 20 * MIN)
  const a = await reading.readingUse(u)
  assert.equal(a.usedMs, 20 * MIN)
  assert.equal(a.uploads, 1)
  assert.equal(await left(u), 65, '30 credits for 20 minutes')
})

test('the same video recorded twice (a repeated request) counts once', opts, async () => {
  const u = await user('trial', 95)
  const v = await video(u, 5 * MIN)
  await reading.recordReading(u, v, 5 * MIN)
  await reading.recordReading(u, v, 5 * MIN)
  assert.equal((await reading.readingUse(u)).uploads, 1)
  assert.equal(await left(u), 80, 'charged once')
})

test('deleting a video gives no reading or credits back', opts, async () => {
  const u = await user('trial', 95)
  const v = await video(u, 10 * MIN)
  await reading.recordReading(u, v, 10 * MIN)
  await sql`DELETE FROM videos WHERE id = ${v}`
  const a = await reading.readingUse(u)
  assert.equal(a.usedMs, 10 * MIN)
  assert.equal(a.uploads, 1)
  assert.equal(await left(u), 80)
})

test('the plan\'s hours are back (2026-11-22): past Starter\'s 3 hours this month, refused even with credits, saying upgrade', opts, async () => {
  const u = await user('starter', 5000)
  await reading.recordReading(u, await video(u, 150 * MIN), 150 * MIN)
  await reading.checkBeforeUpload(u, 30 * MIN)                               // exactly what is left: fine
  await assert.rejects(reading.checkBeforeUpload(u, 40 * MIN), (e: { status?: number; message?: string }) =>
    e.status === 403 && /40 min/.test(e.message ?? '') && /only 30 min of the 3 hours on your Starter plan this month/.test(e.message ?? '') && /upgrade/.test(e.message ?? ''))
  await reading.recordReading(u, await video(u, 30 * MIN), 30 * MIN)
  await assert.rejects(reading.checkBeforeUpload(u, MIN), (e: { status?: number; message?: string }) =>
    e.status === 403 && /used the 3 hours of video on your Starter plan this month/.test(e.message ?? ''))
  await assert.rejects(reading.checkBeforeUpload(u, null), (e: { status?: number }) => e.status === 403)
  // last month's reading doesn't count for this month
  await sql`UPDATE reading_usage SET created_at = now() - interval '40 days' WHERE user_id = ${u}`
  await reading.checkBeforeUpload(u, 60 * MIN)
})

test('the Trial\'s 30 minutes are in total, and past them it says to choose a plan', opts, async () => {
  const u = await user('trial', 95)
  await reading.recordReading(u, await video(u, 25 * MIN), 25 * MIN)
  await assert.rejects(reading.checkBeforeUpload(u, 10 * MIN), (e: { status?: number; message?: string }) =>
    e.status === 403 && /only 5 min of the 30 minutes on your Trial/.test(e.message ?? '') && /Choose a plan/.test(e.message ?? ''))
  await reading.checkBeforeUpload(u, 5 * MIN)
})

test('Pro reads 5 hours a month', opts, async () => {
  const u = await user('creator', 5000)
  await reading.recordReading(u, await video(u, 280 * MIN), 280 * MIN)
  await reading.checkBeforeUpload(u, 20 * MIN)
  await assert.rejects(reading.checkBeforeUpload(u, 21 * MIN), (e: { status?: number; message?: string }) => e.status === 403 && /5 hours on your Pro plan/.test(e.message ?? ''))
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
  const u = await user('trial', 500)
  for (let i = 0; i < 2; i++) await reading.recordReading(u, await video(u, MIN), MIN)
  await assert.rejects(reading.checkBeforeUpload(u, MIN), (e: { status?: number; message?: string }) => e.status === 403 && /the 2 uploads on your Trial/.test(e.message ?? ''))
})

test('no plan (no free plan since 2026-11-16): an upload is refused and told to start the Trial pack, even with credits', opts, async () => {
  const u = await user('free', 500)
  await assert.rejects(reading.checkBeforeUpload(u, MIN), (e: { status?: number; message?: string }) => e.status === 403 && /Trial pack/.test(e.message ?? ''))
  const storage = await import('./storage')
  await assert.rejects(storage.checkStorage(u, MIN), (e: { status?: number; message?: string }) => e.status === 403 && /Trial pack/.test(e.message ?? ''))
})

test('a Trial whose 7 days are over is no plan again', opts, async () => {
  const u = await user('trial', 50)
  await sql`UPDATE topup_orders SET paid_at = now() - interval '8 days' WHERE user_id = ${u}`
  const quota = await import('./quota')
  assert.equal(await quota.getUserPlan(u), 'free')
  await assert.rejects(reading.checkBeforeUpload(u, MIN), (e: { status?: number; message?: string }) => e.status === 403 && /Trial pack/.test(e.message ?? ''))
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

test('a length not known yet: the lower of the plan\'s hours left and what the credits buy is written on the video, for the worker to check', opts, async () => {
  const a = await user('starter', 40)                                      // 40 credits buy 2 × 10 minutes
  const v = await video(a, null)
  await reading.recordReading(a, v, null)
  const [row] = await sql<{ reading_limit_ms: string }[]>`SELECT reading_limit_ms FROM videos WHERE id = ${v}`
  assert.equal(Number(row.reading_limit_ms), 20 * MIN)
  const b = await user('starter', 5000)                                     // plenty of credits, 5 minutes of the plan's 3 hours left
  await reading.recordReading(b, await video(b, 175 * MIN), 175 * MIN)
  const w = await video(b, null)
  await reading.recordReading(b, w, null)
  const [row2] = await sql<{ reading_limit_ms: string }[]>`SELECT reading_limit_ms FROM videos WHERE id = ${w}`
  assert.equal(Number(row2.reading_limit_ms), 5 * MIN)
})

test('a length known at upload needs no limit on the video', opts, async () => {
  const u = await user('trial', 95)
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

test('the same file uploaded again after its video was deleted is not counted again (user, 2026-11-17)', opts, async () => {
  // Starter: 180 min. A 150-min video, deleted, then the same file again: it fits, costs nothing, isn't an upload
  const u = await user('starter', 500)
  const SIZE = 3_456_789_012
  const first = await video(u, 150 * MIN)
  await reading.recordReading(u, first, 150 * MIN, SIZE)
  const paid = await left(u)
  await sql`DELETE FROM videos WHERE id = ${first}`
  // (the browser's length can differ a little from the first time's)
  await reading.checkBeforeUpload(u, 150 * MIN + 400, SIZE)
  assert.deepEqual(await reading.readingPrice(u, 150 * MIN + 400, SIZE).then(p => p.on && [p.credits, p.overMs]), [0, 0], 'nothing to ask on the upload card')
  const again = await video(u, 150 * MIN + 400)
  await reading.recordReading(u, again, 150 * MIN + 400, SIZE)
  const use = await reading.readingUse(u)
  assert.equal(use.usedMs, 150 * MIN, 'counted once')
  assert.equal(use.uploads, 1)
  assert.equal(await left(u), paid, 'no credits for it')

  // Only once per deleted video: a third copy, after deleting the second, is a new upload, priced as usual
  await sql`DELETE FROM videos WHERE id = ${again}`
  assert.equal(await reading.readingPrice(u, 150 * MIN, SIZE).then(p => p.on && p.credits), 225)
})

test('not the same file: another size, another length, or the first copy still there — counted as usual', opts, async () => {
  const u = await user('agency', 5000)
  const SIZE = 1_000_000_000
  const kept = await video(u, 60 * MIN)
  await reading.recordReading(u, kept, 60 * MIN, SIZE)
  // the first copy is still there: a second copy side by side is counted
  await reading.recordReading(u, await video(u, 60 * MIN), 60 * MIN, SIZE)
  assert.equal((await reading.readingUse(u)).usedMs, 120 * MIN)
  const gone = await video(u, 30 * MIN)
  await reading.recordReading(u, gone, 30 * MIN, 2 * SIZE)
  await sql`DELETE FROM videos WHERE id = ${gone}`
  // another size (a different file of the same length), another length, no size (a link): all counted
  await reading.recordReading(u, await video(u, 30 * MIN), 30 * MIN, 2 * SIZE + 1)
  await reading.recordReading(u, await video(u, 32 * MIN), 32 * MIN, 2 * SIZE)
  await reading.recordReading(u, await video(u, 30 * MIN), 30 * MIN)
  const use = await reading.readingUse(u)
  assert.equal(use.usedMs, (120 + 30 + 30 + 32 + 30) * MIN)
  assert.equal(use.uploads, 6)
})
