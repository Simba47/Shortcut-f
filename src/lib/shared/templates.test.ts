import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TEMPLATE_KINDS, readableOn, anchorOf, buildTemplate, defaultAnchor, iconOf, inkOn, kindDef, newTemplate, readTemplate, wholeClip, type TemplateData, type TemplateKind } from './templates'
import { savedTextStyle, withSavedStyle } from '@/modules/editor/textStyle'
import { kitTitleOnTexts } from '@/modules/brand/engine'
import { DEFAULT_BRAND_KIT } from './brandKit'

// Run: npx tsx --test src/lib/shared/templates.test.ts
// A stand-in for the browser's measuring: 0.55 em a letter
const measure = (s: string, size: number) => [...s].length * size * 0.55
const photo = { path: 'overlays/u/p.png', url: null }, icon = (n: string) => ({ path: `templates/icons/${n}-v1.png`, url: null })
const KINDS = Object.keys(TEMPLATE_KINDS) as TemplateKind[]
const EPS = 1e-6

/** Every kind in every style, as put on (with its photo and icon when it has them) */
function all(): { name: string; d: TemplateData }[] {
  return KINDS.flatMap(k => Object.keys(kindDef(k).variants).map(v => {
    const d = newTemplate(k, v, { name: 'Dr. Likhitha', handle: 'dr.likhitha', main: '#0f3d3e', accent: '#c8ff00' })
    if (kindDef(k).photo) d.photo = photo
    const ic = iconOf(d)
    if (ic) d.icon = icon(ic)
    // (every field filled, so every line shows)
    for (const f of kindDef(k).fields) if (!d.fields[f.key]) d.fields[f.key] = f.placeholder || 'Something'
    return { name: `${k}/${v}`, d }
  }))
}

test('every kind and style builds: its first text carries the settings, every text is marked, nothing empty', () => {
  for (const { name, d } of all()) {
    const { texts, photos } = buildTemplate(d, 'T', defaultAnchor(d), 0, 4000, measure)
    assert.ok(texts.length >= 1, name)
    assert.equal(texts[0].tpl, d, `${name}: first text carries the settings`)
    assert.ok(texts.every(t => t.tpl_id === 'T'), `${name}: all marked`)
    assert.ok(texts.every(t => t.text.length > 0), `${name}: no empty text (the export skips those)`)
    assert.ok(texts.slice(1).every(t => !t.tpl), `${name}: only the first carries the settings`)
    assert.ok(texts.every(t => t.start_ms >= 0 && t.start_ms < t.end_ms && t.end_ms <= 4000), `${name}: inside its time`)
    if (kindDef(d.kind).photo) assert.ok(photos.length >= 1, `${name}: its photo`)
    if (iconOf(d)) assert.ok(photos.some(p => p.storage_path === d.icon!.path), `${name}: its icon`)
  }
})

test('every kind and style stays on screen, and off the apps’ right-hand buttons and bottom (end screen aside)', () => {
  for (const { name, d } of all()) {
    const { texts, photos } = buildTemplate(d, 'T', defaultAnchor(d), 0, 4000, measure)
    const full = d.kind === 'contact' && d.variant === 'end'
    for (const t of texts) {
      const pad = t.bg_color ? t.size * 0.35 * 2 : 0
      const w = t.w ? t.w : (measure(t.text, t.size) + pad) / 1080
      const right = t.x! + w, bottom = t.y! + (t.h ?? 0)
      assert.ok(t.x! >= -EPS, `${name}: "${t.text}" left ${t.x}`)
      assert.ok(right <= (full ? 1 : 0.97) + EPS, `${name}: "${t.text}" right ${right.toFixed(3)}`)
      assert.ok(t.y! >= (full ? 0 : 0.1) - EPS, `${name}: "${t.text}" top ${t.y}`)
      assert.ok(bottom <= (full ? 1 : 0.86) + EPS && t.y! <= (full ? 1 : 0.86), `${name}: "${t.text}" bottom ${bottom.toFixed(3)}`)
    }
    for (const p of photos) assert.ok(p.x >= -EPS && p.x + p.w <= 1 + EPS && p.y >= 0 && p.y + p.h <= 1, `${name}: photo on screen`)
  }
})

test('long words shrink to fit instead of running off', () => {
  const long = 'a_really_long_handle_for_a_clinic_with_a_long_name'
  for (const k of ['follow', 'handle', 'engage', 'fullvideo', 'hook', 'stat', 'credit'] as TemplateKind[]) {
    const d = newTemplate(k)
    // (as long as the panel lets each be)
    for (const f of kindDef(k).fields) d.fields[f.key] = f.key === 'number' ? '1,23,456' : long.repeat(4).slice(0, f.max)
    const { texts } = buildTemplate(d, 'T', defaultAnchor(d), 0, 4000, measure)
    for (const t of texts) {
      if (t.w) continue
      const right = t.x! + (measure(t.text, t.size) + (t.bg_color ? t.size * 0.7 : 0)) / 1080
      assert.ok(right <= 1 + EPS, `${k}: "${t.text.slice(0, 12)}…" ends at ${right.toFixed(3)}`)
    }
  }
})

test('a new template takes the kit: its @handle (with an @), its name, its colours; a style its own words', () => {
  const d = newTemplate('follow', 'instagram', { name: 'Dr. Likhitha', handle: 'dr.likhitha', accent: '#ff0066' })
  assert.equal(d.fields.handle, '@dr.likhitha')
  assert.equal(d.colors.accent, '#ff0066')
  assert.equal(newTemplate('follow', 'youtube').fields.button, 'Subscribe')
  assert.equal(newTemplate('contact', 'card', { name: 'Clinic', main: '#123456' }).colors.main, '#123456')
  assert.equal(newTemplate('nametag', 'band', { name: 'Dr. A' }).fields.name, 'Dr. A')
  assert.match(newTemplate('disclaimer', 'finance').fields.text, /financial advice/)
  assert.equal(newTemplate('contact').fields.phone, '', 'a phone number is never filled in for them')
  assert.equal(newTemplate('whatsapp').fields.number, '')
})

test('kinds that go over the whole clip: the handle tag, credit, disclaimer, a part badge, a show badge', () => {
  const whole = all().filter(x => wholeClip(x.d)).map(x => x.name).sort()
  assert.deepEqual(whole, ['credit/creator', 'credit/source', 'disclaimer/custom', 'disclaimer/finance', 'disclaimer/health', 'handle/instagram', 'handle/plain', 'handle/youtube', 'podcast/show', 'series/badge'])
})

test('empty optional lines are left out (no phone, no website)', () => {
  const d = newTemplate('contact', 'card', { name: 'Dr. A' })
  d.fields.role = 'Endocrinologist'
  const { texts } = buildTemplate(d, 'C', defaultAnchor(d), 0, 4000, measure)
  assert.deepEqual(texts.slice(1).map(t => t.text), ['Dr. A', 'Endocrinologist', 'Book an appointment'])
})

test('centred cards: each line centred on the card', () => {
  for (const k of ['comment', 'offer', 'location', 'event', 'contact'] as TemplateKind[]) {
    const d = newTemplate(k)
    for (const f of kindDef(k).fields) if (!d.fields[f.key]) d.fields[f.key] = 'Something here'
    const at = defaultAnchor(d)
    const { texts } = buildTemplate(d, 'T', at, 0, 4000, measure)
    const cx = at.x + texts[0].w! / 2
    for (const t of texts.slice(1)) {
      const mid = t.x! + (measure(t.text, t.size) + (t.bg_color ? t.size * 0.7 : 0)) / 2 / 1080
      assert.ok(Math.abs(mid - cx) < 1e-6, `${k}: "${t.text}" centred`)
    }
    // and inside the card, top to bottom
    const ys = texts.slice(1).map(t => t.y!)
    assert.deepEqual([...ys].sort((a, b) => a - b), ys, k)
    assert.ok(ys[ys.length - 1] < at.y + texts[0].h!, `${k}: last line inside the card`)
  }
})

test('Follow: a photo added later keeps the row on screen; plain has no icon', () => {
  const plain = newTemplate('follow', 'plain')
  const at = defaultAnchor(plain)
  assert.equal(iconOf(plain), null)
  const withPhoto = buildTemplate({ ...plain, photo }, 'T', at, 0, 4000, measure)
  assert.ok(withPhoto.photos[0].x >= 0)
})

test('its marks are saved with the text and read back; the export field list knows them', () => {
  const d = newTemplate('comment')
  const { texts } = buildTemplate(d, 'T', defaultAnchor(d), 0, 4000, measure)
  const st = savedTextStyle(texts[0])!
  assert.equal(st.tpl_id, 'T')
  const back = withSavedStyle({ id: 'x', text: texts[0].text, style: st }) as { tpl_id?: string; tpl?: unknown }
  assert.equal(back.tpl_id, 'T')
  assert.equal(readTemplate(back.tpl)?.kind, 'comment')
  assert.equal(anchorOf([{ ...texts[0], clip_id: 'c' }], 'T')?.x, texts[0].x)
  assert.equal(readTemplate({ kind: 'nope' }), null)
})

test("a brand kit's title look leaves a template's texts alone", () => {
  const d = newTemplate('follow', 'plain')
  const { texts } = buildTemplate(d, 'T', defaultAnchor(d), 0, 4000, measure)
  const plainText = { ...texts[0], id: 'own', tpl_id: undefined, tpl: undefined, clip_id: 'c' }
  const out = kitTitleOnTexts([...texts.map(t => ({ ...t, clip_id: 'c' })), plainText], { ...DEFAULT_BRAND_KIT, title: { ...DEFAULT_BRAND_KIT.title, color: '#123456' } })
  assert.ok(out.filter(t => t.tpl_id).every(t => t.color !== '#123456'))
  assert.equal(out.find(t => t.id === 'own')!.color, '#123456')
})

test('an accent that would not read on its card gives way to the card’s ink', () => {
  assert.equal(readableOn('#c8ff00', '#ffffff'), '#111111')
  assert.equal(readableOn('#c8ff00', '#111114'), '#c8ff00')
  const d = newTemplate('nametag', 'clean', { accent: '#c8ff00' })
  d.fields.title = 'Consultant'
  const { texts } = buildTemplate(d, 'T', defaultAnchor(d), 0, 4000, measure)
  assert.equal(texts.find(t => t.text === 'Consultant')!.color, '#111111')
})

test('no character the export font lacks: arrows other than ↑ ↓ are emoji', () => {
  for (const { name, d } of all()) for (const t of buildTemplate(d, 'T', defaultAnchor(d), 0, 4000, measure).texts) assert.ok(!/[→←⟶]/.test(t.text), `${name}: "${t.text}"`)
})

test('ink reads on its background', () => {
  assert.equal(inkOn('#ffffff'), '#111111')
  assert.equal(inkOn('#0f3d3e'), '#ffffff')
  assert.equal(inkOn('#c8ff00'), '#111111')
})

// ── One thing in the editor (user, 2026-11-23: "every thing should be single element") ──
import { movedPart, partsBox, templatePartChanged } from './templates'

/** A template put on, as the editor keeps it: its texts (first with the settings, listing its photos) and photos */
function onClip(kind: TemplateKind, variant?: string) {
  const d = newTemplate(kind, variant)
  if (kindDef(kind).photo) d.photo = photo
  const ic = iconOf(d)
  if (ic) d.icon = icon(ic)
  const { texts, photos } = buildTemplate(d, 'T', defaultAnchor(d), 1000, 5000, measure)
  texts[0].tpl = { ...d, images: photos.map(p => p.id) }
  return { texts: texts.map(t => ({ ...t, clip_id: 'c', track: 2 })), photos: photos.map((p, i) => ({ ...p, clip_id: 'c', z_index: i, created_at: '', track: 2 })) }
}
const other = { id: 'own', clip_id: 'c', text: 'Mine', start_ms: 0, end_ms: 9000, x: 0.1, y: 0.1, size: 60, track: 1 }

test('its bar moved on the timeline: every part moves with it, entrance delays kept; other texts left alone', () => {
  const { texts, photos } = onClip('comment')
  const out = templatePartChanged([...texts, other], photos, texts[0].id, { start_ms: 3000, end_ms: 7000 })!
  texts.forEach((t, i) => { assert.equal(out.texts[i].start_ms, t.start_ms + 2000); assert.equal(out.texts[i].end_ms, 7000) })
  assert.deepEqual(out.texts.at(-1), other)
})

test('its end trimmed: all end there; its start trimmed: each keeps its delay from the new start', () => {
  const { texts, photos } = onClip('follow', 'instagram')
  const end = templatePartChanged(texts, photos, texts[0].id, { end_ms: 3000 })!
  assert.ok([...end.texts, ...end.photos].every(p => p.end_ms === 3000 && p.start_ms < 3000))
  const start = templatePartChanged(texts, photos, texts[0].id, { start_ms: 2000 })!
  texts.forEach((t, i) => assert.equal(start.texts[i].start_ms, 2000 + (t.start_ms - 1000)))
  assert.ok(start.photos.every(p => p.start_ms === 2000 && p.end_ms === 5000))
})

test('its row, eye and lock go for every part — photos too; its words only for that text', () => {
  const { texts, photos } = onClip('contact', 'card')
  const out = templatePartChanged(texts, photos, texts[0].id, { track: 4, hidden: true, locked: true, text: 'x' })!
  assert.ok([...out.texts, ...out.photos].every(p => p.track === 4 && p.hidden && p.locked))
  assert.equal(out.texts[0].text, 'x')
  assert.ok(out.texts.slice(1).every((t, i) => t.text === texts[i + 1].text))
})

test('moved on the frame by one part: all parts move as far', () => {
  const { texts, photos } = onClip('follow', 'instagram')
  const out = templatePartChanged(texts, photos, texts[0].id, { x: texts[0].x! + 0.1, y: texts[0].y! - 0.05 })!
  out.texts.forEach((t, i) => { assert.ok(Math.abs(t.x! - texts[i].x! - 0.1) < EPS); assert.ok(Math.abs(t.y! - texts[i].y! + 0.05) < EPS) })
  out.photos.forEach((p, i) => assert.ok(Math.abs(p.x - photos[i].x - 0.1) < EPS))
  assert.equal(templatePartChanged([other], [], 'own', { x: 0.5 }), null, 'not a template: the editor changes it as any text')
})

test('resized from a corner: its box grows round the corner that stays, and made again it comes out the same', () => {
  for (const [k, v] of [['follow', 'instagram'], ['comment', undefined], ['contact', 'card'], ['nametag', 'clean']] as [TemplateKind, string | undefined][]) {
    const { texts, photos } = onClip(k, v)
    const b0 = partsBox(texts, photos, measure)!
    const m = { r: 1.5, ox: b0.x, oy: b0.y, dx: 0, dy: 0 }
    const t2 = texts.map(t => movedPart(t, m)), p2 = photos.map(p => movedPart(p, m))
    const b1 = partsBox(t2, p2, measure)!
    assert.ok(Math.abs(b1.x - b0.x) < 0.004 && Math.abs(b1.y - b0.y) < 0.004, `${k}: the corner stays`)
    assert.ok(Math.abs(b1.w / b0.w - 1.5) < 0.03 && Math.abs(b1.h / b0.h - 1.5) < 0.03, `${k}: ${(b1.w / b0.w).toFixed(3)}× wide`)
    // Apply changes later: made again at its first text's place with its size kept
    const d = { ...texts[0].tpl!, scale: 1.5 }
    const again = buildTemplate(d, 'T', { x: t2[0].x!, y: t2[0].y! }, 1000, 5000, measure)
    again.texts.forEach((t, i) => {
      assert.ok(Math.abs(t.x! - t2[i].x!) < 0.003 && Math.abs(t.y! - t2[i].y!) < 0.003, `${k}: "${t.text}" in its place`)
      assert.equal(t.size, t2[i].size)
    })
  }
})

test('its size is kept with its settings', () => {
  const d = { ...newTemplate('follow'), scale: 1.25 }
  assert.equal(readTemplate(JSON.parse(JSON.stringify(d)))?.scale, 1.25)
  assert.equal(readTemplate(newTemplate('follow'))?.scale, undefined)
})
