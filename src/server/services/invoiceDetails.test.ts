import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

// Company details (name, GSTIN, state, address) go on invoices only on Agency (plans.ts gstInvoices,
// user 2026-11-19). Needs a database:
//   DATABASE_URL=postgresql://postgres@localhost:5433/shortcut_local npx tsx --test src/server/services/invoiceDetails.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }

let sql: typeof import('@/lib/db').default
let invoices: typeof import('./invoices')
const users: string[] = []

before(async () => {
  if (!HAS_DB) return
  sql = (await import('@/lib/db')).default
  // On an empty database (a throwaway one) the two users columns these payments read; the rig already has them
  await sql`CREATE TABLE IF NOT EXISTS users (id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, name TEXT, email TEXT NOT NULL)`
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free'`
  await sql`CREATE TABLE IF NOT EXISTS subscriptions (id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id UUID, plan TEXT, status TEXT)`
  invoices = await import('./invoices')
  await (await import('./billingSchema')).ensureBillingSchema()
})
after(async () => {
  if (!HAS_DB) return
  if (users.length) {
    await sql`DELETE FROM payments WHERE user_id = ANY(${users})`
    await sql`DELETE FROM users WHERE id = ANY(${users})`
  }
  await sql.end({ timeout: 2 })
})

async function newUser(plan: string): Promise<string> {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan, name) VALUES (${`inv-test-${Math.random().toString(36).slice(2)}@example.test`}, ${plan}, 'Account Name') RETURNING id`
  users.push(u.id)
  return u.id
}
/** A saved profile, written straight in (as an account that was on Agency before would have it) */
async function saveProfile(userId: string) {
  await sql`INSERT INTO billing_profiles (user_id, name, gstin, state_code, address)
    VALUES (${userId}, 'Acme Media Pvt Ltd', '27AABCS1234A1Z5', '27', 'Mumbai') ON CONFLICT (user_id) DO NOTHING`
}
async function pay(userId: string, plan: string) {
  const id = `pay_inv_${Math.random().toString(36).slice(2)}`
  const rowId = await invoices.recordPayment(userId, null, plan, { id, amountPaise: 48900, paidAt: new Date() } as never)
  assert.ok(rowId, 'the payment is recorded')
  const [p] = await sql<{ customer: { name: string | null; gstin: string | null; stateCode: string | null; address: string | null }; place_of_supply: string; igst_paise: number }[]>`
    SELECT customer, place_of_supply, igst_paise FROM payments WHERE id = ${rowId}`
  return p
}

test('an Agency account gets its company details on the invoice, for the plan and for a top-up', opts, async () => {
  const u = await newUser('agency')
  await saveProfile(u)
  for (const plan of ['agency', 'topup:medium']) {
    const p = await pay(u, plan)
    assert.equal(p.customer.name, 'Acme Media Pvt Ltd', plan)
    assert.equal(p.customer.gstin, '27AABCS1234A1Z5', plan)
    assert.equal(p.customer.address, 'Mumbai', plan)
    assert.equal(p.place_of_supply, '27', `${plan}: their state decides the tax`)
  }
})

test('the first Agency payment uses the details even before the account shows Agency', opts, async () => {
  const u = await newUser('creator')
  await saveProfile(u)
  const p = await pay(u, 'agency')
  assert.equal(p.customer.gstin, '27AABCS1234A1Z5')
})

test('Starter, Creator and the Trial get the plain invoice: account name, no GSTIN, our state', opts, async () => {
  for (const [plan, paid] of [['starter', 'starter'], ['creator', 'topup:small'], ['trial', 'topup:trial'], ['free', 'topup:trial']] as const) {
    const u = await newUser(plan)
    await saveProfile(u)   // kept from an earlier Agency month: saved but not used
    const p = await pay(u, paid)
    assert.equal(p.customer.name, 'Account Name', plan)
    assert.equal(p.customer.gstin, null, plan)
    assert.equal(p.customer.address, null, plan)
    assert.equal(p.customer.stateCode, null, plan)
    assert.equal(p.place_of_supply, invoices.sellerDetails().stateCode, plan)
    assert.equal(p.igst_paise, 0, `${plan}: same state as us, so no IGST`)
  }
})
