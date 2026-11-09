'use client'

import { create } from 'zustand'
import type { BoxKeyframe, SegmentLocal, CropBoxLocal, LayoutType, FrameBand, FrameItem, FrameLane, FrameSettings } from '@chai-cut/shared'
import { LAYOUT_SLOT_COUNT } from '@chai-cut/shared'
import { getBoxPositionAtLerp, type BoxPosition } from '@/lib/interpolation'
import { makeBox, defaultCropForSlot } from './utils'
import { inFramePicture } from './framePicture'
import { isFrameLayout, DEFAULT_BAND, defaultFrame, frameOf, placeNewItem, MIN_ITEM_MS, fitHolds, withItemStart, cutItem, addHold } from './frames'
import { setViewAt, recordMotionAt, removeViewChangeAt, moveViewChange, duplicateViewChange, type ViewKeyframe } from './views'
import { isShot } from './shots'
import { useMediaStore } from '@/modules/media/store'
import type { Range } from '@/lib/cuts'

export type KeyframeMap = Record<string, BoxKeyframe[]>  // boxId → sorted keyframes

// getPositionAt reads only the keyframe map, so every box created locally must be registered
// here too — otherwise a new box falls back to full frame until the user drags it.
function withBoxes(map: KeyframeMap, boxes: CropBoxLocal[]): KeyframeMap {
  const next = { ...map }
  for (const b of boxes) {
    next[b.id] = b.keyframes.map(k => ({ id: crypto.randomUUID(), box_id: b.id, ...k })).sort((a, c) => a.t_ms - c.t_ms)
  }
  return next
}

/** Keyframes (as views.ts builds them) with the ids the store keeps */
function withIds(boxId: string, kfs: ViewKeyframe[]): BoxKeyframe[] {
  return kfs.map(k => ({ id: crypto.randomUUID(), box_id: boxId, t_ms: k.t_ms, x: k.x, y: k.y, w: k.w, h: k.h }) as BoxKeyframe)
    .sort((a, b) => a.t_ms - b.t_ms)
}

interface EditorState {
  /**
   * The sections of the clip (they never overlap) AND the videos put on top of it (B-roll: see
   * shots.ts). A video on top is a layer: it lies over the sections, which stay whole under it.
   */
  segments: SegmentLocal[]
  /** The clip's own video: a section's first slot showing another video makes it a video on top */
  mainVideoId: string | null
  keyframes: KeyframeMap
  /** Parts of the video removed from this clip, in ms of the source video (lib/trims.ts) */
  trims: Range[]
  /** The clip's start and end in the source video when moved in the editor (null = as loaded) */
  clipRange: Range | null
  activeSegmentId: string | null
  activeBoxId: string | null
}

interface EditorActions {
  hydrate: (segments: SegmentLocal[], keyframes: KeyframeMap, trims?: Range[], mainVideoId?: string | null) => void
  reset: () => void
  /** A part of the video removed, or the clip's start / end moved: the sections and keyframes as they
   *  are afterwards, the removed parts, and (when it moved) the clip's start and end in the video */
  applyTrim: (segments: SegmentLocal[], keyframes: KeyframeMap, trims: Range[], clipRange?: Range) => void
  // Segments
  addSegment: (seg: Omit<SegmentLocal, 'id' | 'crop_boxes'>, onCreate?: (id: string) => void, initialBoxes?: CropBoxLocal[]) => void
  updateSegment: (id: string, updates: Partial<Omit<SegmentLocal, 'id'>>) => void
  removeSegment: (id: string) => void
  splitAtMs: (segId: string, tMs: number, getPos: (boxId: string, t: number) => BoxPosition) => string | null
  /** Change a format's layout. Each slot starts from `framing[slot]` when given, else its default framing. */
  applyLayout: (segId: string, layout: LayoutType, videoAR?: number, framing?: (BoxPosition | undefined)[]) => void
  /**
   * Framing for a format of `layout` over [startMs, endMs]: the crop of the nearest other format
   * with the same (non-frame) layout — the one touching on the left first, then on the right, then
   * the closest in time. Undefined slots mean "use the default".
   */
  neighbourFraming: (layout: LayoutType, startMs: number, endMs: number, excludeId?: string) => (BoxPosition | undefined)[] | undefined
  /**
   * Join the format with its touching neighbours that have the same (non-frame) layout, so
   * switching Split → Vertical doesn't leave separate pieces. Each part keeps its own views (the
   * crop cuts where the parts met). Skipped for frames and a join that has a transition.
   * Returns the id of the joined format.
   */
  joinSameLayoutNeighbours: (segId: string, transitionAfter?: Set<string>) => string
  // View changes (see views.ts)
  /** Move a box's view at time t (Motion off): edits the change there, or adds a cut at t */
  setViewAt: (boxId: string, t: number, pos: BoxPosition, formatStart: number) => void
  /** Record a Motion point at time t (the view glides into it) */
  recordMotionAt: (boxId: string, t: number, pos: BoxPosition) => void
  removeViewChange: (boxId: string, t: number) => void
  moveViewChange: (boxId: string, from: number, to: number, formatStart: number, formatEnd: number) => void
  /** Copy the view change at t (see views.ts duplicateViewChange). Returns where the copy went, or null if there's no room. */
  duplicateViewChange: (boxId: string, t: number, formatEnd: number) => number | null
  /** Frame slots: change what a slot shows (source video, photo, motion, volume, mute) */
  updateSlot: (segId: string, boxId: string, patch: Partial<Pick<CropBoxLocal, 'source_video_id' | 'source_offset_ms' | 'image_path' | 'image_url' | 'image_motion' | 'volume' | 'muted'>>) => void
  /** Frame layouts: change the letterbox band's look */
  updateFrameBand: (segId: string, patch: Partial<FrameBand>) => void
  /** Frame layouts: main video's slots and sound */
  updateFrame: (segId: string, patch: Partial<Pick<FrameSettings, 'main_slots' | 'main_volume' | 'main_muted' | 'main_volumes' | 'main_mutes' | 'main_hidden' | 'main_locked' | 'main_corners' | 'row_h' | 'row_order' | 'split' | 'split2' | 'flip' | 'flip2' | 'face_box' | 'main_rects' | 'bg'>>) => void
  /** Put something on a frame lane at time t (see placeNewItem). Returns its id, or null if there's no room. */
  /** `maxLenMs`: it plays no longer than this (a part of a video); what it lands on goes on after it */
  addFrameItem: (segId: string, lane: FrameLane, t: number, item: Omit<FrameItem, 'id' | 'lane' | 'start_ms' | 'end_ms'>, maxLenMs?: number) => string | null
  updateFrameItem: (segId: string, itemId: string, patch: Partial<Omit<FrameItem, 'id'>>) => void
  removeFrameItem: (segId: string, itemId: string) => void
  /** Cut a frame item in two at `t` (a video's right part plays on from the same moment) */
  splitFrameItem: (segId: string, itemId: string, t: number) => void
  /**
   * Freeze a video item (one still picture, no sound) or let it play again. The picture is the one
   * where it starts playing: the same video's piece right after it starts from that picture
   */
  setFrameItemFreeze: (segId: string, itemId: string, on: boolean) => void
  /**
   * Freeze a video item from `from` to `to` (clip time): it plays up to `from`, holds that picture
   * until `to` (silent), then plays on from that same picture — as if paused there. It stays one
   * item (a stretch in FrameItem.holds). Ends closer than MIN_ITEM_MS to its own edges snap to them
   */
  freezeFrameItemRange: (segId: string, itemId: string, from: number, to: number) => void
  /** Move one edge of a format. Formats are independent: the neighbour never moves, the edge
   *  just stops at it (no overlap). Uncovered time uses the default framing. */
  setSegmentEdge: (segId: string, edge: 'start' | 'end', tMs: number, durationMs: number) => void
  /** Move the shared edge of two touching formats together (one grows, the other shrinks). */
  moveJunction: (leftId: string, rightId: string, tMs: number) => void
  /** A join dragged onto the next one: `removeId` goes and the touching `keepId` takes its time */
  absorbSection: (removeId: string, keepId: string) => void
  /** Create a format over [startMs, endMs] (an uncovered stretch). `pos` frames slot 0, or each slot when a list. Returns its id. */
  addFormat: (startMs: number, endMs: number, layout: LayoutType, videoAR?: number, pos?: BoxPosition | (BoxPosition | undefined)[]) => string
  updateBoxSource: (segId: string, boxId: string, source_video_id: string | null, source_offset_ms: number) => void
  /** A muted video on top (B-roll) over [startMs, endMs): a layer of its own. The sections under it are not touched. */
  /** `offsetMs`: where in the video it starts (a part of it picked) */
  placeBroll: (videoId: string, startMs: number, endMs: number, lane?: 'broll', track?: number, offsetMs?: number) => string
  /**
   * A video on top at a new time. `moved`: dragged as a whole (it shows the same pictures, its
   * views move with it); otherwise an end was trimmed (trimmed at its start, it carries on from
   * further into its video). It keeps its sound, hide and lock.
   */
  retimeBroll: (id: string, startMs: number, endMs: number, moved: boolean) => void
  /** Take a video on top out: the sections under it show again, as they were */
  removeBroll: (id: string) => void
  // Keyframes
  upsertKeyframe: (boxId: string, kf: Omit<BoxKeyframe, 'id' | 'box_id'>) => void
  /** Replace all of a box's keyframes (e.g. one static framing for the whole position). */
  setBoxKeyframes: (boxId: string, kfs: Omit<BoxKeyframe, 'id' | 'box_id'>[]) => void
  removeKeyframe: (boxId: string, t_ms: number) => void
  // Derived — stable reference, always reads latest keyframes via get()
  getPositionAt: (boxId: string, t_ms: number) => BoxPosition
  // Selection
  setActiveSegmentId: (id: string | null) => void
  setActiveBoxId: (id: string | null) => void
}

// Shortest a format can be dragged to
export const MIN_FORMAT_MS = 300

/** A part's speed (inserts.ts speedOf; here too, without importing it back) */
const speedOfSeg = (s: { speed?: number | null }) => (s.speed && s.speed > 0 ? s.speed : 1)

// For main-video boxes source_offset_ms is where in the video the position starts, so it must
// move with start_ms — render.py trims from it (by as much video as that time plays: at its
// speed). B-roll boxes keep their own offset.
function withStart(seg: SegmentLocal, start_ms: number): SegmentLocal {
  const delta = start_ms - seg.start_ms
  if (!delta) return seg
  return {
    ...seg,
    start_ms,
    crop_boxes: seg.crop_boxes.map(b => b.source_video_id ? b : { ...b, source_offset_ms: Math.max(0, b.source_offset_ms + delta * speedOfSeg(seg)) }),
  }
}

// Frame items that reach an edge of their frame stay attached to it when that edge is dragged
// (a ◆ key or a join), so a video filling "the rest of the frame" keeps filling it. A video's
// start in its source moves too, so what's on screen doesn't jump.
/**
 * A frame item with `patch` in. A video's freeze stretches (holds) stay on their pictures: its start
 * trimmed (the patch moves where it starts in its video too) keeps them where they were, they're cut
 * at its end, and they go when another video or a photo takes its place.
 */
function patchItem(it: FrameItem, patch: Partial<Omit<FrameItem, 'id'>>): FrameItem {
  if (it.kind !== 'video') return { ...it, ...patch }
  // (another video in its place: the stretches and the part picked were this one's)
  if ((patch.source_video_id !== undefined && patch.source_video_id !== it.source_video_id) || (patch.kind && patch.kind !== it.kind)) return { ...it, ...patch, holds: null, pan: null }
  if (!it.holds?.length) return { ...it, ...patch }
  const { start_ms, source_offset_ms, ...rest } = patch
  const trimmed = start_ms != null && start_ms !== it.start_ms && source_offset_ms !== undefined
  const out: FrameItem = trimmed
    ? { ...withItemStart(it, start_ms), ...rest }
    : { ...it, ...(start_ms != null ? { start_ms } : {}), ...(source_offset_ms !== undefined ? { source_offset_ms } : {}), ...rest }
  const holds = fitHolds(out.holds, out.end_ms - out.start_ms)
  return { ...out, holds: holds.length ? holds : null }
}

function withFrameEdges(prev: SegmentLocal, next: SegmentLocal): SegmentLocal {
  const items = next.frame?.items
  if (!items?.length || (prev.start_ms === next.start_ms && prev.end_ms === next.end_ms)) return next
  return {
    ...next,
    frame: {
      ...next.frame,
      items: items.map(it => {
        let out = it
        if (next.start_ms !== prev.start_ms && it.start_ms <= prev.start_ms + 1 && it.end_ms > prev.start_ms) out = withItemStart(out, next.start_ms)
        if (next.end_ms !== prev.end_ms && it.end_ms >= prev.end_ms - 1 && it.start_ms < prev.end_ms) out = patchItem(out, { end_ms: next.end_ms })
        return out
      }),
    },
  }
}

/**
 * A video on top (a layer over the sections). Only an editor that keeps layers says which video
 * is the clip's own (hydrate): without it every part is a section, as before layers.
 */
const onTop = (s: { mainVideoId: string | null }, seg: SegmentLocal) => s.mainVideoId != null && isShot(seg, s.mainVideoId)
/**
 * An inserted video (inserts.ts): the main video waits while it plays, so its length is part of
 * the clip's — only putting it in and taking it out (which move everything after it) may change
 * its time, not dragging an edge or a join. Nor does it take a format.
 */
const inserted = (seg: SegmentLocal | undefined) => seg?.video_offset_ms != null

export const useEditorStore = create<EditorState & EditorActions>()((set, get) => ({
  segments: [],
  mainVideoId: null,
  keyframes: {},
  trims: [],
  clipRange: null,
  activeSegmentId: null,
  activeBoxId: null,

  hydrate: (segments, keyframes, trims = [], mainVideoId = null) => set({ segments, keyframes, trims, mainVideoId, clipRange: null, activeSegmentId: null, activeBoxId: null }),
  reset: () => set({ segments: [] as SegmentLocal[], keyframes: {} as KeyframeMap, trims: [] as Range[], clipRange: null, activeSegmentId: null, activeBoxId: null }),
  applyTrim: (segments, keyframes, trims, clipRange) => set({ segments, keyframes, trims, ...(clipRange ? { clipRange } : {}) }),

  addSegment: (seg, onCreate, initialBoxes) => {
    const id = crypto.randomUUID()
    const slotCount = LAYOUT_SLOT_COUNT[seg.layout]
    const crop_boxes = initialBoxes ?? Array.from({ length: slotCount }, (_, i) => makeBox(i, seg.layout as LayoutType, seg.start_ms))
    set(s => ({
      segments: [...s.segments, { id, ...seg, crop_boxes }].sort((a, b) => a.sort_order - b.sort_order),
      keyframes: withBoxes(s.keyframes, crop_boxes),
    }))
    onCreate?.(id)
  },

  updateSegment: (id, updates) => set(s => {
    let added: CropBoxLocal[] = []
    const segments = s.segments.map(seg => {
      if (seg.id !== id) return seg
      const { start_ms, ...rest } = updates
      const next = { ...(start_ms !== undefined ? withStart(seg, start_ms) : seg), ...rest }
      if (updates.layout && updates.layout !== seg.layout) {
        const slotCount = LAYOUT_SLOT_COUNT[updates.layout as LayoutType]
        const existing = seg.crop_boxes.slice(0, slotCount)
        added = Array.from(
          { length: Math.max(0, slotCount - existing.length) },
          (_, i) => makeBox(existing.length + i, updates.layout as LayoutType, seg.start_ms),
        )
        next.crop_boxes = [...existing, ...added]
      }
      return next
    })
    return added.length ? { segments, keyframes: withBoxes(s.keyframes, added) } : { segments }
  }),

  setSegmentEdge: (segId, edge, tMs, durationMs) => set(s => {
    // The neighbours an edge stops at are sections (a video on top lies over them, in nobody's way)
    const byTime = s.segments.filter(x => x.id === segId || !onTop(s, x)).sort((a, b) => a.start_ms - b.start_ms)
    const i = byTime.findIndex(x => x.id === segId)
    if (i < 0) return s
    const seg = byTime[i], prev = byTime[i - 1], next = byTime[i + 1]
    if (inserted(seg)) return s
    if (edge === 'start') {
      const t = Math.round(Math.max(prev?.end_ms ?? 0, Math.min(seg.end_ms - MIN_FORMAT_MS, tMs)))
      if (t === seg.start_ms) return s
      return { segments: s.segments.map(x => x.id === seg.id ? withFrameEdges(x, withStart(x, t)) : x) }
    }
    const t = Math.round(Math.min(next?.start_ms ?? durationMs, Math.max(seg.start_ms + MIN_FORMAT_MS, tMs)))
    if (t === seg.end_ms) return s
    return { segments: s.segments.map(x => x.id === seg.id ? withFrameEdges(x, { ...x, end_ms: t }) : x) }
  }),

  moveJunction: (leftId, rightId, tMs) => set(s => {
    const left = s.segments.find(x => x.id === leftId), right = s.segments.find(x => x.id === rightId)
    if (!left || !right || inserted(left) || inserted(right)) return s
    const t = Math.round(Math.max(left.start_ms + MIN_FORMAT_MS, Math.min(right.end_ms - MIN_FORMAT_MS, tMs)))
    if (t === left.end_ms && t === right.start_ms) return s
    return {
      segments: s.segments.map(x => x.id === leftId ? withFrameEdges(x, { ...x, end_ms: t }) : x.id === rightId ? withFrameEdges(x, withStart(x, t)) : x),
    }
  }),

  absorbSection: (removeId, keepId) => set(s => {
    const gone = s.segments.find(x => x.id === removeId), keep = s.segments.find(x => x.id === keepId)
    if (!gone || !keep || inserted(gone) || inserted(keep)) return s
    const keepBefore = keep.end_ms <= gone.start_ms + 1
    return {
      segments: s.segments.filter(x => x.id !== removeId).map(x => x.id !== keepId ? x
        // Before it: runs on to its end. After it: starts where it started (its video from there too)
        : keepBefore ? withFrameEdges(x, { ...x, end_ms: gone.end_ms }) : withFrameEdges(x, withStart(x, gone.start_ms))),
      activeSegmentId: s.activeSegmentId === removeId ? keepId : s.activeSegmentId,
      activeBoxId: s.activeSegmentId === removeId ? null : s.activeBoxId,
    }
  }),

  addFormat: (startMs, endMs, layout, videoAR, pos) => {
    const id = crypto.randomUUID()
    const start = Math.round(startMs), end = Math.round(endMs)
    const slotPos = (i: number) => Array.isArray(pos) ? pos[i] : i === 0 ? pos : undefined
    const crop_boxes: CropBoxLocal[] = Array.from({ length: LAYOUT_SLOT_COUNT[layout] }, (_, i) => ({
      ...makeBox(i, layout, start, [{ t_ms: start, ...inFramePicture(slotPos(i) ?? defaultCropForSlot(layout, i, videoAR)) }]),
      source_offset_ms: start, // main video: where in the video this format starts
    }))
    set(s => {
      const before = [...s.segments].filter(x => x.start_ms < start).sort((a, b) => b.start_ms - a.start_ms)[0]
      return {
        segments: [...s.segments, {
          id, start_ms: start, end_ms: end, layout, sort_order: (before?.sort_order ?? -1) + 0.5, crop_boxes,
          frame: isFrameLayout(layout) ? defaultFrame(layout) : null,
        }]
          .sort((a, b) => a.start_ms - b.start_ms),
        keyframes: withBoxes(s.keyframes, crop_boxes),
      }
    })
    return id
  },

  applyLayout: (segId, layout, videoAR, framing) => set(s => {
    const seg = s.segments.find(x => x.id === segId)
    if (!seg || inserted(seg)) return s
    const first = seg.crop_boxes[0]
    // Going to Vertical keeps the crop centred where the user had already framed the subject
    const prev = first ? getBoxPositionAtLerp(seg.start_ms, s.keyframes[first.id] ?? first.keyframes) : null
    const centerX = layout === 'vertical' && prev && seg.layout !== 'horizontal' ? prev.x + prev.w / 2 : undefined
    const toFrame = isFrameLayout(layout)
    // Where in the main video this part is (its main box's moment: with videos put in between or
    // parts cut, not always its start on the timeline)
    const mainAt = seg.crop_boxes.find(b => !b.source_video_id && !b.image_path)?.source_offset_ms ?? seg.start_ms
    const crop_boxes: CropBoxLocal[] = Array.from({ length: LAYOUT_SLOT_COUNT[layout] }, (_, i) => {
      // (inside the video's picture: never into its black bars — framePicture.ts)
      const keyframes = [{ t_ms: seg.start_ms, ...inFramePicture(framing?.[i] ?? defaultCropForSlot(layout, i, videoAR, i === 0 ? centerX : undefined)) }]
      const old = seg.crop_boxes[i]
      // Frame crop boxes always frame the main video — other media sits on the frame's lanes
      const kept = old && toFrame
        ? { ...old, source_video_id: null, source_offset_ms: mainAt, image_path: null, image_url: null, image_motion: null }
        : old ? { ...old, image_path: null, image_url: null, image_motion: null } : old
      // New boxes show the main video from this format's own point in it
      return kept ? { ...kept, keyframes } : { ...makeBox(i, layout, seg.start_ms, keyframes), source_offset_ms: mainAt, volume: 1, muted: false }
    })
    // Switching between frames keeps what's on the lanes the new frame still has. Leaving frames
    // keeps the frame settings unused, so switching back brings them back.
    const frame = toFrame ? defaultFrame(layout, isFrameLayout(seg.layout) ? frameOf(seg) : seg.frame) : seg.frame ?? null
    return {
      segments: s.segments.map(x => x.id === segId ? { ...x, layout, crop_boxes, frame } : x),
      keyframes: withBoxes(s.keyframes, crop_boxes),
    }
  }),

  neighbourFraming: (layout, startMs, endMs, excludeId) => {
    if (isFrameLayout(layout)) return undefined
    const { segments, keyframes } = get()
    const same = segments.filter(x => x.id !== excludeId && x.layout === layout && !x.crop_boxes.some(b => b.source_video_id))
    if (!same.length) return undefined
    // Touching on the left, then on the right, then the closest in time
    const left = same.find(x => Math.abs(x.end_ms - startMs) <= 1)
    const right = same.find(x => Math.abs(x.start_ms - endMs) <= 1)
    const gap = (x: SegmentLocal) => x.end_ms <= startMs ? startMs - x.end_ms : x.start_ms >= endMs ? x.start_ms - endMs : 0
    const src = left ?? right ?? [...same].sort((a, b) => gap(a) - gap(b))[0]
    // The view where it meets this format: its end when it's before, its start when it's after
    const at = src.end_ms <= startMs + 1 ? src.end_ms - 1 : src.start_ms
    return Array.from({ length: LAYOUT_SLOT_COUNT[layout] }, (_, i) => {
      const box = src.crop_boxes.find(b => b.slot_index === i)
      return box ? getBoxPositionAtLerp(at, keyframes[box.id] ?? box.keyframes) : undefined
    })
  },

  joinSameLayoutNeighbours: (segId, transitionAfter) => {
    let id = segId
    set(s => {
      const byTime = s.segments.filter(x => !onTop(s, x)).sort((a, b) => a.start_ms - b.start_ms)
      const kf = { ...s.keyframes }
      const joinable = (a: SegmentLocal, b: SegmentLocal) =>
        a.layout === b.layout && !isFrameLayout(a.layout) && !a.locked && !b.locked
        && Math.abs(b.start_ms - a.end_ms) <= 1
        && !transitionAfter?.has(a.id)
        && a.crop_boxes.length === b.crop_boxes.length
        // (the same speed, smoothing and pitch: a part slowed down stays its own part)
        && speedOfSeg(a) === speedOfSeg(b) && !!a.smooth === !!b.smooth && !!a.pitch === !!b.pitch
        // (shown and heard alike: a hidden or silent part — or the empty space a deleted part left — stays its own)
        && !!a.hidden === !!b.hidden && !!a.muted === !!b.muted && !!a.crop_boxes[0]?.hidden === !!b.crop_boxes[0]?.hidden
        // Main video only, playing on without a jump
        && a.crop_boxes.every(box => {
          const other = b.crop_boxes.find(x => x.slot_index === box.slot_index)
          return !!other && !box.source_video_id && !other.source_video_id
            && Math.abs((box.source_offset_ms + (b.start_ms - a.start_ms) * speedOfSeg(a)) - other.source_offset_ms) <= 2
        })
      // Glue b onto a: a's boxes carry both parts' views. a's view is held right up to where b
      // began (a cut there), so each part keeps the view it had instead of panning across.
      const glue = (a: SegmentLocal, b: SegmentLocal): SegmentLocal => {
        for (const box of a.crop_boxes) {
          const other = b.crop_boxes.find(x => x.slot_index === box.slot_index)!
          const mine = (kf[box.id] ?? box.keyframes).filter(k => k.t_ms < b.start_ms - 1)
          const theirs = (kf[other.id] ?? other.keyframes).filter(k => k.t_ms >= b.start_ms)
          const hold = getBoxPositionAtLerp(b.start_ms - 1, kf[box.id] ?? box.keyframes)
          const firstTheirs = theirs[0] ? getBoxPositionAtLerp(b.start_ms, theirs) : null
          const same = firstTheirs && (['x', 'y', 'w', 'h'] as const).every(k => Math.abs(firstTheirs[k] - hold[k]) < 1e-4)
          const merged = [
            ...mine,
            ...(firstTheirs && !same ? [{ id: crypto.randomUUID(), box_id: box.id, t_ms: b.start_ms - 1, ...hold }] : []),
            ...theirs.map(k => ({ ...k, id: crypto.randomUUID(), box_id: box.id })),
          ].sort((p, q) => p.t_ms - q.t_ms)
          kf[box.id] = merged.length ? merged : [{ id: crypto.randomUUID(), box_id: box.id, t_ms: a.start_ms, ...hold }]
          delete kf[other.id]
        }
        return { ...a, end_ms: b.end_ms }
      }
      let i = byTime.findIndex(x => x.id === segId)
      if (i < 0) return s
      let cur = byTime[i]
      const removed = new Set<string>()
      // Join the one before first (the earlier format's id and settings win), then any after
      if (i > 0 && joinable(byTime[i - 1], cur)) {
        cur = glue(byTime[i - 1], cur); removed.add(byTime[i].id)
        byTime.splice(i, 1); i -= 1
      }
      while (i + 1 < byTime.length && joinable(cur, byTime[i + 1])) {
        cur = glue(cur, byTime[i + 1]); removed.add(byTime[i + 1].id)
        byTime.splice(i + 1, 1)
      }
      if (!removed.size) return s
      id = cur.id
      return {
        segments: s.segments.filter(x => !removed.has(x.id)).map(x => x.id === cur.id ? cur : x),
        keyframes: kf,
        activeSegmentId: s.activeSegmentId && removed.has(s.activeSegmentId) ? cur.id : s.activeSegmentId,
        activeBoxId: null,
      }
    })
    return id
  },

  setViewAt: (boxId, t, pos, formatStart) => set(s => ({
    keyframes: { ...s.keyframes, [boxId]: withIds(boxId, setViewAt(s.keyframes[boxId] ?? [], t, pos, formatStart)) },
  })),
  recordMotionAt: (boxId, t, pos) => set(s => ({
    keyframes: { ...s.keyframes, [boxId]: withIds(boxId, recordMotionAt(s.keyframes[boxId] ?? [], t, pos)) },
  })),
  removeViewChange: (boxId, t) => set(s => ({
    keyframes: { ...s.keyframes, [boxId]: withIds(boxId, removeViewChangeAt(s.keyframes[boxId] ?? [], t)) },
  })),
  moveViewChange: (boxId, from, to, formatStart, formatEnd) => set(s => ({
    keyframes: { ...s.keyframes, [boxId]: withIds(boxId, moveViewChange(s.keyframes[boxId] ?? [], from, to, formatStart, formatEnd)) },
  })),
  duplicateViewChange: (boxId, t, formatEnd) => {
    const out = duplicateViewChange(get().keyframes[boxId] ?? [], t, formatEnd)
    if (!out) return null
    set(s => ({ keyframes: { ...s.keyframes, [boxId]: withIds(boxId, out.keyframes) } }))
    return out.at
  },

  removeSegment: (id) => set(s => {
    // Formats are independent: deleting one leaves its time to the default framing
    if (!s.segments.some(seg => seg.id === id)) return s
    return {
      segments: s.segments.filter(seg => seg.id !== id),
      activeSegmentId: s.activeSegmentId === id ? null : s.activeSegmentId,
      activeBoxId: s.activeSegmentId === id ? null : s.activeBoxId,
    }
  }),

  splitAtMs: (segId, tAt, getPos) => {
    // (whole milliseconds: a playhead between two ms would leave cuts that never line up again)
    const tMs = Math.round(tAt)
    const seg = get().segments.find(s => s.id === segId)
    if (!seg || tMs <= seg.start_ms + 100 || tMs >= seg.end_ms - 100) return null
    const newId = crypto.randomUUID()
    set(s => {
      const seg = s.segments.find(s => s.id === segId)
      if (!seg || tMs <= seg.start_ms + 100 || tMs >= seg.end_ms - 100) return s
      const newBoxes: CropBoxLocal[] = seg.crop_boxes.map(box => ({
        ...makeBox(box.slot_index, seg.layout, tMs, [{ t_ms: tMs, ...getPos(box.id, tMs) }]),
        source_video_id: box.source_video_id,
        // (the main video moves on by as much video as the part plays before the cut: at its speed)
        source_offset_ms: box.source_offset_ms + (tMs - seg.start_ms) * (box.source_video_id || box.image_path ? 1 : speedOfSeg(seg)),
        // A video on top (or an inserted one) cut in two: both halves keep its sound and hide switches
        ...(onTop(s, seg) || inserted(seg) ? { volume: box.volume, muted: box.muted !== false, ...(box.hidden ? { hidden: true } : {}) } : {}),
      }))
      return {
        segments: [
          ...s.segments.map(s => s.id === segId ? { ...s, end_ms: tMs } : s),
          {
            id: newId, start_ms: tMs, end_ms: seg.end_ms, layout: seg.layout, sort_order: seg.sort_order + 0.5, crop_boxes: newBoxes,
            ...(seg.lane ? { lane: seg.lane } : {}),
            ...(seg.track ? { track: seg.track } : {}),
            // (both halves play at the part's speed)
            ...(speedOfSeg(seg) !== 1 ? { speed: seg.speed } : {}),
            ...(seg.smooth ? { smooth: true } : {}),
            ...(seg.pitch ? { pitch: true } : {}),
            // (both halves of an inserted video hold the main video at the same moment)
            ...(inserted(seg) ? { video_offset_ms: seg.video_offset_ms } : {}),
            // Each half keeps its own copy of the frame; items are cut to each half's range when shown
            frame: seg.frame ? { ...seg.frame, items: seg.frame.items?.map(it => ({ ...it, id: crypto.randomUUID() })) } : seg.frame,
          },
        ].sort((a, b) => a.sort_order - b.sort_order),
        keyframes: withBoxes(s.keyframes, newBoxes),
      }
    })
    // A transition is kept against the part before its cut (after_segment_id). The left half keeps
    // this part's id, so the transition at this part's end now belongs to the new right half: it
    // stays on the same cut instead of jumping to the new one
    const media = useMediaStore.getState()
    if (media.transitions.some(t => t.after_segment_id === segId)) {
      media.setTransitions(media.transitions.map(t => (t.after_segment_id === segId ? { ...t, after_segment_id: newId } : t)))
    }
    return newId
  },

  updateSlot: (segId, boxId, patch) => set(s => ({
    segments: s.segments.map(seg => seg.id !== segId ? seg : {
      ...seg,
      crop_boxes: seg.crop_boxes.map(b => b.id === boxId ? { ...b, ...patch } : b),
    }),
  })),

  updateFrameBand: (segId, patch) => set(s => ({
    segments: s.segments.map(seg => seg.id !== segId ? seg : {
      ...seg,
      frame: { ...seg.frame, band: { ...DEFAULT_BAND, ...seg.frame?.band, ...patch } },
    }),
  })),

  updateFrame: (segId, patch) => set(s => ({
    segments: s.segments.map(seg => seg.id !== segId ? seg : { ...seg, frame: { ...frameOf(seg), ...patch } }),
  })),

  addFrameItem: (segId, lane, t, item, maxLenMs) => {
    const seg = get().segments.find(x => x.id === segId)
    if (!seg || !isFrameLayout(seg.layout)) return null
    const frame = frameOf(seg)
    const spot = placeNewItem(frame, lane, t, seg)
    if (!spot) return null
    const id = crypto.randomUUID()
    const end = maxLenMs ? Math.min(spot.end_ms, spot.start_ms + Math.max(MIN_ITEM_MS, maxLenMs)) : spot.end_ms
    // Shorter than the item it lands on: that item goes on after it (from where it would be by then)
    const under = (frame.items ?? []).find(it => it.id === (spot.replace ?? spot.trim?.id))
    const rest: FrameItem | null = under && under.end_ms - end >= MIN_ITEM_MS ? withItemStart({ ...under, id: crypto.randomUUID() }, end) : null
    const items = (frame.items ?? [])
      .filter(it => it.id !== spot.replace)
      .map(it => it.id === spot.trim?.id ? patchItem(it, { end_ms: spot.trim.end_ms }) : it)
    items.push({ ...item, id, lane, start_ms: spot.start_ms, end_ms: end })
    if (rest) items.push(rest)
    set(s => ({ segments: s.segments.map(x => x.id === segId ? { ...x, frame: { ...frame, items } } : x) }))
    return id
  },

  updateFrameItem: (segId, itemId, patch) => set(s => ({
    segments: s.segments.map(seg => {
      if (seg.id !== segId) return seg
      const frame = frameOf(seg)
      return { ...seg, frame: { ...frame, items: (frame.items ?? []).map(it => it.id === itemId ? patchItem(it, patch) : it) } }
    }),
  })),

  splitFrameItem: (segId, itemId, t) => set(s => ({
    segments: s.segments.map(seg => {
      if (seg.id !== segId) return seg
      const frame = frameOf(seg)
      return { ...seg, frame: { ...frame, items: (frame.items ?? []).flatMap(it => {
        if (it.id !== itemId || t <= it.start_ms || t >= it.end_ms) return [it]
        // (a frozen video's right part holds the same picture; a freeze stretch cut goes on in it)
        return cutItem(it, t, crypto.randomUUID())
      }) } }
    }),
  })),

  setFrameItemFreeze: (segId, itemId, on) => set(s => ({
    segments: s.segments.map(seg => {
      if (seg.id !== segId) return seg
      const frame = frameOf(seg)
      const items = frame.items ?? []
      const it = items.find(x => x.id === itemId)
      if (!it || it.kind !== 'video') return seg
      // The same video playing on right after it: it starts from the frozen picture (frozen), or
      // carries on from where this piece ends again (playing)
      const next = items.find(x => x.lane === it.lane && x.kind === 'video' && !x.freeze && x.source_video_id === it.source_video_id && Math.abs(x.start_ms - it.end_ms) <= 1)
      const off = it.source_offset_ms ?? 0
      return { ...seg, frame: { ...frame, items: items.map(x => {
        if (x.id === itemId) return on ? { ...x, freeze: true } : { ...x, freeze: false, dim: false }
        if (x === next && on) return { ...x, source_offset_ms: off }
        if (x === next && !on && (x.source_offset_ms ?? 0) === off) return { ...x, source_offset_ms: off + (it.end_ms - it.start_ms) }
        return x
      }) } }
    }),
  })),

  freezeFrameItemRange: (segId, itemId, from, to) => set(s => ({
    segments: s.segments.map(seg => {
      if (seg.id !== segId) return seg
      const frame = frameOf(seg)
      return { ...seg, frame: { ...frame, items: (frame.items ?? []).map(it => {
        if (it.id !== itemId || it.kind !== 'video' || it.freeze) return it
        const holds = addHold(it, from, to)
        return holds ? { ...it, holds } : it
      }) } }
    }),
  })),

  removeFrameItem: (segId, itemId) => set(s => ({
    segments: s.segments.map(seg => {
      if (seg.id !== segId) return seg
      const frame = frameOf(seg)
      return { ...seg, frame: { ...frame, items: (frame.items ?? []).filter(it => it.id !== itemId) } }
    }),
  })),

  updateBoxSource: (segId, boxId, source_video_id, source_offset_ms) => set(s => ({
    segments: s.segments.map(seg => seg.id !== segId ? seg : {
      ...seg,
      crop_boxes: seg.crop_boxes.map(b => b.id === boxId ? { ...b, source_video_id, source_offset_ms } : b),
    }),
  })),

  placeBroll: (videoId, startMs, endMs, lane, track, offsetMs = 0) => {
    const id = crypto.randomUUID()
    const box = {
      id: crypto.randomUUID(), slot_index: 0, source_video_id: videoId, source_offset_ms: offsetMs,
      image_path: null, image_motion: null, volume: 1, muted: true,
      keyframes: [{ t_ms: startMs, x: 0, y: 0, w: 1, h: 1 }],
    } as CropBoxLocal
    set(s => ({
      segments: [...s.segments, { id, start_ms: startMs, end_ms: endMs, layout: 'vertical' as LayoutType, sort_order: 0, crop_boxes: [box], ...(lane ? { lane } : {}), ...(track ? { track } : {}) }]
        .sort((a, b) => a.start_ms - b.start_ms),
      keyframes: withBoxes(s.keyframes, [box]),
    }))
    return id
  },

  retimeBroll: (id, startMs, endMs, moved) => set(s => {
    const shot = s.segments.find(x => x.id === id)
    if (!shot || !(endMs > startMs)) return s
    const d = startMs - shot.start_ms
    if (!d && endMs === shot.end_ms) return s
    const keyframes = { ...s.keyframes }
    const crop_boxes = shot.crop_boxes.map(box => {
      if (moved && d && keyframes[box.id]) keyframes[box.id] = keyframes[box.id].map(k => ({ ...k, t_ms: k.t_ms + d }))
      return moved ? box : { ...box, source_offset_ms: Math.max(0, (box.source_offset_ms ?? 0) + d) }
    })
    return {
      segments: s.segments.map(x => (x.id === id ? { ...x, start_ms: startMs, end_ms: endMs, crop_boxes } : x)).sort((a, b) => a.start_ms - b.start_ms),
      keyframes,
    }
  }),

  removeBroll: (id) => set(s => {
    if (!s.segments.some(x => x.id === id)) return s
    return {
      segments: s.segments.filter(x => x.id !== id),
      activeSegmentId: s.activeSegmentId === id ? null : s.activeSegmentId,
      activeBoxId: s.activeSegmentId === id ? null : s.activeBoxId,
    }
  }),

  upsertKeyframe: (boxId, kf) => set(s => {
    const existing = s.keyframes[boxId] ?? []
    const idx = existing.findIndex(k => k.t_ms === kf.t_ms)
    const updated = idx >= 0
      ? existing.map((k, i) => i === idx ? { ...k, ...kf } : k)
      : [...existing, { id: crypto.randomUUID(), box_id: boxId, ...kf }].sort((a, b) => a.t_ms - b.t_ms)
    return { keyframes: { ...s.keyframes, [boxId]: updated } }
  }),

  setBoxKeyframes: (boxId, kfs) => set(s => ({
    keyframes: {
      ...s.keyframes,
      [boxId]: kfs.map(k => ({ id: crypto.randomUUID(), box_id: boxId, ...k })).sort((a, b) => a.t_ms - b.t_ms),
    },
  })),

  removeKeyframe: (boxId, t_ms) => set(s => ({
    keyframes: { ...s.keyframes, [boxId]: (s.keyframes[boxId] ?? []).filter(k => k.t_ms !== t_ms) },
  })),

  // Stable function — always reads latest keyframes via get(), never goes stale.
  // Linear between keyframes, exactly like render.py, so the preview matches the export.
  getPositionAt: (boxId, t_ms) => getBoxPositionAtLerp(t_ms, get().keyframes[boxId] ?? []),

  setActiveSegmentId: (id) => set({ activeSegmentId: id }),
  setActiveBoxId: (id) => set({ activeBoxId: id }),
}))
