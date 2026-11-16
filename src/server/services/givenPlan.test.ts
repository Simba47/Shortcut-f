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
