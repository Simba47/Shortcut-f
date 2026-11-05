'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { AUTH } from './strings'

/**
 * The auth card's brand side on desktop (user, 2026-11-03: "use the things you wish… make sure it
 * attracts the people"; worldwide; the lime kept to a minimum): a creator, full bleed, mid-sentence —
 * and Shortcut at work over them. Their words come up in the transcript, the AI picks the moment
 * (the phrase lit, its stretch of the waveform lit, a label with its score), and the moment comes
 * out as a 9:16 short with its caption. Then the next creator. Decoration only (hidden from screen
 * readers; the headline and line under it are the brand side's words). With reduced motion: the
 * first scene, finished, still.
 *
 * Photos (public/auth, cropped 4:5 and compressed from the originals; Unsplash License — free for
 * commercial use, no attribution required, credited here as thanks):
 *   creator-1  Higor Hanschen     unsplash.com/photos/3Bz1yBpI3GI
 *   creator-2  Aman Upadhyay      unsplash.com/photos/ZXTudf8b7fA
 *   creator-3  Kit (ConvertKit)   unsplash.com/photos/-CbLJAUI_js
 * Only the first loads with the page; the others once it has settled. (Lazy: on phones, where the
 * scene is hidden, none of them load at all.)
 */

// Each photo, where the face is in it (for the short's crop) and which side of the panel the short
// floats on — the side away from the face, so it never covers it
const PHOTOS = [
  { src: '/auth/creator-1.webp', face: '44% 30%', side: 'end' },
  { src: '/auth/creator-2.webp', face: '60% 26%', side: 'start' },
  { src: '/auth/creator-3.webp', face: '48% 26%', side: 'end' },
] as const
const SCENE_MS = 6500

// The timeline under the transcript: a fine waveform of the 90 s around the moment (fixed, so the
// server's HTML and the browser's match), and where in those 90 s each scene's clip starts and ends
const WAVE = 'M1.2 9.4V18.6M3.8 9.8V18.2M6.2 7.1V20.9M8.8 9.5V18.5M11.2 6.8V21.2M13.8 7.4V20.6M16.2 8.9V19.1M18.8 6.0V22.0M21.2 8.7V19.3M23.8 6.0V22.0M26.2 8.2V19.8M28.8 8.0V20.0M31.2 5.8V22.2M33.8 3.1V24.9M36.2 7.8V20.2M38.8 7.2V20.8M41.2 4.8V23.2M43.8 3.0V25.0M46.2 5.5V22.5M48.8 6.9V21.1M51.2 3.8V24.2M53.8 9.2V18.8M56.2 11.6V16.4M58.8 12.4V15.6M61.2 12.6V15.4M63.8 12.6V15.4M66.2 12.2V15.8M68.8 3.7V24.3M71.2 7.7V20.3M73.8 5.1V22.9M76.2 4.8V23.2M78.8 6.5V21.5M81.2 5.6V22.4M83.8 8.7V19.3M86.2 8.9V19.1M88.8 8.3V19.7M91.2 6.0V22.0M93.8 7.7V20.3M96.2 8.6V19.4M98.8 7.7V20.3M101.2 8.7V19.3M103.8 9.8V18.2M106.2 8.3V19.7M108.8 8.5V19.5M111.2 10.1V17.9M113.8 8.7V19.3M116.2 8.5V19.5M118.8 6.5V21.5M121.2 6.7V21.3M123.8 8.5V19.5M126.2 4.7V23.3M128.8 9.0V19.0M131.2 7.2V20.8M133.8 5.1V22.9M136.2 8.5V19.5M138.8 6.5V21.5M141.2 9.0V19.0M143.8 5.4V22.6M146.2 4.9V23.1M148.8 6.1V21.9M151.2 4.6V23.4M153.8 7.8V20.2M156.2 5.9V22.1M158.8 6.5V21.5M161.2 6.2V21.8M163.8 6.5V21.5M166.2 3.9V24.1M168.8 2.9V25.1M171.2 5.6V22.4M173.8 4.2V23.8M176.2 8.1V19.9M178.8 3.7V24.3M181.2 4.0V24.0M183.8 1.6V26.4M186.2 2.8V25.2M188.8 6.6V21.4M191.2 6.1V21.9M193.8 4.4V23.6M196.2 8.7V19.3M198.8 6.3V21.7M201.2 8.3V19.7M203.8 8.8V19.2M206.2 9.4V18.6M208.8 6.2V21.8M211.2 9.5V18.5M213.8 8.8V19.2M216.2 8.0V20.0M218.8 5.5V22.5M221.2 9.4V18.6M223.8 7.6V20.4M226.2 7.1V20.9M228.8 5.4V22.6M231.2 5.8V22.2M233.8 5.8V22.2M236.2 8.8V19.2M238.8 8.3V19.7M241.2 8.8V19.2M243.8 6.4V21.6M246.2 5.9V22.1M248.8 12.9V15.1M251.2 12.9V15.1M253.8 12.8V15.2M256.2 12.8V15.2M258.8 8.3V19.7M261.2 7.9V20.1M263.8 9.2V18.8M266.2 10.0V18.0M268.8 7.7V20.3M271.2 7.6V20.4M273.8 6.1V21.9M276.2 3.5V24.5M278.8 4.7V23.3M281.2 5.5V22.5M283.8 4.7V23.3M286.2 4.1V23.9M288.8 8.2V19.8M291.2 2.5V25.5M293.8 3.3V24.7M296.2 2.7V25.3M298.8 3.4V24.6'
const CLIP_AT = [[0.311, 0.778], [0.278, 0.7], [0.244, 0.811]] as const

export function BrandScene({ children }: { children: React.ReactNode }) {
  const [at, setAt] = useState(0)
  const [all, setAll] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setAll(true), 1200)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    if (!all || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setAt(i => (i + 1) % PHOTOS.length), SCENE_MS)
    return () => clearInterval(t)
  }, [all])

  const photos = all ? PHOTOS : PHOTOS.slice(0, 1)
  const scene = AUTH.brand.scenes[at % AUTH.brand.scenes.length]
  const photo = PHOTOS[at]
  const [from, to] = CLIP_AT[at]

  return (
    <>
      <div className="auth-photo" aria-hidden>
        {photos.map((p, i) => <img key={p.src} src={p.src} alt="" loading="lazy" decoding="async" data-on={i === at || undefined} />)}
      </div>

      {/* The moment, out as a short: the same frame, cropped 9:16 round the face, captioned */}
      <div key={`short-${at}`} className="auth-short" data-side={photo.side} aria-hidden>
        <span className="auth-chip"><Sparkles aria-hidden />{scene.moment}<b>{scene.score}</b></span>
        <div className="auth-short-frame">
          <img src={photo.src} alt="" loading="lazy" decoding="async" style={{ objectPosition: photo.face }} />
          <p className="auth-short-cap">
            {scene.caption.map((w, i) => <span key={i} data-key={i === scene.key || undefined}>{w}</span>)}
          </p>
        </div>
      </div>

      <div className="auth-stage">
        {/* What they're saying, the moment picked in it, and that moment on the timeline */}
        <div key={`edit-${at}`} className="auth-edit" aria-hidden>
          <div className="auth-edit-head">
            <span><i />{AUTH.brand.transcript}</span>
            <span>{scene.time}</span>
          </div>
          <p className="auth-edit-line">
            {words(scene.words.slice(0, scene.pick[0]), 0)}
            {scene.pick[0] > 0 && ' '}
            <mark>{words(scene.words.slice(scene.pick[0], scene.pick[1]), scene.pick[0])}</mark>
            {scene.pick[1] < scene.words.length && ' '}
            {words(scene.words.slice(scene.pick[1]), scene.pick[1])}
          </p>
          <Timeline from={from} to={to} window={scene.window} clip={scene.clip} />
        </div>
        {children}
      </div>
    </>
  )
}

/** Words that come up one after another (`--i`: their place in the whole line), spaces between them */
function words(list: readonly string[], first: number) {
  return list.map((w, n) => (
    <span key={first + n}>
      {n > 0 && ' '}
      <span className="auth-word" style={{ '--i': first + n } as React.CSSProperties}>{w}</span>
    </span>
  ))
}

/**
 * The 90 s round the moment, as an editor shows it: a fine waveform, the clip selected on it (trim
 * handles at its ends, the waveform inside it bright), a playhead running through the clip, the
 * window's start and end times, and the clip's length under it
 */
function Timeline({ from, to, window: [start, end], clip }: { from: number; to: number; window: readonly [string, string]; clip: string }) {
  const sel = { left: `${from * 100}%`, width: `${(to - from) * 100}%` }
  return (
    <div className="auth-tl">
      <div className="auth-tl-track">
        <svg viewBox="0 0 300 28" preserveAspectRatio="none" aria-hidden><path d={WAVE} /></svg>
        <svg viewBox="0 0 300 28" preserveAspectRatio="none" aria-hidden className="auth-tl-lit"
          style={{ clipPath: `inset(0 ${(1 - to) * 100}% 0 ${from * 100}%)` }}><path d={WAVE} /></svg>
        <span className="auth-tl-sel" style={sel}><i /></span>
      </div>
      <div className="auth-tl-times">
        <span>{start}</span>
        <span className="auth-tl-clip" style={{ left: `${((from + to) / 2) * 100}%` }}>{AUTH.brand.clipLength(clip)}</span>
        <span>{end}</span>
      </div>
    </div>
  )
}
