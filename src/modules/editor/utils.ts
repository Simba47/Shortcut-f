import type { CropBoxLocal, BoxKeyframeLocal, LayoutType, SegmentLocal, Segment, CropBox, BoxKeyframe } from '@chai-cut/shared'
import type { BoxPosition } from '@/lib/interpolation'
import { isFrameLayout, frameSlotSize, frameOf, type RowLayout } from './frames'
import { inFramePicture } from './framePicture'

// ── Crop geometry ─────────────────────────────────────────────────────────────
// Crop boxes are stored normalised to the source frame (0–1 on each axis). The renderer
// (render.py) cover-crops every slot to a fixed output shape, so a box whose shape doesn't
// match its slot gets trimmed at export. Locking each box to its slot's shape keeps what the
// user frames identical to what gets exported.

const OUT_W = 1080
const OUT_H = 1920
const DEFAULT_SOURCE_AR = 16 / 9

/** Pixel aspect (w/h) of one output slot, or null when the slot takes the whole frame letterboxed. */
export function slotPixelAspect(layout: LayoutType, frameBand = false, slot = 0, rowH?: RowLayout): number | null {
  if (isFrameLayout(layout)) {
    // A slot that shows the video whole (contain) takes it uncropped, like Horizontal
    const size = frameSlotSize(layout, frameBand, slot, rowH)
    return size ? (OUT_W * size.w) / (OUT_H * size.h) : null
  }
  switch (layout) {
    case 'horizontal': return null
    case 'split': return OUT_W / (OUT_H / 2)   // 9:8
    case 'trio': return OUT_W / (OUT_H / 3)    // 27:16
    default: return OUT_W / OUT_H              // 9:16
  }
}

/** Slot aspect expressed in normalised source units (box.w / box.h), or null if unlocked. */
export function normalizedSlotAspect(layout: LayoutType, videoAR = DEFAULT_SOURCE_AR, frameBand = false, slot = 0, rowH?: RowLayout): number | null {
  const a = slotPixelAspect(layout, frameBand, slot, rowH)
  return a === null ? null : a / (videoAR || DEFAULT_SOURCE_AR)
}

/** The part of `pos` the renderer actually uses: its centred sub-rect with aspect `a` (same maths as cover-crop). */
export function fitToAspect(pos: BoxPosition, a: number | null): BoxPosition {
  if (!a || pos.h <= 0) return pos
  const cur = pos.w / pos.h
  if (Math.abs(cur - a) < 1e-4) return pos
  if (cur > a) { const w = pos.h * a; return { ...pos, x: pos.x + (pos.w - w) / 2, w } }
  const h = pos.w / a
  return { ...pos, y: pos.y + (pos.h - h) / 2, h }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Largest-that-fits rect of aspect `a` and height `h`, centred on (cx, cy), kept inside the frame. */
function rectAt(a: number, cx: number, cy: number, h: number): BoxPosition {
  let w = a * h
  if (w > 1) { w = 1; h = 1 / a }
  if (h > 1) { h = 1; w = a }
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h }
}

/** Starting crop for a slot. `centerX` keeps a vertical crop on the subject the user already framed. */
export function defaultCropForSlot(layout: LayoutType, slotIdx: number, videoAR = DEFAULT_SOURCE_AR, centerX?: number): BoxPosition {
  // A frame's slots are shaped with its band showing (as the preview and the export draw them)
  const a = isFrameLayout(layout) ? normalizedSlotAspect(layout, videoAR, true, slotIdx) : normalizedSlotAspect(layout, videoAR)
  if (a === null) return { x: 0, y: 0, w: 1, h: 1 }
  const portrait = a > 1 // source narrower than the slot: stack slots vertically instead
  // Close-up + wide: the top slot starts as a close-up (the middle of the picture, zoomed in)
  if (layout === 'frame_two_crops' && slotIdx === 0) return rectAt(a, 0.5, 0.42, 0.5)
  // Frame slots each show their own media, so every slot starts centred on it
  if (isFrameLayout(layout)) return rectAt(a, 0.5, 0.5, 1)
  switch (layout) {
    case 'split':
      return portrait
        ? rectAt(a, 0.5, slotIdx === 0 ? 0.25 : 0.75, 1)
        : rectAt(a, slotIdx === 0 ? 0.25 : 0.75, 0.5, 1)
    case 'trio': {
      const centres: [number, number][] = [[0.5, 0.27], [0.25, 0.73], [0.75, 0.73]]
      const [cx, cy] = centres[slotIdx] ?? [0.5, 0.5]
      return rectAt(a, cx, cy, 0.55)
    }
    default:
      return rectAt(a, centerX ?? 0.5, 0.5, 1)
  }
}

export function makeBox(
  slotIndex: number,
  layout: LayoutType = 'vertical',
  startMs = 0,
  keyframes?: BoxKeyframeLocal[],
): CropBoxLocal {
  return {
    id: crypto.randomUUID(),
    slot_index: slotIndex,
    source_video_id: null,
    source_offset_ms: 0,
    keyframes: keyframes ?? [{ t_ms: startMs, ...inFramePicture(defaultCropForSlot(layout, slotIndex)) }],
  }
}

// ── DB row → local type ────────────────────────────────────────────────────────

interface SegmentRow extends Omit<Segment, never> {
  crop_boxes: (CropBox & { box_keyframes: BoxKeyframe[] })[]
}

export function rowsToLocal(rows: SegmentRow[]): SegmentLocal[] {
  return rows.map(toLocal).map(upgradeFrame)
}

// Frames saved before lanes existed kept a photo or another video on a slot's crop box; those
// become lane items, and every frame crop box goes back to framing the main video
function upgradeFrame(seg: SegmentLocal): SegmentLocal {
  if (!isFrameLayout(seg.layout) || seg.frame?.items) return seg
  return {
    ...seg,
    frame: frameOf(seg),
    crop_boxes: seg.crop_boxes.map(b => b.source_video_id || b.image_path
      ? { ...b, source_video_id: null, source_offset_ms: seg.start_ms, image_path: null, image_url: null, image_motion: null }
      : b),
  }
}

function toLocal(s: SegmentRow): SegmentLocal {
  return ({
    id: s.id,
    start_ms: s.start_ms,
    end_ms: s.end_ms,
    layout: s.layout,
    sort_order: s.sort_order,
    frame: s.frame ?? null,
    ...(s.hidden ? { hidden: true } : {}),
    ...(s.muted ? { muted: true } : {}),
    ...(s.locked ? { locked: true } : {}),
    // An inserted video (inserts.ts): where the main video waits meanwhile. Only on a part showing
    // another video (older clips can have it on parts of the main video: it means nothing there now)
    ...(s.video_offset_ms != null && !isFrameLayout(s.layout) && s.crop_boxes[0]?.source_video_id ? { video_offset_ms: Number(s.video_offset_ms) } : {}),
    // How fast the part plays (inserts.ts): only when not as filmed
    ...(s.speed != null && Number(s.speed) > 0 && Math.abs(Number(s.speed) - 1) > 0.001 ? { speed: Number(s.speed) } : {}),
    ...(s.smooth ? { smooth: true } : {}),
    ...(s.pitch ? { pitch: true } : {}),
    crop_boxes: s.crop_boxes.map(b => ({
      id: b.id,
      slot_index: b.slot_index,
      source_video_id: b.source_video_id ?? null,
      source_offset_ms: b.source_offset_ms ?? 0,
      image_path: b.image_path ?? null,
      image_url: b.image_url ?? null,
      image_motion: b.image_motion ?? null,
      volume: b.volume ?? 1,
      muted: b.muted ?? false,
      ...(b.hidden ? { hidden: true } : {}),
      ...(b.mirror ? { mirror: true } : {}),
      ...(turnOf(b.turn) ? { turn: turnOf(b.turn) } : {}),
      keyframes: b.box_keyframes,
    })),
  })
}

/** A picture's turn as saved: 90, 180 or 270 degrees clockwise, else 0 */
export function turnOf(v: unknown): number {
  const n = Math.round(Number(v) / 90) * 90 % 360
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function msToLabel(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Tidy formats loaded from the database: keep them inside the clip, in time order, never
 * overlapping. Gaps are left alone — formats are independent, and uncovered time uses the
 * default framing (the editor preview and render.py both fill it the same way).
 */
export function normalizeCoverage(segments: SegmentLocal[], durationMs: number): SegmentLocal[] {
  if (segments.length === 0 || durationMs <= 0) return segments
  const byTime = [...segments].sort((a, b) => a.start_ms - b.start_ms || a.sort_order - b.sort_order)
  const out: SegmentLocal[] = []
  for (const seg of byTime) {
    let next = { ...seg, end_ms: Math.min(seg.end_ms, durationMs) }
    const floor = out.length ? out[out.length - 1].end_ms : 0
    if (next.start_ms < floor) {
      // Overlap: the earlier format wins; shift this one's start (and its video position) past it
      const delta = floor - next.start_ms
      next = {
        ...next, start_ms: floor,
        crop_boxes: next.crop_boxes.map(b => b.source_video_id ? b : { ...b, source_offset_ms: Math.max(0, b.source_offset_ms + delta) }),
      }
    }
    if (next.end_ms - next.start_ms < 100) continue
    out.push(next)
  }
  return out.length ? out.map((s, i) => ({ ...s, sort_order: i })) : segments
}

/** Stretches of the clip that no format covers — these use the default framing. */
export function uncoveredRanges(segments: SegmentLocal[], durationMs: number, minMs = 50): { start_ms: number; end_ms: number }[] {
  const out: { start_ms: number; end_ms: number }[] = []
  let cursor = 0
  for (const seg of [...segments].sort((a, b) => a.start_ms - b.start_ms)) {
    if (seg.start_ms - cursor >= minMs) out.push({ start_ms: cursor, end_ms: seg.start_ms })
    cursor = Math.max(cursor, seg.end_ms)
  }
  if (durationMs - cursor >= minMs) out.push({ start_ms: cursor, end_ms: durationMs })
  return out
}
