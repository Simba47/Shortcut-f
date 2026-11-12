import type { AudioTrack, CropBoxLocal, FrameItem, FrameSettings, SegmentLocal, Transition } from '@chai-cut/shared'
import { fitsOn, type TrackItem } from './tracks'
import { fitHolds, laneItems, MIN_ITEM_MS } from './frames'
import type { KeyframeMap } from './store'
import { rippleInsert } from './inserts'
import { isMainAudioTrack, type TimedState } from './trimState'

// ── Duplicate (Ctrl+D, the button beside Split; user, 2026-11-12) ─────────────────────────────────
// A copy of what's picked on the timeline — text, a photo, a video on a row, music, or several picked
// together — goes right after it on the same row. Something in the way there, or too little of the
// clip left after it: the same time, on the next row up with room (a new row on top if need be).
// Inside a frame a copy stays in its lane, after the original, in what room there is.

/** A copy shorter than this isn't made (the clip's end too close) */
export const MIN_COPY_MS = 200

/** Something picked to copy: on a visual row (videos, photos, text) or an audio row (music) */
export interface CopyItem extends TrackItem { family: 'visual' | 'audio' }
/** Where a copy goes */
export interface CopySpot { id: string; start_ms: number; end_ms: number; track: number }

/**
 * Where the copies of `picked` go (each spot names the original it copies). Right after them on the
 * same rows: the whole picked stretch later, so several keep their places to each other; cut short at
 * the clip's end. When anything is in the way there, or a copy would be shorter than MIN_COPY_MS: at
 * the same times, the fewest rows up where they all have room (visual and audio rows each on their
 * own). `all`: everything on the rows, the picked things too.
 */
export function copySpots(picked: CopyItem[], all: CopyItem[], clipLenMs: number): CopySpot[] {
  if (!picked.length) return []
  const from = Math.min(...picked.map(p => p.start_ms))
  const to = Math.max(...picked.map(p => p.end_ms))
  const d = to - from
  const after = picked.map(p => ({ id: p.id, start_ms: p.start_ms + d, end_ms: Math.min(clipLenMs, p.end_ms + d), track: p.track ?? 0 }))
  const rows = (family: CopyItem['family']) => all.filter(i => i.family === family)
  const fitsAfter = after.every((c, i) => c.end_ms - c.start_ms >= MIN_COPY_MS
    && fitsOn(rows(picked[i].family), c.track, c.start_ms, c.end_ms))
  if (fitsAfter) return after
  // (the same times, rows up)
  return lifted(picked, all)
}

/**
 * `picked` at their own times, each family's rows (visual, audio) the fewest k up where they all
 * have room (they don't clash with each other there: they didn't on their own rows)
 */
function lifted(picked: CopyItem[], all: CopyItem[]): CopySpot[] {
  const lift = (family: CopyItem['family']) => {
    const mine = picked.filter(p => p.family === family)
    const others = all.filter(i => i.family === family)
    if (!mine.length) return 0
    for (let k = 1; ; k++) if (mine.every(p => fitsOn(others, (p.track ?? 0) + k, p.start_ms, p.end_ms))) return k
  }
  const k = { visual: lift('visual'), audio: lift('audio') }
  return picked.map(p => ({ id: p.id, start_ms: p.start_ms, end_ms: p.end_ms, track: (p.track ?? 0) + k[p.family] }))
}

/**
 * Where pasted things go (Ctrl+V; user, 2026-11-12): the earliest at `at`, the rest in their places
 * to it, each on the row it came from — cut short at the clip's end (one with less than MIN_COPY_MS
 * left is left out). Anything in the way: the same times, the fewest rows up. `all`: what's on the rows.
 */
export function pasteSpots(picked: CopyItem[], all: CopyItem[], at: number, clipLenMs: number): CopySpot[] {
  if (!picked.length) return []
  const d = at - Math.min(...picked.map(p => p.start_ms))
  const moved = picked.map(p => ({ ...p, start_ms: p.start_ms + d, end_ms: Math.min(clipLenMs, p.end_ms + d) }))
    .filter(p => p.end_ms - p.start_ms >= MIN_COPY_MS)
  const fits = moved.every(p => fitsOn(all.filter(i => i.family === p.family), p.track ?? 0, p.start_ms, p.end_ms))
  return fits ? moved.map(p => ({ id: p.id, start_ms: p.start_ms, end_ms: p.end_ms, track: p.track ?? 0 })) : lifted(moved, all)
}

/**
 * Where a copy of an item in a frame goes: right after it in its lane, as long as it is, cut short by
 * the next item there or the frame's end. Null: no room for it (less than MIN_ITEM_MS).
 */
export function frameCopySpot(frame: FrameSettings, item: FrameItem, seg: { start_ms: number; end_ms: number }): { start_ms: number; end_ms: number } | null {
  const start = Math.max(seg.start_ms, item.end_ms)
  const len = Math.min(item.end_ms, seg.end_ms) - Math.max(item.start_ms, seg.start_ms)
  const next = laneItems(frame, item.lane, seg).find(it => it.id !== item.id && it.start_ms >= item.end_ms)
  const end = Math.min(start + len, next ? next.start_ms : Infinity, seg.end_ms)
  return end - start >= MIN_ITEM_MS ? { start_ms: start, end_ms: end } : null
}

/** An item in a frame copied to [start, end): the same pictures from the same moment; never "back to a row" */
export function copyFrameItem(item: FrameItem, spot: { start_ms: number; end_ms: number }, id: string): FrameItem {
  const copy: FrameItem = { ...item, id, start_ms: spot.start_ms, end_ms: spot.end_ms, from_row: null }
  if (item.holds) {
    const holds = fitHolds(item.holds, spot.end_ms - spot.start_ms)
    copy.holds = holds.length ? holds : null
  }
  return copy
}

/**
 * A video on a row copied to `spot`: new ids for it and its boxes, the same video from the same
 * moment, its views moved with it.
 */
export function copyShot(seg: SegmentLocal, keyframes: KeyframeMap, spot: CopySpot, newId: () => string = () => crypto.randomUUID()):
  { segment: SegmentLocal; keyframes: KeyframeMap } {
  const d = spot.start_ms - seg.start_ms
  const kfs: KeyframeMap = {}
  const crop_boxes = seg.crop_boxes.map(b => {
    const id = newId()
    // (a box with none in the map yet: its own, as the store registers a new box's)
    kfs[id] = (keyframes[b.id] ?? b.keyframes ?? []).map(k => ({ ...k, id: newId(), box_id: id, t_ms: k.t_ms + d })).sort((x, y) => x.t_ms - y.t_ms)
    return { ...b, id, keyframes: (b.keyframes ?? []).map(k => ({ ...k, t_ms: k.t_ms + d })) }
  })
  return { segment: { ...seg, id: newId(), start_ms: spot.start_ms, end_ms: spot.end_ms, track: spot.track, crop_boxes }, keyframes: kfs }
}

/**
 * A part of the main row as copied (Duplicate, Ctrl+C): the part itself (saying which moment of the
 * main video it plays: the caller pins them first), its views, the main video's detached sound under
 * it (on the timeline where it was) and the transition after it.
 */
export interface CopiedPart {
  seg: SegmentLocal
  keyframes: KeyframeMap
  sounds: AudioTrack[]
  transition: Transition | null
  /** A video put in between (it holds the main video), not a part of the main video */
  insert: boolean
}

/** The parts `ids` of the main row (`isPart`), in time order, as copies take them */
export function copyPartsOf(state: TimedState, ids: string[], isPart: (s: SegmentLocal) => boolean): CopiedPart[] {
  return state.segments.filter(s => ids.includes(s.id) && isPart(s)).sort((a, b) => a.start_ms - b.start_ms).map(seg => ({
    seg,
    keyframes: Object.fromEntries(seg.crop_boxes.map(b => [b.id, state.keyframes[b.id] ?? []])),
    sounds: state.audioTracks.flatMap(t => {
      if (!isMainAudioTrack(t) || t.end_ms == null) return []
      const from = Math.max(t.start_ms, seg.start_ms), to = Math.min(t.end_ms, seg.end_ms)
      return to - from < 1 ? [] : [{ ...t, start_ms: from, end_ms: to, offset_ms: (t.offset_ms ?? 0) + (from - t.start_ms) }]
    }),
    transition: state.transitions.find(t => t.after_segment_id === seg.id) ?? null,
    insert: seg.video_offset_ms != null,
  }))
}

/**
 * Where copied parts go in, at `at` on the main row: from the same clip's main video, each plays
 * its own moment again, with its format, views, frame items and detached sound; from another
 * video, each goes in as a video put in between, playing that stretch of the other video full
 * frame (`video`: its id and where its clip starts in it). `hold`: where the main video waits meanwhile
 * (for videos put in between); absent: they keep their own.
 */
export type PartsTarget = { same: true; hold?: number } | { same: false; video: string; clipStart: number; hold: number }

/**
 * Copied parts put in as one block at `at`: everything from there on moves later by the block's
 * length (rippleInsert: a part running across `at` is cut in two there, what runs across gets
 * longer) and the clip gets that much longer. A transition after a copied part goes with its copy
 * (not the last one's). Returns the new state, the copies' ids and the block's length.
 */
export function placeParts(state: TimedState, parts: CopiedPart[], at: number, target: PartsTarget, newId: () => string = () => crypto.randomUUID()):
  { state: TimedState; copies: string[]; len: number } {
  const len = parts.reduce((t, p) => t + (p.seg.end_ms - p.seg.start_ms), 0)
  const next = rippleInsert(state, at, len, newId)
  const keyframes: KeyframeMap = { ...next.keyframes }
  const copies: SegmentLocal[] = [], sounds: AudioTrack[] = [], transitions: Transition[] = []
  let cursor = at
  parts.forEach((p, n) => {
    const d = cursor - p.seg.start_ms, plen = p.seg.end_ms - p.seg.start_ms
    const id = newId()
    if (!target.same) {
      // Another video's part: a video put in between, playing that stretch of it
      const main = p.seg.crop_boxes.find(b => !b.image_path && (p.insert ? !!b.source_video_id : !b.source_video_id)) ?? p.seg.crop_boxes[0]
      const boxId = newId(), view = { x: 0, y: 0, w: 1, h: 1 }
      const box = {
        id: boxId, slot_index: 0, image_path: null, image_motion: null,
        source_video_id: p.insert ? main.source_video_id : target.video,
        source_offset_ms: Math.max(0, Math.round((p.insert ? 0 : target.clipStart) + (main.source_offset_ms ?? 0))),
        volume: main.volume ?? 1, muted: !!(main.muted || p.seg.muted), keyframes: [{ t_ms: cursor, ...view }],
      } as CropBoxLocal
      keyframes[boxId] = [{ id: newId(), box_id: boxId, t_ms: cursor, ...view }] as KeyframeMap[string]
      copies.push({ id, start_ms: cursor, end_ms: cursor + plen, layout: 'vertical', sort_order: 0, crop_boxes: [box], video_offset_ms: target.hold })
    } else {
      const crop_boxes = p.seg.crop_boxes.map(b => {
        const bid = newId()
        keyframes[bid] = (p.keyframes[b.id]?.length ? p.keyframes[b.id] : (b.keyframes ?? []) as KeyframeMap[string])
          .map(k => ({ ...k, id: newId(), box_id: bid, t_ms: k.t_ms + d })).sort((x, y) => x.t_ms - y.t_ms)
        return { ...b, id: bid, keyframes: (b.keyframes ?? []).map(k => ({ ...k, t_ms: k.t_ms + d })) }
      })
      const frame = p.seg.frame?.items ? { ...p.seg.frame, items: p.seg.frame.items.map(it => ({ ...it, id: newId(), start_ms: it.start_ms + d, end_ms: it.end_ms + d })) } : p.seg.frame
      const hold = p.insert && target.hold != null ? { video_offset_ms: target.hold } : {}
      const { locked: _l, ...rest } = p.seg
      copies.push({ ...rest, id, start_ms: cursor, end_ms: cursor + plen, crop_boxes, frame, ...hold })
      // Its detached sound, said again (rippleInsert left that time silent)
      for (const t of p.sounds) sounds.push({ ...t, id: newId(), start_ms: t.start_ms + d, end_ms: (t.end_ms ?? t.start_ms) + d })
    }
    if (p.transition && n < parts.length - 1) transitions.push({ ...p.transition, id: newId(), after_segment_id: id })
    cursor += plen
  })
  const segments = [...next.segments, ...copies]
    .sort((a, b) => a.start_ms - b.start_ms || a.sort_order - b.sort_order).map((s, i) => ({ ...s, sort_order: i }))
  return {
    state: { ...next, segments, keyframes, transitions: [...next.transitions, ...transitions], audioTracks: [...next.audioTracks, ...sounds] },
    copies: copies.map(c => c.id), len,
  }
}

/**
 * Parts of the main row played again (Duplicate; user, 2026-11-12): copies of the parts `ids` go in
 * as one block right after the last of them, in their order (placeParts). Each copy plays what its
 * part plays — the same moment of the main video (`segments` must say each part's moment: EditorShell
 * pins them, as for a move) or the same video put in between. The last part's transition, into what
 * came next, comes after the block. Null: none of `ids` is a part of the main row.
 */
export function duplicateParts(state: TimedState, ids: string[], isPart: (s: SegmentLocal) => boolean, newId: () => string = () => crypto.randomUUID()):
  { state: TimedState; copies: string[]; at: number; len: number } | null {
  const parts = copyPartsOf(state, ids, isPart)
  if (!parts.length) return null
  const last = parts[parts.length - 1].seg
  const out = placeParts(state, parts, last.end_ms, { same: true }, newId)
  const lastCopy = out.copies[out.copies.length - 1]
  const transitions = out.state.transitions.map(t => (t.after_segment_id === last.id ? { ...t, after_segment_id: lastCopy } : t))
  return { state: { ...out.state, transitions }, copies: out.copies, at: last.end_ms, len: out.len }
}

/**
 * How much of the main video its parts play more than once (ms): what they play in all, less the
 * video they cover (a part duplicated plays its moment again — the clip is that much longer than
 * its stretch of the video). Each part: where in the video it starts (`from`) and how much it plays.
 */
export function repeatedVideoMs(parts: { from: number; ms: number }[]): number {
  const spans = parts.filter(p => p.ms > 0).map(p => [p.from, p.from + p.ms] as const).sort((a, b) => a[0] - b[0])
  let covered = 0, end = -Infinity
  for (const [a, b] of spans) {
    if (b <= end) continue
    covered += b - Math.max(a, end)
    end = b
  }
  return Math.max(0, Math.round(spans.reduce((t, [a, b]) => t + (b - a), 0) - covered))
}
