import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { getVideoSuggestionsByCriteria } from '@/server/services/videos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  const body = await req.json().catch(() => null)
  const criteria = typeof body?.criteria === 'string' ? body.criteria : ''
  try {
    return NextResponse.json(await getVideoSuggestionsByCriteria(user.id, videoId, criteria, { pay: body?.pay === true }))
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number; code?: string; credits?: number; needed?: number; balance?: number }
    // (the price or what is short goes with it, so the page can ask, or offer a top-up)
    const extra = e.status === 402 ? { code: e.code ?? (e.needed !== undefined ? 'insufficient_credits' : undefined), credits: e.credits, needed: e.needed, balance: e.balance } : {}
    return NextResponse.json({ error: e.message ?? 'Failed', ...extra }, { status: e.status ?? 500 })
  }
}
