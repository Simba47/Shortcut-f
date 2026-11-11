import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import sql from '@/lib/db'
import { cleanSuggestion, logSuggestionEvents } from '@/server/services/suggestionEvents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SOURCES = ['best_moments', 'clip_search']
const EVENTS = ['previewed', 'used']

// Events the clip board sees in the browser: a suggestion previewed (▶). ('used' is now saved with
// the clip, services/clips.ts createClip; still taken from a page opened before that.)
// Always answers 204: logging must never bother the user.
export async function POST(req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return new NextResponse(null, { status: 204 })
  const { videoId } = await params
  const body = await req.json().catch(() => null)
  try {
    const suggestion = cleanSuggestion(body?.suggestion)
    if (!SOURCES.includes(body?.source) || !EVENTS.includes(body?.event) || !suggestion) {
      return new NextResponse(null, { status: 204 })
    }
    const [owned] = await sql`SELECT 1 FROM videos WHERE id = ${videoId} AND user_id = ${user.id}`
    let clipId: string | null = null
    if (owned && typeof body.clip_id === 'string') {
      const [clip] = await sql`SELECT id FROM clips WHERE id = ${body.clip_id} AND video_id = ${videoId}`
      clipId = clip?.id ?? null
    }
    if (owned) {
      logSuggestionEvents([{ user_id: user.id, video_id: videoId, clip_id: clipId, source: body.source, event: body.event, suggestion }])
    }
  } catch (e) {
    console.warn('[suggestion-events] not logged:', e)
  }
  return new NextResponse(null, { status: 204 })
}
