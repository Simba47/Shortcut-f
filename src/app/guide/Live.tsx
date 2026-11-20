'use client'

import { useEffect, useRef } from 'react'

/**
 * Plays the demos inside only while they're on screen (data-inview; guide.css pauses the rest), and starts
 * the landing page's ClipForge (it waits for .visible on its .reveal, as on the landing page).
 */
export function Live({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        el.dataset.inview = ''
        el.querySelectorAll('.reveal:not(.visible)').forEach(r => r.classList.add('visible'))
      } else delete el.dataset.inview
    }, { rootMargin: '80px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return <div ref={ref} className={`gd-live ${className ?? ''}`}>{children}</div>
}
