// Brand kits shared with a team: roles, seats and the brand lock (brandTeam.ts). Run: npx tsx --test src/lib/shared/brandTeam.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanRole, lockCaption, lockClipLook, lockColor, lockFont, lockHolds, lockSegment, lockSetOf, lockText, teamSeats } from './brandTeam'
import { DEFAULT_BRAND_KIT, type BrandKitData } from './brandKit'
import type { SegmentLocal, TextOverlay } from './types'

const kit = (over: Partial<BrandKitData> = {}): BrandKitData => ({
  ...DEFAULT_BRAND_KIT,
  colors: { main: '#112233', accent: '#ff5500', extra: ['#00aa55'] },
  title: { font: 'Poppins', color: '#ffcc00', size: 80 },
  captions: { ...DEFAULT_BRAND_KIT.captions, on: true, template: 'tpl:beast', color: '#ffffff', highlight_color: '#ff5500', font: null },
  lock: true,
  ...over,
})
const text = (over: Partial<TextOverlay> = {}): TextOverlay =>
  ({ id: 't1', clip_id: 'c', text: 'Hi', start_ms: 0, end_ms: 1000, x: 0.5, y: 0.5, font: 'Poppins', size: 60, color: '#ffcc00', ...over })

test('roles, seats and who the lock holds', () => {
  assert.equal(cleanRole('edit'), 'edit')
  assert.equal(cleanRole('owner'), 'use')
  assert.equal(teamSeats('agency'), 10)
  assert.equal(teamSeats('creator'), 10)  // Pro since 2026-11-21 (plans v2)
  assert.equal(teamSeats(null), 0)
  assert.equal(lockHolds({ lock: true }, 'use'), true)
  assert.equal(lockHolds({ lock: true }, 'edit'), false)
  assert.equal(lockHolds({ lock: true }, 'owner'), false)
  assert.equal(lockHolds({ lock: false }, 'use'), false)
})

test('what a locked kit allows: every colour it uses itself, its fonts, its caption looks', () => {
  const s = lockSetOf(kit())
  for (const c of ['#112233', '#ff5500', '#00aa55', '#ffcc00', '#ffffff', '#000000', DEFAULT_BRAND_KIT.card.bg.color, DEFAULT_BRAND_KIT.styles.cta.color]) assert.ok(s.colors.includes(c), c)
  assert.deepEqual(s.fonts, ['Poppins'])
  assert.deepEqual(s.templates, ['tpl:beast'])
  // (no fonts named by the kit: fonts stay free; its captions off: any caption style)
  const free = lockSetOf(kit({ title: { font: null, color: '#ffcc00', size: 80 }, captions: { ...DEFAULT_BRAND_KIT.captions, on: false } }))
  assert.equal(free.fonts, null)
  assert.equal(free.templates, null)
})

test('a colour not the kit’s becomes its nearest; fonts become the title font; none and unset stay', () => {
  const s = lockSetOf(kit())
  assert.equal(lockColor('#FF5500', s), '#FF5500')
  assert.equal(lockColor('#ee4411', s), '#ff5500')
  assert.equal(lockColor('#11aa66', s), '#00aa55')
  assert.equal(lockColor(null, s), null)
  assert.equal(lockColor('none', s), 'none')
  assert.equal(lockFont('Comic Sans', s), 'Poppins')
  assert.equal(lockFont('Poppins', s), 'Poppins')
  assert.equal(lockFont(null, s), null)
  // (a kit with no title font of its own: its text is in the default font, which stays allowed)
  const plain = lockSetOf(kit({ title: { font: null, color: '#ffcc00', size: 80 }, captions: { ...kit().captions, font: 'Anton' } }))
  assert.ok(plain.fonts!.includes('sans-serif'))
  assert.equal(lockFont('Lobster', plain), 'sans-serif')
})

test('text, captions and frames kept to the kit; what was already on-brand is the same object', () => {
  const s = lockSetOf(kit())
  const ok = text()
  assert.equal(lockText(ok, s), ok)
  const off = lockText(text({ color: '#0000ff', font: 'Lobster', stroke_color: '#123456', bg_color: null }), s)
  assert.equal(off.font, 'Poppins')
  assert.ok(s.colors.includes(off.color!) && s.colors.includes(off.stroke_color!))
  assert.equal(off.bg_color, null)
  const cap = lockCaption({ template: 'tpl:neon', color: '#00ff00', highlight_color: '#ff5500' }, s)
  assert.equal(cap.template, 'tpl:beast')
  assert.ok(s.colors.includes(cap.color!))
  assert.equal(cap.highlight_color, '#ff5500')
  const seg = {
    id: 's', start_ms: 0, end_ms: 1000, layout: 'frame_title_caption', sort_order: 0, crop_boxes: [],
    frame: { band: { text: '', bg: '#abcdef', color: '#ffffff', size: 64 }, items: [{ id: 'i', lane: 'band', kind: 'text', start_ms: 0, end_ms: 1000, text: 'x', color: '#ff5500', bg: '#010101', font: 'Lobster' }] },
  } as unknown as SegmentLocal
  const out = lockSegment(seg, s)
  assert.ok(s.colors.includes(out.frame!.band!.bg))
  assert.equal(out.frame!.items![0].color, '#ff5500')
  assert.equal(out.frame!.items![0].bg, '#000000')
  assert.equal(out.frame!.items![0].font, 'Poppins')
  assert.equal(lockSegment(out, s), out)
})

test('a whole clip’s look: changed only when something wasn’t the kit’s', () => {
  const s = lockSetOf(kit())
  const look = { texts: [text()], caption: { template: 'tpl:beast', color: '#ffffff' }, parts: [{ id: 'p', start_ms: 900, style: { color: '#ffffff' } }], segments: [] as SegmentLocal[] }
  const same = lockClipLook(look, s)
  assert.equal(same.changed, false)
  assert.equal(same.texts[0], look.texts[0])
  const moved = lockClipLook({ ...look, parts: [{ id: 'p', start_ms: 900, style: { color: '#0000ff' } }] }, s)
  assert.equal(moved.changed, true)
  assert.notEqual(moved.parts[0].style.color, '#0000ff')
  assert.equal((moved.parts[0] as { id: string }).id, 'p')
})
