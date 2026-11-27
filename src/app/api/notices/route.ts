import { NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { apiError } from '@/lib/api-error'
import { accountFacts } from '@/server/services/notices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The facts the account banners are chosen from (lib/notices.ts accountBanners): plan, credits, Trial, a failed renewal, storage */
export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await accountFacts(user.id))
  } catch (err) {
    return apiError(err)
  }
}
