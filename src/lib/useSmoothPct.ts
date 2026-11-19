'use client'

import { useEffect, useRef, useState } from 'react'

// A progress bar that counts up one percent at a time (user, 2026-11-19: "go like 1, 2, 3, 4… not 5 → 15 →
// 27"). The real value only arrives with each check of the server (every 3–8 s), so the bar used to jump.
// Now each new value is reached at the pace it came in: by the time the next check is due, the bar has
// counted up to it. It never shows more than the real value, and a value that goes down is shown at once.
// Pure parts (smoothTarget, smoothTick) are tested in useSmoothPct.test.ts.

export interface Smooth {
  /** What the bar shows (a fraction of a percent: the width moves smoothly, the number by whole percents) */
  shown: number
  /** The latest real value */
  target: number
  /** Percent per ms the bar climbs at */
  rate: number
  /** When the latest real value came (ms) */
  at: number
}

/** The shortest and longest time a step is spread over */
const MIN_SPREAD_MS = 600
const MAX_SPREAD_MS = 8000

/** A new real value: the bar climbs to it over about the time the last one took to come */
export function smoothTarget(s: Smooth | null, target: number, now: number): Smooth {
  const t = Math.max(0, Math.min(100, target))
  if (!s) return { shown: t, target: t, rate: 0, at: now }
  if (t < s.shown) return { shown: t, target: t, rate: 0, at: now }
  if (t === s.target) return s
  const spread = Math.max(MIN_SPREAD_MS, Math.min(MAX_SPREAD_MS, now - s.at))
  return { shown: s.shown, target: t, rate: (t - s.shown) / spread, at: now }
}

/** `dt` ms later */
export function smoothTick(s: Smooth, dt: number): Smooth {
  if (s.shown >= s.target || dt <= 0) return s
  return { ...s, shown: Math.min(s.target, s.shown + s.rate * dt) }
}

/** The bar's value: counts up to `target` one percent at a time */
export function useSmoothPct(target: number): number {
  const state = useRef<Smooth | null>(null)
  const [shown, setShown] = useState(() => Math.max(0, Math.min(100, target)))
  useEffect(() => {
    state.current = smoothTarget(state.current, target, performance.now())
    setShown(state.current.shown)
  }, [target])
  useEffect(() => {
    let last = performance.now()
    const id = setInterval(() => {
      const now = performance.now()
      const s = state.current
      if (s && s.shown < s.target) {
        state.current = smoothTick(s, now - last)
        setShown(Math.round(state.current.shown * 10) / 10)
      }
      last = now
    }, 100)
    return () => clearInterval(id)
  }, [])
  return shown
}
