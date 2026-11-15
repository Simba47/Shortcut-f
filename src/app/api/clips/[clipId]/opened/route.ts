import { NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import sql from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The clip was opened in the editor (user, 2026-11-13: the Clipboard says "Unseen" until then, "Draft" after):
 * a mark beside the editor's own note (clips.layers.opened). Nothing else changes.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  // (the column comes with the backend: before it, there's nothing to mark)
  const [col] = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'clips' AND column_name = 'layers'`
  if (!col) return NextResponse.json({ ok: false })
  const rows = await sql`
    UPDATE clips c SET layers = COALESCE(c.layers, '{}'::jsonb) || '{"opened": true}'::jsonb
    FROM videos v
    WHERE c.id = ${clipId} AND v.id = c.video_id AND v.user_id = ${user.id}
      AND (c.layers IS NULL OR jsonb_typeof(c.layers) = 'object')
    RETURNING c.id
  `
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
