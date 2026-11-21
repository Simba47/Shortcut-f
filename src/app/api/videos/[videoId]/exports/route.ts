import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import sql from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * A video's exported clips, for "Download all" on a video about to expire (plans v2, 2026-11-21): each one is then
 * downloaded through /api/clips/[clipId]/download, named after the clip.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  const [own] = await sql`SELECT 1 FROM videos WHERE id = ${videoId} AND user_id = ${user.id}`
  if (!own) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const clips = await sql<{ id: string; title: string | null }[]>`
    SELECT id, title FROM clips WHERE video_id = ${videoId} AND status = 'done' AND output_storage_path IS NOT NULL ORDER BY created_at`
  return NextResponse.json({ clips })
}
