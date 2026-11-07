// A kit's intro and outro (bookends.ts, brand kit Phase 4): videos of the library put in before and
// after the clip through the brand engine, and taken out again.
// Run: npm run test:brand
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Overlay, SegmentLocal, TextOverlay } from '@chai-cut/shared'
import { DEFAULT_BRAND_KIT, type BrandEnds, type BrandKit, type BrandKitData } from '@/lib/shared/brandKit'
import { brandNewFrames, putBrandOn, takeBrandOff, updateBrand, type BrandTarget } from './engine'

const LEN = 30_000, MAIN = 'v-main'
const INTRO = { id: '00000000-0000-0000-0000-00000000000a', ms: 5000, title: 'Intro' }
const OUTRO = { id: '00000000-0000-0000-0000-00000000000b', ms: 4000, title: 'Outro' }
const OTHER = { id: '00000000-0000-0000-0000-00000000000c', ms: 2000, title: 'Other' }

function kit(ends: Partial<BrandEnds> = {}, over: Partial<BrandKitData> = {}): BrandKit {
  const data: BrandKitData = {
    ...DEFAULT_BRAND_KIT, colors: { main: '#112233', accent: '#ff5500', extra: [] },
    logo: { ...DEFAULT_BRAND_KIT.logo, path: 'brand/u1/a.png', ratio: 1 },
    ends: { ...DEFAULT_BRAND_KIT.ends, ...ends }, ...over,
  }
  return { id: 'k1', name: 'Kit', data, logo_url: null }
}
function clip(over: Partial<BrandTarget> = {}): BrandTarget {
  const p1: SegmentLocal = {
    id: 'p1', start_ms: 0, end_ms: LEN, layout: 'vertical', sort_order: 0,
    crop_boxes: [{ id: 'p1-b', slot_index: 0, source_video_id: null, source_offset_ms: 0, keyframes: [{ t_ms: 0, x: 0.3, y: 0, w: 0.32, h: 1 }] }],
  }
  const text = { id: 't1', clip_id: 'c1', text: 'Hi', start_ms: 0, end_ms: 3000, x: 0.5, y: 0.2, font: 'Inter', color: '#ffffff', size: 40 } as TextOverlay
  return {
    clipId: 'c1', lengthMs: LEN, mainVideoId: MAIN, overlays: [], texts: [text], caption: {}, textCase: 'title',
    segments: [p1], keyframes: { 'p1-b': [{ id: 'k1', box_id: 'p1-b', t_ms: 0, x: 0.3, y: 0, w: 0.32, h: 1 }] }, transitions: [],
    timelineEdits: true, audioTracks: [], canInsert: true, ...over,
  }
}
const row = (t: BrandTarget) => [...t.segments].sort((a, b) => a.start_ms - b.start_ms).map(s =>
  `${s.crop_boxes[0]?.source_video_id === INTRO.id ? 'intro' : s.crop_boxes[0]?.source_video_id === OUTRO.id ? 'outro' : s.crop_boxes[0]?.source_video_id === OTHER.id ? 'other' : s.layout === 'frame_brand_card' ? 'card' : s.id}:${s.start_ms}-${s.end_ms}`)
const logo = (t: BrandTarget) => t.overlays.find(o => o.storage_path?.startsWith('brand/')) as Overlay

test('intro: in before the clip, the main video waiting; what was on the clip moves along, the logo over the clip itself', () => {
  const on = putBrandOn(clip(), kit({ intro: INTRO }))
  assert.deepEqual(row(on.target), ['intro:0-5000', 'p1:5000-35000'])
  const intro = on.target.segments.find(s => s.crop_boxes[0]?.source_video_id === INTRO.id)!
  assert.equal(intro.video_offset_ms, 0)
  assert.equal(on.target.lengthMs, 35000)
  assert.deepEqual([on.target.texts[0].start_ms, on.target.texts[0].end_ms], [5000, 8000])
  assert.deepEqual([logo(on.target).start_ms, logo(on.target).end_ms], [5000, 35000])
  assert.equal(on.target.keyframes['p1-b'][0].t_ms, 5000)
  assert.equal(on.before.intro!.video, INTRO.id)
  // (the logo, over the clip's own part, isn't stretched over the intro while editing)
  assert.equal(brandNewFrames(on.target, kit({ intro: INTRO }), on.before), null)
})

test('outro: in after the clip, the main video held at its end; with an end card, the card comes before it', () => {
  const on = putBrandOn(clip(), kit({ outro: OUTRO }))
  assert.deepEqual(row(on.target), ['p1:0-30000', 'outro:30000-34000'])
  assert.equal(on.target.segments.find(s => s.crop_boxes[0]?.source_video_id === OUTRO.id)!.video_offset_ms, LEN)
  assert.deepEqual([logo(on.target).start_ms, logo(on.target).end_ms], [0, 30000])
  const all = putBrandOn(clip(), kit({ intro: INTRO, outro: OUTRO, card: true, seconds: 3 }))
  assert.deepEqual(row(all.target), ['intro:0-5000', 'p1:5000-32000', 'card:32000-35000', 'outro:35000-39000'])
})

test('off: the intro, outro and end card come out and the clip is as it was', () => {
  const k = kit({ intro: INTRO, outro: OUTRO, card: true, seconds: 3 })
  const on = putBrandOn(clip(), k)
  const off = takeBrandOff(on.target, k.data, on.before)
  assert.deepEqual(row(off), ['p1:0-30000'])
  assert.equal(off.lengthMs, LEN)
  assert.deepEqual([off.texts[0].start_ms, off.texts[0].end_ms], [0, 3000])
  assert.equal(off.keyframes['p1-b'][0].t_ms, 0)
})

test('live: another intro swaps in; an outro switched off comes out; one the user took out stays out until the kit picks another', () => {
  const k1 = kit({ intro: INTRO, outro: OUTRO }), on = putBrandOn(clip(), k1)
  const k2 = kit({ intro: OTHER, outro: null })
  const a = updateBrand(on.target, k1.data, k2, on.before)
  assert.deepEqual(row(a.target), ['other:0-2000', 'p1:2000-32000'])
  assert.equal(a.before!.outro, null)
  // (the user took the intro out: a colour change doesn't bring it back…)
  const out = { ...a.target, segments: a.target.segments.filter(s => s.crop_boxes[0]?.source_video_id !== OTHER.id) }
  const b = updateBrand(out, k2.data, kit({ intro: OTHER, outro: null }, { colors: { main: '#000000', accent: '#ffffff', extra: [] } }), a.before)
  assert.deepEqual(row(b.target).filter(r => r.startsWith('other') || r.startsWith('intro')), [])
  // (…a new intro does)
  const c = updateBrand(b.target, k2.data, kit({ intro: INTRO }), b.before)
  assert.ok(row(c.target).some(r => r.startsWith('intro:0-5000')))
})

test('where it can\'t go in here (the server, a clip with removed parts): nothing changes, and the kit is kept as having none', () => {
  const on = putBrandOn(clip({ canInsert: false }), kit({ intro: INTRO }))
  assert.deepEqual(row(on.target), ['p1:0-30000'])
  assert.equal(on.applied.ends.intro, null)
  // (opened in the editor: it goes in)
  const later = updateBrand({ ...on.target, canInsert: true }, on.applied, kit({ intro: INTRO }), on.before)
  assert.deepEqual(row(later.target), ['intro:0-5000', 'p1:5000-35000'])
})

test('too long with it: a note, and the clip as it was', () => {
  const on = putBrandOn(clip({ lengthMs: 299_000, segments: [] }), kit({ intro: INTRO }))
  assert.match(on.note!, /longer than a clip can be/)
  assert.equal(on.target.segments.length, 0)
})
