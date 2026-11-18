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

test('the Trial pack (user, 2026-11-16): ₹50 once for 99 credits and the Trial plan for 14 days; once per account; unused credits carry into a plan', opts, async () => {
  const u = await newUser('free')
  const quota = await import('./quota')
  const order = await topup.startTopup(u, 'trial')
  assert.equal(order.amountPaise, 5000); assert.equal(order.credits, 99)
  await mock.mockPay({ orderId: order.orderId, outcome: 'success' }, collect)
  await deliverAll()
  await deliverAll()   // delivered again: nothing more
  assert.equal((await credits.balance(u)).balance, 99)
  assert.equal(await quota.getUserPlan(u), 'trial')
  const [g] = await sql<{ kind: string; expires_at: Date }[]>`SELECT kind, expires_at FROM credit_grants WHERE user_id = ${u}`
  assert.equal(g.kind, 'trial')
  const days = (g.expires_at.getTime() - Date.now()) / 86_400_000
  assert.ok(days > 13.9 && days <= 14, `trial credits last 14 days (${days})`)
  // on the Trial: no second trial, no top-ups
  await assert.rejects(topup.startTopup(u, 'trial'), (e: { status?: number; message?: string }) => e.status === 403 && /Trial already/.test(e.message ?? ''))
  await assert.rejects(topup.startTopup(u, 'small'), (e: { status?: number; message?: string }) => e.status === 403 && /paid plans/.test(e.message ?? ''))
  // a plan: its credits on top, and what is left of the trial's lasts as long as the plan's
  const sub = await billing.startSubscription(u, 'creator')
  const paid = await mock.mockPay({ subscriptionId: sub.subscriptionId, outcome: 'success' }, collect)
  await billing.activateAfterCheckout(u, sub.subscriptionId, paid.razorpay_payment_id)
  await deliverAll()
  assert.equal(await quota.getUserPlan(u), 'creator')
  assert.equal((await credits.balance(u)).balance, 99 + 999)
  const rows = await sql<{ kind: string; expires_at: Date }[]>`SELECT kind, expires_at FROM credit_grants WHERE user_id = ${u} ORDER BY kind`
  assert.equal(rows[0].kind, 'plan'); assert.equal(rows[1].kind, 'trial')
  assert.equal(rows[1].expires_at.getTime(), rows[0].expires_at.getTime(), 'trial credits now end with the plan credits')
  await assert.rejects(topup.startTopup(u, 'trial'), (e: { status?: number; message?: string }) => e.status === 403 && /new accounts/.test(e.message ?? ''))
})

test('a Trial that has ended: no plan again, and it cannot be bought twice', opts, async () => {
  const u = await newUser('free')
  const order = await topup.startTopup(u, 'trial')
  await mock.mockPay({ orderId: order.orderId, outcome: 'success' }, collect)
  await deliverAll()
  await sql`UPDATE topup_orders SET paid_at = now() - interval '15 days' WHERE user_id = ${u}`
  await sql`UPDATE credit_grants SET expires_at = now() - interval '1 day' WHERE user_id = ${u}`
  const quota = await import('./quota')
  assert.equal(await quota.getUserPlan(u), 'free')
  assert.equal((await credits.balance(u)).balance, 0)
  await assert.rejects(topup.startTopup(u, 'trial'), (e: { status?: number; message?: string }) => e.status === 403 && /once per account/.test(e.message ?? ''))
})

test('the ₹1 test pack (user, 2026-11-12): only for an email in TEST_PACK_EMAILS, paid and credited like any pack', opts, async () => {
  const u = await newUser('free')
  process.env.TEST_PACK_EMAILS = 'owner@example.test, Tester@Example.test'
  try {
    // not listed, or no list: the pack does not exist
    await assert.rejects(topup.startTopup(u, 'test', 'someone@example.test'), (e: { status?: number }) => e.status === 400)
    await assert.rejects(topup.startTopup(u, 'test'), (e: { status?: number }) => e.status === 400)
    // listed (any case and spacing): ₹1 for 1 credit, on the free plan too
    const order = await topup.startTopup(u, 'test', 'tester@example.test')
    assert.equal(order.amountPaise, 100); assert.equal(order.credits, 1)
    await mock.mockPay({ orderId: order.orderId, outcome: 'success' }, collect)
    await deliverAll()
    assert.equal((await credits.balance(u)).balance, 1)
  } finally { delete process.env.TEST_PACK_EMAILS }
  await assert.rejects(topup.startTopup(u, 'test', 'tester@example.test'), (e: { status?: number }) => e.status === 400)
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

test('Google Analytics: a top-up confirmed by the browser and by the webhook is one purchase, by the account id only', opts, async () => {
  // (server/analytics.ts: on with a Measurement ID and the API secret; Google's address caught here)
  const sent: { url: string; body: { client_id: string; user_id: string; events: { name: string; params: Record<string, unknown> }[] } }[] = []
  const inner = globalThis.fetch
  Object.assign(process.env, { NEXT_PUBLIC_GA_ID: 'G-TEST000', GA4: 'test-secret' })
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://www.google-analytics.com/')) { sent.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return new Response(null, { status: 204 }) }
    return inner(url as never, init)
  }) as typeof fetch
  try {
    const u = await newUser()
    const order = await topup.startTopup(u, 'medium')
    const paid = await mock.mockPay({ orderId: order.orderId, outcome: 'success' }, collect)
    await topup.completeTopup(u, { orderId: order.orderId, paymentId: paid.razorpay_payment_id, signature: paid.razorpay_signature })
    await deliverAll()
    await topup.completeTopup(u, { orderId: order.orderId, paymentId: paid.razorpay_payment_id, signature: paid.razorpay_signature })
    // (on the site it goes after the answer; here, outside a request, at once: let it land)
    await new Promise(r => setTimeout(r, 50))
    assert.equal(sent.length, 1, 'one purchase for one payment')
    assert.match(sent[0].url, /\/mp\/collect\?measurement_id=G-TEST000&api_secret=test-secret$/)
    const b = sent[0].body
    assert.equal(b.user_id, u)
    assert.match(b.client_id, /^\d+\.1$/)            // no browser here: the id made from the account
    assert.equal(b.events[0].name, 'purchase')
    const p = b.events[0].params
    assert.equal(p.transaction_id, paid.razorpay_payment_id)
    assert.equal(p.value, 489); assert.equal(p.currency, 'INR')
    assert.deepEqual(p.items, [{ item_id: 'topup:medium', item_name: '500 credits top-up', item_category: 'topup', price: 489, quantity: 1 }])
    assert.ok(!JSON.stringify(b).includes('@'), 'no email goes to Google')
  } finally {
    globalThis.fetch = inner
    delete process.env.NEXT_PUBLIC_GA_ID; delete process.env.GA4
  }
})
