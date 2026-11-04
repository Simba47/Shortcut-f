import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { razorpayConfigured } from '@/lib/razorpay'
import { startTopup } from '@/server/services/topup'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Start buying a credit pack: makes the Razorpay order and returns what the payment window needs. Credits arrive only after the payment is verified (topup/verify, and the webhook). */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!razorpayConfigured()) return NextResponse.json({ error: 'Payments are not set up yet.' }, { status: 503 })
  const body = await req.json().catch(() => null)
  try {
    return NextResponse.json({ ...(await startTopup(user.id, body?.pack)), email: user.email })
  } catch (err) {
    return apiError(err)
  }
}
