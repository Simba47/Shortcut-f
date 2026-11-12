import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { completeTopup } from '@/server/services/topup'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The payment window reports a paid order: if its signature is ours and Razorpay agrees, the credits go in (the webhook says the same later, harmlessly) */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => null)
  try {
    return NextResponse.json({
      success: true,
      ...(await completeTopup(user.id, {
        orderId: String(b?.razorpay_order_id ?? ''), paymentId: String(b?.razorpay_payment_id ?? ''), signature: String(b?.razorpay_signature ?? ''),
      })),
    })
  } catch (err) {
    return apiError(err)
  }
}
