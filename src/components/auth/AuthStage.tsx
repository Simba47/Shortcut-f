'use client'

import { useEffect, useRef } from 'react'

/**
 * The sign-in pages as a live show (styles: .as-* in app/auth.css; desktop only). The crowd along the
 * bottom (CrowdCanvas) is the audience; the card is the stage:
 *   - two soft white stage spotlights sway down from the top corners
 *   - live reactions float up the left and right sides, like a stream's: hearts, likes, play icons,
 *     comments, sparkles and view counters (line icons, lime only on a couple of hearts)
 *   - sending the form (sign in, create account, a code) sets off a short burst of them
 * Transforms and opacity only; nothing behind the card. Reduced motion: the lights stand still and
 * no reactions float.
 */

type Kind = 'heart' | 'like' | 'play' | 'chat' | 'spark' | 'views' | 'plays'
// side, distance from the page edge (vw), kind, delay (s), duration (s), size, lime
const R: [('l' | 'r'), number, Kind, number, number, number, boolean?][] = [
  ['l', 6, 'heart', 0, 9, 1, true], ['l', 17, 'views', 2.4, 11, 1], ['l', 10, 'play', 4.6, 10, .9], ['l', 22, 'spark', 1.2, 8, .8],
  ['l', 4, 'chat', 6.8, 10.5, .9], ['l', 15, 'like', 8.4, 9.5, 1], ['l', 25, 'heart', 3.6, 10, .8],
  ['r', 7, 'like', 1.8, 10, 1], ['r', 18, 'heart', 0.6, 9, .9], ['r', 11, 'plays', 3.9, 11.5, 1], ['r', 23, 'spark', 5.6, 8, .8],
  ['r', 5, 'heart', 7.2, 9.5, 1, true], ['r', 15, 'chat', 9, 10.5, .9], ['r', 26, 'play', 2.8, 10, .8],
]
// the burst when the form is sent
const BURST: [('l' | 'r'), number, Kind, number][] = [
  ['l', 8, 'heart', 0], ['l', 16, 'like', .12], ['l', 24, 'heart', .24], ['l', 12, 'spark', .36],
  ['r', 9, 'heart', .06], ['r', 17, 'like', .18], ['r', 25, 'heart', .3], ['r', 13, 'spark', .42],
]

function Icon({ kind }: { kind: Kind }) {
  switch (kind) {
    case 'heart': return <svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
    case 'like': return <svg viewBox="0 0 24 24"><path d="M7 11v9H4v-9h3zm0 0l4-7c1.6 0 2.4 1 2 2.6L12.5 10H18a2 2 0 0 1 2 2.3l-1.1 5.6A2.5 2.5 0 0 1 16.4 20H7" /></svg>
    case 'play': return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M10 8.5l5.5 3.5-5.5 3.5z" /></svg>
    case 'chat': return <svg viewBox="0 0 24 24"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /><path d="M8 10h8M8 13h5" /></svg>
    case 'spark': return <svg viewBox="0 0 24 24"><path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" /></svg>
    case 'views': return <span className="as-chip"><svg viewBox="0 0 24 24"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.6" /></svg>+1.2K</span>
    case 'plays': return <span className="as-chip"><svg viewBox="0 0 24 24"><path d="M8 6l10 6-10 6z" /></svg>12K</span>
  }
}

export function AuthStage() {
  const ref = useRef<HTMLDivElement>(null)

  // sending the form sets off a burst (restarts if sent again)
  useEffect(() => {
    const el = ref.current
    const root = el?.closest('.auth-root')
    if (!el || !root) return
    let t = 0
    const onSubmit = () => {
      el.classList.remove('burst'); void el.offsetWidth; el.classList.add('burst')
      clearTimeout(t); t = window.setTimeout(() => el.classList.remove('burst'), 2600)
    }
    root.addEventListener('submit', onSubmit, true)
    return () => { root.removeEventListener('submit', onSubmit, true); clearTimeout(t) }
  }, [])

  return (
    <div ref={ref} className="as-stage" aria-hidden="true">
      <span className="as-beam as-beam-l" />
      <span className="as-beam as-beam-r" />
      {R.map(([side, x, kind, d, dur, s, lime], i) => (
        <span key={i} className={`as-rx as-s${side}${lime ? ' as-lime' : ''}`}
          style={{ '--x': `${x}vw`, '--d': `${d}s`, '--dur': `${dur}s`, '--s': s } as React.CSSProperties}>
          <span className="as-sway" style={{ '--sw': `${i % 2 ? 1 : -1}` } as React.CSSProperties}><Icon kind={kind} /></span>
        </span>
      ))}
      {BURST.map(([side, x, kind, d], i) => (
        <span key={`b${i}`} className={`as-b as-s${side}${kind === 'heart' && i % 3 === 0 ? ' as-lime' : ''}`}
          style={{ '--x': `${x}vw`, '--d': `${d}s` } as React.CSSProperties}>
          <Icon kind={kind} />
        </span>
      ))}
    </div>
  )
}
