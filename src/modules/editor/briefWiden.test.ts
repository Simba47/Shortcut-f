// Brief appearances in the editor (Follow): the view takes in someone on screen ~0.5 s, the same as Make
// my clips. Run: npx tsx --test src/modules/editor/briefWiden.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { widened, briefView, withWide, within, type Rect } from './briefWiden'

const face = (cx: number, w = 0.08): Rect => ({ x: cx - w / 2, y: 0.3, w, h: w * 1.6 })
// A Vertical 9:16 view of a 16:9 picture at full height: 0.316 wide
const vertical = (cx: number): Rect => ({ x: cx - 0.158, y: 0, w: 0.3164, h: 1 })

test('a Vertical on A takes in B beside it: same shape, both whole, inside the picture', () => {
  const A = face(0.42), B = face(0.60)
  const v = widened(vertical(0.42), [A], B)!
  assert.ok(v && within(A, v) && within(B, v), JSON.stringify(v))
  assert.ok(Math.abs(v.w / v.h - 0.3164) < 1e-9 && v.x >= 0 && v.x + v.w <= 1)
})

test('too far for one 9:16 view: nothing (the view stays)', () => {
  assert.equal(widened(vertical(0.3), [face(0.3)], face(0.9)), null)
})

test('a Split: the view whose strip holds them widens there; the other view is left alone', () => {
  const views = [{ x: 0.1, y: 0.1, w: 0.3, h: 0.5 }, { x: 0.6, y: 0.1, w: 0.3, h: 0.5 }]
  const pick = briefView(views, () => [face(0.25), face(0.75)], face(0.93, 0.06))!
  assert.equal(pick.i, 1)
  assert.ok(pick.view.x >= 0.4 - 1e-9, 'never over the left view')
  assert.ok(within(face(0.93, 0.06), pick.view))
  // already shown whole: nothing to do
  assert.equal(briefView(views, () => [], face(0.75)), null)
})

test('the keyframes: cut out and back, the moves inside the moment give way, the rest kept', () => {
  type K = Rect & { t_ms: number }
  const kfs: K[] = [{ t_ms: 0, x: 0.2, y: 0, w: 0.3, h: 1 }, { t_ms: 3000, x: 0.25, y: 0, w: 0.3, h: 1 }, { t_ms: 6000, x: 0.3, y: 0, w: 0.3, h: 1 }]
  const at = (t: number) => { const k = [...kfs].reverse().find(x => x.t_ms <= t) ?? kfs[0]; return { x: k.x, y: k.y, w: k.w, h: k.h } }
  const wide = { x: 0.35, y: 0, w: 0.3, h: 1 }
  const out = withWide(kfs, wide, 2800, 3400, 0, 10000, at, (t, r) => ({ t_ms: t, ...r }))
  assert.deepEqual(out.map(k => k.t_ms), [0, 2799, 2800, 3399, 3400, 6000])
  assert.deepEqual(out.find(k => k.t_ms === 2800), { t_ms: 2800, ...wide })
  assert.deepEqual(out.find(k => k.t_ms === 3399), { t_ms: 3399, ...wide })
  assert.equal(out.find(k => k.t_ms === 3400)!.x, 0.25, 'back to where it was')
})

test('the same as Make my clips (the worker’s clip_formats.ts widened) on 2,000 random cases', async () => {
  const path = process.env.BACKEND_CLIP_FORMATS
  if (!path) return   // (run with BACKEND_CLIP_FORMATS=<the worker's src/jobs/clip_formats.ts> to compare)
  for (const k of ['DATABASE_URL', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) process.env[k] ??= k === 'DATABASE_URL' ? 'postgres://t:t@127.0.0.1:1/t' : k === 'R2_ENDPOINT' ? 'http://127.0.0.1:1' : 't'
  const backend = await import(path) as { widened: (v: Rect, keep: Rect[], f: Rect, lo?: number, hi?: number) => Rect | null }
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  let same = 0, widenedN = 0
  for (let n = 0; n < 2000; n++) {
    const h = 0.4 + rnd() * 0.6, w = h * (rnd() < 0.5 ? 0.3164 : 0.6)
    const view = { x: rnd() * (1 - w), y: rnd() * (1 - h), w, h }
    const keep = [face(view.x + view.w * rnd(), 0.03 + rnd() * 0.1)]
    const f = face(rnd(), 0.03 + rnd() * 0.1)
    const lo = rnd() < 0.5 ? 0 : rnd() * view.x, hi = rnd() < 0.5 ? 1 : view.x + view.w + rnd() * (1 - view.x - view.w)
    const a = widened(view, keep, f, lo, hi), b = backend.widened(view, keep, f, lo, hi)
    if (JSON.stringify(a) === JSON.stringify(b)) same++
    if (a) widenedN++
  }
  assert.equal(same, 2000)
  assert.ok(widenedN > 200, `cases widened: ${widenedN}`)
})
