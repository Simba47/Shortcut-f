'use client'

import { useEffect, useRef } from 'react'

/**
 * The foot of the landing page: SHORTCUT, with a small crew of editing tools living on it
 * (styles: .fc-* in app/landing.css). Two SVG layers over one 1840 × 470 space:
 *
 *   back   a fine film strip, and the word in the section headings' style (heavy, tight, white
 *          fading to grey). Every few seconds a soft light sweeps across it.
 *          Pointing at a letter plays its own move (S splits like the logo, H jumps, O pulses, R kicks,
 *          T gets cut, C claps, U catches, the last T stamps).
 *   front  five line-drawn characters, each in a different kind of spot: a phone on the ground
 *          leaning on the S, a camera on a tripod over the H, a clapperboard sitting in the O's hole,
 *          a mic standing in the U's cup talking in captions, scissors on the ground snipping the strip.
 *          They blink, idle, follow the mouse with their eyes, and react when pointed at.
 *
 * Scrolling in: the letters rise out of the film strip one by one, then the crew pops on. Calm
 * white line art; lime only on the camera's REC light and the spoken caption word.
 * Runs only on screen (no SVG filters: they cost 100+ ms a frame here). Reduced motion: still.
 * Desktop only (phones keep the old footer).
 */

const LETTERS = 'SHORTCUT'.split('')
// each letter's own hover (and the C's clap): split · jump · pulse · kick · cut · clap · catch · stamp
const KEYS = ['s', 'h', 'o', 'r', 't', 'c', 'u', 't2']
// each letter's move has a word starting with that letter, shown under the strip while it plays
const MOVES = ['Split', 'Hop', 'On air', 'Rock', 'Trim', 'Clap', 'Upload', 'Ta-da!']
// before the font is measured: rough positions; layout() then places each letter by its real width
const X0 = 330, STEP = 168, BASE = 404, MID = 920, TOP = BASE - 182
const SPACING = -0.025                                  // em, like the section headings
const SPROCKETS = Array.from({ length: 60 }, (_, i) => 24 + i * 30)
const SWEEP = 9                                         // s: one light sweep + rest

/** An eye: a pupil that blinks and follows the mouse */
const Eye = ({ x, y, r = 3.8, d = 0 }: { x: number; y: number; r?: number; d?: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <g className="fc-eye" style={{ '--d': `${d}s` } as React.CSSProperties}><circle className="fc-pupil" r={r} /></g>
  </g>
)

/** A crew member standing on a letter: placed by layout(), pops on, then lives */
function OnLetter({ at, dx = 0, y, k, children }: { at: number | 'start' | 'end'; dx?: number; y: number; k: number; children: React.ReactNode }) {
  const x = typeof at === 'number' ? X0 + at * STEP + dx : at === 'start' ? X0 - 90 + dx : X0 + 7 * STEP + 90 + dx
  return (
    <g data-at={at} data-dx={dx} data-y={y} transform={`translate(${x} ${y})`}>
      <g className="fc-pop" style={{ '--k': k } as React.CSSProperties}>{children}</g>
    </g>
  )
}

export function FooterWordmark() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    const back = el?.querySelector<SVGSVGElement>('.fc-back')
    const front = el?.querySelector<SVGSVGElement>('.fc-front')
    if (!el || !back || !front) return

    const boxes: [number, number][] = []
    // Letters at their real widths, tightly spaced and centred; the crew to its letters. Runs again
    // once the font is in (measuring the fallback font put letters on top of each other)
    const layout = () => {
      const groups = [...back.querySelectorAll<SVGGElement>('.fc-letter')]
      const first = groups[0]?.querySelector<SVGTextElement>('.fc-txt')
      if (!first) return
      const size = parseFloat(getComputedStyle(first).fontSize) || 250
      const gap = SPACING * size
      const adv = groups.map(g => g.querySelector<SVGTextElement>('.fc-txt')!.getComputedTextLength())
      const total = adv.reduce((a, b) => a + b, 0) + gap * (adv.length - 1)
      let x = MID - total / 2
      const start = x, centres: number[] = []
      boxes.length = 0
      groups.forEach((g, i) => {
        g.querySelectorAll('text').forEach(t => t.setAttribute('x', x.toFixed(1)))
        boxes.push([x, adv[i]]); centres.push(x + adv[i] / 2); x += adv[i] + gap
      })
      back.querySelectorAll<SVGTextElement>('.fc-move').forEach((t, i) => t.setAttribute('x', centres[i].toFixed(1)))
      el.querySelectorAll<SVGGElement>('[data-at]').forEach(g => {
        const at = g.dataset.at!, dx = Number(g.dataset.dx), y = g.dataset.y
        const base = at === 'start' ? start : at === 'end' ? start + total : centres[Number(at)]
        g.setAttribute('transform', `translate(${(base + dx).toFixed(1)} ${y})`)
      })
    }
    layout()
    document.fonts?.ready.then(layout)
    document.fonts?.addEventListener?.('loadingdone', layout)
    const late = window.setTimeout(layout, 1200)

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still) { el.classList.add('in'); back.pauseAnimations(); return () => { clearTimeout(late); document.fonts?.removeEventListener?.('loadingdone', layout) } }

    // in: the entrance plays (once) · on: everything moves only while it can be seen
    back.pauseAnimations()
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { layout(); el.classList.add('in') }
      el.classList.toggle('on', e.isIntersecting)
      if (e.isIntersecting) back.unpauseAnimations(); else back.pauseAnimations()
    }, { threshold: 0.2 })
    io.observe(el)

    // Each letter has its own move (class .play, cleared when it ends) with its word under the strip.
    // They take turns on their own, S to T; pointing at a letter plays it straight away.
    const letterEls = [...back.querySelectorAll<SVGGElement>('.fc-letter')]
    const moveEls = [...back.querySelectorAll<SVGTextElement>('.fc-move')]
    const lettersG = back.querySelector<SVGGElement>('.fc-letters')
    let current = -1
    const play = (i: number) => {
      const g = letterEls[i]
      if (!g || g.classList.contains('play')) return
      g.classList.add('play')
      // whoever stands on (or in) that letter rides along with its move
      el.querySelectorAll(`[data-at="${i}"]`).forEach(r => r.classList.add(`ride-${KEYS[i]}`))
      const w = moveEls[i]
      if (w) { w.classList.remove('on'); void w.getBBox(); w.classList.add('on') }
    }
    const onOver = (e: Event) => {
      if (!el.classList.contains('in')) return
      const g = (e.target as Element).closest<SVGGElement>('.fc-letter')
      const i = g ? letterEls.indexOf(g) : -1
      if (i < 0 || i === current) return
      current = i
      play(i)
    }
    const onLeave = () => { current = -1 }
    // the turns: a letter every 1.7 s, a rest after the last T; waits while off screen or pointed at
    let turn = 0, timer = 0
    const next = () => {
      const ready = el.classList.contains('on') && el.classList.contains('in') && current < 0
      if (ready) { play(turn); turn = (turn + 1) % letterEls.length }
      timer = window.setTimeout(next, ready && turn === 0 ? 4200 : 1700)
    }
    timer = window.setTimeout(next, 3200)
    const onEnd = (e: AnimationEvent) => {
      if (e.animationName.startsWith('fc-r-')) { (e.target as Element).classList.remove(...KEYS.map(k => `ride-${k}`)); return }
      if (!e.animationName.startsWith('fc-h-')) return
      (e.target as Element).closest('.fc-letter')?.classList.remove('play')
    }
    front.addEventListener('animationend', onEnd as EventListener)
    lettersG?.addEventListener('pointerover', onOver)
    lettersG?.addEventListener('pointerleave', onLeave)
    lettersG?.addEventListener('animationend', onEnd as EventListener)

    // eyes follow the mouse
    const pupils = [...front.querySelectorAll<SVGElement>('.fc-pupil')]
    let mx = 0, my = 0, raf = 0
    const look = () => {
      raf = 0
      for (const p of pupils) {
        const r = p.parentElement!.getBoundingClientRect()
        const dx = mx - (r.left + r.width / 2), dy = my - (r.top + r.height / 2)
        const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 240) * 2.8
        p.style.transform = `translate(${(dx / d) * k}px, ${(dy / d) * k}px)`
      }
    }
    const onMove = (e: PointerEvent) => {
      if (!el.classList.contains('on')) return
      mx = e.clientX; my = e.clientY
      if (!raf) raf = requestAnimationFrame(look)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      io.disconnect(); clearTimeout(late); clearTimeout(timer); cancelAnimationFrame(raf)
      lettersG?.removeEventListener('pointerover', onOver); lettersG?.removeEventListener('pointerleave', onLeave)
      lettersG?.removeEventListener('animationend', onEnd as EventListener); front.removeEventListener('animationend', onEnd as EventListener)
      window.removeEventListener('pointermove', onMove)
      document.fonts?.removeEventListener?.('loadingdone', layout)
    }
  }, [])

  const sweep = { values: '-420 0;2160 0;2160 0', keyTimes: '0;0.17;1', dur: `${SWEEP}s`, begin: '2.3s', repeatCount: 'indefinite', calcMode: 'spline', keySplines: '.45 0 .25 1;0 0 1 1' }

  return (
    <div ref={ref} className="fc" role="img" aria-label="Shortcut">
      <div className="fc-stage">
        {/* ── back: the strip and the word ── */}
        <svg className="fc-back" viewBox="0 0 1840 470" aria-hidden="true">
          <defs>
            <linearGradient id="fc-title" gradientUnits="userSpaceOnUse" x1="0" y1={TOP - 4} x2="0" y2={BASE}>
              <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#6b7280" />
            </linearGradient>
            {/* a soft light sweeping across the word now and then */}
            <linearGradient id="fc-sheen" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="300" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity="1" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
              <animateTransform attributeName="gradientTransform" type="translate" {...sweep} />
            </linearGradient>
            {/* letters rise out of the strip: nothing shows below the baseline */}
            <clipPath id="fc-rise"><rect x="0" y="0" width="1840" height={BASE + 4} /></clipPath>
            {/* each letter's top and bottom half (the halves overlap a hair, so no seam shows) */}
            <clipPath id="fc-ctop" clipPathUnits="objectBoundingBox"><rect x="-.3" y="-.3" width="1.6" height=".805" /></clipPath>
            <clipPath id="fc-cbot" clipPathUnits="objectBoundingBox"><rect x="-.3" y=".495" width="1.6" height=".8" /></clipPath>
            {/* the C's clap: clapperboard stripes on its top half, and a thin band along the seam */}
            <pattern id="fc-clapstripe" width="46" height="46" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)">
              <rect width="23" height="46" fill="#0a0a0a" />
            </pattern>
            <clipPath id="fc-cband" clipPathUnits="objectBoundingBox"><rect x="-.3" y=".475" width="1.6" height=".05" /></clipPath>
          </defs>

          <g className="fc-ground">
            <path className="fc-strip" d={`M10 ${BASE + 10} H1830`} />
            <path className="fc-strip fc-strip-2" d={`M10 ${BASE + 34} H1830`} />
            {SPROCKETS.map((x, i) => <rect key={x} className="fc-hole" x={x} y={BASE + 17} width={11} height={10} rx={3} style={{ '--k': i } as React.CSSProperties} />)}
          </g>

          <g className="fc-letters" clipPath="url(#fc-rise)">
            {LETTERS.map((ch, i) => (
              <g key={i} className={`fc-letter fc-l-${KEYS[i]}`} style={{ '--i': i } as React.CSSProperties}>
                <g className="fc-a">
                  <g className="fc-top">
                    <text className="fc-txt" clipPath="url(#fc-ctop)" x={X0 + i * STEP - 80} y={BASE}>{ch}</text>
                    <text className="fc-txt fc-shine" clipPath="url(#fc-ctop)" x={X0 + i * STEP - 80} y={BASE}>{ch}</text>
                    {KEYS[i] === 'c' && <text className="fc-txt fc-stripes" clipPath="url(#fc-ctop)" x={X0 + i * STEP - 80} y={BASE}>{ch}</text>}
                  </g>
                  <g className="fc-bot">
                    <text className="fc-txt" clipPath="url(#fc-cbot)" x={X0 + i * STEP - 80} y={BASE}>{ch}</text>
                    <text className="fc-txt fc-shine" clipPath="url(#fc-cbot)" x={X0 + i * STEP - 80} y={BASE}>{ch}</text>
                  </g>
                  {KEYS[i] === 'c' && <text className="fc-txt fc-seam" clipPath="url(#fc-cband)" x={X0 + i * STEP - 80} y={BASE}>{ch}</text>}
                </g>
              </g>
            ))}
          </g>

          {/* each letter's move, named under the strip while it plays */}
          <g className="fc-moves">
            {MOVES.map((m, i) => <text key={m} className="fc-move" x={X0 + i * STEP} y={BASE + 64}>{m}</text>)}
          </g>
        </svg>

        {/* ── front: the crew ── */}
        <svg className="fc-front" viewBox="0 0 1840 470" aria-hidden="true">

          {/* Camera on a tripod, its legs on the H's two stems: its lens is an eye */}
          <OnLetter at={1} y={TOP} k={1}>
            <g className="fc-crew fc-camera">
              <path className="fc-st" d="M0 -36 L-58 2 M0 -36 L58 2 M0 -36 V-4" />
              <g className="fc-cam">
                <rect className="fc-ln" x="-40" y="-84" width="80" height="50" rx="11" />
                <path className="fc-ln" d="M-26 -84 V-92 Q-26 -96 -22 -96 H-4 Q0 -96 0 -92 V-84" />
                <circle className="fc-ln" cx="8" cy="-59" r="18" />
                <circle className="fc-thin" cx="8" cy="-59" r="10" />
                <Eye x={8} y={-59} r={4} d={1.1} />
                <circle className="fc-rec" cx="-27" cy="-72" r="4" />
                <circle className="fc-flash" cx="8" cy="-59" r="10" />
              </g>
            </g>
          </OnLetter>

          {/* Phone (9:16) on the ground beside the S, leaning on it */}
          <OnLetter at="start" dx={-62} y={BASE + 10} k={0}>
            <g className="fc-crew fc-phone">
              <path className="fc-st" d="M-10 -1 V-16 M10 -1 V-16" />
              <g className="fc-bob">
                <path className="fc-st" d="M-25 -64 Q-40 -55 -37 -42" />
                <g className="fc-hi"><path className="fc-st" d="M25 -64 Q40 -74 44 -90" /></g>
                <rect className="fc-ln" x="-25" y="-108" width="50" height="92" rx="12" />
                <rect className="fc-screen" x="-19" y="-99" width="38" height="68" rx="6" />
                <Eye x={-7} y={-74} r={3.2} d={2} /><Eye x={7} y={-74} r={3.2} d={2} />
                <path className="fc-thin" d="M-6 -60 Q0 -55 6 -60" />
                <g className="fc-playscreen">
                  <rect className="fc-screen-on" x="-19" y="-99" width="38" height="68" rx="6" />
                  <path className="fc-w" d="M-5 -73 L9 -65 L-5 -57 Z" />
                </g>
                <rect className="fc-w fc-pill" x="-7" y="-23" width="14" height="2.6" rx="1.3" />
              </g>
            </g>
          </OnLetter>

          {/* Clapperboard sitting inside the O's hole: claps; point at it and it calls ACTION! */}
          <OnLetter at={2} y={BASE - 52} k={2}>
            <g className="fc-crew fc-clapper" transform="scale(.8)">
              <path className="fc-st" d="M-13 -1 V-14 M13 -1 V-14" />
              <rect className="fc-ln" x="-38" y="-64" width="76" height="50" rx="7" />
              <path className="fc-stripe" d="M-30 -64 L-23 -54 M-13 -64 L-6 -54 M4 -64 L11 -54 M21 -64 L28 -54" />
              <path className="fc-thin" d="M-38 -54 H38" />
              <Eye x={-12} y={-37} r={3.6} d={0.7} /><Eye x={12} y={-37} r={3.6} d={0.7} />
              <path className="fc-thin" d="M-5 -26 Q0 -22 5 -26" />
              <g className="fc-clap">
                <rect className="fc-ln" x="-38" y="-78" width="76" height="13" rx="3" />
                <path className="fc-stripe" d="M-29 -78 L-22 -65 M-12 -78 L-5 -65 M5 -78 L12 -65 M22 -78 L29 -65" />
              </g>
              <text className="fc-shout" x="0" y="-94">ACTION!</text>
            </g>
          </OnLetter>

          {/* Scissors on the ground after the last T, snipping at the film strip */}
          <OnLetter at="end" dx={66} y={BASE + 10} k={3}>
            <g className="fc-crew fc-scissors">
              <g className="fc-blade fc-blade-l"><path className="fc-ln" d="M-2 -46 L-21 -3 L-12 -1 L4 -43 Z" /></g>
              <g className="fc-blade fc-blade-r"><path className="fc-ln" d="M2 -46 L21 -3 L12 -1 L-4 -43 Z" /></g>
              <path className="fc-st" d="M-3 -48 L-10 -58 M3 -48 L10 -58" />
              <ellipse className="fc-ln" cx="-15" cy="-74" rx="13" ry="16" /><ellipse className="fc-ln" cx="15" cy="-74" rx="13" ry="16" />
              <Eye x={-15} y={-74} r={4.4} d={1.6} /><Eye x={15} y={-74} r={4.4} d={1.6} />
              <circle className="fc-w" cx="0" cy="-46" r="3.2" />
            </g>
          </OnLetter>

          {/* Mic standing in the U's cup, its head peeking over the rim, talking in captions */}
          <OnLetter at={6} y={BASE - 54} k={4}>
            <g className="fc-crew fc-micbox">
              <ellipse className="fc-ln" cx="0" cy="-4" rx="21" ry="5" />
              <path className="fc-st" d="M0 -6 V-36" />
              <g className="fc-mic">
                <rect className="fc-ln" x="-9" y="-74" width="18" height="40" rx="8" />
                <circle className="fc-ln" cx="0" cy="-90" r="21" />
                <path className="fc-thin fc-grille" d="M-17 -99 H17 M-20 -90 H20 M-17 -81 H17" />
                <Eye x={-8} y={-93} r={3.2} d={2.4} /><Eye x={8} y={-93} r={3.2} d={2.4} />
                <ellipse className="fc-mouth" cx="0" cy="-80" rx="4.4" ry="3.4" />
              </g>
            </g>
          </OnLetter>
          {/* its caption bubble: a small rounded pill above the U, its tail down to the mic */}
          <OnLetter at={6} dx={74} y={TOP - 64} k={4.6}>
            <g className="fc-bubble">
              <path className="fc-ln" d="M-96 -18 H96 A18 18 0 0 1 96 18 H-56 L-76 40 L-72 18 H-96 A18 18 0 0 1 -96 -18 Z" />
              <text className="fc-say" style={{ '--d': '0s' } as React.CSSProperties} x="0" y="5">wait for <tspan className="fc-limetext">it…</tspan></text>
              <text className="fc-say" style={{ '--d': '3s' } as React.CSSProperties} x="0" y="5">this <tspan className="fc-limetext">changed</tspan> everything</text>
              <text className="fc-say" style={{ '--d': '6s' } as React.CSSProperties} x="0" y="5">here’s the <tspan className="fc-limetext">truth</tspan></text>
            </g>
          </OnLetter>

          {/* two soft sparkles at the ends */}
          <OnLetter at={0} dx={-30} y={TOP - 46} k={5}>
            <path className="fc-star" style={{ '--d': '0s' } as React.CSSProperties} d="M0 -10 L2.3 -2.3 L10 0 L2.3 2.3 L0 10 L-2.3 2.3 L-10 0 L-2.3 -2.3 Z" />
          </OnLetter>
          <OnLetter at={4} dx={10} y={TOP - 54} k={5}>
            <path className="fc-star" style={{ '--d': '1.3s' } as React.CSSProperties} d="M0 -8 L1.8 -1.8 L8 0 L1.8 1.8 L0 8 L-1.8 1.8 L-8 0 L-1.8 -1.8 Z" />
          </OnLetter>
        </svg>
      </div>
    </div>
  )
}
