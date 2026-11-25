import type { Overlay, TextOverlay } from './types'
import { wrapTextLines, TEXT_LINE_EM, BG_PAD } from '@/modules/editor/textStyle'

/**
 * Templates (user, 2026-11-22): ready-made pieces the user drops on a clip and adjusts — to grow the account
 * (Follow, a handle tag, Comment KEYWORD, Like/Share/Save, Part 2, Watch the full video), to say who's talking
 * (name tag, podcast speaker or show, credit), for business (contact card, WhatsApp, offer, location, event) and
 * for structure and trust (tip/step/myth/fact, disclaimer, stat, quote, question, hook). Researched list:
 * 2026-11-22; the progress bar left out (removed by the user 2026-11-10, and the export can't grow a bar).
 *
 * Each is built from parts the editor and the export already draw the same way: texts with their Text-tool look
 * (a rounded box, a colour, an entrance; emoji drawn as Twemoji by both) and photos (a round photo or logo, a
 * platform's icon), joined as one group on the timeline. Pure, so the editor and the brand kit make them alike.
 *
 *  - The template's settings (its words, colours, photo, animation) ride on its first text (`tpl`, kept in the
 *    text's saved look). That first text is its anchor: a panel, a pill, or an invisible box round the rest —
 *    the template is made again from where it is now when its settings change.
 *  - Every text of it carries `tpl_id`, so a brand kit's title look leaves them alone (brand engine).
 *
 * Sizes are px at 1080 × 1920 (as the editor's texts); places a share of the frame. Text is drawn from its left
 * edge (preview and export alike), so centred lines are placed with their measured width (`measure`). Everything
 * stays in the apps' safe zone: off the right-hand buttons and the bottom caption area.
 */

// ── The kinds ───────────────────────────────────────────────────────────────

export type TemplateGroup = 'grow' | 'who' | 'business' | 'structure'
export const TEMPLATE_GROUPS: { id: TemplateGroup; name: string }[] = [
  { id: 'grow', name: 'Grow your account' },
  { id: 'who', name: 'Who’s talking' },
  { id: 'business', name: 'Business' },
  { id: 'structure', name: 'Structure & trust' },
]

export interface FieldDef { key: string; label: string; max: number; placeholder?: string; hint?: string }
interface KindDef {
  group: TemplateGroup
  name: string
  /** Its styles: id → name (the first is the default) */
  variants: Record<string, string>
  fields: FieldDef[]
  /** Starting words; a style can change some */
  defaults: Record<string, string>
  byVariant?: Record<string, Record<string, string>>
  /** The colours it starts with ("kit": the brand kit's) and what the panel calls them */
  colors: { main: string; accent: string; mainLabel: string; accentLabel: string | null }
  /** It has a round photo (the kit's logo, or one the user picks) */
  photo?: boolean
  /** Over the whole clip when put on (a style can say) */
  whole?: boolean | ((variant: string) => boolean)
  /** A platform icon a style shows */
  icon?: (variant: string) => TemplateIconName | null
}
export type TemplateIconName = 'instagram' | 'youtube' | 'whatsapp'

const F = (key: string, label: string, max: number, placeholder?: string, hint?: string): FieldDef => ({ key, label, max, placeholder, hint })
const DARK = '#111114'

export const TEMPLATE_KINDS = {
  follow: {
    group: 'grow', name: 'Follow / Subscribe', variants: { instagram: 'Instagram', youtube: 'YouTube', plain: 'Plain' },
    fields: [F('handle', 'Handle', 40, '@yourname'), F('button', 'Button', 16, 'Follow')],
    defaults: { handle: '@yourname', button: 'Follow' }, byVariant: { youtube: { button: 'Subscribe' } },
    colors: { main: '#ffffff', accent: 'kit', mainLabel: 'Pill', accentLabel: 'Button (plain)' }, photo: true,
    icon: v => (v === 'instagram' || v === 'youtube' ? v : null),
  },
  handle: {
    group: 'grow', name: 'Handle tag', variants: { instagram: 'Instagram', youtube: 'YouTube', plain: 'Plain' },
    fields: [F('handle', 'Handle', 40, '@yourname')], defaults: { handle: '@yourname' },
    colors: { main: '#000000', accent: 'kit', mainLabel: 'Tag', accentLabel: null }, whole: true,
    icon: v => (v === 'instagram' || v === 'youtube' ? v : null),
  },
  comment: {
    group: 'grow', name: 'Comment keyword', variants: { keyword: 'Keyword' },
    fields: [F('before', 'First line', 30, 'Comment'), F('keyword', 'Keyword', 16, 'GUIDE'), F('after', 'Last line', 50, 'and I’ll send it to you')],
    defaults: { before: 'Comment', keyword: 'GUIDE', after: 'and I’ll send it to you 👇' },
    colors: { main: DARK, accent: 'kit', mainLabel: 'Card', accentLabel: 'Keyword' },
  },
  engage: {
    group: 'grow', name: 'Like · Share · Save', variants: { share: 'Share', save: 'Save', like: 'Like', all: 'All three' },
    fields: [F('text', 'Words', 50)], defaults: { text: '📤 Send this to a friend who needs it' },
    byVariant: { save: { text: '🔖 Save this for later' }, like: { text: '❤️ Like if this helped' }, all: { text: '❤️ Like · 💬 Comment · 📤 Share' } },
    colors: { main: '#ffffff', accent: 'kit', mainLabel: 'Pill', accentLabel: null },
  },
  series: {
    group: 'grow', name: 'Part 2 / Series', variants: { badge: 'Part badge', next: 'Follow for next part' },
    fields: [F('part', 'Part', 4, '1'), F('total', 'Of', 4, '3', 'Leave empty for just "Part 1"'), F('text', 'Words (next part)', 40, 'Follow for Part 2 👉')],
    defaults: { part: '1', total: '3', text: 'Follow for Part 2 👉' },
    colors: { main: DARK, accent: 'kit', mainLabel: 'Pill', accentLabel: 'Badge' }, whole: v => v === 'badge',
  },
  fullvideo: {
    group: 'grow', name: 'Watch the full video', variants: { youtube: 'Full video ↓', episode: 'Full episode ↓', bio: 'Link in bio ↑' },
    fields: [F('text', 'Words', 40)], defaults: { text: 'Watch the full video' },
    byVariant: { episode: { text: 'Full episode' }, bio: { text: 'Link in bio' } },
    colors: { main: DARK, accent: 'kit', mainLabel: 'Pill', accentLabel: 'Arrow' },
    icon: v => (v === 'youtube' ? 'youtube' : null),
  },
  nametag: {
    group: 'who', name: 'Name tag', variants: { band: 'Band', clean: 'Card' },
    fields: [F('name', 'Name', 40, 'Dr. Your Name'), F('title', 'Title', 50, 'Consultant'), F('org', 'Organisation (optional)', 50)],
    defaults: { name: 'Your name', title: 'Your title', org: '' },
    colors: { main: '#ffffff', accent: 'kit', mainLabel: 'Band / card', accentLabel: 'Title' },
  },
  podcast: {
    group: 'who', name: 'Podcast', variants: { speaker: 'Speaker tag', show: 'Show badge' },
    fields: [F('label', 'Label (speaker)', 12, 'GUEST'), F('name', 'Name (speaker)', 40), F('show', 'Show (badge)', 40), F('episode', 'Episode (badge)', 10, '42')],
    defaults: { label: 'GUEST', name: 'Guest name', show: 'Your Podcast', episode: '1' },
    colors: { main: '#ffffff', accent: 'kit', mainLabel: 'Name / badge', accentLabel: 'Label' }, whole: v => v === 'show',
  },
  credit: {
    group: 'who', name: 'Credit / source', variants: { creator: 'Credit', source: 'Source' },
    fields: [F('text', 'Words', 60)], defaults: { text: '🎥 Credit: @originalcreator' }, byVariant: { source: { text: 'From: Podcast name · Ep 42' } },
    colors: { main: '#000000', accent: 'kit', mainLabel: 'Tag', accentLabel: null }, whole: true,
  },
  contact: {
    group: 'business', name: 'Contact card', variants: { card: 'Card', end: 'End screen' },
    fields: [F('name', 'Name', 40, 'Dr. Your Name'), F('role', 'Role', 50, 'Consultant Endocrinologist'), F('cta', 'Call to action', 40, 'Book an appointment'),
      F('phone', 'Phone', 24, '+91 98765 43210', 'Shown only if you type it'), F('website', 'Website (optional)', 40, 'yourclinic.com')],
    defaults: { name: 'Your name', role: 'Your role', cta: 'Book an appointment', phone: '', website: '' },
    colors: { main: 'kit', accent: 'kit', mainLabel: 'Background', accentLabel: 'Call to action' }, photo: true,
  },
  whatsapp: {
    group: 'business', name: 'WhatsApp', variants: { chat: 'Chat' },
    fields: [F('label', 'Words', 40, 'Chat with us on WhatsApp'), F('number', 'Number', 24, '+91 98765 43210', 'Shown only if you type it')],
    defaults: { label: 'Chat with us on WhatsApp', number: '' },
    colors: { main: DARK, accent: '#25D366', mainLabel: 'Card', accentLabel: 'Number' }, icon: () => 'whatsapp',
  },
  offer: {
    group: 'business', name: 'Offer', variants: { badge: 'Badge' },
    fields: [F('tag', 'Tag', 24, 'LIMITED OFFER'), F('title', 'Offer', 40, 'Free consultation'), F('code', 'Code / detail (optional)', 40, 'Code: FIRST20')],
    defaults: { tag: 'LIMITED OFFER', title: 'Free consultation', code: '' },
    colors: { main: DARK, accent: 'kit', mainLabel: 'Card', accentLabel: 'Tag' },
  },
  location: {
    group: 'business', name: 'Location', variants: { card: 'Card' },
    fields: [F('place', 'Place', 40, 'Your Clinic'), F('address', 'Address', 60, 'Area, City'), F('timings', 'Timings (optional)', 40, 'Mon–Sat · 10 AM–7 PM')],
    defaults: { place: 'Your place', address: 'Area, City', timings: '' },
    colors: { main: DARK, accent: 'kit', mainLabel: 'Card', accentLabel: 'Timings' },
  },
  event: {
    group: 'business', name: 'Event / Live', variants: { live: 'Live', webinar: 'Webinar' },
    fields: [F('tag', 'Tag', 20), F('title', 'Title', 50), F('when', 'When', 40, 'Sunday · 7 PM')],
    defaults: { tag: '🔴 LIVE', title: 'Ask me anything', when: 'Sunday · 7 PM' }, byVariant: { webinar: { tag: 'FREE WEBINAR', title: 'Your webinar title' } },
    colors: { main: DARK, accent: 'kit', mainLabel: 'Card', accentLabel: 'When' },
  },
  tip: {
    group: 'structure', name: 'Tip / Step / Myth / Fact', variants: { tip: 'Tip', step: 'Step', myth: 'Myth', fact: 'Fact' },
    fields: [F('label', 'Label', 16), F('text', 'Line under it (optional)', 60)],
    defaults: { label: 'TIP 1', text: '' }, byVariant: { step: { label: 'STEP 1 / 3' }, myth: { label: 'MYTH' }, fact: { label: 'FACT' } },
    colors: { main: DARK, accent: 'kit', mainLabel: 'Line', accentLabel: 'Label' },
  },
  disclaimer: {
    group: 'structure', name: 'Disclaimer', variants: { health: 'Health', finance: 'Finance', custom: 'Your own' },
    fields: [F('text', 'Words', 140)], defaults: { text: 'For information only. Please consult your doctor before making any changes.' },
    byVariant: { finance: { text: 'For education only, not financial advice. Please do your own research.' }, custom: { text: 'Your disclaimer' } },
    colors: { main: '#000000', accent: 'kit', mainLabel: 'Bar', accentLabel: null }, whole: true,
  },
  stat: {
    group: 'structure', name: 'Stat', variants: { big: 'Big number' },
    fields: [F('number', 'Number', 12, '80%'), F('text', 'Line', 50)], defaults: { number: '80%', text: 'of people don’t know this' },
    colors: { main: DARK, accent: 'kit', mainLabel: 'Line', accentLabel: 'Number' },
  },
  quote: {
    group: 'structure', name: 'Quote', variants: { card: 'Card' },
    fields: [F('quote', 'Quote', 140), F('name', 'Who said it', 40)],
    defaults: { quote: 'This changed how I think about my health.', name: 'A happy patient' },
    colors: { main: DARK, accent: 'kit', mainLabel: 'Card', accentLabel: 'Quote mark' },
  },
  question: {
    group: 'structure', name: 'Question', variants: { ab: 'A or B' },
    fields: [F('question', 'Question', 50), F('a', 'Option A', 30), F('b', 'Option B', 30), F('footer', 'Last line', 30)],
    defaults: { question: 'Which one are you?', a: 'Morning walker', b: 'Evening walker', footer: 'Comment A or B 👇' },
    colors: { main: '#ffffff', accent: 'kit', mainLabel: 'Option A', accentLabel: 'Option B' },
  },
  hook: {
    group: 'structure', name: 'Hook', variants: { wait: 'Wait for it', end: 'Watch till the end', custom: 'Your own' },
    fields: [F('text', 'Words', 40)], defaults: { text: 'Wait for it… 👀' }, byVariant: { end: { text: 'Watch till the end ⏳' }, custom: { text: 'Your hook here' } },
    colors: { main: '#000000', accent: 'kit', mainLabel: 'Box', accentLabel: null },
  },
} satisfies Record<string, KindDef>

export type TemplateKind = keyof typeof TEMPLATE_KINDS
export const isTemplateKind = (k: unknown): k is TemplateKind => typeof k === 'string' && k in TEMPLATE_KINDS
export const kindDef = (k: TemplateKind): KindDef => TEMPLATE_KINDS[k] as KindDef

export type TemplateAnim = 'slide' | 'pop' | 'fade'
export interface TemplatePic { path: string; url: string | null }

export interface TemplateData {
  v: 2
  kind: TemplateKind
  variant: string
  fields: Record<string, string>
  colors: { main: string; accent: string }
  /** The round photo or logo (made round by the server: api/templates/assets), or none */
  photo: TemplatePic | null
  /** The platform icon it shows (made by the server), kept to make it again */
  icon: TemplatePic | null
  anim: TemplateAnim
  /** The ids of its photos (photos carry no look of their own to mark them) */
  images: string[]
  /** How big it is (its corner dragged on the preview): 1 as made, kept when it's made again */
  scale?: number
}

/** A text's template marks (kept with its look: textStyle.ts savedTextStyle) */
export interface TemplateMarks { tpl_id?: string; tpl?: TemplateData }

export const PLATFORM_COLOR = { instagram: '#0095F6', youtube: '#FF0000' } as const
export const TEMPLATE_MS = 4000
const FONT = 'roboto'
const W = 1080, H = 1920
const DEFAULT_ACCENT = '#c8ff00'

/** How wide a line is, px at 1080 wide (the browser measures with the preview's font; tests with a stand-in) */
export type Measure = (text: string, size: number, weight: number) => number

export interface KitFill { name?: string | null; handle?: string | null; main?: string | null; accent?: string | null }

/** Starting settings for a kind and style: the clip's brand kit fills what it has */
export function newTemplate(kind: TemplateKind, variant?: string, kit?: KitFill | null): TemplateData {
  const def = kindDef(kind)
  const v = variant && variant in def.variants ? variant : Object.keys(def.variants)[0]
  const fields = { ...def.defaults, ...(def.byVariant?.[v] ?? {}) }
  const handle = (kit?.handle ?? '').trim()
  if ('handle' in fields && handle) fields.handle = handle.startsWith('@') ? handle : `@${handle}`
  const name = (kit?.name ?? '').trim()
  if (name && (kind === 'contact' || kind === 'nametag')) fields.name = name
  if (name && kind === 'location') fields.place = name
  const pick = (c: string, k: string | null | undefined, fallback: string) => (c === 'kit' ? (k || fallback) : c)
  return {
    v: 2, kind, variant: v, fields,
    colors: { main: pick(def.colors.main, kit?.main, DARK), accent: pick(def.colors.accent, kit?.accent, DEFAULT_ACCENT) },
    photo: null, icon: null, anim: 'slide', images: [],
  }
}

/** Whether a kind (in this style) goes over the whole clip when put on */
export function wholeClip(d: Pick<TemplateData, 'kind' | 'variant'>): boolean {
  const w = kindDef(d.kind).whole
  return typeof w === 'function' ? w(d.variant) : !!w
}
/** The platform icon a template shows, if any */
export const iconOf = (d: Pick<TemplateData, 'kind' | 'variant'>): TemplateIconName | null => kindDef(d.kind).icon?.(d.variant) ?? null

/** A colour that reads on `bg`: near-black on light, white on dark */
export function inkOn(bg: string): string {
  const h = bg.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(h)) return '#ffffff'
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#111111' : '#ffffff'
}
const softOn = (bg: string) => (inkOn(bg) === '#ffffff' ? '#d4d4d8' : '#3f3f46')
const lum = (c: string) => {
  const h = c.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(h)) return 0.5
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** `fg` where it reads on `bg`; else the card's own ink (a lime title on a white card, say) */
export const readableOn = (fg: string, bg: string) => (Math.abs(lum(fg) - lum(bg)) >= 0.35 ? fg : inkOn(bg))

type NewText = Omit<TextOverlay, 'clip_id'> & TemplateMarks
type NewPhoto = Omit<Overlay, 'clip_id' | 'created_at' | 'z_index'>

/** Where a template's anchor (its first text) goes when it's first put on */
export function defaultAnchor(d: TemplateData): { x: number; y: number } {
  switch (d.kind) {
    case 'follow': return { x: d.photo ? 0.25 : 0.08, y: 0.74 }
    case 'handle': return { x: iconOf(d) ? 0.12 : 0.06, y: 0.16 }
    case 'credit': return { x: 0.06, y: 0.2 }
    case 'disclaimer': return { x: 0.06, y: 0.115 }
    case 'series': return d.variant === 'badge' ? { x: 0.06, y: 0.24 } : { x: 0.08, y: 0.66 }
    case 'podcast': return d.variant === 'show' ? { x: 0.06, y: 0.24 } : { x: 0.06, y: 0.64 }
    case 'tip': return { x: 0.06, y: 0.2 }
    case 'nametag': return d.variant === 'band' ? { x: 0, y: 0.62 } : { x: 0.06, y: 0.62 }
    case 'contact': return d.variant === 'end' ? { x: 0, y: 0 } : { x: 0.08, y: 0.58 }
    case 'hook': return { x: 0.08, y: 0.18 }
    case 'stat': return { x: 0.08, y: 0.36 }
    default: return { x: 0.08, y: 0.58 }
  }
}

const ENTRANCE: Record<TemplateAnim, TextOverlay['animation']> = { slide: 'slide', pop: 'pop', fade: 'fade' }
const PX = BG_PAD.x, PY = BG_PAD.y

/**
 * The template's parts: its texts (the first is its anchor and carries `tpl`) and its photos, at `at` (the
 * anchor's place), over [start, end]. `id` marks every text (tpl_id); new ids for the parts.
 */
export function buildTemplate(d: TemplateData, id: string, at: { x: number; y: number }, start: number, end: number, measure: Measure):
  { texts: NewText[]; photos: NewPhoto[] } {
  const texts: NewText[] = [], photos: NewPhoto[] = []
  const f = d.fields
  const val = (k: string) => (f[k] ?? '').trim()
  const entrance = ENTRANCE[d.anim] ?? 'slide'
  const later = (ms: number) => Math.max(start, Math.min(end - 300, start + ms))
  type Look = Partial<NewText>
  /** A text; with a box when `bg` is given (no shadow on boxes; a soft one on bare words, to read on video) */
  const text = (s: string, x: number, y: number, size: number, color: string, look: Look = {}): NewText => {
    const t: NewText = {
      id: crypto.randomUUID(), start_ms: start, end_ms: end, font: FONT, weight: 700, animation: entrance,
      shadow: look.bg_color ? 'none' : 'soft', text: s, x, y, size, color, ...look, tpl_id: id,
    }
    texts.push(t)
    return t
  }
  const box = (bg: string, opacity = 1, radius = 999): Look => ({ bg_color: bg, bg_opacity: opacity, bg_radius: radius })
  /** A text's width, px: its words, and its box's room either side when it has one */
  const wOf = (s: string, size: number, weight = 700, padded = false) => measure(s, size, weight) + (padded ? size * PX * 2 : 0)
  /** A one-line box's height, px */
  const hOf = (size: number, padded = true) => size * TEXT_LINE_EM + (padded ? size * PY * 2 : 0)
  /** Left edge (a share) that centres a line on `cx` */
  const centre = (s: string, size: number, cx: number, weight = 700, padded = false) => cx - wOf(s, size, weight, padded) / 2 / W
  /** The biggest size from `max` down that fits `room` px */
  const fit = (s: string, max: number, room: number, weight = 700, padded = false, min = 22) => {
    for (let size = max; size > min; size -= 2) if (wOf(s, size, weight, padded) <= room) return size
    return min
  }
  /** Lines a text wraps to in a box `wPx` wide (as the preview and export wrap it) */
  const linesIn = (s: string, size: number, wPx: number, weight = 700) => wrapTextLines(s, wPx, x => measure(x, size, weight)).length
  const photo = (p: TemplatePic, x: number, y: number, wPx: number, hPx = wPx): NewPhoto => {
    const o: NewPhoto = {
      id: crypto.randomUUID(), type: 'image', storage_path: p.path, preview_url: p.url ?? undefined,
      source_video_id: null, source_offset_ms: 0, x, y, w: wPx / W, h: hPx / H, start_ms: start, end_ms: end,
    }
    photos.push(o)
    return o
  }
  /** An invisible box round the template (its anchor: drag it, and it's where the template is made again) */
  const area = (x: number, y: number, wShare: number, hPx: number, look?: Look) =>
    text('.', x, y, 20, look?.bg_color ?? '#000000', { w: wShare, h: hPx / H, ...(look ?? { opacity: 0 }), shadow: 'none', animation: look ? entrance : 'none' })
  const ink = inkOn(d.colors.main), soft = softOn(d.colors.main), accentInk = inkOn(d.colors.accent)
  // (the accent on the card's colour, where it reads there)
  const accentOnCard = readableOn(d.colors.accent, d.colors.main)
  const icon = d.icon && iconOf(d) ? d.icon : null

  /** Lines stacked down a card centred on its middle: `top` px from the card's top, `pad` below the last */
  type Line = { s: string; size: number; color: string; weight?: number; gap?: number; look?: Look; anim?: TextOverlay['animation'] }
  const stackH = (ls: Line[]) => ls.reduce((n, l) => n + (l.gap ?? 0) + hOf(l.size, !!l.look?.bg_color), 0)
  /** (`onCard`: on a panel, so no shadow — that's for words over the video) */
  const stack = (ls: Line[], cx: number, topPx: number, onCard = true) => {
    let y = topPx
    ls.forEach((l, i) => {
      y += l.gap ?? 0
      const padded = !!l.look?.bg_color
      text(l.s, centre(l.s, l.size, cx, l.weight ?? 700, padded), y / H, l.size, l.color, { weight: l.weight ?? 700, ...(onCard ? { shadow: 'none' as const } : {}), ...l.look, start_ms: later(120 + i * 130), ...(l.anim ? { animation: l.anim } : {}) })
      y += hOf(l.size, padded)
    })
  }
  /** A card (visible panel, the anchor) holding centred lines; its height from what's in it */
  const card = (ls: Line[], wShare = 0.84, opts: { topPad?: number; bottomPad?: number; opacity?: number; radius?: number } = {}) => {
    const top = opts.topPad ?? 44, bottom = opts.bottomPad ?? 48
    const live = ls.filter(l => l.s)
    area(at.x, at.y, wShare, top + stackH(live) + bottom, box(d.colors.main, opts.opacity ?? 0.92, opts.radius ?? 44))
    stack(live, at.x + wShare / 2, at.y * H + top)
  }

  switch (d.kind) {
    case 'follow': {
      const v = d.variant, pillH = 96, ph = 162
      // (a photo added to one put on without: the row moves right so the photo stays on screen)
      const x0 = d.photo ? Math.max(at.x, (ph + 18) / W + 0.03) : at.x
      const btnText = val('button') || (v === 'youtube' ? 'Subscribe' : 'Follow')
      const btnSize = fit(btnText, 44, 0.36 * W, 700, true, 20)
      const room = (0.97 - x0) * W - wOf(btnText, btnSize, 700, true) - 18
      const handle = val('handle') || '@'
      const size = fit(handle, 46, room, 700, true, 24)
      // The @handle in a pill (the anchor), the button after it coming in a moment later as a tap
      text(handle, x0, at.y, size, inkOn(d.colors.main), { ...box(d.colors.main), h: pillH / H })
      const btnBg = v === 'plain' ? d.colors.accent : PLATFORM_COLOR[v as 'instagram' | 'youtube']
      text(btnText, x0 + (wOf(handle, size, 700, true) + 18) / W, at.y, btnSize, inkOn(btnBg), { ...box(btnBg), h: pillH / H, start_ms: later(450), animation: 'bounce' })
      // The round photo before it, the platform's icon on its corner
      const py = at.y - (ph - pillH) / 2 / H, px = x0 - (ph + 18) / W
      if (d.photo) photo(d.photo, px, py, ph)
      if (icon && d.photo) photo(icon, px + (ph - 50) / W, py + (ph - 50) / H, 58)
      else if (icon) photo(icon, x0 - 80 / W, at.y + (pillH - 64) / 2 / H, 64)
      break
    }
    case 'handle': {
      // A small see-through tag over the whole clip, the platform's icon before it
      const s = val('handle') || '@'
      const size = fit(s, 36, 0.6 * W, 700, true)
      text(s, at.x, at.y, size, '#ffffff', { ...box(d.colors.main, 0.5), animation: 'fade' })
      if (icon) photo(icon, at.x - 62 / W, at.y + (hOf(size) - 52) / 2 / H, 52)
      break
    }
    case 'credit': {
      const s = val('text') || ' '
      text(s, at.x, at.y, fit(s, 30, 0.8 * W, 700, true), '#ffffff', { ...box(d.colors.main, 0.5, 14), animation: 'fade' })
      break
    }
    case 'disclaimer': {
      // A thin bar: the words wrap in it
      const s = val('text') || ' ', wShare = 0.8
      text(s, at.x, at.y, 28, '#ffffff', { ...box(d.colors.main, 0.55, 14), w: wShare, weight: 400, animation: 'fade' })
      break
    }
    case 'comment': {
      const kw = val('keyword') || 'KEYWORD'
      card([
        { s: val('before'), size: 46, color: ink },
        { s: kw.toUpperCase(), size: fit(kw.toUpperCase(), 84, 0.7 * W, 700, true), color: accentInk, gap: 14, look: { ...box(d.colors.accent, 1, 22) }, anim: 'pop' },
        { s: val('after'), size: fit(val('after'), 38, 0.76 * W, 400), color: soft, weight: 400, gap: 16 },
      ])
      break
    }
    case 'engage': {
      const s = val('text') || ' ', size = fit(s, 46, 0.8 * W, 700, true)
      // An invisible box round the pill (centred in it), the pill bouncing in
      const wShare = 0.84, hPx = hOf(size) + 20
      area(at.x, at.y, wShare, hPx)
      text(s, centre(s, size, at.x + wShare / 2, 700, true), at.y + 10 / H, size, inkOn(d.colors.main), { ...box(d.colors.main), animation: 'bounce' })
      break
    }
    case 'series': {
      if (d.variant === 'badge') {
        const s = `PART ${val('part') || '1'}${val('total') ? ` / ${val('total')}` : ''}`
        text(s, at.x, at.y, 40, accentInk, { ...box(d.colors.accent, 1, 16), animation: 'pop' })
      } else {
        const s = val('text') || ' ', size = fit(s, 50, 0.8 * W, 700, true)
        const wShare = 0.84
        area(at.x, at.y, wShare, hOf(size) + 20)
        text(s, centre(s, size, at.x + wShare / 2, 700, true), at.y + 10 / H, size, inkOn(d.colors.main), { ...box(d.colors.main, 0.92), animation: 'bounce' })
      }
      break
    }
    case 'fullvideo': {
      // The words in a pill (the platform's icon before them), a big arrow under (above, for "Link in bio")
      const s = val('text') || ' ', up = d.variant === 'bio'
      const size = fit(s, 48, 0.66 * W, 700, true), arrow = up ? '↑' : '↓', arrowSize = 120
      const wShare = 0.84, cx = at.x + wShare / 2
      const pillH = hOf(size), arrowH = arrowSize * TEXT_LINE_EM
      area(at.x, at.y, wShare, pillH + arrowH + 10)
      const iconPx = icon ? 74 : 0
      const rowW = wOf(s, size, 700, true) + (icon ? iconPx + 14 : 0)
      const left = cx - rowW / 2 / W
      const pillY = up ? at.y + arrowH / H + 10 / H : at.y
      if (icon) photo(icon, left, pillY + (pillH - iconPx) / 2 / H, iconPx)
      text(s, left + (icon ? (iconPx + 14) / W : 0), pillY, size, inkOn(d.colors.main), { ...box(d.colors.main, 0.92) })
      text(arrow, centre(arrow, arrowSize, cx), up ? at.y : at.y + (pillH + 4) / H, arrowSize, d.colors.accent, { animation: up ? 'slide-down' : 'drop', start_ms: later(400) })
      break
    }
    case 'nametag': {
      if (d.variant === 'band') {
        // The name on a band from the left edge, the title and organisation under it
        const name = val('name') || ' ', size = fit(name, 66, 0.86 * W, 700, true)
        text(name, at.x, at.y, size, inkOn(d.colors.main), { ...box(d.colors.main, 1, 0), w: Math.min(0.92, (wOf(name, size, 700, true) + 60) / W), animation: 'slide-right' })
        let y = at.y * H + hOf(size) + 12
        for (const [k, sz, col] of [['title', 38, d.colors.accent], ['org', 32, '#ffffff']] as const) {
          const s = val(k)
          if (!s) continue
          text(s, at.x + 0.04, y / H, fit(s, sz, 0.86 * W, 400), col, { weight: k === 'title' ? 700 : 400, start_ms: later(200) })
          y += sz * TEXT_LINE_EM + 4
        }
      } else {
        // A card: the name, the title in the accent, the organisation
        const name = val('name') || ' '
        const ls: Line[] = [
          { s: name, size: fit(name, 56, 0.74 * W), color: ink },
          { s: val('title'), size: fit(val('title'), 36, 0.74 * W), color: accentOnCard, gap: 6 },
          { s: val('org'), size: fit(val('org'), 30, 0.74 * W, 400), color: soft, weight: 400, gap: 4 },
        ].filter(l => l.s)
        const wPx = Math.min(0.88 * W, Math.max(...ls.map(l => wOf(l.s, l.size, l.weight ?? 700))) + 80)
        const hPx = 30 + stackH(ls) + 34
        area(at.x, at.y, wPx / W, hPx, box(d.colors.main, 0.92, 32))
        let y = at.y * H + 30
        ls.forEach((l, i) => {
          y += l.gap ?? 0
          text(l.s, at.x + 40 / W, y / H, l.size, l.color, { weight: l.weight ?? 700, shadow: 'none', start_ms: later(120 + i * 130) })
          y += hOf(l.size, false)
        })
      }
      break
    }
    case 'podcast': {
      if (d.variant === 'show') {
        const s = `🎙 ${val('show') || 'Podcast'}${val('episode') ? ` · Ep ${val('episode')}` : ''}`
        text(s, at.x, at.y, fit(s, 34, 0.7 * W, 700, true), inkOn(d.colors.main), { ...box(d.colors.main, 0.9, 16), animation: 'fade' })
      } else {
        // The label chip over the name pill
        const label = (val('label') || 'GUEST').toUpperCase(), name = val('name') || ' '
        text(name, at.x, at.y + (hOf(28) - 8) / H, fit(name, 52, 0.84 * W, 700, true), inkOn(d.colors.main), { ...box(d.colors.main, 1, 18) })
        text(label, at.x + 20 / W, at.y - 8 / H, 28, accentInk, { ...box(d.colors.accent, 1, 10), start_ms: later(200), animation: 'pop' })
      }
      break
    }
    case 'contact': {
      const endScreen = d.variant === 'end'
      const lines = ([
        { s: val('name'), size: endScreen ? 84 : 62, color: ink },
        { s: val('role'), size: endScreen ? 44 : 36, color: soft, weight: 400, gap: endScreen ? 12 : 6 },
        { s: val('cta'), size: endScreen ? 50 : 40, color: accentOnCard, gap: endScreen ? 60 : 28 },
        { s: val('phone'), size: endScreen ? 66 : 52, color: ink, gap: endScreen ? 10 : 4, anim: endScreen ? undefined : 'pop' as const },
        { s: val('website') ? `🌐 ${val('website')}` : '', size: endScreen ? 42 : 34, color: soft, weight: 400, gap: endScreen ? 20 : 10 },
      ] as Line[]).filter(l => l.s)
      const photoPx = d.photo ? (endScreen ? 380 : 210) : 0
      if (endScreen) {
        area(0, 0, 1, H, box(d.colors.main, 1, 0))
        const top = d.photo ? 0.2 * H : 0.34 * H
        if (d.photo) photo(d.photo, 0.5 - photoPx / 2 / W, 0.2, photoPx)
        stack(lines, 0.5, top + (d.photo ? photoPx + 60 : 0))
      } else {
        // The photo half over the card's top edge
        const wShare = 0.84, top = photoPx / 2 + 40
        area(at.x, at.y, wShare, top + stackH(lines) + 56, box(d.colors.main, 0.92, 48))
        if (d.photo) photo(d.photo, at.x + wShare / 2 - photoPx / 2 / W, at.y - photoPx / 2 / H, photoPx)
        stack(lines, at.x + wShare / 2, at.y * H + top)
      }
      break
    }
    case 'whatsapp': {
      // The WhatsApp icon on the left of a card, the words and the number beside it
      const iconPx = 110, wShare = 0.84, padL = 34
      const label = val('label') || ' ', number = val('number')
      const room = wShare * W - padL * 2 - iconPx - 24
      const lSize = fit(label, 38, room, 400), nSize = fit(number || ' ', 56, room)
      const hPx = Math.max(iconPx + 48, 40 + hOf(lSize, false) + (number ? hOf(nSize, false) + 4 : 0) + 40)
      area(at.x, at.y, wShare, hPx, box(d.colors.main, 0.92, 36))
      if (icon) photo(icon, at.x + padL / W, at.y + (hPx - iconPx) / 2 / H, iconPx)
      const tx = at.x + (padL + iconPx + 24) / W
      const textH = hOf(lSize, false) + (number ? hOf(nSize, false) + 4 : 0)
      let y = at.y * H + (hPx - textH) / 2
      text(label, tx, y / H, lSize, ink, { weight: 400, shadow: 'none', start_ms: later(120) })
      y += hOf(lSize, false) + 4
      if (number) text(number, tx, y / H, nSize, accentOnCard, { shadow: 'none', start_ms: later(260), animation: 'pop' })
      break
    }
    case 'offer': {
      card([
        { s: (val('tag') || ' ').toUpperCase(), size: 30, color: accentInk, look: box(d.colors.accent, 1, 12), anim: 'pop' },
        { s: val('title'), size: fit(val('title'), 66, 0.74 * W), color: ink, gap: 18 },
        { s: val('code'), size: fit(val('code'), 38, 0.74 * W), color: accentOnCard, gap: 10 },
      ], 0.84)
      break
    }
    case 'location': {
      card([
        { s: val('place') ? `📍 ${val('place')}` : '', size: fit(`📍 ${val('place')}`, 54, 0.76 * W), color: ink },
        { s: val('address'), size: fit(val('address'), 36, 0.76 * W, 400), color: soft, weight: 400, gap: 8 },
        { s: val('timings'), size: fit(val('timings'), 34, 0.76 * W), color: accentOnCard, gap: 12 },
      ])
      break
    }
    case 'event': {
      card([
        { s: val('tag'), size: 32, color: '#ffffff', look: box(d.variant === 'live' ? '#ef4444' : '#2563eb', 1, 12), anim: 'pop' },
        { s: val('title'), size: fit(val('title'), 58, 0.74 * W), color: ink, gap: 18 },
        { s: val('when'), size: fit(val('when'), 42, 0.74 * W), color: accentOnCard, gap: 10 },
      ])
      break
    }
    case 'tip': {
      // The label in a chip (the anchor); a line under it, wrapping, on a box
      const label = (val('label') || 'TIP').toUpperCase()
      const chip = d.variant === 'myth' ? '#ef4444' : d.variant === 'fact' ? '#22c55e' : d.colors.accent
      text(label, at.x, at.y, 54, inkOn(chip), { ...box(chip, 1, 18), animation: 'pop' })
      if (val('text')) text(val('text'), at.x, at.y + (hOf(54) + 14) / H, 44, inkOn(d.colors.main), { ...box(d.colors.main, 0.85, 18), w: 0.84, start_ms: later(250) })
      break
    }
    case 'stat': {
      // A big number in the accent, the line under it — bare words with a soft shadow, centred
      const n = val('number') || '0', s = val('text')
      const wShare = 0.84, cx = at.x + wShare / 2
      const nSize = fit(n, 180, 0.8 * W), sSize = fit(s || ' ', 50, 0.8 * W)
      area(at.x, at.y, wShare, hOf(nSize, false) + (s ? hOf(sSize, false) + 8 : 0))
      text(n, centre(n, nSize, cx), at.y, nSize, d.colors.accent, { animation: 'zoom-in', start_ms: later(100) })
      if (s) text(s, centre(s, sSize, cx), at.y + (hOf(nSize, false) + 8) / H, sSize, '#ffffff', { start_ms: later(400) })
      break
    }
    case 'quote': {
      // A card: a big quote mark, the words wrapping, who said it
      const wShare = 0.84, padX = 56, q = val('quote') || ' ', who = val('name')
      const qSize = 46, inner = wShare * W - padX * 2
      const qLines = linesIn(q, qSize, inner)
      const markSize = 130
      const hPx = 36 + markSize * 0.6 + qLines * qSize * TEXT_LINE_EM + (who ? 20 + hOf(34, false) : 0) + 50
      area(at.x, at.y, wShare, hPx, box(d.colors.main, 0.92, 40))
      text('“', at.x + (padX - 10) / W, at.y + 6 / H, markSize, accentOnCard, { shadow: 'none', animation: 'pop' })
      let y = at.y * H + 36 + markSize * 0.6
      text(q, at.x + padX / W, y / H, qSize, ink, { w: inner / W, shadow: 'none', start_ms: later(150) })
      y += qLines * qSize * TEXT_LINE_EM + 20
      if (who) text(`— ${who}`, at.x + padX / W, y / H, 34, accentOnCard, { shadow: 'none', start_ms: later(350) })
      break
    }
    case 'question': {
      // The question, two option chips, the last line
      const wShare = 0.84, cx = at.x + wShare / 2
      const ls: Line[] = [
        { s: val('question'), size: fit(val('question'), 58, 0.8 * W), color: '#ffffff' },
        { s: val('a') ? `A · ${val('a')}` : '', size: fit(`A · ${val('a')}`, 46, 0.74 * W, 700, true), color: inkOn(d.colors.main), look: box(d.colors.main, 1, 20), gap: 22 },
        { s: val('b') ? `B · ${val('b')}` : '', size: fit(`B · ${val('b')}`, 46, 0.74 * W, 700, true), color: accentInk, look: box(d.colors.accent, 1, 20), gap: 16 },
        { s: val('footer'), size: fit(val('footer'), 38, 0.8 * W), color: '#ffffff', gap: 20 },
      ].filter(l => l.s)
      area(at.x, at.y, wShare, stackH(ls) + 10)
      stack(ls, cx, at.y * H, false)
      break
    }
    case 'hook': {
      const s = val('text') || ' ', size = fit(s, 64, 0.8 * W, 700, true), wShare = 0.84
      area(at.x, at.y, wShare, hOf(size) + 10)
      text(s, centre(s, size, at.x + wShare / 2, 700, true), at.y + 5 / H, size, inkOn(d.colors.main), { ...box(d.colors.main, 0.75, 22), animation: d.anim === 'slide' ? 'drop' : entrance })
      break
    }
  }
  // Made bigger or smaller (its corner dragged on the preview): every part round the first text's place
  const k = d.scale && d.scale > 0 && d.scale !== 1 ? d.scale : 1
  if (k !== 1 && texts[0]) {
    const m = { r: k, ox: texts[0].x ?? 0, oy: texts[0].y ?? 0, dx: 0, dy: 0 }
    texts.forEach((t, i) => { texts[i] = movedPart(t, m) })
    photos.forEach((o, i) => { photos[i] = movedPart(o, m) })
  }
  // (the first text carries the settings)
  if (texts[0]) texts[0].tpl = d
  return { texts, photos }
}

/** A move and a scale: `r` times as big round (ox, oy), then (dx, dy) along (shares of the frame) */
export interface PartMove { r: number; ox: number; oy: number; dx: number; dy: number }
type Placed = { x?: number | null; y?: number | null; w?: number | null; h?: number | null; size?: number | null; bg_radius?: number | null }
/** A template's part moved and scaled as the whole template is: its place, box and size (px) all together */
export function movedPart<T extends Placed>(p: T, m: PartMove): T {
  const out: T = { ...p, x: m.ox + ((p.x ?? 0) - m.ox) * m.r + m.dx, y: m.oy + ((p.y ?? 0) - m.oy) * m.r + m.dy }
  if (m.r !== 1) {
    if (p.w) out.w = p.w * m.r
    if (p.h) out.h = p.h * m.r
    // (a text's size is saved whole: the export draws it at that)
    if (p.size != null) out.size = Math.max(4, Math.round(p.size * m.r))
    if (p.bg_radius != null && p.bg_radius < 999) out.bg_radius = Math.round(p.bg_radius * m.r)
  }
  return out
}

/**
 * One of a template's texts changed (`u`), the template being one thing: its time (moved, or an edge trimmed),
 * row, hidden, locked and a move on the frame go for all its parts — texts and photos — the parts' entrances
 * keeping their delays from its start; anything else just that text. Null: not a template's text
 */
export function templatePartChanged<T extends TextOverlay & TemplateMarks, P extends Overlay>(texts: T[], photos: P[], id: string, u: Partial<TextOverlay>):
  { texts: T[]; photos: P[] } | null {
  const t = texts.find(x => x.id === id)
  const tid = t?.tpl_id
  if (!t || !tid) return null
  const root = texts.find(x => x.tpl_id === tid && x.tpl)
  const parts = new Set([...texts.filter(x => x.tpl_id === tid).map(x => x.id), ...(root?.tpl?.images ?? [])])
  const { start_ms, end_ms, track, hidden, locked, x, y, ...own } = u
  const all = { ...(track !== undefined ? { track } : {}), ...(hidden !== undefined ? { hidden } : {}), ...(locked !== undefined ? { locked } : {}) }
  const s0 = t.start_ms, e0 = t.end_ms, s1 = start_ms ?? s0, e1 = end_ms ?? e0
  const timed = s1 !== s0 || e1 !== e0
  const shift = start_ms != null && end_ms != null && e1 - s1 === e0 - s0 ? s1 - s0 : null
  const when = (p: { start_ms: number; end_ms: number }) => {
    if (!timed) return {}
    if (shift != null) return { start_ms: p.start_ms + shift, end_ms: p.end_ms + shift }
    // (an edge trimmed: each part keeps its delay from the start — inside the time left — all end together)
    return { start_ms: Math.max(s1, Math.min(Math.max(s1, e1 - 300), s1 + (p.start_ms - s0))), end_ms: e1 }
  }
  const dx = x != null && t.x != null ? x - t.x : 0, dy = y != null && t.y != null ? y - t.y : 0
  return {
    texts: texts.map(p => (parts.has(p.id) ? { ...p, ...(p.id === id ? own : {}), ...all, ...when(p), ...(dx || dy ? { x: (p.x ?? 0) + dx, y: (p.y ?? 0) + dy } : {}) } : p)),
    photos: photos.map(o => (parts.has(o.id) ? { ...o, ...all, ...when(o), ...(dx || dy ? { x: o.x + dx, y: o.y + dy } : {}) } : o)),
  }
}

/** The box round all of a template's parts (shares of the frame), as the preview draws them */
export function partsBox(texts: Pick<TextOverlay, 'text' | 'x' | 'y' | 'w' | 'h' | 'size' | 'weight' | 'bg_color'>[], photos: Pick<Overlay, 'x' | 'y' | 'w' | 'h'>[], measure: Measure):
  { x: number; y: number; w: number; h: number } | null {
  const boxes = [
    ...texts.map(t => {
      const size = t.size ?? 48, bg = !!t.bg_color
      const w = t.w ? t.w * W : measure(t.text, size, t.weight ?? 700) + (bg ? size * PX * 2 : 0)
      const h = Math.max(t.h ? t.h * H : 0, size * TEXT_LINE_EM + (bg ? size * PY * 2 : 0))
      return { x: (t.x ?? 0) * W, y: (t.y ?? 0) * H, w, h }
    }),
    ...photos.map(o => ({ x: o.x * W, y: o.y * H, w: o.w * W, h: o.h * H })),
  ]
  if (!boxes.length) return null
  const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y))
  const x1 = Math.max(...boxes.map(b => b.x + b.w)), y1 = Math.max(...boxes.map(b => b.y + b.h))
  return { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H }
}

/** The box height a one-line pill text gets, px */
export const pillHeight = (size: number) => size * TEXT_LINE_EM + size * PY * 2

/** The anchor's place a template keeps when made again: its first text's place now */
export function anchorOf(texts: (TextOverlay & TemplateMarks)[], tplId: string): { x: number; y: number; start: number; end: number } | null {
  const root = texts.find(t => t.tpl_id === tplId && t.tpl)
  return root ? { x: root.x ?? 0, y: root.y ?? 0, start: root.start_ms, end: root.end_ms } : null
}

/** Settings read back from a saved text: older (v1) Follow / Contact ones carried the same fields */
export function readTemplate(raw: unknown): TemplateData | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Partial<TemplateData> & { v?: number }
  if (!isTemplateKind(d.kind) || !d.fields || typeof d.fields !== 'object') return null
  return { v: 2, kind: d.kind, variant: String(d.variant ?? Object.keys(kindDef(d.kind).variants)[0]), fields: d.fields as Record<string, string>,
    colors: d.colors ?? { main: DARK, accent: DEFAULT_ACCENT }, photo: d.photo ?? null, icon: d.icon ?? null, anim: d.anim ?? 'slide', images: Array.isArray(d.images) ? d.images : [],
    ...(typeof d.scale === 'number' && d.scale > 0 && d.scale !== 1 ? { scale: d.scale } : {}) }
}
