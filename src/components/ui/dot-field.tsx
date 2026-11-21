'use client'

import { useEffect, useRef } from 'react'

type Props = {
  /** Element whose pointer movement drives the field (the canvas itself ignores pointer events) */
  hostRef: React.RefObject<HTMLElement | null>
  spacing?: number
  radius?: number
  /** Quiet white instead of the brand colour, and fainter (the hero: lime is kept for its words) */
  mono?: boolean
}

type Ripple = { x: number; y: number; t0: number }

const IDLE_ALPHA = 0.07
const PUSH = 18            // max px a dot is pushed away from the cursor
const RIPPLE_SPEED = 0.9   // px per ms
const RIPPLE_LIFE = 1200   // ms
const RIPPLE_BAND = 44     // px width of the shockwave ring
const RIPPLE_PUSH = 14

/**
 * Interactive dot field: dots near the cursor light up in the brand colour and
 * bend away like a lens; clicking sends a shockwave through the field.
 * Draws on a single canvas and stops its animation loop whenever everything is at rest.
 */
export function DotField({ hostRef, spacing = 28, radius = 160, mono = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !host || !ctx) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches

    let w = 0, h = 0, n = 0
    let bx = new Float32Array(0), by = new Float32Array(0)
    let ox = new Float32Array(0), oy = new Float32Array(0)
    let dotColor = '#fff', accent = '#C8FF00'
    const pointer = { x: 0, y: 0, sx: 0, sy: 0, active: false, glow: 0 }
    const ripples: Ripple[] = []
    let raf = 0

    const readColors = () => {
      const s = getComputedStyle(host)
      dotColor = s.getPropertyValue('--text').trim() || dotColor
      accent = mono ? dotColor : s.getPropertyValue('--logo').trim() || accent
    }

    const resize = () => {
      const r = host.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = r.width; h = r.height
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const cols = Math.ceil(w / spacing) + 1
      const rows = Math.ceil(h / spacing) + 1
      const offX = (w - (cols - 1) * spacing) / 2
      const offY = (h - (rows - 1) * spacing) / 2
      n = cols * rows
      bx = new Float32Array(n); by = new Float32Array(n)
      ox = new Float32Array(n); oy = new Float32Array(n)
      for (let r = 0, i = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++, i++) {
          bx[i] = offX + c * spacing
          by[i] = offY + r * spacing
        }
      }
      draw(performance.now())
    }

    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, h)

      // Ease the pointer and its glow so everything trails smoothly
      pointer.sx += (pointer.x - pointer.sx) * 0.2
      pointer.sy += (pointer.y - pointer.sy) * 0.2
      pointer.glow += ((pointer.active ? 1 : 0) - pointer.glow) * 0.08

      // Soft brand-colour glow under the cursor
      if (pointer.glow > 0.01) {
        const g = ctx.createRadialGradient(pointer.sx, pointer.sy, 0, pointer.sx, pointer.sy, radius * 1.6)
        g.addColorStop(0, accent)
        g.addColorStop(1, 'transparent')
        ctx.globalAlpha = (mono ? 0.035 : 0.09) * pointer.glow
        ctx.fillStyle = g
        ctx.fillRect(pointer.sx - radius * 1.6, pointer.sy - radius * 1.6, radius * 3.2, radius * 3.2)
      }

      for (let k = ripples.length - 1; k >= 0; k--) {
        if (now - ripples[k].t0 > RIPPLE_LIFE) ripples.splice(k, 1)
      }

      // Idle dots go into one batched path; lit dots are drawn individually afterwards
      const lit: number[] = []
      const litF: number[] = []
      let moving = false

      ctx.globalAlpha = IDLE_ALPHA
      ctx.fillStyle = dotColor
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        let tx = 0, ty = 0, f = 0

        if (pointer.glow > 0.01) {
          const dx = bx[i] - pointer.sx, dy = by[i] - pointer.sy
          const d = Math.hypot(dx, dy)
          if (d < radius && d > 0.001) {
            const force = (1 - d / radius) ** 2 * pointer.glow
            tx += (dx / d) * force * PUSH
            ty += (dy / d) * force * PUSH
            f = force
          }
        }

        for (const rp of ripples) {
          const age = now - rp.t0
          const ringR = age * RIPPLE_SPEED
          const dx = bx[i] - rp.x, dy = by[i] - rp.y
          const d = Math.hypot(dx, dy)
          const band = 1 - Math.abs(d - ringR) / RIPPLE_BAND
          if (band > 0 && d > 0.001) {
            const strength = band * (1 - age / RIPPLE_LIFE)
            tx += (dx / d) * strength * RIPPLE_PUSH
            ty += (dy / d) * strength * RIPPLE_PUSH
            f = Math.max(f, strength)
          }
        }

        ox[i] += (tx - ox[i]) * 0.18
        oy[i] += (ty - oy[i]) * 0.18
        if (Math.abs(ox[i]) > 0.05 || Math.abs(oy[i]) > 0.05) moving = true

        if (f > 0.02) {
          lit.push(i); litF.push(f)
        } else {
          ctx.rect(bx[i] + ox[i] - 0.75, by[i] + oy[i] - 0.75, 1.5, 1.5)
        }
      }
      ctx.fill()

      ctx.fillStyle = accent
      for (let j = 0; j < lit.length; j++) {
        const i = lit[j], f = litF[j]
        ctx.globalAlpha = mono ? Math.min(0.42, 0.1 + f * 0.4) : Math.min(1, 0.15 + f * 0.95)
        ctx.beginPath()
        ctx.arc(bx[i] + ox[i], by[i] + oy[i], 0.8 + f * 1.9, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      const settling = pointer.active || ripples.length > 0 || moving || pointer.glow > 0.01
      raf = settling ? requestAnimationFrame(draw) : 0
    }

    const wake = () => { if (!raf) raf = requestAnimationFrame(draw) }

    const local = (e: PointerEvent) => {
      const r = host.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const p = local(e)
      if (!pointer.active) { pointer.sx = p.x; pointer.sy = p.y }
      pointer.x = p.x; pointer.y = p.y; pointer.active = true
      wake()
    }
    const onLeave = () => { pointer.active = false; wake() }
    const onDown = (e: PointerEvent) => {
      const p = local(e)
      ripples.push({ x: p.x, y: p.y, t0: performance.now() })
      if (ripples.length > 4) ripples.shift()
      wake()
    }

    readColors()
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    const mo = new MutationObserver(() => { readColors(); wake() })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    if (!reduceMotion) {
      if (finePointer) {
        host.addEventListener('pointermove', onMove)
        host.addEventListener('pointerleave', onLeave)
      }
      host.addEventListener('pointerdown', onDown)
    }

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
      host.removeEventListener('pointerdown', onDown)
    }
  }, [hostRef, spacing, radius, mono])

  return <canvas ref={canvasRef} className="block" aria-hidden />
}
