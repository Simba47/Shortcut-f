import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

// "450 / 599 credits left" and when they expire, on the Buy credits page (credits.ts grantsSummary). Needs a database:
//   DATABASE_URL=postgresql://postgres@localhost:5433/shortcut_local npx tsx --test src/server/services/grantsSummary.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }
const DAY = 86_400_000

let sql: typeof import('@/lib/db').default
let credits: typeof import('./credits')
const users: string[] = []

before(async () => {
  if (!HAS_DB) return
  sql = (await import('@/lib/db')).default
  // On an empty database (a throwaway one) the users columns used here; the rig already has them
  await sql`CREATE TABLE IF NOT EXISTS users (id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, name TEXT, email TEXT NOT NULL)`
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free'`
  credits = await import('./credits')
  await credits.ensureCreditsSchema()
})
after(async () => {
  if (!HAS_DB) return
  if (users.length) {
    await sql`DELETE FROM credit_ledger WHERE user_id = ANY(${users})`.catch(() => {})
    await sql`DELETE FROM credit_holds WHERE user_id = ANY(${users})`.catch(() => {})
    await sql`DELETE FROM credit_grants WHERE user_id = ANY(${users})`
    await sql`DELETE FROM users WHERE id = ANY(${users})`
  }
  await sql.end({ timeout: 2 })
})

async function newUser(): Promise<string> {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan) VALUES (${`gs-test-${Math.random().toString(36).slice(2)}@example.test`}, 'starter') RETURNING id`
  users.push(u.id)
  return u.id
}

test('the total counts every grant still in force, used or not; expiries list what is left, soonest first', opts, async () => {
  const u = await newUser()
  const soon = new Date(Date.now() + 20 * DAY), later = new Date(Date.now() + 300 * DAY)
  await credits.grant(u, { kind: 'plan', amount: 599, expiresAt: soon, sourceRef: `gs:${u}:plan` })
  await credits.grant(u, { kind: 'topup', amount: 200, expiresAt: later, sourceRef: `gs:${u}:topup` })
  await credits.grant(u, { kind: 'plan', amount: 50, expiresAt: new Date(Date.now() - DAY), sourceRef: `gs:${u}:old` })   // expired: not counted
  // spend 149: from the plan credits first (they run out sooner)
  const hold = await credits.reserve(u, { amount: 149, refType: 'render', refId: 'c1' })
  assert.ok(hold)
  await credits.settle(hold!.id)

  const s = await credits.grantsSummary(u)
  assert.equal(s.total, 799, '599 + 200; the expired 50 is left out')
  assert.equal((await credits.balance(u)).balance, 650, '450 + 200 left')
  assert.deepEqual(s.expiries.map(e => [e.amount, e.kind]), [[450, 'plan'], [200, 'topup']])
  assert.ok(s.expiries[0].at.getTime() < s.expiries[1].at.getTime())
})

test('used up but not expired still counts in the total (0 / 599), with nothing to expire', opts, async () => {
  const u = await newUser()
  await credits.grant(u, { kind: 'plan', amount: 10, expiresAt: new Date(Date.now() + 20 * DAY), sourceRef: `gs:${u}:p` })
  const hold = await credits.reserve(u, { amount: 10, refType: 'render', refId: 'c1' })
  await credits.settle(hold!.id)
  const s = await credits.grantsSummary(u)
  assert.equal(s.total, 10)
  assert.deepEqual(s.expiries, [])
})
