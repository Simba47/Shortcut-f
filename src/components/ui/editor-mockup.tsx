'use client'

import { useEffect, useRef } from 'react'

// Illustrated, animated replica of the Shortcut editing board for the landing page (styles: .mk-*
// in app/landing.css), laid out like the real editor today: header · tool rail · Captions panel ·
// layout dock · canvas · control bar · scene timeline · preview.
//
// One 11-second story, told by a single clock (Web Animations, so it runs smoothly off the main
// thread and pauses when off screen):
//   1. Play is pressed, the playhead starts moving
//   2. Steer: a cursor grabs the 9:16 crop box and glides it from speaker 1 to speaker 2;
//      the phone preview follows exactly
//   3. Layout: Vertical → Split (the preview shows both speakers stacked) → back to Vertical
//   4. Captions write on word by word (Telugu, Hindi, English); only the spoken word is lime
//   5. "Saved" ticks, Export gives a soft pulse, and it loops
// Reduced motion: one still frame.

const T = 11000                                   // the loop, ms
// Crop box (a 9:16 window inside the 16:9 frame is 31.64% wide) over each speaker
const CROP_W = 31.64
const AT_A = 14.2                                 // left edge, % of the frame (speaker 1 centred at 30%)
const AT_B = 54.2                                 // speaker 2 centred at 70%
const SLIDE = ((AT_B - AT_A) / CROP_W) * 100      // the same move as a % of the box's own width

const CAPTIONS = [
  { words: ['ఇది', 'మీ', 'కథ'], from: 0.12, to: 0.36, split: false },
  { words: ['यह', 'आपकी', 'कहानी'], from: 0.47, to: 0.61, split: true },
  { words: ['this', 'is', 'your', 'story'], from: 0.68, to: 0.9, split: false },
]

function Scene() {
  return (
    <svg className="mk-scene" viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden>
      <defs>
        <radialGradient id="mk-warm" cx="0.3" cy="0.15" r="0.7">
          <stop offset="0" stopColor="#f2a65a" stopOpacity="0.5" />
          <stop offset="1" stopColor="#f2a65a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="mk-cool" cx="0.85" cy="0.25" r="0.6">
          <stop offset="0" stopColor="#5ab6f2" stopOpacity="0.3" />
          <stop offset="1" stopColor="#5ab6f2" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="mk-skin-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e3a57f" /><stop offset="1" stopColor="#a5664a" /></linearGradient>
        <linearGradient id="mk-skin-b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c98a62" /><stop offset="1" stopColor="#7d4a33" /></linearGradient>
      </defs>
      <rect width="160" height="90" fill="#141a1f" />
      <rect width="160" height="90" fill="url(#mk-warm)" />
      <rect width="160" height="90" fill="url(#mk-cool)" />
      {/* studio wall: shelves and soft lights */}
      <g opacity="0.55">
        <rect x="6" y="14" width="30" height="1.6" rx=".8" fill="#2a2620" />
        <rect x="124" y="18" width="30" height="1.6" rx=".8" fill="#20262a" />
        <rect x="9" y="7" width="4" height="7" rx="1" fill="#6b4f35" /><rect x="15" y="9" width="3" height="5" rx="1" fill="#3d5a4a" /><rect x="20" y="8" width="5" height="6" rx="1" fill="#7a3a2e" />
        <rect x="128" y="11" width="4" height="7" rx="1" fill="#2f4a63" /><rect x="134" y="13" width="6" height="5" rx="1" fill="#5a4a2e" />
        <circle cx="78" cy="10" r="6" fill="#f5c07a" opacity="0.25" /><circle cx="96" cy="6" r="3" fill="#fff" opacity="0.15" />
        <circle cx="60" cy="7" r="2.5" fill="#f5c07a" opacity="0.3" /><circle cx="146" cy="8" r="3.5" fill="#9fd4ff" opacity="0.25" />
      </g>
      {/* speaker 1 (left) */}
      <path d="M26 90c2-19 11-29 22-29s20 10 22 29z" fill="#2b3a46" />
      <path d="M41 63c2 3 4.5 4 7 4s5-1 7-4l1 6H40z" fill="#8a523a" />
      <ellipse cx="48" cy="44" rx="9.5" ry="11.5" fill="url(#mk-skin-a)" />
      <path d="M37.5 43c-1.5-11 4.5-17 11-17 7.5 0 12.5 6 11.5 15-2-4.5-5-7.5-9-7.5-5 0-9 2.5-13.5 9.5z" fill="#1a1412" />
      <path d="M43.5 46.5c1.4.9 2.8.9 4.2 0M50 46.5c1.4.9 2.8.9 4.2 0" stroke="#3a2419" strokeWidth="0.9" strokeLinecap="round" fill="none" />
      <path d="M45.5 52.5c2 1.2 4.3 1.2 6.3 0" stroke="#5a2f22" strokeWidth="0.9" strokeLinecap="round" fill="none" />
      {/* speaker 2 (right) */}
      <path d="M90 90c2-19 11-29 22-29s20 10 22 29z" fill="#463328" />
      <path d="M105 63c2 3 4.5 4 7 4s5-1 7-4l1 6h-16z" fill="#6e3f2b" />
      <ellipse cx="112" cy="45" rx="9.5" ry="11.5" fill="url(#mk-skin-b)" />
      <path d="M101.5 44c-.5-10 4.5-16 10.5-16 7 0 12 5 11.5 14-1.5-3-4-6-7.5-6.5-4.5-.5-9.5 3-14.5 8.5z" fill="#0f0f12" />
      <circle cx="108" cy="46.8" r="2.6" fill="none" stroke="#111" strokeWidth=".7" /><circle cx="115.5" cy="46.8" r="2.6" fill="none" stroke="#111" strokeWidth=".7" />
      <path d="M110.6 46.8h2.3" stroke="#111" strokeWidth=".7" />
      <path d="M109 53c2 1.3 4.3 1.3 6.3 0" stroke="#4a2519" strokeWidth="0.9" strokeLinecap="round" fill="none" />
      {/* desk and two mics */}
      <rect x="0" y="80" width="160" height="10" fill="#0c0f12" />
      <g fill="#1d1f22">
        <rect x="60" y="62" width="4" height="9" rx="2" /><rect x="61.4" y="70" width="1.2" height="10" /><rect x="57" y="79" width="10" height="1.6" rx=".8" />
        <rect x="96" y="62" width="4" height="9" rx="2" /><rect x="97.4" y="70" width="1.2" height="10" /><rect x="93" y="79" width="10" height="1.6" rx=".8" />
      </g>
    </svg>
  )
}

const I = ({ d }: { d: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
)

// The rail as it is today
const TOOLS: { label: string; on?: boolean; icon: React.ReactNode }[] = [
  { label: 'Frames', icon: <><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M6 12h12" /></> },
  { label: 'Subjects', icon: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6" /><circle cx="17" cy="9" r="2.4" /><path d="M16 14c3 0 5 2.2 5 5.5" /></> },
  { label: 'Captions', on: true, icon: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10.5 10.2a2.3 2.3 0 100 3.6M16.5 10.2a2.3 2.3 0 100 3.6" /></> },
  { label: 'Transitions', icon: <><rect x="3" y="5" width="8" height="14" rx="2" /><path d="M15 5h2M15 19h2M19 5a2 2 0 012 2M21 17a2 2 0 01-2 2M21 10v4" /></> },
  { label: 'Text', icon: <path d="M5 5h14M12 5v15" /> },
  { label: 'Media', icon: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></> },
  { label: 'Music', icon: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></> },
  { label: 'Cleanup', icon: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.1 15.9M14.5 14.5L20 20" /></> },
  { label: 'Post', icon: <path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16" /> },
]

const LayoutGlyph = ({ rows }: { rows: number }) => (
  <svg className="mk-glyph" viewBox="0 0 12 18" aria-hidden>
    <rect x="0.75" y="0.75" width="10.5" height="16.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    {rows === 1 && <rect x="2.5" y="2.5" width="7" height="13" rx="1" fill="currentColor" opacity=".55" />}
    {rows === 2 && <><rect x="2.5" y="2.5" width="7" height="5.6" rx="1" fill="currentColor" opacity=".55" /><rect x="2.5" y="9.9" width="7" height="5.6" rx="1" fill="currentColor" opacity=".55" /></>}
    {rows === 3 && <><rect x="2.5" y="2.5" width="7" height="3.7" rx=".8" fill="currentColor" opacity=".55" /><rect x="2.5" y="7.15" width="7" height="3.7" rx=".8" fill="currentColor" opacity=".55" /><rect x="2.5" y="11.8" width="7" height="3.7" rx=".8" fill="currentColor" opacity=".55" /></>}
    {rows === 0 && <rect x="2.5" y="6.5" width="7" height="5" rx="1" fill="currentColor" opacity=".55" />}
  </svg>
)

// Scenes on the timeline: layout, length (s) and a tint for the thumbnails
const SCENES = [
  { label: 'Vertical', len: 4.0, hue: 24 }, { len: 3.0, hue: 200 }, { label: 'Split', len: 6.5, hue: 30 },
  { len: 3.4, hue: 190 }, { label: 'Vertical', len: 5.2, hue: 18 }, { len: 2.6, hue: 210 },
]

type Frame = [number, Keyframe]
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

export function EditorMockup() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !el.animate) return
    const q = <E extends HTMLElement = HTMLElement>(s: string) => el.querySelector<E>(s)
    const anims: Animation[] = []
    const play = (node: Element | null, frames: Frame[], ease = 'ease-in-out') => {
      if (!node) return
      anims.push(node.animate(frames.map(([offset, k]) => ({ offset, easing: ease, ...k })), { duration: T, iterations: Infinity, fill: 'both' }))
    }

    const main = q('.mk-main'), crop = q('.mk-crop'), cursor = q('.mk-cursor')
    const dockV = q('[data-dock="vertical"]'), dockS = q('[data-dock="split"]')
    // where the cursor goes (px inside the canvas column; the board may be zoomed, so undo that)
    const at = (n: HTMLElement | null, fx = 0.5, fy = 0.5) => {
      if (!n || !main) return { x: 0, y: 0 }
      const m = main.getBoundingClientRect(), r = n.getBoundingClientRect(), z = m.width / main.offsetWidth || 1
      return { x: (r.left - m.left + r.width * fx) / z, y: (r.top - m.top + r.height * fy) / z }
    }
    const canvas = q('.mk-canvas')
    const cv = canvas && main ? at(canvas, 0, 0) : { x: 0, y: 0 }
    const cw = canvas?.offsetWidth ?? 0, ch = canvas?.offsetHeight ?? 0
    const grabA = { x: cv.x + cw * ((AT_A + CROP_W / 2) / 100), y: cv.y + ch * 0.55 }
    const grabB = { x: cv.x + cw * ((AT_B + CROP_W / 2) / 100), y: cv.y + ch * 0.55 }
    const pS = at(dockS, 0.5, 0.62), pV = at(dockV, 0.5, 0.62)
    const away = { x: (main?.offsetWidth ?? 0) + 30, y: ch + 60 }
    const cur = (p: { x: number; y: number }, s = 1, o = 1): Keyframe => ({ transform: `translate(${p.x}px, ${p.y}px) scale(${s})`, opacity: o })

    // 1 · play: pressed, then shows pause while it plays
    play(q('.mk-play'), [[0, { transform: 'scale(1)' }], [0.04, { transform: 'scale(1)' }], [0.05, { transform: 'scale(.86)' }], [0.065, { transform: 'scale(1)' }], [1, { transform: 'scale(1)' }]])
    play(q('.mk-play-pause'), [[0, { opacity: 0 }], [0.055, { opacity: 0 }], [0.065, { opacity: 1 }], [0.95, { opacity: 1 }], [0.97, { opacity: 0 }], [1, { opacity: 0 }]])
    play(q('.mk-play-icon'), [[0, { opacity: 1 }], [0.055, { opacity: 1 }], [0.065, { opacity: 0 }], [0.95, { opacity: 0 }], [0.97, { opacity: 1 }], [1, { opacity: 1 }]])
    // the playhead runs while it plays, then fades and goes back to the start
    play(q('.mk-ph-run'), [[0, { transform: 'translateX(0%)', opacity: 1 }], [0.06, { transform: 'translateX(0%)', opacity: 1 }], [0.95, { transform: 'translateX(100%)', opacity: 1 }], [0.97, { transform: 'translateX(100%)', opacity: 0 }], [0.985, { transform: 'translateX(0%)', opacity: 0 }], [1, { transform: 'translateX(0%)', opacity: 1 }]], 'linear')

    // 2 · steer: the cursor comes in, grabs the box, drags it to speaker 2, lets go
    play(cursor, [
      [0, cur(away, 1, 0)], [0.07, cur(away, 1, 0)], [0.1, cur(grabA)], [0.13, cur(grabA)], [0.145, cur(grabA, 0.82)],
      [0.33, cur(grabB, 0.82)], [0.35, cur(grabB)],
      // 3 · layout: click Split, then Vertical
      [0.41, cur(pS)], [0.435, cur(pS)], [0.445, cur(pS, 0.82)], [0.46, cur(pS)],
      [0.58, cur(pS)], [0.61, cur(pV)], [0.625, cur(pV, 0.82)], [0.64, cur(pV)],
      [0.7, cur(away, 1, 0)], [1, cur(away, 1, 0)],
    ])
    const box = (x: number, o = 1): Keyframe => ({ transform: `translateX(${x}%)`, opacity: o })
    play(crop, [[0, box(0)], [0.145, box(0)], [0.33, box(SLIDE)], [0.45, box(SLIDE)], [0.47, box(SLIDE, 0)], [0.62, box(SLIDE, 0)], [0.64, box(SLIDE)], [0.86, box(SLIDE)], [0.97, box(0)], [1, box(0)]])
    // the phone shows exactly what's inside the box (the scene is 1 / 31.64% as wide as the phone)
    const pan = (left: number): Keyframe => ({ transform: `translateX(${-left}%)` })   // % of the scene's own width
    play(q('.mk-phone-scene'), [[0, pan(AT_A)], [0.145, pan(AT_A)], [0.33, pan(AT_B)], [0.86, pan(AT_B)], [0.97, pan(AT_A)], [1, pan(AT_A)]])

    // 3 · Split: the dock pill moves over, both speakers stack in the preview, two boxes on the canvas
    const pillX = dockS && dockV ? dockS.offsetLeft - dockV.offsetLeft : 0
    play(q('.mk-pill'), [[0, { transform: 'translateX(0px)' }], [0.44, { transform: 'translateX(0px)' }], [0.46, { transform: `translateX(${pillX}px)` }], [0.62, { transform: `translateX(${pillX}px)` }], [0.64, { transform: 'translateX(0px)' }], [1, { transform: 'translateX(0px)' }]])
    play(dockV, [[0, { color: '#c8ff00' }], [0.44, { color: '#c8ff00' }], [0.46, { color: 'rgba(255,255,255,.7)' }], [0.62, { color: 'rgba(255,255,255,.7)' }], [0.64, { color: '#c8ff00' }], [1, { color: '#c8ff00' }]])
    play(dockS, [[0, { color: 'rgba(255,255,255,.7)' }], [0.44, { color: 'rgba(255,255,255,.7)' }], [0.46, { color: '#c8ff00' }], [0.62, { color: '#c8ff00' }], [0.64, { color: 'rgba(255,255,255,.7)' }], [1, { color: 'rgba(255,255,255,.7)' }]])
    const fadeIn = (a: number, b: number): Frame[] => [[0, { opacity: 0 }], [a, { opacity: 0 }], [a + 0.02, { opacity: 1 }], [b, { opacity: 1 }], [b + 0.02, { opacity: 0 }], [1, { opacity: 0 }]]
    play(q('.mk-split'), fadeIn(0.455, 0.615))
    play(q('.mk-split-boxes'), fadeIn(0.455, 0.615))
    play(q('.mk-tag-v'), [[0, { opacity: 1 }], [0.45, { opacity: 1 }], [0.47, { opacity: 0 }], [0.62, { opacity: 0 }], [0.64, { opacity: 1 }], [1, { opacity: 1 }]])

    // 4 · captions, word by word: the word being said is lime, the ones before it white
    CAPTIONS.forEach((c, ci) => {
      play(q(`[data-cap="${ci}"]`), fadeIn(c.from - 0.01, c.to))
      const step = (c.to - c.from - 0.04) / c.words.length
      c.words.forEach((_, wi) => {
        const s = c.from + wi * step, e = s + step
        play(q(`[data-cap="${ci}"] [data-w="${wi}"]`), [
          [0, { opacity: 0, color: '#fff' }], [s, { opacity: 0, color: '#c8ff00' }], [s + 0.008, { opacity: 1, color: '#c8ff00' }],
          [Math.min(e, c.to), { opacity: 1, color: wi === c.words.length - 1 ? '#c8ff00' : '#fff' }], [1, { opacity: 1, color: '#fff' }],
        ], 'linear')
      })
    })

    // 5 · saved ticks after each change, Export pulses at the end
    play(q('.mk-saved-tick'), [[0, { transform: 'scale(1)' }], [0.35, { transform: 'scale(1)' }], [0.365, { transform: 'scale(1.5)' }], [0.38, { transform: 'scale(1)' }], [0.645, { transform: 'scale(1)' }], [0.66, { transform: 'scale(1.5)' }], [0.675, { transform: 'scale(1)' }], [1, { transform: 'scale(1)' }]])
    play(q('.mk-export-ring'), [[0, { transform: 'scale(1)', opacity: 0 }], [0.9, { transform: 'scale(1)', opacity: 0 }], [0.905, { transform: 'scale(1)', opacity: 0.7 }], [0.97, { transform: 'scale(1.35, 1.6)', opacity: 0 }], [1, { transform: 'scale(1)', opacity: 0 }]], 'ease-out')

    // the clock on the control bar (text, so it's set directly — no re-render)
    const time = q('.mk-time b')
    let tick = 0
    const clock = () => {
      const t = ((anims[0]?.currentTime as number) ?? 0) % T / T
      if (time) time.textContent = fmt(Math.max(0, Math.min(1, (t - 0.06) / 0.89)) * 58)
    }

    // runs only while on screen
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { anims.forEach(a => a.play()); if (!tick) tick = window.setInterval(clock, 100) }
      else { anims.forEach(a => a.pause()); clearInterval(tick); tick = 0 }
    })
    io.observe(el)
    return () => { io.disconnect(); clearInterval(tick); anims.forEach(a => a.cancel()) }
  }, [])

  return (
    <div ref={root} className="mk" role="img" aria-label="The Shortcut editing board: steering a vertical crop between two speakers, switching to split screen, with captions in Telugu, Hindi and English">
      {/* Header: logo · breadcrumb · saved | brand kit · help · shortcuts · profile · Export */}
      <div className="mk-top">
        <span className="mk-logo">
          <svg viewBox="0 0 102 118" aria-hidden><path d="M36 2H92Q98 2 94 6L34 66A32 32 0 0 1 36 2Z" /><path d="M66 116H10Q4 116 8 112L68 52A32 32 0 0 1 66 116Z" /></svg>
          Shortcut
        </span>
        <span className="mk-divider" />
        <span className="mk-crumbs">Dashboard<i>›</i>Clip board<i>›</i><b>Editing board</b></span>
        <span className="mk-saved"><i className="mk-saved-tick">✓</i> Saved</span>
        <span className="mk-grow" />
        <span className="mk-brand"><i />Brand: Off<em>▾</em></span>
        <span className="mk-circle">?</span>
        <span className="mk-circle"><I d={<><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>} /></span>
        <span className="mk-acct"><i>Y</i>You</span>
        <span className="mk-export">
          <span className="mk-export-ring" />
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 11.5l7-7M6 4.5h5.5V10" /></svg>
          Export
        </span>
      </div>

      <div className="mk-body">
        {/* Tool rail */}
        <div className="mk-tools">
          {TOOLS.map(t => (
            <div key={t.label} className={`mk-tool${t.on ? ' on' : ''}`}>
              <I d={t.icon} /><span>{t.label}</span>
            </div>
          ))}
        </div>

        {/* Options panel: Captions, as it is today */}
        <div className="mk-panel">
          <div className="mk-tabs"><span className="on">Captions</span><span>Style</span><span>Look</span><span>Key words</span></div>
          <div className="mk-pcard">
            <span className="mk-pcard-icon"><I d={<><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10.5 10.2a2.3 2.3 0 100 3.6M16.5 10.2a2.3 2.3 0 100 3.6" /></>} /></span>
            <span className="mk-pcard-text"><b>Show captions</b><small>● 55 words ready</small></span>
            <span className="mk-toggle on" />
          </div>
          <div className="mk-prow"><span>Language</span><span className="mk-seg"><i className="on">Native</i><i>English hybrid</i></span></div>
          <div className="mk-link"><I d={<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />} />Edit caption words<em>›</em></div>
          <div className="mk-langs"><span>తెలుగు</span><span>हिंदी</span><span>English</span></div>
        </div>

        {/* Canvas, control bar and timeline */}
        <div className="mk-main">
          <div className="mk-docks">
            <span className="mk-dock">
              <span className="mk-pill" aria-hidden="true" />
              <span data-dock="vertical"><LayoutGlyph rows={1} />Vertical</span>
              <span data-dock="split"><LayoutGlyph rows={2} />Split</span>
              <span><LayoutGlyph rows={3} />Trio</span>
              <span><LayoutGlyph rows={0} />Horizontal</span>
            </span>
            <span className="mk-dock mk-motion"><i />Motion</span>
          </div>
          <div className="mk-canvas">
            <Scene />
            <div className="mk-crop" style={{ left: `${AT_A}%`, width: `${CROP_W}%` }}>
              <span className="mk-tag mk-tag-v"><i />Vertical · 9:16</span>
              <i /><i /><i /><i />
            </div>
            {/* Split: one box per speaker */}
            <div className="mk-split-boxes" aria-hidden="true">
              <span style={{ left: '10%' }}><b>1</b></span>
              <span style={{ left: '50%' }}><b>2</b></span>
              <em className="mk-tag"><i />Split</em>
            </div>
          </div>

          {/* Control bar: tools · undo/redo | previous · play · next · time | reset · zoom */}
          <div className="mk-controls">
            <span className="mk-ctl-left">
              <I d={<path d="M6 9l6 6 6-6" />} />
              <span className="mk-sep" />
              <I d={<><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" /></>} />
              <I d={<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" /></>} />
              <I d={<path d="M12 3v18M5.6 6.6l12.8 10.8M18.4 6.6L5.6 17.4" />} />
              <I d={<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />} />
              <span className="mk-sep mk-undo" />
              <span className="mk-undo"><I d={<><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 010 11H11" /></>} /><I d={<><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 000 11H13" /></>} /></span>
            </span>
            <span className="mk-transport">
              <svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="2.4" height="14" rx="1" /><path d="M19 5.8v12.4a.8.8 0 01-1.2.7L9.5 12.7a.8.8 0 010-1.4l8.3-6.2a.8.8 0 011.2.7z" /></svg>
              <span className="mk-play">
                <svg className="mk-play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z" /></svg>
                <svg className="mk-play-pause" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5.5" width="3.4" height="13" rx="1" /><rect x="13.6" y="5.5" width="3.4" height="13" rx="1" /></svg>
              </span>
              <svg viewBox="0 0 24 24" fill="currentColor"><rect x="16.6" y="5" width="2.4" height="14" rx="1" /><path d="M5 5.8v12.4a.8.8 0 001.2.7l8.3-6.2a.8.8 0 000-1.4L6.2 5.1A.8.8 0 005 5.8z" /></svg>
              <span className="mk-time"><b>0:00.0</b> / 0:58</span>
            </span>
            <span className="mk-ctl-zoom"><I d={<><path d="M3 12a9 9 0 109-9 9.5 9.5 0 00-6.7 2.8L3 8" /><path d="M3 3v5h5" /></>} /><i>−</i><b>1x</b><i>+</i></span>
          </div>

          {/* Timeline: add button and lane icons · ruler · scenes with their layout · playhead */}
          <div className="mk-timeline">
            <div className="mk-lanes"><span className="mk-add">+</span><span className="mk-lane-icons">◉ ♪ ⌂</span></div>
            <div className="mk-track">
              <div className="mk-ruler"><span>0:00</span><span>0:10</span><span>0:20</span><span>0:30</span><span>0:40</span><span>0:50</span></div>
              <div className="mk-strip">
                {SCENES.map((s, i) => (
                  <span key={i} className="mk-scene-block" style={{ flex: s.len, '--h': s.hue } as React.CSSProperties}>
                    {s.label && <em><i />{s.label}</em>}
                    <b>{s.len.toFixed(1)}s</b>
                    {i < SCENES.length - 1 && <u>+</u>}
                  </span>
                ))}
              </div>
              <div className="mk-ph-run"><div className="mk-playhead" /></div>
            </div>
          </div>
          {/* the cursor that does the steering */}
          <div className="mk-cursor-layer" aria-hidden="true">
            <svg className="mk-cursor" viewBox="0 0 24 24"><path d="M5 3l14 7.5-6.2 1.6L10 18.5z" fill="#fff" stroke="#0a0a0a" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          </div>
        </div>

        {/* Preview: collapse · how it looks in each app · the 9:16 reel */}
        <div className="mk-preview">
          <div className="mk-preview-head">
            <span className="mk-circle mk-sq">›</span>
            <span className="mk-apps">
              <span className="on"><I d={<rect x="7" y="3" width="10" height="18" rx="2" />} /></span>
              <span><I d={<><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".6" fill="currentColor" /></>} /></span>
              <span><I d={<><rect x="2.5" y="5" width="19" height="14" rx="4" /><path d="M10 9.5l5 2.5-5 2.5z" fill="currentColor" /></>} /></span>
            </span>
          </div>
          <div className="mk-phone">
            <div className="mk-phone-scene" style={{ width: `${10000 / CROP_W}%`, transform: `translateX(${-AT_A}%)` }}><Scene /></div>
            {/* Split: both speakers stacked */}
            <div className="mk-split" aria-hidden="true">
              <div><div className="mk-split-scene" style={{ transform: 'translate(-10%, -8%)' }}><Scene /></div></div>
              <div><div className="mk-split-scene" style={{ transform: 'translate(-50%, -8%)' }}><Scene /></div></div>
            </div>
            <div className="mk-captions">
              {CAPTIONS.map((c, ci) => (
                <span key={ci} data-cap={ci} className={c.split ? 'mk-cap-mid' : undefined}>
                  {c.words.map((w, wi) => <i key={wi} data-w={wi}>{w}</i>)}
                </span>
              ))}
            </div>
            <span className="mk-full"><I d={<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />} /></span>
          </div>
        </div>
      </div>

    </div>
  )
}
