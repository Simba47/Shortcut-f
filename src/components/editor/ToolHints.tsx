'use client'

/**
 * The timeline bar's hover help (user, 2026-11-19): hovering a tool shows a small popup above it with a
 * short drawn loop of what the tool does (like the transition tiles; drawn in code, not video files),
 * its name and its shortcut. A greyed-out tool shows the same, plus why it's off.
 *
 * Buttons opt in with data-hint="<id>" (see HINTS). Optional:
 *   data-hint-name  a different name for now (e.g. "Pause" while playing)
 *   data-hint-why   why it's off right now (shown under the name)
 *   data-hint-note  a quiet extra line (e.g. "On now — click to flip it back")
 *
 * Behaviour: shows after a short wait (0.4 s); once one is open, the next tool's shows at once. Hides on
 * click, drag, any key, scroll, or leaving the bar; never over a tool whose own box is open
 * (a dialog or menu inside the bar). Keyboard focus (Tab) shows it too. Disabled tools still get it: they let the pointer
 * through to the bar (.ed-transport [data-hint]:disabled in toolHints.css), and the bar finds the tool
 * under the pointer. Styles + the loops: toolHints.css.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './toolHints.css'

export type HintId =
  | 'fold' | 'unfold' | 'split' | 'duplicate' | 'mirror' | 'rotate' | 'freeze' | 'delete'
  | 'group' | 'ungroup' | 'detach' | 'undo' | 'redo' | 'prev' | 'play' | 'next' | 'reset'
  | 'zoomout' | 'fit' | 'zoomin'

type Hint = { name: string; keys?: (mod: string) => string[]; note?: string }

const ZOOM_NOTE = 'Or pinch the trackpad · Ctrl + scroll'

const HINTS: Record<HintId, Hint> = {
  fold:      { name: 'Hide timeline' },
  unfold:    { name: 'Show timeline' },
  split:     { name: 'Split', keys: () => ['S'] },
  duplicate: { name: 'Duplicate', keys: m => [m, 'D'] },
  mirror:    { name: 'Mirror' },
  rotate:    { name: 'Rotate 90°' },
  freeze:    { name: 'Freeze' },
  delete:    { name: 'Delete', keys: () => ['Delete'] },
  group:     { name: 'Group', keys: m => [m, 'G'] },
  ungroup:   { name: 'Ungroup', keys: m => [m, 'Shift', 'G'] },
  detach:    { name: 'Detach audio' },
  undo:      { name: 'Undo', keys: m => [m, 'Z'] },
  redo:      { name: 'Redo', keys: m => [m, 'Shift', 'Z'] },
  prev:      { name: 'Previous section' },
  play:      { name: 'Play', keys: () => ['Space'] },
  next:      { name: 'Next section' },
  reset:     { name: 'Reset all edits' },
  zoomout:   { name: 'Zoom out', note: ZOOM_NOTE },
  fit:       { name: 'Whole clip (1x)' },
  zoomin:    { name: 'Zoom in', note: ZOOM_NOTE },
}

const SHOW_AFTER_MS = 400
/** The plain label (after the first export) is quicker: it's only a name */
const SHOW_PLAIN_AFTER_MS = 250
/** After a popup closes, the next tool's opens at once for this long (moving along the bar) */
const WARM_MS = 500
const POP_W = 232
const GAP = 10

type Shown = { id: HintId; name: string; why?: string; note?: string; x: number; top: number; above: boolean; ax: number }

/**
 * loops: the little loop of what each tool does (until the account's first finished export, or as the Guide
 * page's switch says: server/services/toolGuides.ts); false: a plain label, the name and shortcut only
 */
export function ToolHints({ barRef, loops = true }: { barRef: React.RefObject<HTMLElement | null>; loops?: boolean }) {
  const [shown, setShown] = useState<Shown | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const mod = useRef('Ctrl')

  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    mod.current = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
    // inside the editor's root, so the editor's theme (light / dark) reaches it
    setHost((bar.closest('.editor-theme') as HTMLElement | null) ?? document.body)

    let timer = 0
    let cur: HTMLElement | null = null      // the tool under the pointer (or focused)
    let open: HTMLElement | null = null     // the tool whose popup is up
    let blocked: HTMLElement | null = null  // clicked: no popup on it until the pointer leaves it
    let warmUntil = 0

    const at = (x: number, y: number, target: EventTarget | null) => {
      const direct = (target as HTMLElement | null)?.closest?.('[data-hint]') as HTMLElement | null
      if (direct && bar.contains(direct)) return direct
      for (const el of bar.querySelectorAll<HTMLElement>('[data-hint]')) {
        const r = el.getBoundingClientRect()
        if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el
      }
      return null
    }
    const show = (el: HTMLElement) => {
      clearTimeout(timer)
      const id = el.dataset.hint as HintId
      const h = HINTS[id]
      if (!h || !el.isConnected) return
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      // the loop card is POP_W wide; the plain label is centred on the tool (CSS: translate -50%)
      const x = loops ? Math.min(Math.max(cx - POP_W / 2, 8), window.innerWidth - POP_W - 8)
        : Math.min(Math.max(cx, 120), window.innerWidth - 120)
      const above = r.top > (loops ? 200 : 80)
      if (open && open !== el) open.removeAttribute('aria-describedby')
      open = el
      el.setAttribute('aria-describedby', 'ed-tool-hint')
      setShown({
        id, name: el.dataset.hintName || h.name, why: el.dataset.hintWhy || undefined,
        note: el.dataset.hintNote || h.note, x, above,
        top: above ? window.innerHeight - r.top + GAP : r.bottom + GAP,
        ax: loops ? Math.min(Math.max(cx - x, 14), POP_W - 14) : cx - x,
      })
    }
    const hide = (warm: boolean) => {
      clearTimeout(timer)
      if (open) {
        open.removeAttribute('aria-describedby')
        if (warm) warmUntil = performance.now() + WARM_MS
      }
      open = null
      setShown(null)
    }
    const want = (el: HTMLElement | null) => {
      if (el === cur) return
      cur = el
      clearTimeout(timer)
      if (!el) { hide(true); return }
      if (open || performance.now() < warmUntil) show(el)
      else timer = window.setTimeout(() => { if (cur === el) show(el) }, loops ? SHOW_AFTER_MS : SHOW_PLAIN_AFTER_MS)
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      if (e.buttons) { cur = null; hide(false); return }   // dragging
      // a tool's own box is open (e.g. "Reset all edits?"): no popups over it
      if (bar.querySelector('[role="alertdialog"], [role="dialog"], [role="menu"]')) { cur = null; hide(false); return }
      const el = at(e.clientX, e.clientY, e.target)
      if (blocked) { if (el === blocked) return; blocked = null }
      want(el)
    }
    const onLeave = () => { cur = null; blocked = null; hide(true) }
    const onDown = () => { blocked = cur; cur = null; hide(false) }
    const onFocusIn = (e: FocusEvent) => {
      const el = (e.target as HTMLElement).closest?.('[data-hint]') as HTMLElement | null
      if (el && bar.contains(el) && el.matches(':focus-visible')) { cur = el; show(el) }
    }
    const onFocusOut = () => { if (open && !open.matches(':hover')) { cur = null; hide(false) } }
    const onAway = () => { cur = null; hide(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key !== 'Tab' && e.key !== 'Shift') onAway() }

    bar.addEventListener('pointermove', onMove)
    bar.addEventListener('pointerleave', onLeave)
    bar.addEventListener('pointerdown', onDown, true)
    bar.addEventListener('focusin', onFocusIn)
    bar.addEventListener('focusout', onFocusOut)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onAway)
    window.addEventListener('scroll', onAway, true)
    window.addEventListener('blur', onAway)
    return () => {
      clearTimeout(timer)
      open?.removeAttribute('aria-describedby')
      bar.removeEventListener('pointermove', onMove)
      bar.removeEventListener('pointerleave', onLeave)
      bar.removeEventListener('pointerdown', onDown, true)
      bar.removeEventListener('focusin', onFocusIn)
      bar.removeEventListener('focusout', onFocusOut)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onAway)
      window.removeEventListener('scroll', onAway, true)
      window.removeEventListener('blur', onAway)
    }
  }, [barRef, loops])

  if (!shown || !host) return null
  const keys = HINTS[shown.id].keys?.(mod.current)
  return createPortal(
    <div id="ed-tool-hint" role="tooltip" className="th-pop" data-below={!shown.above || undefined} data-plain={!loops || undefined}
      style={{ left: shown.x, ...(shown.above ? { bottom: shown.top } : { top: shown.top }), ['--ax' as string]: loops ? `${shown.ax}px` : `calc(50% + ${shown.ax}px)` }}>
      {loops && <HintStage key={shown.id} id={shown.id} />}
      <div className="th-foot">
        <span className="th-name">{shown.name}</span>
        {keys && <span className="th-keys">{keys.map(k => <kbd key={k}>{k}</kbd>)}</span>}
      </div>
      {shown.why && <p className="th-why">{shown.why}</p>}
      {!shown.why && shown.note && <p className="th-note">{shown.note}</p>}
    </div>,
    host,
  )
}

// ── The loops ────────────────────────────────────────────────────────────────────────────────────
// A tiny timeline (ruler, bars, playhead) or a tiny screen, and the tool's own button at the bottom,
// which lights up the moment it's "pressed" (--at: when in the loop, 0–1). Coordinates are px on a
// 216 × 120 stage. Every element's keyframes are in toolHints.css (th-<scene>-<part>).

type Px = { x: number; w: number; y?: number; h?: number }
const pos = ({ x, w, y, h }: Px): React.CSSProperties => ({ left: x, width: w, ...(y != null && { top: y }), ...(h != null && { height: h }) })

function Bar({ k = 'main', cls, sel, children, ...p }: Px & { k?: 'main' | 'music' | 'video' | 'text'; cls?: string; sel?: string; children?: React.ReactNode }) {
  return (
    <div className={`th-bar ${cls ?? ''}`} data-k={k} style={pos(p)}>
      {k === 'music' && <Wave />}
      {children}
      {sel && <i className={`th-sel ${sel}`} />}
    </div>
  )
}

const WAVE = Array.from({ length: 48 }, (_, i) => 1.5 + Math.abs(Math.sin(i * 1.7) * 3.2) + ((i * 7) % 3) * 0.6)
function Wave({ cls }: { cls?: string }) {
  return (
    <svg className={`th-wave ${cls ?? ''}`} viewBox="0 0 96 10" preserveAspectRatio="none" aria-hidden="true">
      {WAVE.map((h, i) => <rect key={i} x={i * 2} y={5 - h / 2} width="1.2" height={h} rx=".5" />)}
    </svg>
  )
}

/** A little video picture: sky, sun at the right, a person at the left (so a mirror shows), the ground */
function Pic({ ball }: { ball?: string }) {
  return (
    <>
      <i className="th-pic-sun" />
      <i className="th-pic-ground" />
      <i className="th-pic-head" />
      <i className="th-pic-body" />
      {ball && <i className={`th-pic-ball ${ball}`} />}
    </>
  )
}

const ICON: Record<HintId, React.ReactNode> = {
  fold: <path d="M6.5 9.5L12 15l5.5-5.5" strokeWidth="2.4" />,
  unfold: <path d="M6.5 14.5L12 9l5.5 5.5" strokeWidth="2.4" />,
  split: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" /></>,
  duplicate: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" /></>,
  mirror: <><path d="M12 3v18" strokeDasharray="2 2.5" /><path d="M9 7L3 17h6V7z" /><path d="M15 7l6 10h-6V7z" /></>,
  rotate: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  freeze: <path d="M12 2v20M4 6.5l16 11M20 6.5l-16 11M12 6L9.5 3.5M12 6l2.5-2.5M12 18l-2.5 2.5M12 18l2.5 2.5" />,
  delete: <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />,
  group: <><path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7" /></>,
  ungroup: <><path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7" /><path d="M4 4l16 16" /></>,
  detach: <><path d="M9 17V5l10-2v6" /><circle cx="6.5" cy="17" r="2.5" /><path d="M15 14v7M12 18l3 3 3-3" stroke="#c084fc" /></>,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 010 11H11" /></>,
  redo: <><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 000 11H13" /></>,
  prev: <><rect x="5" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none" /><path d="M19 5.8v12.4a.8.8 0 01-1.2.7L9.5 12.7a.8.8 0 010-1.4l8.3-6.2a.8.8 0 011.2.7z" fill="currentColor" stroke="none" /></>,
  play: <path d="M7 4.5l12 7.5-12 7.5V4.5z" fill="currentColor" stroke="none" />,
  next: <><rect x="16.6" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none" /><path d="M5 5.8v12.4a.8.8 0 001.2.7l8.3-6.2a.8.8 0 000-1.4L6.2 5.1A.8.8 0 005 5.8z" fill="currentColor" stroke="none" /></>,
  reset: <><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>,
  zoomout: <><circle cx="11" cy="11" r="7" /><path d="M8 11h6M20 20l-4-4" /></>,
  fit: <text x="12" y="16.5" textAnchor="middle" fontSize="13.5" fontWeight="700" fill="currentColor" stroke="none">1x</text>,
  zoomin: <><circle cx="11" cy="11" r="7" /><path d="M8 11h6M11 8v6M20 20l-4-4" /></>,
}

function Btn({ id }: { id: HintId }) {
  return (
    <span className="th-btn" aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICON[id]}</svg>
    </span>
  )
}

/** A small round sign of what just happened (on the picture or the timeline) */
function Mini({ id, cls, x, y }: { id: HintId; cls: string; x: number; y: number }) {
  return (
    <span className={`th-mini ${cls}`} style={{ left: x, top: y }} aria-hidden="true">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">{ICON[id]}</svg>
    </span>
  )
}

/** When in the loop each scene's button is pressed (0–1), and the loop's length */
const TIMING: Partial<Record<HintId, { at?: number; d?: number }>> = {
  fold: { at: 0.36 }, unfold: { at: 0.44 }, split: { at: 0.44 }, duplicate: { at: 0.44 }, mirror: { at: 0.4 },
  rotate: { at: 0.4 }, freeze: { at: 0.2, d: 3.8 }, delete: { at: 0.44 }, group: { at: 0.42 }, ungroup: { at: 0.3 },
  detach: { at: 0.36 }, undo: { at: 0.56, d: 3.4 }, redo: { at: 0.66, d: 4.2 }, play: { at: 0.2 }, reset: { at: 0.44 },
  zoomout: { at: 0.36 }, fit: { at: 0.36 }, zoomin: { at: 0.36 },
}

export function HintStage({ id }: { id: HintId }) {
  const t = TIMING[id] ?? {}
  const style = { '--at': t.at ?? 0.5, ...(t.d && { '--th-d': `${t.d}s` }) } as React.CSSProperties
  return (
    <div className="th-stage" data-scene={id} data-two={id === 'prev' || id === 'next' || undefined} style={style} aria-hidden="true">
      <div className="th-loop">{scene(id)}</div>
      <Btn id={id} />
    </div>
  )
}

const ROW2 = { y: 58, h: 18 }

function scene(id: HintId): React.ReactNode {
  switch (id) {
    case 'split':
      return (<>
        <i className="th-ruler" />
        <Bar x={16} w={92} cls="th-split-a" />
        <Bar x={108} w={92} cls="th-split-b" sel="th-split-sel" />
        <i className="th-ph th-split-ph" style={{ left: 30 }} />
      </>)
    case 'duplicate':
      return (<>
        <i className="th-ruler" />
        <Bar x={16} w={72} sel="th-dup-sela" />
        <Bar x={92} w={44} cls="th-dup-c" />
        <Bar x={92} w={72} cls="th-dup-copy" sel="th-dup-selc" />
      </>)
    case 'delete':
      return (<>
        <i className="th-ruler" />
        <Bar x={16} w={60} />
        <Bar x={80} w={56} cls="th-del-b" sel="th-del-sel" />
        <Bar x={140} w={60} cls="th-del-c" />
      </>)
    case 'undo':
      return (<>
        <i className="th-ruler" />
        <Bar x={16} w={60} />
        <Bar x={80} w={56} cls="th-undo-b" sel="th-undo-sel" />
        <Bar x={140} w={60} cls="th-undo-c" />
        <Mini id="delete" cls="th-undo-trash" x={97} y={57} />
      </>)
    case 'redo':
      return (<>
        <i className="th-ruler" />
        <Bar x={16} w={60} />
        <Bar x={80} w={56} cls="th-redo-b" sel="th-redo-sel" />
        <Bar x={140} w={60} cls="th-redo-c" />
        <Mini id="delete" cls="th-redo-trash" x={97} y={57} />
        <Mini id="undo" cls="th-redo-undo" x={97} y={57} />
      </>)
    case 'prev':
    case 'next':
      return (<>
        <i className="th-ruler" />
        <Bar x={16} w={60} />
        <Bar x={78} w={60} sel={id === 'next' ? 'th-sec-sel1' : 'th-sec-sel2'} />
        <Bar x={140} w={60} sel={id === 'next' ? 'th-sec-sel2' : 'th-sec-sel1'} />
        <i className={`th-ph th-${id}-ph`} style={{ left: id === 'next' ? 34 : 184 }} />
      </>)
    case 'group':
      return (<>
        <i className="th-ruler" />
        <div className="th-move th-grp-move">
          <Bar k="video" x={24} w={64} sel="th-grp-sela" />
          <Bar k="music" x={44} w={84} {...ROW2} sel="th-grp-selb" />
          <Mini id="group" cls="th-grp-link" x={55} y={44} />
        </div>
      </>)
    case 'ungroup':
      return (<>
        <i className="th-ruler" />
        <Bar k="video" x={24} w={64} cls="th-ugr-a" sel="th-ugr-sela" />
        <Bar k="music" x={44} w={84} {...ROW2} sel="th-ugr-selb" />
        <Mini id="group" cls="th-ugr-link" x={55} y={44} />
      </>)
    case 'detach':
      return (<>
        <i className="th-ruler" />
        <Bar x={16} w={184}>
          <Wave cls="th-det-inwave" />
          <Mini id="detach" cls="th-det-mute" x={156} y={1} />
        </Bar>
        <Bar k="music" x={16} w={184} {...ROW2} cls="th-det-music" sel="th-det-sel" />
      </>)
    case 'reset':
      return (<>
        <i className="th-ruler" />
        <Bar x={16} w={40} cls="th-rs-p1" />
        <Bar x={60} w={30} cls="th-rs-p2" />
        <Bar x={94} w={56} cls="th-rs-p3" />
        <Bar k="music" x={30} w={90} {...ROW2} cls="th-rs-x" />
        <Bar k="text" x={128} w={56} {...ROW2} cls="th-rs-x" />
        <Bar x={16} w={184} cls="th-rs-full" />
      </>)
    case 'zoomin':
    case 'zoomout':
    case 'fit':
      return (<>
        <div className={`th-zoom th-${id}-z`}>
          <i className="th-ruler" />
          <Bar x={16} w={60} />
          <Bar x={80} w={56} />
          <Bar x={140} w={60} />
          <Bar k="music" x={30} w={150} {...ROW2} />
        </div>
        <i className="th-ph" style={{ left: 108 }} />
        {id === 'fit' && <><i className="th-fit-edge" style={{ left: 12 }} /><i className="th-fit-edge" data-r style={{ left: 200 }} /></>}
      </>)
    case 'mirror':
      return (<>
        <div className="th-screen" style={{ left: 62, top: 8, width: 92, height: 56 }}>
          <div className="th-pic th-mir-pic"><Pic /></div>
        </div>
        <i className="th-axis" style={{ left: 107.5, top: 4, height: 64 }} />
      </>)
    case 'rotate':
      return (
        <div className="th-screen th-rot" style={{ left: 70, top: 22, width: 76, height: 43 }}>
          <div className="th-pic"><Pic /></div>
        </div>
      )
    case 'freeze':
    case 'play':
      return (<>
        <div className="th-screen" style={{ left: 62, top: 6, width: 92, height: 52 }}>
          <div className="th-pic"><Pic ball={`th-${id}-ball`} /></div>
          {id === 'freeze' && <i className="th-frz-tint" />}
          {id === 'freeze' && <Mini id="freeze" cls="th-frz-badge" x={66} y={3} />}
        </div>
        <Bar x={16} w={184} y={66} h={12} />
        {id === 'freeze' && <i className="th-frz" style={{ left: 88, width: 44 }} />}
        <i className={`th-ph th-ph-short th-${id}-ph`} style={{ left: 16 }} />
      </>)
    case 'fold':
    case 'unfold':
      return (<div className="th-ui" data-rev={id === 'unfold' || undefined}>
        <div className="th-screen th-ui-video"><div className="th-pic"><Pic /></div></div>
        <div className="th-ui-tl">
          <i style={{ left: 6, width: 60 }} /><i style={{ left: 70, width: 50 }} /><i style={{ left: 124, width: 66 }} />
        </div>
      </div>)
  }
}
