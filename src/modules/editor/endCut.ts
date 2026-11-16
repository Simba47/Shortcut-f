import type { SegmentLocal } from '@chai-cut/shared'
import { isGapPart } from './visibility'

/**
 * Deleting the main video's LAST part ends the clip there (user, 2026-11-15: "a 2 min clip, the last
 * 1:30 deleted, exports 2 min" — Delete leaves an empty space and the clip kept its length, so the
 * export played 1:30 of black). In the middle, Delete still leaves an empty space (nothing after it
 * moves); at the end there is nothing to keep in place, so that stretch is cut out instead, as an
 * edge dragged in would — and empty spaces just before it go with it, so no black is left at the end.
 *
 * The stretch to cut, in timeline ms, or null to leave an empty space as before:
 *  - only parts of the main row after it, all empty spaces (or none): it is the last part with video
 *  - nothing plays there on another row or on top — a video or photo on a row, a picture or video in
 *    a window, a text — nor past the main row's end (the room kept after it for such things): then
 *    the stretch is kept, as an empty space, so what plays there keeps its time
 */
export function endCut(opts: {
  segments: SegmentLocal[]
  mainVideoId: string | null | undefined
  /** Photos / videos on top and texts: anything that plays over the clip at a time */
  onTop: ReadonlyArray<{ start_ms: number; end_ms: number }>
  /** A video or photo on a row (not the main row) */
  isShot: (s: SegmentLocal) => boolean
  /** The room kept after the main row for things that reach past it (EditorShell isTail) */
  isTail: (s: SegmentLocal) => boolean
  /** The main-row part being deleted */
  partId: string
}): { start: number; end: number } | null {
  const { segments, mainVideoId, onTop, isShot, isTail, partId } = opts
  if (segments.some(isTail)) return null
  const main = segments.filter(s => !isShot(s) && !isTail(s)).sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms)
  const i = main.findIndex(s => s.id === partId)
  if (i < 0) return null
  const part = main[i]
  if (!main.slice(i + 1).every(s => isGapPart(s, mainVideoId))) return null
  const end = Math.max(...main.map(s => s.end_ms))
  const shots = segments.filter(isShot)
  const covered = (a: number, b: number) =>
    shots.some(s => s.start_ms < b && s.end_ms > a) || onTop.some(o => o.start_ms < b && o.end_ms > a)
  if (covered(part.start_ms, end)) return null
  // Empty spaces just before it, touching it, with nothing playing on them, go too
  let start = part.start_ms
  for (let k = i - 1; k >= 0; k--) {
    const s = main[k]
    if (!isGapPart(s, mainVideoId) || Math.abs(s.end_ms - start) > 1 || covered(s.start_ms, s.end_ms)) break
    start = s.start_ms
  }
  return end - start > 0 ? { start, end } : null
}
