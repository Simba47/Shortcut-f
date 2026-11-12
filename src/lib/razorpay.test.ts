import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  verifyPaymentSignature, verifyWebhookSignature, rupeesToPaise, subscriptionChange,
  razorpayMode, razorpayApiBase, checkoutScriptUrl, verifyOrderSignature, topupChange,
} from './razorpay.ts'

const hmac = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('hex')

test('rupees become paise without float drift', () => {
  assert.equal(rupeesToPaise(599), 59900)
  assert.equal(rupeesToPaise(2599), 259900)
  assert.equal(rupeesToPaise(19.99), 1999)
})

test('a checkout payment is genuine only with the signature of payment_id|subscription_id', () => {
  const sig = hmac('sec', 'pay_1|sub_1')
  assert.equal(verifyPaymentSignature({ paymentId: 'pay_1', subscriptionId: 'sub_1', signature: sig }, 'sec'), true)
  assert.equal(verifyPaymentSignature({ paymentId: 'pay_2', subscriptionId: 'sub_1', signature: sig }, 'sec'), false)
  assert.equal(verifyPaymentSignature({ paymentId: 'pay_1', subscriptionId: 'sub_1', signature: sig }, 'other'), false)
  assert.equal(verifyPaymentSignature({ paymentId: 'pay_1', subscriptionId: 'sub_1', signature: 'zz' }, 'sec'), false)
  assert.equal(verifyPaymentSignature({ paymentId: 'pay_1', subscriptionId: 'sub_1', signature: '' }, 'sec'), false)
})

test('a webhook is genuine only with the signature of the exact raw body', () => {
  const body = '{"event":"subscription.charged"}'
  const sig = hmac('whsec', body)
  assert.equal(verifyWebhookSignature(body, sig, 'whsec'), true)
  assert.equal(verifyWebhookSignature(body + ' ', sig, 'whsec'), false)
  assert.equal(verifyWebhookSignature(body, null, 'whsec'), false)
  assert.equal(verifyWebhookSignature(body, sig, ''), false)
})

const ev = (event: string, sub: Record<string, unknown>, payment?: Record<string, unknown>) => ({
  event, payload: { subscription: { entity: sub }, ...(payment ? { payment: { entity: payment } } : {}) },
})

test('a charge turns the plan on until the end of the paid period', () => {
  const c = subscriptionChange(ev('subscription.charged', { id: 'sub_1', status: 'active', current_end: 1790000000, notes: { user_id: 'u1', plan: 'creator' } }))
  assert.deepEqual(c, { kind: 'active', subscriptionId: 'sub_1', userId: 'u1', plan: 'creator', expiresAt: new Date(1790000000 * 1000) })
})

test('a charge carries the payment: id, amount in paise, when it was paid', () => {
  const c = subscriptionChange(ev('subscription.charged',
    { id: 'sub_1', status: 'active', current_end: 1790000000, notes: { user_id: 'u1', plan: 'creator' } },
    { id: 'pay_9', amount: 99900, currency: 'INR', status: 'captured', created_at: 1787500000 }))
  assert.deepEqual(c && 'payment' in c ? c.payment : null, { id: 'pay_9', amountPaise: 99900, paidAt: new Date(1787500000 * 1000) })
})

test('a payment that did not go through is not recorded', () => {
  const c = subscriptionChange(ev('subscription.charged',
    { id: 'sub_1', current_end: 1790000000, notes: { user_id: 'u1', plan: 'creator' } },
    { id: 'pay_9', amount: 99900, status: 'failed', created_at: 1787500000 }))
  assert.equal(c?.kind, 'active')
  assert.equal(c && 'payment' in c, false)
})

test('activation works the same as a charge', () => {
  const c = subscriptionChange(ev('subscription.activated', { id: 'sub_1', status: 'active', current_end: 1790000000, notes: { user_id: 'u1', plan: 'starter' } }))
  assert.equal(c?.kind, 'active')
})

test('a cancelled, completed or expired subscription ends access; the date is when paid time runs out', () => {
  for (const name of ['subscription.cancelled', 'subscription.completed', 'subscription.expired']) {
    const c = subscriptionChange(ev(name, { id: 'sub_1', status: 'cancelled', current_end: 1790000000, notes: { user_id: 'u1', plan: 'creator' } }))
    assert.equal(c?.kind, 'ended', name)
    assert.equal(c?.subscriptionId, 'sub_1')
  }
})

test('a halted subscription (renewal payment kept failing) ends access', () => {
  assert.equal(subscriptionChange(ev('subscription.halted', { id: 'sub_1', notes: { user_id: 'u1', plan: 'creator' } }))?.kind, 'ended')
})

test('a plan name we do not sell is ignored, so nobody gets a plan from forged notes', () => {
  assert.equal(subscriptionChange(ev('subscription.charged', { id: 'sub_1', current_end: 1, notes: { user_id: 'u1', plan: 'free' } })), null)
  assert.equal(subscriptionChange(ev('subscription.charged', { id: 'sub_1', current_end: 1, notes: { user_id: 'u1', plan: 'enterprise' } })), null)
})

test('other events and malformed bodies change nothing', () => {
  assert.equal(subscriptionChange(ev('payment.failed', { id: 'sub_1' })), null)
  assert.equal(subscriptionChange({ event: 'subscription.charged' } as never), null)
  assert.equal(subscriptionChange(null as never), null)
  assert.equal(subscriptionChange(ev('subscription.charged', { id: 'sub_1', current_end: 1790000000, notes: {} })), null)
})

const DUMMY = { RAZORPAY_KEY_ID: 'rzp_test_dummykey000001', RAZORPAY_KEY_SECRET: 'dummysecret' }

test('mode: off without keys; test or live by the key; mock only with RAZORPAY_MOCK=1, a test key and not in production', () => {
  assert.equal(razorpayMode({}), 'off')
  assert.equal(razorpayMode({ ...DUMMY }), 'test')
  assert.equal(razorpayMode({ RAZORPAY_KEY_ID: 'rzp_live_abc', RAZORPAY_KEY_SECRET: 's' }), 'live')
  assert.equal(razorpayMode({ ...DUMMY, RAZORPAY_MOCK: '1' }), 'mock')
  // a live key is never mocked, and production never mocks
  assert.equal(razorpayMode({ RAZORPAY_KEY_ID: 'rzp_live_abc', RAZORPAY_KEY_SECRET: 's', RAZORPAY_MOCK: '1' }), 'live')
  assert.equal(razorpayMode({ ...DUMMY, RAZORPAY_MOCK: '1', NODE_ENV: 'production' }), 'test')
})

test('a deployed site mocks only with a second switch set on purpose, and never with a live key', () => {
  const deployed = { ...DUMMY, NODE_ENV: 'production', RAZORPAY_MOCK_ON_DEPLOYED_SITE: '1' }
  assert.equal(razorpayMode({ ...deployed, RAZORPAY_MOCK: '1' }), 'mock')
  assert.equal(razorpayMode(deployed), 'test')
  assert.equal(razorpayMode({ ...deployed, RAZORPAY_MOCK: '1', RAZORPAY_KEY_ID: 'rzp_live_abc' }), 'live')
})

test('the API address is Razorpay, or our own fake one in mock mode', () => {
  assert.equal(razorpayApiBase({ ...DUMMY }), 'https://api.razorpay.com/v1')
  assert.equal(razorpayApiBase({ ...DUMMY, RAZORPAY_MOCK: '1', APP_URL: 'http://localhost:3100/' }), 'http://localhost:3100/api/dev/razorpay/v1')
  assert.equal(razorpayApiBase({ ...DUMMY, RAZORPAY_MOCK: '1' }), 'http://localhost:3000/api/dev/razorpay/v1')
})

test('the checkout window script is Razorpay\'s, or our own fake one in mock mode', () => {
  assert.equal(checkoutScriptUrl({ ...DUMMY }), 'https://checkout.razorpay.com/v1/checkout.js')
  assert.equal(checkoutScriptUrl({ ...DUMMY, RAZORPAY_MOCK: '1' }), '/dev/razorpay-checkout.js')
})

test('an order payment is genuine only with the signature of order_id|payment_id', () => {
  const sig = hmac('sec', 'order_1|pay_1')
  assert.equal(verifyOrderSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: sig }, 'sec'), true)
  assert.equal(verifyOrderSignature({ orderId: 'order_2', paymentId: 'pay_1', signature: sig }, 'sec'), false)
  assert.equal(verifyOrderSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: sig }, 'other'), false)
  assert.equal(verifyOrderSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: '' }, 'sec'), false)
})

const orderPaid = (over: Record<string, unknown> = {}, amount = 49900) => ({
  event: 'order.paid',
  payload: {
    order: { entity: { id: 'order_1', amount_paid: amount, notes: { kind: 'topup', user_id: 'u1', pack: 'medium', credits: '999999', ...over } } },
    payment: { entity: { id: 'pay_1', amount, status: 'captured', created_at: 1_700_000_000 } },
  },
})

test('a paid top-up order becomes credits by its pack, never by the credits in the notes', () => {
  const c = topupChange(orderPaid())
  assert.ok(c)
  assert.equal(c.userId, 'u1'); assert.equal(c.pack, 'medium'); assert.equal(c.orderId, 'order_1')
  assert.equal(c.credits, 500)
  assert.equal(c.payment.id, 'pay_1'); assert.equal(c.payment.amountPaise, 49900)
})

test('a top-up event that is not for a known pack, not paid in full, or not a top-up changes nothing', () => {
  assert.equal(topupChange(orderPaid({ pack: 'huge' })), null)
  assert.equal(topupChange(orderPaid({}, 100)), null)
  assert.equal(topupChange(orderPaid({ kind: 'plan' })), null)
  assert.equal(topupChange(orderPaid({ user_id: '' })), null)
  assert.equal(topupChange({ event: 'payment.captured', payload: {} }), null)
  assert.equal(topupChange(null), null)
})
