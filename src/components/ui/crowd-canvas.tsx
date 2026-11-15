'use client'

import { useEffect, useRef } from 'react'

/**
 * A crowd of people walking past along the bottom of a section (decorative).
 *
 * Adapted from Skiper UI "Skiper 39 — Crowd Canvas" by @gurvinder-singh02 (https://gxuri.me), itself
 * inspired by https://codepen.io/zadvorsky/pen/xxwbBQV. Illustrations: Open Peeps by Pablo Stanley
 * (https://www.openpeeps.com/, CC0). Attribution to Skiper UI kept as its free licence asks.
 *
 * Changes from the original: no gsap (a small walk loop of our own), recoloured once for a dark page
 * (black lines, fills a shade lighter than the page: soft shadow figures), a soft fade at the
 * top drawn into the canvas, people holding a knife left out, and it only animates while it's on
 * screen and the tab is showing. Reduced motion: one still frame.
 */

type Peep = {
  sx: number; sy: number; w: number; h: number; x: number; y: number; dir: 1 | -1; speed: number; phase: number
  /** noticing the cursor. att 0 → 1: how interested (they slow to a stop); side: which way they face;
      turn: 0 → 1 while turning round; seen: how long the cursor has been near; delay: their own
      reaction time; lean: a slight tilt toward it */
  att: number; side: 1 | -1; turn: number; seen: number; delay: number; lean: number
}

const COLS = 15, ROWS = 7                    // the sprite sheet: 15 × 7 people
const SKIP = new Set([17, 72, 92, 100])      // cells where the person holds a knife

/** A CSS colour as [r, g, b] (reads it through a 1×1 canvas, so any CSS colour works) */
function rgb(css: string, fallback: [number, number, number]): [number, number, number] {
  const c = document.createElement('canvas'); c.width = c.height = 1
  const x = c.getContext('2d'); if (!x) return fallback
  x.fillStyle = `rgb(${fallback.join(',')})`; x.fillStyle = css.trim() || x.fillStyle
  x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data
  return [d[0], d[1], d[2]]
}

/**
 * fill: how tall a person is, as a share of the canvas height (people scale with the band).
 * react: people near the mouse stop, turn to face it and lean in; the nearest one gets a little
 * heart (desktop pointers only).
 */
export function CrowdCanvas({ src, fill = 0.58, tone = 0.16, react = false, className }: { src: string; fill?: number; tone?: number; react?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let sheet: HTMLCanvasElement | null = null
    let cellW = 0, cellH = 0, W = 0, H = 0
    let crowd: Peep[] = []
    let raf = 0, last = 0, seen = false, alive = true, scale = 0.6, prepared = ''

    const img = new Image()
    img.decoding = 'async'

    // The cursor, in canvas pixels (null when it's off the page or the device has no fine pointer)
    const canReact = react && !still && window.matchMedia('(pointer: fine)').matches
    let mouse: { x: number; y: number } | null = null
    const onPointer = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      mouse = { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr }
    }
    const onOut = (e: PointerEvent) => { if (!e.relatedTarget) mouse = null }
    // the little heart above whoever is closest
    let heart: { x: number; y: number; t: number } | null = null, heartCool = 0

    // The sheet, scaled once to the size we draw at and recoloured as soft shadow figures: lines
    // and hair → black, fills → the page colour lifted a little toward the text colour (`tone`)
    const prepare = () => {
      const key = `${scale}`
      if (key === prepared) return
      prepared = key
      const k = scale * dpr
      const sw = Math.round(img.naturalWidth * k), sh = Math.round(img.naturalHeight * k)
      const c = document.createElement('canvas'); c.width = sw; c.height = sh
      const x = c.getContext('2d', { willReadFrequently: true }); if (!x) return
      x.drawImage(img, 0, 0, sw, sh)
      const style = getComputedStyle(canvas)
      const text = rgb(style.getPropertyValue('--text'), [250, 250, 250])
      const bg = rgb(style.getPropertyValue('--bg'), [10, 10, 10])
      const [lr, lg, lb] = [0, 0, 0]
      const [fr, fg, fb] = bg.map((b, i) => b + (text[i] - b) * tone)
      const data = x.getImageData(0, 0, sw, sh), p = data.data
      for (let i = 0; i < p.length; i += 4) {
        if (!p[i + 3]) continue
        const t = (p[i] + p[i + 1] + p[i + 2]) / 765        // 0 = line, 1 = fill
        p[i] = lr + (fr - lr) * t; p[i + 1] = lg + (fg - lg) * t; p[i + 2] = lb + (fb - lb) * t
      }
      x.putImageData(data, 0, 0)
      sheet = c
      cellW = sw / COLS; cellH = sh / ROWS
    }

    // One person entering from a random side at a random depth (most low, a few higher up)
    const spawn = (cell: number, along?: number): Peep => {
      const dir: 1 | -1 = Math.random() > 0.5 ? 1 : -1
      const r = Math.random()
      const offset = (100 - 250 * r * r) * scale * dpr       // the original's power2.in spread
      const y = H - cellH + offset
      const span = W + cellW
      const x0 = dir === 1 ? -cellW : W
      return {
        sx: (cell % COLS) * cellW, sy: Math.floor(cell / COLS) * cellH, w: cellW, h: cellH,
        dir, y, x: along == null ? x0 : x0 + dir * span * along,
        speed: (span / 10) * (0.5 + Math.random()),            // crosses in ~7–20 s
        phase: Math.random() * 10,
        att: 0, side: dir, turn: 0, seen: 0, delay: 0.1 + Math.random() * 0.4, lean: 0,
      }
    }

    const layout = () => {
      if (!img.naturalWidth) return
      W = Math.round(canvas.clientWidth * dpr); H = Math.round(canvas.clientHeight * dpr)
      if (!W || !H) return
      scale = Math.round((canvas.clientHeight * fill / (img.naturalHeight / ROWS)) * 100) / 100
      prepare()
      if (!sheet) return
      canvas.width = W; canvas.height = H
      const cells = [...Array(COLS * ROWS).keys()].filter(i => !SKIP.has(i)).sort(() => Math.random() - 0.5)
      const count = Math.min(cells.length, Math.round(canvas.clientWidth / 18))
      crowd = cells.slice(0, count).map(c => spawn(c, Math.random())).sort((a, b) => a.y - b.y)
      draw(0)
    }

    const RADIUS = 240                                             // css px: how close the cursor must be
    const TURN = 0.22                                              // s: how long turning round takes
    const ease = (from: number, to: number, rate: number, dt: number) => from + (to - from) * Math.min(1, dt * rate)

    const draw = (dt: number) => {
      if (!sheet) return
      ctx.globalCompositeOperation = 'source-over'
      ctx.clearRect(0, 0, W, H)
      const bob = 10 * scale * dpr
      const R = RADIUS * dpr
      let resort = false
      let nearest: Peep | null = null, nearestD = Infinity
      for (let i = 0; i < crowd.length; i++) {
        let p = crowd[i]
        // Noticing the cursor, like people noticing something: each has their own reaction time, the
        // closest care most, and they only turn once it's clearly to one side of them
        const cx = p.x + p.w / 2, cy = p.y + p.h * 0.3
        let want = 0, look: 1 | -1 = p.side
        if (canReact && mouse) {
          const d = Math.hypot(mouse.x - cx, (mouse.y - cy) * 0.8)
          if (d < R) {
            p.seen = Math.min(p.seen + dt, 2)
            if (p.seen > p.delay) want = 1 - (d / R) ** 2
            const dx = mouse.x - cx
            if (Math.abs(dx) > p.w * 0.22) look = dx < 0 ? -1 : 1   // dead zone right over them: no flip-flopping
            if (want > 0.4 && d < nearestD) { nearestD = d; nearest = p }
          } else p.seen = Math.max(0, p.seen - dt * 2)
        } else p.seen = Math.max(0, p.seen - dt * 2)
        p.att = ease(p.att, want, want > p.att ? 3.2 : 1.6, dt)          // settle in, then lose interest slowly
        // which way they face: toward the cursor while interested, back to walking after
        const wantSide: 1 | -1 = p.att > 0.3 ? look : p.dir
        if (p.turn === 0 && wantSide !== p.side) p.turn = 0.0001          // start turning round
        if (p.turn > 0) {
          const before = p.turn
          p.turn = Math.min(1, p.turn + dt / TURN)
          if (before < 0.5 && p.turn >= 0.5) p.side = p.side === 1 ? -1 : 1   // mid-turn: now facing the other way
          if (p.turn >= 1) p.turn = 0
        }
        p.lean = ease(p.lean, p.att > 0.3 ? p.side * 0.035 * p.att : 0, 4, dt)
        // walking slows to a stop while they watch, and picks up again after
        const walk = 1 - Math.min(1, p.att * 1.4)
        p.x += p.dir * p.speed * dt * walk
        p.phase += dt * (0.25 + 0.75 * walk)
        if ((p.dir === 1 && p.x > W) || (p.dir === -1 && p.x < -p.w)) {
          // walked off: the same person comes back from a random side at a new depth
          const cell = Math.round(p.sy / cellH) * COLS + Math.round(p.sx / cellW)
          p = crowd[i] = spawn(cell)
          resort = true
        }
        // a step bounce while walking; standing, just a gentle breath
        const stepping = bob * Math.abs(Math.sin(p.phase * Math.PI * 2)) * walk
        const breath = bob * 0.18 * (1 - walk) * (0.5 + 0.5 * Math.sin(p.phase * Math.PI * 1.3))
        const y = p.y - stepping - breath
        // turning round: the body narrows a little as it swings (never paper-thin)
        const sx = p.side * (1 - 0.22 * Math.sin(p.turn * Math.PI))
        ctx.save()
        ctx.translate(p.x + p.w / 2, y + p.h)
        ctx.rotate(p.lean)
        ctx.scale(sx, 1)
        ctx.drawImage(sheet, p.sx, p.sy, p.w, p.h, -p.w / 2, -p.h, p.w, p.h)
        ctx.restore()
      }
      // now and then the one closest to the cursor shows a little heart
      heartCool = Math.max(0, heartCool - dt)
      if (nearest && heartCool <= 0 && nearest.att > 0.75 && nearest.turn === 0) {
        heart = { x: nearest.x + nearest.w / 2, y: nearest.y + nearest.h * 0.04, t: 0 }
        heartCool = 3.2
      }
      if (resort) crowd.sort((a, b) => a.y - b.y)   // back to front again
      // fade the top into the page (never hard behind the text above) and the bottom edge too, so
      // the crowd dissolves before the section ends instead of being cut by the footer
      ctx.globalCompositeOperation = 'destination-in'
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.42, 'rgba(0,0,0,1)')
      g.addColorStop(0.78, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
      if (heart) {
        heart.t += dt
        const k = heart.t / 1.1
        if (k >= 1) heart = null
        else {
          ctx.globalCompositeOperation = 'source-over'
          const s = (14 + 6 * Math.min(1, k * 4)) * dpr
          ctx.save()
          ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85
          ctx.translate(heart.x, heart.y - 40 * dpr * k)
          ctx.scale(s / 24, s / 24)
          ctx.fillStyle = '#c8ff00'
          ctx.fill(new Path2D('M0 8 C-9 1 -12 -5 -8 -9 C-5 -12 -1 -10 0 -7 C1 -10 5 -12 8 -9 C12 -5 9 1 0 8 Z'))
          ctx.restore()
        }
      }
    }

    const tick = (now: number) => {
      raf = 0
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0
      last = now
      draw(dt)
      run()
    }
    // Animates only while on screen and the tab is showing
    const run = () => {
      if (still || !alive) return
      if (seen && !document.hidden) { if (!raf) raf = requestAnimationFrame(tick) }
      else { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0 }
    }

    const io = new IntersectionObserver(([e]) => { seen = e.isIntersecting; run() })
    img.onload = () => { if (!alive) return; layout(); io.observe(canvas) }
    // The drawing (~380 KB) downloads only once the visitor scrolls near the section
    const near = new IntersectionObserver(([e]) => { if (e.isIntersecting) { near.disconnect(); img.src = src } }, { rootMargin: '800px 0px' })
    near.observe(canvas)
    let rt = 0
    const onResize = () => { clearTimeout(rt); rt = window.setTimeout(layout, 150) }
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', run)
    if (canReact) {
      window.addEventListener('pointermove', onPointer, { passive: true })
      document.addEventListener('pointerout', onOut)
    }
    return () => {
      window.removeEventListener('pointermove', onPointer)
      document.removeEventListener('pointerout', onOut)
      alive = false
      io.disconnect(); near.disconnect(); cancelAnimationFrame(raf); clearTimeout(rt)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', run)
    }
  }, [src, fill, tone, react])

  return <canvas ref={ref} className={className} aria-hidden="true" />
}
