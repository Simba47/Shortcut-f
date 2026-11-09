// The brand engine (engine.ts): a kit going on a clip, coming off, and the clip following the kit
// live when it changes — always leaving the user's own changes as they are.
// Run: npm run test:brand
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SegmentLocal, TextOverlay } from '@chai-cut/shared'
import { DEFAULT_BRAND_KIT, logoBox, type BrandKit, type BrandKitData } from '@/lib/shared/brandKit'
import { putBrandOn, takeBrandOff, updateBrand, brandNewFrames, brandChanged, type BrandTarget } from './engine'

const LEN = 30_000
function kit(over: Partial<BrandKitData> = {}): BrandKit {
  const data: BrandKitData = {
    ...DEFAULT_BRAND_KIT,
    colors: { main: '#112233', accent: '#ff5500', extra: [] },
    logo: { ...DEFAULT_BRAND_KIT.logo, path: 'brand/u1/a.png', ratio: 1, corner: 'tr', size: 0.2, opacity: 1, show: 'all' },
    title: { font: 'Poppins', color: '#ffcc00', size: 80 },
    captions: { ...DEFAULT_BRAND_KIT.captions, on: true, template: 'bold', color: '#ffffff', highlight_color: '#ff5500', size: 60 },
    ...over,
  }
  return { id: 'k1', name: 'Kit', data, logo_url: 'https://cdn/logo-a.png' }
}
const text = (id: string, over: Partial<TextOverlay> = {}): TextOverlay =>
  ({ id, clip_id: 'c1', text: 'Big sale', start_ms: 0, end_ms: 3000, x: 0.5, y: 0.2, font: 'Inter', color: '#ffffff', size: 40, ...over }) as TextOverlay
const frame = (id: string): SegmentLocal => ({
  id, start_ms: 0, end_ms: 5000, layout: 'frame_title_caption', sort_order: 0, crop_boxes: [],
  frame: { band: { text: '', bg: '#000000', color: '#ffffff', size: 64, font: null }, items: [{ id: `${id}-t`, lane: 'band', kind: 'text', start_ms: 0, end_ms: 5000, text: 'Title', color: '#ffffff', bg: '#000000' }] },
} as SegmentLocal)
function clip(over: Partial<BrandTarget> = {}): BrandTarget {
  return {
    clipId: 'c1', lengthMs: LEN, mainVideoId: 'v1', overlays: [], texts: [text('t1'), text('t2')],
    caption: { template: 'plain', color: '#eeeeee', size: 52, animation: 'karaoke' }, textCase: 'title', segments: [frame('f1')], keyframes: {}, transitions: [], timelineEdits: true, audioTracks: [], canInsert: true, ...over,
  }
}
/** The kit changed: the clip as it follows (the record of what the brand changed left aside) */
const upd = (t: BrandTarget, old: BrandKitData, k: BrandKit) => updateBrand(t, old, k, null).target
const logoOf = (t: BrandTarget) => t.overlays.find(o => o.storage_path?.startsWith('brand/'))

test('on: logo in its corner, title style on text, caption look, frame colours', () => {
  const { target: t } = putBrandOn(clip(), kit())
  const logo = logoOf(t)!
  assert.equal(logo.storage_path, 'brand/u1/a.png')
  assert.deepEqual({ x: logo.x, y: logo.y, w: logo.w, h: logo.h }, logoBox(kit().data.logo))
  assert.deepEqual([logo.start_ms, logo.end_ms], [0, LEN])
  assert.deepEqual(t.texts.map(x => [x.font, x.color, x.size]), [['Poppins', '#ffcc00', 80], ['Poppins', '#ffcc00', 80]])
  assert.equal(t.caption.template, 'bold')
  assert.equal(t.segments[0].frame!.band!.bg, '#112233')
  assert.equal(t.segments[0].frame!.items![0].color, '#ffcc00')
})

test('a clip with no caption style yet: its capitals are kept as off, never empty, and come back off', () => {
  // (user, 2026-11-04: the kit taken off such a clip put its capitals back empty; the database takes
  // no empty value there, so every save of the clip failed — "Connection lost" with the internet fine)
  const on = putBrandOn(clip({ caption: {} }), kit())
  assert.equal(on.before.caption!.uppercase, false)
  assert.equal(on.before.caption!.template, null)
  const off = takeBrandOff(on.target, kit().data, on.before)
  assert.equal(off.caption.uppercase, false)
  // a look kept before the fix, its capitals empty: off as it comes back
  const old = { ...on.before, caption: { ...on.before.caption!, uppercase: null as unknown as boolean } }
  assert.equal(takeBrandOff(on.target, kit().data, old).caption.uppercase, false)
})

const TELUGU = 'పెద్ద సేల్'

test('text in Telugu letters keeps its own font: a kit font has none of those letters', () => {
  const on = putBrandOn(clip({ texts: [text('t1', { text: TELUGU, font: 'noto-sans-telugu' }), text('t2')] }), kit())
  assert.deepEqual([on.target.texts[0].font, on.target.texts[0].color, on.target.texts[0].size], ['noto-sans-telugu', '#ffcc00', 80])
  assert.equal(on.target.texts[1].font, 'Poppins')
  // a kit with no title font doesn't leave it with none either
  const plain = kit({ title: { font: null, color: '#ffcc00', size: 80 } })
  assert.equal(putBrandOn(clip({ texts: [text('t1', { text: TELUGU, font: 'noto-sans-telugu' })] }), plain).target.texts[0].font, 'noto-sans-telugu')
  // off: its colour and size go back, its font was never changed
  const off = takeBrandOff(on.target, kit().data, on.before)
  assert.deepEqual([off.texts[0].font, off.texts[0].color, off.texts[0].size], ['noto-sans-telugu', '#ffffff', 40])
})

test('text in Telugu letters: a kit change never gives it the new font; off gives back one the kit put on before', () => {
  const k2 = kit({ title: { font: 'Anton', color: '#ffcc00', size: 80 } })
  const t = clip({ texts: [text('t1', { text: TELUGU, font: 'noto-sans-telugu', color: '#ffcc00', size: 80 })] })
  assert.equal(upd(t, kit().data, k2).texts[0].font, 'noto-sans-telugu')
  // (branded before this rule: it has the kit's font; the kit's new font doesn't follow, and off takes it away)
  const before = clip({ texts: [text('t1', { text: TELUGU, font: 'Poppins', color: '#ffcc00', size: 80 })] })
  assert.equal(upd(before, kit().data, k2).texts[0].font, 'Poppins')
  const off = takeBrandOff(before, kit().data, { texts: { t1: { font: 'noto-sans-telugu', color: '#ffffff', size: 40 } }, caption: null, text_case: null, frames: {}, end_card: null })
  assert.equal(off.texts[0].font, 'noto-sans-telugu')
})

test('a kit with no caption font keeps the font the captions have', () => {
  const k = kit()   // (its captions name no font)
  const t = clip({ caption: { template: 'plain', color: '#eeeeee', size: 52, animation: 'karaoke', font: 'roboto' } })
  assert.equal(putBrandOn(t, k).target.caption.font, 'roboto')
  const named = kit({ captions: { ...k.data.captions, font: 'Poppins' } })
  assert.equal(putBrandOn(t, named).target.caption.font, 'Poppins')
  // the kit later names one: the captions take it; it names none again: they keep what they have
  const on = putBrandOn(t, k)
  const followed = updateBrand(on.target, k.data, named, on.before).target
  assert.equal(followed.caption.font, 'Poppins')
  assert.equal(updateBrand(followed, named.data, k, on.before).target.caption.font, 'Poppins')
  // a font the user picked while the kit named none stays theirs
  const mine = { ...on.target, caption: { ...on.target.caption, font: 'Lato' } }
  assert.equal(updateBrand(mine, k.data, named, on.before).target.caption.font, 'Lato')
})

test('off: everything goes back, except what the user changed while it was on', () => {
  const on = putBrandOn(clip(), kit())
  // (the user recolours one text while the brand is on)
  const edited = { ...on.target, texts: on.target.texts.map(x => (x.id === 't2' ? { ...x, color: '#00ff00' } : x)) }
  const off = takeBrandOff(edited, kit().data, on.before)
  assert.equal(logoOf(off), undefined)
  assert.deepEqual([off.texts[0].font, off.texts[0].color, off.texts[0].size], ['Inter', '#ffffff', 40])
  assert.equal(off.texts[1].color, '#00ff00')
  assert.equal(off.caption.template, 'plain')
  assert.equal(off.segments[0].frame!.band!.bg, '#000000')
})

test('off with the kit deleted: its last-known settings still put text and captions back', () => {
  const on = putBrandOn(clip(), kit())
  const off = takeBrandOff(on.target, kit().data /* (as kept with the clip: BrandOn.applied) */, on.before)
  assert.equal(off.texts[0].font, 'Inter')
})

test('live: a new logo, colours and title style reach the clip', () => {
  const k1 = kit(), on = putBrandOn(clip(), k1)
  const k2 = kit({
    logo: { ...k1.data.logo, path: 'brand/u1/b.png', ratio: 0.5, corner: 'bl', size: 0.3 },
    colors: { ...k1.data.colors, main: '#334455' }, title: { font: 'Montserrat', color: '#ffffff', size: 90 },
  })
  k2.logo_url = 'https://cdn/logo-b.png'
  const t = upd(on.target, k1.data, k2)
  const logo = logoOf(t)!
  assert.equal(logo.storage_path, 'brand/u1/b.png')
  assert.equal(logo.preview_url, 'https://cdn/logo-b.png')
  assert.deepEqual({ x: logo.x, y: logo.y, w: logo.w, h: logo.h }, logoBox(k2.data.logo))
  assert.deepEqual(t.texts.map(x => [x.font, x.size]), [['Montserrat', 90], ['Montserrat', 90]])
  assert.equal(t.segments[0].frame!.band!.bg, '#334455')
})

test('live: the user\'s own changes stay — a moved logo, a recoloured text, a caption colour', () => {
  const k1 = kit(), on = putBrandOn(clip(), k1)
  const mine: BrandTarget = {
    ...on.target,
    overlays: on.target.overlays.map(o => ({ ...o, x: 0.1, y: 0.7 })),
    texts: on.target.texts.map(x => (x.id === 't2' ? { ...x, color: '#00ff00' } : x)),
    caption: { ...on.target.caption, color: '#abcdef' },
  }
  const k2 = kit({ logo: { ...k1.data.logo, path: 'brand/u1/b.png', ratio: 0.5 }, title: { ...k1.data.title, color: '#ff0000' },
    captions: { ...k1.data.captions, color: '#000000', size: 70 } })
  const t = upd(mine, k1.data, k2)
  const logo = logoOf(t)!
  assert.deepEqual([logo.x, logo.y, logo.storage_path], [0.1, 0.7, 'brand/u1/b.png'])
  assert.equal(logo.w, on.target.overlays[0].w)
  assert.equal(t.texts[0].color, '#ff0000')
  assert.equal(t.texts[1].color, '#00ff00')
  assert.equal(t.caption.color, '#abcdef')
  assert.equal(t.caption.size, 70)
})

test('live: a logo the user deleted stays deleted; a kit that loses its logo takes it off', () => {
  const k1 = kit(), on = putBrandOn(clip(), k1)
  const k2 = kit({ logo: { ...k1.data.logo, path: 'brand/u1/b.png' } })
  assert.equal(logoOf(upd({ ...on.target, overlays: [] }, k1.data, k2)), undefined)
  const k3 = kit({ logo: { ...k1.data.logo, path: null } })
  assert.equal(logoOf(upd(on.target, k1.data, k3)), undefined)
})

test('a frame picked while the brand is on gets it too', () => {
  const k = kit(), on = putBrandOn(clip({ segments: [] }), k)
  const later = { ...on.target, segments: [frame('f2')] }
  const r = brandNewFrames(later, k, on.before)!
  assert.equal(r.target.segments[0].frame!.band!.bg, '#112233')
  assert.ok(r.before.frames.f2)
  assert.equal(brandNewFrames(r.target, k, r.before), null)
})

test('only changes the clip shows count as the kit changing', () => {
  const a = kit().data
  assert.equal(brandChanged(a, { ...a, is_default: true }), false)
  assert.equal(brandChanged(a, { ...a, colors: { ...a.colors, main: '#000001' } }), true)
})

// ── Brand kit Phase 3: the title font on frame text, ready text styles ─────────
import { brandTextStyle, brandCaptionLooks, cleanBrandKitData } from '@/lib/shared/brandKit'
import { brandTextLook } from '@/modules/editor/textStyle'
import { brandCardItems } from './engine'

test('frame text takes the kit\'s title font; off puts its own back', () => {
  const k = kit()   // (title font Poppins)
  const on = putBrandOn(clip(), k)
  assert.equal(on.target.segments[0].frame!.items![0].font, 'Poppins')
  const off = takeBrandOff(on.target, k.data, on.before)
  assert.equal(off.segments[0].frame!.items![0].font ?? null, null)
})

test('a new title font reaches frame text still in the old one; a font the user picked stays', () => {
  const k1 = kit(), on = putBrandOn(clip({ segments: [frame('f1'), frame('f2')] }), k1)
  const mine = { ...on.target, segments: on.target.segments.map(s => (s.id === 'f2' ? { ...s, frame: { ...s.frame!, items: s.frame!.items!.map(it => ({ ...it, font: 'Anton' })) } } : s)) }
  const t = upd(mine, k1.data, kit({ title: { ...k1.data.title, font: 'Montserrat' } }))
  assert.equal(t.segments[0].frame!.items![0].font, 'Montserrat')
  assert.equal(t.segments[1].frame!.items![0].font, 'Anton')
})

test('a Branded card\'s new text is in the title font', () => {
  const items = brandCardItems({ ...frame('c1'), layout: 'frame_brand_card' } as SegmentLocal, { name: 'Chai', data: { ...kit().data, handle: 'chai', card_title: 'Chai Co' } })
  assert.ok(items.length === 2 && items.every(it => it.font === 'Poppins'))
})

test('ready text styles: the title font when they have none; the call to action\'s box in the accent colour, or none', () => {
  const d = kit().data
  assert.deepEqual(brandTextStyle(d, 'subtitle'), { ...d.styles.subtitle, font: 'Poppins' })
  assert.equal(brandTextStyle(d, 'cta').bg, '#ff5500')
  assert.equal(brandTextStyle({ ...d, styles: { ...d.styles, cta: { ...d.styles.cta, bg: null } } }, 'cta').bg, null)
  assert.equal(brandTextStyle({ ...d, styles: { ...d.styles, cta: { ...d.styles.cta, bg: '#123456' } } }, 'cta').bg, '#123456')
  const look = brandTextLook(brandTextStyle(d, 'cta'))
  assert.equal(look.bg_color, '#ff5500'); assert.equal(look.uppercase, true); assert.equal(look.font, 'Poppins')
  // (a kit saved before styles: the defaults, the call to action on the accent colour)
  assert.equal(cleanBrandKitData({ colors: { main: '#111111', accent: '#00ff00' } }).styles.cta.bg, 'accent')
})

test('caption looks: the main one first, then the others', () => {
  const d = cleanBrandKitData({ captions: { on: true, template: 'tpl:clean' }, more_captions: [{ id: 'hooks', name: 'Hooks', captions: { template: 'tpl:beast' } }] })
  assert.deepEqual(brandCaptionLooks(d).map(l => [l.id, l.captions.template]), [['main', 'tpl:clean'], ['hooks', 'tpl:beast']])
})

// ── Brand kit Phase 4: the logo kept clear of the apps' buttons, faces and captions ─────────
import { LOGO_SAFE, pickLogoCorner, brandLogoBox, captionBand, WATERMARK, isWatermark } from '@/lib/shared/brandKit'

test('kept clear: below the apps\' header, above their caption, left of their buttons', () => {
  const l = kit().data.logo
  const tr = logoBox(l, 1080, 1920, 'tr'), br = logoBox(l, 1080, 1920, 'br'), bl = logoBox(l, 1080, 1920, 'bl')
  assert.equal(tr.y, LOGO_SAFE.top)
  assert.ok(Math.abs(br.y + br.h - (1 - LOGO_SAFE.bottom)) < 1e-3)
  assert.ok(br.x + br.w <= 1 - LOGO_SAFE.right + 1e-4)
  assert.ok(bl.x >= LOGO_SAFE.edge - 1e-4 && tr.x + tr.w <= 1 - LOGO_SAFE.edge + 1e-4)
  // (switched off: the old small margin)
  assert.ok(logoBox({ ...l, safe: false }, 1080, 1920, 'tr').y < 0.03)
})

test('smart spot: the kit\'s corner when clear, else the clearest one; placed by hand or switched off stays', () => {
  const l = kit().data.logo   // (top right)
  assert.equal(pickLogoCorner(l, [captionBand(0.84)]), 'tr')
  const face = { x: 0.6, y: 0.05, w: 0.35, h: 0.25 }
  assert.equal(pickLogoCorner(l, [face]), 'tl')
  assert.equal(pickLogoCorner(l, [face, { x: 0, y: 0.05, w: 0.4, h: 0.25 }, captionBand(0.5)]), 'br')
  assert.deepEqual(brandLogoBox({ ...l, smart: false }, [face]), logoBox(l))
  assert.deepEqual(brandLogoBox({ ...l, x: 0.7, y: 0.1 }, [face]), logoBox({ ...l, x: 0.7, y: 0.1 }))
})

test('on a clip: the logo goes where it\'s clear; a kit change moves it, a logo the user moved stays', () => {
  const face = { x: 0.6, y: 0.05, w: 0.35, h: 0.25 }
  const k1 = kit(), on = putBrandOn(clip({ avoid: [face] }), k1)
  assert.deepEqual(pick(logoOf(on.target)!), logoBox(k1.data.logo, 1080, 1920, 'tl'))
  const k2 = kit({ logo: { ...k1.data.logo, size: 0.25 } })
  assert.deepEqual(pick(logoOf(upd(on.target, k1.data, k2))!), logoBox(k2.data.logo, 1080, 1920, 'tl'))
  const moved = { ...on.target, overlays: on.target.overlays.map(o => ({ ...o, x: 0.3, y: 0.4 })) }
  assert.deepEqual([logoOf(upd(moved, k1.data, k2))!.x, logoOf(upd(moved, k1.data, k2))!.y], [0.3, 0.4])
})

test('a clip branded before Phase 4 (old margins) still follows the kit', () => {
  const k1 = kit(), old = { ...k1.data, logo: { ...k1.data.logo, safe: false } }
  const on = putBrandOn(clip(), { ...k1, data: old })
  const t = upd(on.target, { ...old, logo: { ...old.logo, safe: undefined as unknown as boolean } }, k1)
  assert.deepEqual(pick(logoOf(t)!), logoBox(k1.data.logo))
})

test('watermark: small, faint, the whole clip', () => {
  const l = { ...kit().data.logo, ...WATERMARK }
  assert.ok(isWatermark(l) && !isWatermark(kit().data.logo))
  assert.ok(isWatermark(cleanBrandKitData({ logo: { path: null, ...WATERMARK } }).logo))
})

function pick(o: { x: number; y: number; w: number; h: number }) { return { x: o.x, y: o.y, w: o.w, h: o.h } }

// ── The progress bar, taken out 2026-11-05 (user) ─────────
test("a kit saved with a progress bar loses it; putting the kit on adds none", () => {
  const d = cleanBrandKitData({ progress_bar: { on: true, color: 'accent', height: 10, position: 'bottom' }, progress: { on: true } })
  assert.equal('progress_bar' in d || 'progress' in d, false)
  const on = putBrandOn(clip(), kit({ progress_bar: { on: true } } as never))
  assert.equal('progressBar' in on.target || 'progress_bar' in on.before, false)
})
