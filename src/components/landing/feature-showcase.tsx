'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from 'framer-motion'
import { type TunnelFeature } from '@/components/landing/feature-tunnel'
import { StageArt } from '@/components/landing/feature-stage-art'

/**
 * Features, as a horizontal gallery (user 2026-11-23: "completely change the features page and the scroll animation;
 * premium"). Desktop; smaller screens keep the carousel. The section holds still while it is scrolled through, and
 * the scroll moves the five features sideways across the screen: one large panel in the middle — its live scene (the
 * hero's podcast footage, feature-stage-art.tsx), its number, tag, title and line — while the panels either side turn
 * away in 3D, smaller and dimmer (a cover-flow). Above: the headline, a counter and a thin progress line; arrows step
 * to the next or previous feature. Same words as before. Reduced motion: the panels slide without turning.
 */
const STEP_VH = 80                                    // scroll per feature

function Panel({ f, i, pos, w }: { f: TunnelFeature; i: number; pos: MotionValue<number>; w: number }) {
  const d = useTransform(pos, p => i - p)             // < 0 gone left, 0 in the middle, > 0 waiting right
  const rotateY = useTransform(d, [-1, 0, 1], [24, 0, -24])
  const scale = useTransform(d, [-1.5, -1, 0, 1, 1.5], [0.8, 0.86, 1, 0.86, 0.8])
  const opacity = useTransform(d, [-2, -1, 0, 1, 2], [0, 0.42, 1, 0.42, 0])
  const z = useTransform(d, [-1, 0, 1], [-140, 0, -140])
  return (
    <motion.article className="fg-panel" style={{ width: w, rotateY, scale, opacity, z }} aria-label={f.title}>
      <div className="fs-art fa-host fg-art" aria-hidden="true"><StageArt id={f.id} /></div>
      <div className="fg-body">
        <div className="fg-meta">
          <span className="fg-num">{String(i + 1).padStart(2, '0')}</span>
          <span className="fg-tag">{f.tag}</span>
        </div>
        <div className="fg-text">
          <h3 className="fg-title">{f.title}</h3>
          <p className="fg-desc">{f.description}</p>
        </div>
      </div>
    </motion.article>
  )
}

export function FeatureShowcase({ eyebrow, title, items, onJump }: {
  eyebrow: string; title: ReactNode; items: TunnelFeature[]; onJump?: (y: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const n = items.length
  const [vw, setVw] = useState(1440)
  useEffect(() => {
    const size = () => setVw(window.innerWidth)
    size(); window.addEventListener('resize', size)
    return () => window.removeEventListener('resize', size)
  }, [])
  // the panel: about 60 % of the screen, never wider than 900 px; the gap between panels
  const w = Math.min(vw * 0.52, 820), gap = Math.max(28, vw * 0.035)

  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const raw = useTransform(scrollYProgress, [0.05, 0.95], [0, n - 1], { clamp: true })
  const pos = useSpring(raw, { stiffness: 110, damping: 24, restDelta: 0.0005 })
  // the track: panel i sits in the middle when pos = i
  const x = useTransform(pos, p => vw / 2 - w / 2 - p * (w + gap))
  const fill = useTransform(scrollYProgress, [0.05, 0.95], [0, 1], { clamp: true })
  const [active, setActive] = useState(0)
  useMotionValueEvent(raw, 'change', v => { const a = Math.min(n - 1, Math.max(0, Math.round(v))); if (a !== active) setActive(a) })

  const jump = (i: number) => {
    const el = ref.current
    if (!el) return
    const k = Math.min(n - 1, Math.max(0, i))
    const top = el.getBoundingClientRect().top + window.scrollY
    const y = top + (el.offsetHeight - window.innerHeight) * (0.05 + (k / (n - 1)) * 0.9)
    if (onJump) onJump(y); else window.scrollTo({ top: y, behavior: 'smooth' })
  }

  return (
    <div ref={ref} className="fg" style={{ height: `${100 + (n - 1) * STEP_VH}vh` }}>
      <div className="fg-sticky">
        <header className="fg-head">
          <div>
            <p className="section-eyebrow fg-eyebrow">{eyebrow}</p>
            <h2 className="section-title fg-h">{title}</h2>
          </div>
          <div className="fg-nav">
            <div className="fg-count" aria-live="polite"><b>{String(active + 1).padStart(2, '0')}</b><span>/ {String(n).padStart(2, '0')}</span></div>
            <div className="fg-progress" aria-hidden="true"><motion.i style={{ scaleX: fill }} /></div>
            <div className="fg-arrows">
              <button type="button" onClick={() => jump(active - 1)} disabled={active === 0} aria-label="Previous feature">
                <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg>
              </button>
              <button type="button" onClick={() => jump(active + 1)} disabled={active === n - 1} aria-label="Next feature">
                <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            </div>
          </div>
        </header>
        <div className="fg-stage">
          <motion.div className="fg-track" style={{ x, gap }}>
            {items.map((f, i) => <Panel key={f.id} f={f} i={i} pos={pos} w={w} />)}
          </motion.div>
        </div>
      </div>
    </div>
  )
}
