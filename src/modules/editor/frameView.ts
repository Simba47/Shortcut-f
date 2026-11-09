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
