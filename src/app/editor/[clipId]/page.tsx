import { withSavedStyle } from '@/modules/editor/textStyle'
import { redirect, notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { requireUser } from '@/server/auth'
import { EditorShell } from './EditorShell'
import { EditorShellMobile } from './EditorShellMobile'
import sql from '@/lib/db'
import { cleanBrandOn } from '@/lib/shared/brandOn'
import { cleanProgressBar } from '@/lib/shared/brandKit'
import { brandCaptionWords } from '@/lib/brandWords'
import { r2, R2_BUCKET } from '@/lib/r2'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { TranscriptWord, CaptionStyle, TextOverlay, AudioTrack, Transition, Overlay } from '@chai-cut/shared'

export const dynamic = 'force-dynamic'

export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ clipId: string }>
  searchParams: Promise<{ layout?: string; from?: string }>
}) {
  const { clipId } = await params
  const { layout: layoutParam, from } = await searchParams
  // Which clip board it was opened from (the dashboard's AI edit / Manual edit choice): "Clip board" goes back to that one
  const backStart = from === 'ai' || from === 'manual' ? from : undefined
  const initialLayout = layoutParam === 'horizontal' ? 'horizontal' : 'vertical'

  const ua = (await headers()).get('user-agent') ?? ''
  const isMobile = /Mobi|Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua)

  const user = await requireUser()
  if (!user) redirect('/login')

  const [clip] = await sql`
    SELECT c.*, v.storage_path, v.status AS video_status, v.user_id, v.title AS video_title, v.duration_ms AS video_duration_ms,
      to_jsonb(v)->>'proxy_path' AS proxy_path
    FROM clips c JOIN videos v ON v.id = c.video_id
    WHERE c.id = ${clipId}
  `
  if (!clip || clip.user_id !== user.id) notFound()

  // Fire all independent queries in parallel — one round-trip after the clip fetch
  const [
    signedUrl,
    wordsRaw,
    segmentsRaw,
    captionStylesRaw,
    textOverlaysRaw,
    audioTracksRaw,
    transitionsRaw,
    overlaysRaw,
  ] = await Promise.all([
    // The editor plays the video's editing copy when it has one (the worker's jobs/proxy.ts:
    // keyframes every half second, so dragging through it is quick); the export uses the original
    clip.storage_path
      ? getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: clip.proxy_path || clip.storage_path }), { expiresIn: 43200 })
      : Promise.resolve(''),
    // Prefer newest transcript that has words; fall back to newest empty if none
    sql`
      SELECT tw.* FROM transcript_words tw
      WHERE tw.transcript_id = (
        SELECT t.id FROM transcripts t
        WHERE t.video_id = ${clip.video_id}
          AND EXISTS (SELECT 1 FROM transcript_words WHERE transcript_id = t.id)
        ORDER BY t.created_at DESC LIMIT 1
      )
      ORDER BY tw.start_ms
    `,
    sql`
      SELECT s.*, COALESCE(
        json_agg(
          jsonb_build_object(
            'id', cb.id, 'segment_id', cb.segment_id, 'slot_index', cb.slot_index,
            'source_video_id', cb.source_video_id, 'source_offset_ms', cb.source_offset_ms,
            'image_path', cb.image_path, 'image_motion', cb.image_motion,
            'volume', cb.volume, 'muted', cb.muted, 'hidden', (to_jsonb(cb)->>'hidden')::boolean,
            'box_keyframes', COALESCE(
              (SELECT json_agg(bk.* ORDER BY bk.t_ms) FROM box_keyframes bk WHERE bk.box_id = cb.id),
              '[]'
            )
          ) ORDER BY cb.slot_index
        ) FILTER (WHERE cb.id IS NOT NULL),
        '[]'
      ) AS crop_boxes
      FROM segments s
      LEFT JOIN crop_boxes cb ON cb.segment_id = s.id
      WHERE s.clip_id = ${clipId}
      GROUP BY s.id
      ORDER BY s.sort_order
    `,
    sql`SELECT * FROM caption_styles WHERE clip_id = ${clipId}`,
    sql`SELECT * FROM text_overlays WHERE clip_id = ${clipId}`,
    sql`SELECT * FROM audio_tracks WHERE clip_id = ${clipId}`,
    sql`SELECT * FROM transitions WHERE clip_id = ${clipId}`,
    sql`SELECT * FROM overlays WHERE clip_id = ${clipId} ORDER BY z_index`,
  ])

  // As the brand writes them (brand kit Phase 5: its spellings, its hidden words)
  const { brandWordsFor } = await import('@/server/services/brandKits')
  const words: TranscriptWord[] = brandCaptionWords([...wordsRaw] as unknown as TranscriptWord[], await brandWordsFor(user.id, clipId))
  // Only this clip's own captions are waited for: a whole-video reading (AI edit) can take many
  // minutes, and the clip's captions are made on their own, for just its stretch, when asked
  const [pendingJob] = await sql`
    SELECT 1 FROM jobs WHERE type = 'transcribe' AND payload->>'video_id' = ${clip.video_id}
      AND payload->>'clip_id' = ${clipId} AND status IN ('queued', 'processing') LIMIT 1`
  const captionStyles = captionStylesRaw as unknown as CaptionStyle[]
  // (each with its Text-tool look, saved as one field)
  const textOverlays = (textOverlaysRaw as unknown as TextOverlay[]).map(withSavedStyle)
  const audioTracks = audioTracksRaw as unknown as AudioTrack[]
  // Stored songs play from storage (they survive a reload); old name-only entries have none
  const { musicUrls } = await import('@/server/services/music')
  const initialMusicUrls = await musicUrls(audioTracks)
  const transitions = transitionsRaw as unknown as Transition[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let segments: any[] = segmentsRaw as any[]

  // Heal segments with accidental absolute timestamps. Videos put in between make the clip longer
  // than its stretch of the video (modules/editor/inserts.ts): that time is the clip's too.
  const insertedMs = segments
    .filter(s => s.video_offset_ms != null && !String(s.layout).startsWith('frame_')
      && s.crop_boxes?.[0]?.source_video_id && s.crop_boxes[0].source_video_id !== clip.video_id)
    .reduce((t, s) => t + Math.max(0, Number(s.end_ms) - Number(s.start_ms)), 0)
  // Parts played slower last longer on the timeline than their video (faster: shorter)
  const speedMs = segments
    .filter(s => !(s.crop_boxes?.[0]?.source_video_id && s.crop_boxes[0].source_video_id !== clip.video_id) && Number(s.speed) > 0 && Number(s.speed) !== 1)
    .reduce((t, s) => t + (Number(s.end_ms) - Number(s.start_ms)) * (1 - Number(s.speed)), 0)
  const clipDuration = clip.end_ms - clip.start_ms + insertedMs + Math.max(0, speedMs)
  const healPromises: Promise<unknown>[] = []
  for (const seg of segments) {
    if (seg.start_ms >= clipDuration || seg.end_ms > clipDuration) {
      const corrStart = Math.max(0, Math.min(seg.start_ms - clip.start_ms, clipDuration))
      const corrEnd = Math.max(corrStart + 1000, Math.min(seg.end_ms - clip.start_ms, clipDuration))
      healPromises.push(sql`UPDATE segments SET start_ms = ${corrStart}, end_ms = ${corrEnd} WHERE id = ${seg.id}`)
      seg.start_ms = corrStart
      seg.end_ms = corrEnd
    }
  }
  if (healPromises.length) await Promise.all(healPromises)

  if (segments.length === 0) {
    const [newSeg] = await sql`
      INSERT INTO segments (clip_id, start_ms, end_ms, layout, sort_order)
      VALUES (${clipId}, 0, ${clip.end_ms - clip.start_ms}, ${initialLayout}, 0)
      RETURNING *
    `
    if (newSeg) {
      const [newBox] = await sql`
        INSERT INTO crop_boxes (segment_id, slot_index)
        VALUES (${newSeg.id}, 0)
        RETURNING *
      `
      segments = [{ ...newSeg, crop_boxes: newBox ? [{ ...newBox, box_keyframes: [] }] : [] }]
    }
  }

  // Frame photos (lane items, and slots saved before lanes existed): sign them so the preview can draw them
  const sign = (key: string) => getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 43200 }).catch(() => undefined)
  // Download link of the last export: a fresh one on every load. The link stored with the clip
  // expires after 7 days; the file path doesn't.
  const outputUrl = clip.status === 'done' && clip.output_storage_path ? (await sign(clip.output_storage_path)) ?? null : null
  await Promise.all(segments.flatMap(seg => [
    ...(seg.crop_boxes ?? []).map(async (box: { image_path?: string | null; image_url?: string }) => {
      if (box.image_path) box.image_url = await sign(box.image_path)
    }),
    ...((seg.frame as { items?: { image_path?: string | null; image_url?: string | null }[] } | null)?.items ?? []).map(async it => {
      if (it.image_path) it.image_url = (await sign(it.image_path)) ?? null
    }),
  ]))

  // Sign overlay image URLs (fast local operation, run in parallel)
  const overlays: Overlay[] = await Promise.all((overlaysRaw as unknown as Overlay[]).map(async ov => {
    if (ov.type === 'image' && ov.storage_path) {
      const preview_url = await getSignedUrl(
        r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: ov.storage_path }), { expiresIn: 43200 }
      ).catch(() => undefined)
      return { ...ov, preview_url }
    }
    return ov
  }))

  const shellProps = {
    clip: {
      ...clip, output_url: outputUrl, captions_pending: !!pendingJob,
      // No editing copy yet (a video from before they were made): the editor asks for one
      needs_proxy: !clip.proxy_path && clip.video_status === 'ready' && !!clip.storage_path,
    } as unknown as Parameters<typeof EditorShell>[0]['clip'],
    videoUrl: signedUrl,
    words,
    initialSegments: segments ?? [],
    initialCaptionStyles: captionStyles ?? [],
    initialTextOverlays: textOverlays ?? [],
    initialAudioTracks: audioTracks ?? [],
    initialMusicUrls,
    // The clip's own sound (Music panel); read loosely so it works before the backend adds the columns
    initialOriginalSound: {
      volume: clip.original_volume == null ? 1 : Number(clip.original_volume),
      muted: clip.original_muted === true,
    },
    // The clip's progress bar (a brand kit's), before the backend adds the column too
    initialProgressBar: cleanProgressBar((clip as { progress_bar?: unknown }).progress_bar),
    initialBrand: cleanBrandOn((clip as { brand?: unknown }).brand),
    initialTransitions: transitions ?? [],
    initialOverlays: overlays ?? [],
  }

  return isMobile ? <EditorShellMobile {...shellProps} /> : <EditorShell {...shellProps} backStart={backStart} />
}
