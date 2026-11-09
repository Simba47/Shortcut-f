// A clip's saved rows as the editor's state: what the editor does when it opens a clip, and what
// Reset does with the AI's copy of a Make my clips clip (the worker's clip_ai_made) — one path, so
// a clip reset to the AI's version is exactly the clip the AI made.
import type { AudioTrack, BoxKeyframe, CropBox, Overlay, Segment, TextOverlay, Transition } from '@chai-cut/shared'
import { cleanTrims, trimMap } from '@/lib/trims'
import { toTimelineState, isMainAudioTrack, type TimedState } from './trimState'
import { insertsOf, insertedMs } from './inserts'
import { fillUncovered } from './place'
import type { KeyframeMap } from './store'
import { rowsToLocal, normalizeCoverage, defaultCropForSlot } from './utils'
import { isShot, restoreLayers } from './shots'
import { freeTrackIn, settleTracks, savedLanes, type TrackItem } from './tracks'
import { inFramePicture } from './framePicture'
import type { LayoutType } from '@chai-cut/shared'

export interface SegmentRow extends Omit<Segment, never> {
  crop_boxes: (CropBox & { box_keyframes: BoxKeyframe[] })[]
}

export function stateFromRows(src: {
  rows: SegmentRow[]
  layers: unknown
  mainVideoId: string
  startMs: number
  endMs: number
  trimRanges: unknown
  overlays: Overlay[]
  textOverlays: TextOverlay[]
  audioTracks: AudioTrack[]
  transitions: Transition[]
}): { loaded: TimedState; trims: ReturnType<typeof cleanTrims>; lenMs: number } {
  const ownVideoId = src.mainVideoId
  // Saved as one row of parts, a video on top (B-roll) cutting the section under it: here the
  // sections are whole again and the videos lie over them (shots.ts)
  const restored = restoreLayers(rowsToLocal(src.rows), src.layers, ownVideoId)
  // (videos put in between make the clip longer than its stretch of the video)
  const lenMs = Math.max(src.endMs - src.startMs + insertedMs(insertsOf(restored.segments, ownVideoId)), ...restored.segments.map(s => s.end_ms))
  const localSegments = [
    // (time no part covers gets a Vertical part of its own: no "default framing" anywhere)
    ...fillUncovered(normalizeCoverage(restored.segments.filter(s => !isShot(s, ownVideoId)), lenMs), lenMs, ownVideoId),
    ...restored.segments.filter(s => isShot(s, ownVideoId)).map(s => ({ ...s, end_ms: Math.min(s.end_ms, lenMs) })).filter(s => s.end_ms - s.start_ms >= 100),
  ].sort((a, b) => a.start_ms - b.start_ms)
  const keyframes: KeyframeMap = {}
  for (const seg of localSegments) {
    for (const box of seg.crop_boxes) {
      const kfs = box.keyframes?.length ? box.keyframes : [{ t_ms: seg.start_ms, ...inFramePicture(defaultCropForSlot(seg.layout as LayoutType, box.slot_index)) }]
      keyframes[box.id] = kfs.map(k => ({ id: (k as { id?: string }).id ?? crypto.randomUUID(), box_id: box.id, t_ms: k.t_ms, x: k.x, y: k.y, w: k.w, h: k.h })) as KeyframeMap[string]
    }
  }
  // A transition after a part that was joined back into its section stays with that section
  const transitions = src.transitions
    .map(t => (restored.renamed[t.after_segment_id] ? { ...t, after_segment_id: restored.renamed[t.after_segment_id] } : t))
    .filter((t, i, all) => all.findIndex(x => x.after_segment_id === t.after_segment_id) === i)
  // Saved in source clip time; shown with the removed parts closed up
  const trims = cleanTrims(src.trimRanges, src.startMs, src.endMs)
  let loaded: TimedState = {
    segments: localSegments, keyframes,
    overlays: src.overlays, textOverlays: src.textOverlays, audioTracks: src.audioTracks, transitions,
  }
  if (trims.length) loaded = toTimelineState(loaded, trimMap(trims, src.startMs, src.endMs), src.startMs)
  // Tracks (as in CapCut, tracks.ts): videos on top, photos and text share the visual tracks,
  // music has its own. Each goes back on the track it was saved on.
  const lanes = savedLanes(src.layers)
  const vis = settleTracks([
    ...loaded.segments.filter(s => isShot(s, ownVideoId)).map(s => ({ id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, track: s.track ?? 0 })),
    ...loaded.overlays.filter(o => o.type === 'image').map(o => ({ id: o.id, start_ms: o.start_ms, end_ms: o.end_ms })),
    ...loaded.textOverlays.map(o => ({ id: o.id, start_ms: o.start_ms, end_ms: o.end_ms })),
  ], lanes)
  // Music keeps its saved track (a song's own length isn't known yet); music saved without one gets the lowest with room
  const songs = loaded.audioTracks.filter(t => !isMainAudioTrack(t))
    .map((t): TrackItem => ({ id: t.id, start_ms: t.start_ms, end_ms: t.end_ms ?? lenMs, ...(lanes[t.id] != null ? { track: lanes[t.id] } : {}) }))
  const aud: Record<string, number> = {}
  const placed = songs.filter(t => t.track != null)
  for (const t of placed) aud[t.id] = t.track!
  for (const t of songs.filter(x => x.track == null).sort((a, b) => a.start_ms - b.start_ms)) {
    aud[t.id] = freeTrackIn(placed, t.start_ms, t.end_ms)
    placed.push({ ...t, track: aud[t.id] })
  }
  loaded = {
    ...loaded,
    segments: loaded.segments.map(s => (isShot(s, ownVideoId) && vis[s.id] != null && (s.track ?? 0) !== vis[s.id] ? { ...s, track: vis[s.id] } : s)),
    overlays: loaded.overlays.map(o => (vis[o.id] != null ? { ...o, track: vis[o.id] } : o)),
    textOverlays: loaded.textOverlays.map(o => (vis[o.id] != null ? { ...o, track: vis[o.id] } : o)),
    audioTracks: loaded.audioTracks.map(t => (aud[t.id] != null ? { ...t, track: aud[t.id] } : t)),
  }
  return { loaded, trims, lenMs }
}
