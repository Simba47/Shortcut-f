import type { CSSProperties } from 'react'
import type { TextOverlay } from '@chai-cut/shared'

/**
 * Text styling for the Text tool: the trending presets, and the CSS used to show a text's look
 * (preset tiles, the drag box on the preview). The canvas draws the same look in VideoPreview
 * (drawStyledText). Sizes in the overlay are px at 1080 wide; here they become em of the font size,
 * so the look scales with the text.
 */

export type TextStyle = Partial<Pick<TextOverlay,
  'font' | 'color' | 'weight' | 'italic' | 'uppercase' | 'letter_spacing' | 'opacity' | 'rotation' |
  'stroke_color' | 'stroke_width' | 'bg_color' | 'bg_opacity' | 'bg_radius' | 'shadow' | 'shadow_color' | 'animation'>>

/**
 * The Text-tool look saved together on a text (text_overlays.style; the export draws it:
 * python/text_style.py). Font, colour, size and rotation have their own fields. Before 2026-11-04
 * none of this was saved: gone when the clip was opened again, never exported.
 */
export const TEXT_STYLE_KEYS = [
  'weight', 'italic', 'uppercase', 'letter_spacing', 'opacity', 'stroke_color', 'stroke_width',
  'bg_color', 'bg_opacity', 'bg_radius', 'shadow', 'shadow_color', 'animation',
] as const

/** A text's look as it is saved (only what it has), or null when it has none */
export function savedTextStyle(t: Partial<TextOverlay>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  for (const k of TEXT_STYLE_KEYS) if (t[k] !== undefined && t[k] !== null) out[k] = t[k]
  return Object.keys(out).length ? out : null
}

/** A text as it is read back: its saved look spread over it as its own settings */
export function withSavedStyle<T extends object>(row: T): T {
  const { style, ...rest } = row as T & { style?: unknown }
  return (style && typeof style === 'object' ? { ...(style as object), ...rest } : rest) as T
}

/** Everything a preset sets, so switching presets never leaves bits of the previous one */
const BASE: Required<Omit<TextStyle, 'font' | 'color'>> = {
  weight: 700, italic: false, uppercase: false, letter_spacing: 0, opacity: 1, rotation: 0,
  stroke_color: null, stroke_width: 0, bg_color: null, bg_opacity: 1, bg_radius: 12,
  shadow: 'soft', shadow_color: null, animation: 'none',
}

/**
 * A brand kit's ready text style (lib/shared/brandKit.ts brandTextStyle: title, subtitle, call to
 * action) as a text's look (brand kit Phase 3): its font, colour, size and capitals; a background
 * as a rounded box (no shadow); the rest as a plain text, popping in
 */
export function brandTextLook(st: { font: string | null; color: string; size: number; bg: string | null; uppercase: boolean }): TextStyle & { size: number } {
  return {
    ...BASE, font: st.font ?? 'sans-serif', color: st.color, size: st.size, uppercase: st.uppercase, animation: 'pop',
    ...(st.bg ? { bg_color: st.bg, bg_opacity: 1, bg_radius: 14, shadow: 'none' as const } : {}),
  }
}

export const TEXT_PRESETS: { id: string; name: string; style: TextStyle }[] = [
  { id: 'bold-pop', name: 'Bold pop', style: { ...BASE, color: '#ffffff', weight: 900, uppercase: true, stroke_color: '#000000', stroke_width: 8, animation: 'pop' } },
  { id: 'creator', name: 'Creator', style: { ...BASE, color: '#FFE600', weight: 900, uppercase: true, stroke_color: '#000000', stroke_width: 10, shadow: 'hard', shadow_color: '#000000', animation: 'pop' } },
  { id: 'neon', name: 'Neon', style: { ...BASE, color: '#c8ff00', weight: 700, shadow: 'glow', shadow_color: '#c8ff00', animation: 'fade' } },
  { id: 'label', name: 'Label', style: { ...BASE, color: '#0a0a0a', weight: 800, bg_color: '#ffffff', bg_opacity: 1, bg_radius: 14, shadow: 'none', animation: 'slide' } },
  { id: 'highlight', name: 'Highlight', style: { ...BASE, color: '#0a0a0a', weight: 900, uppercase: true, bg_color: '#c8ff00', bg_opacity: 1, bg_radius: 10, shadow: 'none', animation: 'pop' } },
  { id: 'subtitle', name: 'Subtitle', style: { ...BASE, color: '#ffffff', weight: 600, bg_color: '#000000', bg_opacity: 0.6, bg_radius: 12, shadow: 'none', animation: 'fade' } },
  { id: 'minimal', name: 'Minimal', style: { ...BASE, color: '#ffffff', weight: 400, uppercase: true, letter_spacing: 8, shadow: 'soft', animation: 'fade' } },
  { id: 'retro', name: 'Retro', style: { ...BASE, color: '#ff7a45', weight: 900, italic: true, uppercase: true, shadow: 'hard', shadow_color: '#1a1a1a', animation: 'slide' } },
  { id: 'typewriter', name: 'Typewriter', style: { ...BASE, font: 'monospace', color: '#ffffff', weight: 500, bg_color: '#000000', bg_opacity: 0.75, bg_radius: 4, shadow: 'none', animation: 'typewriter' } },
  { id: 'hollow', name: 'Hollow', style: { ...BASE, color: 'rgba(0,0,0,0)', weight: 900, uppercase: true, stroke_color: '#ffffff', stroke_width: 4, shadow: 'none', animation: 'fade' } },
]

export type TextAnimation = NonNullable<TextOverlay['animation']>

/** Entrance animations, grouped as they show in the Text tool */
export const TEXT_ANIMATION_GROUPS: { name: string; items: { id: TextAnimation; label: string }[] }[] = [
  { name: 'Basic', items: [
    { id: 'none', label: 'None' }, { id: 'fade', label: 'Fade' }, { id: 'pop', label: 'Pop' },
    { id: 'zoom-in', label: 'Zoom in' }, { id: 'zoom-out', label: 'Zoom out' }, { id: 'blur', label: 'Blur in' },
  ] },
  { name: 'Move', items: [
    { id: 'slide', label: 'Slide up' }, { id: 'slide-down', label: 'Slide down' }, { id: 'slide-left', label: 'Slide left' },
    { id: 'slide-right', label: 'Slide right' }, { id: 'drop', label: 'Drop' }, { id: 'bounce', label: 'Bounce' },
  ] },
  { name: 'Stylish', items: [
    { id: 'typewriter', label: 'Typewriter' }, { id: 'wipe', label: 'Wipe' }, { id: 'spin', label: 'Spin' },
    { id: 'flicker', label: 'Flicker' }, { id: 'glitch', label: 'Glitch' },
  ] },
]

/**
 * Replaying an entrance animation in the preview right after it's picked (even while paused):
 * the Text tool calls replayTextAnimation(id); the preview draws that text from when it was called.
 */
const replays = new Map<string, number>()
export const TEXT_REPLAY_MS = 1400
export function replayTextAnimation(id: string) { replays.set(id, performance.now()) }
/** Milliseconds since the replay of this text began, or null when it isn't replaying */
export function textReplayElapsed(id: string): number | null {
  const at = replays.get(id)
  if (at == null) return null
  const dt = performance.now() - at
  if (dt > TEXT_REPLAY_MS) { replays.delete(id); return null }
  return dt
}

/** #rrggbb + 0–1 opacity → rgba() */
export function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`
}

/** The text as shown (capitals applied) */
export function shownText(o: Pick<TextOverlay, 'text' | 'uppercase'>): string {
  return o.uppercase ? o.text.toUpperCase() : o.text
}

/** Line height of a text, in em of its font size (the export uses the same) */
export const TEXT_LINE_EM = 1.15
/** Narrowest a text box can be dragged, as a share of the frame's width */
export const MIN_TEXT_W = 0.08
/** Shortest a text box can be dragged, as a share of the frame's height */
export const MIN_TEXT_H = 0.03

/**
 * The lines a text is shown in: each line typed (Enter), and with a box width set (`maxW` > 0),
 * words wrapped onto the next line when the line would be wider than the box. A word wider than
 * the box is broken across lines (as many letters as fit on each), so nothing runs out of the box.
 * `measure` gives a string's width in the same units as `maxW`.
 * The export (render.py _wrap_text_lines) breaks lines by exactly this rule, measuring with the
 * same font file — so lines break in the same places in the preview and the video.
 */
export function wrapTextLines(text: string, maxW: number, measure: (s: string) => number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    if (!(maxW > 0)) { lines.push(para); continue }
    const words = para.split(' ')
    let line = ''
    for (let i = 0; i < words.length; i++) {
      const word = words[i]
      const probe = i === 0 ? word : `${line} ${word}`
      if (i > 0 && line && measure(probe) > maxW) { lines.push(line); line = word }
      else line = probe
      // A word wider than the box on its own line: broken across lines, as many letters as fit
      // on each (else it would run out of the box)
      if (line === word && measure(word) > maxW) {
        let piece = ''
        for (const ch of [...word]) {
          if (piece && measure(piece + ch) > maxW) { lines.push(piece); piece = ch }
          else piece += ch
        }
        line = piece
      }
    }
    lines.push(line)
  }
  return lines
}

/** Inner padding of the background box, in em */
export const BG_PAD = { x: 0.35, y: 0.18 }

/**
 * CSS for a text's look, in em of its font size (set fontSize on the element). `bare` drops colour,
 * outline and shadow (for the invisible drag box, which only needs the right size).
 */
export function textCss(o: TextStyle & { size?: number | null }, bare = false): CSSProperties {
  const size = o.size || 72
  const em = (px: number) => `${px / size}em`
  const shadow =
    o.shadow === 'none' ? 'none'
    : o.shadow === 'hard' ? `${em(6)} ${em(6)} 0 ${o.shadow_color ?? '#000'}`
    : o.shadow === 'glow' ? `0 0 ${em(18)} ${o.shadow_color ?? o.color ?? '#fff'}, 0 0 ${em(36)} ${o.shadow_color ?? o.color ?? '#fff'}`
    : `0 ${em(2)} ${em(8)} rgba(0,0,0,0.7)`
  return {
    fontFamily: o.font && o.font !== 'sans-serif' ? o.font : 'sans-serif',
    fontWeight: o.weight ?? 700,
    fontStyle: o.italic ? 'italic' : 'normal',
    textTransform: o.uppercase ? 'uppercase' : 'none',
    letterSpacing: o.letter_spacing ? em(o.letter_spacing) : 'normal',
    lineHeight: 1.15,
    whiteSpace: 'nowrap',
    ...(bare ? { color: 'transparent' } : {
      color: o.color ?? '#ffffff',
      WebkitTextStroke: o.stroke_color && o.stroke_width ? `${em(o.stroke_width)} ${o.stroke_color}` : undefined,
      paintOrder: 'stroke fill',
      textShadow: shadow,
      opacity: o.opacity ?? 1,
    }),
    ...(o.bg_color ? {
      background: bare ? 'transparent' : withAlpha(o.bg_color, o.bg_opacity ?? 1),
      padding: `${BG_PAD.y}em ${BG_PAD.x}em`,
      borderRadius: em(o.bg_radius ?? 12),
    } : {}),
  }
}

// ── Copy style (Ctrl+Alt+C / Ctrl+Alt+V, the Text panel's buttons; user, 2026-11-12) ────────────────
// A text's look — its font, size and colour and the rest of the Text-tool look — taken from one text
// and put on others, which keep their words, place, rotation and timing. Kept in the browser (apart
// from Ctrl+C's copy), so it pastes onto texts in any clip. A frame's text (title band, name tag) has
// only a font, size, colour and background: copied from one, only those; pasted onto one, only those.

/** What a look is made of (the text's own fields) */
export const LOOK_KEYS = ['font', 'size', 'color', ...TEXT_STYLE_KEYS] as const
export type LookKey = typeof LOOK_KEYS[number]
/** A copied look: each of its keys a value, or null = not set (pasted, that part of the look goes back to plain) */
export type CopiedLook = Partial<Record<LookKey, unknown>>

/** A text's whole look (everything, set or not: pasted, it replaces the other text's look entirely) */
export function textLook(t: Partial<TextOverlay>): CopiedLook {
  return Object.fromEntries(LOOK_KEYS.map(k => [k, t[k] ?? null]))
}

/** A frame text's look: its font, size, colour and background (a colour; see-through or the band's own: none) */
export function frameTextLook(it: { font?: string | null; size?: number; color?: string; bg?: string }): CopiedLook {
  return { font: it.font ?? null, size: it.size ?? null, color: it.color ?? null, bg_color: it.bg && /^#[0-9a-f]{6}$/i.test(it.bg) ? it.bg : null }
}

/** A copied look as a text's settings (what it doesn't set: back to plain) */
export function lookOnText(look: CopiedLook): Partial<TextOverlay> {
  const out: Record<string, unknown> = {}
  for (const k of LOOK_KEYS) if (k in look) out[k] = look[k] ?? undefined
  return out as Partial<TextOverlay>
}

/** A copied look as a frame text's settings: its font, size and colour, and a background colour when the look has one */
export function lookOnFrameText(look: CopiedLook): { font?: string | null; size?: number; color?: string; bg?: string } {
  return {
    ...('font' in look ? { font: typeof look.font === 'string' ? look.font : null } : {}),
    ...(typeof look.size === 'number' ? { size: look.size } : {}),
    ...(typeof look.color === 'string' ? { color: look.color } : {}),
    ...(typeof look.bg_color === 'string' ? { bg: look.bg_color } : {}),
  }
}

const LOOK_KEY = 'shortcut.textStyle.v1'
let lookInTab: CopiedLook | null = null
export function writeCopiedLook(look: CopiedLook) {
  lookInTab = look
  try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)) } catch { /* storage off: this tab keeps it */ }
}
/** The look copied last (in any clip), if any */
export function readCopiedLook(): CopiedLook | null {
  try {
    const raw = localStorage.getItem(LOOK_KEY)
    const v = raw ? JSON.parse(raw) : null
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).filter(([k]) => (LOOK_KEYS as readonly string[]).includes(k))) as CopiedLook
  } catch { /* unreadable: this tab's */ }
  return lookInTab
}
