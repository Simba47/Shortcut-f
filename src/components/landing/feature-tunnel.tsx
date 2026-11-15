'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useMotionValue, useScroll, useSpring, useTransform, type MotionValue } from 'framer-motion'

/**
 * Features, desktop: a fly-through (styles: .ft-* in app/landing.css).
 * The section pins for a few screens of scrolling; the heading sits in the middle and the feature
 * cards come at you out of the depth one after another, drift past around it and leave behind the
 * camera. The page scrolls normally (no wheel hijacking): scroll position drives it all. The mouse
 * pans the camera a little. A row of ticks at the bottom shows how far through the features you are.
 * Phones, tablets and reduced motion get the carousel instead (LandingPage picks).
 */

export interface TunnelFeature {
  id: string
  tag?: string
  icon?: ReactNode
  title: string
  description: string
}

// The card art: the feature itself, drawn as a small piece of UI (styles: .ft-a-*). Where the feature
// works on a video, the video (a panda frame, public/landing) sits dim behind it, never the focus.
const VIDEO = (n: number, pos = '45% 50%') => ({ backgroundImage: `url(/landing/studio-${n}.webp)`, backgroundPosition: pos })
const BOLT = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor" /></svg>
const TICK = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
const WAVE = Array.from({ length: 30 }, (_, i) => 0.25 + 0.7 * Math.abs(Math.sin(i * 1.9) * Math.cos(i * 0.37)))

function Art({ id }: { id: string }) {
  switch (id) {
    case 'moments':      // the AI marks the best moments on the timeline, each with its score
      return (
        <div className="ft-a ft-a-moments">
          <span className="ft-a-label">3 clips found</span>
          <div className="ft-a-wave">{WAVE.map((h, i) => <i key={i} style={{ height: `${h * 100}%` }} />)}
            {[[8, 18, 92], [42, 16, 88], [72, 18, 85]].map(([l, w, s]) => <b key={l} style={{ left: `${l}%`, width: `${w}%` }}><em>{BOLT}{s}</em></b>)}
          </div>
        </div>
      )
    case 'steer':        // a wide frame, the 9:16 window guided over it
      return (
        <div className="ft-a ft-a-steer">
          <div className="ft-a-video" style={VIDEO(1, '40% 50%')} />
          <span className="ft-a-window"><i /><i /><i /><i /></span>
          <span className="ft-a-drag">◂ ▸</span>
        </div>
      )
    case 'captions':     // word-by-word captions
      return (
        <div className="ft-a ft-a-captions">
          <div className="ft-a-video ft-a-dim" style={VIDEO(2, '46% 40%')} />
          <p className="ft-a-cap"><span>Do</span> <b>this</b> <span>instead</span></p>
          <span className="ft-a-chip">Aa · Bold · Lime</span>
        </div>
      )
    case 'hooks':        // a hook title on the first second
      return (
        <div className="ft-a ft-a-hooks">
          <div className="ft-a-video ft-a-dim" style={VIDEO(3, '42% 45%')} />
          <span className="ft-a-hook">Wait for it…</span>
          <span className="ft-a-time"><i />0:01</span>
        </div>
      )
    case 'brand':        // your logo, colours and font
      return (
        <div className="ft-a ft-a-brand">
          {/* an empty logo slot: the visitor's own logo goes here */}
          <span className="ft-a-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>
            <em>Logo</em>
          </span>
          <span className="ft-a-font">Aa</span>
          <div className="ft-a-swatches"><i style={{ background: '#c8ff00' }} /><i style={{ background: '#ffffff' }} /><i style={{ background: '#38bdf8' }} /><i style={{ background: '#18181b' }} /></div>
        </div>
      )
    case 'layouts':      // the layouts to pick from
      return (
        <div className="ft-a ft-a-layouts">
          <span className="ft-a-lay ft-a-lay-text"><i /><b /></span>
          <span className="ft-a-lay ft-a-lay-split" data-on><b /><b /></span>
          <span className="ft-a-lay ft-a-lay-pip"><b /><i /></span>
        </div>
      )
    case 'export':       // clips rendering while you edit, ready the moment you finish
      return (
        <div className="ft-a ft-a-export">
          {[['Clip 01', 100], ['Clip 02', 100], ['Clip 03', 72]].map(([n, p]) => (
            <div key={n} className="ft-a-row" data-done={p === 100 || undefined}>
              <span>{n}</span><i><b style={{ width: `${p}%` }} /></i><em>{p === 100 ? TICK : `${p}%`}</em>
            </div>
          ))}
        </div>
      )
    case 'post':         // one clip out to every platform
      return (
        <div className="ft-a ft-a-post">
          <span className="ft-a-clip" style={VIDEO(2, '47% 40%')} />
          <svg className="ft-a-lines" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 30 C 45 30, 45 10, 100 10 M0 30 L100 30 M0 30 C 45 30, 45 50, 100 50" /></svg>
          <div className="ft-a-plats">
            {/* YouTube Shorts · Instagram Reels · download the MP4 (to post anywhere else) */}
            <span className="yt" title="YouTube Shorts">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="4" fill="#fff" /><path d="M10 9.2v5.6l4.8-2.8z" fill="#ff0033" /></svg>
              <em>{TICK}</em>
            </span>
            <span className="ig" title="Instagram Reels">
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4.5" /><circle cx="12" cy="12" r="3.6" /><circle cx="16.6" cy="7.4" r=".9" fill="#fff" stroke="none" /></svg>
              <em>{TICK}</em>
            </span>
            <span className="dl" title="Download">
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" /><path d="M5 19h14" /></svg>
              <em>{TICK}</em>
            </span>
          </div>
        </div>
      )
    default:
      return <div className="ft-a" />
  }
}

// Where each card flies (golden-angle spread around the heading) and its tilt
const place = (i: number) => {
  const a = (i * 137.5 + 20) * (Math.PI / 180)
  return {
    cos: Math.cos(a), sin: Math.sin(a),
    rx: 0.34 + (i % 3) * 0.05,         // share of the stage width
    ry: 0.2 + (i % 2) * 0.06,          // share of the stage height
    rot: (i % 2 ? -1 : 1) * (3 + (i % 4) * 1.5),
  }
}

const SPAN = 0.3                        // share of the scroll each card spends flying (about three on screen at once)
const FAR = -1900, NEAR = 650           // its depth (px): out of the distance → past the camera
// when each card sets off (share of the scroll): after the heading has had the screen to itself
const startOf = (i: number, total: number) => 0.1 + (i / total) * (1 - SPAN - 0.14)

function Card({ f, i, total, progress, pan, stage }: {
  f: TunnelFeature; i: number; total: number; progress: MotionValue<number>
  pan: { x: MotionValue<number>; y: MotionValue<number> }; stage: { w: number; h: number }
}) {
  const start = startOf(i, total)
  const local = useTransform(progress, [start, start + SPAN], [0, 1])
  const z = useTransform(local, [0, 1], [FAR, NEAR])
  const opacity = useTransform(local, [0, 0.2, 0.84, 0.97], [0, 1, 1, 0])
  const shade = useTransform(local, [0, 0.5], [0.72, 0])           // far cards sit in the dark
  const p = place(i)
  const bx = p.cos * stage.w * p.rx, by = p.sin * stage.h * p.ry
  const transform = useTransform([z, pan.x, pan.y], ([cz, px, py]: number[]) =>
    `translate3d(calc(-50% + ${(bx - px * 40).toFixed(1)}px), calc(-50% + ${(by - py * 40).toFixed(1)}px), ${cz.toFixed(1)}px) rotateZ(${p.rot}deg)`)
  return (
    <motion.article className="ft-card" style={{ transform, opacity, zIndex: i + 1 }}>
      <div className="ft-art"><Art id={f.id} /></div>
      <div className="ft-body">
        <div className="ft-meta">{f.icon}{f.tag && <span className="ft-tag">{f.tag}</span>}<span className="ft-num">{String(i + 1).padStart(2, '0')}</span></div>
        <h3 className="ft-title">{f.title}</h3>
        <p className="ft-desc">{f.description}</p>
      </div>
      <motion.div className="ft-shade" style={{ opacity: shade }} aria-hidden="true" />
    </motion.article>
  )
}

export function FeatureTunnel({ eyebrow, title, items }: { eyebrow: string; title: string; items: TunnelFeature[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ w: 1440, h: 900 })
  useEffect(() => {
    const size = () => setStage({ w: window.innerWidth, h: window.innerHeight })
    size()
    window.addEventListener('resize', size)
    return () => window.removeEventListener('resize', size)
  }, [])

  // scroll through the (tall) section: 0 when it pins, 1 when it lets go
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const progress = useSpring(scrollYProgress, { stiffness: 90, damping: 28, restDelta: 0.0001 })

  // the camera pans a little with the mouse
  const rawX = useMotionValue(0), rawY = useMotionValue(0)
  const pan = { x: useSpring(rawX, { stiffness: 60, damping: 25, mass: 0.5 }), y: useSpring(rawY, { stiffness: 60, damping: 25, mass: 0.5 }) }
  useEffect(() => {
    const move = (e: PointerEvent) => { rawX.set((e.clientX / window.innerWidth - 0.5) * 2); rawY.set((e.clientY / window.innerHeight - 0.5) * 2) }
    window.addEventListener('pointermove', move, { passive: true })
    return () => window.removeEventListener('pointermove', move)
  }, [rawX, rawY])

  // the heading: on its own at first, a faint watermark while the cards fly past, back at the end
  const headScale = useTransform(progress, [0, 0.08, 0.2, 0.86, 1], [0.9, 1, 0.94, 0.94, 1])
  const headOpacity = useTransform(progress, [0, 0.06, 0.12, 0.22, 0.84, 0.94], [0.4, 1, 1, 0.13, 0.13, 1])
  const hint = useTransform(progress, [0, 0.06], [1, 0])
  // which feature is closest to you (the ticks at the bottom)
  const [at, setAt] = useState(-1)
  useEffect(() => progress.on('change', v => {
    const n = items.length
    let best = -1
    for (let i = 0; i < n; i++) {
      const s = startOf(i, n)
      if (v >= s + SPAN * 0.35) best = i
    }
    setAt(best)
  }), [progress, items.length])

  return (
    <div ref={ref} className="ft" style={{ height: `${Math.max(380, items.length * 55)}vh` }}>
      <div className="ft-stage">
        <div className="ft-glow" aria-hidden="true" />
        <div className="ft-ring" aria-hidden="true" />
        <div className="ft-ring ft-ring-2" aria-hidden="true" />

        <motion.div className="ft-head" style={{ scale: headScale, opacity: headOpacity }}>
          <p className="ft-eyebrow">{eyebrow}</p>
          <h2 className="section-title ft-h">{title}</h2>
        </motion.div>

        <div className="ft-space">
          {items.map((f, i) => <Card key={f.id} f={f} i={i} total={items.length} progress={progress} pan={pan} stage={stage} />)}
        </div>

        <div className="ft-foot" aria-hidden="true">
          <motion.span className="ft-hint" style={{ opacity: hint }}>Scroll to explore</motion.span>
          <div className="ft-ticks">
            {items.map((f, i) => <i key={f.id} data-on={i <= at || undefined} data-now={i === at || undefined} />)}
          </div>
          <span className="ft-count">{String(Math.max(at + 1, 0)).padStart(2, '0')} / {String(items.length).padStart(2, '0')}</span>
        </div>
      </div>
    </div>
  )
}
