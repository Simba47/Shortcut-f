import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { setKept } from '@/server/services/expiry'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** "★ Keep" on Pro (plans v2, 2026-11-21): { keep: true } never expires; { keep: false } gives it at least 7 more days */
export async function POST(req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  const body = await req.json().catch(() => null)
  if (typeof body?.keep !== 'boolean') return NextResponse.json({ error: 'keep must be true or false' }, { status: 400 })
  try {
    return NextResponse.json(await setKept(user.id, videoId, body.keep))
  } catch (err) {
    return apiError(err)
  }
}
