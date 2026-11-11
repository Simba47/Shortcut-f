import type { FrameItem, FrameLayout, FrameRowOrigin, Overlay, SegmentLocal } from '@/lib/shared/types'
import { useMediaStore } from '@/modules/media/store'
import { FRAME_TEMPLATES, frameSlotCount, isFrameLayout, itemSourceAt, newItemCorners, slotOffers } from './frames'
import { isShot } from './shots'
import { useEditorStore } from './store'
import { fitsOn, freeTrackIn } from './tracks'
import { addedVideoBox, isGapPart } from './visibility'

// A frame picked where the main video isn't showing (user, 2026-11-10: it was cut away, or its eye is
// off) goes on the video or photo that is there: that media moves off its row into the frame, in the
// slot the main video would have had. The frame has no main video (FrameSettings.no_main); each item
// remembers its row (FrameItem.from_row), so taking the frame off puts it back.

export interface RowMedia {
  kind: 'video' | 'photo'
  id: string
  /** The part of the main row it lies over */
  part: string
  /** What the frame will cover: the media, as far as that part goes */
  start_ms: number
  end_ms: number
}

/** Shorter than this, no frame is made */
const MIN_FRAME_MS = 300
/** Nearer than this to an edge, nothing is cut (the store's splitAtMs doesn't either) */
const EDGE_MS = 100

/** The media a frame picked at `t` goes on, or null when it goes on the main video as usual */
export function mediaForFrame(t: number, segments: SegmentLocal[], overlays: Overlay[], mainVideoId: string | null | undefined): RowMedia | null {
  const part = segments.find(s => !isShot(s, mainVideoId) && s.start_ms <= t && t < s.end_ms)
  if (!part || !part.hidden || isFrameLayout(part.layout) || addedVideoBox(part, mainVideoId)) return null
  const covers = (x: { start_ms: number; end_ms: number }) => x.start_ms <= t && t < x.end_ms
  const top = [
    ...segments.filter(s => isShot(s, mainVideoId) && !s.crop_boxes[0]?.hidden && covers(s)).map(s => ({ kind: 'video' as const, x: s })),
    ...overlays.filter(o => o.type === 'image' && o.storage_path && !o.hidden && covers(o)).map(o => ({ kind: 'photo' as const, x: o })),
  ].sort((a, b) => (b.x.track ?? 0) - (a.x.track ?? 0))[0]
  if (!top) return null
  const start_ms = Math.max(top.x.start_ms, part.start_ms), end_ms = Math.min(top.x.end_ms, part.end_ms)
  return end_ms - start_ms < MIN_FRAME_MS ? null : { kind: top.kind, id: top.x.id, part: part.id, start_ms, end_ms }
}

/** The slot it goes in: the main video's in this frame, or the first that takes it. Null: none does */
export function slotForMedia(layout: FrameLayout, kind: RowMedia['kind']): number | null {
  const count = frameSlotCount(layout)
  const first = FRAME_TEMPLATES[layout].mainSlots?.[0] ?? 0
  return [first, ...Array.from({ length: count }, (_, i) => i)].find(i => i < count && slotOffers(layout, i)[kind]) ?? null
}

const editor = () => useEditorStore.getState()
const segOf = (id: string) => editor().segments.find(s => s.id === id)

/** The main video off in this part again, as it was (the store's split doesn't carry it to the new half) */
function setOff(id: string, gap: boolean, muted: boolean) {
  const seg = segOf(id)
  if (!seg) return
  editor().updateSegment(id, { hidden: true, muted: gap || muted, ...(gap ? { crop_boxes: seg.crop_boxes.map((b, i) => (i === 0 ? { ...b, hidden: true } : b)) } : {}) })
}

/** Takes the media off its row (what's outside the stretch stays there); gives the frame item made of it */
function takeOffRow(m: RowMedia, layout: FrameLayout, slot: number): FrameItem | null {
  const base = { id: crypto.randomUUID(), lane: slot, corners: newItemCorners(layout, slot) }
  if (m.kind === 'photo') {
    const media = useMediaStore.getState()
    const o = media.overlays.find(x => x.id === m.id)
    if (!o) return null
    const from_row: FrameRowOrigin = {
      start_ms: m.start_ms, track: o.track, x: o.x, y: o.y, w: o.w, h: o.h, z_index: o.z_index,
      ...(o.rotation != null ? { rotation: o.rotation } : {}), ...(o.opacity != null ? { opacity: o.opacity } : {}),
    }
    media.setOverlays(prev => prev.flatMap(x => x.id !== m.id ? [x] : [
      ...(m.start_ms > x.start_ms + EDGE_MS ? [{ ...x, id: crypto.randomUUID(), end_ms: m.start_ms }] : []),
      ...(m.end_ms < x.end_ms - EDGE_MS ? [{ ...x, id: crypto.randomUUID(), start_ms: m.end_ms }] : []),
    ]))
    return { ...base, kind: 'photo', start_ms: m.start_ms, end_ms: m.end_ms, image_path: o.storage_path, image_url: o.preview_url ?? null, motion: 'none', muted: true, from_row }
  }
  const first = segOf(m.id)
  if (!first) return null
  const { splitAtMs, getPositionAt, removeBroll } = editor()
  if (m.end_ms < first.end_ms - EDGE_MS) splitAtMs(m.id, m.end_ms, getPositionAt)
  const id = m.start_ms > first.start_ms + EDGE_MS ? splitAtMs(m.id, m.start_ms, getPositionAt) ?? m.id : m.id
  const shot = segOf(id), box = shot?.crop_boxes[0]
  if (!shot || !box?.source_video_id) return null
  const views = (editor().keyframes[box.id] ?? []).map(k => ({ t_ms: k.t_ms, x: k.x, y: k.y, w: k.w, h: k.h }))
  removeBroll(id)
  return {
    ...base, kind: 'video', start_ms: shot.start_ms, end_ms: shot.end_ms, source_video_id: box.source_video_id, source_offset_ms: box.source_offset_ms ?? 0,
    volume: box.volume ?? 1, muted: box.muted !== false,
    from_row: { start_ms: shot.start_ms, track: shot.track, ...(shot.lane === 'broll' ? { lane: 'broll' as const } : {}), views },
  }
}

/** Puts `m` in a new frame over its stretch. Gives the frame's part, or null when this frame can't show it */
export function frameOnMedia(m: RowMedia, layout: FrameLayout, videoAR?: number): string | null {
  const slot = slotForMedia(layout, m.kind)
  const part = segOf(m.part)
  if (slot === null || !part) return null
  const item = takeOffRow(m, layout, slot)
  if (!item) return null
  const gap = isGapPart(part, editor().mainVideoId), muted = !!part.muted
  const { splitAtMs, getPositionAt, applyLayout, updateSegment } = editor()
  // The main row is cut round it: what's left either side stays as it was
  if (m.end_ms < part.end_ms - EDGE_MS) {
    const after = splitAtMs(part.id, m.end_ms, getPositionAt)
    if (after) setOff(after, gap, muted)
  }
  const id = m.start_ms > part.start_ms + EDGE_MS ? splitAtMs(part.id, m.start_ms, getPositionAt) ?? part.id : part.id
  applyLayout(id, layout, videoAR)
  const seg = segOf(id)
  if (!seg?.frame) return null
  updateSegment(id, {
    hidden: false, muted: false,
    crop_boxes: seg.crop_boxes.map(b => ({ ...b, hidden: false })),
    frame: {
      ...seg.frame, main_slots: [], items: [item],
      // (the main video's eye off but its sound on: it's still heard)
      main_under: !gap && !muted,
      no_main: { ...(gap ? { gap: true } : {}), ...(muted ? { muted: true } : {}) },
    },
  })
  return id
}

/** A frame made on media: taken off, its media goes back on its rows and the main row is as it was. False: not such a frame */
export function frameOffMedia(segId: string, clipId: string, videoAR?: number): boolean {
  const seg = segOf(segId)
  const off = seg?.frame?.no_main
  if (!seg || !off || !isFrameLayout(seg.layout)) return false
  const items = (seg.frame?.items ?? []).filter(it => it.from_row)
  const { applyLayout, updateSegment, placeBroll } = editor()
  applyLayout(segId, 'vertical', videoAR)
  const now = segOf(segId)
  updateSegment(segId, { frame: { ...now?.frame, items: [], no_main: null, main_under: false } })
  setOff(segId, !!off.gap, !!off.muted)
  for (const it of items) {
    const a = Math.max(it.start_ms, seg.start_ms), b = Math.min(it.end_ms, seg.end_ms)
    const from = it.from_row
    if (!from || b - a < 50) continue
    const taken = [
      ...editor().segments.filter(s => isShot(s, editor().mainVideoId)),
      ...useMediaStore.getState().overlays, ...useMediaStore.getState().textOverlays,
    ].map(x => ({ id: x.id, start_ms: x.start_ms, end_ms: x.end_ms, track: x.track }))
    const track = fitsOn(taken, from.track ?? 0, a, b) ? from.track ?? 0 : freeTrackIn(taken, a, b)
    if (it.kind === 'photo') {
      useMediaStore.getState().setOverlays(prev => [...prev, {
        id: crypto.randomUUID(), clip_id: clipId, type: 'image', storage_path: it.image_path ?? null, preview_url: it.image_url ?? undefined,
        source_video_id: null, source_offset_ms: 0, x: from.x ?? 0, y: from.y ?? 0, w: from.w ?? 1, h: from.h ?? 1, start_ms: a, end_ms: b,
        z_index: from.z_index ?? 0, created_at: new Date().toISOString(), track,
        ...(it.hidden ? { hidden: true } : {}), ...(from.rotation != null ? { rotation: from.rotation } : {}), ...(from.opacity != null ? { opacity: from.opacity } : {}),
      }])
      continue
    }
    if (!it.source_video_id) continue
    const id = placeBroll(it.source_video_id, a, b, from.lane ?? undefined, track, itemSourceAt(it, a).ms)
    const shot = segOf(id), box = shot?.crop_boxes[0]
    if (!shot || !box) continue
    updateSegment(id, { crop_boxes: [{ ...box, volume: it.volume ?? 1, muted: it.muted !== false, ...(it.hidden ? { hidden: true } : {}) }] })
    const shift = a - from.start_ms
    if (from.views?.length) {
      useEditorStore.setState(s => ({
        keyframes: { ...s.keyframes, [box.id]: from.views!.map(k => ({ id: crypto.randomUUID(), box_id: box.id, ...k, t_ms: k.t_ms + shift })) },
      }))
    }
  }
  return true
}
