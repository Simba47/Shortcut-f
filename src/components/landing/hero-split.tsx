'use client'

import { useEffect, useRef, useState } from 'react'
import { ZoomFit } from '@/components/ui/zoom-fit'

/**
 * Hero animation, concept A — one long video splits into reels (styles: .hs-* in app/landing.css).
 * A wide 16:9 player plays the long video; a playhead runs along its timeline and the AI marks the
 * best moments (lime segments, each with a score). As the playhead passes one, that moment lifts out
 * of the player, reshapes from wide to a tall 9:16 reel framed on the speaker, its caption writes in
 * word by word, and it settles into a fanned row of reels. Then the row clears and it starts over.
 * Positions are computed from one clock (only running while it's on screen).
 */

// Layout (px, at the 600px design width; ZoomFit scales it to the column)
const WIDTH = 584, HEIGHT = 300
const PLAYER = { x: 0, y: 44, w: 296, h: 166.5 }                // 16:9 (with the timeline: centred on the reels)
const TL = { x: 0, y: PLAYER.y + PLAYER.h + 24, w: PLAYER.w, h: 18 }   // the timeline under it
// where the reels settle: a fan — the first two smaller and tilted on either side, the last one large
// in the middle, in front (each slot's height; its width is 9:16 of it)
const SLOTS = [
  { x: 322, y: 50, h: 196, r: -9, z: 1 },
  { x: 456, y: 50, h: 196, r: 9, z: 2 },
  { x: 374, y: 22, h: 248, r: 0, z: 3 },
]
// The long video's frames (stills in public/landing; a slow zoom makes them feel like video), and
// where the subject sits across each (share of the width) — the reels crop around it
const FOOTAGE = [
  { src: '/landing/studio-1.webp', focus: 0.42 },
  { src: '/landing/studio-2.webp', focus: 0.47 },
  { src: '/landing/studio-3.webp', focus: 0.42 },
]
// The moments the AI picks: where they sit on the timeline (share of it), how long, their scores,
// the frame each shows (FOOTAGE) and its caption, word by word
const MOMENTS = [
  { at: 0.12, len: 0.13, score: 92, shot: 0, caption: ['Do', 'this', 'instead'] },
  { at: 0.44, len: 0.12, score: 88, shot: 1, caption: ['This', 'changed', 'everything'] },
  { at: 0.74, len: 0.13, score: 85, shot: 2, caption: ['My', 'biggest', 'mistake'] },
]
// One loop (ms): the playhead runs the timeline; each moment lifts out as the playhead leaves it
const SCAN = 4200, LIFT = 950, WORD = 260, HOLD_END = 7600, FADE = 600, CYCLE = HOLD_END + FADE + 250
// The timeline under the player: a filmstrip of the video's frames (which frame, and the crop across it)
const STRIP = Array.from({ length: 16 }, (_, i) => ({ shot: Math.floor(i * FOOTAGE.length / 16), x: [38, 46, 60][i % 3] }))
const LENGTH = 7 * 60 + 12    // the long video's length (s): 07:12
const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const ease = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2)
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/** Karaoke caption: the first `lit` words are lime, the newest one pops (styles: .hl-cap) */
function Caption({ words, lit }: { words: string[]; lit: number }) {
  return (
    <span className="hl-cap">
      {words.map((w, k) => <span key={k} className={k < lit ? (k === lit - 1 ? 'on now' : 'on') : ''}>{w}</span>).flatMap((el, k) => (k ? [' ', el] : [el]))}
    </span>
  )
}

/** One frame of the long video, slowly zooming and drifting (t: the loop clock, ms) */
function Shot({ i, t }: { i: number; t: number }) {
  const k = (t % 9000) / 9000
  return (
    <div className="hs-shot" style={{ backgroundImage: `url(${FOOTAGE[i].src})`,
      transform: `scale(${(1.04 + 0.06 * k).toFixed(4)}) translateX(${(-1.2 * k).toFixed(3)}%)` }} />
  )
}

export function HeroSplit() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [t, setT] = useState(SCAN + LIFT * 2 + 1400)   // (still frame until it starts: all three reels in)

  useEffect(() => {
    const root = rootRef.current
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let visible = true
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting })
    io.observe(root)
    let raf = 0, last = performance.now(), clock = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(now - last, 50)
      last = now
      if (!visible || root.closest('[data-covered], [data-paused]')) return   // off screen, or the next section is coming up over it
      clock = (clock + dt) % CYCLE
      setT(clock)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); io.disconnect() }
  }, [])

  const head = clamp01(t / SCAN)                       // the playhead, 0 → 1 along the timeline
  const out = clamp01((t - HOLD_END) / FADE)           // the end of the loop: everything fades
  // the moment under the playhead (its scene plays in the player)
  const under = MOMENTS.findIndex(m => head >= m.at && head < m.at + m.len)
  const playing = under >= 0 ? MOMENTS[under].shot : Math.min(FOOTAGE.length - 1, Math.floor(head * FOOTAGE.length))

  return (
    <ZoomFit width={WIDTH} max={1.6} className="hl-fit hs-fit">
      <div ref={rootRef} className="hs" role="img" style={{ width: WIDTH, height: HEIGHT }}
        aria-label="One long video plays; AI marks its best moments, and each one turns into a vertical reel with captions">
        {/* the long video */}
        <div className="hs-player" style={{ left: PLAYER.x, top: PLAYER.y, width: PLAYER.w, height: PLAYER.h, opacity: 1 - out * 0.4 }}>
          <Shot i={playing} t={t} />
          <span className="hs-tag"><i />16:9</span>
          {under >= 0 && <span className="hs-found" key={under}>Best moment</span>}
          {/* the player's controls: progress, play, time, CC, fullscreen */}
          <div className="hs-ctrl">
            <div className="hs-prog">
              <i style={{ width: `${head * 100}%` }} />
              <em style={{ left: `${head * 100}%` }} />
            </div>
            <div className="hs-ctrl-row">
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4c0 .5.5.8.9.5l6.6-4.2c.4-.2.4-.8 0-1L3.9 1.3c-.4-.3-.9 0-.9.5Z" fill="currentColor" /></svg>
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 4.5h2L6.5 2v8l-3-2.5h-2Z" fill="currentColor" /><path d="M8.5 4a3 3 0 0 1 0 4" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" /></svg>
              <span className="hs-time">{clock(head * LENGTH)} <span>/ {clock(LENGTH)}</span></span>
              <span className="hs-sp" />
              <span className="hs-cc">CC</span>
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 4.5v-3h3M10.5 4.5v-3h-3M1.5 7.5v3h3M10.5 7.5v3h-3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
        </div>
        {/* its timeline: a filmstrip, the picked moments (lit once reached), the playhead scanning along */}
        <div className="hs-tl" style={{ left: TL.x, top: TL.y, width: TL.w, height: TL.h, opacity: 1 - out }}>
          <div className="hs-strip">
            {STRIP.map((f, i) => <i key={i} style={{ backgroundImage: `url(${FOOTAGE[f.shot].src})`, backgroundPosition: `${f.x}% 50%` }} data-past={(i + 0.5) / STRIP.length < head || undefined} />)}
          </div>
          {MOMENTS.map((m, i) => {
            const reached = head >= m.at
            const now = reached && head < m.at + m.len        // the playhead is picking this one right now
            return (
              <div key={i} className="hs-mark" data-on={reached || undefined} data-now={now || undefined} style={{ left: `${m.at * 100}%`, width: `${m.len * 100}%` }}>
                {/* its viral score (0–99, as the app shows it: a bolt and the number), counting up as the playhead crosses it */}
                {reached && (
                  <span className="hs-score">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor" /></svg>
                    {Math.round(m.score * (0.5 + 0.5 * ease(clamp01((head - m.at) / m.len))))}
                    {i === 0 && <em>Viral score</em>}
                  </span>
                )}
              </div>
            )
          })}
          <div className="hs-head" style={{ left: `${head * 100}%` }} />
        </div>
        {/* the reels: each lifts out of the player as the playhead leaves its moment */}
        {MOMENTS.map((m, i) => {
          const start = (m.at + m.len) * SCAN
          const k = clamp01((t - start) / LIFT)
          if (t < start) return null
          const e = ease(k)
          const s = SLOTS[i]
          const x = lerp(PLAYER.x, s.x, e), y = lerp(PLAYER.y, s.y, e)
          const w = lerp(PLAYER.w, Math.round(s.h * 9 / 16), e), h = lerp(PLAYER.h, s.h, e)
          const words = k < 1 ? 0 : Math.min(3, Math.floor((t - start - LIFT) / WORD) + 1)
          // the side reels sit half behind the front one: once it lands over them their captions fade and they dim
          const front = MOMENTS[SLOTS.findIndex(sl => sl.z === 3)]
          const back = s.z < 3 && t > (front.at + front.len) * SCAN + LIFT * 0.6
            return (
            <div key={i} className="hs-reel" data-landed={k >= 1 || undefined} data-back={back || undefined}
              style={{ left: x, top: y, width: w, height: h, zIndex: 10 + s.z, transform: `rotate(${(s.r * e).toFixed(2)}deg)`, borderRadius: lerp(10, 18, e), opacity: 1 - out }}>
              {/* the wide picture, cropped around its subject */}
              <div className="hs-reel-scene" style={{ width: h * 16 / 9, left: Math.max(w - h * 16 / 9, Math.min(0, w / 2 - FOOTAGE[m.shot].focus * h * 16 / 9)) }}><Shot i={m.shot} t={t} /></div>
              {words > 0 && <div className="hs-cap"><Caption words={m.caption} lit={words} /></div>}
              {k >= 1 && <span className="hs-ratio">9:16</span>}
            </div>
          )
        })}
      </div>
    </ZoomFit>
  )
}
