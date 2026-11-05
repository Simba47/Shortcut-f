import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import sql from '@/lib/db'
import { brandCaptionWords } from '@/lib/brandWords'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = req.nextUrl
  const videoId = searchParams.get('video_id')
  const since = searchParams.get('since')
  if (!videoId) return NextResponse.json({ error: 'video_id required' }, { status: 400 })

  const [video] = await sql`SELECT id, status FROM videos WHERE id = ${videoId} AND user_id = ${user.id}`
  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = since
    ? await sql`
        SELECT t.id FROM transcripts t
        WHERE t.video_id = ${videoId} AND t.created_at > ${since}
          AND EXISTS (SELECT 1 FROM transcript_words WHERE transcript_id = t.id)
        ORDER BY t.created_at DESC LIMIT 1`
    : await sql`
        SELECT t.id FROM transcripts t
        WHERE t.video_id = ${videoId}
          AND EXISTS (SELECT 1 FROM transcript_words WHERE transcript_id = t.id)
        ORDER BY t.created_at DESC LIMIT 1`

  // True while a caption job is waiting or running — the editor keeps polling. With ?clip_id=, only
  // that clip's own (a whole-video reading for AI edit never keeps a clip's editor waiting)
  const clipId = searchParams.get('clip_id')
  const [job] = clipId && /^[0-9a-f-]{36}$/i.test(clipId)
    ? await sql`
        SELECT 1 FROM jobs WHERE type = 'transcribe' AND payload->>'video_id' = ${videoId}
          AND payload->>'clip_id' = ${clipId} AND status IN ('queued', 'processing') LIMIT 1`
    : await sql`
        SELECT 1 FROM jobs WHERE type = 'transcribe' AND payload->>'video_id' = ${videoId}
          AND status IN ('queued', 'processing') LIMIT 1`
  const pending = !!job

  // The caption job the editor is waiting for (?job=), if it failed: its reason, so the editor can
  // say so instead of waiting
  let failed: string | null = null
  // ...and while it waits its turn, its place in line (1 = next), so the editor can say so
  let place: number | null = null
  const jobId = searchParams.get('job')
  if (jobId && /^[0-9a-f-]{36}$/i.test(jobId)) {
    const [mine] = await sql`
      SELECT status, error FROM jobs WHERE id = ${jobId} AND type = 'transcribe' AND payload->>'video_id' = ${videoId}`
    if (mine?.status === 'failed') failed = String(mine.error ?? 'the caption job failed').replace(/^Error:\s*/, '').slice(0, 200)
    if (mine?.status === 'queued' || mine?.status === 'processing') {
      const { placeInLine } = await import('@/server/services/transcribe')
      place = await placeInLine(jobId)
    }
  }

  if (!rows.length) return NextResponse.json({ words: null, video_status: video.status, pending, failed, place })

  const raw = await sql<{ word: string; word_roman: string | null; start_ms: number; end_ms: number }[]>`SELECT * FROM transcript_words WHERE transcript_id = ${rows[0].id} ORDER BY start_ms`
  // As the brand writes them (its spellings, its hidden words): the clip's kit, else the default one
  const { brandWordsFor } = await import('@/server/services/brandKits')
  const words = brandCaptionWords([...raw], await brandWordsFor(user.id, clipId && /^[0-9a-f-]{36}$/i.test(clipId) ? clipId : null))
  return NextResponse.json({ words, video_status: video.status, pending })
}

/**
 * A caption word corrected in the Captions panel (TranscriptPanel): saved on the video's transcript,
 * so it stays after the clip is opened again and the export writes it. Before 2026-11-04 a
 * correction lived only in the open editor: gone on reload, never exported. `field`: the word as
 * said ('word'), or its English-letter spelling shown when captions are in English letters.
 */
export async function PATCH(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as { id?: unknown; field?: unknown; text?: unknown } | null
  const id = typeof body?.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null
  const field = body?.field === 'word_roman' ? 'word_roman' : body?.field === 'word' ? 'word' : null
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 100) : null
  if (!id || !field || !text) return NextResponse.json({ error: 'id, field and text required' }, { status: 400 })
  const [row] = field === 'word'
    ? await sql`
        UPDATE transcript_words w SET word = ${text}
        FROM transcripts t JOIN videos v ON v.id = t.video_id
        WHERE w.id = ${id} AND t.id = w.transcript_id AND v.user_id = ${user.id} RETURNING w.id`
    : await sql`
        UPDATE transcript_words w SET word_roman = ${text}
        FROM transcripts t JOIN videos v ON v.id = t.video_id
        WHERE w.id = ${id} AND t.id = w.transcript_id AND v.user_id = ${user.id} RETURNING w.id`
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
