import { NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { getUserPlan, getUserPlanConfig } from '@/server/services/quota'
import sql from '@/lib/db'
import { razorpayConfigured, razorpayMode } from '@/lib/razorpay'
import { subscriptionSummary } from '@/server/services/billing'
import { readingUse } from '@/server/services/readingUsage'
import { testPackAllowed } from '@/lib/credits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [planKey, plan] = await Promise.all([
    getUserPlan(user.id),
    getUserPlanConfig(user.id),
  ])

  const subscription = await subscriptionSummary(user.id).catch(() => null)
  const [videoRow, clipRow] = await Promise.all([
    // Only the user's own videos: B-roll and overlay files (role 'asset') don't count, as in checkVideoQuota
    sql<{ count: string }[]>`SELECT COUNT(*) as count FROM videos WHERE user_id = ${user.id} AND role IS DISTINCT FROM 'asset'`,
    sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM clips c
      JOIN videos v ON v.id = c.video_id
      WHERE v.user_id = ${user.id}
    `,
  ])

  const reading = await readingUse(user.id).catch(() => ({ uploads: 0, usedMs: 0 }))

  return NextResponse.json({
    plan: planKey,
    planName: plan.name,
    price: plan.price,
    maxVideos: plan.maxVideos,
    readingMinutes: plan.readingMinutes,
    uploadsPerMonth: plan.uploadsPerMonth,
    maxClips: plan.maxClips,
    maxFileSizeGb: plan.maxFileSizeGb,
    maxFileSizeBytes: plan.maxFileSizeBytes,
    retentionDays: plan.retentionDays,
    // Paying: a Razorpay subscription (state, and when it renews or ends); testMode = no keys, plans switch on without payment
    subscription: subscription && { status: subscription.status, expiresAt: subscription.expiresAt },
    paymentsEnabled: razorpayConfigured(),
    // off | mock (dummy keys, nothing is charged) | test (Razorpay test mode) | live
    paymentsMode: razorpayMode(),
    testMode: !razorpayConfigured() && process.env.ALLOW_TEST_SUBSCRIBE === '1',
    // the ₹1 test pack, for an email in TEST_PACK_EMAILS only
    testPack: testPackAllowed(user.email),
    autoCaption: plan.autoCaption,
    watermark: plan.watermark,
    usage: {
      videos: parseInt(videoRow[0]?.count ?? '0', 10),
      clips: parseInt(clipRow[0]?.count ?? '0', 10),
      uploads: reading.uploads,
      readingMinutes: Math.ceil(reading.usedMs / 60_000),
    },
  })
}
