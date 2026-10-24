import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature, subscriptionChange } from '@/lib/razorpay'
import { activate, endSubscription } from '@/server/services/billing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Razorpay's events (set this URL and the secret in the Razorpay dashboard: Webhooks, with the
 * subscription.activated / charged / cancelled / completed / halted events). Signed over the raw
 * body; each event is applied once. A failure on our side answers 500, so Razorpay delivers it again.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!verifyWebhookSignature(raw, req.headers.get('x-razorpay-signature'), process.env.RAZORPAY_WEBHOOK_SECRET ?? '')) {
    return NextResponse.json({ error: 'Bad signature' }, { status: 400 })
  }
  let event: { event?: string }
  try { event = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }) }
  const change = subscriptionChange(event)
  if (!change) return NextResponse.json({ ok: true, ignored: true })
  const eventId = req.headers.get('x-razorpay-event-id')
  const once = eventId ? { id: eventId, type: String(event.event) } : undefined
  try {
    const applied = change.kind === 'active' ? await activate(change, once) : await endSubscription(change, once)
    return NextResponse.json({ ok: true, applied })
  } catch (err) {
    console.error('[billing] webhook failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Try again' }, { status: 500 })
  }
}
