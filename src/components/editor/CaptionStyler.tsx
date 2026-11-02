'use client'

import { useBrandPalette, useBrandLock } from './brandPalette'
import { useBrandFonts, ensureBrandFont } from './brandFonts'
import { CAPTION_TEMPLATE_LIST, TEMPLATE_FONTS, TEMPLATE_GROUPS, applyTemplate, templateFontFamily, templateOf, type CaptionTemplate } from '@/modules/captions/templates'
import { CaptionKeyWords } from './CaptionKeyWords'
import { useEffect, useRef, useState } from 'react'
import type { AnimationType, CaptionStyle } from '@chai-cut/shared'
import { SARVAM_LANGUAGES, DEFAULT_CAPTION_STYLE } from '@chai-cut/shared'
import { VIDEO_FONTS } from '@/lib/shared/videoFonts'
import { inLineText } from '@/lib/inLine'

export type TextCase = 'title' | 'upper' | 'lower'

// (the list itself is shared with the server: lib/shared/videoFonts.ts)
export { VIDEO_FONTS }

const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Roboto:wght@700&family=Montserrat:wght@700&family=Poppins:wght@700&family=Lato:wght@700&family=Inter:wght@700&family=Nunito:wght@700&family=Rubik:wght@700&family=DM+Sans:wght@700&family=Ubuntu:wght@700&family=Space+Grotesk:wght@700&family=Outfit:wght@700&family=Sora:wght@700&family=Raleway:wght@700&family=Oswald:wght@700&family=Bebas+Neue&family=Anton&family=Barlow+Condensed:wght@700&family=Fjalla+One&family=Archivo+Black&family=Exo+2:wght@700&family=Righteous&family=Fredoka+One&family=Playfair+Display:wght@700&family=Pacifico&display=swap'

export function loadVideoFonts() {
  if (typeof document === 'undefined') return
  if (document.getElementById('chai-cut-video-fonts')) return
  const link = document.createElement('link')
  link.id = 'chai-cut-video-fonts'
  link.rel = 'stylesheet'
  link.href = GOOGLE_FONTS_URL
  document.head.appendChild(link)
}

interface FontPickerProps {
  value: string | null
  onChange: (family: string) => void
  /** The list stays open after a font is picked, so fonts can be tried one after another; a click
   *  outside it (or Escape) closes it (user, 2026-11-01: the Brand kit's title font closed on each pick) */
  stayOpen?: boolean
}

export function FontPicker({ value, onChange, stayOpen = false }: FontPickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // A brand kit's own fonts first (components/editor/brandFonts.ts)
  const brandFonts = useBrandFonts()
  // (brand lock with fonts named: only those)
  const lock = useBrandLock()
  const allFonts = [...brandFonts, ...VIDEO_FONTS]
  const all = lock?.fonts.length ? allFonts.filter(f => lock.fonts.includes(f.family)) : allFonts
  const current = all.find(f => f.family === (value ?? 'sans-serif')) ?? (value && value.startsWith('BrandFont-') ? { family: value, name: 'Brand font' } : VIDEO_FONTS[0])
  useEffect(() => { ensureBrandFont(value) }, [value])

  useEffect(() => { loadVideoFonts() }, [])

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    // (Escape closes it too)
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div className="flex flex-col gap-2" ref={ref}>
      <span className="text-xs font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Font</span>
      <div style={{ position: 'relative' }}>
        {/* Trigger button */}
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg"
          style={{
            background: 'rgb(var(--ed-fg) / 0.06)',
            border: `1px solid ${open ? 'rgba(200,255,0,0.5)' : 'rgb(var(--ed-fg) / 0.1)'}`,
            cursor: 'pointer',
          }}
        >
          <span style={{ fontFamily: current.family, fontSize: 14, fontWeight: 700, color: 'var(--ed-text)' }}>
            {current.name}
          </span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, marginLeft: 8 }}>
            <path d={open ? 'M2 8l4-4 4 4' : 'M2 4l4 4 4-4'} stroke="rgb(var(--ed-fg) / 0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Dropdown list */}
        {open && (
          <div
            className="absolute w-full overflow-y-auto z-50"
            style={{
              top: 'calc(100% + 4px)',
              left: 0,
              maxHeight: 260,
              background: 'var(--ed-popover)',
              border: '1px solid rgb(var(--ed-fg) / 0.12)',
              borderRadius: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
              scrollbarWidth: 'thin',
            }}
          >
            {brandFonts.length > 0 && (
              <div className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>Brand fonts</div>
            )}
            {all.map((f, i) => {
              const active = current.family === f.family
              return (
                <button
                  key={f.family}
                  data-brand-font={i < brandFonts.length || undefined}
                  onClick={() => { onChange(f.family); if (!stayOpen) setOpen(false) }}
                  className="w-full text-left px-4 py-2.5"
                  style={{
                    fontFamily: f.family,
                    fontSize: 14,
                    fontWeight: 700,
                    color: active ? 'var(--ed-accent-text)' : 'rgb(var(--ed-fg) / 0.75)',
                    background: active ? 'rgba(200,255,0,0.1)' : 'transparent',
                    borderBottom: '1px solid rgb(var(--ed-fg) / 0.04)',
                    cursor: 'pointer',
                    display: 'block',
                  }}
                >
                  {f.name}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

interface Props {
  style: Partial<CaptionStyle>
  textCase: TextCase
  onChange: (updates: Partial<CaptionStyle>) => void
  onTextCaseChange: (c: TextCase) => void
  onEditCaptions: () => void
  onRetranscribe: (languageCode: string) => void
  retranscribing: boolean
  retranscribeElapsed?: number
  /** Waiting its turn: the place in line (1 = next) */
  retranscribePlace?: number | null
  retranscribeError?: string | null
  hasWords?: boolean
  hasRoman?: boolean
  romanize?: boolean
  romanizeLabel?: string
  onRomanizeChange?: (v: boolean) => void
}

const PRESET_COLORS = [
  '#FFE700',
  '#FFFFFF',
  '#22d3ee',
  '#c8ff00',
  '#ec4899',
  '#f97316',
]

// Caption styles. Each button shows a tiny looping demo of its animation (CSS, see PRESET_CSS);
// the real thing is drawn by VideoPreview drawPresetCaptions and render.py _preset_events.
const PRESETS: Array<{ id: AnimationType; label: string }> = [
  { id: 'karaoke', label: 'Karaoke' },
  { id: 'hormozi', label: 'Hormozi' },
  { id: 'box', label: 'Box' },
  { id: 'glow', label: 'Glow' },
  { id: 'pop', label: 'Pop' },
  { id: 'highlight', label: 'Highlight' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'word', label: 'One word' },
  { id: 'fade', label: 'Fade' },
  { id: 'none', label: 'None' },
]
const CLASSIC = 'Classic'
/** The tab with every style: the classic animations, then every ready-made look */
const ALL_STYLES = 'All'
const ANIMATED = ['karaoke', 'hormozi', 'box', 'glow', 'pop', 'highlight', 'bounce', 'word']
const HIGHLIGHT_COLORS = ['#FFE700', '#c8ff00', '#22d3ee', '#ec4899', '#f97316', '#8b5cf6']

const PRESET_CSS = `
@keyframes cc-pop { 0%,12% { transform: scale(.8); opacity: 0 } 16% { transform: scale(1.1); opacity: 1 } 22%,100% { transform: scale(1); opacity: 1 } }
@keyframes cc-kar { 0%,33% { color: var(--cc-hl) } 34%,100% { color: inherit } }
@keyframes cc-hz { 0%,33% { color: var(--cc-hl); transform: scale(1.15) } 34%,100% { color: inherit; transform: none } }
@keyframes cc-glow { 0%,33% { opacity: 1 } 34%,100% { opacity: .6 } }
@keyframes cc-hl { 0%,33% { background: var(--cc-hl); color: #000 } 34%,100% { background: transparent; color: inherit } }
@keyframes cc-bounce { 0% { transform: translateY(5px); opacity: 0 } 15%,100% { transform: none; opacity: 1 } }
@keyframes cc-word1 { 0%,32% { opacity: 1 } 33%,100% { opacity: 0 } }
@keyframes cc-fade { 0% { opacity: 0 } 25%,100% { opacity: 1 } }
.cc-demo span { display: inline-block; border-radius: 3px; padding: 0 2px }
@keyframes cc-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
${Object.entries(TEMPLATE_FONTS).map(([key, f]) => `@font-face { font-family: "${templateFontFamily(key)}"; src: url(/caption-fonts/${f.file}); font-weight: ${f.weight}; font-style: ${f.italic ? 'italic' : 'normal'}; font-display: swap }`).join('\n')}
`

/**
 * A caption style's tile: a few words as the style draws them while the middle one is spoken —
 * its fonts, starting colours, box, glow, and one word a line when it stacks
 */
function TemplateDemo({ t }: { t: CaptionTemplate }) {
  const words = t.perLine === 1 ? ['Hey'] : t.perLine === 2 ? ['Hey', 'there'] : ['Hey', 'there', 'friend']
  const live = Math.min(1, words.length - 1)
  const px = (key: string, scale = 1) => 11 * (t.size / 100) * (TEMPLATE_FONTS[key].em / 0.6) * scale
  const face = (key: string): React.CSSProperties => {
    const f = TEMPLATE_FONTS[key]
    return { fontFamily: `"${templateFontFamily(key)}", sans-serif`, fontWeight: f.weight, fontStyle: f.italic ? 'italic' : 'normal' }
  }
  const lineBox = t.base === 'box' || (!!t.box && !t.stack)
  const outline = t.base !== 'box' && (t.stroke ?? 4) > 0
  const shadow = t.base === 'box' ? undefined : `${(t.shadow ?? 2) / 3}px ${(t.shadow ?? 2) / 3}px 0 rgba(0,0,0,0.55)`
  return (
    <span className="inline-flex items-center justify-center" style={{
      flexDirection: t.stack ? 'column' : 'row', gap: t.stack ? 0 : '0.28em', lineHeight: 1.05, whiteSpace: 'nowrap',
      color: t.color, textTransform: t.upper ? 'uppercase' : undefined, ...face(t.font), fontSize: px(t.font),
      ...(lineBox ? { background: t.box === 'hl' ? t.hl : t.box ?? 'rgba(0,0,0,0.62)', padding: '2px 6px' } : {}),
      ...(outline ? { WebkitTextStroke: `${Math.min(0.6, (t.stroke ?? 4) / 10)}px #000`, paintOrder: 'stroke fill' } : {}),
    }}>
      {words.map((w, i) => {
        const spoken = i === live
        const key = spoken && t.liveFont ? t.liveFont : t.font
        const chip = t.base === 'highlight' && spoken
        const glow = t.base === 'glow'
        return (
          <span key={w} style={{
            ...(spoken && t.liveFont ? face(key) : {}),
            fontSize: px(key, spoken && t.base === 'hormozi' ? (t.scale ?? 115) / 100 : 1),
            color: chip ? (parseInt(t.hl.slice(1, 3), 16) * 0.299 + parseInt(t.hl.slice(3, 5), 16) * 0.587 + parseInt(t.hl.slice(5, 7), 16) * 0.114 > 150 ? '#000' : '#fff')
              : spoken && !t.liveText && !glow ? t.hl : undefined,
            background: chip ? t.hl : undefined, padding: chip ? '0 3px' : undefined,
            WebkitTextStroke: chip ? '0' : undefined,
            opacity: glow && !spoken ? 0.65 : 1,
            textShadow: glow ? `0 0 5px ${t.hl}, 0 0 10px ${t.hl}` : chip ? undefined : shadow,
          }}>{w}</span>
        )
      })}
    </span>
  )
}

/**
 * A Creator style's tile (a template with a look: modules/captions/creator.ts): a still of how it
 * lays a line out — its fonts and starting colours
 */
function CreatorDemo({ t }: { t: CaptionTemplate }) {
  const face = (key: string, px: number): React.CSSProperties => {
    const f = TEMPLATE_FONTS[key]
    return { fontFamily: `"${templateFontFamily(key)}", sans-serif`, fontWeight: f.weight, fontStyle: f.italic ? 'italic' : 'normal', fontSize: px * f.em / 0.6, lineHeight: 1 }
  }
  const key = t.keyFont ?? t.font
  const shadow = t.shadow ? '1px 1px 0 rgba(0,0,0,0.5)' : undefined
  const box: React.CSSProperties = { position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', textShadow: shadow }
  switch (t.look) {
    case 'behind':
      // The word with a head and shoulders in front of it
      return (
        <span style={box}>
          <span style={{ ...face(t.font, 30), color: t.color, textTransform: 'uppercase', transform: 'translateY(-6px)' }}>Focus</span>
          <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" style={{ position: 'absolute', bottom: -6 }}>
            <circle cx="20" cy="14" r="8" fill="#2a2a2e" /><path d="M4 40c0-10 7-16 16-16s16 6 16 16z" fill="#2a2a2e" />
          </svg>
        </span>
      )
    case 'difference':
      return (
        <span style={{ ...box, flexDirection: 'column', background: 'linear-gradient(135deg,#3b3f8f,#c76b2f)' }}>
          <span style={{ ...face(t.font, 8), color: t.color }}>make it</span>
          <span style={{ ...face(key, 18), color: '#fff', mixBlendMode: 'difference' }}>pop.</span>
        </span>
      )
    case 'build':
      return (
        <span style={{ ...box, flexDirection: 'column', gap: 1 }}>
          {['Not', 'many', 'know'].map((w, i) => <span key={w} style={{ ...face(t.font, 11), color: i === 1 ? t.hl : t.color, textTransform: 'uppercase' }}>{w}</span>)}
        </span>
      )
    case 'multi':
      return (
        <span style={{ ...box, alignItems: 'flex-start', justifyContent: 'flex-start', flexDirection: 'column', padding: '6px 8px' }}>
          <span style={{ ...face(t.font, 8), color: t.color }}>you&apos;ve done</span>
          <span style={{ ...face(key, 15), color: t.color }}>absolutely</span>
        </span>
      )
    case 'scroll':
      return (
        <span style={{ ...box, flexDirection: 'column' }}>
          <span style={{ ...face(t.font, 8), color: t.hl, opacity: 0.28 }}>FOR</span>
          <span style={{ ...face(t.font, 12), color: t.hl }}>YOU.</span>
          <span style={{ ...face(t.font, 8), color: t.hl, opacity: 0.28 }}>ALL</span>
        </span>
      )
    case 'split':
      return (
        <span style={{ ...box, alignItems: 'baseline', gap: 3, paddingTop: 18 }}>
          <span style={{ ...face(t.font, 9), color: t.color }}>and</span>
          <span style={{ ...face(key, 17), color: t.hl }}>radiant.</span>
        </span>
      )
    case 'subtitle':
      return (
        <span style={{ ...box, gap: 3 }}>
          {['let', 'me', 'show', 'you'].map((w, i) => <span key={w} style={{ ...face(t.font, 8), color: t.color, opacity: i < 3 ? 0.65 : 1 }}>{w}</span>)}
        </span>
      )
    case 'scribble':
      return (
        <span style={{ ...box, gap: 3 }}>
          <span style={{ ...face(t.font, 11), color: t.color }}>right</span>
          <span style={{ position: 'relative' }}>
            <span style={{ ...face(t.font, 11), color: t.color }}>tools</span>
            <svg width="100%" height="5" viewBox="0 0 30 5" preserveAspectRatio="none" aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: -4 }}>
              <path d="M0 2.5 Q3.75 0 7.5 2.5 T15 2.5 T22.5 2.5 T30 2.5" fill="none" stroke={t.hl} strokeWidth="1.6" />
            </svg>
          </span>
        </span>
      )
    default:
      return <TemplateDemo t={t} />
  }
}

function formatElapsed(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

function PresetDemo({ id, hl }: { id: AnimationType; hl: string }) {
  const words = ['Hey', 'there', 'friend']
  const d = '2.4s'
  if (id === 'word') {
    return (
      <span className="cc-demo relative inline-block" style={{ width: 44, height: 14 }}>
        {words.map((w, i) => (
          <span key={w} className="absolute inset-0 text-center" style={{ animation: `cc-word1 ${d} ${i * 0.8}s infinite both`, opacity: 0 }}>{w}</span>
        ))}
      </span>
    )
  }
  return (
    <span className="cc-demo whitespace-nowrap" style={{
      ['--cc-hl' as string]: hl, display: 'inline-block',
      animation: id === 'bounce' ? `cc-bounce ${d} infinite` : id === 'fade' ? `cc-fade ${d} infinite` : undefined,
      ...(id === 'box' ? { background: 'rgba(0,0,0,0.62)', color: '#fff', padding: '0 3px' } : {}),
      ...(id === 'hormozi' ? { textTransform: 'uppercase', fontSize: 10, WebkitTextStroke: '0.4px #000' } : {}),
    }}>
      {(id === 'hormozi' ? words.slice(0, 2) : words).map((w, i) => {
        const step = `${d} ${i * 0.8}s infinite both`
        return (
          <span key={w} style={{
            animation: id === 'pop' ? `cc-pop ${step}`
              : id === 'highlight' ? `cc-hl ${step}`
              : id === 'karaoke' || id === 'box' || id === 'bounce' ? `cc-kar ${step}`
              : id === 'hormozi' ? `cc-hz ${step}`
              : id === 'glow' ? `cc-glow ${step}` : undefined,
            textShadow: id === 'glow' ? `0 0 4px ${hl}, 0 0 8px ${hl}` : undefined,
          }}>{w}</span>
        )
      })}
    </span>
  )
}

// ── Colour chooser ────────────────────────────────────────────────────────────
// One-click pairs (text + highlight) that read well on video
const COLOUR_THEMES: { name: string; text: string; highlight: string }[] = [
  { name: 'Classic', text: '#FFFFFF', highlight: '#FFE700' },
  { name: 'Lime', text: '#FFFFFF', highlight: '#C8FF00' },
  { name: 'Aqua', text: '#FFFFFF', highlight: '#22D3EE' },
  { name: 'Candy', text: '#FFFFFF', highlight: '#EC4899' },
  { name: 'Fire', text: '#FFFFFF', highlight: '#F97316' },
  { name: 'Royal', text: '#FFFFFF', highlight: '#8B5CF6' },
  { name: 'Sunshine', text: '#FFE700', highlight: '#FFFFFF' },
  { name: 'Mint', text: '#C8FF00', highlight: '#FFFFFF' },
]
// Named colours of the palette (the name shows on the field, so no one has to read a hex code)
const PALETTE: { hex: string; name: string }[] = [
  { hex: '#FFFFFF', name: 'White' }, { hex: '#D4D4D8', name: 'Silver' }, { hex: '#71717A', name: 'Grey' }, { hex: '#000000', name: 'Black' },
  { hex: '#FFE700', name: 'Yellow' }, { hex: '#FACC15', name: 'Gold' }, { hex: '#F97316', name: 'Orange' }, { hex: '#EF4444', name: 'Red' },
  { hex: '#EC4899', name: 'Pink' }, { hex: '#D946EF', name: 'Magenta' }, { hex: '#8B5CF6', name: 'Purple' }, { hex: '#3B82F6', name: 'Blue' },
  { hex: '#22D3EE', name: 'Aqua' }, { hex: '#14B8A6', name: 'Teal' }, { hex: '#22C55E', name: 'Green' }, { hex: '#C8FF00', name: 'Lime' },
]
const sameHex = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const colourName = (hex: string) => PALETTE.find(c => sameHex(c.hex, hex))?.name ?? hex.toUpperCase()

function hueToHex(h: number): string {
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = 0.55 - 0.45 * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}
function hexToHue(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b)
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return Math.round(((h * 60) + 360) % 360)
}

function ColourChooser({ text, highlight, showHighlight, highlightLabel, onText, onHighlight }: {
  text: string; highlight: string; showHighlight: boolean; highlightLabel: string
  onText: (c: string) => void; onHighlight: (c: string) => void
}) {
  const [open, setOpen] = useState<'text' | 'highlight' | null>(null)
  const theme = COLOUR_THEMES.find(t => sameHex(t.text, text) && (!showHighlight || sameHex(t.highlight, highlight)))?.name
  return (
    <div className="flex flex-col gap-3">
      {/* Live sample of the two colours together */}
      <div className="cp-sample" aria-hidden="true">
        <span style={{ color: text }}>Hey there </span>
        <span style={{ color: showHighlight ? highlight : text }}>friend</span>
      </div>

      {/* Themes: both colours in one click */}
      <div className="flex flex-col gap-2">
        <span className="cap-label">Colour theme</span>
        <div className="grid grid-cols-4 gap-1.5">
          {COLOUR_THEMES.map(t => (
            <button key={t.name} type="button" className="cp-theme" data-on={theme === t.name || undefined}
              onClick={() => { onText(t.text); if (showHighlight) onHighlight(t.highlight) }}
              aria-pressed={theme === t.name} title={`${t.name}: ${colourName(t.text)} text, ${colourName(t.highlight)} ${highlightLabel.toLowerCase()}`}>
              <span className="cp-theme-dots" aria-hidden="true">
                <span style={{ background: t.text }} /><span style={{ background: t.highlight }} />
              </span>
              <span className="cp-theme-name">{t.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Each colour on its own: a field that opens its palette */}
      <div className="flex flex-col gap-2">
        <ColourField label="Text" value={text} onChange={onText}
          open={open === 'text'} onToggle={() => setOpen(o => (o === 'text' ? null : 'text'))} />
        {showHighlight && (
          <ColourField label={highlightLabel} value={highlight} onChange={onHighlight}
            open={open === 'highlight'} onToggle={() => setOpen(o => (o === 'highlight' ? null : 'highlight'))} />
        )}
      </div>
    </div>
  )
}

/** A labelled colour: its chip and name, and (opened) a palette, a rainbow slider and a hex box */
function ColourField({ label, value, onChange, open, onToggle }: {
  label: string; value: string; onChange: (c: string) => void; open: boolean; onToggle: () => void
}) {
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const hue = hexToHue(value)
  // The brand kit's colours first (components/editor/brandPalette.ts)
  const brand = useBrandPalette()
  // (brand lock: the team kit's colours only, no hue slider or code)
  const lock = useBrandLock()
  const cells = lock
    ? lock.colors.map(hex => ({ hex, name: 'Brand colour' }))
    : [...brand.map(hex => ({ hex, name: 'Brand colour' })), ...PALETTE.filter(c => !brand.includes(c.hex.toLowerCase()))]
  return (
    <div className="cp-field" data-open={open || undefined}>
      <button type="button" className="cp-field-head" onClick={onToggle} aria-expanded={open}>
        <span className="cp-chip" style={{ background: value }} aria-hidden="true" />
        <span className="cp-field-label">{label}</span>
        <span className="cp-field-name">{colourName(value)}</span>
        <span className="ed-collapse" data-open={open || undefined} aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </span>
      </button>
      {open && (
        <div className="cp-panel">
          <div className="grid grid-cols-8 gap-1.5">
            {cells.map(c => (
              <button key={c.hex} type="button" onClick={() => onChange(c.hex)} title={c.name}
                aria-label={`${label} colour ${c.name}`} aria-pressed={sameHex(c.hex, value)}
                className="cp-cell" data-on={sameHex(c.hex, value) || undefined} style={{ background: c.hex }} />
            ))}
          </div>
          {lock && <span className="cp-mini">Brand lock: {lock.by}&rsquo;s colours</span>}
          {!lock && <>
          <div className="flex flex-col gap-1.5">
            <span className="cp-mini">Any colour</span>
            <input type="range" min={0} max={359} step={1} value={hue} aria-label={`${label} colour hue`}
              onChange={e => onChange(hueToHex(Number(e.target.value)))} className="cp-hue" />
          </div>
          <label className="cp-hex">
            <span className="cp-mini">Code</span>
            <input value={hexDraft ?? value.toUpperCase()} maxLength={7} spellCheck={false} aria-label={`${label} colour code`}
              onChange={e => {
                const v = e.target.value.trim()
                setHexDraft(v)
                const full = v.startsWith('#') ? v : `#${v}`
                if (/^#[0-9a-f]{6}$/i.test(full)) onChange(full)
              }}
              onBlur={() => setHexDraft(null)} />
          </label>
          </>}
        </div>
      )}
    </div>
  )
}

function applyCase(text: string, tc: TextCase): string {
  if (tc === 'upper') return text.toUpperCase()
  if (tc === 'lower') return text.toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
}

export function CaptionStyler({
  style, textCase,
  onChange, onTextCaseChange, onEditCaptions, onRetranscribe, retranscribing, retranscribeElapsed = 0,
  retranscribePlace = null, retranscribeError = null,
  hasWords = false, hasRoman = false, romanize = false, romanizeLabel = 'Romanize', onRomanizeChange,
}: Props) {
  const color = style.color ?? DEFAULT_CAPTION_STYLE.color
  const animation = style.animation ?? DEFAULT_CAPTION_STYLE.animation
  const hl = style.highlight_color ?? '#FFE700'
  const tpl = templateOf(style)
  // The kind of style shown: the picked caption style's own; otherwise Classic (the plain animations)
  const [group, setGroup] = useState(tpl?.group ?? CLASSIC)
  /** A ready-made look's tile: its own font; picking it sets its colours too (change them below) */
  const templateTile = (t: CaptionTemplate) => {
    const on = tpl?.id === t.id
    return (
      <button key={t.id} aria-pressed={on} className="cap-tile" data-on={on || undefined} title={t.label}
        onClick={() => { onChange(applyTemplate(t)); onTextCaseChange(t.upper ? 'upper' : 'title') }}>
        <span className="cap-tile-screen" style={{ height: 56, overflow: 'hidden' }}>
          {t.look ? <CreatorDemo t={t} /> : <TemplateDemo t={t} />}
        </span>
        <span className="cap-tile-name">{t.label}</span>
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-5 px-4 pb-5 pt-1">
      {/* Making captions failed (e.g. Google's service down): say why, and offer to try again */}
      {retranscribeError && !retranscribing && (
        <div role="alert" className="flex flex-col gap-2 rounded-xl px-3 py-2.5 text-[12px] leading-snug"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' }}>
          <span>{retranscribeError}</span>
          <button type="button" onClick={() => onRetranscribe('unknown')}
            className="self-start rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors hover:bg-[rgba(239,68,68,0.2)]"
            style={{ border: '1px solid rgba(239,68,68,0.45)', color: '#fecaca' }}>
            Try again
          </button>
        </div>
      )}
      <style>{PRESET_CSS}</style>

      {/* ── Rerender: re-run AI transcription on this clip's audio, keeping style/edits as-is ── */}
      {hasWords && (
        <section className="flex flex-col gap-1.5">
          <button onClick={() => onRetranscribe('unknown')} disabled={retranscribing}
            className="cap-link" aria-busy={retranscribing || undefined}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              style={retranscribing ? { animation: 'cc-spin 1s linear infinite' } : undefined}>
              <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />
            </svg>
            <span className="flex-1 text-left">
              {retranscribing
                ? `Regenerating captions… ${formatElapsed(retranscribeElapsed)}${retranscribePlace ? ` · ${inLineText(retranscribePlace)}` : ''}`
                : 'Regenerate captions'}
            </span>
          </button>
          {retranscribeError && (
            <p className="text-[11px]" style={{ color: '#f87171' }}>{retranscribeError}</p>
          )}
        </section>
      )}

      {/* ── Style: each tile is a little dark "screen" playing the animation, its name below ── */}
      <section className="flex flex-col gap-2.5">
        <h3 className="cap-heading">Style</h3>
        {/* The kinds of style; "All" every one of them, "Classic" the plain animations */}
        <div role="tablist" aria-label="Kinds of caption style" className="flex flex-wrap gap-1.5">
          {[ALL_STYLES, CLASSIC, ...TEMPLATE_GROUPS].map(g => (
            <button key={g} role="tab" aria-selected={group === g} onClick={() => setGroup(g)}
              className="px-2.5 h-7 rounded-full text-[11.5px] font-semibold transition-colors"
              style={group === g
                ? { background: '#c8ff00', color: '#0a0a0a' }
                : { background: 'rgb(var(--ed-fg) / 0.05)', color: 'rgb(var(--ed-fg) / 0.7)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.08)' }}>
              {g}
            </button>
          ))}
        </div>
        {group === ALL_STYLES || group === CLASSIC ? (
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map(p => {
              const on = !tpl && animation === p.id
              return (
                // (a classic animation is not a caption style: picking one drops the style)
                <button key={p.id} onClick={() => onChange({ animation: p.id, template: null })} aria-pressed={on}
                  className="cap-tile" data-on={on || undefined}>
                  <span className="cap-tile-screen">
                    <span className="text-[11px] font-bold flex items-center" style={{ color: '#fff' }}>
                      <PresetDemo id={p.id} hl={hl} />
                    </span>
                  </span>
                  <span className="cap-tile-name">{p.label}</span>
                </button>
              )
            })}
            {group === ALL_STYLES && CAPTION_TEMPLATE_LIST.map(t => templateTile(t))}
          </div>
        ) : (
          // Ready-made looks: each has its own font; picking one sets its colours too (change them below)
          <div className="grid grid-cols-2 gap-2">
            {CAPTION_TEMPLATE_LIST.filter(t => t.group === group).map(t => templateTile(t))}
          </div>
        )}
      </section>

      {/* ── Key words: what a Creator style makes stand out (AI picks them; tap to change) ── */}
      {tpl?.look && <CaptionKeyWords style={style} tpl={tpl} onChange={onChange} />}

      {/* ── Look: colours, font, size and capitals ── */}
      <section className="flex flex-col gap-4">
        <h3 className="cap-heading">Look</h3>

      {/* Colours: a live sample, one-click themes, then a field per colour that opens a palette */}
      <ColourChooser
        text={color} highlight={hl}
        showHighlight={!!tpl || ANIMATED.includes(animation)}
        highlightLabel={(tpl ? tpl.base === 'highlight' || tpl.box === 'hl' : animation === 'highlight') ? 'Box' : tpl?.base === 'glow' ? 'Glow' : 'Highlight'}
        onText={c => onChange({ color: c })}
        onHighlight={c => onChange({ highlight_color: c })}
      />

      {/* Font */}
      <FontPicker value={style.font ?? null} onChange={family => onChange({ font: family })} />

      {/* Size */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="cap-label">Size</span>
          <span className="cap-value">{style.size ?? 52}</span>
        </div>
        <input type="range" min={20} max={100} step={2} value={style.size ?? 52}
          onChange={e => onChange({ size: Number(e.target.value) })}
          aria-label="Caption size"
          className="ed-zoom-range w-full" style={{ '--p': `${(((style.size ?? 52) - 20) / 80) * 100}%` } as React.CSSProperties} />
      </div>

      {/* Case */}
      <div className="cap-row">
        <span className="cap-label">Capitals</span>
        <div role="radiogroup" aria-label="Capitals" className="cap-seg">
          {([['title', 'Aa', 'First letter capital'], ['upper', 'AA', 'ALL CAPITALS'], ['lower', 'aa', 'all small letters']] as const).map(([c, label, title]) => (
            <button key={c} role="radio" aria-checked={textCase === c} title={title}
              // Capitals are saved with the style, so the export shows them too
              onClick={() => { onTextCaseChange(c); onChange({ uppercase: c === 'upper' }) }}
              className="cap-seg-btn cap-seg-case" data-on={textCase === c || undefined}>
              {label}
            </button>
          ))}
        </div>
      </div>
      </section>

    </div>
  )
}

export { applyCase }
