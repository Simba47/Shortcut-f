import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { cancelAutoClips, confirmAutoClips, createAutoClips, getAutoClips } from '@/server/services/videos'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "Make my clips": start the AI Edit job for this video. With { confirm: true }: say yes to the
// run that stopped to ask about making fewer clips than asked for.
export async function POST(req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  const body = await req.json().catch(() => null)
  const clipCount = body?.clip_count === undefined ? 5 : Number(body.clip_count)
  try {
    if (body?.confirm === true) return NextResponse.json(await confirmAutoClips(user.id, videoId))
    // Checkboxes: only an explicit false turns one off
    const on = (k: string) => body?.[k] !== false
    return NextResponse.json(await createAutoClips(user.id, videoId, clipCount, body?.add_broll === true, {
      captions: on('captions'), title: on('title'), motion: on('motion'), layouts: on('layouts'),
      captionLanguage: body?.caption_language, titleLanguage: body?.title_language,
      // 'default' (the account's default kit), 'none', or a kit's id
      brandKit: typeof body?.brand_kit === 'string' ? body.brand_kit : undefined,
      // 'new': look for new moments instead of making more from the saved ones; pay: agreed to its credits
      search: body?.search === 'new' ? 'new' : 'more', pay: body?.pay === true,
    }))
  } catch (err: unknown) {
    // (apiError keeps the 402 "this search costs N credits" details the page asks with)
    return apiError(err)
  }
}

// The latest AI Edit job for this video (status, progress, error) and its clips
export async function GET(_req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  try {
    return NextResponse.json(await getAutoClips(user.id, videoId))
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    return NextResponse.json({ error: e.message ?? 'Failed' }, { status: e.status ?? 500 })
  }
}

// "Stop": ends this video's running Make my clips run (clips already made are kept)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  try {
    return NextResponse.json(await cancelAutoClips(user.id, videoId))
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    return NextResponse.json({ error: e.message ?? 'Failed' }, { status: e.status ?? 500 })
  }
}
