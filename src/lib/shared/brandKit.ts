/**
 * Brand kits (editor Brand kit tool): a user's saved looks — colours, a logo, an @handle, a title
 * style and a caption style — put on a clip with Apply (EditorShell applyBrandKit), and what a
 * Branded card frame starts with. Saved per account in the brand_kits table (the backend creates it:
 * its index.ts); how many a user can have depends on their plan (BRAND_KIT_LIMITS).
 *
 * The default kit (Phase 1, user 2026-10-17): one kit can be marked default; every new clip gets it
 * by itself — made by hand, from Best moments or Ask AI (server services/brandKits.ts
 * brandNewClips), and by Make my clips (the worker's lib/brandKit.ts mirrors what it puts on).
 *
 * What a kit holds (decided 2026-10-27, brand kit Phase 0): colours, a logo, an @handle, fonts, a
 * title style, a caption look, the Branded card and brand corners, whether it's the default, and its
 * brand lock. The brand sound, brand voice and names & spellings that kits held for a while (taken out
 * of the kit's screens 2026-10-20) are gone from it: a kit saved with them loses them on its next save.
 * Its end card, intro and outro came back in Phase 4 (2026-10-27), now through the brand engine like the
 * rest — under new keys, so what an older kit kept of them doesn't come back on by itself. Its progress
 * bar came back then too, and was taken out for good 2026-11-05 (user): a kit saved with one loses it.
 * Its words (spellings, hidden words, lines, hashtags, tone) came in Phase 5 (2026-10-28: lib/brandWords.ts),
 * under a new key too.
 */
import type { CaptionStyle, AnimationType } from './types'
import { cleanCardLook, DEFAULT_CARD_LOOK, type CardLook } from './brandCard'
import { cleanBrandWords, NO_BRAND_WORDS, type BrandWords } from '../brandWords'

export type LogoCorner = 'tl' | 'tr' | 'bl' | 'br'
/** When the logo shows: the whole clip, or only its first / last seconds */
export type LogoShow = 'all' | 'start' | 'end'

/**
 * A kit's caption look: the same choices as the editor's Captions tool (a caption style and its
 * colours, font, size, capitals, words per line). `on`: new clips and Apply use it.
 */
export interface BrandCaptions {
  on: boolean
  template: string | null
  animation: AnimationType
  font: string | null
  size: number
  color: string
  highlight_color: string
  uppercase: boolean
  /** All small letters (the Capitals "aa" — user, 2026-11-12: it did nothing in the brand kit); never with uppercase */
  lowercase?: boolean
  words_per_line: number | null
}

/**
 * A ready text style of a kit (brand kit rebuild, Phase 3): "+ Text" in the editor adds text in it.
 * `font` null: the kit's title font; `bg`: a box behind it — a colour, 'accent' (the kit's accent
 * colour, as it changes), or null: none.
 */
export interface BrandTextStyle { font: string | null; color: string; size: number; bg: string | null; uppercase: boolean }
/** Which ready style: the kit's title style (`title`), or one of `styles` */
export type BrandTextKind = 'title' | 'subtitle' | 'cta'

/** A kit's caption look besides its main one (Phase 3: up to MAX_MORE_CAPTIONS), with its name */
export interface BrandCaptionLook { id: string; name: string; captions: BrandCaptions }
export const MAX_MORE_CAPTIONS = 2

export interface BrandKitData {
  /**
   * main: the Branded card's background and frame bands; accent: the @handle on the card; extra:
   * up to MAX_EXTRA_COLORS more brand colours — all of them quick picks in the editor's colour choices
   */
  colors: { main: string; accent: string; extra: string[] }
  logo: {
    /** Storage path of the uploaded logo (brand/<user>/…); null = no logo */
    path: string | null
    /** Its height ÷ width, so its box keeps its shape */
    ratio: number | null
    corner: LogoCorner
    /** Placed anywhere (dragged on the kit's preview): its top-left as shares of the frame; null = in its corner */
    x: number | null
    y: number | null
    /** Its width, as a share of the frame's width */
    size: number
    /** 0–1 (1 = solid) */
    opacity: number
    /** The whole clip, or only its first / last `seconds` */
    show: LogoShow
    seconds: number
    /** In its corner, kept clear of the apps' own buttons and header (LOGO_SAFE) — Phase 4 */
    safe: boolean
    /** On each clip, in whichever corner is clear of its captions and faces, the kit's corner first (pickLogoCorner) — Phase 4 */
    smart: boolean
  }
  captions: BrandCaptions
  /**
   * The kit's own fonts (uploaded TTF / OTF, up to MAX_BRAND_FONTS): "BrandFont-<id>" is the family
   * name text and captions use (the file is brand/<user>/fonts/<id>); `name` is what the user calls it
   */
  fonts: BrandFont[]
  /** The channel's @handle (shown on the Branded card) */
  handle: string
  /** Frame titles and text on the clip: font family (null = the default), colour and size (px at 1080 wide) */
  title: { font: string | null; color: string; size: number }
  /** Its other ready text styles: a subtitle and a call to action ("Follow for more") */
  styles: { subtitle: BrandTextStyle; cta: BrandTextStyle }
  /** More caption looks besides `captions` ("Bold for hooks"…), switched to in one tap in the editor */
  more_captions: BrandCaptionLook[]
  /** The Branded card's title */
  card_title: string
  /**
   * The Branded card, as the brand wants it (user, 2026-10-19: the one frame a kit customizes): its
   * look (background — a colour, a gradient or a pattern — and where the video, title and @handle
   * sit: brandCard.ts) and its title's and @handle's colour and size, and whether each shows
   */
  card: BrandCardSettings
  /** The account's default kit: new clips get it by themselves (at most one kit is) */
  is_default: boolean
  /**
   * Brand corners: a rounding (0–100, the Corners slider) the brand puts on every frame of a clip it's
   * on, and frames picked while it's on; null = frames keep their own. (The kit's own list of frames,
   * shown first in the Frames tool, was dropped 2026-10-19: the brand shows on whatever is picked.)
   */
  frames: { corners: number | null }
  /** Brand lock: the people the kit is shared with can pick only its colours and fonts (brandLockOf) */
  lock: boolean
  /**
   * How the brand ends and starts its clips (Phase 4): an end card — the clip's last `seconds` made its
   * Branded card (modules/brand/endCard.ts) — and an intro and outro: videos of the user's library put
   * in before and after it (their ids; null: none)
   */
  ends: BrandEnds
  /**
   * How the brand writes (Phase 5, lib/brandWords.ts): names captions spell its way, words never shown,
   * its calls to action, hashtags and tone — on the clips it's on (and, the default kit's, on clips with none)
   */
  words: BrandWords
}

export interface BrandEnds { card: boolean; seconds: number; intro: BrandEndVideo | null; outro: BrandEndVideo | null }
/** An intro or outro: a video of the library, its length (ms) and its name as picked */
export interface BrandEndVideo { id: string; ms: number; title: string }
/** Whether a kit's end card, intro and outro are added to clips. Off (user, 2026-11-10: their step is gone): what a kit saved stays with it, and what's on a clip stays until the brand comes off */
export const BRAND_ENDS_ON = false
/** How long an end card is (s) */
export const END_CARD_SECONDS: [number, number] = [2, 8]
/** The longest video an intro or outro can be (ms) */
export const MAX_END_VIDEO_MS = 30_000

/** The Branded card a kit customizes: its look, and its title's and @handle's colour, size and whether each shows */
export interface BrandCardSettings extends CardLook {
  title: { show: boolean; color: string; size: number }
  handle: { show: boolean; color: string; size: number }
}
export const CARD_TEXT_SIZE: [number, number] = [24, 120]

export interface BrandKit {
  id: string
  name: string
  data: BrandKitData
  /** A signed link to the logo — for showing it only, never saved */
  logo_url?: string | null
  /** A kit someone shared with this user: who (their name or email) */
  shared_by?: string | null
  /** A shared kit: what this user can do with it (Phase 6, brandTeam.ts) — use it on clips, or change it too */
  role?: 'use' | 'edit'
}

/** How many brand kits each plan can have (user, 2026-10-17); a plan not listed gets the Free count */
export const BRAND_KIT_LIMITS: Record<string, number> = { free: 1, student: 1, starter: 2, creator: 5, agency: 15 }
export const brandKitLimit = (plan: string | null | undefined) => BRAND_KIT_LIMITS[plan ?? 'free'] ?? BRAND_KIT_LIMITS.free

export const LOGO_SIZE: [number, number] = [0.06, 0.5]
export interface BrandFont { family: string; name: string }

/** How many fonts a kit can hold */
export const MAX_BRAND_FONTS = 4
const BRAND_FONT = /^BrandFont-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** A font value that is a brand kit's own font */
export const isBrandFont = (family: string | null | undefined) => !!family && BRAND_FONT.test(family)
/** Where a brand font's file is kept (the render job reads it there too) */
export const brandFontKey = (userId: string, family: string) => `brand/${userId}/fonts/${family.slice('BrandFont-'.length).toLowerCase()}`

/** The logo shown only at the start or end: for this long (s) */
export const LOGO_SECONDS: [number, number] = [1, 15]
/** More brand colours besides the main and accent */
export const MAX_EXTRA_COLORS = 3
/** Space between the logo and the frame's edge, as a share of the frame's width */
export const LOGO_MARGIN = 0.04

// (size 58: the caption size a new kit starts at — user, 2026-11-12)
export const DEFAULT_BRAND_CAPTIONS: BrandCaptions = {
  on: false, template: null, animation: 'karaoke', font: null, size: 58, color: '#ffffff', highlight_color: '#ffe700',
  uppercase: false, words_per_line: null,
}

export const DEFAULT_BRAND_KIT: BrandKitData = {
  colors: { main: '#1c1c22', accent: '#c8ff00', extra: [] },
  logo: { path: null, ratio: null, corner: 'tr', x: null, y: null, size: 0.18, opacity: 0.9, show: 'all', seconds: 3, safe: true, smart: true },
  captions: DEFAULT_BRAND_CAPTIONS,
  frames: { corners: null },
  lock: false,
  fonts: [],
  handle: '',
  title: { font: null, color: '#ffffff', size: 64 },
  styles: {
    subtitle: { font: null, color: '#ffffff', size: 44, bg: null, uppercase: false },
    cta: { font: null, color: '#0a0a0a', size: 48, bg: 'accent', uppercase: true },
  },
  more_captions: [],
  card_title: '',
  card: { ...DEFAULT_CARD_LOOK, title: { show: true, color: '#ffffff', size: 64 }, handle: { show: true, color: '#c8ff00', size: 40 } },
  is_default: false,
  ends: { card: false, seconds: 3, intro: null, outro: null },
  words: NO_BRAND_WORDS,
}

const ANIMATIONS: AnimationType[] = ['karaoke', 'fade', 'none', 'pop', 'highlight', 'bounce', 'word', 'hormozi', 'box', 'glow']

const HEX = /^#[0-9a-f]{6}$/i
const color = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback)
const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** Whether two intros (or outros) are the same video at the same length */
export const sameEndVideo = (a: BrandEndVideo | null, b: BrandEndVideo | null) => (a?.id ?? null) === (b?.id ?? null) && (a?.ms ?? 0) === (b?.ms ?? 0)

function endVideoOf(raw: unknown): BrandEndVideo | null {
  const v = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  if (!v || typeof v.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(v.id) || typeof v.ms !== 'number' || !(v.ms >= 300)) return null
  return { id: v.id.toLowerCase(), ms: Math.round(Math.min(MAX_END_VIDEO_MS, v.ms)), title: text(v.title, 80) }
}

/** A kit's settings as they may be saved: anything missing or wrong takes the default */
export function cleanBrandKitData(raw: unknown, userId?: string): BrandKitData {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const def = DEFAULT_BRAND_KIT
  const logo = (d.logo && typeof d.logo === 'object' ? d.logo : {}) as Record<string, unknown>
  // Only the user's own uploads (brand/<user>/…)
  const path = typeof logo.path === 'string' && (!userId || logo.path.startsWith(`brand/${userId}/`)) && !logo.path.includes('..') ? logo.path : null
  const cap = (d.captions && typeof d.captions === 'object' ? d.captions : {}) as Record<string, unknown>
  const dc = DEFAULT_BRAND_CAPTIONS
  const placed = typeof logo.x === 'number' && typeof logo.y === 'number' && isFinite(logo.x) && isFinite(logo.y)
  return {
    colors: {
      main: color(d.colors?.main, def.colors.main), accent: color(d.colors?.accent, def.colors.accent),
      extra: (Array.isArray(d.colors?.extra) ? d.colors.extra : []).filter((c: unknown) => typeof c === 'string' && HEX.test(c))
        .map((c: string) => c.toLowerCase()).slice(0, MAX_EXTRA_COLORS),
    },
    logo: {
      path,
      ratio: path ? num(logo.ratio, 0.05, 20, 1) : null,
      corner: (['tl', 'tr', 'bl', 'br'] as const).includes(logo.corner as LogoCorner) ? logo.corner as LogoCorner : def.logo.corner,
      x: placed ? num(logo.x, 0, 1, 0) : null,
      y: placed ? num(logo.y, 0, 1, 0) : null,
      size: num(logo.size, LOGO_SIZE[0], LOGO_SIZE[1], def.logo.size),
      opacity: num(logo.opacity, 0.1, 1, def.logo.opacity),
      show: (['all', 'start', 'end'] as const).includes(logo.show as LogoShow) ? logo.show as LogoShow : def.logo.show,
      seconds: Math.round(num(logo.seconds, LOGO_SECONDS[0], LOGO_SECONDS[1], def.logo.seconds)),
      // (on unless switched off: a kit from before these keeps clear and moves off faces too)
      safe: logo.safe !== false,
      smart: logo.smart !== false,
    },
    captions: {
      on: cap.on === true,
      template: typeof cap.template === 'string' && cap.template.length <= 60 ? cap.template : null,
      animation: ANIMATIONS.includes(cap.animation as AnimationType) ? cap.animation as AnimationType : dc.animation,
      font: typeof cap.font === 'string' && cap.font.length <= 60 ? cap.font : null,
      size: Math.round(num(cap.size, 20, 100, dc.size)),
      color: color(cap.color, dc.color),
      highlight_color: color(cap.highlight_color, dc.highlight_color),
      uppercase: cap.uppercase === true,
      lowercase: cap.lowercase === true && cap.uppercase !== true,
      words_per_line: typeof cap.words_per_line === 'number' ? Math.round(num(cap.words_per_line, 1, 10, 3)) : null,
    },
    fonts: (Array.isArray(d.fonts) ? d.fonts : [])
      .filter((f: any) => f && isBrandFont(f.family))
      .map((f: any) => ({ family: String(f.family), name: text(f.name, 40).trim() || 'Brand font' }))
      .filter((f: BrandFont, i: number, all: BrandFont[]) => all.findIndex(x => x.family === f.family) === i)
      .slice(0, MAX_BRAND_FONTS),
    handle: text(d.handle, 40).replace(/\s+/g, ''),
    title: {
      font: typeof d.title?.font === 'string' && d.title.font.length <= 60 ? d.title.font : null,
      color: color(d.title?.color, def.title.color),
      size: Math.round(num(d.title?.size, 24, 160, def.title.size)),
    },
    styles: {
      subtitle: cleanTextStyle(d.styles?.subtitle, def.styles.subtitle),
      cta: cleanTextStyle(d.styles?.cta, def.styles.cta),
    },
    more_captions: (Array.isArray(d.more_captions) ? d.more_captions : [])
      .filter((x: any) => x && typeof x === 'object')
      .map((x: any, i: number) => ({ ...x, id: typeof x.id === 'string' && /^[\w-]{1,40}$/.test(x.id) ? x.id : `look-${i + 1}` }))
      .filter((x: any, i: number, all: any[]) => all.findIndex(y => y.id === x.id) === i)
      .slice(0, MAX_MORE_CAPTIONS)
      // (named after the ones kept: the main look is the first)
      .map((x: any, i: number): BrandCaptionLook => ({ id: x.id, name: text(x.name, 30).trim() || `Look ${i + 2}`, captions: cleanCaptions(x.captions) })),
    card_title: text(d.card_title, 80),
    // (a kit from before its card was customized: the card as it looked then — the main colour,
    // the title style's colour and size, the accent on the @handle)
    card: cleanCard(d.card, {
      ...DEFAULT_CARD_LOOK, bg: { ...DEFAULT_CARD_LOOK.bg, color: color(d.colors?.main, def.colors.main) },
      title: { show: true, color: color(d.title?.color, def.title.color), size: Math.round(num(d.title?.size, CARD_TEXT_SIZE[0], CARD_TEXT_SIZE[1], def.title.size)) },
      handle: { show: true, color: color(d.colors?.accent, def.colors.accent), size: 40 },
    }),
    is_default: d.is_default === true,
    ends: {
      card: d.ends?.card === true,
      seconds: Math.round(num(d.ends?.seconds, END_CARD_SECONDS[0], END_CARD_SECONDS[1], def.ends.seconds)),
      intro: endVideoOf(d.ends?.intro),
      outro: endVideoOf(d.ends?.outro),
    },
    words: cleanBrandWords(d.words),
    frames: {
      corners: typeof d.frames?.corners === 'number' && isFinite(d.frames.corners) ? Math.round(num(d.frames.corners, 0, 100, 80)) : null,
    },
    lock: d.lock === true,
  }
}

/** A ready text style made safe; anything missing or wrong takes `fallback`'s */
function cleanTextStyle(raw: unknown, fallback: BrandTextStyle): BrandTextStyle {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    font: typeof t.font === 'string' && t.font.length <= 60 ? t.font : null,
    color: color(t.color, fallback.color),
    size: Math.round(num(t.size, 20, 160, fallback.size)),
    // (not saved yet — a kit from before styles — the default; saved as none: none)
    bg: t.bg === undefined ? fallback.bg : t.bg === 'accent' ? 'accent' : typeof t.bg === 'string' && HEX.test(t.bg) ? t.bg.toLowerCase() : null,
    uppercase: typeof t.uppercase === 'boolean' ? t.uppercase : fallback.uppercase,
  }
}

/** A caption look made safe (as a kit's main one) */
function cleanCaptions(raw: unknown): BrandCaptions {
  const cap = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const dc = DEFAULT_BRAND_CAPTIONS
  return {
    on: true,
    template: typeof cap.template === 'string' && cap.template.length <= 60 ? cap.template : null,
    animation: ANIMATIONS.includes(cap.animation as AnimationType) ? cap.animation as AnimationType : dc.animation,
    font: typeof cap.font === 'string' && cap.font.length <= 60 ? cap.font : null,
    size: Math.round(num(cap.size, 20, 100, dc.size)),
    color: color(cap.color, dc.color),
    highlight_color: color(cap.highlight_color, dc.highlight_color),
    uppercase: cap.uppercase === true,
    lowercase: cap.lowercase === true && cap.uppercase !== true,
    words_per_line: typeof cap.words_per_line === 'number' ? Math.round(num(cap.words_per_line, 1, 10, 3)) : null,
  }
}

/**
 * A kit's ready text style as it goes on text (Phase 3): the title style, or its subtitle or call to
 * action with their gaps filled — no font of their own: the title's; a box in the accent colour: that
 * colour now
 */
export function brandTextStyle(d: BrandKitData, kind: BrandTextKind): BrandTextStyle {
  if (kind === 'title') return { font: d.title.font, color: d.title.color, size: d.title.size, bg: null, uppercase: false }
  // (a kit read before it had styles — an editor open since before an update — the defaults)
  const st = d.styles?.[kind] ?? DEFAULT_BRAND_KIT.styles[kind]
  return { ...st, font: st.font ?? d.title.font, bg: st.bg === 'accent' ? d.colors.accent : st.bg }
}

/** A kit's caption looks: its main one first (id 'main', named "Main"), then the others */
export const brandCaptionLooks = (d: BrandKitData): BrandCaptionLook[] =>
  [{ id: 'main', name: 'Main', captions: d.captions }, ...(d.more_captions ?? [])]

/** A kit's Branded card settings made safe; anything missing or wrong takes `fallback`'s */
function cleanCard(raw: unknown, fallback: BrandCardSettings): BrandCardSettings {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const textOf = (t: any, f: BrandCardSettings['title']) => ({
    show: typeof t?.show === 'boolean' ? t.show : f.show,
    color: color(t?.color, f.color),
    size: Math.round(num(t?.size, CARD_TEXT_SIZE[0], CARD_TEXT_SIZE[1], f.size)),
  })
  return { ...cleanCardLook(d, fallback), title: textOf(d.title, fallback.title), handle: textOf(d.handle, fallback.handle) }
}

/** The look a Branded card section carries (FrameSettings.card) from a kit's card settings */
export const cardLookOf = (c: BrandCardSettings): CardLook => ({ bg: c.bg, video: c.video, title_at: c.title_at, handle_at: c.handle_at })

/**
 * What a brand lock leaves the people a kit is shared with: its colours (the palette, and its caption
 * colours) and its fonts (its own fonts, its title and caption fonts). No fonts named: fonts stay free.
 */
export function brandLockOf(d: BrandKitData): { colors: string[]; fonts: string[] } {
  return {
    colors: [...new Set([...brandPalette(d), d.captions.color, d.captions.highlight_color].map(c => c.toLowerCase()))],
    fonts: [...new Set([...d.fonts.map(f => f.family), d.title.font, d.captions.font].filter((f): f is string => !!f))],
  }
}

/** The kit's colours, for quick picks in the editor's colour choices: main, accent, title, then the extra ones (no repeats) */
export function brandPalette(d: BrandKitData): string[] {
  return [...new Set([d.colors.main, d.colors.accent, d.title.color, ...d.colors.extra].map(c => c.toLowerCase()))]
}

/** The caption style fields a kit puts on a clip (its captions switched on in the kit), as the editor saves them */
/** A kit's captions' capitals: First letter capital, ALL CAPITALS or all small letters */
export const captionCaseOf = (c: BrandCaptions): 'title' | 'upper' | 'lower' => (c.uppercase ? 'upper' : c.lowercase ? 'lower' : 'title')

export function brandCaptionStyle(c: BrandCaptions): Partial<CaptionStyle> {
  return {
    template: c.template, animation: c.animation, font: c.font, size: c.size, color: c.color,
    highlight_color: c.highlight_color, uppercase: c.uppercase, words_per_line: c.words_per_line,
  }
}

/** The caption style a kit gives captions styled `cur`: a kit that names no font leaves them the one they have */
export function brandCaptionStyleOn(c: BrandCaptions, cur: Partial<CaptionStyle>): Partial<CaptionStyle> {
  return { ...brandCaptionStyle(c), font: c.font ?? cur.font ?? null } as Partial<CaptionStyle>
}

/** When the logo shows on a clip `lengthMs` long: [start, end] ms */
export function logoSpan(logo: BrandKitData['logo'], lengthMs: number): [number, number] {
  const len = Math.max(0, Math.round(lengthMs))
  const s = Math.min(len, logo.seconds * 1000)
  return logo.show === 'start' ? [0, s] : logo.show === 'end' ? [len - s, len] : [0, len]
}

/** The @handle as shown: one leading @ */
export const showHandle = (handle: string) => (handle ? `@${handle.replace(/^@+/, '')}` : '')

/**
 * What Instagram Reels and YouTube Shorts draw over a video (shares of the 9:16 frame, the larger of
 * the two: the editor's PlatformOverlay PLATFORM_SAFE): the header along the top, the name and caption
 * along the bottom, the like / comment / share column down the right from `rightFrom`, and a thin edge.
 * A logo kept clear (logo.safe) sits inside it.
 */
export const LOGO_SAFE = { top: 0.08, bottom: 0.13, right: 0.14, rightFrom: 0.45, edge: 0.035 }

/** A box on the frame, as shares of it */
export interface FrameRect { x: number; y: number; w: number; h: number }

const r4 = (v: number) => Math.round(v * 10000) / 10000

/**
 * Where a kit's logo sits on the 1080 × 1920 frame (shares of the frame, like a photo on the clip):
 * its width, its height from its shape, in its corner (`corner`, else the kit's) a margin in from the
 * edges — kept clear of the apps' buttons (logo.safe): below their header, above their caption, left
 * of their button column.
 */
export function logoBox(logo: BrandKitData['logo'], frameW = 1080, frameH = 1920, corner: LogoCorner = logo.corner): FrameRect {
  const w = logo.size
  const h = Math.min(0.9, (w * frameW * (logo.ratio ?? 1)) / frameH)
  const safe = logo.safe !== false
  const mx = safe ? Math.max(LOGO_MARGIN, LOGO_SAFE.edge) : LOGO_MARGIN
  const top = safe ? LOGO_SAFE.top : (LOGO_MARGIN * frameW) / frameH
  const bottom = safe ? LOGO_SAFE.bottom : (LOGO_MARGIN * frameW) / frameH
  // (bottom right: left of the button column, which runs down the right from `rightFrom`)
  const right = safe && corner === 'br' ? LOGO_SAFE.right : mx
  // Placed anywhere (dragged): there, kept inside the frame; else in its corner
  const x = logo.x !== null ? Math.min(1 - w, Math.max(0, logo.x)) : corner.endsWith('l') ? mx : 1 - right - w
  const y = logo.y !== null ? Math.min(1 - h, Math.max(0, logo.y)) : corner.startsWith('t') ? top : 1 - bottom - h
  return { x: r4(x), y: r4(y), w: r4(w), h: r4(h) }
}

/** A logo as a watermark (Phase 4): small, faint, the whole clip, clear of the apps' buttons */
export const WATERMARK = { size: 0.12, opacity: 0.5, show: 'all', safe: true } as const satisfies Partial<BrandKitData['logo']>
export const isWatermark = (logo: BrandKitData['logo']) =>
  Math.abs(logo.size - WATERMARK.size) < 0.005 && Math.abs(logo.opacity - WATERMARK.opacity) < 0.01 && logo.show === WATERMARK.show && logo.safe

/** How much two boxes overlap (a share of the frame's area) */
const overlapArea = (a: FrameRect, b: FrameRect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

/**
 * The corner a kit's logo is clearest in on a clip (Phase 4, "smart spot"): the kit's own corner when
 * nothing is in the way there, else the corner covering the least of what's to `avoid` — its captions,
 * the faces in it — the kit's corner winning a tie
 */
export function pickLogoCorner(logo: BrandKitData['logo'], avoid: FrameRect[]): LogoCorner {
  const order = [...new Set<LogoCorner>([logo.corner, 'tr', 'tl', 'br', 'bl'])]
  const cost = (c: LogoCorner) => { const b = logoBox(logo, 1080, 1920, c); return avoid.reduce((t, a) => t + overlapArea(b, a), 0) }
  const scored = order.map(c => ({ c, v: cost(c) }))
  const clear = scored.find(x => x.v < 1e-4)
  return (clear ?? scored.reduce((best, x) => (x.v < best.v - 1e-6 ? x : best))).c
}

/** Where a kit's logo goes on a clip: placed by hand — there; else in its corner, or the clearest one (logo.smart) */
export function brandLogoBox(logo: BrandKitData['logo'], avoid: FrameRect[] = []): FrameRect {
  if (logo.x !== null || !logo.smart || !avoid.length) return logoBox(logo)
  return logoBox(logo, 1080, 1920, pickLogoCorner(logo, avoid))
}

/**
 * The band captions take up on the frame (a little taller than a line or two of them), from where
 * they sit (`y`: their middle, a share of the frame's height): for the logo to keep off
 */
export const captionBand = (y: number): FrameRect => ({ x: 0.06, y: Math.max(0, y - 0.08), w: 0.88, h: 0.16 })

// ── Making a kit in a minute (brand kit rebuild, Phase 1) ─────────────────────

/** What a website or profile link gave (server services/brandFromLink.ts) */
export interface LinkBrand {
  /** Where it was read from (the site's host) */
  source: string
  name: string | null
  handle: string | null
  logo: { path: string; url: string | null; ratio: number | null } | null
  /** `extra`: more of the brand's colours, after the main and accent (none alike) */
  colors: { main: string; accent: string | null; extra: string[] } | null
  /** The site's heading and body fonts as editor fonts (VIDEO_FONTS); null when none was found */
  fonts: { heading: string | null; body: string | null } | null
}

/**
 * What one way of making a kit found — a link or an uploaded logo —
 * each part only when it was found
 */
export interface FoundBrand {
  name?: string | null
  handle?: string | null
  logo?: { path: string; ratio: number | null } | null
  colors?: { main: string; accent: string | null; extra: string[] } | null
  /** The title font */
  font?: string | null
}

/** What a link gave, as found brand parts */
export const foundFromLink = (b: LinkBrand): FoundBrand => ({
  name: b.name, handle: b.handle, logo: b.logo ? { path: b.logo.path, ratio: b.logo.ratio } : null,
  colors: b.colors, font: b.fonts?.heading ?? b.fonts?.body ?? null,
})

/**
 * A kit with what was found put in (the setup and the kit's workshop alike): the logo, colours and
 * title font that were found take their place; the name, @handle and Branded card title go in only
 * where the kit has none yet (they're the user's words)
 */
export function withFoundBrand(cur: BrandKitData, f: FoundBrand): BrandKitData {
  return {
    ...cur,
    handle: cur.handle || (f.handle ?? '').replace(/^@+/, '').replace(/\s+/g, '').slice(0, 40),
    card_title: cur.card_title || (f.name ?? '').slice(0, 80),
    colors: f.colors
      ? { main: f.colors.main, accent: f.colors.accent ?? cur.colors.accent, extra: f.colors.extra.length ? f.colors.extra.slice(0, MAX_EXTRA_COLORS) : cur.colors.extra }
      : cur.colors,
    logo: f.logo ? { ...cur.logo, path: f.logo.path, ratio: f.logo.ratio ?? cur.logo.ratio ?? 1 } : cur.logo,
    title: f.font ? { ...cur.title, font: f.font } : cur.title,
  }
}

/** What was found, named for the user ("logo, colours, font, name") */
export const foundList = (f: FoundBrand) =>
  [f.logo && 'logo', f.colors && 'colours', f.font && 'font', f.name && 'name', f.handle && '@handle'].filter((x): x is string => !!x)

/** A clip's photo that is a brand kit's logo (Apply replaces it) */
export const isBrandLogo = (storagePath: string | null | undefined) => !!storagePath && storagePath.startsWith('brand/')
