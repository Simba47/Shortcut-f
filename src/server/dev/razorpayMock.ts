import { createHmac, randomBytes } from 'node:crypto'

// A stand-in for Razorpay, for running the whole payment flow with dummy keys and no account.
// Used only when razorpayMode() is 'mock' (RAZORPAY_MOCK=1, a rzp_test_ key, not in production):
// api/dev/razorpay/* answers the same calls Razorpay would, and public/dev/razorpay-checkout.js
// stands in for Razorpay's payment window. Our own code does not know the difference: it signs
// and verifies exactly as it will with real keys, so changing the keys is the whole switch.
// State lives in memory (gone when the server restarts) — it is a toy, not a database.

export interface Delivery { url: string; body: string; headers: Record<string, string> }
export type Sender = (d: Delivery) => Promise<void>

type Sub = { id: string; plan_id: string; status: 'created' | 'active' | 'cancelled' | 'halted'; current_end: number | null; notes: Record<string, unknown>; total_count: number }
type Order = { id: string; amount: number; amount_paid: number; currency: string; receipt: string; notes: Record<string, unknown>; status: 'created' | 'paid' }
type Method = 'card' | 'upi' | 'netbanking' | 'wallet'
const METHODS: Method[] = ['card', 'upi', 'netbanking', 'wallet']
type Pay = { id: string; amount: number; status: 'captured'; created_at: number; currency: string; method: Method; order_id?: string; subscription_id?: string }
interface Store { plans: Map<string, { id: string; amount: number }>; subs: Map<string, Sub>; orders: Map<string, Order>; payments: Map<string, Pay> }

const g = globalThis as { __rzpMock?: Store }
const fresh = (): Store => ({ plans: new Map(), subs: new Map(), orders: new Map(), payments: new Map() })
const store = () => (g.__rzpMock ??= fresh())
export function resetMock() { g.__rzpMock = fresh() }

const DAY = 86_400
const now = () => Math.floor(Date.now() / 1000)
const id = (prefix: string) => `${prefix}_mock${randomBytes(7).toString('hex')}`
const hmac = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('hex')
const keySecret = () => process.env.RAZORPAY_KEY_SECRET ?? ''
const err = (status: number, description: string) => ({ status, body: { error: { code: 'BAD_REQUEST_ERROR', description } } })

/** Where our webhook lives: this same site (RAZORPAY_MOCK_URL, else APP_URL, else the dev port) */
export function webhookUrl(env: Record<string, string | undefined> = process.env) {
  const site = (env.RAZORPAY_MOCK_URL || env.APP_URL || env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/+$/, '')
  return `${site}/api/billing/webhook`
}

/** Razorpay's REST API, as far as this site uses it. `authorization` is the Basic header; wrong keys get 401. */
export async function mockApi(method: string, path: string, body: Record<string, unknown> | undefined, authorization: string | undefined): Promise<{ status: number; body: Record<string, any> }> {
  const want = 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')
  if (!authorization || authorization !== want) return err(401, 'Authentication failed')
  const s = store()
  const parts = path.replace(/^\/+|\/+$/g, '').split('/')
  const [kind, rid, action] = parts

  if (kind === 'plans' && method === 'POST' && !rid) {
    const item = (body?.item ?? {}) as { amount?: number }
    if (!item.amount) return err(400, 'The amount is required')
    const plan = { id: id('plan'), amount: item.amount }
    s.plans.set(plan.id, plan)
    return { status: 200, body: { ...plan, entity: 'plan', period: body?.period, interval: body?.interval, item } }
  }
  if (kind === 'subscriptions' && method === 'POST' && !rid) {
    const planId = String(body?.plan_id ?? '')
    if (!s.plans.has(planId)) return err(400, 'The id provided does not exist')
    const sub: Sub = { id: id('sub'), plan_id: planId, status: 'created', current_end: null, notes: (body?.notes ?? {}) as Record<string, unknown>, total_count: Number(body?.total_count ?? 12) }
    s.subs.set(sub.id, sub)
    return { status: 200, body: { ...sub, entity: 'subscription' } }
  }
  if (kind === 'subscriptions' && rid) {
    const sub = s.subs.get(rid)
    if (!sub) return err(404, 'The requested URL was not found on the server.')
    if (method === 'GET' && !action) return { status: 200, body: { ...sub, entity: 'subscription' } }
    if (method === 'POST' && action === 'cancel') {
      sub.status = 'cancelled'
      if (!body?.cancel_at_cycle_end) sub.current_end = now()
      return { status: 200, body: { ...sub, entity: 'subscription' } }
    }
  }
  if (kind === 'orders' && method === 'POST' && !rid) {
    const amount = Number(body?.amount)
    if (!Number.isInteger(amount) || amount < 100) return err(400, 'Order amount less than minimum amount allowed')
    const order: Order = { id: id('order'), amount, amount_paid: 0, currency: String(body?.currency ?? 'INR'), receipt: String(body?.receipt ?? ''), notes: (body?.notes ?? {}) as Record<string, unknown>, status: 'created' }
    s.orders.set(order.id, order)
    return { status: 200, body: { ...order, entity: 'order' } }
  }
  if (kind === 'orders' && rid && method === 'GET') {
    const order = s.orders.get(rid)
    return order ? { status: 200, body: { ...order, entity: 'order' } } : err(404, 'The requested URL was not found on the server.')
  }
  if (kind === 'payments' && rid && method === 'GET') {
    const pay = s.payments.get(rid)
    return pay ? { status: 200, body: { ...pay, entity: 'payment' } } : err(404, 'The requested URL was not found on the server.')
  }
  return err(404, 'The requested URL was not found on the server.')
}

/** Signs and posts one webhook the way Razorpay does: the raw body, its HMAC, and a unique event id */
export const sendWebhook: Sender = async d => {
  const res = await fetch(d.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...d.headers }, body: d.body })
  if (!res.ok) console.error(`[razorpay mock] our webhook answered ${res.status}`)
}

async function emit(send: Sender, event: string, payload: Record<string, unknown>) {
  const body = JSON.stringify({ entity: 'event', event, created_at: now(), payload })
  await send({
    url: webhookUrl(), body,
    headers: { 'x-razorpay-signature': hmac(process.env.RAZORPAY_WEBHOOK_SECRET ?? '', body), 'x-razorpay-event-id': id('evt') },
  })
}

const subEntity = (sub: Sub) => ({ entity: { id: sub.id, status: sub.status, current_end: sub.current_end, notes: sub.notes } })
const payEntity = (p: Pay) => ({ entity: { id: p.id, amount: p.amount, status: p.status, created_at: p.created_at } })

function newPayment(amount: number, extra: Partial<Pay>): Pay {
  const p: Pay = { id: id('pay'), amount, status: 'captured', created_at: now(), currency: 'INR', method: 'card', ...extra }
  store().payments.set(p.id, p)
  return p
}

export type PayResult =
  | { ok: true; razorpay_payment_id: string; razorpay_signature: string; razorpay_subscription_id?: string; razorpay_order_id?: string }
  | { ok: false; error: string }

/**
 * The customer pays in the fake checkout window. Success: a payment is captured, the answer carries
 * the signature the browser would get, and Razorpay's events are sent to our webhook. Fail: nothing changes.
 */
export async function mockPay(a: { subscriptionId?: string; orderId?: string; outcome: 'success' | 'fail'; method?: string }, send: Sender = sendWebhook): Promise<PayResult> {
  const s = store()
  const method = METHODS.find(m => m === a.method) ?? 'card'
  if (a.outcome === 'fail') return { ok: false, error: 'The payment failed (dummy payment, nothing was charged).' }
  if (a.subscriptionId) {
    const sub = s.subs.get(a.subscriptionId)
    if (!sub) return { ok: false, error: 'Unknown subscription' }
    const pay = newPayment(s.plans.get(sub.plan_id)!.amount, { subscription_id: sub.id, method })
    sub.status = 'active'
    sub.current_end = now() + 30 * DAY
    await emit(send, 'subscription.activated', { subscription: subEntity(sub), payment: payEntity(pay) })
    await emit(send, 'subscription.charged', { subscription: subEntity(sub), payment: payEntity(pay) })
    return { ok: true, razorpay_payment_id: pay.id, razorpay_subscription_id: sub.id, razorpay_signature: hmac(keySecret(), `${pay.id}|${sub.id}`) }
  }
  if (a.orderId) {
    const order = s.orders.get(a.orderId)
    if (!order) return { ok: false, error: 'Unknown order' }
    if (order.status === 'paid') return { ok: false, error: 'This order is already paid' }
    const pay = newPayment(order.amount, { order_id: order.id, method })
    order.status = 'paid'
    order.amount_paid = order.amount
    await emit(send, 'payment.captured', { payment: payEntity(pay) })
    await emit(send, 'order.paid', { order: { entity: { id: order.id, amount_paid: order.amount_paid, notes: order.notes } }, payment: payEntity(pay) })
    return { ok: true, razorpay_payment_id: pay.id, razorpay_order_id: order.id, razorpay_signature: hmac(keySecret(), `${order.id}|${pay.id}`) }
  }
  return { ok: false, error: 'Nothing to pay' }
}

/** What the payment window shows before the customer pays: how much, and whether it is a plan or a one-time order */
export function mockInfo(a: { subscriptionId?: string; orderId?: string }): { ok: true; amount: number; currency: string; kind: 'subscription' | 'order' } | { ok: false } {
  const s = store()
  const sub = a.subscriptionId ? s.subs.get(a.subscriptionId) : undefined
  if (sub) return { ok: true, amount: s.plans.get(sub.plan_id)!.amount, currency: 'INR', kind: 'subscription' }
  const order = a.orderId ? s.orders.get(a.orderId) : undefined
  return order ? { ok: true, amount: order.amount, currency: order.currency, kind: 'order' } : { ok: false }
}

/** A monthly renewal: another charge, and a later end date */
export async function mockRenew(subscriptionId: string, send: Sender = sendWebhook): Promise<{ ok: true; paymentId: string } | { ok: false; error: string }> {
  const s = store()
  const sub = s.subs.get(subscriptionId)
  if (!sub || sub.status !== 'active') return { ok: false, error: 'Only an active subscription renews' }
  const pay = newPayment(s.plans.get(sub.plan_id)!.amount, { subscription_id: sub.id })
  sub.current_end = (sub.current_end ?? now()) + 30 * DAY
  await emit(send, 'subscription.charged', { subscription: subEntity(sub), payment: payEntity(pay) })
  return { ok: true, paymentId: pay.id }
}

/** Renewals keep failing: Razorpay gives up and halts the subscription */
export async function mockHalt(subscriptionId: string, send: Sender = sendWebhook): Promise<{ ok: boolean }> {
  const sub = store().subs.get(subscriptionId)
  if (!sub) return { ok: false }
  sub.status = 'halted'
  await emit(send, 'subscription.halted', { subscription: subEntity(sub) })
  return { ok: true }
}
