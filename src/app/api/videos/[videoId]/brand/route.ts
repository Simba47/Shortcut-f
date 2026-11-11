import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { apiError } from '@/lib/api-error'
import { brandVideoClips, clipBrands } from '@/server/services/brandApply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The brand kit on each clip of this video (the clip board's "Branded" tags): { clips: { [clipId]: kitId | null } } */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  try {
    return NextResponse.json({ clips: await clipBrands(user.id, videoId) })
  } catch (err) {
    return apiError(err)
  }
}

/**
 * "Apply brand to all clips": { kit_id } puts that kit on every clip of the video; { kit_id: null } takes the brand off them all.
 * { clip_ids }: only those of the video's clips (the board's own: AI clips and clips cut by hand are separate boards)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  const body = await req.json().catch(() => null)
  const kitId = typeof body?.kit_id === 'string' ? body.kit_id : null
  const clipIds = Array.isArray(body?.clip_ids) ? (body.clip_ids as unknown[]).filter((x): x is string => typeof x === 'string') : undefined
  try {
    return NextResponse.json(await brandVideoClips(user.id, videoId, kitId, clipIds))
  } catch (err) {
    return apiError(err)
  }
}
