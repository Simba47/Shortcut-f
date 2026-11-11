// Rows stacked as the timeline shows them (flattenShots): a hidden part of the main video lets the
// rows under it show through, as a deleted part does (user, 2026-11-06: a video under a hidden part
// was neither seen nor heard, in the preview or the export).
// Run: npx tsx --test src/modules/editor/shots.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SegmentLocal } from '@chai-cut/shared'
import { flattenShots, toSaved, restoreLayers } from './shots'
import { shownSegment } from './visibility'

const MAIN = 'main-video'
const kf = (t: number) => [{ t_ms: t, x: 0.3, y: 0, w: 0.32, h: 1 }]
const section = (id: string, a: number, b: number, over: Partial<SegmentLocal> = {}): SegmentLocal => ({
  id, start_ms: a, end_ms: b, layout: 'vertical', sort_order: 0,
  crop_boxes: [{ id: `${id}-b`, slot_index: 0, source_video_id: null, source_offset_ms: a, keyframes: kf(a) }],
  ...over,
} as SegmentLocal)
const video = (id: string, a: number, b: number, over: Partial<SegmentLocal> = {}): SegmentLocal => ({
  id, start_ms: a, end_ms: b, layout: 'vertical', sort_order: 0,
  crop_boxes: [{ id: `${id}-b`, slot_index: 0, source_video_id: 'other-video', source_offset_ms: 12400, muted: false, hidden: false, keyframes: [{ t_ms: a, x: 0, y: 0, w: 1, h: 1 }] }],
  ...over,
} as SegmentLocal)

// The clip "30sec" (2026-11-06): split at 5.2 s and 14.3 s, the middle part hidden, a video under the main row there
const clip = () => [section('a', 0, 5202), section('b', 5202, 14319, { hidden: true }), section('c', 14319, 30000), video('v', 5202, 14319)]
const span = (rows: SegmentLocal[]) => rows.map(r => `${r.id}:${r.start_ms}-${r.end_ms}`)

test('a video under a hidden part of the main video plays there, picture and sound', () => {
  for (const forSave of [false, true]) {
    const rows = flattenShots(clip(), MAIN, forSave, 1)
    assert.deepEqual(span(rows), ['a:0-5202', 'v:5202-14319', 'c:14319-30000'])
    const shown = shownSegment(rows[1], MAIN)
    assert.equal(shown.crop_boxes[0].source_video_id, 'other-video')
    assert.equal(shown.hidden, false)
    assert.equal(shown.crop_boxes[0].muted, false)
  }
})

test('a hidden part longer than the video under it stays black around it', () => {
  const rows = flattenShots([section('a', 0, 4000), section('b', 4000, 16000, { hidden: true }), section('c', 16000, 30000), video('v', 6000, 10000)], MAIN, false, 1)
  assert.deepEqual(span(rows), ['a:0-4000', 'b:4000-6000', 'v:6000-10000', 'b:10000-16000', 'c:16000-30000'])
  assert.ok(rows[1].hidden && rows[3].hidden)
})

test('a part shown still covers the video under it; a video above still covers the part', () => {
  const shownPart = flattenShots([section('a', 0, 5202), section('b', 5202, 14319), section('c', 14319, 30000), video('v', 5202, 14319)], MAIN, false, 1)
  assert.deepEqual(span(shownPart), ['a:0-5202', 'b:5202-14319', 'c:14319-30000'])
  const above = flattenShots(clip(), MAIN, false, 0)
  assert.deepEqual(span(above), ['a:0-5202', 'v:5202-14319', 'c:14319-30000'])
})

test('saved and opened again: the same layers', () => {
  const saved = toSaved(clip(), MAIN, 1)
  assert.ok(saved.rows.some(r => r.id === 'v'), 'the video is a part of the saved row (the export plays it)')
  const back = restoreLayers(saved.rows, saved.layers, MAIN)
  assert.deepEqual(span(back.segments).sort(), span(clip()).sort())
})
