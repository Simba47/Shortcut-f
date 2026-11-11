import { createHmac, timingSafeEqual } from 'node:crypto'
import { findTopupPack, type TopupPackKey } from './credits'

// Razorpay, over its REST API (no SDK: three calls and two signature checks). Keys come from
// RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET; the webhook is signed with RAZORPAY_WEBHOOK_SECRET.
// Kept free of imports from the app so it can be tested on its own (razorpay.test.ts).

/** The plans that are sold: 'free' is never bought, and nothing else is a plan */
export const PAID_PLAN_KEYS = ['starter', 'creator', 'agency'] as const
export type PaidPlanKey = typeof PAID_PLAN_KEYS[number]

type Env = Record<string, string | undefined>

/**
 * How Razorpay is reached, decided by the keys alone so swapping them is the whole change:
 *   off   no keys: nothing is sold
 *   mock  RAZORPAY_MOCK=1 with a test key, never in production: our own fake Razorpay (api/dev/razorpay)
 *         answers, so the whole flow runs with dummy keys and no account. A deployed site (always
 *         production) mocks only with RAZORPAY_MOCK_ON_DEPLOYED_SITE=1 as well: anyone signed in can
 *         then buy a plan for nothing, so it is for a site with no real customers (own-model, the
 *         user's call 2026-11-11, "on until I say off")
 *   test  a real Razorpay test key (rzp_test_...): Razorpay's test mode, test cards and UPI
 *   live  a live key (rzp_live_...): real money
 */
export type RazorpayMode = 'off' | 'mock' | 'test' | 'live'
export function razorpayMode(env: Env = process.env): RazorpayMode {
  const id = env.RAZORPAY_KEY_ID, secret = env.RAZORPAY_KEY_SECRET
  if (!id || !secret) return 'off'
  const mockAllowed = env.NODE_ENV !== 'production' || env.RAZORPAY_MOCK_ON_DEPLOYED_SITE === '1'
  if (id.startsWith('rzp_test_') && env.RAZORPAY_MOCK === '1' && mockAllowed) return 'mock'
  return id.startsWith('rzp_live_') ? 'live' : 'test'
}

/** Razorpay's REST address; in mock mode the fake one inside this site (RAZORPAY_MOCK_URL, else APP_URL, else the dev port) */
export function razorpayApiBase(env: Env = process.env): string {
  if (razorpayMode(env) !== 'mock') return 'https://api.razorpay.com/v1'
  const site = (env.RAZORPAY_MOCK_URL || env.APP_URL || env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/+$/, '')
  return `${site}/api/dev/razorpay/v1`
}

/** The script that opens the payment window: Razorpay's, or our fake one (public/dev/razorpay-checkout.js) */
export function checkoutScriptUrl(env: Env = process.env): string {
  return razorpayMode(env) === 'mock' ? '/dev/razorpay-checkout.js' : 'https://checkout.razorpay.com/v1/checkout.js'
}

export function razorpayConfigured(): boolean {
  return razorpayMode() !== 'off'
}

/** Razorpay counts money in paise (₹599 = 59900) */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100)
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const hmacHex = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('hex')

/** The browser's answer after paying is genuine only if signed with our secret over payment_id|subscription_id */
export function verifyPaymentSignature(p: { paymentId: string; subscriptionId: string; signature: string }, secret: string): boolean {
  if (!secret || !p.paymentId || !p.subscriptionId || !p.signature) return false
  return safeEqual(hmacHex(secret, `${p.paymentId}|${p.subscriptionId}`), p.signature)
}

/** The same check for a payment on an order (top-ups): signed over order_id|payment_id */
export function verifyOrderSignature(p: { orderId: string; paymentId: string; signature: string }, secret: string): boolean {
  if (!secret || !p.orderId || !p.paymentId || !p.signature) return false
  return safeEqual(hmacHex(secret, `${p.orderId}|${p.paymentId}`), p.signature)
}

/** A webhook is genuine only if signed over the exact raw body with the webhook secret */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature) return false
  return safeEqual(hmacHex(secret, rawBody), signature)
}

type SubEntity = { id?: string; status?: string; current_end?: number | null; notes?: Record<string, unknown> | unknown[] }
/** A payment that went through, as the invoice needs it */
export interface PaidPayment { id: string; amountPaise: number; paidAt: Date }
type PaymentEntity = { id?: string; amount?: number; status?: string; created_at?: number }
export type SubscriptionChange =
  | { kind: 'active'; subscriptionId: string; userId: string; plan: PaidPlanKey; expiresAt: Date | null; payment?: PaidPayment }
  | { kind: 'ended'; subscriptionId: string; userId: string | null; plan: string | null; expiresAt: Date | null }

/**
 * What a webhook event means for a subscription: paid and running, or over. Anything else (a
 * payment event, an unknown plan name, a body that is not what we expect) changes nothing.
 */
/** The payment in an event, when it was taken ('captured' or 'authorized') */
export function paidPayment(p: PaymentEntity | undefined | null): PaidPayment | undefined {
  if (!p?.id || typeof p.amount !== 'number' || !(p.status === 'captured' || p.status === 'authorized')) return undefined
  return { id: p.id, amountPaise: p.amount, paidAt: new Date((p.created_at ?? Math.floor(Date.now() / 1000)) * 1000) }
}

export function subscriptionChange(event: { event?: string; payload?: { subscription?: { entity?: SubEntity }; payment?: { entity?: PaymentEntity } } } | null): SubscriptionChange | null {
  const name = event?.event
  const sub = event?.payload?.subscription?.entity
  if (!name || !sub?.id) return null
  const notes = (sub.notes && !Array.isArray(sub.notes) ? sub.notes : {}) as Record<string, unknown>
  const userId = typeof notes.user_id === 'string' ? notes.user_id : null
  const plan = typeof notes.plan === 'string' ? notes.plan : null
  const expiresAt = typeof sub.current_end === 'number' ? new Date(sub.current_end * 1000) : null
  if (name === 'subscription.activated' || name === 'subscription.charged') {
    if (!userId || !plan || !(PAID_PLAN_KEYS as readonly string[]).includes(plan)) return null
    const payment = paidPayment(event?.payload?.payment?.entity)
    return { kind: 'active', subscriptionId: sub.id, userId, plan: plan as PaidPlanKey, expiresAt, ...(payment ? { payment } : {}) }
  }
  if (['subscription.cancelled', 'subscription.completed', 'subscription.expired', 'subscription.halted'].includes(name)) {
    return { kind: 'ended', subscriptionId: sub.id, userId, plan, expiresAt }
  }
  return null
}

/** A top-up that was paid in full, as the credits need it */
export interface TopupChange { kind: 'topup'; orderId: string; userId: string; pack: TopupPackKey; credits: number; payment: PaidPayment }
type OrderEntity = { id?: string; amount_paid?: number; notes?: Record<string, unknown> | unknown[] }

/**
 * What an `order.paid` event means: a pack bought and paid in full. The credits come from our own
 * pack table by its key, never from the notes, and the amount paid must cover the pack's price.
 */
export function topupChange(event: { event?: string; payload?: { order?: { entity?: OrderEntity }; payment?: { entity?: PaymentEntity } } } | null): TopupChange | null {
  if (event?.event !== 'order.paid') return null
  const order = event.payload?.order?.entity
  const payment = paidPayment(event.payload?.payment?.entity)
  if (!order?.id || !payment) return null
  const notes = (order.notes && !Array.isArray(order.notes) ? order.notes : {}) as Record<string, unknown>
  const userId = typeof notes.user_id === 'string' ? notes.user_id : ''
  // the test pack too: applyTopup still needs our own order for this user, made only for someone allowed it
  const pack = findTopupPack(notes.pack, { test: true })
  if (notes.kind !== 'topup' || !userId || !pack) return null
  if ((order.amount_paid ?? payment.amountPaise) < rupeesToPaise(pack.price)) return null
  return { kind: 'topup', orderId: order.id, userId, pack: pack.key, credits: pack.credits, payment }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET
  if (!id || !secret) throw Object.assign(new Error('Payments are not set up yet'), { status: 503, expose: true })
  const res = await fetch(`${razorpayApiBase()}${path}`, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  if (!res.ok) {
    // Razorpay's reason goes to the log, not to the customer
    console.error(`[razorpay] ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`)
    throw Object.assign(new Error('The payment service did not accept the request. Please try again.'), { status: 502, expose: true })
  }
  return JSON.parse(text) as T
}

/** A monthly plan at `amountPaise`, made once and then reused (see billing.ts) */
export const createRazorpayPlan = (name: string, amountPaise: number) =>
  call<{ id: string }>('POST', '/plans', { period: 'monthly', interval: 1, item: { name, amount: amountPaise, currency: 'INR' } })

/** A subscription to a plan; `total_count` is the number of billing cycles (10 years of months) */
export const createRazorpaySubscription = (planId: string, notes: Record<string, string>) =>
  call<{ id: string; status: string }>('POST', '/subscriptions', { plan_id: planId, total_count: 120, customer_notify: 1, notes })

/** Ends a subscription: at the end of the month already paid for, or at once */
export const cancelRazorpaySubscription = (subscriptionId: string, atCycleEnd: boolean) =>
  call<{ id: string; status: string; current_end?: number | null }>('POST', `/subscriptions/${subscriptionId}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 })

export const fetchRazorpaySubscription = (subscriptionId: string) =>
  call<{ id: string; status: string; current_end?: number | null; notes?: Record<string, unknown> }>('GET', `/subscriptions/${subscriptionId}`)

export const fetchRazorpayPayment = (paymentId: string) =>
  call<PaymentEntity & { currency?: string; order_id?: string }>('GET', `/payments/${paymentId}`)

/** An order for a one-time payment (a top-up pack); the checkout window pays it and the webhook says when it is paid */
export const createRazorpayOrder = (amountPaise: number, receipt: string, notes: Record<string, string>) =>
  call<{ id: string; amount: number; status: string }>('POST', '/orders', { amount: amountPaise, currency: 'INR', receipt, notes })

export const fetchRazorpayOrder = (orderId: string) =>
  call<{ id: string; amount: number; amount_paid?: number; status: string; notes?: Record<string, unknown> }>('GET', `/orders/${orderId}`)
