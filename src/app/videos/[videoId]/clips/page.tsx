import { withSavedStyle } from '@/modules/editor/textStyle'
import { redirect, notFound } from 'next/navigation'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { CaptionStyle, TextOverlay, TranscriptWord } from '@chai-cut/shared'
import { requireUser } from '@/server/auth'
import sql from '@/lib/db'
import { r2, R2_BUCKET } from '@/lib/r2'
import { rowsToLocal } from '@/modules/editor/utils'
import { ClipsGallery, type GalleryClip } from './ClipsGallery'
import { imageOverlaysFor } from '@/server/services/clipPreview'

// AI edits: every clip "Make my clips" has made from this video (all batches, newest first),
// each playable in 9:16 without exporting it
export default async function AutoClipsPage({ params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params
  const user = await requireUser()
  if (!user) redirect('/login')

  const [video] = await sql`
    SELECT id, user_id, title, status, storage_path,
      -- (read through to_jsonb: works before the worker adds the columns)
      to_jsonb(videos)->>'proxy_path' AS proxy_path, to_jsonb(videos)->>'stock_ref' AS stock_ref
    FROM videos WHERE id = ${videoId}`
  if (!video || video.user_id !== user.id) notFound()
  // The cards play the video's editing copy when it has one, as the editor and clip board do
  // (jobs/proxy.ts: 720p, a full picture every half second, about a quarter of the size): each
  // card starts at its own moment, which the original (a full picture every 6–7 s, full size)
  // reaches slowly. Its frames keep their times; the export always uses the original.
  // (Before 2026-11-09 the cards loaded the original: a card could spin for minutes.)
  const playKey = (video.proxy_path as string | null) || (video.storage_path as string | null)
  // A video from before copies were made: the page asks the worker for one (used from the next visit)
  const needsProxy = video.status === 'ready' && !!video.storage_path && !video.proxy_path && !video.stock_ref

  const [job] = await sql`
    SELECT id, status, error, clip_count FROM ai_edit_jobs WHERE video_id = ${videoId} ORDER BY created_at DESC LIMIT 1
  `
  const clipRows = job ? await sql`
    SELECT c.id, c.title, c.start_ms, c.end_ms, c.status, c.output_storage_path, c.ai_edit_job_id, j.created_at AS batch_at,
      (to_jsonb(c)->>'ai_score')::int AS ai_score, to_jsonb(c)->>'ai_reason' AS ai_reason,
      to_jsonb(c)->>'post_caption' AS post_caption, to_jsonb(c)->'hashtags' AS hashtags, to_jsonb(c)->'trim_ranges' AS trim_ranges
    FROM clips c JOIN ai_edit_jobs j ON j.id = c.ai_edit_job_id
    WHERE j.video_id = ${videoId}
    ORDER BY j.created_at DESC, (to_jsonb(c)->>'ai_score')::int DESC NULLS LAST, c.start_ms
  ` : []
  const ids = clipRows.map(c => c.id as string)

  const [videoUrl, words, segRows, styles, overlays, pictures] = await Promise.all([
    playKey
      ? getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: playKey }), { expiresIn: 43200 }).catch(() => '')
      : Promise.resolve(''),
    ids.length ? sql`
      SELECT tw.* FROM transcript_words tw
      WHERE tw.transcript_id = (
        SELECT t.id FROM transcripts t WHERE t.video_id = ${videoId}
          AND EXISTS (SELECT 1 FROM transcript_words WHERE transcript_id = t.id)
        ORDER BY t.created_at DESC LIMIT 1)
      ORDER BY tw.start_ms` : Promise.resolve([]),
    ids.length ? sql`
      SELECT s.*, COALESCE(json_agg(jsonb_build_object(
          'id', cb.id, 'segment_id', cb.segment_id, 'slot_index', cb.slot_index,
          'source_video_id', cb.source_video_id, 'source_offset_ms', cb.source_offset_ms,
          'image_path', cb.image_path, 'image_motion', cb.image_motion, 'volume', cb.volume, 'muted', cb.muted,
          'box_keyframes', COALESCE((SELECT json_agg(bk.* ORDER BY bk.t_ms) FROM box_keyframes bk WHERE bk.box_id = cb.id), '[]')
        ) ORDER BY cb.slot_index) FILTER (WHERE cb.id IS NOT NULL), '[]') AS crop_boxes
      FROM segments s LEFT JOIN crop_boxes cb ON cb.segment_id = s.id
      WHERE s.clip_id = ANY(${ids}) GROUP BY s.id ORDER BY s.sort_order` : Promise.resolve([]),
    ids.length ? sql`SELECT * FROM caption_styles WHERE clip_id = ANY(${ids})` : Promise.resolve([]),
    ids.length ? sql`SELECT * FROM text_overlays WHERE clip_id = ANY(${ids})` : Promise.resolve([]),
    // (the pictures on top — a brand kit's logo, photos — signed: the cards show them, as the export does)
    imageOverlaysFor(ids),
  ])

  // B-roll videos the clips show (only the owner's own videos, as the export uses)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // (the video itself, named by borrowed reaction slots, is played from its own URL)
  const brollIds = [...new Set((segRows as any[]).flatMap(s => (s.crop_boxes ?? []).map((b: { source_video_id?: string | null }) => b.source_video_id).filter((id: string | null | undefined) => !!id && id !== videoId)))] as string[]
  const brollRows = brollIds.length
    ? await sql`SELECT id, storage_path FROM videos WHERE id = ANY(${brollIds}) AND user_id = ${user.id} AND storage_path IS NOT NULL`
    : []
  const stockUrls: Record<string, string> = Object.fromEntries(await Promise.all(brollRows.map(async r =>
    [r.id as string, await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: r.storage_path }), { expiresIn: 43200 })])))

  const allWords = words as unknown as TranscriptWord[]
  const clips: GalleryClip[] = await Promise.all(clipRows.map(async c => ({
    id: c.id, title: c.title, start_ms: c.start_ms, end_ms: c.end_ms, status: c.status,
    batch: c.ai_edit_job_id, batch_at: new Date(c.batch_at).toISOString(),
    ai_score: c.ai_score, ai_reason: c.ai_reason, post_caption: c.post_caption ?? null,
    hashtags: Array.isArray(c.hashtags) ? c.hashtags : null,
    output_url: c.status === 'done' && c.output_storage_path
      ? await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: c.output_storage_path }), { expiresIn: 43200 }).catch(() => null)
      : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    segments: rowsToLocal((segRows as any[]).filter(s => s.clip_id === c.id)),
    words: allWords.filter(w => w.end_ms >= c.start_ms && w.start_ms <= c.end_ms),
    captionStyle: ((styles as unknown as CaptionStyle[]).find(s => s.clip_id === c.id)) ?? null,
    textOverlays: (overlays as unknown as TextOverlay[]).filter(o => o.clip_id === c.id).map(withSavedStyle),
    trims: Array.isArray(c.trim_ranges) ? c.trim_ranges : [],
    overlays: pictures[c.id] ?? [],
  })))

  return (
    <ClipsGallery
      video={{ id: video.id, title: video.title ?? null }}
      videoUrl={videoUrl}
      needsProxy={needsProxy}
      stockUrls={stockUrls}
      job={job ? { status: job.status, error: job.error ?? null } : null}
      clips={clips}
    />
  )
}
