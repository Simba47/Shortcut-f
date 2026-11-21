import sql from '@/lib/db'
import type { SegmentLocal } from '@chai-cut/shared'
import { playLengthMs } from '@/modules/editor/playLength'
import { rowsToLocal } from '@/modules/editor/utils'

/**
 * How long each of these clips plays (ms), as the editor shows it and the export makes it
 * (modules/editor/playLength.ts) — not end_ms − start_ms, which parts removed in the editor don't change
 * (user, 2026-11-21: export credits and the 5-minute limit went by that). A clip not found is left out.
 */
export async function playLengths(clipIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!clipIds.length) return out
  const [clips, segRows] = await Promise.all([
    sql<{ id: string; video_id: string; start_ms: number; end_ms: number; trim_ranges: unknown }[]>`
      SELECT c.id, c.video_id, c.start_ms, c.end_ms, to_jsonb(c)->'trim_ranges' AS trim_ranges FROM clips c WHERE c.id = ANY(${clipIds})`,
    // (as the editor's page reads them: each part with its boxes; their views aren't needed here)
    sql`
      SELECT s.*, COALESCE(json_agg(to_jsonb(cb) || jsonb_build_object('box_keyframes', '[]'::jsonb)
        ORDER BY cb.slot_index) FILTER (WHERE cb.id IS NOT NULL), '[]') AS crop_boxes
      FROM segments s LEFT JOIN crop_boxes cb ON cb.segment_id = s.id
      WHERE s.clip_id = ANY(${clipIds}) GROUP BY s.id ORDER BY s.sort_order`,
  ])
  const byClip = new Map<string, unknown[]>()
  for (const r of segRows) byClip.set(r.clip_id as string, [...(byClip.get(r.clip_id as string) ?? []), r])
  for (const c of clips) {
    const segments = rowsToLocal((byClip.get(c.id) ?? []) as never) as SegmentLocal[]
    out.set(c.id, playLengthMs(c, segments, c.video_id))
  }
  return out
}

/** How long one clip plays (ms); its stretch of the video when it can't be worked out */
export async function playLength(clip: { id: string; start_ms: number; end_ms: number }): Promise<number> {
  try {
    return (await playLengths([clip.id])).get(clip.id) ?? clip.end_ms - clip.start_ms
  } catch (e) {
    console.error('[export] the clip\'s length could not be worked out, its stretch of the video is used:', e)
    return clip.end_ms - clip.start_ms
  }
}
