import type { AudioTrack, BoxKeyframe, CaptionStyle, FrameItem, FrameSettings, Overlay, SegmentLocal, TextOverlay, Transition } from '@chai-cut/shared'
import { isLatinText } from '@/modules/captions/templates'
import { brandCaptionStyle, brandCaptionStyleOn, brandLogoBox, cardLookOf, isBrandLogo, logoBox, logoSpan, showHandle, type BrandKit, type BrandKitData, type FrameRect, type LogoCorner } from '@/lib/shared/brandKit'
import type { BrandBefore, FrameBefore } from '@/lib/shared/brandOn'
import { DEFAULT_BAND, frameOf, frameSlotCount, isFrameLayout, isTextLane, newItemCorners, textLaneLook } from '@/modules/editor/frames'
import { isShot } from '@/modules/editor/shots'
import { makeEndCard, removeEndCard, type CardTimeline } from './endCard'
import { bookendOf, putBookend, takeBookend, type InsertTimeline } from './bookends'
import { insertsOf, isInsert, videoAt } from '@/modules/editor/inserts'

/**
 * The brand engine (brand kit rebuild, Phase 0, 2026-10-27): the one place that says what a brand
 * kit does to a clip. Pure — it takes a clip's parts and gives new ones — so the editor and the
 * server use the same rules.
 *
 *  - putBrandOn: the kit goes on (its logo, title style on text, caption look, frame colours and
 *    corners, Branded cards, its end card, intro and outro), and what it changed is kept to put back
 *  - brandNewFrames: while it's on, frames picked later get it too
 *  - takeBrandOff: it comes off; what it changed goes back where the user hasn't changed it since
 *  - updateBrand: the kit changed since it went on (a new logo, other colours): the clip follows it
 *    live — but only where the clip still shows what the kit put there; the user's own changes stay
 *
 * Locked things are never touched.
 */

/** The parts of a clip the brand works on */
export interface BrandTarget {
  clipId: string
  lengthMs: number
  mainVideoId: string | null
  overlays: Overlay[]
  texts: TextOverlay[]
  /** The caption style as the editor keeps it (only the fields set) */
  caption: Partial<CaptionStyle>
  /** The captions' letter case ('upper', 'title', …) */
  textCase: string
  segments: SegmentLocal[]
  /** The views of its parts' boxes (box id → keyframes) and its transitions: an end card changes them */
  keyframes: Record<string, BoxKeyframe[]>
  transitions: Transition[]
  /**
   * Whether the brand may cut and re-lay the clip's parts here (its end card): the editor always; the
   * server only when no video is on top (its saved parts and the editor's note of the layers beside
   * them must keep matching: shots.ts restoreLayers) — else the editor does it when the clip is opened
   */
  timelineEdits: boolean
  /** Its music and sounds: an intro or outro moves them along */
  audioTracks: AudioTrack[]
  /**
   * Whether the brand may put videos in here (its intro and outro): as timelineEdits, and not on a clip
   * with parts removed the older way (trims: the editor first makes it pieces) — nor, on the server,
   * one with parts played faster or slower (where the main video is at a moment is the editor's to say)
   */
  canInsert: boolean
  /** false: the kit's end card, intro and outro aren't added or changed here (BRAND_ENDS_ON); ones already on the clip stay */
  ends?: boolean
  /** Where the main video is at timeline `t` (clip ms of it); by default as the videos put in between say */
  videoAt?: (t: number) => number
  /** What the logo keeps off on this clip (Phase 4, kit logo.smart): its captions, the faces in it */
  avoid?: FrameRect[]
}

export const NO_BEFORE: BrandBefore = { texts: {}, caption: null, text_case: null, frames: {}, end_card: null }

/** What the brand puts on the clip's own text */
const titleFont = (d: BrandKitData) => d.title.font ?? 'sans-serif'
/**
 * The font the kit gives this text: its title font — text in Telugu, Hindi… keeps its own (as Make my
 * clips does: a kit's font has none of those letters, and the export draws a text in its one font)
 */
const textFontOf = (d: BrandKitData, x: TextOverlay) => (isLatinText(x.text ?? '') ? titleFont(d) : x.font)
/** The caption case a kit's captions give */
const caseOf = (d: BrandKitData) => (d.captions.uppercase ? 'upper' : 'title')
/** A frame's band colour under a kit (a Branded card has its own) */
const bandBgOf = (d: BrandKitData, card: boolean) => (card ? d.card.bg.color : d.colors.main)
/** The colour a kit gives a frame's text item */
const itemColourOf = (d: BrandKitData, card: boolean, lane: FrameItem['lane']) =>
  card && lane === 'band2' ? d.card.handle.color : card && lane === 'band' ? d.card.title.color : d.title.color
const near = (a: number, b: number) => Math.abs(a - b) < 0.002
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const brandLogos = (o: Overlay) => o.type === 'image' && isBrandLogo(o.storage_path) && !o.locked

// ── Frames ────────────────────────────────────────────────────────────────────

/** A frame with the kit's corners on its main video and its photos and videos (not on areas drawn square or with their own shape) */
function withKitCorners(seg: SegmentLocal, corners: number): SegmentLocal {
  if (!isFrameLayout(seg.layout) || seg.locked) return seg
  const layout = seg.layout, f = frameOf(seg), slots = frameSlotCount(layout)
  const rounded = (slot: number) => slot < slots && newItemCorners(layout, slot) > 0
  return {
    ...seg,
    frame: {
      ...f,
      // (slots this frame doesn't use take them too: a frame picked later that has them carries them over)
      main_corners: Object.fromEntries(Object.entries(f.main_corners ?? {}).map(([k, v]) => [k, Number(k) >= slots || rounded(Number(k)) ? corners : v])),
      items: (f.items ?? []).map(it => (it.kind !== 'text' && typeof it.lane === 'number' && rounded(it.lane) && !it.locked ? { ...it, corners } : it)),
    },
  }
}

/** A Branded card's text from a kit's card settings: its title and @handle (each when it shows), over the whole card */
export function brandCardItems(seg: SegmentLocal, kit: Pick<BrandKit, 'name' | 'data'>): FrameItem[] {
  const d = kit.data, c = d.card, span = { start_ms: seg.start_ms, end_ms: seg.end_ms }
  const title = d.card_title.trim() || kit.name, handle = showHandle(d.handle)
  const out: FrameItem[] = []
  const font = d.title.font ? { font: d.title.font } : {}
  if (title && c.title.show) out.push({ id: crypto.randomUUID(), lane: 'band', kind: 'text', ...span, text: title, bg: textLaneLook(seg, 'band').bg, color: c.title.color, size: c.title.size, ...font })
  if (handle && c.handle.show) out.push({ id: crypto.randomUUID(), lane: 'band2', kind: 'text', ...span, text: handle, bg: textLaneLook(seg, 'band2').bg, color: c.handle.color, size: c.handle.size, ...font })
  return out
}

/** A Branded card as the kit's card settings make it: its look, and its title and @handle when it has no text yet */
export function fillBrandCard(seg: SegmentLocal, kit: Pick<BrandKit, 'name' | 'data'>): SegmentLocal {
  const f = frameOf(seg), c = kit.data.card
  const hasText = (f.items ?? []).some(it => it.kind === 'text')
  return { ...seg, frame: { ...f, card: cardLookOf(c), band: { ...DEFAULT_BAND, ...f.band, bg: c.bg.color }, items: hasText ? f.items : [...(f.items ?? []), ...brandCardItems(seg, kit)] } }
}

/** The brand on one frame section, and what it was before (to put back when switched off) */
export function brandFrame(seg: SegmentLocal, kit: Pick<BrandKit, 'name' | 'data'>): { seg: SegmentLocal; before: FrameBefore } {
  const d = kit.data, f = frameOf(seg), band = { ...DEFAULT_BAND, ...f.band }
  const card = seg.layout === 'frame_brand_card'
  const before: FrameBefore = { layout: seg.layout, band: { bg: band.bg, color: band.color }, items: {}, main_corners: f.main_corners ?? null, item_corners: {} }
  const bandBg = bandBgOf(d, card)
  const items = (f.items ?? []).map(it => {
    if (it.locked) return it
    if (it.kind === 'text' && !it.captions) {
      before.items[it.id] = { color: it.color ?? null, bg: it.bg ?? null, font: it.font ?? null }
      // (a band's text carries the band's colour: it follows it; a see-through or own colour stays;
      // the kit's title font when it has one — brand kit Phase 3: brand fonts on frames too)
      return {
        ...it, color: itemColourOf(d, card, it.lane), ...(isTextLane(it.lane) && it.bg === band.bg ? { bg: bandBg } : {}),
        ...(d.title.font ? { font: d.title.font } : {}),
      }
    }
    if (it.kind !== 'text') before.item_corners![it.id] = it.corners ?? null
    return it
  })
  let next: SegmentLocal = { ...seg, frame: { ...f, band: { ...band, bg: bandBg, color: d.title.color }, items } }
  if (card) {
    before.card = f.card ?? null
    const had = new Set((next.frame?.items ?? []).map(it => it.id))
    next = fillBrandCard(next, kit)
    before.added = (next.frame?.items ?? []).filter(it => !had.has(it.id)).map(it => it.id)
  }
  if (d.frames.corners !== null) next = withKitCorners(next, d.frames.corners)
  return { seg: next, before }
}

/** The frames the brand goes on: frame sections that aren't locked and aren't videos on a row */
const brandable = (seg: SegmentLocal, mainVideoId: string | null) => isFrameLayout(seg.layout) && !seg.locked && !isShot(seg, mainVideoId)

// ── Intro and outro ──────────────────────────────────────────────────────────

const insertsOfT = (t: BrandTarget): InsertTimeline => ({
  segments: t.segments, keyframes: t.keyframes, overlays: t.overlays, textOverlays: t.texts, audioTracks: t.audioTracks,
  transitions: t.transitions, lengthMs: t.lengthMs, mainVideoId: t.mainVideoId,
})
const withInserts = (t: BrandTarget, st: InsertTimeline): BrandTarget => ({
  ...t, segments: st.segments, keyframes: st.keyframes, overlays: st.overlays, texts: st.textOverlays, audioTracks: st.audioTracks,
  transitions: st.transitions, lengthMs: st.lengthMs,
})

/** The clip's own part, between the brand's intro and outro: [start, end] on the timeline */
function mainSpan(t: BrandTarget, b: BrandBefore | null): [number, number] {
  const st = insertsOfT(t)
  const intro = b?.intro ? bookendOf(st, b.intro) : null, outro = b?.outro ? bookendOf(st, b.outro) : null
  return [intro ? intro.end_ms : 0, outro ? outro.start_ms : t.lengthMs]
}

/**
 * The clip's intro and outro as the kit has them: put in where the kit has one and the brand hasn't yet;
 * taken out when the kit has none now or another video (and that one put in). One the user took out
 * stays out until the kit picks another; one they changed (moved, cut, locked) is theirs. Outro first:
 * the intro then moves it along with everything else.
 */
function syncBookends(t: BrandTarget, kit: Pick<BrandKit, 'data'>, before: BrandBefore):
  { target: BrandTarget; before: BrandBefore; note?: string } {
  if (!t.canInsert || t.ends === false) return { target: t, before }
  let target = t, b = before, note: string | undefined
  for (const which of ['outro', 'intro'] as const) {
    const want = kit.data.ends[which], rec = b[which] ?? null
    if (rec) {
      const there = target.segments.some(s => s.id === rec.id)
      if (!there) {
        // (taken out by the user: stays out, unless the kit's is another video now)
        if (want && want.id === rec.video) continue
        b = { ...b, [which]: null }
      } else if (want && want.id === rec.video && Math.abs(want.ms - rec.ms) <= 1) {
        continue
      } else {
        const back = takeBookend(insertsOfT(target), rec)
        b = { ...b, [which]: null }
        if (!back) continue
        target = withInserts(target, back)
      }
    }
    if (!want || b[which]) continue
    // (an outro after the clip's own end: before the hidden room kept for what's on top, if there is one)
    const tail = target.segments.find(s => isInsert(s, target.mainVideoId) && s.hidden && s.crop_boxes[0]?.hidden)
    const at = which === 'intro' ? 0 : tail ? tail.start_ms : target.lengthMs
    const hold = (target.videoAt ?? (x => videoAt(insertsOf(target.segments, target.mainVideoId), x)))(at)
    const put = putBookend(insertsOfT(target), at, hold, want)
    if ('skip' in put) { note = put.skip; continue }
    target = withInserts(target, put.state)
    b = { ...b, [which]: put.rec }
  }
  return { target, before: b, ...(note ? { note } : {}) }
}

// ── The end card ─────────────────────────────────────────────────────────────

const timelineOf = (t: BrandTarget): CardTimeline =>
  ({ segments: t.segments, keyframes: t.keyframes, transitions: t.transitions, lengthMs: t.lengthMs, mainVideoId: t.mainVideoId })
const withTimeline = (t: BrandTarget, tl: CardTimeline): BrandTarget =>
  ({ ...t, segments: tl.segments, keyframes: tl.keyframes, transitions: tl.transitions })

/**
 * The clip's end card as the kit has it (`old`: the kit's settings before, when it changed): made when
 * the kit has one and the brand hasn't made it yet; taken off when the kit hasn't, or made again at its
 * new length. One the user took out stays out; one they changed is theirs. `note`: why it couldn't be made.
 */
function syncEndCard(t: BrandTarget, kit: Pick<BrandKit, 'name' | 'data'>, before: BrandBefore, old: BrandKitData | null):
  { target: BrandTarget; before: BrandBefore; note?: string } {
  if (!t.timelineEdits || t.ends === false) return { target: t, before }
  const want = kit.data.ends.card, rec = before.end_card
  let target = t, b = before
  if (rec) {
    if (!t.segments.some(s => s.id === rec.id)) return { target, before: want ? b : { ...b, end_card: null } }
    const redo = want && !!old && old.ends.card && old.ends.seconds !== kit.data.ends.seconds
    if (!want || redo) {
      const back = removeEndCard(timelineOf(target), rec)
      const { [rec.id]: _, ...frames } = b.frames
      if (!back) return { target, before: want ? b : { ...b, end_card: null, frames } }
      target = withTimeline(target, back)
      b = { ...b, end_card: null, frames }
    }
  }
  if (!want || b.end_card) return { target, before: b }
  // (before the kit's outro, when the clip ends with it)
  const made = makeEndCard(timelineOf(target), kit.data.ends.seconds, undefined, mainSpan(target, b)[1])
  if ('skip' in made) return { target, before: b, note: made.skip }
  // (the card is branded as any Branded card is)
  const r = brandFrame(made.timeline.segments.find(s => s.id === made.rec.id)!, kit)
  return {
    target: { ...withTimeline(target, made.timeline), segments: made.timeline.segments.map(s => (s.id === made.rec.id ? r.seg : s)) },
    before: { ...b, end_card: made.rec, frames: { ...b.frames, [made.rec.id]: r.before } },
  }
}

/**
 * The kit's settings as the clip got them (kept with it: BrandOn.applied): where the end card couldn't
 * be made or changed here (the server, with a video on top), as it was — so when the clip is next
 * opened, the editor sees the kit has changed and does it
 */
function appliedOf(t: BrandTarget, d: BrandKitData, old: BrandKitData | null): BrandKitData {
  if (t.ends === false) return d
  let ends = d.ends
  if (!t.timelineEdits) ends = { ...ends, card: old ? old.ends.card : false, seconds: old ? old.ends.seconds : d.ends.seconds }
  if (!t.canInsert) ends = { ...ends, intro: old ? old.ends.intro : null, outro: old ? old.ends.outro : null }
  return ends === d.ends ? d : { ...d, ends }
}

// ── On ────────────────────────────────────────────────────────────────────────

/** The kit's logo as a photo on the clip (where and when the kit says), on top of everything */
function logoOverlay(t: BrandTarget, kit: Pick<BrandKit, 'data' | 'logo_url'>, rest: Overlay[], span: [number, number] = [0, t.lengthMs]): Overlay | null {
  const d = kit.data
  if (!d.logo.path) return null
  const [start, end] = logoSpan(d.logo, span[1] - span[0]).map(x => x + span[0])
  return {
    id: crypto.randomUUID(), clip_id: t.clipId, type: 'image',
    storage_path: d.logo.path, preview_url: kit.logo_url ?? undefined,
    source_video_id: null, source_offset_ms: 0, ...brandLogoBox(d.logo, t.avoid),
    start_ms: start, end_ms: end, z_index: Math.max(0, ...rest.map(o => o.z_index)) + 1,
    created_at: new Date().toISOString(), opacity: d.logo.opacity < 0.999 ? d.logo.opacity : null,
  }
}

/**
 * The kit put on the clip: its logo (in place of a kit's logo put on before), its title font, colour
 * and size on the clip's text, its caption look when its captions are on (the captions themselves
 * aren't switched on or made), the brand on every frame and its end card. Returns what it
 * changed, to put back, and the kit's settings as the clip got them (appliedOf).
 */
export function putBrandOn(t: BrandTarget, kit: BrandKit): { target: BrandTarget; before: BrandBefore; applied: BrandKitData; note?: string } {
  const d = kit.data
  const before: BrandBefore = {
    ...NO_BEFORE,
    texts: Object.fromEntries(t.texts.filter(x => !x.locked).map(x => [x.id, { font: x.font ?? null, color: x.color ?? null, size: x.size ?? null }])),
    // (capitals are yes or no — never empty: a clip with no caption style yet had them off. An empty one
    // put back made every save fail, user 2026-11-04: "Connection lost" with the internet fine)
    caption: d.captions.on ? Object.fromEntries(Object.keys(brandCaptionStyle(d.captions)).map(k => [k, (t.caption as unknown as Record<string, unknown>)[k] ?? (k === 'uppercase' ? false : null)])) as Partial<CaptionStyle> : null,
    text_case: d.captions.on ? t.textCase : null,
    frames: {},
  }
  const rest = t.overlays.filter(o => !brandLogos(o))
  const logo = logoOverlay(t, kit, rest)
  const segments = t.segments.map(seg => {
    if (!brandable(seg, t.mainVideoId)) return seg
    const r = brandFrame(seg, kit)
    before.frames[seg.id] = r.before
    return r.seg
  })
  const on: BrandTarget = {
    ...t,
    overlays: logo ? [...rest, logo] : rest,
    texts: t.texts.map(x => (x.locked ? x : { ...x, font: textFontOf(d, x), color: d.title.color, size: d.title.size })),
    caption: d.captions.on ? { ...t.caption, ...brandCaptionStyleOn(d.captions, t.caption) } : t.caption,
    textCase: d.captions.on ? caseOf(d) : t.textCase,
    segments,
  }
  // (the intro moves what's on along: the logo, over the clip's own part, goes with it)
  const ends = syncBookends(on, kit, before)
  const card = syncEndCard(ends.target, kit, ends.before, null)
  const note = ends.note ?? card.note
  return { target: card.target, before: card.before, applied: appliedOf(t, d, null), ...(note ? { note } : {}) }
}

/**
 * While the brand is on: frames picked since (a new section, or a section given another frame) get
 * it too, and a logo the kit shows throughout keeps covering the whole clip as it gets longer or
 * shorter. Null when there's nothing to do.
 */
export function brandNewFrames(t: BrandTarget, kit: BrandKit, before: BrandBefore | null): { target: BrandTarget; before: BrandBefore } | null {
  const known = before?.frames ?? {}
  const add: Record<string, FrameBefore> = {}
  const segments = t.segments.map(seg => {
    if (!brandable(seg, t.mainVideoId) || known[seg.id]?.layout === seg.layout) return seg
    const r = brandFrame(seg, kit)
    add[seg.id] = r.before
    return r.seg
  })
  let overlays = t.overlays
  if (kit.data.logo.show === 'all') {
    // (the clip's own part: not over the kit's intro and outro)
    const [a, z] = mainSpan(t, before)
    const short = overlays.find(o => brandLogos(o) && (Math.abs(o.start_ms - a) > 1 || Math.abs(o.end_ms - z) > 1))
    if (short) overlays = overlays.map(o => (o.id === short.id ? { ...o, start_ms: a, end_ms: z } : o))
  }
  if (!Object.keys(add).length && overlays === t.overlays) return null
  return { target: { ...t, segments, overlays }, before: { ...(before ?? NO_BEFORE), frames: { ...known, ...add } } }
}

// ── Off ───────────────────────────────────────────────────────────────────────

/**
 * The brand taken off: its logo comes off; text, captions, frame colours and corners go back as they
 * were — each only where it's still as the brand left it, so the user's changes since are kept; the
 * Branded card text it added goes; what its end card took the place of comes back (one the user changed
 * stays). `d`: the kit's settings when it was on (null: the kit is gone — the logo and frames still come
 * off, texts and captions stay). (An end card made by an older kit is the editor's to turn back: it
 * needs the editor's layouts.)
 */
export function takeBrandOff(t0: BrandTarget, d: BrandKitData | null, b: BrandBefore | null): BrandTarget {
  // The end card first: the frames below then come back as they were on the parts it gave back
  const back = b?.end_card && t0.timelineEdits ? removeEndCard(timelineOf(t0), b.end_card) : null
  let t = back ? withTimeline(t0, back) : t0
  // The intro and outro it put in come out (one the user changed stays)
  if (b && t.canInsert) for (const rec of [b.intro, b.outro]) {
    const gone = rec ? takeBookend(insertsOfT(t), rec) : null
    if (gone) t = withInserts(t, gone)
  }
  const overlays = t.overlays.filter(o => !brandLogos(o))
  let texts = t.texts, caption = t.caption, textCase = t.textCase
  if (d && b) {
    texts = t.texts.map(x => {
      const was = b.texts[x.id]
      if (!was || x.locked || x.font !== textFontOf(d, x) || x.color !== d.title.color) return x
      // (its size too, where the brand set it and it's still the brand's; a clip branded before sizes were kept has none)
      return { ...x, font: x.font === titleFont(d) ? was.font : x.font, color: was.color, ...(was.size !== undefined && x.size === d.title.size ? { size: was.size } : {}) }
    })
    if (b.caption && d.captions.on && t.caption.template === d.captions.template && t.caption.color === d.captions.color) {
      // (a look kept before 2026-11-04 can have its capitals empty: off)
      caption = { ...t.caption, ...b.caption, uppercase: b.caption.uppercase ?? false }
      if (b.text_case) textCase = b.text_case
    }
  }
  const segments = !b ? t.segments : t.segments.map(seg => {
    const was = b.frames[seg.id]
    if (!was || seg.locked || was.layout !== seg.layout || !isFrameLayout(seg.layout)) return seg
    const f = frameOf(seg)
    const added = new Set(was.added ?? [])
    const items = (f.items ?? []).filter(it => it.locked || !added.has(it.id)).map(it => {
      if (it.locked) return it
      const w = was.items[it.id]
      if (w) {
        // (its font back where it's still the kit's; a frame branded before fonts were kept has none to put back)
        const font = w.font !== undefined && d && d.title.font && it.font === d.title.font ? { font: w.font } : {}
        return { ...it, color: w.color ?? undefined, bg: w.bg ?? undefined, ...font }
      }
      if (was.item_corners && it.id in was.item_corners) return { ...it, corners: was.item_corners[it.id] ?? undefined }
      return it
    })
    return {
      ...seg,
      frame: {
        ...f, items, band: { ...DEFAULT_BAND, ...f.band, bg: was.band.bg, color: was.band.color },
        ...(d && d.frames.corners !== null ? { main_corners: was.main_corners ?? undefined } : {}),
        ...(seg.layout === 'frame_brand_card' ? { card: (was.card as FrameSettings['card']) ?? null } : {}),
      },
    }
  })
  return { ...t, overlays, texts, caption, textCase, segments }
}

// ── Live ──────────────────────────────────────────────────────────────────────

/**
 * Whether a kit's settings changed in a way the clip's parts show (its name and default mark don't; nor
 * its words: they're applied as the clip's words are read — lib/brandWords.ts)
 */
export function brandChanged(a: BrandKitData, b: BrandKitData): boolean {
  const shown = (d: BrandKitData) => ({ ...d, is_default: false, lock: false, words: null })
  return !sameJson(shown(a), shown(b))
}

/** Every place a kit's logo could have been put on a clip */
function brandSpots(logo: BrandKitData['logo']): FrameRect[] {
  if (logo.x !== null) return [logoBox(logo)]
  const corners: LogoCorner[] = ['tl', 'tr', 'bl', 'br']
  return [true, false].flatMap(safe => corners.map(c => logoBox({ ...logo, safe }, 1080, 1920, c)))
}

/**
 * The kit changed since it went on the clip (`old`: its settings then; `kit`: now). The clip follows
 * it: each thing the brand put on is updated where the clip still shows what the kit put there.
 *  - the logo: a new picture, place, size, see-through and timing — a logo the user moved keeps its
 *    place and width (its height follows the new picture's shape); one they deleted stays deleted
 *  - text: the new title font, colour and size where it still has the old ones
 *  - captions: the new look's fields where they're still the old look's
 *  - frames: band colour, text colours, corners and the Branded card's look and words, likewise
 *  - the intro and outro: put in, taken out, or swapped for the kit's new ones (syncBookends)
 *  - the end card: made, taken off, or made again at its new length (syncEndCard)
 * Returns the clip, the brand's record of what it changed (`before`), and the kit's settings as the clip got them.
 */
export function updateBrand(t: BrandTarget, old: BrandKitData, kit: BrandKit, before: BrandBefore | null):
  { target: BrandTarget; before: BrandBefore | null; applied: BrandKitData; note?: string } {
  const n = kit.data

  // The logo (over the clip's own part, between the brand's intro and outro)
  const [a, z] = mainSpan(t, before)
  let overlays = t.overlays
  const had = t.overlays.filter(brandLogos)
  if (had.length) {
    overlays = n.logo.path ? t.overlays.map(o => {
      if (!brandLogos(o)) return o
      // (where the brand put it: any corner — a smart spot moves it — kept clear of the apps' buttons
      // or, a kit from before that, not)
      const placed = brandSpots(old.logo).some(was => near(o.x, was.x) && near(o.y, was.y) && near(o.w, was.w) && near(o.h, was.h))
      const box = brandLogoBox(n.logo, t.avoid)
      const h = Math.min(0.9, (o.w * 1080 * (n.logo.ratio ?? 1)) / 1920)
      const [s0, e0] = logoSpan(old.logo, z - a).map(x => x + a)
      const timed = Math.abs(o.start_ms - s0) <= 1 && Math.abs(o.end_ms - e0) <= 1
      const [s1, e1] = logoSpan(n.logo, z - a).map(x => x + a)
      const oldOpacity = old.logo.opacity < 0.999 ? old.logo.opacity : null
      return {
        ...o, storage_path: n.logo.path, preview_url: kit.logo_url ?? o.preview_url,
        ...(placed ? box : { h }),
        ...(timed ? { start_ms: s1, end_ms: e1 } : {}),
        ...((o.opacity ?? null) === oldOpacity ? { opacity: n.logo.opacity < 0.999 ? n.logo.opacity : null } : {}),
      }
    }) : t.overlays.filter(o => !brandLogos(o))
  } else if (!old.logo.path && n.logo.path) {
    // (the kit had no logo when it went on: its new one goes on now)
    const logo = logoOverlay(t, kit, t.overlays, [a, z])
    if (logo) overlays = [...t.overlays, logo]
  }

  // Text on the clip
  const texts = t.texts.map(x => {
    if (x.locked) return x
    const font = x.font === titleFont(old) && isLatinText(x.text ?? '') ? titleFont(n) : x.font
    const color = x.color === old.title.color ? n.title.color : x.color
    const size = x.size === old.title.size ? n.title.size : x.size
    return font === x.font && color === x.color && size === x.size ? x : { ...x, font, color, size }
  })

  // Captions: the fields still as the old look left them
  let caption = t.caption, textCase = t.textCase
  if (n.captions.on) {
    // (a look that named no font left the captions the one they had: still as the brand left it when it's that one)
    const was = old.captions.on ? { ...brandCaptionStyle(old.captions), font: old.captions.font ?? before?.caption?.font ?? t.caption.font ?? null } as Record<string, unknown> : null
    const now = brandCaptionStyleOn(n.captions, t.caption) as Record<string, unknown>
    const cur = t.caption as unknown as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    for (const k of Object.keys(now)) if (!was || (cur[k] ?? null) === (was[k] ?? null)) patch[k] = now[k]
    caption = { ...t.caption, ...patch } as Partial<CaptionStyle>
    if (!old.captions.on || t.textCase === caseOf(old)) textCase = caseOf(n)
  }

  // Frames the brand is on
  const segments = t.segments.map(seg => {
    if (!brandable(seg, t.mainVideoId)) return seg
    const card = seg.layout === 'frame_brand_card'
    const f = frameOf(seg), band = { ...DEFAULT_BAND, ...f.band }
    const oldBg = bandBgOf(old, card), newBg = bandBgOf(n, card)
    const oldTitle = old.card_title.trim(), newTitle = n.card_title.trim()
    const items = (f.items ?? []).map(it => {
      if (it.locked) return it
      if (it.kind === 'text' && !it.captions) {
        let next = it
        if (it.color === itemColourOf(old, card, it.lane)) next = { ...next, color: itemColourOf(n, card, it.lane) }
        if (old.title.font !== n.title.font && n.title.font && (it.font ?? null) === (old.title.font ?? null)) next = { ...next, font: n.title.font }
        if (isTextLane(it.lane) && it.bg === oldBg) next = { ...next, bg: newBg }
        if (card && it.lane === 'band' && oldTitle && it.text === oldTitle && newTitle) next = { ...next, text: newTitle }
        if (card && it.lane === 'band2' && it.text === showHandle(old.handle) && n.handle) next = { ...next, text: showHandle(n.handle) }
        if (card && it.lane === 'band' && it.size === old.card.title.size) next = { ...next, size: n.card.title.size }
        if (card && it.lane === 'band2' && it.size === old.card.handle.size) next = { ...next, size: n.card.handle.size }
        return next
      }
      if (it.kind !== 'text' && old.frames.corners !== null && n.frames.corners !== null && it.corners === old.frames.corners) return { ...it, corners: n.frames.corners }
      return it
    })
    const frame: FrameSettings = {
      ...f, items,
      band: { ...band, ...(band.bg === oldBg ? { bg: newBg } : {}), ...(band.color === old.title.color ? { color: n.title.color } : {}) },
      ...(card && sameJson(f.card, cardLookOf(old.card)) ? { card: cardLookOf(n.card) } : {}),
      ...(old.frames.corners !== null && n.frames.corners !== null && f.main_corners
        ? { main_corners: Object.fromEntries(Object.entries(f.main_corners).map(([k, v]) => [k, v === old.frames.corners ? n.frames.corners! : v])) }
        : {}),
    }
    return sameJson(frame, f) ? seg : { ...seg, frame }
  })

  const next: BrandTarget = { ...t, overlays, texts, caption, textCase, segments }
  // (a clip on since it was made has no record yet: one starts with its end card)
  const ends = syncBookends(next, kit, before ?? NO_BEFORE)
  const card = syncEndCard(ends.target, kit, ends.before, old)
  // (a clip on since it was made has no record yet: one starts with what the brand put in)
  const recorded = before || card.before.end_card || card.before.intro || card.before.outro ? card.before : before
  const note = ends.note ?? card.note
  return { target: card.target, before: recorded, applied: appliedOf(t, n, old), ...(note ? { note } : {}) }
}
