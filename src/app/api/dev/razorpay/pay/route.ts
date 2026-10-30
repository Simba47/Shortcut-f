import { NextRequest, NextResponse } from 'next/server'
import { razorpayMode } from '@/lib/razorpay'
import { mockPay, sendWebhook, type Delivery } from '@/server/dev/razorpayMock'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The fake payment window reports "paid" (or "failed"). The browser's answer comes back at once;
 * Razorpay's webhooks follow a moment later, as the real ones do (so a verify and a webhook both
 * reach the site, and it must treat them as one payment).
 */
export async function POST(req: NextRequest) {
  if (razorpayMode() !== 'mock') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = await req.json().catch(() => ({}))
  const later: Delivery[] = []
  const result = await mockPay(
    { subscriptionId: b.subscription_id, orderId: b.order_id, outcome: b.outcome === 'fail' ? 'fail' : 'success' },
    async d => { later.push(d) },
  )
  setTimeout(() => { for (const d of later) sendWebhook(d).catch(e => console.error('[razorpay mock] webhook not delivered:', e)) }, 700)
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}
