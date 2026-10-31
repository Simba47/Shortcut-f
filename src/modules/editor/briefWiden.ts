// ── Brief appearances: the view takes in someone on screen ~0.5 s ─────────────
// The scan (worker findAngles, its close looks) lists, per scene, people on screen too briefly to be
// its people — Angle.brief. The user's pick (2026-11-01): the section keeps its format and the view
// nearest them widens to take them in for that moment, cutting out and back. The same rules as Make
// my clips (backend jobs/clip_formats.ts widened / widenFor) — keep the two in step.

/** A view, or a face: fractions of the video's picture */
export interface Rect { x: number; y: number; w: number; h: number }
/** Someone on screen briefly: their face, and when [from, to) (source ms) */
export interface Brief extends Rect { from: number; to: number }

/** Room kept around the faces when a view widens (face heights above and below, face widths beside) */
const ROOM_TOP = 0.5
const ROOM_BOTTOM = 0.6
const ROOM_SIDE = 0.25
/** A brief moment shorter than this (once inside its section) isn't widened for */
export const WIDEN_MIN_MS = 150

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
export const within = (f: Rect, v: Rect) => f.x >= v.x - 1e-6 && f.x + f.w <= v.x + v.w + 1e-6 && f.y >= v.y - 1e-6 && f.y + f.h <= v.y + v.h + 1e-6

/**
 * A view taking in `face` as well as the people it shows (`keep`): the same shape, never smaller, about
 * the middle of them all, inside the picture and its strip (lo..hi across — never over a neighbour's
 * view); everyone in it whole. With the room around the faces if that fits, else the faces alone; null
 * when even that can't be done (the view stays as it was).
 */
export function widened(view: Rect, keep: readonly Rect[], face: Rect, lo = 0, hi = 1): Rect | null {
  const shape = view.w / view.h
  const all = [...keep, face]
  for (const room of [true, false]) {
    const x0 = Math.min(...all.map(f => f.x - (room ? ROOM_SIDE * f.w : 0)))
    const x1 = Math.max(...all.map(f => f.x + f.w + (room ? ROOM_SIDE * f.w : 0)))
    const y0 = Math.max(0, Math.min(...all.map(f => f.y - (room ? ROOM_TOP * f.h : 0))))
    const y1 = Math.min(1, Math.max(...all.map(f => f.y + f.h + (room ? ROOM_BOTTOM * f.h : 0))))
    let h = Math.min(1, Math.max(view.h, y1 - y0, (x1 - x0) / shape))
    let w = shape * h
    if (w > hi - lo) { w = hi - lo; h = w / shape }
    if (w < view.w - 1e-6) return null
    const v = { x: clamp((x0 + x1) / 2 - w / 2, lo, hi - w), y: clamp((y0 + y1) / 2 - h / 2, 0, 1 - h), w, h }
    if (all.every(f => within(f, v))) return v
  }
  return null
}

/**
 * Which view of a section takes them in, and how: `views` where the section is at that moment (left to
 * right or in slot order), `keepOf(i)` the people view i shows then. The view whose strip (between its
 * neighbours' edges) holds their middle first, else the nearest; null when none can (or one already
 * shows them whole: nothing to do).
 */
export function briefView(views: readonly Rect[], keepOf: (i: number) => readonly Rect[], face: Rect): { i: number; view: Rect } | null {
  if (views.some(v => within(face, v))) return null
  const cx = face.x + face.w / 2
  const strip = (s: number): [number, number] => {
    const mid = views[s].x + views[s].w / 2
    const others = views.filter((_, k) => k !== s)
    return [Math.max(0, ...others.filter(o => o.x + o.w / 2 < mid).map(o => o.x + o.w)), Math.min(1, ...others.filter(o => o.x + o.w / 2 >= mid).map(o => o.x))]
  }
  const order = views.map((v, i) => ({ i, inStrip: cx >= strip(i)[0] && cx <= strip(i)[1], d: Math.abs(v.x + v.w / 2 - cx) }))
    .sort((p, q) => Number(q.inStrip) - Number(p.inStrip) || p.d - q.d)
  for (const { i } of order) {
    const [lo, hi] = strip(i)
    const view = widened(views[i], keepOf(i).filter(f => within(f, views[i])), face, lo, hi)
    if (view) return { i, view }
  }
  return null
}

/**
 * A view's keyframes with `wide` over [from, to) — cut out and back (a keyframe 1 ms before each
 * change, as the editor cuts); its moves inside that moment give way. `at(t)`: where the view is at t
 * now; `start`/`end`: its section.
 */
export function withWide<K extends { t_ms: number } & Rect>(
  kfs: readonly K[], wide: Rect, from: number, to: number, start: number, end: number, at: (t: number) => Rect, make: (t: number, r: Rect) => K,
): K[] {
  const next: K[] = [
    ...kfs.filter(k => k.t_ms < from - 1 || k.t_ms >= to + 1),
    ...(from > start ? [make(from - 1, at(from - 1))] : []),
    make(from, wide), make(to - 1, wide),
    ...(to < end ? [make(to, at(to))] : []),
  ].sort((p, q) => p.t_ms - q.t_ms)
  return next.filter((k, i) => i === next.length - 1 || next[i + 1].t_ms !== k.t_ms)
}
