import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { apiError } from '@/lib/api-error'
import { readingPrice } from '@/server/services/readingUsage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** What uploading a video this long costs, so the price is asked before the upload starts */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  try {
    return NextResponse.json(await readingPrice(user.id, typeof body?.duration_ms === 'number' ? body.duration_ms : null))
  } catch (err) {
    return apiError(err)
  }
}
