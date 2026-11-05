import { redirect, notFound } from 'next/navigation'
import { requireUser } from '@/server/auth'
import { ClipPickerShell, type ClipOrigin } from './ClipPickerShell'
import sql from '@/lib/db'
import { r2, R2_BUCKET } from '@/lib/r2'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export default async function VideoPickerPage({
  params,
  searchParams,
}: {
  params: Promise<{ videoId: string }>
  searchParams: Promise<{ start?: string }>
}) {
  const { videoId } = await params
  // How the dashboard said to start (its "AI edit / Manual edit" choice): the clip board points at those tools
  const { start } = await searchParams
  const startWith = start === 'ai' || start === 'manual' ? start : undefined
  const user = await requireUser()
  if (!user) redirect('/login')

  type VideoRow = { id: string; user_id: string; title: string | null; status: string; download_progress: number; duration_ms: number | null; created_at: string; storage_path: string | null; proxy_path: string | null; stock_ref: string | null; picture_box: unknown }
  const [row] = await sql`
    SELECT id, user_id, title, status, download_progress, duration_ms, created_at, storage_path,
      -- (read through to_jsonb: works before the worker adds the columns)
      to_jsonb(videos)->>'proxy_path' AS proxy_path, to_jsonb(videos)->>'stock_ref' AS stock_ref,
      -- (the picture inside its black bars, once the worker has found it)
      to_jsonb(videos)->'picture_box' AS picture_box
    FROM videos WHERE id = ${videoId}
  ` as unknown as VideoRow[]
  if (!row || row.user_id !== user.id) notFound()
  const { proxy_path, stock_ref, ...video } = row

  // Captions are not made here (they cost money): only when someone asks — captions switched on
  // in the editor, Make my clips, Best moments, Ask AI

  // The clip board plays the video's editing copy when it has one, as the editor does (the
  // worker's jobs/proxy.ts: a full picture every half second, so dragging along the video shows
  // each moment at once; the original has one every few seconds and goes black while dragged).
  // Only watched here — the copy's frames keep their times, and exports use the original.
  let videoUrl = ''
  if (video.status === 'ready' && video.storage_path) {
    videoUrl = await getSignedUrl(
      // (12 hours, as the editor's: a clip board left open must keep loading the video as it is dragged)
      r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: proxy_path || video.storage_path }), { expiresIn: 43200 }
    ).catch(() => '')
  }
  // A video from before copies were made: the page asks the worker for one (used from the next visit)
  const needsProxy = video.status === 'ready' && !!video.storage_path && !proxy_path && !stock_ref

  type RawClip = {
    id: string; title: string | null; start_ms: number; end_ms: number
    status: string; output_storage_path: string | null; created_at: string
    layout: string | null; auto: boolean
    favorite?: boolean | null; reason?: string | null
  }

  const clipsRaw = await sql<RawClip[]>`
    SELECT c.id, c.title, c.start_ms, c.end_ms, c.status, c.output_storage_path, c.created_at,
      (SELECT layout FROM segments WHERE clip_id = c.id ORDER BY sort_order LIMIT 1) AS layout,
      -- Made by "Make my clips" (read through to_jsonb so this works before the worker adds the column)
      (to_jsonb(c)->>'ai_edit_job_id') IS NOT NULL AS auto,
      COALESCE((to_jsonb(c)->>'favorite')::boolean, false) AS favorite,
      to_jsonb(c)->>'ai_reason' AS reason
    FROM clips c
    WHERE c.video_id = ${videoId}
    ORDER BY c.created_at ASC
  `

  // Clips made with "Use" on a Best moments / Ask AI card: the suggestion log says which.
  // No log table yet (or a hiccup reading it) just shows those clips under "Your clips".
  const usedFrom = new Map((await sql<{ clip_id: string; source: string }[]>`
    SELECT DISTINCT ON (clip_id) clip_id, source FROM ai_suggestion_events
    WHERE video_id = ${videoId} AND event = 'used' AND clip_id IS NOT NULL
    ORDER BY clip_id, created_at DESC
  `.catch(() => [])).map(r => [r.clip_id, r.source]))
  const originOf = (c: RawClip): ClipOrigin =>
    c.auto ? 'auto'
      : usedFrom.get(c.id) === 'best_moments' ? 'best'
      : usedFrom.get(c.id) === 'clip_search' ? 'ask'
      : 'yours'

  // Download links: fresh ones on every load (the link stored with a clip expires after 7 days)
  const savedClips = await Promise.all(clipsRaw.map(async (c, idx) => ({
    id: c.id, title: c.title ?? null, start_ms: c.start_ms, end_ms: c.end_ms,
    status: c.status,
    output_url: c.status === 'done' && c.output_storage_path
      ? await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: c.output_storage_path }), { expiresIn: 43200 }).catch(() => null)
      : null,
    created_at: c.created_at,
    layout: c.layout ?? null, index: idx + 1, origin: originOf(c),
    favorite: !!c.favorite, reason: c.reason ?? null,
  })))

  return (
    <ClipPickerShell
      video={video}
      videoUrl={videoUrl}
      // (names the file across visits: the clip board keeps its download under it)
      videoKey={videoUrl ? proxy_path || video.storage_path : null}
      needsProxy={needsProxy}
      startWith={startWith}
      savedClips={savedClips}
    />
  )
}
