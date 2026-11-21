import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { regenerateClipText } from '@/server/services/clips'
import { aiActionCounts } from '@/server/services/aiUsage'
import { creditsMode } from '@/lib/credits'
import { rewriteNote } from '@/lib/aiLimits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// What the next rewrite costs, for the note beside Regenerate (nothing with credits off)
export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (creditsMode() === 'off') return NextResponse.json({})
  const counts = await aiActionCounts(user.id)
  return NextResponse.json({ note: rewriteNote(counts.rewritesThisMonth) })
}

// Regenerate: new hook, title, post caption and hashtags for this clip
export async function POST(_req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    return NextResponse.json(await regenerateClipText(user.id, clipId))
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    return NextResponse.json({ error: e.message ?? 'Failed' }, { status: e.status ?? 500 })
  }
}
