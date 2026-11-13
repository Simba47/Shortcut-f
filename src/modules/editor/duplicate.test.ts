// Duplicate (duplicate.ts). Run: npx tsx --test src/modules/editor/duplicate.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FrameItem, FrameSettings, SegmentLocal } from '@chai-cut/shared'
import { copySpots, frameCopySpot, copyFrameItem, copyShot, type CopyItem } from './duplicate'

const v = (id: string, start_ms: number, end_ms: number, track = 0): CopyItem => ({ id, start_ms, end_ms, track, family: 'visual' })
const a = (id: string, start_ms: number, end_ms: number, track = 0): CopyItem => ({ id, start_ms, end_ms, track, family: 'audio' })

test('one thing: the copy goes right after it on the same row', () => {
  const t = v('t', 5000, 8000)
  assert.deepEqual(copySpots([t], [t], 60000), [{ id: 't', start_ms: 8000, end_ms: 11000, track: 0 }])
})

test('something right after it: the same time on the next row up with room', () => {
  const t = v('t', 5000, 8000), next = v('n', 9000, 12000), above = v('x', 4000, 6000, 1)
  assert.deepEqual(copySpots([t], [t, next, above], 60000), [{ id: 't', start_ms: 5000, end_ms: 8000, track: 2 }])
})

test('near the end of the clip: cut short to fit; under 0.2 s left: the same time a row up', () => {
  const t = v('t', 5000, 8000)
  assert.deepEqual(copySpots([t], [t], 9500), [{ id: 't', start_ms: 8000, end_ms: 9500, track: 0 }])
  assert.deepEqual(copySpots([t], [t], 8100), [{ id: 't', start_ms: 5000, end_ms: 8000, track: 1 }])
})

test('several picked: copied together after the whole stretch, keeping their places', () => {
  const p = v('p', 1000, 3000), t = v('t', 2000, 5000, 1), m = a('m', 0, 4000)
  assert.deepEqual(copySpots([p, t, m], [p, t, m], 60000), [
    { id: 'p', start_ms: 6000, end_ms: 8000, track: 0 },
    { id: 't', start_ms: 7000, end_ms: 10000, track: 1 },
    { id: 'm', start_ms: 5000, end_ms: 9000, track: 0 },
  ])
})

test('several picked with something in the way: same times, visual and audio rows each lifted the fewest', () => {
  const p = v('p', 1000, 3000), t = v('t', 2000, 5000, 1), m = a('m', 0, 4000), block = v('b', 6000, 7000, 0)
  const top = v('top', 2500, 2600, 2)
  assert.deepEqual(copySpots([p, t, m], [p, t, m, block, top], 60000), [
    { id: 'p', start_ms: 1000, end_ms: 3000, track: 1 + 2 },
    { id: 't', start_ms: 2000, end_ms: 5000, track: 1 + 3 },
    { id: 'm', start_ms: 0, end_ms: 4000, track: 1 },
  ])
})

test('music rows are apart from the visual rows', () => {
  const m = a('m', 0, 4000), photo = v('p', 4000, 9000, 0)
  assert.deepEqual(copySpots([m], [m, photo], 60000), [{ id: 'm', start_ms: 4000, end_ms: 8000, track: 0 }])
})

const seg = { start_ms: 10000, end_ms: 20000 }
const item = (id: string, start_ms: number, end_ms: number, extra: Partial<FrameItem> = {}): FrameItem => ({ id, lane: 0, kind: 'photo', start_ms, end_ms, ...extra })
const frame = (items: FrameItem[]) => ({ items } as unknown as FrameSettings)

test('in a frame: right after it in its lane, cut short by the next item or the frame end; no room → null', () => {
  const one = item('a', 10000, 12000)
  assert.deepEqual(frameCopySpot(frame([one]), one, seg), { start_ms: 12000, end_ms: 14000 })
  assert.deepEqual(frameCopySpot(frame([one, item('b', 13000, 20000)]), one, seg), { start_ms: 12000, end_ms: 13000 })
  // another lane doesn't count
  assert.deepEqual(frameCopySpot(frame([one, { ...item('c', 12000, 20000), lane: 1 }]), one, seg), { start_ms: 12000, end_ms: 14000 })
  const full = item('f', 10000, 20000)
  assert.equal(frameCopySpot(frame([full]), full, seg), null)
  const tail = item('t', 15000, 19900)
  assert.equal(frameCopySpot(frame([tail]), tail, seg), null)
})

test('a copied frame item: new id, never goes back to a row, its freezes kept to its length', () => {
  const vid = item('v', 10000, 14000, { kind: 'video', source_offset_ms: 500, from_row: { track: 1 } as never, holds: [{ at_ms: 500, len_ms: 500 }, { at_ms: 2500, len_ms: 1000 }] })
  const c = copyFrameItem(vid, { start_ms: 14000, end_ms: 16000 }, 'new')
  assert.equal(c.id, 'new'); assert.equal(c.from_row, null); assert.equal(c.source_offset_ms, 500)
  assert.deepEqual([c.start_ms, c.end_ms], [14000, 16000])
  assert.ok((c.holds ?? []).every(h => h.at_ms + h.len_ms <= 2000))
})

test('a copied video on a row: new ids, its views moved with it, the original untouched', () => {
  let n = 0
  const id = () => `id${++n}`
  const shot = { id: 's', start_ms: 1000, end_ms: 4000, layout: 'vertical', sort_order: 0, track: 0,
    crop_boxes: [{ id: 'b', slot_index: 0, source_video_id: 'vid', source_offset_ms: 700, keyframes: [{ t_ms: 1000, x: 0, y: 0, w: 1, h: 1 }] }] } as unknown as SegmentLocal
  const kfs = { b: [{ id: 'k', box_id: 'b', t_ms: 2000, x: 0.1, y: 0, w: 0.5, h: 1 }] } as never
  const out = copyShot(shot, kfs, { id: 's', start_ms: 4000, end_ms: 7000, track: 1 }, id)
  const box = out.segment.crop_boxes[0]
  assert.notEqual(out.segment.id, 's'); assert.notEqual(box.id, 'b')
  assert.deepEqual([out.segment.start_ms, out.segment.end_ms, out.segment.track], [4000, 7000, 1])
  assert.equal(box.source_offset_ms, 700)
  assert.equal(box.keyframes[0].t_ms, 4000)
  assert.equal(out.keyframes[box.id][0].t_ms, 5000)
  assert.equal(out.keyframes[box.id][0].box_id, box.id)
  assert.equal(shot.crop_boxes[0].keyframes[0].t_ms, 1000)
})

// ── Parts of the main row played again ──
import { duplicateParts } from './duplicate'
import { piecesOf, wordPlaces } from './inserts'
import type { TimedState } from './trimState'

const MAIN = 'main'
const part = (id: string, start_ms: number, end_ms: number, from: number, extra: Partial<SegmentLocal> = {}) => ({
  id, start_ms, end_ms, layout: 'vertical', sort_order: 0,
  crop_boxes: [{ id: `${id}-box`, slot_index: 0, source_video_id: null, source_offset_ms: from, keyframes: [{ t_ms: start_ms, x: 0, y: 0, w: 1, h: 1 }] }],
  ...extra,
}) as unknown as SegmentLocal
const isPart = (s: SegmentLocal) => !s.crop_boxes.some(b => b.source_video_id) || s.video_offset_ms != null
function clipState(): TimedState {
  return {
    segments: [part('A', 0, 5000, 0), part('B', 5000, 10000, 5000)],
    keyframes: { 'A-box': [{ id: 'k1', box_id: 'A-box', t_ms: 1000, x: 0.2, y: 0, w: 0.5, h: 1 }] } as never,
    overlays: [],
    textOverlays: [{ id: 'T', clip_id: 'c', text: 'hi', start_ms: 7000, end_ms: 9000 } as never, { id: 'X', clip_id: 'c', text: 'across', start_ms: 3000, end_ms: 6000 } as never],
    audioTracks: [{ id: 'S', clip_id: 'c', storage_path: 'main-video:main', start_ms: 0, end_ms: 10000, offset_ms: 0 } as never],
    transitions: [{ id: 'tr', clip_id: 'c', after_segment_id: 'A', type: 'fade', duration_ms: 300 } as never],
  }
}
let n = 0
const nid = () => `n${++n}`

test('a part of the main video duplicated: the copy plays the same moment right after it, the rest moves later', () => {
  const out = duplicateParts(clipState(), ['A'], isPart, nid)!
  const segs = out.state.segments
  const copy = segs.find(s => s.id === out.copies[0])!
  assert.deepEqual([copy.start_ms, copy.end_ms, copy.crop_boxes[0].source_offset_ms], [5000, 10000, 0])
  assert.deepEqual(segs.map(s => [s.start_ms, s.end_ms]), [[0, 5000], [5000, 10000], [10000, 15000]])
  assert.equal(segs.find(s => s.id === 'B')!.start_ms, 10000)
  // its views moved with it, on a box of its own
  assert.notEqual(copy.crop_boxes[0].id, 'A-box')
  assert.equal(out.state.keyframes[copy.crop_boxes[0].id][0].t_ms, 6000)
  assert.equal(out.state.keyframes['A-box'][0].t_ms, 1000)
  // text after it moves later; text across its end gets longer
  assert.deepEqual(out.state.textOverlays.map(t => [t.id, t.start_ms, t.end_ms]), [['T', 12000, 14000], ['X', 3000, 11000]])
  // the transition into what came next comes after the copy
  assert.deepEqual(out.state.transitions.map(t => t.after_segment_id), [copy.id])
  // the detached sound is said again under the copy: 0–5 s of the video at 5–10 s
  const again = out.state.audioTracks.filter(t => t.start_ms === 5000)
  assert.equal(again.length, 1); assert.equal(again[0].end_ms, 10000); assert.equal(again[0].offset_ms, 0)
  // and the clip's pieces play 0–5 s twice, then 5–10 s
  const pieces = piecesOf(segs, MAIN, () => false)
  assert.deepEqual(pieces.map(p => [p.at, p.ms, p.from]), [[0, 5000, 0], [5000, 5000, 0], [10000, 5000, 5000]])
})

test('several parts duplicated: one block after the last, in their order; transitions between them copied', () => {
  const st = clipState()
  st.transitions.push({ id: 'tr2', clip_id: 'c', after_segment_id: 'B', type: 'fade', duration_ms: 300 } as never)
  const out = duplicateParts(st, ['B', 'A'], isPart, nid)!
  assert.equal(out.at, 10000); assert.equal(out.len, 10000)
  const [ca, cb] = out.copies.map(id => out.state.segments.find(s => s.id === id)!)
  assert.deepEqual([ca.start_ms, ca.end_ms, ca.crop_boxes[0].source_offset_ms], [10000, 15000, 0])
  assert.deepEqual([cb.start_ms, cb.end_ms, cb.crop_boxes[0].source_offset_ms], [15000, 20000, 5000])
  const after = out.state.transitions.map(t => t.after_segment_id).sort()
  assert.deepEqual(after, ['A', ca.id, cb.id].sort())
})

test('a video put in between, duplicated, holds the main video at the same moment', () => {
  const st = clipState()
  st.segments = [part('A', 0, 5000, 0), { ...part('I', 5000, 8000, 0), crop_boxes: [{ id: 'I-box', slot_index: 0, source_video_id: 'other', source_offset_ms: 0, keyframes: [] }], video_offset_ms: 5000 } as never, part('B', 8000, 13000, 5000)]
  const out = duplicateParts(st, ['I'], isPart, nid)!
  const copy = out.state.segments.find(s => s.id === out.copies[0])!
  assert.deepEqual([copy.start_ms, copy.end_ms, copy.video_offset_ms, copy.crop_boxes[0].source_video_id], [8000, 11000, 5000, 'other'])
  assert.equal(out.state.segments.find(s => s.id === 'B')!.start_ms, 11000)
})

test('a frame duplicated: its own items come with it, with ids of their own', () => {
  const st = clipState()
  st.segments[0] = { ...st.segments[0], layout: 'frame_single', frame: { items: [{ id: 'it', lane: 'band', kind: 'text', text: 'Title', start_ms: 0, end_ms: 5000 }] } } as never
  const out = duplicateParts(st, ['A'], isPart, nid)!
  const copy = out.state.segments.find(s => s.id === out.copies[0])!
  const it = copy.frame!.items![0]
  assert.notEqual(it.id, 'it'); assert.deepEqual([it.start_ms, it.end_ms, it.text], [5000, 10000, 'Title'])
  assert.equal(out.state.segments.find(s => s.id === 'A')!.frame!.items![0].start_ms, 0)
})

test('not a part of the main row: nothing', () => {
  assert.equal(duplicateParts(clipState(), ['T'], isPart, nid), null)
})

test('words: said again in a duplicated part; a word at its end does not run on over the copy', () => {
  const pieces = [{ id: 'A', at: 0, ms: 5000, from: 0 }, { id: 'c', at: 5000, ms: 5000, from: 0 }, { id: 'B', at: 10000, ms: 5000, from: 5000 }]
  assert.deepEqual(wordPlaces(pieces, 1000, 1400), [[1000, 1400], [6000, 6400]])
  // a word across the part's end (4.8–5.3 s of the video): at the end of the part, not over the copy
  assert.deepEqual(wordPlaces(pieces, 4800, 5300), [[4800, 5300]])
  // nothing duplicated: as before
  const plain = [{ id: 'A', at: 0, ms: 5000, from: 0 }, { id: 'B', at: 5000, ms: 5000, from: 5000 }]
  assert.deepEqual(wordPlaces(plain, 4800, 5300), [[4800, 5300]])
  // a moment cut out in between: as before (its end where that moment is heard after the cut)
  const cut = [{ id: 'A', at: 0, ms: 5000, from: 0 }, { id: 'B', at: 5000, ms: 5000, from: 7000 }]
  assert.deepEqual(wordPlaces(cut, 4800, 7300), [[4800, 5300]])
})

import { repeatedVideoMs } from './duplicate'
test('time the main video plays more than once: what a duplicated part adds to the clip', () => {
  // A 0–5 s, its copy (0–5 s again), B 5–20 s, C 20–30 s → 5 s repeated
  assert.equal(repeatedVideoMs([{ from: 0, ms: 5000 }, { from: 0, ms: 5000 }, { from: 5000, ms: 15000 }, { from: 20000, ms: 10000 }]), 5000)
  // parts in order, or moved about, or with video cut out between them: nothing repeated
  assert.equal(repeatedVideoMs([{ from: 0, ms: 5000 }, { from: 5000, ms: 25000 }]), 0)
  assert.equal(repeatedVideoMs([{ from: 20000, ms: 10000 }, { from: 0, ms: 20000 }]), 0)
  assert.equal(repeatedVideoMs([{ from: 0, ms: 5000 }, { from: 9000, ms: 5000 }]), 0)
  // overlapping by part
  assert.equal(repeatedVideoMs([{ from: 0, ms: 10000 }, { from: 8000, ms: 4000 }]), 2000)
})

// ── Paste ──
import { pasteSpots, copyPartsOf, placeParts } from './duplicate'

test('paste: the earliest at the playhead, the rest in their places, on their own rows', () => {
  const p = v('p', 1000, 3000), t = v('t', 2000, 5000, 1), m = a('m', 0, 4000)
  assert.deepEqual(pasteSpots([p, t, m], [], 20000, 60000), [
    { id: 'p', start_ms: 21000, end_ms: 23000, track: 0 },
    { id: 't', start_ms: 22000, end_ms: 25000, track: 1 },
    { id: 'm', start_ms: 20000, end_ms: 24000, track: 0 },
  ])
})

test('paste: something in the way → the same times, rows up; near the end → cut short, a thing with nothing left is left out', () => {
  const t = v('t', 1000, 4000), there = v('x', 21000, 22000)
  assert.deepEqual(pasteSpots([t], [there], 20000, 60000), [{ id: 't', start_ms: 20000, end_ms: 23000, track: 1 }])
  assert.deepEqual(pasteSpots([t], [], 58000, 60000), [{ id: 't', start_ms: 58000, end_ms: 60000, track: 0 }])
  const late = v('l', 5000, 6000)
  assert.deepEqual(pasteSpots([t, late], [], 59000, 60000), [{ id: 't', start_ms: 59000, end_ms: 60000, track: 0 }])
})

test('paste a part in the middle of another: that part is cut in two there, the copy goes between', () => {
  const st = clipState()
  const parts = copyPartsOf(st, ['A'], isPart)
  const out = placeParts(st, parts, 8000, { same: true }, nid)
  const segs = out.state.segments
  assert.deepEqual(segs.map(s => [s.start_ms, s.end_ms, s.crop_boxes[0].source_offset_ms]), [
    [0, 5000, 0], [5000, 8000, 5000], [8000, 13000, 0], [13000, 15000, 8000],
  ])
  assert.equal(out.len, 5000)
})

test('paste a part of another video: a video put in between, playing that stretch of it full frame', () => {
  const st = clipState()
  const parts = copyPartsOf(st, ['B'], isPart)   // B plays 5–10 s of its clip
  const target = clipState()
  const out = placeParts(target, parts, 5000, { same: false, video: 'other', clipStart: 60000, hold: 5000 }, nid)
  const ins = out.state.segments.find(s => s.id === out.copies[0])!
  assert.deepEqual([ins.start_ms, ins.end_ms, ins.video_offset_ms, ins.layout], [5000, 10000, 5000, 'vertical'])
  assert.deepEqual([ins.crop_boxes[0].source_video_id, ins.crop_boxes[0].source_offset_ms], ['other', 65000])
  // (no frame items, no detached sound of the other video)
  assert.equal(out.state.audioTracks.filter(t => t.start_ms === 5000).length, 0)
  assert.equal(out.state.segments.find(s => s.id === 'B')!.start_ms, 10000)
})

test('paste a video put in between elsewhere: it waits at the main video\'s moment there', () => {
  const st = clipState()
  st.segments = [part('A', 0, 5000, 0), { ...part('I', 5000, 8000, 0), crop_boxes: [{ id: 'I-box', slot_index: 0, source_video_id: 'other', source_offset_ms: 0, keyframes: [] }], video_offset_ms: 5000 } as never, part('B', 8000, 13000, 5000)]
  const parts = copyPartsOf(st, ['I'], isPart)
  const out = placeParts(st, parts, 10000, { same: true, hold: 7000 }, nid)
  const copy = out.state.segments.find(s => s.id === out.copies[0])!
  assert.deepEqual([copy.start_ms, copy.end_ms, copy.video_offset_ms], [10000, 13000, 7000])
})
