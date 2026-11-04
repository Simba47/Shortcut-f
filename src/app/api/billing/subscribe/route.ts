import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import sql from '@/lib/db'
import { PLANS, type PlanKey } from '@/lib/plans'
import { razorpayConfigured, checkoutScriptUrl, PAID_PLAN_KEYS } from '@/lib/razorpay'
import { startSubscription } from '@/server/services/billing'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Start paying for a plan: makes the Razorpay subscription and returns what the checkout window
 * needs. The plan is switched on only after the payment (api/billing/verify and the webhook).
 * Without Razorpay keys nothing is sold — unless ALLOW_TEST_SUBSCRIBE=1 (a local test copy), which
 * keeps the old "switch it on without paying".
 */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const plan = body?.plan as PlanKey | undefined
  if (!plan || !(PAID_PLAN_KEYS as readonly string[]).includes(plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  if (!razorpayConfigured()) {
    if (process.env.ALLOW_TEST_SUBSCRIBE !== '1') {
      return NextResponse.json({ error: 'Payments are not set up yet.' }, { status: 503 })
    }
    const expiresAt = new Date()
    expiresAt.setMonth(expiresAt.getMonth() + 1)
    await sql.begin(async tx => {
      await tx`UPDATE users SET plan = ${plan} WHERE id = ${user.id}`
      await tx`INSERT INTO subscriptions (user_id, plan, status, expires_at) VALUES (${user.id}, ${plan}, 'active', ${expiresAt})`
    })
    return NextResponse.json({ success: true, test: true, plan, planName: PLANS[plan].name })
  }

  try {
    const sub = await startSubscription(user.id, plan)
    return NextResponse.json({ ...sub, keyId: process.env.RAZORPAY_KEY_ID, email: user.email, checkoutScript: checkoutScriptUrl() })
  } catch (err) {
    return apiError(err)
  }
}
