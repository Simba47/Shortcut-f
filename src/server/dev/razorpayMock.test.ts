import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { verifyPaymentSignature, verifyOrderSignature, verifyWebhookSignature, subscriptionChange, topupChange } from '@/lib/razorpay'
import { mockApi, mockPay, mockRenew, mockHalt, resetMock, type Delivery } from './razorpayMock'

const KEY = 'rzp_test_dummykey000001', SECRET = 'dummysecret', HOOK = 'dummywebhooksecret'
process.env.RAZORPAY_KEY_ID = KEY
process.env.RAZORPAY_KEY_SECRET = SECRET
process.env.RAZORPAY_WEBHOOK_SECRET = HOOK
const auth = 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64')

let sent: Delivery[] = []
const send = async (d: Delivery) => { sent.push(d) }
beforeEach(() => { resetMock(); sent = [] })

test('the fake API refuses wrong keys, as Razorpay does', async () => {
  const bad = await mockApi('POST', '/plans', { item: { amount: 100 } }, 'Basic ' + Buffer.from('rzp_test_x:wrong').toString('base64'))
  assert.equal(bad.status, 401)
  assert.equal((await mockApi('POST', '/plans', { item: { amount: 100 } }, undefined)).status, 401)
})

async function subscribe() {
  const plan = await mockApi('POST', '/plans', { period: 'monthly', interval: 1, item: { name: 'Shortcut Creator', amount: 99900, currency: 'INR' } }, auth)
  const sub = await mockApi('POST', '/subscriptions', { plan_id: plan.body.id, total_count: 120, notes: { user_id: 'u1', plan: 'creator' } }, auth)
  return sub.body as { id: string }
}

test('paying a subscription gives a signature our verifier accepts, and signed webhooks that mean "active"', async () => {
  const sub = await subscribe()
  const r = await mockPay({ subscriptionId: sub.id, outcome: 'success' }, send)
  assert.ok(r.ok)
  assert.equal(verifyPaymentSignature({ paymentId: r.razorpay_payment_id, subscriptionId: sub.id, signature: r.razorpay_signature }, SECRET), true)
  const names = sent.map(d => JSON.parse(d.body).event)
  assert.deepEqual(names, ['subscription.activated', 'subscription.charged'])
  for (const d of sent) assert.equal(verifyWebhookSignature(d.body, d.headers['x-razorpay-signature'], HOOK), true)
  const change = subscriptionChange(JSON.parse(sent[1].body))
  assert.ok(change && change.kind === 'active')
  assert.equal(change.plan, 'creator'); assert.equal(change.userId, 'u1')
  assert.equal(change.payment?.amountPaise, 99900)
  assert.ok(change.expiresAt && change.expiresAt.getTime() > Date.now() + 25 * 86_400_000)
  // each delivery has its own event id (Razorpay's repeat-safety relies on it)
  assert.notEqual(sent[0].headers['x-razorpay-event-id'], sent[1].headers['x-razorpay-event-id'])
  const fetched = await mockApi('GET', `/subscriptions/${sub.id}`, undefined, auth)
  assert.equal(fetched.body.status, 'active')
  const pay = await mockApi('GET', `/payments/${r.razorpay_payment_id}`, undefined, auth)
  assert.equal(pay.body.status, 'captured'); assert.equal(pay.body.amount, 99900)
})

test('a renewal is another charge with a later end date; a halt ends the subscription', async () => {
  const sub = await subscribe()
  const first = await mockPay({ subscriptionId: sub.id, outcome: 'success' }, send)
  sent = []
  const again = await mockRenew(sub.id, send)
  assert.ok(again.ok); assert.notEqual(again.paymentId, first.razorpay_payment_id)
  assert.deepEqual(sent.map(d => JSON.parse(d.body).event), ['subscription.charged'])
  const end1 = subscriptionChange(JSON.parse(sent[0].body))
  assert.ok(end1 && end1.kind === 'active' && end1.expiresAt!.getTime() > Date.now() + 55 * 86_400_000)
  sent = []
  await mockHalt(sub.id, send)
  assert.equal(subscriptionChange(JSON.parse(sent[0].body))?.kind, 'ended')
})

test('cancelling at the end of the cycle keeps the end date', async () => {
  const sub = await subscribe()
  await mockPay({ subscriptionId: sub.id, outcome: 'success' }, send)
  const c = await mockApi('POST', `/subscriptions/${sub.id}/cancel`, { cancel_at_cycle_end: 1 }, auth)
  assert.equal(c.body.status, 'cancelled')
  assert.ok(c.body.current_end > Date.now() / 1000)
})

test('a top-up order: paying it gives an order signature and an order.paid webhook that means credits', async () => {
  const order = await mockApi('POST', '/orders', { amount: 49900, currency: 'INR', receipt: 'topup_1', notes: { kind: 'topup', user_id: 'u1', pack: 'medium', credits: '150' } }, auth)
  assert.equal(order.status, 200)
  const r = await mockPay({ orderId: order.body.id, outcome: 'success' }, send)
  assert.ok(r.ok)
  assert.equal(verifyOrderSignature({ orderId: order.body.id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }, SECRET), true)
  const ev = sent.find(d => JSON.parse(d.body).event === 'order.paid')!
  assert.equal(verifyWebhookSignature(ev.body, ev.headers['x-razorpay-signature'], HOOK), true)
  const t = topupChange(JSON.parse(ev.body))
  assert.ok(t); assert.equal(t.credits, 150); assert.equal(t.userId, 'u1')
  const fetched = await mockApi('GET', `/orders/${order.body.id}`, undefined, auth)
  assert.equal(fetched.body.status, 'paid'); assert.equal(fetched.body.amount_paid, 49900)
})

test('a failed payment changes nothing and sends no paid event', async () => {
  const sub = await subscribe()
  const r = await mockPay({ subscriptionId: sub.id, outcome: 'fail' }, send)
  assert.equal(r.ok, false)
  assert.equal(sent.length, 0)
  assert.equal((await mockApi('GET', `/subscriptions/${sub.id}`, undefined, auth)).body.status, 'created')
})

test('unknown ids and paths answer 404, like Razorpay', async () => {
  assert.equal((await mockApi('GET', '/subscriptions/sub_nope', undefined, auth)).status, 404)
  assert.equal((await mockApi('GET', '/orders/order_nope', undefined, auth)).status, 404)
  assert.equal((await mockApi('GET', '/nothing', undefined, auth)).status, 404)
})
