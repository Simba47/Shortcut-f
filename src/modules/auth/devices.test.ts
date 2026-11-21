import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

// Devices signed in at once (plans v2, 2026-11-21: Trial 1, Starter 2, Pro 3). Real Postgres:
//   DATABASE_URL=… npx tsx --test src/modules/auth/devices.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }

let sql: typeof import('@/lib/db').default
let devices: typeof import('./devices')
const users: string[] = []

async function user(plan: string, sessionId: string | null = null) {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan, session_id) VALUES (${`dev-${Math.random().toString(36).slice(2)}@example.test`}, ${plan}, ${sessionId}) RETURNING id`
  users.push(u.id)
  if (plan === 'trial') await sql`INSERT INTO topup_orders (order_id, user_id, pack, credits, amount_paise, status, paid_at) VALUES (${`order_d_${u.id}`}, ${u.id}, 'trial', 99, 4900, 'paid', now())`
  return u.id
}
const live = async (sid: string) => (await sql<{ live: boolean }[]>`SELECT ended_at IS NULL AS live FROM user_sessions WHERE id = ${sid}`)[0]?.live
/** A sign-in made by another copy of the site (or long ago): only its row, used `minutesAgo` */
async function otherSignIn(userId: string, minutesAgo: number) {
  const id = crypto.randomUUID()
  await sql`INSERT INTO user_sessions (id, user_id, created_at, last_seen_at) VALUES (${id}, ${userId}, now() - ${`${minutesAgo} minutes`}::interval, now() - ${`${minutesAgo} minutes`}::interval)`
  return id
}

before(async () => {
  if (!HAS_DB) return
  sql = (await import('@/lib/db')).default
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS session_id TEXT`
  await (await import('@/server/services/credits')).ensureCreditsSchema()
  devices = await import('./devices')
  await devices.ensureDevicesSchema()
})
after(async () => {
  if (!HAS_DB) return
  if (users.length) await sql`DELETE FROM users WHERE id = ANY(${users})`
  await sql.end({ timeout: 2 })
})

test('each plan\'s devices: Trial 1, Starter 2, Pro 3 (no plan: 1)', () => {
  const { devicesFor } = require('./devices') as typeof import('./devices')
  assert.deepEqual(['free', 'trial', 'starter', 'creator', 'agency', 'nonsense'].map(devicesFor), [1, 1, 2, 3, 3, 1])
})

test('Starter: a third sign-in signs out the device used least recently; the other two stay', opts, async () => {
  const u = await user('starter')
  const a = await otherSignIn(u, 30), b = await otherSignIn(u, 5)
  const c = await devices.startSession(u, 'Mozilla/5.0 (iPhone)')
  assert.ok(c)
  assert.equal(await live(a), false); assert.equal(await live(b), true); assert.equal(await live(c!), true)
  assert.equal(await devices.isCurrentSession(u, a), false)
  assert.equal(await devices.isCurrentSession(u, b), true)
  const [row] = await sql<{ end_reason: string; user_agent: string | null }[]>`SELECT end_reason, user_agent FROM user_sessions WHERE id IN (${a}, ${c!}) ORDER BY end_reason NULLS LAST`
  assert.equal(row.end_reason, 'limit')
})

test('the Trial: one device; Pro: three', opts, async () => {
  const t = await user('trial')
  const t1 = await otherSignIn(t, 1)
  await devices.startSession(t)
  assert.equal(await live(t1), false)
  const p = await user('creator')
  const p1 = await otherSignIn(p, 3), p2 = await otherSignIn(p, 2)
  await devices.startSession(p)
  assert.equal(await live(p1), true); assert.equal(await live(p2), true)
  await devices.startSession(p)
  assert.equal(await live(p1), false, 'the fourth signs out the oldest-used')
})

test('signing out frees the place: the next sign-in signs nobody out', opts, async () => {
  const u = await user('starter')
  const a = await otherSignIn(u, 10), b = await otherSignIn(u, 5)
  await devices.endSession(a)
  await devices.startSession(u)
  assert.equal(await live(b), true)
})

test('leaving Pro for Starter: the next time a device is used, the extra one is signed out', opts, async () => {
  const u = await user('creator')
  const a = await otherSignIn(u, 60), b = await otherSignIn(u, 30), c = await otherSignIn(u, 20)
  await sql`UPDATE users SET plan = 'starter' WHERE id = ${u}`
  assert.equal(await devices.isCurrentSession(u, c), true)
  assert.equal(await live(a), false); assert.equal(await live(b), true)
})

test('Shortcut\'s admin signs the account out everywhere (a new users.session_id); a sign-in after works', opts, async () => {
  const u = await user('creator')
  const a = await otherSignIn(u, 5), b = await otherSignIn(u, 4)
  await sql`UPDATE users SET session_id = ${crypto.randomUUID()} WHERE id = ${u}`
  assert.equal(await devices.isCurrentSession(u, a), false)
  assert.equal(await live(b), false)
  const c = await devices.startSession(u)
  assert.equal(await devices.isCurrentSession(u, c), true)
})

test('the one device each account had before stays signed in; a session from before ids counts', opts, async () => {
  const before = crypto.randomUUID()
  const u = await user('starter', before)
  // (as on the first start after the change: what users.session_id held becomes a device)
  await sql`INSERT INTO user_sessions (id, user_id) SELECT session_id, id FROM users WHERE id = ${u} ON CONFLICT (id) DO NOTHING`
  assert.equal(await devices.isCurrentSession(u, before), true)
  assert.equal(await devices.isCurrentSession(u, undefined), true)
  assert.equal(await devices.isCurrentSession(u, 'a-sid-never-made'), false)
})

test('an admin sign-out followed at once by a sign-in: the devices that hadn\'t noticed yet are signed out too', opts, async () => {
  const u = await user('creator')
  const a = await otherSignIn(u, 5)
  await sql`UPDATE users SET session_id = ${crypto.randomUUID()} WHERE id = ${u}`
  const b = await devices.startSession(u)
  assert.equal(await live(a), false)
  assert.equal(await devices.isCurrentSession(u, a), false)
  assert.equal(await devices.isCurrentSession(u, b), true)
})

test('the sign-in an account had before devices were kept stays signed in, even if it wasn\'t copied yet', opts, async () => {
  const old = crypto.randomUUID()
  const u = await user('starter', old)     // (no user_sessions row for it)
  assert.equal(await devices.isCurrentSession(u, old), true)
  assert.equal(await live(old), true, 'it is a device now')
})
