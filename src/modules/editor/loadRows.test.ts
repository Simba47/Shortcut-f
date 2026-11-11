// A Make my clips clip's saved copy (the worker's clip_ai_made) as the editor's state: what Reset goes
// back to (user, 2026-11-09: Reset wiped the AI's work too; only the manual changes should go).
// Run: npx tsx --test src/modules/editor/loadRows.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Overlay, TextOverlay } from '@chai-cut/shared'
import { stateFromRows, type SegmentRow } from './loadRows'

const VIDEO = 'main-video'
const kf = (box: string, t: number, x: number) => ({ id: `${box}-${t}`, box_id: box, t_ms: t, x, y: 0, w: 0.3, h: 1 })
const box = (id: string, slot: number, start: number, kfs: ReturnType<typeof kf>[]) =>
  ({ id, segment_id: 's', slot_index: slot, source_video_id: null, source_offset_ms: start, image_path: null, image_motion: null, volume: null, muted: false, hidden: null, box_keyframes: kfs })
// As saved: a Vertical then a Split on a 30-second clip (60–90 s of the video), a pause cut at 65–66 s
const made = () => JSON.parse(JSON.stringify({
  segments: [
    { id: 'a', clip_id: 'c', start_ms: 0, end_ms: 10000, layout: 'vertical', sort_order: 0, video_offset_ms: null, frame: null, crop_boxes: [box('a0', 0, 0, [kf('a0', 0, 0.1), kf('a0', 8000, 0.3)])] },
    { id: 'b', clip_id: 'c', start_ms: 10000, end_ms: 30000, layout: 'split', sort_order: 1, video_offset_ms: null, frame: null, crop_boxes: [box('b0', 0, 10000, [kf('b0', 10000, 0.4)]), box('b1', 1, 10000, [kf('b1', 10000, 0.6), kf('b1', 20000, 0.7)])] },
  ],
  text_overlays: [{ id: 't', clip_id: 'c', text: 'The hook', start_ms: 0, end_ms: 3000, x: null, y: 0.15, font: 'montserrat-bold', size: 80, color: '#111111' }],
  overlays: [{ id: 'l', clip_id: 'c', type: 'image', storage_path: 'logos/a.png', source_offset_ms: 0, x: 0.8, y: 0.05, w: 0.15, h: 0.08, start_ms: 0, end_ms: 30000, z_index: 1, opacity: null }],
})) as { segments: SegmentRow[]; text_overlays: TextOverlay[]; overlays: Overlay[] }

const load = (trimRanges: unknown = [[65000, 66000]]) => {
  const m = made()
  return stateFromRows({
    rows: m.segments, layers: null, mainVideoId: VIDEO, startMs: 60000, endMs: 90000, trimRanges,
    overlays: m.overlays, textOverlays: m.text_overlays, audioTracks: [], transitions: [],
  })
}

test('the formats come back with their framing, closed up over the cut pause', () => {
  const { loaded, trims } = load()
  assert.deepEqual(trims, [[65000, 66000]])
  assert.deepEqual(loaded.segments.map(s => [s.layout, s.start_ms, s.end_ms]), [['vertical', 0, 9000], ['split', 9000, 29000]])
  assert.deepEqual(Object.values(loaded.keyframes).map(k => k.length), [2, 1, 2])
  assert.deepEqual(loaded.keyframes.a0.map(k => k.x).map(x => Math.round(x * 10) / 10), [0.1, 0.3])
})

test('the title and the logo come back, on the closed-up timeline', () => {
  const { loaded } = load()
  assert.deepEqual(loaded.textOverlays.map(t => [t.text, t.start_ms, t.end_ms, t.color]), [['The hook', 0, 3000, '#111111']])
  assert.deepEqual(loaded.overlays.map(o => [o.storage_path, o.start_ms, o.end_ms]), [['logos/a.png', 0, 29000]])
})

test('no pauses cut: every time as saved', () => {
  const { loaded, trims, lenMs } = load(null)
  assert.deepEqual(trims, [])
  assert.equal(lenMs, 30000)
  assert.deepEqual(loaded.segments.map(s => [s.start_ms, s.end_ms]), [[0, 10000], [10000, 30000]])
})

test('the copy is left as it was: Reset can run again after Undo', () => {
  const m = made()
  const before = JSON.stringify(m)
  stateFromRows({ rows: m.segments, layers: null, mainVideoId: VIDEO, startMs: 60000, endMs: 90000, trimRanges: [[65000, 66000]], overlays: m.overlays, textOverlays: m.text_overlays, audioTracks: [], transitions: [] })
  assert.equal(JSON.stringify(m), before)
})
