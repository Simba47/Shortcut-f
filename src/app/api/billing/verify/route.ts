import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { verifyPaymentSignature } from '@/lib/razorpay'
import { activateAfterCheckout } from '@/server/services/billing'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The checkout window reports a payment: if its signature is ours, the plan goes on at once (the webhook says the same later, harmlessly) */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => null)
  const ok = verifyPaymentSignature(
    { paymentId: String(b?.razorpay_payment_id ?? ''), subscriptionId: String(b?.razorpay_subscription_id ?? ''), signature: String(b?.razorpay_signature ?? '') },
    process.env.RAZORPAY_KEY_SECRET ?? '',
  )
  if (!ok) return NextResponse.json({ error: 'The payment could not be verified.' }, { status: 400 })
  try {
    return NextResponse.json({ success: true, ...(await activateAfterCheckout(user.id, String(b.razorpay_subscription_id), String(b.razorpay_payment_id))) })
  } catch (err) {
    return apiError(err)
  }
}
