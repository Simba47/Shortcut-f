'use client'

/**
 * Make my clips: the choices that open in a box of their own (user, 2026-11-15, after OpusClip's Layout box):
 * - Layout: the shape of the clips (9:16, 16:9, 1:1, 4:5) and the layouts AI can use (Fill, Fit, Split, Three)
 * - Captions: the caption style the clips get (the editor's style tiles)
 * - Frame: the frame the clips come in (the editor's frames), or none
 * They are sent with the run (createAutoClips puts them in the job); the worker follows them once it reads them.
 */
import { KitStyleBar } from '@/components/brand/KitStyleBar'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import type { CaptionStyle, FrameLayout } from '@chai-cut/shared'
import { FRAME_LAYOUTS, FRAME_TEMPLATES, frameSlotCount } from '@/modules/editor/frames'
import { templateOf } from '@/modules/captions/templates'
import { FrameThumb } from '@/components/editor/FramesPanel'
import { TEXT_PRESETS, textCss } from '@/modules/editor/textStyle'

// (the style tiles load only when the Captions box opens: the editor's panel, with its fonts)
const CaptionStyler = dynamic(() => import('@/components/editor/CaptionStyler').then(m => m.CaptionStyler), {
  ssr: false, loading: () => <div className="mmc-pop-wait" />,
})
const FontPicker = dynamic(() => import('@/components/editor/CaptionStyler').then(m => m.FontPicker), {
  ssr: false, loading: () => <div className="mmc-pick-btn" />,
})

export type ClipAspect = '9:16' | '16:9' | '1:1' | '4:5'
export type ClipLayoutId = 'fill' | 'fit' | 'split' | 'three'

export const CLIP_ASPECTS: Array<{ id: ClipAspect; w: number; h: number }> = [
  { id: '9:16', w: 9, h: 16 }, { id: '16:9', w: 16, h: 9 }, { id: '1:1', w: 1, h: 1 }, { id: '4:5', w: 4, h: 5 },
]
export const CLIP_LAYOUTS: Array<{ id: ClipLayoutId; label: string; tip: string }> = [
  { id: 'fill', label: 'Fill', tip: 'One person fills the screen' },
  { id: 'fit', label: 'Fit', tip: 'The whole video, nothing cut off' },
  { id: 'split', label: 'Split', tip: 'Two people, one above the other' },
  { id: 'three', label: 'Three', tip: 'Three people: one on top, two below' },
]
export const CLIP_LAYOUT_IDS = CLIP_LAYOUTS.map(l => l.id)

/** What a run's clips look like: their shape, the layouts AI can use, the caption style (null: the usual) and the frame */
export interface MakeLook {
  aspect: ClipAspect
  layouts: ClipLayoutId[]
  captionStyle: Partial<CaptionStyle> | null
  frame: FrameLayout | null
  /** The title's look (a Text-tool style: TEXT_PRESETS) and font; null: the usual */
  titleStyle: string | null
  titleFont: string | null
}
export const DEFAULT_MAKE_LOOK: MakeLook = { aspect: '9:16', layouts: [...CLIP_LAYOUT_IDS], captionStyle: null, frame: null, titleStyle: null, titleFont: null }
/** A title style's name ("Bold pop"), or the usual one */
export const titleStyleName = (id: string | null | undefined) => TEXT_PRESETS.find(t => t.id === id)?.name ?? 'Usual style'

/** A saved look made safe (anything wrong: the default's) */
export function cleanMakeLook(raw: unknown): MakeLook {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const layouts = Array.isArray(d.layouts) ? CLIP_LAYOUT_IDS.filter(id => (d.layouts as unknown[]).includes(id)) : []
  const cs = d.captionStyle && typeof d.captionStyle === 'object' ? d.captionStyle as Partial<CaptionStyle> : null
  return {
    aspect: CLIP_ASPECTS.some(a => a.id === d.aspect) ? d.aspect as ClipAspect : '9:16',
    layouts: layouts.length ? layouts : [...CLIP_LAYOUT_IDS],
    captionStyle: cs && (typeof cs.template === 'string' || typeof cs.animation === 'string') ? captionStyleToSend(cs) : null,
    frame: FRAME_LAYOUTS.includes(d.frame as FrameLayout) ? d.frame as FrameLayout : null,
    titleStyle: TEXT_PRESETS.some(t => t.id === d.titleStyle) ? d.titleStyle as string : null,
    titleFont: typeof d.titleFont === 'string' && d.titleFont.length <= 60 ? d.titleFont : null,
  }
}

/** The parts of a picked caption style a run needs (the style and its colours) */
export function captionStyleToSend(s: Partial<CaptionStyle>): Partial<CaptionStyle> {
  const out: Partial<CaptionStyle> = {}
  if (typeof s.template === 'string') out.template = s.template
  if (typeof s.animation === 'string') out.animation = s.animation
  if (typeof s.color === 'string') out.color = s.color
  if (typeof s.highlight_color === 'string') out.highlight_color = s.highlight_color
  if (typeof s.uppercase === 'boolean') out.uppercase = s.uppercase
  return out
}

/** A caption style's name: the ready-made style's, or the plain animation's ("Karaoke": none picked — the usual one) */
export function captionStyleName(s: Partial<CaptionStyle> | null | undefined): string {
  if (!s) return 'Karaoke'
  const t = templateOf(s)
  if (t) return t.label
  const a = s.animation ?? 'karaoke'
  return a.charAt(0).toUpperCase() + a.slice(1)
}

export const frameName = (f: FrameLayout | null | undefined) => (f ? FRAME_TEMPLATES[f]?.name ?? 'Frame' : 'None')

/**
 * A box that opens from a tile or a bar of the Make my clips card. With `over` (the video preview — user,
 * 2026-11-15: "the popup should be in the preview section"), it covers that, with its name and a close
 * button; else under its tile (or over it, where there's more room), as wide as the card. It follows
 * while open; outside clicks and Esc close it.
 */
export function MmcPop({ anchor, over = null, open, onClose, label, children }: {
  anchor: HTMLElement | null; over?: HTMLElement | null; open: boolean; onClose: () => void; label: string; children: React.ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number; height?: number } | null>(null)
  useEffect(() => {
    if (!open || !anchor) { setAt(null); return }
    const place = () => {
      if (over) {
        const o = over.getBoundingClientRect(), pad = 10
        const top = Math.max(8, o.top + pad), bottom = Math.min(window.innerHeight - 8, o.bottom - pad)
        return { left: o.left + pad, width: Math.max(0, o.width - pad * 2), top, maxH: bottom - top, height: bottom - top }
      }
      const r = anchor.getBoundingClientRect()
      // (as wide as the card it opens from: the nearest one that clips its content, else the anchor)
      let panel: Element | null = anchor.parentElement
      while (panel && panel !== document.body && getComputedStyle(panel).overflowX === 'visible') panel = panel.parentElement
      const p = panel && panel !== document.body ? panel.getBoundingClientRect() : r
      const lo = Math.max(8, p.left + 4), hi = Math.min(window.innerWidth - 8, p.right - 4)
      const width = Math.max(0, Math.min(Math.max(hi - lo, 280), window.innerWidth - 16))
      const left = Math.max(8, Math.min(lo, window.innerWidth - 8 - width))
      const below = window.innerHeight - r.bottom - 14, above = r.top - 14
      return below >= 360 || below >= above
        ? { left, width, top: r.bottom + 6, maxH: below }
        : { left, width, bottom: window.innerHeight - r.top + 6, maxH: above }
    }
    let raf = 0, last = ''
    const follow = () => {
      const next = place()
      const key = JSON.stringify(next)
      if (key !== last) { last = key; setAt(next) }
      raf = requestAnimationFrame(follow)
    }
    follow()
    const away = (e: PointerEvent) => {
      const t = e.target as Node
      // (a choice list opened from inside the box — the captions' language — floats outside it: still inside)
      if (!box.current?.contains(t) && !anchor.contains(t) && !(t as Element).closest?.('.mmc-pick-list')) onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); anchor.focus?.() } }
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key, true)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', key, true) }
  }, [open, anchor, over]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || !at) return null
  return createPortal(
    <div ref={box} role="dialog" aria-label={label} className="mmc-pop" data-over={over ? '' : undefined}
      style={{ left: at.left, width: at.width, top: at.top ?? 'auto', bottom: at.bottom ?? 'auto', maxHeight: Math.max(160, at.maxH), height: at.height }}>
      {over && (
        <div className="mmc-pop-head">
          <p className="mmc-pop-title">{label}</p>
          <button type="button" className="mmc-pop-close" aria-label={`Close ${label}`} onClick={() => { onClose(); anchor?.focus?.() }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      )}
      <div className="mmc-pop-body">{children}</div>
    </div>,
    document.body,
  )
}

const Tick = () => (
  <span className="mmc-pop-tick" aria-hidden="true">
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
  </span>
)

/** A person, drawn small: head and shoulders, centred at (x, y) and `s` tall */
function Person({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g fill="rgba(255,255,255,0.78)">
      <circle cx={x} cy={y - s * 0.22} r={s * 0.2} />
      <path d={`M${x - s * 0.36} ${y + s * 0.42} Q${x - s * 0.36} ${y + s * 0.02} ${x} ${y + s * 0.02} Q${x + s * 0.36} ${y + s * 0.02} ${x + s * 0.36} ${y + s * 0.42} Z`} />
    </g>
  )
}

/** A layout's little picture, on a 36 × 64 screen */
function LayoutPicture({ id }: { id: ClipLayoutId }) {
  const pane = (y: number, h: number, x = 0, w = 36, k = 0) => (
    <rect key={`${x}-${y}`} x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} rx="2.5" fill={`rgba(255,255,255,${0.2 - k * 0.04})`} />
  )
  return (
    <svg viewBox="0 0 36 64" className="mmc-lay-pic" aria-hidden="true">
      {id === 'fill' && <>{pane(0, 64)}<Person x={18} y={36} s={30} /></>}
      {id === 'fit' && <>{pane(0, 64, 0, 36, 4)}{pane(22, 20)}<Person x={18} y={33} s={14} /></>}
      {id === 'split' && <>{pane(0, 32)}{pane(32, 32, 0, 36, 1)}<Person x={18} y={17} s={18} /><Person x={18} y={49} s={18} /></>}
      {id === 'three' && <>{pane(0, 32)}{pane(32, 32, 0, 18, 1)}{pane(32, 32, 18, 18, 2)}<Person x={18} y={17} s={18} /><Person x={9} y={50} s={12} /><Person x={27} y={50} s={12} /></>}
    </svg>
  )
}

/**
 * A layout shown on a frame of the user's own video (user, 2026-11-15: real pictures, as OpusClip's): Fill one
 * part of it, Fit the whole of it over a blurred copy, Split two parts, Three three. `ratio`: the frame's width / height.
 */
function LayoutPhoto({ id, src, ratio }: { id: ClipLayoutId; src: string; ratio: number }) {
  const T = 9 / 16 // the tile's shape
  /** A part of the frame `fx` across (0–1) in a pane `w` × `h` of the tile */
  const part = (key: string, x: number, y: number, w: number, h: number, fx: number) => {
    const k = ratio / (T * w / h) // how much wider the frame is than the pane, both at the pane's height
    const pos = k > 1 ? Math.min(1, Math.max(0, (fx * k - 0.5) / (k - 1))) : 0.5
    return <span key={key} className="mmc-lay-part" style={{
      left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`,
      backgroundImage: `url("${src}")`, backgroundSize: k > 1 ? 'auto 100%' : 'cover', backgroundPosition: `${pos * 100}% 50%`,
    }} />
  }
  if (id === 'fit') {
    const h = Math.min(1, T / ratio)
    return (
      <span className="mmc-lay-photo" aria-hidden="true">
        <span className="mmc-lay-part mmc-lay-blur" style={{ inset: 0, backgroundImage: `url("${src}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
        <span className="mmc-lay-part" style={{ left: 0, width: '100%', top: `${(1 - h) * 50}%`, height: `${h * 100}%`, backgroundImage: `url("${src}")`, backgroundSize: '100% 100%' }} />
      </span>
    )
  }
  return (
    <span className="mmc-lay-photo" aria-hidden="true">
      {id === 'fill' && part('a', 0, 0, 1, 1, 0.5)}
      {id === 'split' && <>{part('a', 0, 0, 1, 0.5, 0.3)}{part('b', 0, 0.5, 1, 0.5, 0.7)}</>}
      {id === 'three' && <>{part('a', 0, 0, 1, 0.5, 0.5)}{part('b', 0, 0.5, 0.5, 0.5, 0.2)}{part('c', 0.5, 0.5, 0.5, 0.5, 0.8)}</>}
    </span>
  )
}

/** The Layout box: the clips' shape, then the layouts AI can use (one at least), shown on a frame of the video when there is one */
export function LayoutChoices({ look, onChange, frameSrc = null, ratio = 16 / 9 }: {
  look: MakeLook; onChange: (next: MakeLook) => void; frameSrc?: string | null; ratio?: number
}) {
  const toggle = (id: ClipLayoutId) => {
    const on = look.layouts.includes(id)
    // (one stays on: AI needs a layout to use)
    if (on && look.layouts.length === 1) return
    onChange({ ...look, layouts: on ? look.layouts.filter(x => x !== id) : CLIP_LAYOUT_IDS.filter(x => x === id || look.layouts.includes(x)) })
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="mmc-pop-heading">Shape</p>
        <div className="mmc-shapes" role="radiogroup" aria-label="Shape of the clips">
          {CLIP_ASPECTS.map(a => {
            const on = look.aspect === a.id
            const big = 46, k = big / Math.max(a.w, a.h)
            return (
              <button key={a.id} type="button" role="radio" aria-checked={on} className="mmc-shape" data-on={on || undefined}
                onClick={() => onChange({ ...look, aspect: a.id })}>
                <span className="mmc-shape-box"><span style={{ width: a.w * k, height: a.h * k }}>{on && <Tick />}</span></span>
                <span className="mmc-shape-name">{a.id}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p className="mmc-pop-heading">Layouts AI can use</p>
        <div className="mmc-lays" role="group" aria-label="Layouts AI can use">
          {CLIP_LAYOUTS.map(l => {
            const on = look.layouts.includes(l.id)
            const last = on && look.layouts.length === 1
            return (
              <button key={l.id} type="button" aria-pressed={on} className="mmc-lay" data-on={on || undefined}
                title={last ? `${l.tip}. One layout stays on.` : l.tip} aria-disabled={last || undefined} onClick={() => toggle(l.id)}>
                <span className="mmc-lay-screen">{frameSrc ? <LayoutPhoto id={l.id} src={frameSrc} ratio={ratio} /> : <LayoutPicture id={l.id} />}{on && <Tick />}</span>
                <span className="mmc-lay-name">{l.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * The Frame box, as the editor's Frames gallery (user, 2026-11-15: "same as" it): grouped by how many videos or
 * photos a frame shows, None first, three across
 */
export function FrameChoices({ frame, onPick }: { frame: FrameLayout | null; onPick: (f: FrameLayout | null) => void }) {
  const counts = [...new Set(FRAME_LAYOUTS.map(frameSlotCount))].sort((a, b) => a - b)
  return (
    <div className="flex flex-col gap-3" role="radiogroup" aria-label="The frame the clips come in">
      {counts.map(n => (
        <section key={n} className="flex flex-col gap-1.5" aria-label={n === 1 ? '1 video' : `${n} videos or photos`}>
          <p className="mmc-pop-heading">{n === 1 ? '1 video' : `${n} videos or photos`}</p>
          <div className="mmc-frames">
            {n === 1 && (
              <button type="button" role="radio" aria-checked={!frame} className="mmc-frame" data-on={!frame || undefined}
                title="No frame: the clips stay plain" onClick={() => onPick(null)}>
                <span className="mmc-frame-pic mmc-frame-none">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M5.7 5.7l12.6 12.6" /></svg>
                </span>
                <span className="mmc-frame-name">None</span>
              </button>
            )}
            {FRAME_LAYOUTS.filter(f => frameSlotCount(f) === n).map(f => (
              <button key={f} type="button" role="radio" aria-checked={frame === f} className="mmc-frame" data-on={frame === f || undefined}
                title={FRAME_TEMPLATES[f].description} onClick={() => onPick(f)}>
                <span className="mmc-frame-pic"><FrameThumb layout={f} /></span>
                <span className="mmc-frame-name">{FRAME_TEMPLATES[f].name}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/**
 * The Captions box: captions on or off, then the caption styles (the editor's tiles). `kitName`: the brand kit
 * picked brings its captions (user, 2026-11-17) — they're on, in its style; only what they're written in is
 * chosen here
 */
export function CaptionChoices({ on, onToggle, style, onStyle, language, kitName = null }: {
  on: boolean; onToggle: () => void; style: Partial<CaptionStyle> | null; onStyle: (s: Partial<CaptionStyle> | null) => void
  /** What they're written in (a choice list) */
  language?: React.ReactNode
  kitName?: string | null
}) {
  const live = !!kitName || on
  return (
    <div className="flex flex-col gap-3">
      {kitName ? <KitStyleBar what="Captions" kitName={kitName} hint="Brand → Off to pick your own" /> : (
      <div className="flex items-center gap-2">
        <p className="mmc-pop-heading flex-1 min-w-0 truncate">Captions on each clip</p>
        <button type="button" role="switch" aria-checked={on} aria-label="Captions on the clips" className="mmc-switch" data-on={on || undefined} onClick={onToggle}>
          <span />
        </button>
      </div>
      )}
      <div className="mmc-pop-styles flex flex-col gap-4" data-off={!live || undefined} inert={!live || undefined}>
        {language && <div className="flex flex-col gap-2"><p className="mmc-pop-heading">Written in</p>{language}</div>}
        <div className={`flex flex-col gap-2${kitName ? ' kit-held' : ''}`} inert={!!kitName || undefined}>
        <p className="mmc-pop-heading">Style</p>
        <CaptionStyler section="style" style={style ?? {}} textCase="title"
          onChange={u => onStyle(captionStyleToSend({ ...(style ?? {}), ...u }))}
          onTextCaseChange={() => {}} onEditCaptions={() => {}} onRetranscribe={() => {}} retranscribing={false} />
        </div>
      </div>
    </div>
  )
}

/**
 * The Title box: the title on or off, its style (the Text tool's looks) and its font (user, 2026-11-15).
 * `kitName`: the brand kit picked brings its title style (user, 2026-11-17) — on, in its look; only what it's
 * written in is chosen here
 */
export function TitleChoices({ on, onToggle, styleId, font, onStyle, onFont, language, kitName = null }: {
  on: boolean; onToggle: () => void; styleId: string | null; font: string | null
  onStyle: (id: string | null) => void; onFont: (family: string | null) => void
  /** What it's written in (a choice list) */
  language?: React.ReactNode
  kitName?: string | null
}) {
  const live = !!kitName || on
  const face = font ? { fontFamily: `"${font}", sans-serif` } : {}
  const tile = (id: string | null, name: string, look: React.CSSProperties) => {
    const picked = styleId === id
    return (
      <button key={id ?? 'usual'} type="button" role="radio" aria-checked={picked} className="mmc-title" data-on={picked || undefined} onClick={() => onStyle(id)}>
        <span className="mmc-title-screen">
          <span className="mmc-title-text" style={{ ...look, ...face, fontSize: 15 }}>Your title</span>
          {picked && <Tick />}
        </span>
        <span className="mmc-title-name">{name}</span>
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {kitName ? <KitStyleBar what="Title" kitName={kitName} hint="Brand → Off to pick your own" /> : (
      <div className="flex items-center gap-2">
        <p className="mmc-pop-heading flex-1 min-w-0 truncate">Title on each clip</p>
        <button type="button" role="switch" aria-checked={on} aria-label="A title on the clips" className="mmc-switch" data-on={on || undefined} onClick={onToggle}>
          <span />
        </button>
      </div>
      )}
      <div className="mmc-pop-styles flex flex-col gap-4" data-off={!live || undefined} inert={!live || undefined}>
        {language && <div className="flex flex-col gap-2 relative z-20"><p className="mmc-pop-heading">Written in</p>{language}</div>}
        {/* (the font first: its list opens down over the styles; both the kit's while one is picked) */}
        <div className={`flex flex-col gap-4${kitName ? ' kit-held' : ''}`} inert={!!kitName || undefined}>
        <div className="flex flex-col gap-2 relative z-10">
          <p className="mmc-pop-heading">Font</p>
          <FontPicker value={font} onChange={family => onFont(family === 'sans-serif' ? null : family)} />
        </div>
        <div className="flex flex-col gap-2">
          <p className="mmc-pop-heading">Style</p>
          <div className="mmc-titles" role="radiogroup" aria-label="Title style">
            {tile(null, 'Usual', { fontWeight: 800, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.7)' })}
            {TEXT_PRESETS.map(t => tile(t.id, t.name, textCss({ ...t.style, size: 72 })))}
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}
