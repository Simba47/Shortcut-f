import { NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { cancelMySubscription } from '@/server/services/billing'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Stops renewing: the plan stays until the month already paid for is over */
export async function POST() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ success: true, ...(await cancelMySubscription(user.id)) })
  } catch (err) {
    return apiError(err)
  }
}
