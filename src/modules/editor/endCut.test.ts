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
