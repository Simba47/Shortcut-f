import type { AnimationType, CaptionStyle } from '@chai-cut/shared'
import catalogue from './caption_templates.json'

/**
 * Caption styles ("templates"): a ready-made look — one of the animated presets (`base`) drawn in
 * its own font, with its own capitals, outline, shadow, box and layout. The colours stay the
 * user's (color, highlight_color); `color` / `hl` here are the ones the style starts with.
 *
 * The one picked is saved as caption_styles.template; `animation` keeps the style's base preset, so
 * anything that doesn't know templates (an older worker) draws that instead.
 *
 * They are listed in caption_templates.json — the SAME file as the backend's
 * (src/python/caption_templates.json, read by render.py which draws the export): keep the two identical.
 *   base       the preset whose animation it uses; 'plain' = the spoken word changes colour, nothing else
 *   font       a key of the file's fonts (used for Latin text; other scripts keep their own font)
 *   liveFont   the spoken word is drawn in this font instead
 *   upper      capital letters
 *   stack      one word a line
 *   box        the line sits on a box: 'hl' = filled with the highlight colour, '#RRGGBB' = that colour
 *              (base 'box' without it: dark glass)
 *   liveText   the spoken word keeps the text colour (no karaoke colour change)
 *   scale      base 'hormozi': how big the spoken word is (%)
 *   stroke     outline thickness; shadow: drop shadow distance (px at 1080 wide)
 *   perLine    words per caption line
 *   size       % of the caption size it is drawn at (narrow fonts read small at the same size)
 *   look       a Creator style: laid out and animated its own way (creator.ts; `base` is then only
 *              what something that doesn't know looks draws)
 *   keyFont    look: the line's key word in this font, keyScale % of the size
 */
export interface CaptionTemplate {
  id: string
  label: string
  group: string
  base: 'plain' | 'box' | 'hormozi' | 'pop' | 'glow' | 'highlight'
  font: string
  liveFont?: string
  upper?: boolean
  stack?: boolean
  box?: string
  liveText?: boolean
  scale?: number
  stroke?: number
  shadow?: number
  perLine: number
  size: number
  color: string
  hl: string
  look?: CreatorLook
  keyFont?: string
  keyScale?: number
}

export type CreatorLook = 'behind' | 'difference' | 'build' | 'multi' | 'scroll' | 'split' | 'subtitle' | 'scribble'

/**
 * A bundled font file (public/caption-fonts, and the backend's src/python/fonts): `family` / `bold`
 * / `italic` are how the export asks for it; the editor draws the same file at the weight and
 * slant it already is. `em` sizes it as the export does (unitsPerEm / (winAscent + winDescent)),
 * `asc` is where its baseline is (winAscent / (winAscent + winDescent)).
 */
export interface TemplateFont { family: string; bold: number; italic: number; file: string; em: number; weight: number; asc: number }

export const CAPTION_TEMPLATE_LIST = catalogue.templates as CaptionTemplate[]
export const CAPTION_TEMPLATES: Record<string, CaptionTemplate | undefined> = Object.fromEntries(CAPTION_TEMPLATE_LIST.map(t => [t.id, t]))
export const TEMPLATE_FONTS = catalogue.fonts as Record<string, TemplateFont>
/** The groups, in the order the panel shows them */
export const TEMPLATE_GROUPS = [...new Set(CAPTION_TEMPLATE_LIST.map(t => t.group))]

/** The family the editor registers a template font under (its own name: the plain caption fonts register theirs differently) */
export const templateFontFamily = (key: string) => `CT ${key}`

/** The caption style picked for these captions, if any */
export const templateOf = (style: Partial<CaptionStyle>) => (style.template ? CAPTION_TEMPLATES[style.template] : undefined)

/** Only Latin letters (and digits, punctuation, emoji): a template's own font can draw it (render.py _is_latin) */
export const isLatinText = (text: string) => ![...text].some(ch => ch.codePointAt(0)! > 0x024f && /\p{L}/u.test(ch))

/** The animated presets (VideoPreview drawPresetCaptions, render.py _PRESETS): they draw key words bigger, in the highlight colour */
export const PRESET_ANIMATIONS = ['pop', 'highlight', 'bounce', 'word', 'hormozi', 'box', 'glow'] as const

/**
 * Whether a style shows key words (caption_styles.emphasis): a Creator style, any caption style
 * (a preset in its own look) or an animated preset — not Karaoke, Fade or None. The export picks
 * them for the same styles (render.ts pickEmphasis).
 */
export function usesKeyWords(style: Partial<CaptionStyle>): boolean {
  return !!templateOf(style) || (PRESET_ANIMATIONS as readonly string[]).includes(style.animation ?? '')
}

/** The preset saved as `animation` with a template: what is drawn where templates aren't known */
export const baseAnimation = (t: CaptionTemplate): AnimationType => (t.base === 'plain' ? 'karaoke' : t.base)

/** What picking a template sets on the caption style */
export function applyTemplate(t: CaptionTemplate): Partial<CaptionStyle> {
  return {
    template: t.id, animation: baseAnimation(t), color: t.color, highlight_color: t.hl, uppercase: !!t.upper, words_per_line: null,
    // (its own font: a font picked before goes — user, 2026-11-12: a style's font is the default, another can be picked after)
    font: null,
    // A Creator style starts where its look sits (over the head, the middle, the bottom…)
    ...(t.look ? { position_y: null } : {}),
  }
}
