'use client'

import { useEffect, useRef, useState } from 'react'
import { ZoomFit } from '@/components/ui/zoom-fit'
import { BrandLogo } from '@/components/ui/brand-logo'

/**
 * Hero visual (desktop; user's website copy, 2026-11-20): the real editor's screen, drawn as it is (from the
 * user's screen recording: top bar, tool rail, layout tabs with Motion, the wide video with the green frame
 * box, the preview phone, the timeline with its Title · Captions · Video tracks), running a short tour of
 * the app's main features (user, 2026-11-20: "a user should know the main features"). Each step uses the
 * real tool: its icon lights in the rail and the result shows live on the phone; one short line under the
 * editor says what the step is. What a step adds stays on for the steps after it, so the
 * short builds up to a finished, branded clip:
 *
 *   1. select    the moment is picked on the long video's timeline
 *   2. steer     the frame box follows her, then glides to him while it plays; the phone follows live
 *   3. layouts   Vertical → Split: a frame on each of them, stacked on the phone; then back
 *   4. captions  the words write in, word by word, in three styles (Karaoke → Box → Highlight)
 *   5. text      a title pops onto the short (and onto the Title track)
 *   6. brand     an example logo and the brand's colour on the captions
 *   7. export    Export: it renders, then "Ready to post"
 *
 * Footage: a free Pexels stock clip (video 16419505), cropped in, silent and looping, in
 * public/landing/hero-podcast.*. The phone is a canvas drawing the frame's part of the playing video, so the
 * two never drift apart. One clock (the tour's), moved through refs; React renders only when something
 * discrete changes. It runs only while on screen and not covered; reduced motion: no loop, one still,
 * fully built frame. Example values only: no real name, balance or brand.
 */

// Design size: ZoomFit scales it to the hero's column (the step chip now sits in its top bar, user 2026-11-21)
const W = 830, EDITOR_H = 542
const CLIP_S = 10                      // the looping clip's length (the picked moment)

// The tour: each step, how long it runs (ms) and the rail tool it uses (index into RAIL; -1: Export, top right)
const STEPS = [
  { id: 'select', label: 'Select a moment', say: 'Pick the part of your video you want as a short.', ms: 2200, tool: 0 },
  { id: 'steer', label: 'Play-and-steer', say: 'Move the frame while it plays. The short follows live.', ms: 6000, tool: 0 },
  { id: 'layouts', label: 'Layouts', say: 'Switch to a split screen and more in one click.', ms: 4600, tool: 0 },
  { id: 'captions', label: 'Auto captions', say: 'Captions write themselves, in the style you pick.', ms: 6000, tool: 2 },
  { id: 'text', label: 'Custom text', say: 'Add hooks and titles that stop the scroll.', ms: 3600, tool: 4 },
  { id: 'brand', label: 'Brand kit', say: 'Your logo and colours on every clip.', ms: 3800, tool: 9 },
  { id: 'export', label: 'Export', say: 'Export in one click. Ready to post.', ms: 4400, tool: -1 },
] as const
const START = STEPS.map((_, i) => STEPS.slice(0, i).reduce((n, s) => n + s.ms, 0))
const TOUR_MS = START[STEPS.length - 1] + STEPS[STEPS.length - 1].ms
const STEP = Object.fromEntries(STEPS.map((s, i) => [s.id, i])) as Record<(typeof STEPS)[number]['id'], number>

// The frame on the wide video (shares of it). Vertical: full height, 9:16, on whoever is talking.
const BOX_W = (9 / 16) * (720 / 1280)
const WOMAN_X = 0.835 - BOX_W / 2, MAN_X = 0.185 - BOX_W / 2
// Split: a 9:8 frame on each (the phone's top and bottom halves)
const SPLIT_H = 0.62, SPLIT_W = SPLIT_H * (9 / 8) * (720 / 1280)
const SPLIT_TOP = { x: 0, y: 0.12, w: SPLIT_W, h: SPLIT_H }                  // him
const SPLIT_BOTTOM = { x: 1 - SPLIT_W, y: 0.12, w: SPLIT_W, h: SPLIT_H }     // her
// The steer, inside its step (ms): the hint shows, the cursor comes in, drags across, lets go
const STEER = { hint: 1500, grab: 2000, move: 2400, moveMs: 1000, letGo: 3800, hintEnd: 4300 }
// Layouts, inside its step (ms): Split on, then back to Vertical
const SPLIT_ON = 400, SPLIT_OFF = 4000
// Captions: two lines, word by word, alternating
const LINES = [
  ['Every', 'episode', 'has', 'ten', 'great', 'moments'],
  ['and', 'now', 'they', 'all', 'get', 'posted'],
]
const LINE_MS = 3000, WORD_MS = 280
const CAP_STYLES = ['karaoke', 'box', 'highlight'] as const
const CAP_NAMES = { karaoke: 'Karaoke', box: 'Box', highlight: 'Highlight' }
const TITLE = '10 great moments'
// Export, inside its step (ms): pressed, rendering, done
const RENDER_FROM = 400, RENDER_MS = 1900
// The timeline: 40 s of the long episode (16:00–16:40); the picked moment is 16:15–16:25
const RULER = ['16:00', '16:05', '16:10', '16:15', '16:20', '16:25', '16:30', '16:35', '16:40']
const SEL = { from: 0.375, to: 0.625 }
const SELECT_OPEN_MS = 1400

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
const fmt = (s: number) => `0:${String(Math.floor(s)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`
const stepAt = (t: number) => { let i = STEPS.length - 1; while (i > 0 && t < START[i]) i--; return i }

type Rect = { x: number; y: number; w: number; h: number }
/** What the tour shows at time `t` (ms): the discrete part (rendered by React) */
function view(t: number) {
  const i = stepAt(t), local = t - START[i]
  const split = i === STEP.layouts && local >= SPLIT_ON && local < SPLIT_OFF
  const capsOn = i >= STEP.captions
  let capStyle: (typeof CAP_STYLES)[number] = 'box'
  if (i === STEP.captions) capStyle = CAP_STYLES[Math.min(2, Math.floor(local / (STEPS[STEP.captions].ms / 3)))]
  const ct = t - START[STEP.captions]
  const line = capsOn ? Math.floor(ct / LINE_MS) % 2 : 0
  const lit = capsOn ? Math.min(6, Math.floor((ct % LINE_MS) / WORD_MS) + 1) : 0
  const steering = i === STEP.steer && local >= STEER.grab && local < STEER.letGo
  const hint = i === STEP.steer && local >= STEER.hint && local < STEER.hintEnd
  const exp = i !== STEP.export ? 'idle' : local < RENDER_FROM ? 'pressed' : local < RENDER_FROM + RENDER_MS ? 'rendering' : 'done'
  return {
    step: i, split, capsOn, capStyle, line, lit, steering, hint, exp,
    titleOn: i >= STEP.text, brandOn: i >= STEP.brand, picked: i > STEP.select || local > SELECT_OPEN_MS * 0.8,
  }
}
type View = ReturnType<typeof view>
/** The single frame's left edge (Vertical) at time `t` */
function boxX(t: number) {
  const i = stepAt(t)
  if (i < STEP.steer) return WOMAN_X
  if (i > STEP.steer) return MAN_X
  return WOMAN_X + (MAN_X - WOMAN_X) * ease(clamp01((t - START[STEP.steer] - STEER.move) / STEER.moveMs))
}

export function HeroEditor() {
  const rootRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const box1Ref = useRef<HTMLDivElement>(null)
  const box2Ref = useRef<HTMLDivElement>(null)
  const dimLRef = useRef<HTMLDivElement>(null)
  const dimRRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const selRef = useRef<HTMLDivElement>(null)
  const selImgRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const pctRef = useRef<HTMLSpanElement>(null)
  const exportRef = useRef<HTMLSpanElement>(null)
  const clock = useRef({ t: 0, still: false, draw: (_t: number) => {} })
  const [v, setV] = useState<View>(() => view(0))
  const [src, setSrc] = useState(false)         // the video loads only on a desktop screen, once near

  useEffect(() => {
    const root = rootRef.current, video = videoRef.current, canvas = canvasRef.current
    if (!root || !video || !canvas) return
    const ctx = canvas.getContext('2d')
    const poster = new Image()
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let shown = JSON.stringify(view(0))

    /** The phone: the frame's part of the picture (Split: him on top, her below) */
    const drawPhone = (t: number, vw: View) => {
      if (!ctx) return
      const ready = video.readyState >= 2
      const img: CanvasImageSource | null = ready ? video : poster.complete && poster.naturalWidth ? poster : null
      if (!img) return
      const iw = ready ? video.videoWidth : poster.naturalWidth, ih = ready ? video.videoHeight : poster.naturalHeight
      const cw = canvas.width, ch = canvas.height
      const crop = (r: Rect, dy: number, dh: number) => ctx.drawImage(img, r.x * iw, r.y * ih, r.w * iw, r.h * ih, 0, dy, cw, dh)
      if (vw.split) {
        crop(SPLIT_TOP, 0, ch / 2)
        crop(SPLIT_BOTTOM, ch / 2, ch / 2)
        ctx.fillStyle = '#000'
        ctx.fillRect(0, ch / 2 - 1.5, cw, 3)
      } else crop({ x: boxX(t), y: 0, w: BOX_W, h: 1 }, 0, ch)
    }
    const pos = (el: HTMLElement | null, r: Rect | null) => {
      if (!el) return
      if (!r) { el.style.opacity = '0'; return }
      el.style.opacity = '1'
      el.style.left = `${r.x * 100}%`; el.style.top = `${r.y * 100}%`; el.style.width = `${r.w * 100}%`; el.style.height = `${r.h * 100}%`
    }
    /** Everything at tour time `t`: the moving parts straight on the page, the rest through React */
    const draw = (t: number) => {
      const vw = view(t)
      const key = JSON.stringify(vw)
      if (key !== shown) { shown = key; setV(vw) }
      const x = boxX(t)
      if (vw.split) {
        pos(box1Ref.current, SPLIT_TOP); pos(box2Ref.current, SPLIT_BOTTOM)
        if (dimLRef.current) dimLRef.current.style.width = '0%'
        if (dimRRef.current) dimRRef.current.style.left = '100%'
      } else {
        pos(box1Ref.current, { x, y: 0, w: BOX_W, h: 1 }); pos(box2Ref.current, null)
        if (dimLRef.current) dimLRef.current.style.width = `${x * 100}%`
        if (dimRRef.current) dimRRef.current.style.left = `${(x + BOX_W) * 100}%`
      }
      if (cursorRef.current) cursorRef.current.style.left = `${(x + BOX_W / 2) * 100}%`
      if (selRef.current) {
        const k = vw.step === STEP.select ? clamp01((t - START[STEP.select]) / SELECT_OPEN_MS) : 1
        const mid = (SEL.from + SEL.to) / 2, half = ((SEL.to - SEL.from) / 2) * ease(k)
        selRef.current.style.left = `${(mid - half) * 100}%`
        selRef.current.style.width = `${half * 2 * 100}%`
        selRef.current.style.opacity = String(k > 0 ? 1 : 0)
        // (inside the trim: the same filmstrip, bright, lined up with the dimmed one under it)
        if (selImgRef.current && half > 0) {
          selImgRef.current.style.left = `${(-(mid - half) / (2 * half)) * 100}%`
          selImgRef.current.style.width = `${100 / (2 * half)}%`
        }
      }
      const s = video.readyState >= 2 ? video.currentTime % CLIP_S : 0
      if (headRef.current) headRef.current.style.left = `${(SEL.from + (SEL.to - SEL.from) * (s / CLIP_S)) * 100}%`
      if (timeRef.current) timeRef.current.textContent = fmt(s)
      // Export: how far the render is
      if (vw.exp === 'rendering') {
        const p = clamp01((t - START[STEP.export] - RENDER_FROM) / RENDER_MS)
        if (pctRef.current) pctRef.current.textContent = `${Math.floor(p * 100)}%`
        exportRef.current?.style.setProperty('--p', String(p))
      }
      drawPhone(t, vw)
    }
    clock.current.draw = draw
    clock.current.still = still

    if (still) {
      // One still, fully built: the steer done, captions, title and brand on
      clock.current.t = START[STEP.brand] + 1800
      poster.onload = () => draw(clock.current.t)
      poster.src = '/landing/hero-podcast.jpg'
      draw(clock.current.t)
      return
    }

    // Load the video only on a desktop-size screen, and only once the hero is near
    const desk = window.matchMedia('(min-width: 961px)')
    let visible = false
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible && desk.matches) setSrc(true)
    }, { rootMargin: '200px' })
    io.observe(root)
    poster.onload = () => draw(clock.current.t)
    poster.src = '/landing/hero-podcast.jpg'

    let raf = 0, last = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(now - last, 250)
      last = now
      // (off screen, or the next section fully over the hero: it stops)
      const hidden = !visible || !desk.matches || !!root.closest('[data-covered]')
      if (hidden) { if (!video.paused) video.pause(); return }
      if (video.paused && video.readyState >= 2) video.play().catch(() => {})
      // the tour waits for the picture before it starts
      if (video.readyState >= 2 || clock.current.t > 0) clock.current.t = (clock.current.t + dt) % TOUR_MS
      draw(clock.current.t)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); io.disconnect(); video.pause() }
  }, [])
  // (its sources go in once it's near: the video has to be told to load them)
  useEffect(() => { if (src) videoRef.current?.load() }, [src])

  const words = LINES[v.line]
  const tool = STEPS[v.step].tool

  return (
    <ZoomFit width={W} max={1.6} className="hl-fit he-fit">
      <div ref={rootRef} className="he-tour" style={{ width: W, height: EDITOR_H }}>
        <div className="he" data-step={STEPS[v.step].id} style={{ width: W, height: EDITOR_H }} role="img"
          aria-label="The Shortcut editor running through its main features on a podcast video: a moment is selected, the vertical frame is steered from one speaker to the other while it plays, a split layout, automatic captions in three styles, a custom title, a brand kit's logo and colours, and an export that ends ready to post">
          {/* top bar, as in the editor */}
          <div className="he-top" aria-hidden="true">
            <span className="he-logo"><BrandLogo size="sm" /></span>
            <span className="he-crumbs">Dashboard <i>›</i> Clip board <i>›</i> <b>Editing board</b></span>
            <span className="he-saved">✓ Saved</span>
            {/* what the step shows, as a chip in the top bar (hero step 9, user 2026-11-21: it used to sit under the editor) */}
            <span className="he-sp">
              <span className="he-step" key={v.step}><i /><b>{STEPS[v.step].label}</b><span>{STEPS[v.step].say}</span></span>
            </span>
            <span ref={exportRef} className="he-export" data-state={v.exp}>
              {v.exp === 'done'
                ? <><svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.5l4.5-5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>Exported</>
                : v.exp === 'rendering'
                  ? <>Rendering <span ref={pctRef}>0%</span></>
                  : <><svg viewBox="0 0 12 12"><path d="M6 8V2M3.5 4.5 6 2l2.5 2.5M2 9.5h8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>Export</>}
            </span>
          </div>

          <div className="he-body" aria-hidden="true">
            {/* the tool rail: the editor's ten tools; the one in use lights up */}
            <div className="he-rail">
              {RAIL.map((r, i) => (
                <span key={r.label} className="he-tool" data-on={i === tool || undefined}>
                  <svg viewBox="0 0 16 16">{r.icon}</svg>
                  {r.label}
                </span>
              ))}
            </div>

            {/* the stage: layout tabs and Motion, the wide video with the frame(s) */}
            <div className="he-stage">
              <div className="he-tabbar">
                <div className="he-tabs">
                  {['Vertical', 'Split', 'Trio', 'Horizontal'].map(t => (
                    <span key={t} data-on={(v.split ? t === 'Split' : t === 'Vertical') || undefined}>{t}</span>
                  ))}
                </div>
                <span className="he-motion"><i />Motion</span>
              </div>
              <div className="he-video">
                <video ref={videoRef} muted loop playsInline preload={src ? 'auto' : 'none'} poster="/landing/hero-podcast.jpg" disablePictureInPicture tabIndex={-1}>
                  {src && <source src="/landing/hero-podcast.webm" type="video/webm" />}
                  {src && <source src="/landing/hero-podcast.mp4" type="video/mp4" />}
                </video>
                <span className="he-tag">16:9</span>
                {/* outside the frame: dimmed; the frame(s) */}
                <div ref={dimLRef} className="he-dim" style={{ left: 0, width: `${WOMAN_X * 100}%` }} />
                <div ref={dimRRef} className="he-dim" style={{ left: `${(WOMAN_X + BOX_W) * 100}%`, right: 0 }} />
                <div ref={box1Ref} className="he-box" style={{ left: `${WOMAN_X * 100}%`, top: 0, width: `${BOX_W * 100}%`, height: '100%' }}>
                  <span className="he-box-label">{v.split ? 'Top' : 'Frame · Video'}</span>
                </div>
                <div ref={box2Ref} className="he-box" style={{ opacity: 0 }}>
                  <span className="he-box-label">Bottom</span>
                </div>
                <div ref={cursorRef} className="he-cursor" data-on={v.steering || undefined} style={{ left: `${(WOMAN_X + BOX_W / 2) * 100}%` }}>
                  <svg viewBox="0 0 24 24"><path d="M5 3l14 7.5-6.2 1.6L10 18.5z" /></svg>
                </div>
                {/* the editor's own hint while the frame is steered */}
                <span className="he-hint" data-on={v.hint || undefined}><i />Drag the box while it plays, and the view follows</span>
              </div>
            </div>

            {/* the preview: the vertical short, live */}
            <div className="he-phone-col">
              <div className="he-views">
                <span data-on={!v.split || undefined}><svg viewBox="0 0 12 12"><rect x="3.5" y="1.5" width="5" height="9" rx="1.2" /></svg></span>
                <span data-on={v.split || undefined}><svg viewBox="0 0 12 12"><rect x="1.5" y="2.5" width="9" height="7" rx="1.2" /><path d="M6 2.5v7" /></svg></span>
                <span><svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1.2" /></svg></span>
              </div>
              <div className="he-phone" data-brand={v.brandOn || undefined}>
                <canvas ref={canvasRef} width={360} height={640} />
                <span className="he-island" />
                {/* the brand kit's logo (an example) */}
                <span className="he-brandlogo" data-on={v.brandOn || undefined}><i />yourbrand</span>
                <p className="he-title" data-on={v.titleOn || undefined}>{TITLE}</p>
                {v.capsOn && (
                  <p className="he-cap" data-style={v.capStyle} key={`${v.line}-${v.capStyle}`}>
                    {words.map((w, n) => (
                      <span key={w} data-shown={n < v.lit || undefined} data-now={n === v.lit - 1 || undefined}>{w}</span>
                    ))}
                  </p>
                )}
                {v.step === STEP.captions && <span className="he-style-tag">{CAP_NAMES[v.capStyle]}</span>}
                <span className="he-ready" data-on={v.exp === 'done' || undefined}>
                  <svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.5l4.5-5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Ready to post
                </span>
              </div>
            </div>
          </div>

          {/* the timeline: play controls, the ruler, and the Title · Captions · Video tracks */}
          <div className="he-tl" aria-hidden="true">
            <div className="he-ctrl">
              <span className="he-ep">Podcast · Episode 24 · 42:18</span>
              <span className="he-play">
                <svg viewBox="0 0 12 12"><path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor" /></svg>
              </span>
              <span className="he-time"><span ref={timeRef}>0:00.0</span> / 0:10.0</span>
              <span className="he-speed">1x</span>
            </div>
            <div className="he-rows">
              <div className="he-gutter">
                <span />
                <span>T</span>
                <span><svg viewBox="0 0 12 12"><rect x="1.5" y="2.5" width="9" height="7" rx="1.5" /><path d="M3.5 7h2M6.5 7h2" /></svg></span>
                <span><svg viewBox="0 0 12 12"><path d="M3.5 2.2v7.6L9.8 6z" fill="currentColor" stroke="none" /></svg></span>
              </div>
              <div className="he-lanes">
                <div className="he-ruler">
                  {/* (no times under the moment's own label) */}
                  {RULER.map((r, i) => {
                    const at = i / (RULER.length - 1)
                    return at > SEL.from - 0.03 && at < SEL.to + 0.03 ? null : <span key={r} style={{ left: `${at * 100}%` }}>{r}</span>
                  })}
                </div>
                <div className="he-lane">
                  <span className="he-chip he-chip-title" data-on={v.titleOn || undefined} style={{ left: `${SEL.from * 100}%`, width: `${(SEL.to - SEL.from) * 100}%` }}>
                    <b>T</b>{TITLE}
                  </span>
                </div>
                <div className="he-lane">
                  <span className="he-chip he-chip-cap" data-on={v.capsOn || undefined} style={{ left: `${(SEL.from + 0.01) * 100}%`, width: `${(SEL.to - SEL.from) * 0.42 * 100}%` }}>Every episode has…</span>
                  <span className="he-chip he-chip-cap" data-on={v.capsOn || undefined} style={{ left: `${(SEL.from + (SEL.to - SEL.from) * 0.52) * 100}%`, width: `${(SEL.to - SEL.from) * 0.44 * 100}%` }}>and now they all…</span>
                </div>
                <div className="he-lane he-lane-video"><div className="he-strip" /></div>
                {/* the moment, trimmed on the Video track: bright between its handles, the rest dimmed */}
                <div ref={selRef} className="he-sel" style={{ left: `${SEL.from * 100}%`, width: 0, opacity: 0 }}>
                  <div className="he-sel-win"><div ref={selImgRef} className="he-sel-img" /></div>
                  <span className="he-sel-label">Your moment · 0:10</span>
                </div>
                <div ref={headRef} className="he-head" style={{ left: `${SEL.from * 100}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </ZoomFit>
  )
}

// The editor's tool rail (the same ten tools, in the same order, as the real one)
const RAIL: { label: string; icon: React.ReactNode }[] = [
  { label: 'Frames', icon: <><rect x="3" y="2" width="10" height="12" rx="2" /><path d="M6 5h4" /></> },
  { label: 'Subjects', icon: <><circle cx="8" cy="5.5" r="2.5" /><path d="M3.5 14c.6-2.6 2.3-4 4.5-4s3.9 1.4 4.5 4" /></> },
  { label: 'Captions', icon: <><rect x="2" y="3.5" width="12" height="9" rx="2" /><path d="M5 9.5h3M9.5 9.5H11" /></> },
  { label: 'Transitions', icon: <><rect x="1.5" y="4" width="6" height="8" rx="1.5" /><rect x="8.5" y="4" width="6" height="8" rx="1.5" /></> },
  { label: 'Text', icon: <path d="M4 4h8M8 4v9" /> },
  { label: 'Media', icon: <><rect x="2.5" y="3" width="11" height="10" rx="2" /><path d="m4.5 11 2.5-3 2 2 1.5-1.5 1.5 2.5" /></> },
  { label: 'Music', icon: <><path d="M6 12V4l7-1.5v8" /><circle cx="4.5" cy="12" r="1.5" /><circle cx="11.5" cy="10.5" r="1.5" /></> },
  { label: 'Cleanup', icon: <><circle cx="4.5" cy="11.5" r="2" /><circle cx="11.5" cy="11.5" r="2" /><path d="M6 10 12 2.5M10 10 4 2.5" /></> },
  { label: 'Post', icon: <path d="M3.5 2.5h9M3.5 13.5h9M8 5v6M5.5 7.5 8 5l2.5 2.5" /> },
  { label: 'Brand kit', icon: <><path d="M2.5 8.5 8 3h5v5l-5.5 5.5z" /><circle cx="10.5" cy="5.5" r="1" /></> },
]
