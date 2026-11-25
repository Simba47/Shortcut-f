import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { higherPlan } from './givenPlan'

// Plans given by the admin (givenPlan.ts): the higher of paid and given counts while it's on.
// The database tests need a local, throwaway Postgres:
//   DATABASE_URL=postgres://postgres:pw@127.0.0.1:55462/postgres DB_SSL=off npx tsx --test src/server/services/givenPlan.test.ts

test('the higher plan wins; unknown or missing counts as free', () => {
  assert.equal(higherPlan('free', 'creator'), 'creator')
  assert.equal(higherPlan('agency', 'starter'), 'agency')
  assert.equal(higherPlan(null, null), 'free')
  assert.equal(higherPlan('starter', null), 'starter')
  assert.equal(higherPlan(undefined, 'agency'), 'agency')
  // the Trial pack sits between no plan and Starter: a trial user stays on it, a given plan above it wins
  assert.equal(higherPlan('trial', null), 'trial')
  assert.equal(higherPlan('trial', 'free'), 'trial')
  assert.equal(higherPlan('trial', 'starter'), 'starter')
  // Unlimited (testing) is above every plan, paid or given
  assert.equal(higherPlan('agency', 'unlimited'), 'unlimited')
  assert.equal(higherPlan('unlimited', 'creator'), 'unlimited')
})

const HAS_DB = !!process.env.DATABASE_URL && /127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL)
const db = { skip: HAS_DB ? false : 'needs a local throwaway DATABASE_URL' }
let sql: typeof import('@/lib/db').default
let gp: typeof import('./givenPlan')
let quota: typeof import('./quota')

before(async () => {
  if (!HAS_DB) return
  sql = (await import('@/lib/db')).default
  gp = await import('./givenPlan')
  quota = await import('./quota')
})
after(async () => { if (HAS_DB) await sql.end({ timeout: 2 }) })

const give = (userId: string, plan: string, ends: string | null) => sql<{ id: string }[]>`
  INSERT INTO admin_plan_grants (user_id, plan, ends_at, granted_by, reason)
  VALUES (${userId}, ${plan}, ${ends === null ? null : sql`now() + ${ends}::interval`}, 'admin@test.local', 'test') RETURNING id`

test('a given plan counts while it is on; the paid plan is left alone; ended, run out or not started: off', db, async () => {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan) VALUES ('given@test.local', 'free') RETURNING id`
  // before the admin has made its table: nothing given, nothing breaks
  assert.equal(await gp.givenPlan(u.id), null)
  assert.equal(await quota.getUserPlan(u.id), 'free')

  // (the admin's table: Shortcut-Admin-f/src/server/admin/schema.ts)
  await sql`CREATE TABLE admin_plan_grants (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, plan TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL DEFAULT now(), ends_at TIMESTAMPTZ, granted_by TEXT NOT NULL, reason TEXT NOT NULL, credits INTEGER NOT NULL DEFAULT 0,
    ended_at TIMESTAMPTZ, ended_by TEXT, end_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`
  gp.forgetGivenPlansReady()

  const [g] = await give(u.id, 'agency', '1 month')
  assert.equal(await quota.getUserPlan(u.id), 'agency')
  assert.equal((await sql<{ plan: string }[]>`SELECT plan FROM users WHERE id = ${u.id}`)[0].plan, 'free')   // what they pay for: untouched

  await sql`UPDATE admin_plan_grants SET ended_at = now() WHERE id = ${g.id}`
  assert.equal(await quota.getUserPlan(u.id), 'free')                // ended by the admin
  await sql`UPDATE admin_plan_grants SET ended_at = NULL, ends_at = now() - interval '1 second' WHERE id = ${g.id}`
  assert.equal(await quota.getUserPlan(u.id), 'free')                // ran out
  await sql`UPDATE admin_plan_grants SET ends_at = NULL, starts_at = now() + interval '1 day' WHERE id = ${g.id}`
  assert.equal(await quota.getUserPlan(u.id), 'free')                // not started yet
  await sql`UPDATE admin_plan_grants SET starts_at = now() - interval '1 day' WHERE id = ${g.id}`
  assert.equal(await quota.getUserPlan(u.id), 'agency')              // no end: on until ended
})

test('the higher of paid and given; the team check and the list SQL see a given plan', db, async () => {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan) VALUES ('given2@test.local', 'creator') RETURNING id`
  assert.equal(await quota.getUserPlan(u.id), 'creator')             // paid (no Razorpay subscription: left alone), nothing given
  await give(u.id, 'starter', '1 month')
  assert.equal(await quota.getUserPlan(u.id), 'creator')             // a lower given plan doesn't lower them
  await give(u.id, 'agency', '3 months')
  assert.equal(await quota.getUserPlan(u.id), 'agency')

  const team = async (ready: boolean) => (await sql<{ ok: boolean }[]>`SELECT ${gp.hasPlanSql('u', ['agency'], ready)} AS ok FROM users u WHERE u.id = ${u.id}`)[0].ok
  assert.equal(await team(true), true)                                // Agency given: their team kits share
  assert.equal(await team(false), false)                              // (without the table: the paid plan alone)
  const [{ p }] = await sql<{ p: string | null }[]>`SELECT ${gp.givenPlanSql('u', true)} AS p FROM users u WHERE u.id = ${u.id}`
  assert.equal(p, 'agency')                                           // the newest given plan that is on
})

test('Unlimited given (user 2026-11-25): no storage or file limit worth the name, no daily or per-minute AI limits, 100 devices; ended: back to the paid plan', db, async () => {
  const GB = 1024 ** 3, MIN = 60_000
  Object.assign(process.env, { CREDITS_MODE: 'on', CREDITS_FREE_SIGNUP: '0' })
  const credits = await import('./credits')
  const storage = await import('./storage')
  const ai = await import('./aiUsage')
  const reading = await import('./readingUsage')
  const { devicesFor } = await import('@/modules/auth/devices')
  await credits.ensureCreditsSchema(); await storage.ensureStorageSchema(); await ai.ensureAiUsageSchema()
  await sql`CREATE TABLE IF NOT EXISTS admin_plan_grants (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, plan TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL DEFAULT now(), ends_at TIMESTAMPTZ, granted_by TEXT NOT NULL, reason TEXT NOT NULL, credits INTEGER NOT NULL DEFAULT 0,
    ended_at TIMESTAMPTZ, ended_by TEXT, end_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`
  gp.forgetGivenPlansReady()
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan) VALUES ('developer@test.local', 'free') RETURNING id`
  const [p] = await sql<{ id: string }[]>`INSERT INTO users (email, plan) VALUES ('pro@test.local', 'creator') RETURNING id`
  for (const id of [u.id, p.id]) await credits.grant(id, { kind: 'plan', amount: 1_000_000, expiresAt: null, sourceRef: `test-unl:${id}` })
  // 40 GB already held
  await sql`INSERT INTO videos (user_id, source_type, storage_path, status, role, file_size) VALUES (${u.id}, 'upload', 'raw/x.mp4', 'ready', 'project', ${40 * GB}), (${p.id}, 'upload', 'raw/y.mp4', 'ready', 'project', ${20 * GB})`

  const [g] = await give(u.id, 'unlimited', null)
  assert.equal(await quota.getUserPlan(u.id), 'unlimited')
  // storage and one file's size: a 70 GB file on top of the 40 GB (Pro: refused)
  assert.ok(await storage.checkStorage(u.id, 70 * GB) > 1000 * GB)
  await quota.checkFileSizeQuota(u.id, 70 * GB)
  await assert.rejects(quota.checkFileSizeQuota(u.id, 80 * GB), /75 GB/)
  await assert.rejects(storage.checkStorage(p.id, 20 * GB), /storage|free/)
  await assert.rejects(quota.checkFileSizeQuota(p.id, 9 * GB), /8 GB/)
  // devices
  assert.equal(devicesFor(await quota.getUserPlan(u.id)), 100)
  // AI: 15 rewrites in a minute and 150 Ask AI hours in a day (Pro: 10 a minute, 100 a day)
  for (let i = 0; i < 15; i++) await (await ai.beginAiAction(u.id, 'rewrite')).done()
  await sql`DELETE FROM ai_actions WHERE user_id = ${u.id}`
  await (await ai.beginAiAction(u.id, 'ask_ai', null, 150)).done()
  for (let i = 0; i < 10; i++) await (await ai.beginAiAction(p.id, 'rewrite')).done()
  await assert.rejects(ai.beginAiAction(p.id, 'rewrite'), /Too many AI requests/)
  await sql`DELETE FROM ai_actions WHERE user_id = ${p.id}`
  await assert.rejects(ai.beginAiAction(p.id, 'ask_ai', null, 150), /today's limit of 100/)
  // reading: a 30-hour video (Pro: past the day's 20 hours)
  await reading.checkBeforeUpload(u.id, 30 * 60 * MIN)
  await assert.rejects(reading.checkBeforeUpload(p.id, 30 * 60 * MIN), /20 hours/)
  // Make my clips: the day's safety limit and a run's size
  const [v] = await sql<{ id: string }[]>`INSERT INTO videos (user_id, source_type, storage_path, status, role, duration_ms, file_size) VALUES (${u.id}, 'upload', 'raw/z.mp4', 'ready', 'project', ${300 * MIN}, 1) RETURNING id`
  const al = await ai.clipAllowance(u.id, v.id)
  assert.deepEqual([al.perRun, al.videoCap], [100, 300])
  assert.ok(al.dayLeft >= 1_000_000 - 1)
  // credits still counted (tests see real prices)
  assert.ok((await credits.balance(u.id)).balance < 1_000_000)

  // ended by the admin: back to no plan
  await sql`UPDATE admin_plan_grants SET ended_at = now() WHERE id = ${g.id}`
  assert.equal(await quota.getUserPlan(u.id), 'free')
  await sql`DELETE FROM users WHERE id IN (${u.id}, ${p.id})`
})
