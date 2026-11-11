import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { listVideos, deleteVideos, cleanIds, manualClipCounts } from '@/server/services/videos'
import { apiError } from '@/lib/api-error'
import { r2, R2_BUCKET } from '@/lib/r2'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ?assets=1 also lists the user's asset videos (stock clips saved for B-roll), for the editor
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const forEditor = req.nextUrl.searchParams.get('assets') === '1'
    const rows = await listVideos(user.id, forEditor)
    // (the dashboard's "Open clips": how many are cut by hand, the rest the AI's; a hiccup only leaves it out)
    const manual = forEditor ? {} : await manualClipCounts(rows.filter(v => v.clip_count > 0).map(v => v.id as string)).catch(() => null)
    const videos = await Promise.all(
      rows.map(async (v, i) => {
        let video_url: string | null = null
        if (v.storage_path) {
          try {
            video_url = await getSignedUrl(
              r2,
              // The editor plays a video's editing copy when it has one (quick to drag through)
              new GetObjectCommand({ Bucket: R2_BUCKET, Key: (forEditor && v.proxy_path) || v.storage_path }),
              { expiresIn: 3600 },
            )
          } catch { /* no url */ }
        } else if (v.source_url) {
          video_url = v.source_url
        }
        // Its picture for the dashboard (the worker's jobs/poster.ts), when it has one: the card shows it instead
        // of loading the video (12 hours: the dashboard keeps the first link it gets, as for the video)
        const poster_url = !forEditor && v.poster_path
          ? await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: v.poster_path }), { expiresIn: 43200 }).catch(() => null)
          : null
        return {
          id: v.id,
          title: v.title,
          poster_url,
          clip_count: v.clip_count,
          manual_clip_count: manual ? manual[v.id] ?? 0 : null,
          status: v.status,
          download_progress: v.download_progress,
          duration_ms: v.duration_ms,
          created_at: v.created_at,
          source_type: v.source_type,
          error: v.status === 'failed' ? v.error ?? null : null,
          video_url,
          index: rows.length - i,
          // (with ?assets=1) a saved stock clip (B-roll) or a video uploaded in the editor: the editor
          // keeps stock footage on its B-roll lane and the user's own videos on the Videos lane
          is_asset: !!v.is_asset,
          is_upload_asset: !!v.is_upload_asset,
        }
      }),
    )
    return NextResponse.json({ videos })
  } catch (err) {
    return apiError(err)
  }
}

// Delete one or more videos (with their clips and files): body { ids: string[] }
export async function DELETE(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  try {
    return NextResponse.json(await deleteVideos(user.id, cleanIds(body?.ids)))
  } catch (err) {
    return apiError(err)
  }
}
