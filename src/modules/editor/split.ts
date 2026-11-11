import type { SegmentLocal } from '@chai-cut/shared'
import { isInsert } from './inserts'
import { isGapPart } from './visibility'

const MIN_MS = 100

/**
 * What Split (with no media selected) cuts at `t`, as in Resolve: only clips. A video on top that is
 * picked, with the playhead inside it; else the part of the main row there — unless the main row is
 * empty there (the room after the main video, for what's on top to run on, or the space a deleted
 * part left): nothing of it is cut (a piece of that hidden room would show up as a "Video" part),
 * the videos on top or below under the playhead are cut instead. Nothing to cut: no ids.
 */
export function splitTargets(
  t: number,
  section: SegmentLocal | null | undefined,
  shots: SegmentLocal[],
  pickedShot: SegmentLocal | null | undefined,
  mainVideoId: string | null | undefined,
): { ids: string[]; main: boolean } {
  const inside = (s: SegmentLocal) => t > s.start_ms + MIN_MS && t < s.end_ms - MIN_MS
  if (pickedShot && t > pickedShot.start_ms && t < pickedShot.end_ms) return { ids: inside(pickedShot) ? [pickedShot.id] : [], main: false }
  const empty = !!section && (isGapPart(section, mainVideoId) || (isInsert(section, mainVideoId) && !!section.hidden && !!section.crop_boxes[0]?.hidden))
  if (empty) return { ids: shots.filter(inside).map(s => s.id), main: false }
  return { ids: section && inside(section) ? [section.id] : [], main: true }
}

/**
 * The playhead still rests on the cut just made, which is the first moment of the part after it: the
 * part before stays picked there (pausing can nudge the playhead a few ms). Once it moves on, the pick follows it
 */
export function restsOnSplit(just: { id: string; t: number } | null, id: string, t: number): boolean {
  return just?.id === id && Math.abs(t - just.t) < 40
}

/**
 * The part of the main row Freeze goes on: the one picked, else the one under the playhead (user, 2026-11-10:
 * a clip with nothing picked, or no frame or media in it). None while other media is picked, or where no main video plays
 */
export function freezePart(picked: SegmentLocal | undefined, here: SegmentLocal | undefined, otherPicked: boolean, mainVideoId: string | null | undefined): SegmentLocal | null {
  const part = otherPicked ? undefined : picked ?? here
  return part && !isGapPart(part, mainVideoId) && !isInsert(part, mainVideoId) && !part.frame?.no_main ? part : null
}
