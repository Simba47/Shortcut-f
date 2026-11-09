import type { BoxPosition } from '@/lib/interpolation'
import type { PictureBox } from './pictureBox'
import { fitToAspect } from './utils'

// The main video's view changed from the preview itself (user, 2026-11-09: as a frame's photo is):
// dragged to pick the part that shows, scrolled to zoom. All in shares of the video; `a` is the box's
// shape in those shares (the box's width / height ÷ the video's). The view stays inside the picture.

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const r4 = (v: number) => Math.round(v * 10000) / 10000
/** Furthest in, from the whole picture (a frame photo's zoom goes as far) */
const MAX_ZOOM = 4

function inside(v: BoxPosition, pic: PictureBox): BoxPosition {
  const x = v.w >= pic.w ? pic.x + (pic.w - v.w) / 2 : clamp(v.x, pic.x, pic.x + pic.w - v.w)
  const y = v.h >= pic.h ? pic.y + (pic.h - v.h) / 2 : clamp(v.y, pic.y, pic.y + pic.h - v.h)
  return { x: r4(x), y: r4(y), w: r4(v.w), h: r4(v.h) }
}

/** A side or corner of a media box in its slot */
export type BoxEdge = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'
type Rect = { x: number; y: number; w: number; h: number }

/**
 * Box `r` (shares of its slot) with `edge` dragged by (dx, dy): a side changes only that way, a corner
 * both, so any shape can be made; `keep` (Shift, on a corner) keeps its shape. It stays inside its slot.
 */
export function resizedBox(r: Rect, edge: BoxEdge, dx: number, dy: number, min: number, keep = false): Rect {
  const west = edge.includes('w'), east = edge.includes('e'), north = edge.includes('n'), south = edge.includes('s')
  const right = r.x + r.w, bottom = r.y + r.h
  let { x, y, w, h } = r
  if (west) { x = clamp(r.x + dx, 0, right - min); w = right - x }
  if (east) w = clamp(r.w + dx, min, 1 - r.x)
  if (north) { y = clamp(r.y + dy, 0, bottom - min); h = bottom - y }
  if (south) h = clamp(r.h + dy, min, 1 - r.y)
  if (keep && edge.length === 2) {
    // (as far as the bigger of the two changes, the opposite corner staying put)
    const most = Math.min(west ? right / r.w : (1 - r.x) / r.w, north ? bottom / r.h : (1 - r.y) / r.h)
    const k = clamp(Math.max(w / r.w, h / r.h), Math.max(min / r.w, min / r.h), most)
    w = r.w * k; h = r.h * k
    if (west) x = right - w
    if (north) y = bottom - h
  }
  const q = (v: number) => Math.round(v * 1000) / 1000
  return { x: q(x), y: q(y), w: q(w), h: q(h) }
}

/** The most of the picture a box of this shape can show, in its middle (double-click: back to this) */
export const wholeView = (pic: PictureBox, a: number): BoxPosition => inside(fitToAspect({ x: pic.x, y: pic.y, w: pic.w, h: pic.h }, a), pic)

/** `v` with the picture moved with the mouse by (dx, dy), in shares of the box */
export function draggedView(v: BoxPosition, dx: number, dy: number, pic: PictureBox): BoxPosition {
  return inside({ ...v, x: v.x - dx * v.w, y: v.y - dy * v.h }, pic)
}

/** `v` zoomed around its middle: `factor` > 1 goes in, from the whole picture to MAX_ZOOM× */
export function zoomedView(v: BoxPosition, factor: number, pic: PictureBox, a: number): BoxPosition {
  const whole = wholeView(pic, a)
  const w = clamp(v.w / factor, whole.w / MAX_ZOOM, whole.w)
  const h = w * (v.h / v.w)
  return inside({ x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h }, pic)
}
