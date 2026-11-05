import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import sql from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The longest name a clip can be given */
const MAX_TITLE = 80

/** A clip renamed on the clip board: { title: string } — empty (or null) puts back the plain "Clip N" */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  const body = await req.json().catch(() => ({}))
  if (body?.title !== null && typeof body?.title !== 'string') return NextResponse.json({ error: 'title must be text' }, { status: 400 })
  const title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim() : ''
  if (title.length > MAX_TITLE) return NextResponse.json({ error: `A clip's name can be at most ${MAX_TITLE} characters` }, { status: 400 })
  const rows = await sql`
    UPDATE clips c SET title = ${title || null}
    FROM videos v
    WHERE c.id = ${clipId} AND v.id = c.video_id AND v.user_id = ${user.id}
    RETURNING c.id
  `
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, title: title || null })
}
