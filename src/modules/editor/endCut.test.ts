// Deleting the main video's last part ends the clip there (endCut.ts). Run: npx tsx --test src/modules/editor/endCut.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SegmentLocal } from '@chai-cut/shared'
import { endCut } from './endCut'

const MAIN = 'main-video'
/** A part of the main row; gap: deleted (hidden, muted, its picture hidden) */
const part = (id: string, start_ms: number, end_ms: number, gap = false): SegmentLocal => ({
  id, start_ms, end_ms, layout: 'vertical', sort_order: 0, hidden: gap, muted: gap,
  crop_boxes: [{ id: `${id}-box`, slot_index: 0, source_video_id: null, source_offset_ms: 0, hidden: gap, keyframes: [] }],
} as unknown as SegmentLocal)
/** A video on a row */
const shot = (id: string, start_ms: number, end_ms: number): SegmentLocal => ({
  ...part(id, start_ms, end_ms), crop_boxes: [{ id: `${id}-box`, slot_index: 0, source_video_id: 'broll', source_offset_ms: 0, keyframes: [] }],
} as unknown as SegmentLocal)
const shots = new Set<string>()
const cut = (segments: SegmentLocal[], partId: string, onTop: { start_ms: number; end_ms: number }[] = [], tail?: string) =>
  endCut({ segments, mainVideoId: MAIN, onTop, isShot: s => shots.has(s.id), isTail: s => s.id === tail, partId })

test('the user\'s case: a 2-min clip split at 0:30, the last 1:30 deleted → cut 0:30–2:00 (the clip is 30 s)', () => {
  assert.deepEqual(cut([part('a', 0, 30_000), part('b', 30_000, 120_000)], 'b'), { start: 30_000, end: 120_000 })
})

test('a part in the middle: an empty space as before (nothing after it moves)', () => {
  assert.equal(cut([part('a', 0, 30_000), part('b', 30_000, 60_000), part('c', 60_000, 120_000)], 'b'), null)
})

test('empty spaces just before the last part go too, so no black is left at the end', () => {
  const segs = [part('a', 0, 30_000), part('g', 30_000, 60_000, true), part('b', 60_000, 120_000)]
  assert.deepEqual(cut(segs, 'b'), { start: 30_000, end: 120_000 })
})

test('only empty spaces after it: it is the last part with video → cut it and them', () => {
  const segs = [part('a', 0, 30_000), part('b', 30_000, 60_000), part('g', 60_000, 120_000, true)]
  assert.deepEqual(cut(segs, 'b'), { start: 30_000, end: 120_000 })
})

test('a video on a row plays there: kept as an empty space (the video keeps its time)', () => {
  shots.add('r')
  try {
    const segs = [part('a', 0, 30_000), part('b', 30_000, 120_000), shot('r', 100_000, 110_000)]
    assert.equal(cut(segs, 'b'), null)
  } finally { shots.delete('r') }
})

test('a text or a photo on top there: kept as an empty space', () => {
  const segs = [part('a', 0, 30_000), part('b', 30_000, 120_000)]
  assert.equal(cut(segs, 'b', [{ start_ms: 115_000, end_ms: 118_000 }]), null)
})

test('something on top only over the earlier empty space: the part goes, that space stays', () => {
  const segs = [part('a', 0, 30_000), part('g', 30_000, 60_000, true), part('b', 60_000, 120_000)]
  assert.deepEqual(cut(segs, 'b', [{ start_ms: 40_000, end_ms: 50_000 }]), { start: 60_000, end: 120_000 })
})

test('things reaching past the main row (its room after it): left as before', () => {
  const segs = [part('a', 0, 30_000), part('b', 30_000, 120_000), part('t', 120_000, 130_000, true)]
  assert.equal(cut(segs, 'b', [], 't'), null)
})

test('an empty space before it that does not touch it stops the run', () => {
  const segs = [part('g', 0, 10_000, true), part('a', 10_000, 30_000), part('b', 30_000, 120_000)]
  assert.deepEqual(cut(segs, 'b'), { start: 30_000, end: 120_000 })
})

test('a part that is not in the main row: nothing to cut', () => {
  assert.equal(cut([part('a', 0, 30_000)], 'nope'), null)
})

// ── 2026-11-21: the brand kit's logo, the first part, things held to an edge ──
import { startCut, pinToEdges } from './endCut'
const pin = (segments: SegmentLocal[], partId: string, pinnable: { start_ms: number; end_ms: number }[], onTop: { start_ms: number; end_ms: number }[] = []) =>
  endCut({ segments, mainVideoId: MAIN, onTop, pinnable, isShot: s => shots.has(s.id), isTail: () => false, partId })
const first = (segments: SegmentLocal[], partId: string, pinnable: { start_ms: number; end_ms: number }[] = [], onTop: { start_ms: number; end_ms: number }[] = []) =>
  startCut({ segments, mainVideoId: MAIN, onTop, pinnable, isShot: s => shots.has(s.id), partId })
const three = () => [part('a', 0, 10_000), part('b', 10_000, 20_000), part('c', 20_000, 30_000)]

test('the brand kit\'s logo over the whole clip no longer keeps the end: the last part is cut', () => {
  assert.deepEqual(pin(three(), 'c', [{ start_ms: 0, end_ms: 30_000 }]), { start: 20_000, end: 30_000 })
})
test('a logo or closing line over the last seconds goes with the end too', () => {
  assert.deepEqual(pin(three(), 'c', [{ start_ms: 27_000, end_ms: 30_000 }]), { start: 20_000, end: 30_000 })
})
test('a text in the middle of the deleted part (not held to the end) still keeps an empty space', () => {
  assert.equal(pin(three(), 'c', [{ start_ms: 22_000, end_ms: 25_000 }]), null)
})
test('a video in a window there still keeps an empty space', () => {
  assert.equal(pin(three(), 'c', [], [{ start_ms: 25_000, end_ms: 30_000 }]), null)
})
test('the first part deleted: the clip starts after it', () => {
  assert.deepEqual(first(three(), 'a'), { start: 0, end: 10_000 })
})
test('the first part with the hook title (held to the start) and the logo over the clip: cut', () => {
  assert.deepEqual(first(three(), 'a', [{ start_ms: 0, end_ms: 3_000 }, { start_ms: 0, end_ms: 30_000 }]), { start: 0, end: 10_000 })
})
test('the first part with a text in its middle: an empty space as before', () => {
  assert.equal(first(three(), 'a', [{ start_ms: 4_000, end_ms: 6_000 }]), null)
})
test('a part after an empty space at the start is the first with video: it and that space go, and empty space after it too', () => {
  const segs = [part('g', 0, 5_000, true), part('a', 5_000, 10_000), part('h', 10_000, 15_000, true), part('b', 15_000, 30_000)]
  assert.deepEqual(first(segs, 'a'), { start: 0, end: 15_000 })
})
test('a part in the middle is not the first: nothing to cut at the start', () => {
  assert.equal(first(three(), 'b'), null)
})
test('an empty space at the end (what was over it deleted since) is cut', () => {
  const segs = [part('a', 0, 10_000), part('b', 10_000, 20_000), part('g', 20_000, 30_000, true)]
  assert.deepEqual(pin(segs, 'g', []), { start: 20_000, end: 30_000 })
})

const o = (id: string, start_ms: number, end_ms: number) => ({ id, start_ms, end_ms })
test('pinToEdges: the end cut — a logo over the last 3 s comes back at the new end, the whole-clip one covers the clip', () => {
  const before = [o('end', 27_000, 30_000), o('all', 0, 30_000), o('mid', 5_000, 8_000)]
  const after = [o('all', 0, 20_000), o('mid', 5_000, 8_000)]          // (rippleDelete dropped 'end')
  const out = pinToEdges(before, after, 20_000, 30_000, 30_000, 20_000)
  assert.deepEqual(out.find(x => x.id === 'end'), o('end', 17_000, 20_000))
  assert.deepEqual(out.find(x => x.id === 'all'), o('all', 0, 20_000))
  assert.deepEqual(out.find(x => x.id === 'mid'), o('mid', 5_000, 8_000))
})
test('pinToEdges: the start cut — the hook title stays at 0 for as long as it was', () => {
  const out = pinToEdges([o('hook', 0, 3_000)], [], 0, 10_000, 30_000, 20_000)
  assert.deepEqual(out, [o('hook', 0, 3_000)])
})
test('pinToEdges: a cut in the middle changes nothing', () => {
  const after = [o('end', 17_000, 20_000)]
  assert.equal(pinToEdges([o('end', 27_000, 30_000)], after, 10_000, 20_000, 30_000, 20_000), after)
})
test('pinToEdges: never longer than the clip left', () => {
  assert.deepEqual(pinToEdges([o('t', 20_000, 30_000)], [], 2_000, 30_000, 30_000, 2_000), [o('t', 0, 2_000)])
})
