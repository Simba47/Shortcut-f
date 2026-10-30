import sql from '@/lib/db'
import { ensureBillingSchema } from '@/server/services/billingSchema'
import { recordPayment, recordCheckoutPayment } from '@/server/services/invoices'
import { PLANS } from '@/lib/plans'
import {
  PAID_PLAN_KEYS, type PaidPlanKey, type SubscriptionChange,
  createRazorpayPlan, createRazorpaySubscription, cancelRazorpaySubscription, fetchRazorpaySubscription, rupeesToPaise,
} from '@/lib/razorpay'

/** A renewal's webhook can arrive a little after the paid month ends: access is not cut in that gap */
const GRACE_MS = 2 * 24 * 3600 * 1000

function paidPlan(plan: unknown): PaidPlanKey {
  if (!(PAID_PLAN_KEYS as readonly string[]).includes(plan as string)) {
    throw Object.assign(new Error('Invalid plan'), { status: 400, expose: true })
  }
  return plan as PaidPlanKey
}

/** Razorpay's plan for one of ours at today's price: made on first use, then reused */
async function razorpayPlanId(plan: PaidPlanKey): Promise<string> {
  const amount = rupeesToPaise(PLANS[plan].price)
  const [have] = await sql<{ razorpay_plan_id: string }[]>`SELECT razorpay_plan_id FROM billing_plans WHERE plan = ${plan} AND amount_paise = ${amount}`
  if (have) return have.razorpay_plan_id
  const made = await createRazorpayPlan(`Shortcut ${PLANS[plan].name}`, amount)
  await sql`INSERT INTO billing_plans (plan, amount_paise, razorpay_plan_id) VALUES (${plan}, ${amount}, ${made.id}) ON CONFLICT DO NOTHING`
  const [row] = await sql<{ razorpay_plan_id: string }[]>`SELECT razorpay_plan_id FROM billing_plans WHERE plan = ${plan} AND amount_paise = ${amount}`
  return row.razorpay_plan_id
}

/** Starts checkout: a subscription at Razorpay, recorded as 'created'. The plan is not on until it is paid. */
export async function startSubscription(userId: string, planKey: unknown) {
  const plan = paidPlan(planKey)
  await ensureBillingSchema()
  const planId = await razorpayPlanId(plan)
  const sub = await createRazorpaySubscription(planId, { user_id: userId, plan })
  await sql`INSERT INTO subscriptions (user_id, plan, status, razorpay_subscription_id) VALUES (${userId}, ${plan}, 'created', ${sub.id})`
  return { subscriptionId: sub.id, plan, planName: PLANS[plan].name, amountPaise: rupeesToPaise(PLANS[plan].price) }
}

/** Turns a plan on (after a payment or an activation/charge event), and ends the user's other subscriptions */
export async function activate(c: Extract<SubscriptionChange, { kind: 'active' }>, eventId?: { id: string; type: string }): Promise<boolean> {
  await ensureBillingSchema()
  const expiresAt = c.expiresAt ?? new Date(Date.now() + 31 * 24 * 3600 * 1000)
  let others: string[] = []
  const applied = await sql.begin(async tx => {
    if (eventId) {
      const [seen] = await tx`INSERT INTO billing_events (id, type) VALUES (${eventId.id}, ${eventId.type}) ON CONFLICT DO NOTHING RETURNING id`
      if (!seen) return false
    }
    // The subscription must be one we started for this very user: notes alone are not trusted
    const [own] = await tx<{ id: string }[]>`SELECT id FROM subscriptions WHERE razorpay_subscription_id = ${c.subscriptionId} AND user_id = ${c.userId}`
    if (!own) return false
    await tx`UPDATE subscriptions SET status = 'active', plan = ${c.plan}, expires_at = ${expiresAt} WHERE id = ${own.id}`
    await tx`UPDATE users SET plan = ${c.plan} WHERE id = ${c.userId}`
    const rows = await tx<{ razorpay_subscription_id: string }[]>`
      UPDATE subscriptions SET status = 'replaced'
      WHERE user_id = ${c.userId} AND razorpay_subscription_id IS NOT NULL AND razorpay_subscription_id <> ${c.subscriptionId} AND status IN ('active', 'cancelled')
      RETURNING razorpay_subscription_id`
    others = rows.map(r => r.razorpay_subscription_id)
    return true
  })
  // The payment and its invoice, on every delivery: it is recorded once whatever the number of tries,
  // and a failure here answers an error so Razorpay sends the event again
  if (c.payment) await recordPayment(c.userId, c.subscriptionId, c.plan, c.payment)
  // A change of plan: the old subscription stops billing now (best effort; it is already replaced here)
  for (const id of others) {
    await cancelRazorpaySubscription(id, false).catch(e => console.error(`[billing] could not stop replaced subscription ${id}:`, e instanceof Error ? e.message : e))
  }
  return applied
}

/** A subscription is over. Paid time that is left stays: access ends when it runs out (see getUserPlan) */
export async function endSubscription(c: Extract<SubscriptionChange, { kind: 'ended' }>, eventId?: { id: string; type: string }): Promise<boolean> {
  await ensureBillingSchema()
  return sql.begin(async tx => {
    if (eventId) {
      const [seen] = await tx`INSERT INTO billing_events (id, type) VALUES (${eventId.id}, ${eventId.type}) ON CONFLICT DO NOTHING RETURNING id`
      if (!seen) return false
    }
    const halted = eventId?.type === 'subscription.halted'
    // Failed renewals (halted) end access now; a cancel keeps what was paid for
    await tx`
      UPDATE subscriptions SET status = ${halted ? 'ended' : 'cancelled'},
        expires_at = ${halted ? new Date() : c.expiresAt}
      WHERE razorpay_subscription_id = ${c.subscriptionId} AND status <> 'replaced'`
    return true
  })
}

/** The plan the user is on right now: a paid plan needs a paid-up Razorpay subscription (users from before payments have none and are left alone) */
export async function effectivePlan(userId: string, storedPlan: string): Promise<string> {
  if (storedPlan === 'free') return 'free'
  await ensureBillingSchema()
  const [row] = await sql<{ managed: boolean; valid: boolean }[]>`
    SELECT COUNT(*) > 0 AS managed,
      COALESCE(BOOL_OR(status IN ('active', 'cancelled') AND expires_at > ${new Date(Date.now() - GRACE_MS)}), false) AS valid
    FROM subscriptions WHERE user_id = ${userId} AND razorpay_subscription_id IS NOT NULL AND status <> 'created'`
  return row?.managed && !row.valid ? 'free' : storedPlan
}

/** Cancel at the end of the month already paid for */
export async function cancelMySubscription(userId: string) {
  await ensureBillingSchema()
  const [sub] = await sql<{ razorpay_subscription_id: string }[]>`
    SELECT razorpay_subscription_id FROM subscriptions
    WHERE user_id = ${userId} AND razorpay_subscription_id IS NOT NULL AND status = 'active' ORDER BY created_at DESC LIMIT 1`
  if (!sub) throw Object.assign(new Error('You have no active subscription to cancel.'), { status: 404, expose: true })
  const r = await cancelRazorpaySubscription(sub.razorpay_subscription_id, true)
  const endsAt = typeof r.current_end === 'number' ? new Date(r.current_end * 1000) : null
  await sql`UPDATE subscriptions SET status = 'cancelled', expires_at = COALESCE(${endsAt}, expires_at) WHERE razorpay_subscription_id = ${sub.razorpay_subscription_id}`
  return { endsAt }
}

/** Renewal or end date and state, for the plan page */
export async function subscriptionSummary(userId: string) {
  await ensureBillingSchema()
  const [row] = await sql<{ status: string; plan: string; expires_at: Date | null }[]>`
    SELECT status, plan, expires_at FROM subscriptions
    WHERE user_id = ${userId} AND razorpay_subscription_id IS NOT NULL AND status IN ('active', 'cancelled')
    ORDER BY created_at DESC LIMIT 1`
  return row ? { status: row.status, plan: row.plan, expiresAt: row.expires_at } : null
}

/** After the browser's payment: Razorpay's own record of the subscription, to confirm it is ours and when it renews */
export async function activateAfterCheckout(userId: string, subscriptionId: string, paymentId: string) {
  await ensureBillingSchema()
  const [own] = await sql<{ plan: string }[]>`SELECT plan FROM subscriptions WHERE razorpay_subscription_id = ${subscriptionId} AND user_id = ${userId}`
  if (!own) throw Object.assign(new Error('Unknown subscription'), { status: 404, expose: true })
  const remote = await fetchRazorpaySubscription(subscriptionId)
  const plan = paidPlan(own.plan)
  await activate({
    kind: 'active', subscriptionId, userId, plan,
    expiresAt: typeof remote.current_end === 'number' ? new Date(remote.current_end * 1000) : null,
  })
  // The invoice for this payment (the webhook brings the same payment later: it is recorded once)
  await recordCheckoutPayment(userId, subscriptionId, plan, paymentId).catch(e => console.error('[billing] could not record the checkout payment:', e instanceof Error ? e.message : e))
  return { plan, planName: PLANS[plan].name }
}
