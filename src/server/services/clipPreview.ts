import { shownSegment } from '@/modules/editor/visibility'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { CaptionStyle, SegmentLocal, TextOverlay, TranscriptWord } from '@chai-cut/shared'
import sql from '@/lib/db'
import { r2, R2_BUCKET } from '@/lib/r2'
import { rowsToLocal } from '@/modules/editor/utils'
import { brandCaptionWords } from '@/lib/brandWords'
import { brandWordsFor } from './brandKits'

export interface ClipPreviewData {
  id: string; start_ms: number; end_ms: number
  /** The clip's own video (borrowed reaction slots name it) */
  video_id: string
  /** Empty for a clip never opened in the editor (the player frames it as the editor would) */
  segments: SegmentLocal[]
  words: TranscriptWord[]
  /** null when the clip has no saved style yet */
  captionStyle: CaptionStyle | null
  textOverlays: TextOverlay[]
  /** Signed URLs of the B-roll videos the clip shows, by video id */
  stockUrls: Record<string, string>
  /** Its removed parts (clips.trim_ranges, source ms): the player plays without them, as the export does */
  trims: [number, number][]
}

/** Everything needed to play one clip in 9:16 as edited (framing, captions, text, B-roll), without exporting it */
export async function getClipPreview(userId: string, clipId: string): Promise<ClipPreviewData> {
  const [clip] = await sql`
    SELECT c.id, c.video_id, c.start_ms, c.end_ms, v.user_id, to_jsonb(c)->'trim_ranges' AS trim_ranges
    FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}
  `
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })

  const [words, segRows, [style], overlays] = await Promise.all([
    sql`
      SELECT tw.* FROM transcript_words tw
      WHERE tw.transcript_id = (
        SELECT t.id FROM transcripts t WHERE t.video_id = ${clip.video_id}
          AND EXISTS (SELECT 1 FROM transcript_words WHERE transcript_id = t.id)
        ORDER BY t.created_at DESC LIMIT 1)
        AND tw.end_ms >= ${clip.start_ms} AND tw.start_ms <= ${clip.end_ms}
      ORDER BY tw.start_ms`,
    sql`
      SELECT s.*, COALESCE(json_agg(jsonb_build_object(
          'id', cb.id, 'segment_id', cb.segment_id, 'slot_index', cb.slot_index,
          'source_video_id', cb.source_video_id, 'source_offset_ms', cb.source_offset_ms,
          'image_path', cb.image_path, 'image_motion', cb.image_motion, 'volume', cb.volume, 'muted', cb.muted, 'hidden', (to_jsonb(cb)->>'hidden')::boolean,
          'box_keyframes', COALESCE((SELECT json_agg(bk.* ORDER BY bk.t_ms) FROM box_keyframes bk WHERE bk.box_id = cb.id), '[]')
        ) ORDER BY cb.slot_index) FILTER (WHERE cb.id IS NOT NULL), '[]') AS crop_boxes
      FROM segments s LEFT JOIN crop_boxes cb ON cb.segment_id = s.id
      WHERE s.clip_id = ${clipId} GROUP BY s.id ORDER BY s.sort_order`,
    sql`SELECT * FROM caption_styles WHERE clip_id = ${clipId} LIMIT 1`,
    sql`SELECT * FROM text_overlays WHERE clip_id = ${clipId}`,
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // As the export shows it: a hidden added video gives way to the main video, hidden frame items go,
  // a hidden main video is black
  const segments = rowsToLocal(segRows as any[]).map(s => shownSegment(s, clip.video_id))
  // B-roll the clip shows (only the owner's own videos, as the export uses)
  // (the clip's own video, named by borrowed reaction slots, is played from the main URL)
  const brollIds = [...new Set(segments.flatMap(s => [
    ...s.crop_boxes.map(b => b.source_video_id),
    // Videos in frame slots
    ...(s.frame?.items ?? []).map(it => it.kind === 'video' ? it.source_video_id : null),
  ]).filter((id): id is string => !!id && id !== clip.video_id))]
  // Photos in frame slots: signed, so the player can draw them
  await Promise.all(segments.flatMap(s => (s.frame?.items ?? []).map(async it => {
    if (it.kind === 'photo' && it.image_path) {
      it.image_url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: it.image_path }), { expiresIn: 43200 }).catch(() => null)
    }
  })))
  const brollRows = brollIds.length
    ? await sql`SELECT id, storage_path FROM videos WHERE id = ANY(${brollIds}) AND user_id = ${userId} AND storage_path IS NOT NULL`
    : []
  const stockUrls: Record<string, string> = Object.fromEntries(await Promise.all(brollRows.map(async r =>
    [r.id as string, await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: r.storage_path }), { expiresIn: 43200 })])))

  return {
    id: clip.id, start_ms: clip.start_ms, end_ms: clip.end_ms, video_id: clip.video_id,
    segments,
    // (as the brand writes them: its spellings, its hidden words — as the editor and the export show them)
    words: brandCaptionWords([...words] as unknown as TranscriptWord[], await brandWordsFor(userId, clipId)),
    captionStyle: (style as unknown as CaptionStyle) ?? null,
    textOverlays: (overlays as unknown as TextOverlay[]).filter(t => !t.hidden),
    stockUrls,
    trims: Array.isArray(clip.trim_ranges) ? clip.trim_ranges : [],
  }
}
