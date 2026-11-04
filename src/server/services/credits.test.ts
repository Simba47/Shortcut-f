import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

// Runs against a real Postgres (the local rig), never production:
//   DATABASE_URL=postgresql://postgres@localhost:5433/shortcut_local npx tsx --test src/server/services/credits.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }

type Svc = typeof import('./credits')
let svc: Svc
let sql: typeof import('@/lib/db').default
const users: string[] = []
const jobs: string[] = []

async function newUser(): Promise<string> {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan) VALUES (${`credits-test-${Math.random().toString(36).slice(2)}@example.test`}, 'free') RETURNING id`
  users.push(u.id)
  return u.id
}
async function newJob(status: string): Promise<string> {
  const [j] = await sql<{ id: string }[]>`INSERT INTO jobs (type, payload, status) VALUES ('render', '{}'::jsonb, ${status}) RETURNING id`
  jobs.push(j.id)
  return j.id
}

before(async () => {
  if (!HAS_DB) return
  process.env.CREDITS_MODE = 'on'
  sql = (await import('@/lib/db')).default
  svc = await import('./credits')
  await svc.ensureCreditsSchema()
})
after(async () => {
  if (!HAS_DB) return
  if (users.length) await sql`DELETE FROM users WHERE id = ANY(${users})`
  if (jobs.length) await sql`DELETE FROM jobs WHERE id = ANY(${jobs})`
  await sql.end({ timeout: 2 })
})

const future = (days: number) => new Date(Date.now() + days * 86_400_000)

test('a grant adds to the balance, and the same source is never granted twice', opts, async () => {
  const u = await newUser()
  assert.equal((await svc.grant(u, { kind: 'plan', amount: 200, expiresAt: future(30), sourceRef: `t:${u}:1` })).granted, true)
  assert.equal((await svc.grant(u, { kind: 'plan', amount: 200, expiresAt: future(30), sourceRef: `t:${u}:1` })).granted, false)
  assert.equal((await svc.balance(u)).balance, 200)
})

test('an expired grant does not count', opts, async () => {
  const u = await newUser()
  await svc.grant(u, { kind: 'plan', amount: 50, expiresAt: new Date(Date.now() - 1000), sourceRef: `t:${u}:old` })
  await svc.grant(u, { kind: 'topup', amount: 10, expiresAt: future(300), sourceRef: `t:${u}:new` })
  assert.equal((await svc.balance(u)).balance, 10)
})

test('the free grant is given once per account', opts, async () => {
  const u = await newUser()
  const before = process.env.CREDITS_FREE_SIGNUP
  delete process.env.CREDITS_FREE_SIGNUP
  try {
    await svc.ensureFreeGrant(u)
    await svc.ensureFreeGrant(u)
    assert.equal((await svc.balance(u)).balance, 30)
  } finally { if (before !== undefined) process.env.CREDITS_FREE_SIGNUP = before }
})

test('CREDITS_FREE_SIGNUP=0 gives no free credits', opts, async () => {
  const u = await newUser()
  const before = process.env.CREDITS_FREE_SIGNUP
  process.env.CREDITS_FREE_SIGNUP = '0'
  try {
    await svc.ensureFreeGrant(u)
    assert.equal((await svc.balance(u)).balance, 0)
  } finally { if (before === undefined) delete process.env.CREDITS_FREE_SIGNUP; else process.env.CREDITS_FREE_SIGNUP = before }
})

test('reserve takes credits from the grant that expires first and records the spend', opts, async () => {
  const u = await newUser()
  await svc.grant(u, { kind: 'topup', amount: 100, expiresAt: future(300), sourceRef: `t:${u}:topup` })
  await svc.grant(u, { kind: 'plan', amount: 30, expiresAt: future(10), sourceRef: `t:${u}:plan` })
  const hold = await svc.reserve(u, { amount: 40, refType: 'transcribe', refId: 'v1' })
  assert.ok(hold)
  const b = await svc.balance(u)
  assert.equal(b.balance, 90)
  const rows = await sql<{ source_ref: string; remaining: number }[]>`SELECT source_ref, remaining FROM credit_grants WHERE user_id = ${u} ORDER BY source_ref`
  assert.deepEqual(rows.map(r => [r.source_ref.split(':').pop(), r.remaining]), [['plan', 0], ['topup', 90]])
  const ledger = await svc.recentLedger(u, 10)
  assert.equal(ledger[0].delta, -40)
})

test('reserve refuses when the balance is short, and changes nothing', opts, async () => {
  const u = await newUser()
  await svc.grant(u, { kind: 'plan', amount: 5, expiresAt: future(10), sourceRef: `t:${u}:p` })
  await assert.rejects(svc.reserve(u, { amount: 6, refType: 'render', refId: 'c1' }),
    (e: { status?: number; needed?: number; balance?: number }) => e.status === 402 && e.needed === 6 && e.balance === 5)
  assert.equal((await svc.balance(u)).balance, 5)
})

test('release gives the credits back to the grants they came from, once', opts, async () => {
  const u = await newUser()
  await svc.grant(u, { kind: 'plan', amount: 20, expiresAt: future(10), sourceRef: `t:${u}:p` })
  const hold = await svc.reserve(u, { amount: 12, refType: 'render', refId: 'c1' })
  await svc.release(hold!.id)
  await svc.release(hold!.id)
  assert.equal((await svc.balance(u)).balance, 20)
})

test('settle keeps the spend, and a settled hold cannot be released', opts, async () => {
  const u = await newUser()
  await svc.grant(u, { kind: 'plan', amount: 20, expiresAt: future(10), sourceRef: `t:${u}:p` })
  const hold = await svc.reserve(u, { amount: 12, refType: 'render', refId: 'c1' })
  await svc.settle(hold!.id)
  await svc.release(hold!.id)
  assert.equal((await svc.balance(u)).balance, 8)
})

test('two spends at once cannot overspend the balance', opts, async () => {
  const u = await newUser()
  await svc.grant(u, { kind: 'plan', amount: 10, expiresAt: future(10), sourceRef: `t:${u}:p` })
  const results = await Promise.allSettled([1, 2, 3, 4].map(i => svc.reserve(u, { amount: 4, refType: 'render', refId: `c${i}` })))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 2)
  assert.equal((await svc.balance(u)).balance, 2)
})

test('sweep settles holds whose job is done and releases those whose job failed', opts, async () => {
  const u = await newUser()
  await svc.grant(u, { kind: 'plan', amount: 30, expiresAt: future(10), sourceRef: `t:${u}:p` })
  const ok = await svc.reserve(u, { amount: 5, refType: 'render', refId: 'a', jobId: await newJob('done') })
  const bad = await svc.reserve(u, { amount: 7, refType: 'render', refId: 'b', jobId: await newJob('failed') })
  const running = await svc.reserve(u, { amount: 3, refType: 'render', refId: 'c', jobId: await newJob('processing') })
  await svc.sweep(u)
  const status = async (id: string) => (await sql<{ status: string }[]>`SELECT status FROM credit_holds WHERE id = ${id}`)[0].status
  assert.equal(await status(ok!.id), 'settled')
  assert.equal(await status(bad!.id), 'released')
  assert.equal(await status(running!.id), 'held')
  assert.equal((await svc.balance(u)).balance, 30 - 5 - 3)
})

test('sweep lets go of a hold that never got a job after the time limit', opts, async () => {
  const u = await newUser()
  await svc.grant(u, { kind: 'plan', amount: 10, expiresAt: future(10), sourceRef: `t:${u}:p` })
  const hold = await svc.reserve(u, { amount: 4, refType: 'transcribe', refId: 'v' })
  await sql`UPDATE credit_holds SET created_at = now() - interval '7 hours' WHERE id = ${hold!.id}`
  await svc.sweep(u)
  assert.equal((await svc.balance(u)).balance, 10)
})

test('inside a transaction, a spend is undone with it', opts, async () => {
  const u = await newUser()
  await svc.grant(u, { kind: 'plan', amount: 10, expiresAt: future(10), sourceRef: `t:${u}:p` })
  await assert.rejects(sql.begin(async tx => {
    await svc.reserve(u, { amount: 4, refType: 'render', refId: 'x' }, tx)
    throw new Error('job could not be queued')
  }), /job could not be queued/)
  assert.equal((await svc.balance(u)).balance, 10)
})

test('shadow mode records the spend but never refuses or touches the balance', opts, async () => {
  const u = await newUser()
  process.env.CREDITS_MODE = 'shadow'
  try {
    const hold = await svc.reserve(u, { amount: 500, refType: 'transcribe', refId: 'big' })
    assert.ok(hold)
    assert.equal((await svc.balance(u)).balance, 0)
    const ledger = await svc.recentLedger(u, 5)
    assert.equal(ledger[0].delta, -500)
    assert.equal(ledger[0].shadow, true)
  } finally { process.env.CREDITS_MODE = 'on' }
})

test('with credits off, reserve does nothing at all', opts, async () => {
  const u = await newUser()
  process.env.CREDITS_MODE = 'off'
  try {
    assert.equal(await svc.reserve(u, { amount: 5, refType: 'render', refId: 'c' }), null)
    assert.equal((await svc.recentLedger(u, 5)).length, 0)
  } finally { process.env.CREDITS_MODE = 'on' }
})

test('a billing cycle grants its plan credits once, to last until the end of the next cycle', opts, async () => {
  const u = await newUser()
  const cycleEnd = future(30)
  assert.equal((await svc.grantPlanCredits(u, 'creator', 'sub_1:2026-11', cycleEnd)).granted, true)
  assert.equal((await svc.grantPlanCredits(u, 'creator', 'sub_1:2026-11', cycleEnd)).granted, false)
  const [g] = await sql<{ amount: number; expires_at: Date }[]>`SELECT amount, expires_at FROM credit_grants WHERE user_id = ${u}`
  assert.equal(g.amount, 400)
  assert.ok(g.expires_at.getTime() > cycleEnd.getTime() + 25 * 86_400_000, 'rolls over one more month')
})

test('the free plan has no monthly credits to grant', opts, async () => {
  const u = await newUser()
  assert.equal((await svc.grantPlanCredits(u, 'free', 'x:2026-11', future(30))).granted, false)
})
