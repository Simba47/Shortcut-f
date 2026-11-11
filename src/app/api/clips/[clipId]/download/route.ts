import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import sql from '@/lib/db'
import { r2, R2_BUCKET } from '@/lib/r2'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Download the exported reel. The file lives on another domain (storage), where a link's
 * `download` attribute is ignored and the video opens in a new tab instead; this sends the browser
 * to a short-lived link that tells it to save the file, named after the clip.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  const [row] = await sql`
    SELECT c.status, c.output_storage_path, c.title FROM clips c
    JOIN videos v ON v.id = c.video_id
    WHERE c.id = ${clipId} AND v.user_id = ${user.id}
  `
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.status !== 'done' || !row.output_storage_path) {
    return NextResponse.json({ error: 'This clip has no export yet' }, { status: 409 })
  }

  // A safe file name: plain letters for old browsers, the real title (any language) for the rest
  // (a clip with no name of its own: ?name= is the one on its card, "Clip 3")
  const title = ((typeof row.title === 'string' && row.title.trim()) || req.nextUrl.searchParams.get('name')?.trim() || 'shortcut-clip').slice(0, 80)
  const ascii = title.replace(/[^\x20-\x7E]/g, '').replace(/[\/:*?"<>|]/g, '').trim() || 'shortcut-clip'
  const disposition = `attachment; filename="${ascii}.mp4"; filename*=UTF-8''${encodeURIComponent(title.replace(/[\/:*?"<>|]/g, ''))}.mp4`

  const url = await getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: row.output_storage_path, ResponseContentDisposition: disposition, ResponseContentType: 'video/mp4' }),
    { expiresIn: 300 },
  ).catch(() => null)
  if (!url) return NextResponse.json({ error: 'Could not prepare the download' }, { status: 503 })
  return NextResponse.redirect(url, 302)
}
