import type { CaptionGradient, CaptionStyle } from '@chai-cut/shared'

/**
 * Captions in a gradient (caption_styles.gradient, user 2026-11-13): the text's own colour runs from
 * one colour to another across each caption line, top to bottom or left to right. Only that colour:
 * the spoken word and key words keep their highlight colour, outlines and boxes theirs.
 *
 * The export draws the same (backend src/python/caption_gradient.py): the line's box, and every
 * fill in the text colour swapped for the gradient's colour there. The box is where the whole line
 * is drawn as it ends (every word shown, done popping), in screen pixels, so the gradient stays put
 * while a word pops or moves, as it does in the export. No diagonal: libass can only cut a line
 * into bands cleanly along the picture's edges.
 */

/** Ready-made pairs that read well on video */
export const GRADIENT_PRESETS: { name: string; from: string; to: string }[] = [
  { name: 'Gold', from: '#FFF3B0', to: '#F5A623' },
  { name: 'Sunset', from: '#FDE047', to: '#F43F5E' },
  { name: 'Fire', from: '#FACC15', to: '#EF4444' },
  { name: 'Candy', from: '#F9A8D4', to: '#A855F7' },
  { name: 'Ocean', from: '#67E8F9', to: '#3B82F6' },
  { name: 'Lime', from: '#C8FF00', to: '#22D3EE' },
  { name: 'Ice', from: '#FFFFFF', to: '#93C5FD' },
  { name: 'Silver', from: '#FFFFFF', to: '#A1A1AA' },
]

const HEX = /^#[0-9a-f]{6}$/i

/** The style's gradient, if it has a usable one */
export function gradientOf(style: Partial<CaptionStyle>): CaptionGradient | null {
  const g = style.gradient
  if (!g || typeof g !== 'object' || !HEX.test(g.from ?? '') || !HEX.test(g.to ?? '')) return null
  return { from: g.from, to: g.to, dir: g.dir === 'right' ? 'right' : 'down' }
}

/** Two gradients the same (or both none) */
export const sameGradient = (a: CaptionGradient | null | undefined, b: CaptionGradient | null | undefined) =>
  (!a && !b) || (!!a && !!b && a.from.toLowerCase() === b.from.toLowerCase() && a.to.toLowerCase() === b.to.toLowerCase() && (a.dir ?? 'down') === (b.dir ?? 'down'))

/** As CSS (the panel's chips and samples) */
export const gradientCss = (g: Pick<CaptionGradient, 'from' | 'to'> & { dir?: CaptionGradient['dir'] }) =>
  `linear-gradient(${g.dir === 'right' ? 'to right' : 'to bottom'}, ${g.from}, ${g.to})`

/** Where text is drawn, in canvas pixels */
export interface TextBox { x0: number; y0: number; x1: number; y1: number }
export const emptyBox = (): TextBox => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })

/** A canvas colour as r, g, b (0–255) and alpha (0–1); null if it isn't one written as hex or rgb() */
function rgbaOf(c: string): [number, number, number, number] | null {
  const s = c.trim().toLowerCase()
  let m = /^#([0-9a-f]{3,8})$/.exec(s)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = h.split('').map(x => x + x).join('')
    if (h.length !== 6 && h.length !== 8) return null
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s)
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    if (p.length < 3 || p.slice(0, 3).some(v => !Number.isFinite(v))) return null
    return [p[0], p[1], p[2], p.length > 3 && Number.isFinite(p[3]) ? p[3] : 1]
  }
  return null
}

/**
 * A stand-in for `ctx` that draws every fill in the colour `text` as the gradient over `paint.box`
 * (keeping that fill's own see-through-ness), and notes where any text is drawn into `seen`.
 * Everything else goes straight to `ctx`.
 */
export function gradientContext(ctx: CanvasRenderingContext2D, text: string,
  paint: { gradient: CaptionGradient; box: TextBox } | null, seen?: TextBox): CanvasRenderingContext2D {
  const want = rgbaOf(text)
  // (whether the fill colour now is the text's, and how see-through; kept with save / restore)
  let on = false, alpha = 1
  const kept: Array<[boolean, number]> = []
  const bound = new Map<PropertyKey, unknown>()

  const note = (t: string, x: number, y: number) => {
    if (!seen) return
    const m = ctx.measureText(t)
    const align = ctx.textAlign
    const left = align === 'center' ? x - m.width / 2 : align === 'right' || align === 'end' ? x - m.width : x
    // (the font's own height round the line, as libass makes a line's height)
    const top = y - m.fontBoundingBoxAscent, bottom = y + m.fontBoundingBoxDescent
    const tf = ctx.getTransform()
    for (const [px, py] of [[left, top], [left + m.width, top], [left, bottom], [left + m.width, bottom]]) {
      const p = tf.transformPoint({ x: px, y: py })
      seen.x0 = Math.min(seen.x0, p.x); seen.x1 = Math.max(seen.x1, p.x)
      seen.y0 = Math.min(seen.y0, p.y); seen.y1 = Math.max(seen.y1, p.y)
    }
  }
  const painted = <T,>(draw: () => T): T => {
    if (!on || !paint) return draw()
    const { box, gradient } = paint
    // (the box is in canvas pixels: put into the drawing's own space as it is now)
    const inv = ctx.getTransform().invertSelf()
    const a = inv.transformPoint({ x: box.x0, y: box.y0 })
    const b = inv.transformPoint(gradient.dir === 'right' ? { x: box.x1, y: box.y0 } : { x: box.x0, y: box.y1 })
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return draw()
    const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y)
    g.addColorStop(0, gradient.from)
    g.addColorStop(1, gradient.to)
    const fill = ctx.fillStyle, ga = ctx.globalAlpha
    ctx.fillStyle = g
    ctx.globalAlpha = ga * alpha
    try { return draw() } finally { ctx.fillStyle = fill; ctx.globalAlpha = ga }
  }

  return new Proxy(ctx, {
    get(target, prop) {
      switch (prop) {
        case 'fillText': return (t: string, x: number, y: number, maxW?: number) => {
          note(t, x, y)
          painted(() => (maxW === undefined ? target.fillText(t, x, y) : target.fillText(t, x, y, maxW)))
        }
        case 'strokeText': return (t: string, x: number, y: number, maxW?: number) => {
          note(t, x, y)
          if (maxW === undefined) target.strokeText(t, x, y)
          else target.strokeText(t, x, y, maxW)
        }
        case 'fill': return (...args: unknown[]) => painted(() => (target.fill as (...a: unknown[]) => void)(...args))
        case 'fillRect': return (x: number, y: number, w: number, h: number) => painted(() => target.fillRect(x, y, w, h))
        case 'save': return () => { kept.push([on, alpha]); target.save() }
        case 'restore': return () => { const k = kept.pop(); if (k) [on, alpha] = k; target.restore() }
      }
      const v = Reflect.get(target, prop)
      if (typeof v !== 'function') return v
      let f = bound.get(prop)
      if (!f) { f = (v as (...a: unknown[]) => unknown).bind(target); bound.set(prop, f) }
      return f
    },
    set(target, prop, value) {
      if (prop === 'fillStyle') {
        const c = typeof value === 'string' ? rgbaOf(value) : null
        on = !!(want && c && c[0] === want[0] && c[1] === want[1] && c[2] === want[2])
        alpha = on && c ? c[3] : 1
      }
      return Reflect.set(target, prop, value)
    },
  })
}
