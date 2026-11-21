import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

// Videos expire (plans v2, 2026-11-21): Trial 7 days, Starter and Pro 30 from the upload (or from the day expiry
// was switched on), Pro's ★ Keep, the grace after a Keep goes or the plan ends, the hourly sweep's emails and
// deletions. Real Postgres:
//   DATABASE_URL=… npx tsx --test src/server/services/expiry.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }
const DAY = 86_400_000

let sql: typeof import('@/lib/db').default
let expiry: typeof import('./expiry')
const users: string[] = []

async function user(plan: string) {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan, name) VALUES (${`expiry-${Math.random().toString(36).slice(2)}@example.test`}, ${plan}, 'Asha Rao') RETURNING id`
  users.push(u.id)
  if (plan === 'trial') await sql`INSERT INTO topup_orders (order_id, user_id, pack, credits, amount_paise, status, paid_at) VALUES (${`order_e_${u.id}`}, ${u.id}, 'trial', 99, 4900, 'paid', now())`
  return u.id
}
async function video(userId: string, daysAgo: number, title = 'A talk') {
  const [v] = await sql<{ id: string }[]>`
    INSERT INTO videos (user_id, source_type, storage_path, status, role, title, created_at)
    VALUES (${userId}, 'upload', ${`raw/${userId}/${Math.random()}.mp4`}, 'ready', 'project', ${title}, now() - ${`${daysAgo} days`}::interval) RETURNING id`
  return v.id
}
const expiresIn = async (videoId: string) => {
  const [r] = await sql<{ expires_at: Date | null; kept: boolean }[]>`SELECT expires_at, kept FROM videos WHERE id = ${videoId}`
  return r.expires_at ? (r.expires_at.getTime() - Date.now()) / DAY : null
}
const near = (a: number | null, b: number, msg?: string) => assert.ok(a != null && Math.abs(a - b) < 0.01, `${msg ?? ''} ${a} ≈ ${b}`)
/** The day expiry was switched on, set for a test */
const launchedDaysAgo = async (d: number) => {
  await sql`
    INSERT INTO app_flags (key, at) VALUES ('video_expiry_launch', now() - ${`${d} days`}::interval)
    ON CONFLICT (key) DO UPDATE SET at = EXCLUDED.at`
  expiry.forgetExpiryCaches()
}

before(async () => {
  if (!HAS_DB) return
  Object.assign(process.env, { CREDITS_MODE: 'on', VIDEO_EXPIRY: 'on' })
  sql = (await import('@/lib/db')).default
  expiry = await import('./expiry')
  await (await import('./credits')).ensureCreditsSchema()
  await expiry.ensureExpirySchema()
})
after(async () => {
  if (!HAS_DB) return
  if (users.length) await sql`DELETE FROM users WHERE id = ANY(${users})`
  await sql.end({ timeout: 2 })
})

test('on or off: VIDEO_EXPIRY decides; not set, on in production and off on a computer', () => {
  const { expiryOn } = require('./expiry') as typeof import('./expiry')
  assert.equal(expiryOn({ VIDEO_EXPIRY: 'on' }), true)
  assert.equal(expiryOn({ VIDEO_EXPIRY: 'off', NODE_ENV: 'production' }), false)
  assert.equal(expiryOn({ NODE_ENV: 'production' }), true)
  assert.equal(expiryOn({ NODE_ENV: 'development' }), false)
})

test('Starter 30 days and the Trial 7 from the upload; a video from before expiry was switched on counts from that day', opts, async () => {
  await launchedDaysAgo(100)
  const s = await user('starter')
  const fresh = await video(s, 2), old = await video(s, 25)
  const t = await user('trial')
  const tv = await video(t, 1)
  await expiry.refreshExpiry(s); await expiry.refreshExpiry(t)
  near(await expiresIn(fresh), 28); near(await expiresIn(old), 5); near(await expiresIn(tv), 6)
  // switched on 3 days ago: a 60-day-old video still has 27 days, not gone at once
  await launchedDaysAgo(3)
  const before = await video(s, 60)
  await expiry.refreshExpiry(s)
  near(await expiresIn(before), 27, 'counted from the day it was switched on')
  await launchedDaysAgo(100)
})

test('★ Keep on Pro: never expires; not on Starter; taken off, it gets at least 7 more days', opts, async () => {
  await launchedDaysAgo(100)
  const p = await user('creator')
  const v = await video(p, 40)
  const kept = await expiry.setKept(p, v, true)
  assert.equal(kept.kept, true); assert.equal(kept.expires_at, null)
  await expiry.setKept(p, v, false)
  near(await expiresIn(v), 7, 'a 40-day-old video let go: 7 more days')
  const s = await user('starter')
  const sv = await video(s, 1)
  await assert.rejects(expiry.setKept(s, sv, true), (e: { status?: number; message?: string }) => e.status === 403 && /Pro plan/.test(e.message ?? ''))
})

test('leaving Pro: kept videos lose Keep and get 7 days; the rest keep their 30', opts, async () => {
  await launchedDaysAgo(100)
  const p = await user('creator')
  const kept = await video(p, 90), plain = await video(p, 10)
  await expiry.setKept(p, kept, true)
  await sql`UPDATE users SET plan = 'starter' WHERE id = ${p}`
  await expiry.refreshExpiry(p)
  near(await expiresIn(kept), 7)
  near(await expiresIn(plain), 20)
  const [row] = await sql<{ kept: boolean }[]>`SELECT kept FROM videos WHERE id = ${kept}`
  assert.equal(row.kept, false)
})

test('no plan any more: everything goes 7 days after (or sooner, as it would have); a plan bought again gives the days back', opts, async () => {
  await launchedDaysAgo(100)
  const p = await user('creator')
  const kept = await video(p, 200), recent = await video(p, 1), older = await video(p, 26)
  await expiry.setKept(p, kept, true)
  await sql`UPDATE users SET plan = 'free' WHERE id = ${p}`
  await expiry.refreshExpiry(p)
  near(await expiresIn(kept), 7); near(await expiresIn(recent), 7); near(await expiresIn(older), 4, 'sooner, as it would have')
  // the next sweep: the 7 days don't move along
  await expiry.refreshExpiry(p)
  near(await expiresIn(recent), 7, 'kept the same date')
  // they count from when the plan ended: a day later, 6 are left
  await sql`UPDATE users SET videos_grace_from = videos_grace_from - interval '1 day' WHERE id = ${p}`
  await expiry.refreshExpiry(p)
  near(await expiresIn(recent), 6, 'counted from the end of the plan')
  // back on Starter: the plan's days again (the kept one, let go, has its 7)
  await sql`UPDATE users SET plan = 'starter' WHERE id = ${p}`
  await expiry.refreshExpiry(p)
  near(await expiresIn(recent), 29); near(await expiresIn(kept), 7)
  const [u] = await sql<{ g: Date | null }[]>`SELECT videos_grace_from AS g FROM users WHERE id = ${p}`
  assert.equal(u.g, null)
})

test('the sweep: one email per account for what is in its last days (Trial 2, plans 3), never twice; the expired deleted; kept ones stay', opts, async () => {
  await launchedDaysAgo(100)
  const s = await user('starter')
  const soon = await video(s, 28, 'Episode 12'), later = await video(s, 20), gone = await video(s, 31)
  const t = await user('trial')
  const tSoon = await video(t, 4.5)   // 2.5 days left: not yet (the Trial is told in its last 2)
  const p = await user('creator')
  const kept = await video(p, 300)
  await expiry.setKept(p, kept, true)
  const mails: Array<{ email: string; titles: Array<string | null> }> = []
  const removed: string[] = []
  const deps = {
    force: true,
    notify: async (to: { email: string }, vs: Array<{ title: string | null }>) => { mails.push({ email: to.email, titles: vs.map(v => v.title) }) },
    remove: async (_u: string, ids: string[]) => { removed.push(...ids); await sql`DELETE FROM videos WHERE id = ANY(${ids})` },
  }
  await expiry.sweepExpiry(deps)
  const mine = mails.filter(m => m.email.startsWith('expiry-'))
  const [{ email }] = await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${s}`
  assert.deepEqual(mine.find(m => m.email === email)?.titles, ['Episode 12'])
  assert.ok(removed.includes(gone), 'the expired one is deleted')
  assert.ok(!removed.includes(soon) && !removed.includes(later) && !removed.includes(kept) && !removed.includes(tSoon))
  const [{ email: te }] = await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${t}`
  assert.ok(!mine.some(m => m.email === te), 'the Trial video with 2.5 days is not told yet')
  // again: nobody told twice
  mails.length = 0
  await expiry.sweepExpiry(deps)
  assert.ok(!mails.some(m => m.email === email))
  // a plan bought that moves the date out: told again when it comes near
  await sql`UPDATE videos SET created_at = now() - interval '1 day' WHERE id = ${soon}`
  await expiry.refreshExpiry(s)
  const [w] = await sql<{ w: Date | null }[]>`SELECT expiry_warned_at AS w FROM videos WHERE id = ${soon}`
  assert.equal(w.w, null)
})

test('only one copy of the site sweeps in an hour', opts, async () => {
  const deps = { notify: async () => {}, remove: async () => {} }
  await sql`UPDATE app_flags SET at = now() - interval '2 hours' WHERE key = 'video_expiry_sweep'`
  const [a, b] = await Promise.all([expiry.sweepExpiry(deps), expiry.sweepExpiry(deps)])
  assert.equal([a, b].filter(Boolean).length, 1)
})

test('an expired video is deleted like a deleted one: its clips go with it (videos.ts deleteVideos)', opts, async () => {
  await launchedDaysAgo(100)
  const { deleteVideos } = await import('./videos')
  const { r2 } = await import('@/lib/r2')
  const keys: string[] = []
  r2.send = (async (cmd: { input: { Delete?: { Objects: Array<{ Key: string }> } } }) => { keys.push(...(cmd.input.Delete?.Objects ?? []).map(o => o.Key)); return {} }) as never
  const s = await user('starter')
  const v = await video(s, 45)
  await sql`INSERT INTO clips (video_id, start_ms, end_ms, status, output_storage_path) VALUES (${v}, 0, 1000, 'done', 'exports/c1.mp4')`
  await expiry.sweepExpiry({ force: true, notify: async () => {}, remove: deleteVideos })
  assert.equal((await sql`SELECT 1 FROM videos WHERE id = ${v}`).length, 0)
  assert.equal((await sql`SELECT 1 FROM clips WHERE video_id = ${v}`).length, 0)
  assert.ok(keys.includes('exports/c1.mp4'), 'its export is removed from storage')
})

test('a refresh writes only the videos whose date changes; the dashboard\'s refresh runs at most once a minute', opts, async () => {
  await launchedDaysAgo(100)
  const s = await user('starter')
  const v = await video(s, 3)
  await expiry.refreshExpiry(s)
  const xmin = async () => (await sql<{ x: string }[]>`SELECT xmin::text AS x FROM videos WHERE id = ${v}`)[0].x
  const first = await xmin()
  await expiry.refreshExpiry(s)
  assert.equal(await xmin(), first, 'nothing changed: the row is not written again')
  // the dashboard's (soon): skipped within the minute, so a plan change shows on the next one after
  expiry.forgetExpiryCaches()   // (a minute later)
  assert.notEqual(await expiry.refreshExpiry(s, { soon: true }), null)
  await sql`UPDATE users SET plan = 'trial' WHERE id = ${s}`
  await sql`INSERT INTO topup_orders (order_id, user_id, pack, credits, amount_paise, status, paid_at) VALUES (${`order_x_${s}`}, ${s}, 'trial', 99, 4900, 'paid', now())`
  assert.equal(await expiry.refreshExpiry(s, { soon: true }), null)
  near(await expiresIn(v), 27, 'not yet')
  await expiry.refreshExpiry(s)
  near(await expiresIn(v), 4, 'the Trial\'s 7 days')
})
