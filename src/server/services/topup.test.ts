import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// The whole payment flow against the fake Razorpay (no network, no account) and the local rig database:
//   DATABASE_URL=postgresql://postgres@localhost:5433/shortcut_local npx tsx --test src/server/services/topup.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }
const KEY = 'rzp_test_dummykey000001', SECRET = 'dummysecret', HOOK = 'dummywebhooksecret'

let sql: typeof import('@/lib/db').default
let credits: typeof import('./credits')
let topup: typeof import('./topup')
let billing: typeof import('./billing')
let rz: typeof import('@/lib/razorpay')
let mock: typeof import('@/server/dev/razorpayMock')
const users: string[] = []
const realFetch = globalThis.fetch
let hooks: { body: string; headers: Record<string, string> }[] = []

async function newUser(plan = 'creator'): Promise<string> {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan, name) VALUES (${`pay-test-${Math.random().toString(36).slice(2)}@example.test`}, ${plan}, 'Pay Test') RETURNING id`
  users.push(u.id)
  return u.id
}
/** The webhooks our code would receive, kept to be delivered to the handler under test */
const collect = async (d: { body: string; headers: Record<string, string> }) => { hooks.push(d) }
async function deliverAll() {
  const { subscriptionChange, topupChange } = rz
  for (const h of hooks) {
    const ev = JSON.parse(h.body)
    assert.equal(rz.verifyWebhookSignature(h.body, h.headers['x-razorpay-signature'], HOOK), true)
    const top = topupChange(ev)
    if (top) { await topup.applyTopup(top); continue }
    const change = subscriptionChange(ev)
    if (change?.kind === 'active') await billing.activate(change, { id: h.headers['x-razorpay-event-id'], type: ev.event })
  }
  hooks = []
}

before(async () => {
  if (!HAS_DB) return
  Object.assign(process.env, { CREDITS_MODE: 'on', CREDITS_FREE_SIGNUP: '0', RAZORPAY_KEY_ID: KEY, RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: HOOK, RAZORPAY_MOCK: '1', APP_URL: 'http://fake.local' })
  sql = (await import('@/lib/db')).default
  rz = await import('@/lib/razorpay')
  mock = await import('@/server/dev/razorpayMock')
  credits = await import('./credits')
  topup = await import('./topup')
  billing = await import('./billing')
  await credits.ensureCreditsSchema()
  // our server's calls to "Razorpay" go to the fake, in process
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const base = u.includes('/api/dev/razorpay/v1') ? '/api/dev/razorpay/v1' : u.includes('https://api.razorpay.com/v1') ? 'https://api.razorpay.com/v1' : null
    if (!base) return realFetch(url as never, init)
    const path = u.split(base)[1]
    const out = await mock.mockApi(init?.method ?? 'GET', path, init?.body ? JSON.parse(String(init.body)) : undefined, (init?.headers as Record<string, string>)?.Authorization)
    return new Response(JSON.stringify(out.body), { status: out.status })
  }) as typeof fetch
})
beforeEach(() => { if (HAS_DB) { mock.resetMock(); hooks = [] } })
after(async () => {
  globalThis.fetch = realFetch
  if (!HAS_DB) return
  if (users.length) {
    await sql`DELETE FROM payments WHERE user_id = ANY(${users})`
    await sql`DELETE FROM users WHERE id = ANY(${users})`
  }
  await sql.end({ timeout: 2 })
})

test('a top-up pack is bought, paid and verified: credits arrive once, with an invoice', opts, async () => {
  const u = await newUser()
  const order = await topup.startTopup(u, 'medium')
  assert.equal(order.amountPaise, 48900); assert.equal(order.credits, 500)
  assert.equal(order.keyId, KEY); assert.equal(order.checkoutScript, '/dev/razorpay-checkout.js')
  const paid = await mock.mockPay({ orderId: order.orderId, outcome: 'success' }, collect)
  assert.ok(paid.ok)
  const r = await topup.completeTopup(u, { orderId: order.orderId, paymentId: paid.razorpay_payment_id, signature: paid.razorpay_signature })
  assert.equal(r.credits, 500)
  assert.equal((await credits.balance(u)).balance, 500)
  // the webhook for the same payment, and a repeat of the browser's verify: nothing is added
  await deliverAll()
  await topup.completeTopup(u, { orderId: order.orderId, paymentId: paid.razorpay_payment_id, signature: paid.razorpay_signature })
  assert.equal((await credits.balance(u)).balance, 500)
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM payments WHERE user_id = ${u}`
  assert.equal(n, 1)
  const [g] = await sql<{ kind: string; expires_at: Date }[]>`SELECT kind, expires_at FROM credit_grants WHERE user_id = ${u}`
  assert.equal(g.kind, 'topup')
  assert.ok(g.expires_at.getTime() > Date.now() + 360 * 86_400_000, 'top-up credits last a year')
})

test('if the tab is closed after paying, the webhook alone gives the credits', opts, async () => {
  const u = await newUser()
  const order = await topup.startTopup(u, 'small')
  await mock.mockPay({ orderId: order.orderId, outcome: 'success' }, collect)
  await deliverAll()
  assert.equal((await credits.balance(u)).balance, 200)
})

test('a wrong signature, or someone else\'s order, gives nothing', opts, async () => {
  const u = await newUser(), other = await newUser()
  const order = await topup.startTopup(u, 'small')
  const paid = await mock.mockPay({ orderId: order.orderId, outcome: 'success' }, collect)
  assert.ok(paid.ok)
  await assert.rejects(topup.completeTopup(u, { orderId: order.orderId, paymentId: paid.razorpay_payment_id, signature: 'forged' }), (e: { status?: number }) => e.status === 400)
  await assert.rejects(topup.completeTopup(other, { orderId: order.orderId, paymentId: paid.razorpay_payment_id, signature: paid.razorpay_signature }), (e: { status?: number }) => e.status === 404)
  assert.equal((await credits.balance(u)).balance, 0)
  assert.equal((await credits.balance(other)).balance, 0)
})

test('an unknown pack is refused, and the free plan is sent to upgrade', opts, async () => {
  const u = await newUser(), free = await newUser('free')
  await assert.rejects(topup.startTopup(u, 'huge'), (e: { status?: number }) => e.status === 400)
  await assert.rejects(topup.startTopup(free, 'small'), (e: { status?: number; message?: string }) => e.status === 403 && /paid plan/i.test(e.message ?? ''))
})

test('a plan payment gives the plan\'s credits once, and each renewal gives them again', opts, async () => {
  const u = await newUser('free')
  const sub = await billing.startSubscription(u, 'creator')
  const paid = await mock.mockPay({ subscriptionId: sub.subscriptionId, outcome: 'success' }, collect)
  assert.ok(paid.ok)
  await billing.activateAfterCheckout(u, sub.subscriptionId, paid.razorpay_payment_id)
  assert.equal((await credits.balance(u)).balance, 999)
  await deliverAll()   // the webhooks for the same payment
  assert.equal((await credits.balance(u)).balance, 999)
  const [row] = await sql<{ plan: string }[]>`SELECT plan FROM users WHERE id = ${u}`
  assert.equal(row.plan, 'creator')
  await mock.mockRenew(sub.subscriptionId, collect)
  await deliverAll()
  assert.equal((await credits.balance(u)).balance, 1998)
})

test('credits are never granted for a subscription that is not the user\'s', opts, async () => {
  const owner = await newUser('free'), thief = await newUser('free')
  const sub = await billing.startSubscription(owner, 'agency')
  await mock.mockPay({ subscriptionId: sub.subscriptionId, outcome: 'success' }, collect)
  // a webhook whose notes name another user
  for (const h of hooks) {
    const ev = JSON.parse(h.body)
    ev.payload.subscription.entity.notes.user_id = thief
    const change = rz.subscriptionChange(ev)
    if (change?.kind === 'active') await billing.activate(change)
  }
  assert.equal((await credits.balance(thief)).balance, 0)
})

test('a Razorpay plan made under one set of keys is not reused under another', opts, async () => {
  const u = await newUser('free')
  const saved = { ...process.env }
  delete process.env.RAZORPAY_MOCK                      // 'test' mode: the calls go to Razorpay's address, which the stub answers
  try {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_firstkey0000001'
    await billing.startSubscription(u, 'starter')
    process.env.RAZORPAY_KEY_ID = 'rzp_test_secondkey000002'
    await billing.startSubscription(u, 'starter')
    const rows = await sql<{ key_id: string }[]>`SELECT key_id FROM billing_plans WHERE plan = 'starter' AND key_id IN ('rzp_test_firstkey0000001', 'rzp_test_secondkey000002')`
    assert.equal(rows.length, 2)
  } finally {
    Object.assign(process.env, saved)
    await sql`DELETE FROM billing_plans WHERE key_id IN ('rzp_test_firstkey0000001', 'rzp_test_secondkey000002')`
  }
})
