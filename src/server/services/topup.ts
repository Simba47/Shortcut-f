import { randomUUID } from 'node:crypto'
import sql from '@/lib/db'
import { TOPUP_PACKS, TOPUP_CREDIT_DAYS } from '@/lib/credits'
import {
  checkoutScriptUrl, createRazorpayOrder, fetchRazorpayPayment, paidPayment, rupeesToPaise, verifyOrderSignature,
  type TopupChange,
} from '@/lib/razorpay'
import { ensureCreditsSchema } from './creditsSchema'
import { balance, grant } from './credits'
import { getUserPlan } from './quota'
import { recordPayment } from './invoices'

const fail = (message: string, status: number) => Object.assign(new Error(message), { status, expose: true })

/**
 * Starts buying a credit pack: an order at Razorpay for the pack's price (taken from our own pack
 * table, never from the browser), recorded as ours, and what the payment window needs.
 */
export async function startTopup(userId: string, packKey: unknown) {
  const pack = TOPUP_PACKS.find(p => p.key === packKey)
  if (!pack) throw fail('Unknown credit pack', 400)
  if (await getUserPlan(userId) === 'free') throw fail('Top-ups are for paid plans. Upgrade to a paid plan to get more credits.', 403)
  await ensureCreditsSchema()
  const amountPaise = rupeesToPaise(pack.price)
  const order = await createRazorpayOrder(amountPaise, `topup_${randomUUID().replace(/-/g, '').slice(0, 24)}`, {
    kind: 'topup', user_id: userId, pack: pack.key, credits: String(pack.credits),
  })
  await sql`INSERT INTO topup_orders (order_id, user_id, pack, credits, amount_paise) VALUES (${order.id}, ${userId}, ${pack.key}, ${pack.credits}, ${amountPaise})`
  return { orderId: order.id, amountPaise, credits: pack.credits, packName: `${pack.credits} credits`, keyId: process.env.RAZORPAY_KEY_ID, checkoutScript: checkoutScriptUrl() }
}

/**
 * A paid top-up becomes credits: only for an order we made for this user and pack, once per payment
 * (the browser's verify and Razorpay's webhook both end here, in either order, any number of times).
 */
export async function applyTopup(c: TopupChange): Promise<{ granted: boolean }> {
  await ensureCreditsSchema()
  const [own] = await sql<{ order_id: string }[]>`SELECT order_id FROM topup_orders WHERE order_id = ${c.orderId} AND user_id = ${c.userId} AND pack = ${c.pack}`
  if (!own) return { granted: false }
  const r = await grant(c.userId, { kind: 'topup', amount: c.credits, expiresAt: new Date(Date.now() + TOPUP_CREDIT_DAYS * 86_400_000), sourceRef: `rzp:${c.payment.id}` })
  await sql`UPDATE topup_orders SET status = 'paid', payment_id = ${c.payment.id}, paid_at = COALESCE(paid_at, now()) WHERE order_id = ${c.orderId}`
  // The invoice, once per payment whatever the number of tries; a failure answers an error so it is retried
  await recordPayment(c.userId, null, `topup:${c.pack}`, c.payment)
  return r
}

/**
 * After the payment window: the signature must be ours, the order must be this user's, and Razorpay's
 * own record must show the payment captured, on that order, for the full price. Then the credits go in.
 */
export async function completeTopup(userId: string, p: { orderId: string; paymentId: string; signature: string }) {
  if (!verifyOrderSignature(p, process.env.RAZORPAY_KEY_SECRET ?? '')) throw fail('The payment could not be verified.', 400)
  await ensureCreditsSchema()
  const [own] = await sql<{ pack: string; credits: number; amount_paise: number }[]>`SELECT pack, credits, amount_paise FROM topup_orders WHERE order_id = ${p.orderId} AND user_id = ${userId}`
  if (!own) throw fail('Unknown order', 404)
  const remote = await fetchRazorpayPayment(p.paymentId)
  const payment = paidPayment(remote)
  if (!payment || remote.order_id !== p.orderId || payment.amountPaise < own.amount_paise) {
    throw fail('The payment is not complete yet. If money was taken, your credits will appear shortly.', 409)
  }
  const pack = TOPUP_PACKS.find(x => x.key === own.pack)!
  await applyTopup({ kind: 'topup', orderId: p.orderId, userId, pack: pack.key, credits: pack.credits, payment })
  return { credits: pack.credits, balance: (await balance(userId)).balance }
}
