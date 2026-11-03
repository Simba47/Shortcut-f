// The Rulebook's input/output test log (its section 8) on the decision rules: each row is a seating (gaps in
// face widths, as the Rulebook writes them), who talks, and the format it must give with who is in which
// view, top to bottom. Run after every change to AUTO_FORMAT: npm run test:auto-format
// (Rows 2, 15 and 16 need real footage — following, fast cutting, a walk-through — and aren't here.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideFormat, seatBreaks, seatGaps } from './autoFormat'

const AR = 16 / 9
const NAMES = 'ABCDEFGH'
/** People sitting with these gaps between them (face widths), left to right, centred in the picture */
function seat(gaps: number[], w = 0.06) {
  const xs = [0]
  for (const g of gaps) xs.push(xs[xs.length - 1] + w + g * w)
  const off = 0.5 - (xs[xs.length - 1] + w) / 2
  return xs.map(x => ({ x: x + off, y: 0.3, w, h: w * 1.3 }))
}
/** Only `who` talks */
const talks = (n: number, who: number) => Array.from({ length: n }, (_, i) => (i === who ? 9000 : 0))
/** "Split: A B / C D", "Trio: A / B C / D", "Vertical: A B" — who is in each view (their face's middle inside it) */
function result(faces: ReturnType<typeof seat>, talk: number[] | null) {
  const r = decideFormat(faces, talk, AR)!
  const views = r.framing.map(v => faces.flatMap((f, i) => {
    const cx = f.x + f.w / 2
    return cx >= v.x && cx <= v.x + v.w ? [NAMES[i]] : []
  }).join(' '))
  if (r.why === 'whole') return 'Whole picture'
  return `${r.layout === 'vertical' ? 'Vertical' : r.layout === 'split' ? 'Split' : 'Trio'}: ${views.join(' / ')}`
}

const LOG: Array<[number, string, ReturnType<typeof seat>, number[] | null, string]> = [
  [1, '1 person, talking', seat([]), talks(1, 0), 'Vertical: A'],
  [3, '2 apart, B talks', seat([6]), talks(2, 1), 'Split: A / B'],
  [4, '2 apart, no transcript', seat([6]), null, 'Split: A / B'],
  [5, '2 sitting close', seat([0.4]), null, 'Vertical: A B'],
  [6, '3 apart, B (middle) talks', seat([3, 3]), talks(3, 1), 'Trio: A / B / C'],
  [7, '3 apart, C (right) talks', seat([3, 3]), talks(3, 2), 'Trio: A / B / C'],
  [8, '3 sitting close', seat([0.3, 0.3], 0.05), null, 'Vertical: A B C'],
  [9, '1 + 2 + 1, D talks', seat([3, 0.5, 3]), talks(4, 3), 'Trio: A / B C / D'],
  [10, '2 + 1 + 2, C talks', seat([0.5, 2.5, 2.5, 0.5], 0.05), talks(5, 2), 'Trio: A B / C / D E'],
  [11, '2 + 2, C talks', seat([0.5, 3, 0.5]), talks(4, 2), 'Split: A B / C D'],
  [12, '4 evenly spaced, A talks', seat([1.5, 1.6, 1.5]), talks(4, 0), 'Split: C D / A B'],
  [13, '3 + 3, A talks', seat([0.5, 0.6, 3, 0.5, 0.6], 0.045), talks(6, 0), 'Split: D E F / A B C'],
  [14, '4 + 1, E talks', seat([0.6, 0.5, 0.6, 3], 0.05), talks(5, 4), 'Split: A B C D / E'],
  // (row 17 changed by the user, 2026-10-25 — never lose a subject: small faces go by the rules too)
  [17, 'Wide shot, faces under 3.6% of width, nobody known to talk', seat([6, 6], 0.025), null, 'Trio: A / B / C'],
  [18, '2 apart, speaker changes halfway (B talks more)', seat([6]), [4000, 6000], 'Split: A / B'],
]
for (const [n, input, faces, talk, want] of LOG) {
  test(`test log ${n}: ${input} → ${want}`, () => assert.equal(result(faces, talk), want))
}

test('crosstalk (two talk equally): no speaker, the left one on top', () => {
  assert.equal(result(seat([6]), [5000, 5000]), 'Split: A / B')
})

test('a speaker needs SPEAKER_MIN of the talk: 6 people, the most talkative at 18%, is no speaker', () => {
  // A 18%, the rest about 16% each: left side on top
  assert.equal(result(seat([0.5, 0.6, 3, 0.5, 0.6], 0.045), [1800, 1640, 1640, 1640, 1640, 1640]), 'Split: A B C / D E F')
})

test('groups from the gaps (section 3 worked examples)', () => {
  const groups = (gaps: number[]) => seatBreaks(seatGaps(seat(gaps))).length + 1
  assert.equal(groups([3.0, 0.5, 3.0]), 3)
  assert.equal(groups([0.5, 3.0, 0.5]), 2)
  assert.equal(groups([0.5, 2.5, 2.5, 0.5]), 3)
  assert.equal(groups([1.5, 1.6, 1.5]), 1)
  assert.equal(groups([0.6, 0.5, 0.6, 3.0]), 2)
  assert.equal(groups([0.5, 0.6, 3.0, 0.5, 0.6]), 2)
})

test('views: the upscale limit — a Trio view is at least 320 px of a 1080p source (2× at most)', () => {
  const r = decideFormat(seat([3, 3], 0.04), null, AR, 1080)!
  for (const v of r.framing) assert.ok(v.h * 1080 >= 320 - 0.5, `view ${v.h * 1080} px tall`)
})

test('views: headroom — the top of each view is at least half a face above the forehead', () => {
  const faces = seat([3, 3])
  const r = decideFormat(faces, null, AR)!
  r.framing.forEach((v, i) => assert.ok(v.y <= faces[i].y - 0.5 * faces[i].h + 1e-9 || v.y === 0))
})

test('never lose a subject: a wide shot of seven with small faces keeps all seven in the views', () => {
  const faces = seat([2.4, 1.6, 2.2, 1.8, 1.7, 2.6], 0.03)
  const r = decideFormat(faces, null, AR)!
  assert.notEqual(r.layout, 'vertical')
  for (const f of faces) assert.ok(r.framing.some(v => f.x >= v.x && f.x + f.w <= v.x + v.w && f.y >= v.y && f.y + f.h <= v.y + v.h), 'someone is cut out')
})

test('never lose a subject: when no Split or Trio can hold everyone, the whole picture (Blur fill)', () => {
  // Two big close-ups squeezed at the left edge: neither fits one 9:16 crop together, and the left one's
  // strip (the picture's edge to the gap) is too narrow for a view that holds their head whole
  const faces = [{ x: 0.02, y: 0.2, w: 0.2, h: 0.445 }, { x: 0.24, y: 0.2, w: 0.2, h: 0.445 }]
  assert.equal(decideFormat(faces, null, AR)!.layout, 'frame_blur_fill')
})

test('a Split at the Rulebook’s cut that would lose someone tries the other cuts first (4 + 1, the four spread wide)', () => {
  const r = result(seat([3, 3, 3, 5], 0.05), null)
  assert.ok(r.startsWith('Split'), r)
})

test('a collage of two rows (people one above another) gets a Split whose views reach the bottom row', () => {
  // The user's clip at 3:55: four interviews in a 2 × 2 grid — D over A, E over H on the left, I over B on
  // the right. Views sized by width alone cut the bottom row's chins, so it fell to the whole picture
  const faces = [
    { x: 0.095, y: 0.622, w: 0.038, h: 0.088 }, { x: 0.110, y: 0.134, w: 0.035, h: 0.085 },
    { x: 0.355, y: 0.605, w: 0.043, h: 0.106 }, { x: 0.383, y: 0.082, w: 0.040, h: 0.102 },
    { x: 0.706, y: 0.085, w: 0.094, h: 0.217 }, { x: 0.793, y: 0.579, w: 0.074, h: 0.168 },
  ]
  const r = decideFormat(faces, null, AR)!
  assert.equal(r.layout, 'split')
  const [top, bottom] = r.framing
  const holds = (v: typeof top, ids: number[]) => ids.every(i => {
    const f = faces[i]
    return f.x >= v.x && f.x + f.w <= v.x + v.w && f.y >= v.y && f.y + f.h * (1 + AUTO_FORMAT.CHIN_ROOM) <= v.y + v.h + 1e-6
  })
  assert.ok(holds(top, [0, 1, 2, 3]), 'the left two interviews on top, chins and all')
  assert.ok(holds(bottom, [4, 5]), 'the right two at the bottom, chins and all')
  assert.ok(top.x + top.w <= bottom.x, 'side by side, no overlap')
})

test('the mirrored collage gets the same Split, three and three (not one person alone on top)', () => {
  // The same clip at 4:30: rows offset the other way. It got a Split only by luck (one wide side), with
  // Siddharth alone on top; the Rulebook's middle cut (3 + 3) needs views tall enough for both rows
  const faces = [
    { x: 0.129, y: 0.078, w: 0.079, h: 0.200 }, { x: 0.350, y: 0.621, w: 0.041, h: 0.093 },
    { x: 0.432, y: 0.058, w: 0.070, h: 0.159 }, { x: 0.607, y: 0.603, w: 0.049, h: 0.109 },
    { x: 0.788, y: 0.562, w: 0.086, h: 0.203 }, { x: 0.822, y: 0.116, w: 0.068, h: 0.132 },
  ]
  const r = decideFormat(faces, null, AR)!
  assert.equal(r.layout, 'split')
  const inView = r.framing.map(v => faces.filter(f => f.x >= v.x && f.x + f.w <= v.x + v.w && f.y >= v.y && f.y + f.h <= v.y + v.h).length)
  assert.deepEqual(inView, [3, 3])
})

// ── The guarantees, on thousands of random scenes (the user, 2026-10-25: "maintain these rules for every
// possible clip, not only the one we're working on") ──
// 1–8 people, faces tiny (a wide shot) to huge (a close-up), bunched, spread or at the picture's edges,
// with or without who talks, in 16:9, 2.17:1 (cinema), 4:3 and 1:1 pictures. Every result must: keep
// every face whole in a view (or be the whole picture), never overlap two views, never blow a view up past
// MAX_ZOOM, keep headroom above the faces, and stay inside the picture.
import { AUTO_FORMAT, WHOLE_PICTURE } from './autoFormat'

/** A small seeded random generator (mulberry32): the same scenes every run */
function random(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const SHAPES = [16 / 9, 2.17, 4 / 3, 1]
const VIEW_PX: Record<string, number> = { split: 960, trio: 640 }

/** `rows`: a collage — faces may sit one above another (in different rows), only never on top of each other */
function randomScene(rnd: () => number, rows = false) {
  const ar = SHAPES[Math.floor(rnd() * SHAPES.length)]
  const n = 1 + Math.floor(rnd() * 8)
  const kind = rnd()
  const size = kind < 0.3 ? 0.012 + rnd() * 0.023 : kind < 0.8 ? 0.035 + rnd() * 0.085 : 0.12 + rnd() * 0.13
  const faces: Array<{ x: number; y: number; w: number; h: number }> = []
  for (let tries = 0; faces.length < n && tries < 200; tries++) {
    const w = size * (0.8 + rnd() * 0.4)
    const h = Math.min(rows ? 0.45 : 0.9, w * ar * 1.25)
    const x = rnd() * (1 - w), y = 0.03 + rnd() * Math.max(0, 0.95 - h - 0.03)
    // Faces don't sit on top of each other (side by side, a little apart; in a collage, apart either way)
    const across = (f: (typeof faces)[number]) => x < f.x + f.w + 0.004 && f.x < x + w + 0.004
    const down = (f: (typeof faces)[number]) => y < f.y + f.h + 0.004 && f.y < y + h + 0.004
    if (faces.some(f => across(f) && (!rows || down(f)))) continue
    faces.push({ x, y, w, h })
  }
  const talk = rnd() < 0.3 ? null : faces.map(() => (rnd() < 0.5 ? 0 : Math.round(rnd() * 9000)))
  return { ar, faces, talk }
}

const inside = (f: { x: number; y: number; w: number; h: number }, v: { x: number; y: number; w: number; h: number }) =>
  f.x >= v.x - 1e-6 && f.x + f.w <= v.x + v.w + 1e-6 && f.y >= v.y - 1e-6 && f.y + f.h <= v.y + v.h + 1e-6
const overlap = (p: { x: number; y: number; w: number; h: number }, q: { x: number; y: number; w: number; h: number }) =>
  Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)) * Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y))

for (const [name, seed, rows] of [['5,000 random scenes', 20261025, false], ['5,000 random collages (people one above another)', 20261026, true]] as const) test(`the guarantees hold on ${name}`, () => {
  const rnd = random(seed)
  const counts: Record<string, number> = {}
  for (let i = 0; i < 5000; i++) {
    const { ar, faces, talk } = randomScene(rnd, rows)
    if (!faces.length) continue
    const where = `scene ${i}: ${JSON.stringify({ ar: +ar.toFixed(2), faces: faces.map(f => [f.x, f.y, f.w, f.h].map(v => +v.toFixed(4))), talk })}`
    const r = decideFormat(faces, talk, ar)
    assert.ok(r, `no format — ${where}`)
    counts[r.why] = (counts[r.why] ?? 0) + 1
    if (r.layout === WHOLE_PICTURE) { assert.equal(r.framing.length, 0, where); continue }
    for (const v of r.framing) {
      // Inside the picture
      assert.ok(v.x >= -1e-9 && v.y >= -1e-9 && v.x + v.w <= 1 + 1e-9 && v.y + v.h <= 1 + 1e-9, `a view leaves the picture — ${where}`)
    }
    // Nobody lost: every face whole in a view — in a Vertical, a face wider than the 9:16 crop itself (an
    // extreme close-up in a cinema picture) can't be, so its middle is in the crop
    for (const f of faces) {
      const v0 = r.framing[0]
      const ok = r.layout === 'vertical' && f.w > v0.w
        ? f.x + f.w / 2 >= v0.x && f.x + f.w / 2 <= v0.x + v0.w
        : r.framing.some(v => inside(f, v))
      assert.ok(ok, `someone is cut out (${r.layout}, ${r.why}) — ${where}`)
    }
    if (r.layout === 'split' || r.layout === 'trio') {
      // No two views show the same part of the picture
      for (let a = 0; a < r.framing.length; a++) for (let b = a + 1; b < r.framing.length; b++) {
        assert.ok(overlap(r.framing[a], r.framing[b]) < 1e-9, `views overlap (${r.layout}, ${r.why}) — ${where}`)
      }
      for (const v of r.framing) {
        // Sharp enough: at most MAX_ZOOM (an assumed 1080p source)
        assert.ok(v.h * 1080 >= VIEW_PX[r.layout] / AUTO_FORMAT.MAX_ZOOM - 0.5, `a view is blown up past ${AUTO_FORMAT.MAX_ZOOM}× (${r.layout}) — ${where}`)
        // Headroom above its faces (or the view starts at the picture's top)
        const mine = faces.filter(f => inside(f, v))
        const top = Math.min(...mine.map(f => f.y)), tallest = Math.max(...mine.map(f => f.h))
        assert.ok(v.y <= top - AUTO_FORMAT.HEADROOM_MIN * tallest + 1e-6 || v.y < 1e-9, `no headroom (${r.layout}) — ${where}`)
      }
    }
  }
  console.log(`formats over ${name}:`, JSON.stringify(counts))
})

// ── Auto format's Vertical mode (the user, 2026-10-28: "when we select Vertical, the speaker gets the
// priority rather than the people in it") — decideVertical places each scene's one view; Follow then
// cuts it to whoever talks, each held at least MIN_HOLD (subjects.ts autoDirectChanges / holdAtLeast) ──
import { decideVertical } from './autoFormat'
import { autoDirectChanges, holdAtLeast, type SubjectPoint } from './subjects'

const centre = (v: { x: number; w: number }) => v.x + v.w / 2
const at = (cx: number, w = 0.08) => ({ x: cx - w / 2, y: 0.3, w, h: w * 1.6 })

test('Vertical mode: everyone who fits one 9:16 view gets it, together', () => {
  const r = decideVertical([at(0.45), at(0.55)], [9000, 1000], AR)!
  assert.equal(r.layout, 'vertical')
  assert.equal(r.why, 'fits')
  assert.ok(Math.abs(centre(r.framing[0]) - 0.5) < 0.01)
})

test('Vertical mode: people apart — the view on the speaker, wherever they sit', () => {
  const faces = [at(0.15), at(0.5), at(0.85)]
  for (const [k, cx] of [[0, 0.15], [1, 0.5], [2, 0.85]] as const) {
    const talk = [0, 0, 0]; talk[k] = 9000
    const r = decideVertical(faces, talk, AR)!
    assert.equal(r.why, 'speaker')
    assert.ok(Math.abs(centre(r.framing[0]) - cx) < 0.01 || r.framing[0].x === 0 || r.framing[0].x + r.framing[0].w >= 0.999, `on ${NAMES[k]}`)
  }
})

test('Vertical mode: nobody talks, or two talk as much (crosstalk) — the view on the biggest face', () => {
  const faces = [at(0.2, 0.06), at(0.8, 0.12)]
  for (const talk of [null, [0, 0], [5000, 5000]]) {
    const r = decideVertical(faces, talk, AR)!
    assert.equal(r.why, 'biggest')
    assert.ok(r.framing[0].x <= 0.8 && r.framing[0].x + r.framing[0].w >= 0.8, 'on the bigger face')
  }
})

test('Vertical mode never makes a Split or Trio, whoever is in the scene', () => {
  const rnd = random(20261028)
  for (let i = 0; i < 2000; i++) {
    const { ar, faces, talk } = randomScene(rnd)
    if (!faces.length) continue
    const r = decideVertical(faces, talk, ar)!
    assert.equal(r.layout, 'vertical')
    const v = r.framing[0]
    assert.ok(v.x >= -1e-9 && v.x + v.w <= 1 + 1e-9, 'inside the picture')
  }
})

/** A person seen at x through [from, to) ms (4 readings a second), with their turns */
function speakerSeen(id: string, x: number, seen: Array<[number, number]>, speaking: Array<[number, number]>) {
  const path: SubjectPoint[] = []
  for (const [a, b] of seen) for (let t = a; t < b; t += 250) path.push([t, x, 0.3, 0.08, 0.14, speaking.some(([p, q]) => t >= p && t < q) ? 1 : 0])
  return { id, path, speaking }
}
const same = (t: number) => t

test('Vertical mode: a turn shorter than MIN_HOLD (a “yeah”) doesn’t take the view', () => {
  const hold = AUTO_FORMAT.MIN_HOLD * 1000
  const a = speakerSeen('A', 0.2, [[0, 20000]], [[0, 5000], [6000, 12000]])
  const b = speakerSeen('B', 0.8, [[0, 20000]], [[5000, 6000], [12000, 20000]])
  const view = { w: 0.316, h: 1 }
  const who = (changes: ReturnType<typeof autoDirectChanges>) => (changes ?? []).filter((c, i) => i === 0 || c.cut).map(c => `${c.x + c.w / 2 < 0.5 ? 'A' : 'B'}@${c.t_ms}`)
  // Without the hold (as Follow does by hand): A, B for the second, A, B
  assert.deepEqual(who(autoDirectChanges([a, b], 0, 20000, same, view, undefined, same)), ['A@0', 'B@5000', 'A@6000', 'B@12000'])
  // Vertical mode: B's second goes to A — A, then B from 12 s
  assert.deepEqual(who(autoDirectChanges([a, b], 0, 20000, same, view, undefined, same, hold)), ['A@0', 'B@12000'])
})

test('holdAtLeast: a short stretch is kept when nobody else is in the picture through it', () => {
  const seen = (id: string, t: number) => id === 'B' || t < 5000 || t >= 6000   // A gone 5–6 s
  const out = holdAtLeast([{ from: 0, to: 5000, id: 'A' }, { from: 5000, to: 6000, id: 'B' }, { from: 6000, to: 12000, id: 'A' }], 2000, seen)
  assert.deepEqual(out.map(s => s.id), ['A', 'B', 'A'])
  // The first stretch short: it joins the one after
  const first = holdAtLeast([{ from: 0, to: 800, id: 'B' }, { from: 800, to: 9000, id: 'A' }], 2000, () => true)
  assert.deepEqual(first, [{ from: 0, to: 9000, id: 'A' }])
})

// ── People added by hand (+ Add) join their scene (angles.ts angleRows; the user, 2026-10-29: a listener
// sitting still was read as a picture, and adding him changed nothing — the scene stayed "1 person") ──
import { angleRows, placePeople, type Angle, type AngleSubject } from './angles'

const same2 = (t: number) => t
// Scene 3 of the user's clip: the scan found only C (right); the man on the left (L) sat still beside him
const scene3: Angle = { people: 1, at: 16350, faces: [{ x: 0.722, y: 0.2, w: 0.106, h: 0.2, person: 4 }], spans: [[14120, 18320]] }
const markL = { id: 'f', label: 'F', color: '#fb923c', mark_ms: 16350, mark_x: 0.25, mark_y: 0.3 }
/** L followed: seen at x 0.25–0.34 through the scene */
const pathL = Array.from({ length: 17 }, (_, i) => [14200 + i * 250, 0.245, 0.22, 0.09, 0.17, 0] as SubjectPoint)

test('+ Add: a person marked by hand and found joins the scene — counted, and Auto format splits it', () => {
  const [row] = angleRows([scene3], [{ ...markL, status: 'done', path: pathL } as AngleSubject], [], same2, 210000)
  assert.equal(row.people, 2)
  assert.deepEqual(row.faces.map(f => [f.subject?.label ?? null, !!f.added]), [[null, false], ['F', true]])
  const plan = decideFormat(row.faces.filter(f => !f.pending).map(f => f.box), null, AR)!
  assert.equal(plan.layout, 'split')
})

test('+ Add: marked, not followed yet — shown waiting on the card, not counted, not in Auto format', () => {
  const [row] = angleRows([scene3], [{ ...markL, status: 'new', path: null } as AngleSubject], [], same2, 210000)
  assert.equal(row.people, 1)
  assert.equal(row.faces.filter(f => f.pending).length, 1)
  assert.equal(row.set, false)
})

test('+ Add: someone followed but not in this scene, or on a face the scan found, isn’t added twice', () => {
  const elsewhere = pathL.map(p => [p[0] + 100000, ...p.slice(1)] as SubjectPoint)
  const [a] = angleRows([scene3], [{ ...markL, status: 'done', path: elsewhere } as AngleSubject], [], same2, 210000)
  assert.equal(a.people, 1)
  const onC = pathL.map(p => [p[0], 0.73, 0.21, 0.1, 0.19, 0] as SubjectPoint)
  const [b] = angleRows([scene3], [{ ...markL, mark_x: 0.77, status: 'done', path: onC } as AngleSubject], [], same2, 210000)
  assert.equal(b.people, 1)
  assert.equal(b.faces.length, 1)
})

// ── Each place's own people (the scan's `present`, 2026-11-03: a missed cut put a judges' panel into a man's
// stage shot, and every place showing only him got a Split for six) ──
test('Auto format decides each place on the people seen there: the man alone is Vertical, with the panel a Split', () => {
  const stage: Angle = {
    people: 5, at: 1000, spans: [[0, 2200], [6700, 17200]],
    faces: [{ x: 0.18, y: 0.3, w: 0.035, h: 0.06 }, { x: 0.37, y: 0.3, w: 0.035, h: 0.06 }, { x: 0.475, y: 0.25, w: 0.05, h: 0.09 }, { x: 0.59, y: 0.3, w: 0.035, h: 0.06 }, { x: 0.75, y: 0.3, w: 0.035, h: 0.06 }],
    talk: [[0, 0, 900, 0, 0], [0, 0, 5000, 300, 0]],
    present: [[2], [0, 1, 2, 3, 4]],
  }
  const [row] = angleRows([stage], [], [], same2, 20000)
  const [alone, all] = row.places.map(pl => placePeople(row, pl))
  assert.equal(alone.boxes.length, 1)
  assert.deepEqual(alone.talk, [900])
  assert.equal(decideFormat(alone.boxes, alone.talk, AR)!.layout, 'vertical')
  assert.equal(all.boxes.length, 5)
  assert.notEqual(decideFormat(all.boxes, all.talk, AR)!.layout, 'vertical')
})

test('placePeople: without the scan saying, everyone; a person added by hand counts in every place; a mark still being found doesn\'t', () => {
  const [plain] = angleRows([scene3], [], [], same2, 210000)
  assert.equal(placePeople(plain, plain.places[0]).boxes.length, 1)
  const [withF] = angleRows([scene3], [{ ...markL, status: 'done', path: pathL } as AngleSubject], [], same2, 210000)
  assert.equal(placePeople(withF, withF.places[0]).boxes.length, 2)
  const [waiting] = angleRows([scene3], [{ ...markL, status: 'new', path: null } as AngleSubject], [], same2, 210000)
  assert.equal(placePeople(waiting, waiting.places[0]).boxes.length, 1)
})
