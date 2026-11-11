import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { clipEmphasis } from '@/server/services/emphasis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The clip's key words for the caption styles: the saved ones, else picked by AI (and saved);
// { fresh: true } (the Key words tab's "Pick again with AI"): picked again, replacing them
export async function POST(req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  const body = await req.json().catch(() => null) as { fresh?: unknown } | null
  try {
    return NextResponse.json(await clipEmphasis(user.id, clipId, { fresh: body?.fresh === true }))
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    return NextResponse.json({ error: e.message ?? 'Failed' }, { status: e.status ?? 500 })
  }
}
