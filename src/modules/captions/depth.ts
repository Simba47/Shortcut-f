/**
 * Soft drop shadows under the captions (user, 2026-11-19: they looked flat, "plain"). The export
 * draws the same (backend src/python/caption_depth.py): a black, see-through, blurred copy of the
 * text and its outline, shifted down and a little right. `size` is a style's shadow (its old hard
 * shadow's offset), in canvas px.
 */

const OPACITY = 0.6        // caption_depth.OPACITY
const SHIFT_X = 0.5        // × size (caption_depth.SHIFT_X)
const SHIFT_Y = 1.5        // × size (caption_depth.SHIFT_Y)
const BLUR_EXTRA = 3       // px at 1080 wide: the blur is size + this (caption_depth.BLUR_EXTRA)
/** libass's \blur r is about as soft as the canvas's shadowBlur 1.75 r (measured 2026-11-19) */
const LIBASS_TO_CANVAS_BLUR = 1.75

/** The soft shadow `size` canvas px (k: canvas px per 1080 px) on what `g` draws next; 0: none */
export function softShadow(g: CanvasRenderingContext2D, size: number, k: number) {
  if (size <= 0) { noShadow(g); return }
  g.shadowColor = `rgba(0,0,0,${OPACITY})`
  g.shadowOffsetX = size * SHIFT_X
  g.shadowOffsetY = size * SHIFT_Y
  g.shadowBlur = (size + BLUR_EXTRA * k) * LIBASS_TO_CANVAS_BLUR
}

export function noShadow(g: CanvasRenderingContext2D) {
  g.shadowColor = 'transparent'
  g.shadowOffsetX = g.shadowOffsetY = 0
  g.shadowBlur = 0
}
