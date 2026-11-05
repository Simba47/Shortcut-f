import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { startSubEdit, subEditStatus, stopSubEdit } from '@/server/services/subjects'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Sub-edit (the clip board): find the people, track them, frame the clip on whoever is talking
export async function POST(req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    const body = await req.json().catch(() => ({}))
    return NextResponse.json(await startSubEdit(user.id, clipId, body))
  } catch (err) {
    return apiError(err)
  }
}

// How the latest Sub-edit of the clip is going
export async function GET(_req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    return NextResponse.json(await subEditStatus(user.id, clipId))
  } catch (err) {
    return apiError(err)
  }
}

// Stop it
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    return NextResponse.json(await stopSubEdit(user.id, clipId))
  } catch (err) {
    return apiError(err)
  }
}
