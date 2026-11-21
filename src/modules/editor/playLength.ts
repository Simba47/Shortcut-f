import type { SegmentLocal } from '@chai-cut/shared'
import { cleanTrims, trimMap } from '@/lib/trims'
import { insertsOf, piecesOf, piecesLength } from './inserts'
import { isShot } from './shots'
import { isMainShot } from './visibility'

/**
 * How long a clip plays (ms), worked out as the editor does (EditorShell `clip`) and as the export makes
 * it (render.ts): parts removed from it → its stretch of the video less those; a clip of pieces (a video
 * put in between, a part duplicated, moved or frozen) → as long as its pieces; else its stretch of the
 * video. Its price to export and the 5-minute limit go by this (user, 2026-11-21: a 2:30 clip with its
 * last 1:30 deleted showed 1 credit and was charged 3 — the server went by end_ms − start_ms, which a
 * removed part doesn't change).
 */
export function playLengthMs(clip: { start_ms: number; end_ms: number; trim_ranges?: unknown }, segments: SegmentLocal[], mainVideoId: string | null | undefined): number {
  const start = Number(clip.start_ms), end = Number(clip.end_ms)
  const trims = cleanTrims(clip.trim_ranges, start, end)
  if (trims.length) return trimMap(trims, start, end).lengthMs
  // (the main row: videos on rows play over it; a part of the main video moved onto a row plays as part of it)
  const layer = (s: SegmentLocal) => isShot(s, mainVideoId) && !isMainShot(s, mainVideoId)
  const pieces = piecesOf(segments.filter(s => !layer(s)), mainVideoId, layer, true)
  const inserts = insertsOf(segments, mainVideoId)
  const piecesOn = inserts.length > 0
    || pieces.some(p => p.hold != null && !p.blank && !inserts.some(i => i.id === p.id))
    || pieces.some(p => (p.from != null && Math.abs(p.from - p.at) > 1) || (p.speed ?? 1) !== 1)
  return piecesOn ? Math.round(piecesLength(pieces)) : end - start
}
