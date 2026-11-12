'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useStoryboard } from '@/modules/clips/storyboard'
import { useLocalVideoProgress } from '@/modules/clips/localVideo'

/**
 * The clip board's video player, with its own controls so dragging along the video is smooth
 * however heavy the file is (styles: .sp-* in globals.css):
 *
 *  - While dragging, the moment under the finger shows at once from the storyboard
 *    (modules/clips/storyboard.ts), fully covering the old picture, until the player's real frame
 *    for that moment has loaded.
 *  - The player jumps at most once at a time — the newest place asked for, when the last jump is
 *    done — instead of a jump per mouse move piling up (what made the browser's own bar lag).
 *  - Hovering the bar shows that moment's time above it (no picture: the big one shows it while dragging).
 *
 *  - The page downloads the whole video once (modules/clips/localVideo.ts): `loading` is how far
 *    along that is (shown on the bar; only this player re-renders as it moves). When it is all here `src` becomes the downloaded copy and
 *    the player switches to it in place — same moment, still playing if it was — and from then
 *    on any jump is instant.
 *
 * Space plays / pauses, ← / → jump 5 s, F is full screen, M mutes.
 */
export function ScrubPlayer({ src, videoRef, durationMs: durHint, loadKey, onTime, onMeta, onError, noPlay = false }: {
  src: string
  /** The key the page downloads the whole video under (useLocalVideo): its progress shows on the bar */
  loadKey?: string | null
  videoRef: RefObject<HTMLVideoElement | null>
  /** The length if known before the video loads (ms) */
  durationMs?: number | null
  /** The moment shown changed: played on, dragged to or jumped to (ms) */
  onTime: (ms: number) => void
  onMeta?: (v: HTMLVideoElement) => void
  onError?: (v: HTMLVideoElement) => void
  /** No playing for now (user, 2026-11-13: while Make my clips works): paused, and no controls at all — no
   *  Play, bar, time, sound or full screen; a click or Space doesn't start it */
  noPlay?: boolean
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [durMs, setDurMs] = useState<number>(durHint ?? 0)
  const [curMs, setCurMs] = useState(0)
  const [bufMs, setBufMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState<{ x: number; ms: number } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const [idle, setIdle] = useState(false)
  const [boardOn, setBoardOn] = useState(false)
  const want = useRef<number | null>(null)

  // (the storyboard waits for the download: it would slow it, and once the video is here the
  // real frames come at once anyway)
  // The whole video downloading: 0 → 1; null when it is here (or can't be)
  const loading = useLocalVideoProgress(loadKey)
  const frameAt = useStoryboard(src, durMs || null, boardOn && loading === null, playing || dragging)

  // Where the video is, and the switch to the downloaded copy: the source changes in this render,
  // so the moment and whether it was playing are noted now and put back once it has loaded
  const posRef = useRef(0)
  const lastSrc = useRef(src)
  const resume = useRef<{ ms: number; play: boolean } | null>(null)
  if (lastSrc.current !== src) {
    resume.current = { ms: want.current ?? posRef.current, play: playing }
    lastSrc.current = src
  }

  // The moment asked for (dragged to / jumped to), and the jump to it (declared above)
  const draggingRef = useRef(false)
  const wasPlaying = useRef(false)
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Jump to the moment asked for, unless a jump is already running (it continues when that one is done) */
  function pump() {
    const v = videoRef.current
    if (!v || want.current === null || v.seeking) return
    // Already there (e.g. letting go where the drag had jumped to): nothing to wait for, so the
    // bar follows the video again — kept, it would ignore every time update from then on
    if (Math.abs(v.currentTime * 1000 - want.current) < 40) {
      if (!draggingRef.current) want.current = null
      return
    }
    v.currentTime = want.current / 1000
  }
  /** The real frame is (close to) the moment asked for: the stand-in picture goes */
  function caughtUp(v: HTMLVideoElement) {
    if (want.current === null || Math.abs(v.currentTime * 1000 - want.current) < 250) {
      setPreview(null)
      setSlow(false)
      if (slowTimer.current) { clearTimeout(slowTimer.current); slowTimer.current = null }
    }
  }
  /** Asked for a moment (by dragging, a key, or the page): shown at once, jumped to when free */
  function goTo(ms: number) {
    const v = videoRef.current
    const m = Math.max(0, Math.min(durMs || ms, ms))
    want.current = m
    posRef.current = m
    setCurMs(m)
    onTime(m)
    if (v && Math.abs(v.currentTime * 1000 - m) > 250) {
      setPreview(frameAt(m))
      if (!slowTimer.current) slowTimer.current = setTimeout(() => setSlow(true), 300)
    }
    pump()
  }

  // ── the bar ──
  const msAtX = (clientX: number) => {
    const r = barRef.current?.getBoundingClientRect()
    if (!r || !durMs) return 0
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * durMs
  }
  function onBarDown(e: React.PointerEvent) {
    if (!durMs) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const v = videoRef.current
    wasPlaying.current = !!v && !v.paused
    v?.pause()
    draggingRef.current = true
    setDragging(true)
    goTo(msAtX(e.clientX))
  }
  function onBarMove(e: React.PointerEvent) {
    const r = barRef.current?.getBoundingClientRect()
    if (r) setHover({ x: Math.max(0, Math.min(r.width, e.clientX - r.left)), ms: msAtX(e.clientX) })
    if (draggingRef.current) goTo(msAtX(e.clientX))
  }
  function onBarUp(e: React.PointerEvent) {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    goTo(msAtX(e.clientX))
    if (wasPlaying.current) void videoRef.current?.play().catch(() => {})
  }

  // ── buttons and keys ──
  useEffect(() => { if (noPlay) videoRef.current?.pause() }, [noPlay, videoRef])
  function togglePlay() {
    const v = videoRef.current
    if (!v || noPlay) return
    if (v.paused) void v.play().catch(() => {})
    else v.pause()
  }
  function toggleMute() {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }
  function toggleFull() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void boxRef.current?.requestFullscreen().catch(() => {})
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.target !== e.currentTarget) return   // (a focused button handles its own keys)
    const v = videoRef.current
    if (!v) return
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay() }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo((want.current ?? v.currentTime * 1000) - 5000) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goTo((want.current ?? v.currentTime * 1000) + 5000) }
    else if (e.key === 'f') toggleFull()
    else if (e.key === 'm') toggleMute()
  }

  // The controls fade while playing and the mouse is still (back on any move)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function wake() {
    setIdle(false)
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), 2500)
  }
  useEffect(() => () => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    if (slowTimer.current) clearTimeout(slowTimer.current)
  }, [])

  // The video is in the server-rendered page, so it can load its length (and enough to play)
  // before this code runs and misses those events: read where it already is
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (v.readyState >= 1) {
      if (isFinite(v.duration) && v.duration > 0) setDurMs(v.duration * 1000)
      setMuted(v.muted)
      onMeta?.(v)
    }
    if (v.readyState >= 3) setTimeout(() => setBoardOn(true), 800)
  }, [src]) // eslint-disable-line react-hooks/exhaustive-deps

  const pct = (ms: number) => (durMs ? Math.max(0, Math.min(100, (ms / durMs) * 100)) : 0)
  const showControls = !playing || dragging || !idle || !!hover
  const barW = barRef.current?.offsetWidth ?? 0

  return (
    <div ref={boxRef} className="sp relative w-full h-full select-none" tabIndex={0} onKeyDown={onKey}
      onPointerMove={wake} onPointerLeave={() => setIdle(true)} data-idle={!showControls || undefined}
      role="group" aria-label="Video player">
      <video
        ref={videoRef}
        src={src}
        // (loaded ahead, so a moment dragged to is usually there already; while the whole video is
        // downloading only its start, so the two don't fight over the connection)
        preload={loading === null ? 'auto' : 'metadata'}
        playsInline
        className="w-full h-full object-contain"
        onClick={togglePlay}
        onDoubleClick={toggleFull}
        onLoadedMetadata={e => {
          const v = e.currentTarget
          if (isFinite(v.duration) && v.duration > 0) setDurMs(v.duration * 1000)
          setMuted(v.muted)
          onMeta?.(v)
          // (switched to the downloaded copy: back to the same moment, playing if it was)
          const r = resume.current
          if (r) {
            resume.current = null
            if (r.ms > 0) { want.current = r.ms; v.currentTime = r.ms / 1000 }
            if (r.play) void v.play().catch(() => {})
          }
        }}
        onCanPlay={e => {
          caughtUp(e.currentTarget)
          // (the storyboard starts once the player has what it needs: it would slow its start)
          if (!boardOn) setTimeout(() => setBoardOn(true), 800)
        }}
        onTimeUpdate={e => {
          const v = e.currentTarget
          if (v.seeking || draggingRef.current) return
          // (a jump on the way to the moment asked for has landed: not there yet, keep going)
          if (want.current !== null && Math.abs(v.currentTime * 1000 - want.current) >= 40) return
          want.current = null
          posRef.current = v.currentTime * 1000
          setCurMs(v.currentTime * 1000)
          onTime(v.currentTime * 1000)
        }}
        onProgress={e => {
          const b = e.currentTarget.buffered
          if (b.length) setBufMs(b.end(b.length - 1) * 1000)
        }}
        onSeeking={e => {
          // A jump from elsewhere (a clip's "Play in the video"): shown at once like a drag
          const v = e.currentTarget
          if (want.current === null) {
            const ms = v.currentTime * 1000
            posRef.current = ms
            setCurMs(ms)
            onTime(ms)
            setPreview(frameAt(ms))
            if (!slowTimer.current) slowTimer.current = setTimeout(() => setSlow(true), 300)
          }
        }}
        onSeeked={e => {
          const v = e.currentTarget
          caughtUp(v)
          if (want.current !== null && Math.abs(v.currentTime * 1000 - want.current) >= 40) pump()
          else if (!draggingRef.current) { want.current = null; onTime(v.currentTime * 1000) }
        }}
        onPlay={e => {
          setPlaying(true)
          // (playing with no jump on the way: the bar follows the video from here)
          if (!e.currentTarget.seeking && !draggingRef.current) want.current = null
        }}
        onPause={() => setPlaying(false)}
        onVolumeChange={e => setMuted(e.currentTarget.muted)}
        onError={e => onError?.(e.currentTarget)}
      />

      {/* The moment asked for, until the player's own frame for it is there: covers the old picture */}
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" aria-hidden="true" draggable={false} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
      )}
      {slow && !preview && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none" aria-hidden="true">
          <span className="w-9 h-9 rounded-full border-[3px] border-white/25 border-t-white animate-spin" style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.6))' }} />
        </div>
      )}

      {/* ── controls ── */}
      {!noPlay && <div className="sp-controls" data-show={showControls || undefined}>
        <div ref={barRef} className="sp-bar" data-drag={dragging || undefined}
          role="slider" tabIndex={-1} aria-label="Video position" aria-valuemin={0} aria-valuemax={Math.round(durMs / 1000)}
          aria-valuenow={Math.round(curMs / 1000)} aria-valuetext={fmt(curMs)}
          onPointerDown={onBarDown} onPointerMove={onBarMove} onPointerUp={onBarUp} onPointerCancel={onBarUp}
          onPointerLeave={() => { if (!draggingRef.current) setHover(null) }}>
          <div className="sp-track">
            {/* (what is here: the download's progress while the whole video comes in) */}
            <div className="sp-buf" style={{ width: `${loading !== null ? Math.max(loading * 100, pct(bufMs)) : pct(bufMs)}%` }} />
            <div className="sp-done" style={{ width: `${pct(curMs)}%` }} />
          </div>
          <div className="sp-thumb" style={{ left: `${pct(curMs)}%` }} />
          {hover && (
            <div className="sp-tip" style={{ left: Math.max(22, Math.min(barW - 22, hover.x)) }}>
              <span className="sp-tip-time">{fmt(dragging ? curMs : hover.ms)}</span>
            </div>
          )}
        </div>
        <div className="sp-row">
          <button type="button" className="sp-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
            {playing
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z" /></svg>}
          </button>
          <span className="sp-time tabular-nums">{fmt(curMs)} <span className="sp-time-of">/ {fmt(durMs)}</span></span>
          <span className="flex-1" />
          {loading !== null && (
            <span className="sp-load tabular-nums" title="The whole video is loading once, so playing from any moment is instant">
              Loading video {Math.round(loading * 100)}%
            </span>
          )}
          <button type="button" className="sp-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" /><path d="m22 9-6 6M16 9l6 6" /></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>}
          </button>
          <button type="button" className="sp-btn" onClick={toggleFull} aria-label="Full screen">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" /></svg>
          </button>
        </div>
      </div>}
    </div>
  )
}

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}
