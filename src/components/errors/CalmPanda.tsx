'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The error pages' calm panda (user, 2026-11-28: no gags where something went wrong): it just stands, breathing
 * (the sign-in panda's idle clip; phones get the lighter phone clip). Reduced motion or data saver: the still.
 * `look` (the expired restore link, wide windows, where the message sits on its right): first it tilts its head
 * and looks down at the message, blinks, looks back (Kling 5146; both ends on the standing pose, so it meets
 * the idle loop with no jump), then breathes. Used by "Something went wrong" (app/error.tsx) and the expired
 * restore link. Styles: .nf-stage in not-found.css.
 */
export function CalmPanda({ small = false, look = false }: { small?: boolean; look?: boolean }) {
  const [still, setStill] = useState(false)
  const idleRef = useRef<HTMLVideoElement>(null)
  const lookRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
    if (reduced || saveData) { setStill(true); return }
    const idle = idleRef.current, first = lookRef.current
    if (!idle) return
    const phone = window.matchMedia('(max-width: 899px)').matches
    let alive = true
    const timers: number[] = []
    const breathe = () => { idle.play().then(() => idle.setAttribute('data-on', '')).catch(() => {}) }
    idle.src = phone ? '/auth/panda/m/idle.mp4' : '/auth/panda/idle.mp4'

    // the look first (wide windows only: on phones the message is under it, not on its right)
    if (look && !phone && first) {
      first.src = '/errors/look.mp4'
      const begin = () => timers.push(window.setTimeout(() => {
        if (!alive) return
        first.play().then(() => first.setAttribute('data-on', '')).catch(() => breathe())
      }, 700))
      // the loop goes on top at once; the look stays under it on its last frame (the same pose) until the loop
      // has surely painted, so nothing behind can flash through
      first.addEventListener('ended', () => {
        idle.currentTime = 0
        breathe()
        idle.addEventListener('playing', () => timers.push(window.setTimeout(() => first.removeAttribute('data-on'), 600)), { once: true })
      }, { once: true })
      first.addEventListener('loadeddata', begin, { once: true })
    } else {
      idle.addEventListener('loadeddata', breathe, { once: true })
    }

    const back = () => {
      if (document.hidden) return
      for (const v of [first, idle]) if (v && v.hasAttribute('data-on') && v.paused && !v.ended) v.play().catch(() => {})
    }
    document.addEventListener('visibilitychange', back)
    return () => { alive = false; timers.forEach(clearTimeout); document.removeEventListener('visibilitychange', back) }
  }, [look])

  return (
    <div className={`nf-stage${small ? ' nf-stage-sm' : ''}`} aria-hidden="true">
      <span className="nf-film">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/auth/panda/poster.webp" alt="" />
        {!still && look && <video ref={lookRef} muted playsInline preload="auto" />}
        {!still && <video ref={idleRef} muted playsInline loop preload="auto" />}
      </span>
      <span className="nf-floor" />
    </div>
  )
}
