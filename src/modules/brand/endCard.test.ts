// A kit's end card (endCard.ts, brand kit Phase 4): the clip's last seconds made its Branded card,
// and everything that was there back when it comes off.
// Run: npm run test:brand
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BoxKeyframe, SegmentLocal, Transition } from '@chai-cut/shared'
import { DEFAULT_BRAND_KIT, type BrandKit, type BrandKitData } from '@/lib/shared/brandKit'
import { cleanBrandOn } from '@/lib/shared/brandOn'
import { makeEndCard, removeEndCard, type CardTimeline } from './endCard'
import { putBrandOn, takeBrandOff, updateBrand, type BrandTarget } from './engine'

const LEN = 30_000, MAIN = 'v-main'
const kf = (box: string, t: number, x = 0.3): BoxKeyframe => ({ id: `${box}-${t}`, box_id: box, t_ms: t, x, y: 0, w: 0.32, h: 1 })
function part(id: string, start: number, end: number, over: Partial<SegmentLocal> = {}): SegmentLocal {
  return {
    id, start_ms: start, end_ms: end, layout: 'vertical', sort_order: start / 1000,
    crop_boxes: [{ id: `${id}-b`, slot_index: 0, source_video_id: null, source_offset_ms: start, keyframes: [kf(`${id}-b`, start)] }],
    ...over,
  } as SegmentLocal
}
const tr = (after: string): Transition => ({ id: `tr-${after}`, clip_id: 'c1', after_segment_id: after, type: 'fade', duration_ms: 300 } as Transition)
function timeline(segments: SegmentLocal[], transitions: Transition[] = [], lengthMs = LEN): CardTimeline {
  return { segments, keyframes: Object.fromEntries(segments.flatMap(s => s.crop_boxes.map(b => [b.id, b.keyframes.map((k, i) => ({ ...k, id: `${b.id}-${i}`, box_id: b.id }))]))), transitions, lengthMs, mainVideoId: MAIN }
}
const made = (r: ReturnType<typeof makeEndCard>) => { if ('skip' in r) throw new Error(r.skip); return r }
const ids = (tl: CardTimeline) => [...tl.segments].sort((a, b) => a.start_ms - b.start_ms).map(s => `${s.layout === 'frame_brand_card' ? 'card' : s.id}:${s.start_ms}-${s.end_ms}`)

test('one part: cut at the card, the card carries on the main video from there, with no view set', () => {
  const tl = timeline([part('p1', 0, LEN)])
  const { timeline: next, rec } = made(makeEndCard(tl, 3))
  assert.deepEqual(ids(next), ['p1:0-27000', 'card:27000-30000'])
  const card = next.segments.find(s => s.id === rec.id)!
  assert.equal(card.crop_boxes[0].source_offset_ms, 27000)
  assert.equal(card.crop_boxes[0].source_video_id, null)
  assert.deepEqual(next.keyframes[card.crop_boxes[0].id], [])
  assert.deepEqual(rec.cut, { id: 'p1', end_ms: LEN })
  // …and off: as it was, views and all
  const back = removeEndCard(next, rec)!
  assert.deepEqual(ids(back), ['p1:0-30000'])
  assert.deepEqual(back.keyframes, tl.keyframes)
})

test('several parts: the one across the start is cut, the ones after make way — with their transitions — and all come back', () => {
  const tl = timeline([part('p1', 0, 20000), part('p2', 20000, 28500), part('p3', 28500, LEN, { layout: 'frame_title_caption' } as Partial<SegmentLocal>)],
    [tr('p1'), tr('p2')])
  const { timeline: next, rec } = made(makeEndCard(tl, 3))
  assert.deepEqual(ids(next), ['p1:0-20000', 'p2:20000-27000', 'card:27000-30000'])
  assert.deepEqual(next.transitions.map(x => x.after_segment_id), ['p1'])
  assert.equal(next.keyframes['p3-b'], undefined)
  const back = removeEndCard(next, rec)!
  assert.deepEqual(ids(back), ['p1:0-20000', 'p2:20000-28500', 'p3:28500-30000'])
  assert.deepEqual(back.transitions.map(x => x.after_segment_id).sort(), ['p1', 'p2'])
  assert.deepEqual(back.keyframes['p3-b'], tl.keyframes['p3-b'])
})

test('a stretch with no part (the default framing): the card goes there, as the clip plays it; off leaves it empty again', () => {
  const { timeline: next, rec } = made(makeEndCard(timeline([part('p1', 0, 10000)]), 4))
  assert.deepEqual(ids(next), ['p1:0-10000', 'card:26000-30000'])
  assert.equal(next.segments.find(s => s.id === rec.id)!.crop_boxes[0].source_offset_ms, 26000)
  assert.equal(rec.cut, null)
  assert.deepEqual(ids(removeEndCard(next, rec)!), ['p1:0-10000'])
})

test('a part played faster: the card plays at its speed, from where it has got to', () => {
  const { timeline: next, rec } = made(makeEndCard(timeline([part('p1', 0, LEN, { speed: 2 } as Partial<SegmentLocal>)]), 3))
  const card = next.segments.find(s => s.id === rec.id)!
  assert.equal(card.speed, 2)
  assert.equal(card.crop_boxes[0].source_offset_ms, 54000)
})

test('a video on top over the end stays on top', () => {
  const shot = part('shot', 28000, 29500)
  shot.crop_boxes[0].source_video_id = 'v-other'
  const { timeline: next } = made(makeEndCard(timeline([part('p1', 0, LEN), shot]), 3))
  assert.deepEqual(ids(next), ['p1:0-27000', 'card:27000-30000', 'shot:28000-29500'])
})

test('no card: too short, already ending on a Branded card, locked, a video put in between, two speeds', () => {
  const skip = (tl: CardTimeline, s = 3) => { const r = makeEndCard(tl, s); return 'skip' in r ? r.skip : null }
  assert.match(skip(timeline([part('p1', 0, 3500)], [], 3500))!, /too short/)
  assert.match(skip(timeline([part('p1', 0, 25000), part('c', 25000, LEN, { layout: 'frame_brand_card' } as Partial<SegmentLocal>)]))!, /already ends/)
  assert.match(skip(timeline([part('p1', 0, LEN, { locked: true } as Partial<SegmentLocal>)]))!, /locked/)
  const ins = part('ins', 26000, LEN, { video_offset_ms: 26000 } as Partial<SegmentLocal>)
  ins.crop_boxes[0].source_video_id = 'v-other'
  assert.match(skip(timeline([part('p1', 0, 26000), ins]))!, /put in between/)
  assert.match(skip(timeline([part('p1', 0, 28000), part('p2', 28000, LEN, { speed: 2 } as Partial<SegmentLocal>)]))!, /more than one speed/)
})

test('off: a card the user changed stays theirs; one they took out leaves the clip as it is', () => {
  const { timeline: next, rec } = made(makeEndCard(timeline([part('p1', 0, LEN)]), 3))
  const changed = { ...next, segments: next.segments.map(s => (s.id === rec.id ? { ...s, layout: 'split' as const } : s)) }
  assert.equal(removeEndCard(changed, rec), null)
  const gone = { ...next, segments: next.segments.filter(s => s.id !== rec.id) }
  assert.equal(removeEndCard(gone, rec), gone)
  // (the clip's end moved since: what was there can't come back as it was — the card becomes a plain part)
  const shorter = { ...next, segments: next.segments.map(s => (s.id === rec.id ? { ...s, end_ms: 29000 } : s)) }
  assert.deepEqual(ids(removeEndCard(shorter, rec)!), ['p1:0-27000', `${rec.id}:27000-29000`])
})

test('a card made before Phase 4 (just its id kept) becomes a plain part when the brand comes off', () => {
  const b = cleanBrandOn({ kit_id: '00000000-0000-0000-0000-000000000001', before: { end_card: '00000000-0000-0000-0000-0000000000cc' } })!
  const tl = timeline([part('p1', 0, 27000), part('00000000-0000-0000-0000-0000000000cc', 27000, LEN, { layout: 'frame_brand_card' } as Partial<SegmentLocal>)])
  const back = removeEndCard(tl, b.before!.end_card!)!
  assert.equal(back.segments.find(s => s.id.endsWith('cc'))!.layout, 'vertical')
})

// ── Through the brand engine ──────────────────────────────────────────────────

function kit(over: Partial<BrandKitData> = {}): BrandKit {
  const data: BrandKitData = { ...DEFAULT_BRAND_KIT, colors: { main: '#112233', accent: '#ff5500', extra: [] }, handle: 'chai', card_title: 'Chai Co', ...over }
  return { id: 'k1', name: 'Kit', data, logo_url: null }
}
const CARD_ON = { ...DEFAULT_BRAND_KIT.ends, card: true, seconds: 3 }
function clip(over: Partial<BrandTarget> = {}): BrandTarget {
  const tl = timeline([part('p1', 0, LEN)])
  return {
    clipId: 'c1', lengthMs: LEN, mainVideoId: MAIN, overlays: [], texts: [], caption: {}, textCase: 'title',
    segments: tl.segments, keyframes: tl.keyframes, transitions: [], timelineEdits: true, audioTracks: [], canInsert: true, ...over,
  }
}
const cardOf = (t: BrandTarget) => t.segments.find(s => s.layout === 'frame_brand_card')

test('on: the end card made and branded — the kit\'s card look, title and @handle; off: the clip as it was', () => {
  const k = kit({ ends: CARD_ON })
  const on = putBrandOn(clip(), k)
  const card = cardOf(on.target)!
  assert.deepEqual([card.start_ms, card.end_ms], [27000, LEN])
  assert.deepEqual(card.frame!.items!.filter(it => it.kind === 'text').map(it => it.text), ['Chai Co', '@chai'])
  assert.equal(on.before.end_card!.id, card.id)
  assert.ok(on.before.frames[card.id])
  assert.equal(on.applied.ends.card, true)
  const off = takeBrandOff(on.target, k.data, on.before)
  assert.equal(cardOf(off), undefined)
  assert.deepEqual(off.segments.map(s => [s.id, s.end_ms]), [['p1', LEN]])
})

test('the server with a video on top: no end card yet, and the clip keeps the kit as having none — the editor makes it', () => {
  const on = putBrandOn(clip({ timelineEdits: false }), kit({ ends: CARD_ON }))
  assert.equal(cardOf(on.target), undefined)
  assert.equal(on.applied.ends.card, false)
  // (opened in the editor: the kit "changed" — the card goes on)
  const later = updateBrand({ ...on.target, timelineEdits: true }, on.applied, kit({ ends: CARD_ON }), on.before)
  assert.ok(cardOf(later.target))
  assert.ok(later.before!.end_card)
})

test('with ends off (their step is gone, 2026-11-10): none made from a saved kit; one already on the clip stays until the brand comes off', () => {
  const k = kit({ ends: CARD_ON })
  const off = { ends: false } as Partial<BrandTarget>
  const put = putBrandOn(clip(off), k)
  assert.equal(cardOf(put.target), undefined)
  assert.equal(put.before.end_card, null)
  // (the version the clip took is the kit's, so nothing keeps asking for a card)
  assert.deepEqual(put.applied.ends, k.data.ends)
  // a clip that already has one: a change to the kit doesn't take it away
  const had = putBrandOn(clip(), k)
  const none = kit({ ends: { ...CARD_ON, card: false } })
  assert.ok(cardOf(updateBrand({ ...had.target, ...off }, k.data, none, had.before).target))
  // the brand switched off: it goes, as before
  assert.equal(cardOf(takeBrandOff({ ...had.target, ...off }, k.data, had.before)), undefined)
})

test('live: switched on later it goes on; a new length makes it again; switched off it comes off; one taken out stays out', () => {
  const k0 = kit(), on = putBrandOn(clip(), k0)
  const k1 = kit({ ends: CARD_ON })
  const a = updateBrand(on.target, k0.data, k1, on.before)
  assert.deepEqual([cardOf(a.target)!.start_ms], [27000])
  const k2 = kit({ ends: { ...CARD_ON, seconds: 5 } })
  const b = updateBrand(a.target, k1.data, k2, a.before)
  assert.deepEqual([cardOf(b.target)!.start_ms, b.target.segments.length], [25000, 2])
  const c = updateBrand(b.target, k2.data, kit(), b.before)
  assert.equal(cardOf(c.target), undefined)
  assert.deepEqual(c.target.segments.map(s => [s.id, s.end_ms]), [['p1', LEN]])
  assert.equal(c.before!.end_card, null)
  // (the user took the card out: a change to the kit doesn't put it back)
  const out = { ...a.target, segments: a.target.segments.filter(s => s.layout !== 'frame_brand_card') }
  const d = updateBrand(out, k1.data, kit({ ends: CARD_ON, colors: { main: '#000000', accent: '#ffffff', extra: [] } }), a.before)
  assert.equal(cardOf(d.target), undefined)
})

test('a clip too short for it: a note says why, nothing changes', () => {
  const short = timeline([part('p1', 0, 3000)], [], 3000)
  const on = putBrandOn(clip({ lengthMs: 3000, segments: short.segments, keyframes: short.keyframes }), kit({ ends: CARD_ON }))
  assert.match(on.note!, /too short/)
  assert.equal(on.before.end_card, null)
})
