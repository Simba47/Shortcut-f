import { createHmac, timingSafeEqual } from 'node:crypto'

// Razorpay, over its REST API (no SDK: three calls and two signature checks). Keys come from
// RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET; the webhook is signed with RAZORPAY_WEBHOOK_SECRET.
// Kept free of imports from the app so it can be tested on its own (razorpay.test.ts).

/** The plans that are sold: 'free' is never bought, and nothing else is a plan */
export const PAID_PLAN_KEYS = ['starter', 'creator', 'agency'] as const
export type PaidPlanKey = typeof PAID_PLAN_KEYS[number]

const API = 'https://api.razorpay.com/v1'

export function razorpayConfigured(): boolean {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
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

/** A webhook is genuine only if signed over the exact raw body with the webhook secret */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature) return false
  return safeEqual(hmacHex(secret, rawBody), signature)
}

type SubEntity = { id?: string; status?: string; current_end?: number | null; notes?: Record<string, unknown> | unknown[] }
export type SubscriptionChange =
  | { kind: 'active'; subscriptionId: string; userId: string; plan: PaidPlanKey; expiresAt: Date | null }
  | { kind: 'ended'; subscriptionId: string; userId: string | null; plan: string | null; expiresAt: Date | null }

/**
 * What a webhook event means for a subscription: paid and running, or over. Anything else (a
 * payment event, an unknown plan name, a body that is not what we expect) changes nothing.
 */
export function subscriptionChange(event: { event?: string; payload?: { subscription?: { entity?: SubEntity } } } | null): SubscriptionChange | null {
  const name = event?.event
  const sub = event?.payload?.subscription?.entity
  if (!name || !sub?.id) return null
  const notes = (sub.notes && !Array.isArray(sub.notes) ? sub.notes : {}) as Record<string, unknown>
  const userId = typeof notes.user_id === 'string' ? notes.user_id : null
  const plan = typeof notes.plan === 'string' ? notes.plan : null
  const expiresAt = typeof sub.current_end === 'number' ? new Date(sub.current_end * 1000) : null
  if (name === 'subscription.activated' || name === 'subscription.charged') {
    if (!userId || !plan || !(PAID_PLAN_KEYS as readonly string[]).includes(plan)) return null
    return { kind: 'active', subscriptionId: sub.id, userId, plan: plan as PaidPlanKey, expiresAt }
  }
  if (['subscription.cancelled', 'subscription.completed', 'subscription.expired', 'subscription.halted'].includes(name)) {
    return { kind: 'ended', subscriptionId: sub.id, userId, plan, expiresAt }
  }
  return null
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET
  if (!id || !secret) throw Object.assign(new Error('Payments are not set up yet'), { status: 503, expose: true })
  const res = await fetch(`${API}${path}`, {
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
