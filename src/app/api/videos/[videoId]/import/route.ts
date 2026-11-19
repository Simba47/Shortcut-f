import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { continueLinkImport, linkImportPrice } from '@/server/services/ingest'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A Drive / Dropbox import waiting for the OK (status 'awaiting_ok', user 2026-11-19): GET = what reading it
// costs (as a file upload is asked), POST = Continue (charged and read). Cancel deletes the video.

async function videoIdOf(params: Promise<{ videoId: string }>) {
  const { videoId } = await params
  return /^[0-9a-f-]{36}$/i.test(videoId) ? videoId : null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const videoId = await videoIdOf(params)
  if (!videoId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    return NextResponse.json(await linkImportPrice(user.id, videoId))
  } catch (err) {
    return apiError(err)
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const videoId = await videoIdOf(params)
  if (!videoId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    return NextResponse.json(await continueLinkImport(user.id, videoId))
  } catch (err) {
    return apiError(err)
  }
}
