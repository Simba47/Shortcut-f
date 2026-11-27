'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { BrandLogo } from '@/components/ui/brand-logo'
import './not-found.css'

/**
 * The 404 page (user, 2026-11-27): "4 🐼 4" — the panda is the 0. It yawns, sits down and falls asleep
 * (intro), then sleeps on (sleep, a loop) with its Z z Z; point at or tap "Take me home" and it peeks at you
 * with one eye (peek), then sleeps on. The three clips meet on the same sleeping frame, so they swap with no
 * fade. Reduced motion or data saver: no videos, the panda is shown asleep.
 * Signed in, home is the dashboard; signed out, the home page (F2 bug 9). Styles: not-found.css.
 */
const CLIP = (name: string) => `/errors/404/${name}`

export default function NotFound() {
  const { status } = useSession()
  const signedIn = status === 'authenticated'
  const router = useRouter()
  const [still, setStill] = useState(false)
  const introRef = useRef<HTMLVideoElement>(null)
  const sleepRef = useRef<HTMLVideoElement>(null)
  const peekRef = useRef<HTMLVideoElement>(null)
  const zzzRef = useRef<HTMLSpanElement>(null)
  const homeRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
    if (reduced || saveData) { setStill(true); return }
    const intro = introRef.current, sleep = sleepRef.current, peek = peekRef.current, zzz = zzzRef.current, home = homeRef.current
    if (!intro || !sleep || !peek || !zzz || !home) return
    let alive = true
    const timers: number[] = []
    const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(() => { if (alive) fn() }, ms)) }
    const on = (v: HTMLElement, yes: boolean) => { if (yes) v.setAttribute('data-on', ''); else v.removeAttribute('data-on') }

    // Asleep: the loop goes on top at once; the clip under it stays on its last frame (the same picture) until
    // the loop has surely painted, so nothing behind can flash through
    const fallAsleep = (under: HTMLVideoElement) => {
      sleep.currentTime = 0
      sleep.play().catch(() => {})
      on(sleep, true)
      zzz.removeAttribute('data-off'); zzz.setAttribute('data-on', '')
      sleep.addEventListener('playing', () => later(() => on(under, false), 600), { once: true })
    }
    const onIntroEnd = () => fallAsleep(intro)
    intro.addEventListener('ended', onIntroEnd)
    const begin = () => later(() => { on(intro, true); intro.play().catch(() => on(intro, false)) }, 700)
    if (intro.readyState >= 2) begin(); else intro.addEventListener('loadeddata', begin, { once: true })

    // The peek: it starts and ends on the loop's resting frame, so it cuts in only where the loop rests (its
    // start, or 4 s in) — at most a few seconds' wait, which reads as the panda noticing. Not more than once in 9 s.
    let want = false, peeking = false, lastPeek = 0
    const ask = () => { if (sleep.hasAttribute('data-on') && !peeking && Date.now() - lastPeek > 9000) want = true }
    const events = ['pointerenter', 'focus', 'touchstart'] as const
    events.forEach(e => home.addEventListener(e, ask, { passive: true }))
    const startPeek = () => {
      want = false; peeking = true
      zzz.setAttribute('data-off', '')
      peek.currentTime = 0
      peek.addEventListener('playing', () => { on(peek, true); sleep.pause() }, { once: true })
      peek.play().catch(() => { peeking = false; zzz.removeAttribute('data-off') })
    }
    const onPeekEnd = () => {
      sleep.currentTime = 0
      sleep.play().catch(() => {})
      sleep.addEventListener('playing', () => later(() => {
        on(peek, false); peeking = false; lastPeek = Date.now(); zzz.removeAttribute('data-off')
      }, 300), { once: true })
    }
    peek.addEventListener('ended', onPeekEnd)
    type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number }
    const fv = sleep as FrameVideo
    const watch = (_: number, meta: { mediaTime: number }) => {
      if (!alive) return
      const t = meta.mediaTime
      if (want && !peeking && (t < 0.06 || Math.abs(t - 4) < 0.04)) startPeek()
      fv.requestVideoFrameCallback?.(watch)
    }
    fv.requestVideoFrameCallback?.(watch)

    // Back on the tab after a while: carry on where it was
    const back = () => {
      if (document.hidden) return
      for (const v of [intro, sleep, peek]) if (v.hasAttribute('data-on') && v.paused && !v.ended && !(v === sleep && peeking)) v.play().catch(() => {})
    }
    document.addEventListener('visibilitychange', back)

    return () => {
      alive = false
      timers.forEach(clearTimeout)
      intro.removeEventListener('ended', onIntroEnd)
      peek.removeEventListener('ended', onPeekEnd)
      events.forEach(e => home.removeEventListener(e, ask))
      document.removeEventListener('visibilitychange', back)
    }
  }, [])

  const goBack = () => {
    // Opened straight from a link (nothing to go back to): go home instead
    if (window.history.length > 1) router.back(); else router.push(signedIn ? '/dashboard' : '/')
  }

  return (
    <div className="nf">
      <header className="nf-head">
        <Link href={signedIn ? '/dashboard' : '/'} className="nf-logo" aria-label="Shortcut home"><BrandLogo /></Link>
        {status === 'unauthenticated' && <Link href="/login" className="nf-login">Log in</Link>}
      </header>

      <main className="nf-main">
        <p className="nf-ghost" aria-hidden="true">404</p>

        <div className="nf-code" aria-hidden="true">
          <span className="nf-four">4</span>
          <span className="nf-panda">
            <span className="nf-film">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={CLIP(still ? 'asleep.webp' : 'poster.webp')} alt="" />
              {!still && (
                <>
                  <video ref={introRef} src={CLIP('intro.mp4')} muted playsInline preload="auto" />
                  <video ref={sleepRef} src={CLIP('sleep.mp4')} muted playsInline loop preload="auto" />
                  <video ref={peekRef} src={CLIP('peek.mp4')} muted playsInline preload="auto" />
                </>
              )}
            </span>
            <span className="nf-floor" />
            <span ref={zzzRef} className="nf-zzz" {...(still ? { 'data-on': '' } : {})}><b>z</b><b>z</b><b>Z</b></span>
          </span>
          <span className="nf-four">4</span>
        </div>

        <p className="nf-eyebrow">Page not found</p>
        <h1 className="nf-title">Shh… nothing here.</h1>
        <p className="nf-sub">
          <span>This page doesn&apos;t exist, and our panda got tired of looking for it.</span>{' '}
          <span>It may have moved, or been deleted.</span>
        </p>

        <div className="nf-actions">
          <button type="button" className="nf-btn nf-btn-quiet" onClick={goBack}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
            Go back
          </button>
          <Link ref={homeRef} href={signedIn ? '/dashboard' : '/'} className="nf-btn nf-btn-main">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>
            {signedIn ? 'Go to dashboard' : 'Take me home'}
          </Link>
        </div>
      </main>

      <footer className="nf-foot">
        <span>© 2026 Shortcut · Stoory Marketing Pvt. Ltd.</span>
        <nav aria-label="Legal"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/support">Support</Link></nav>
      </footer>
    </div>
  )
}
