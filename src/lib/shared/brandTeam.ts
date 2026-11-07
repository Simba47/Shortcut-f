/**
 * Brand kits shared with a team (brand kit rebuild, Phase 6, 2026-10-28): who can do what with a kit,
 * how many people a plan's kit can be shared with, and the brand lock as rules both the editor and the
 * server apply — so what someone sees in the editor is what's saved and exported.
 *
 *  - roles: the owner (everything); "Can edit" — changes the kit's settings (not its sharing, lock or
 *    default mark, and can't delete it); "Can use" — puts it on their clips
 *  - the brand lock (the owner's switch): on clips with the kit on, people who can only use it keep to
 *    its colours and fonts (lockClipLook), and only the owner — or someone who can edit it — takes it off
 *
 * Pure: no database, no React.
 */
import type { CaptionStyle, FrameItem, SegmentLocal, TextOverlay } from './types'
import { brandCaptionLooks, brandLockOf, brandTextStyle, type BrandKitData } from './brandKit'

export type KitRole = 'use' | 'edit'
export const cleanRole = (v: unknown): KitRole => (v === 'edit' ? 'edit' : 'use')
export const ROLE_NAMES: Record<KitRole, string> = { use: 'Can use', edit: 'Can edit' }

/** How many people one kit can be shared with on each plan (a plan not listed can't share) */
export const TEAM_SEATS: Record<string, number> = { agency: 10 }
export const teamSeats = (plan: string | null | undefined) => TEAM_SEATS[plan ?? 'free'] ?? 0

/** How long an invite can be accepted (days) */
export const INVITE_DAYS = 14

/** Whether the brand lock holds someone to a kit: it's locked, shared with them, and they can only use it */
export const lockHolds = (d: Pick<BrandKitData, 'lock'>, role: KitRole | 'owner' | null | undefined) => !!d.lock && role === 'use'

/**
 * What a locked kit leaves its users: every colour the kit itself uses (its palette and caption colours
 * — what the editor offers — and its card's, text styles', caption looks' and bar's), its fonts (null:
 * the kit names none, fonts stay free), and its caption looks' styles (null: its captions are off)
 */
export interface LockSet { colors: string[]; fonts: string[] | null; templates: Array<string | null> | null }

export function lockSetOf(d: BrandKitData): LockSet {
  const base = brandLockOf(d)
  const looks = brandCaptionLooks(d)
  const styles = (['subtitle', 'cta'] as const).map(k => brandTextStyle(d, k))
  const colors = [
    ...base.colors, d.card.bg.color, d.card.bg.color2, d.card.title.color, d.card.handle.color,
    ...styles.flatMap(s => [s.color, s.bg]), ...looks.flatMap(l => [l.captions.color, l.captions.highlight_color]),
    '#ffffff', '#000000',
  ].filter((c): c is string => typeof c === 'string' && HEX.test(c)).map(c => c.toLowerCase())
  const fonts = base.fonts.length
    ? [...new Set([...base.fonts, ...styles.map(s => s.font), ...looks.map(l => l.captions.font), d.title.font ?? 'sans-serif']
      .filter((f): f is string => !!f))]
    : null
  return {
    colors: [...new Set(colors)],
    fonts,
    templates: d.captions.on ? [...new Set(looks.map(l => l.captions.template))] : null,
  }
}

const HEX = /^#[0-9a-f]{6}$/i
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))

/** A colour as the lock allows it: itself when allowed (or not a colour: none, see-through), else the nearest allowed one */
export function lockColor<T extends string | null | undefined>(c: T, s: LockSet): T | string {
  if (typeof c !== 'string' || !HEX.test(c) || !s.colors.length) return c
  const lc = c.toLowerCase()
  if (s.colors.includes(lc)) return c
  const [r, g, b] = rgb(lc)
  // (weighted for how the eye sees: green counts most)
  const dist = (h: string) => { const [r2, g2, b2] = rgb(h); return 2 * (r - r2) ** 2 + 4 * (g - g2) ** 2 + 3 * (b - b2) ** 2 }
  return s.colors.reduce((best, h) => (dist(h) < dist(best) ? h : best))
}

/** A font as the lock allows it: itself when allowed or unset, else the kit's title font */
export function lockFont<T extends string | null | undefined>(f: T, s: LockSet): T | string {
  if (!s.fonts || !f || s.fonts.includes(f)) return f
  return s.fonts.includes('sans-serif') ? 'sans-serif' : s.fonts[s.fonts.length - 1]
}

/** Changes `o` only where a field changed (so an unchanged one stays the same object) */
function patch<T extends object>(o: T, next: Partial<T>): T {
  const changed = (Object.keys(next) as Array<keyof T>).some(k => next[k] !== o[k])
  return changed ? { ...o, ...next } : o
}

/** Text on the clip under the lock (text locked on the timeline too: the lock is the brand's, not the editor's) */
export function lockText(t: TextOverlay, s: LockSet): TextOverlay {
  return patch(t, {
    color: lockColor(t.color, s), font: lockFont(t.font, s),
    ...(t.stroke_color !== undefined ? { stroke_color: lockColor(t.stroke_color, s) } : {}),
    ...(t.bg_color !== undefined ? { bg_color: lockColor(t.bg_color, s) } : {}),
    ...(t.shadow_color !== undefined ? { shadow_color: lockColor(t.shadow_color, s) } : {}),
  } as Partial<TextOverlay>)
}

/** A caption look under the lock: its colours and font, and its caption style one of the kit's */
export function lockCaption<T extends Partial<CaptionStyle>>(c: T, s: LockSet): T {
  const next: Partial<CaptionStyle> = {}
  if (c.color !== undefined) next.color = lockColor(c.color, s)
  if (c.highlight_color !== undefined) next.highlight_color = lockColor(c.highlight_color, s)
  if (c.font !== undefined) next.font = lockFont(c.font, s)
  if (s.templates && c.template !== undefined && !s.templates.includes(c.template ?? null)) next.template = s.templates[0] ?? null
  return patch(c, next as Partial<T>)
}

function lockItem(it: FrameItem, s: LockSet): FrameItem {
  if (it.kind !== 'text') return it
  return patch(it, {
    ...(it.color !== undefined ? { color: lockColor(it.color, s) } : {}),
    ...(it.bg !== undefined ? { bg: lockColor(it.bg, s) } : {}),
    ...(it.font !== undefined ? { font: lockFont(it.font, s) } : {}),
  } as Partial<FrameItem>)
}

/** A frame section under the lock: its band, its text, its background (a section that isn't a frame stays as it is) */
export function lockSegment(seg: SegmentLocal, s: LockSet): SegmentLocal {
  const f = seg.frame
  if (!f) return seg
  const items = (f.items ?? []).map(it => lockItem(it, s))
  const band = f.band ? patch(f.band, { bg: lockColor(f.band.bg, s), color: lockColor(f.band.color, s), ...(f.band.font !== undefined ? { font: lockFont(f.band.font, s) } : {}) }) : f.band
  const bg = f.bg ? patch(f.bg, { color: lockColor(f.bg.color, s), color2: lockColor(f.bg.color2, s) }) : f.bg
  const card = f.card ? patch(f.card, { bg: patch(f.card.bg, { color: lockColor(f.card.bg.color, s), color2: lockColor(f.card.bg.color2, s) }) }) : f.card
  if (items.every((it, i) => it === f.items![i]) && band === f.band && bg === f.bg && card === f.card) return seg
  return { ...seg, frame: { ...f, items, ...(f.band ? { band } : {}), ...(f.bg ? { bg } : {}), ...(f.card ? { card } : {}) } }
}

/** What the lock looks after on a clip */
export interface LockedLook {
  texts: TextOverlay[]
  caption: Partial<CaptionStyle>
  /** The caption parts after the first, each with its own look (captions/parts.ts) */
  parts: Array<{ style: Partial<CaptionStyle> }>
  segments: SegmentLocal[]
}

/** A clip's look kept to a locked kit's colours and fonts: unchanged parts stay the same objects; `changed`: whether anything did */
export function lockClipLook<T extends LockedLook>(look: T, s: LockSet): T & { changed: boolean } {
  const texts = look.texts.map(t => lockText(t, s))
  const caption = lockCaption(look.caption, s)
  const parts = look.parts.map(p => { const style = lockCaption(p.style, s); return style === p.style ? p : { ...p, style } })
  const segments = look.segments.map(seg => lockSegment(seg, s))
  const changed = caption !== look.caption || texts.some((t, i) => t !== look.texts[i]) || parts.some((p, i) => p !== look.parts[i])
    || segments.some((x, i) => x !== look.segments[i])
  return { ...look, texts, caption, parts, segments, changed }
}

/** The plans whose kits can be shared */
export const TEAM_PLANS = Object.keys(TEAM_SEATS)

/** Someone a kit is shared with, and what they can do */
export interface KitMember { user_id: string; name: string | null; email: string | null; role: KitRole }
/** An invite out (the owner's view); `expired`: past INVITE_DAYS — send it again */
export interface KitInviteOut { id: string; email: string; role: KitRole; expired: boolean }
/** An invite to someone else's kit, as the person invited sees it */
export interface KitInviteIn { id: string; kit_name: string; by: string; role: KitRole }
/** A kit's team, as its owner sees it */
export interface KitTeam { people: KitMember[]; invites: KitInviteOut[]; can_share: boolean; seats: number }

/** The link to an invite (sent however the owner likes: nothing is emailed) */
export const inviteLink = (origin: string, id: string) => `${origin}/brand?invite=${id}`
