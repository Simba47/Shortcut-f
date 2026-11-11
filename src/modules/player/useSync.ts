'use client'

import { useRef, useEffect, useCallback } from 'react'
import { usePlayerStore, liveTime } from './store'

/**
 * A stretch of the timeline [at, at + ms) (modules/editor/inserts.ts Piece): the main video from
 * `from` on (clip-relative ms), or held at `hold` while a video put in between plays
 */
type Piece = { id?: string; at: number; ms: number; from?: number; hold?: number; /** 1 when not given: `ms` of timeline plays `ms · speed` of video */ speed?: number; pitch?: boolean }
/** The video plays a piece at its speed: its voice natural unless the piece's pitch follows the speed */
function setRate(el: HTMLVideoElement, p: Piece | null | undefined) {
  const rate = p && p.hold == null ? (p.speed ?? 1) : 1
  if (el.playbackRate !== rate) el.playbackRate = rate
  const keep = !p?.pitch
  if ((el as HTMLVideoElement & { preservesPitch?: boolean }).preservesPitch !== keep) (el as HTMLVideoElement & { preservesPitch?: boolean }).preservesPitch = keep
}
/** A part of the source video that stays in the clip: [start, end) in ms of the video */
type KeptRange = [number, number]

// How close to the end of a kept part the player jumps to the next one: a frame at 30 fps, so no
// frame of the removed part is shown (the export joins on frames too)
const JOIN_LOOKAHEAD_MS = 34
// A seek can land a little before the time asked for: within this, the video is where it should be
const SEEK_SLACK_MS = 60
// Moving on to the next piece: within this the video is already where it goes on (no seek)
const CONTIGUOUS_MS = 80
// How far ahead of a jump (a cut, a removed part) the video's data for after it is fetched (warm)
const WARM_AHEAD_MS = 2500

/** Playing a video put in between: the main video is held, a clock moves the timeline on */
interface HoldState {
  piece: Piece
  /** performance.now() at timeline `piece.at` (moved when paused and resumed) */
  startWall: number
  /** When the clock entered (or resumed in) this piece */
  enteredWall: number
}

// Wires a <video> element to the playerStore.
// Returns videoRef + imperative controls. State (currentTimeMs, playing) is in the store.
// pieces: a clip with videos put in between (inserts.ts piecesOf): the clip plays its pieces one
// after another — each part from its own moment of the main video (jumping over what was cut),
// and during a video put in between the main video waits while a clock runs the timeline.
// kept: when parts of the clip were removed (lib/trims.ts), the parts of the video that stay. The
// timeline (currentTimeMs, seekToMs) then runs over those parts only, and playback skips the rest.
// (The editor uses one or the other.)
export function useVideoSync(clipStartMs = 0, clipEndMs?: number, pieces?: Piece[], kept?: KeptRange[],
  /**
   * How far a held piece's own video (the inserted one) has really played, ms into the piece; null
   * while it isn't playing yet. Given, it runs the clock through the piece — the timeline waits for
   * the video to start and never runs ahead of its picture (no stall-and-jump at the join).
   * undefined: the piece has no video of its own to follow (the empty stretch after the main video):
   * the wall clock runs it, with no wait.
   */
  heldPlayedMs?: (piece: Piece) => number | null | undefined,
) {
  const heldPlayedRef = useRef(heldPlayedMs)
  heldPlayedRef.current = heldPlayedMs
  const videoRef = useRef<HTMLVideoElement>(null)
  const rafRef = useRef<number>(0)
  // true when rafRef holds a requestVideoFrameCallback handle (separate ID space from rAF)
  const isVFCRef = useRef(false)
  const piecesRef = useRef<Piece[]>([])
  piecesRef.current = !kept?.length && pieces?.length ? pieces : []
  const holdRef = useRef<HoldState | null>(null)
  const { setCurrentTimeMs, setDurationMs, setPlaying } = usePlayerStore()
  const keptRef = useRef<KeptRange[] | undefined>(kept)
  keptRef.current = kept && kept.length ? kept : undefined
  // One seek at a time: a seek asked for while another is still running waits, and only the
  // latest waits (each new seek would cancel the one before, and while dragging none would finish)
  const pendingSeekRef = useRef<number | null>(null)
  // A seek just finished and the next one is waiting for the preview to draw its frame (onSeeked)
  const seekWaitRef = useRef(0)
  // Slow motion: the video shows a new frame only every so often (a 30 fps video at 0.25x: every
  // 133 ms), and the tick runs per frame — so the clock (playhead, captions, text) would step. In
  // between, a glide moves the clock on at real time, never further than the next frame is due
  // (the tick sets it exactly on each frame)
  const glideRef = useRef<{ t: number; wall: number; ahead: number } | null>(null)
  const glideRafRef = useRef(0)
  function glide() {
    const g = glideRef.current
    if (!g || !usePlayerStore.getState().playing || holdRef.current) { glideRafRef.current = 0; return }
    const next = g.t + Math.min(performance.now() - g.wall, g.ahead)
    if (next > liveTime.get() + 0.5) setCurrentTimeMs(next)
    glideRafRef.current = requestAnimationFrame(glide)
  }
  function stopGlide() {
    glideRef.current = null
    if (glideRafRef.current) cancelAnimationFrame(glideRafRef.current)
    glideRafRef.current = 0
  }
  function seekVideo(el: HTMLVideoElement, sec: number) {
    if (el.seeking || seekWaitRef.current) { pendingSeekRef.current = sec; return }
    pendingSeekRef.current = null
    el.currentTime = sec
  }

  // ── Getting the next jump ready ──────────────────────────────────────────────
  // At a cut the video jumps to another moment, and has to fetch that stretch first: the picture
  // stalls. So a hidden copy of the video parks on where it goes on, WARM_AHEAD_MS before the
  // join: the browser shares a video's downloaded data between its players, and the jump then
  // finds it there (a ~270 ms stall at each cut drops to ~70 ms on a test connection).
  const warmRef = useRef<{ el: HTMLVideoElement; sec: number } | null>(null)
  function warm(main: HTMLVideoElement, sec: number) {
    const src = main.currentSrc || main.src
    if (!src) return
    let w = warmRef.current
    if (!w || w.el.src !== src) {
      if (w) { w.el.removeAttribute('src'); w.el.load() }
      const el = document.createElement('video')
      el.muted = true
      el.playsInline = true
      el.preload = 'auto'
      el.crossOrigin = main.crossOrigin ?? 'anonymous'   // (the same as the player's: they share the data)
      el.src = src
      w = warmRef.current = { el, sec: -1 }
    }
    if (Math.abs(w.sec - sec) < 0.05) return
    w.sec = sec
    w.el.currentTime = sec
  }
  useEffect(() => () => { const w = warmRef.current; if (w) { w.el.removeAttribute('src'); w.el.load(); warmRef.current = null } }, [])

  // ── Removed parts ────────────────────────────────────────────────────────────

  const keptLength = (k: KeptRange[]) => k.reduce((t, [a, b]) => t + (b - a), 0)
  /** Video ms → timeline ms over the kept parts (a time inside a removed part lands on the join) */
  function keptToTimeline(k: KeptRange[], absMs: number): number {
    let at = 0
    for (const [a, b] of k) {
      if (absMs < a) return at
      if (absMs <= b) return at + (absMs - a)
      at += b - a
    }
    return at
  }
  /** Timeline ms → video ms over the kept parts (at a join: the first frame after it) */
  function keptToVideo(k: KeptRange[], ms: number): number {
    let at = 0
    for (const [a, b] of k) {
      if (ms < at + (b - a)) return a + Math.max(0, ms - at)
      at += b - a
    }
    return k[k.length - 1][1]
  }
  /**
   * Playing over kept parts: the timeline time for where the video is now. Jumps the video over a
   * removed part, and stops it at the end of the last kept part (returns null then: don't tick on).
   */
  function followKept(el: HTMLVideoElement, k: KeptRange[], lookahead: number): number | null {
    const absMs = el.currentTime * 1000
    let i = 0
    while (i < k.length - 1 && absMs >= k[i][1] - lookahead) i++
    if (i === k.length - 1 && absMs >= k[i][1]) {
      el.pause()
      el.currentTime = (k[i][1] - 1) / 1000  // stay on the last kept frame
      setPlaying(false)
      return null
    }
    if (absMs < k[i][0] - SEEK_SLACK_MS) el.currentTime = k[i][0] / 1000
    // the next removed part coming up: get what plays after it ready
    if (i < k.length - 1 && k[i][1] - absMs < WARM_AHEAD_MS && k[i + 1][0] - k[i][1] > CONTIGUOUS_MS) warm(el, k[i + 1][0] / 1000)
    return keptToTimeline(k, Math.max(k[i][0], absMs))
  }

  // ── Pieces ───────────────────────────────────────────────────────────────────

  const piecesTotal = () => { const p = piecesRef.current; return p.length ? p[p.length - 1].at + p[p.length - 1].ms : 0 }
  const pieceIndexAt = (t: number) => {
    const p = piecesRef.current
    for (let i = 0; i < p.length; i++) if (t < p[i].at + p[i].ms) return t >= p[i].at ? i : -1
    return p.length - 1
  }
  /** Timeline ms → main video ms (clip-relative); in a held piece: where the video waits */
  function videoOfTime(t: number): number {
    const i = pieceIndexAt(t), p = piecesRef.current[i]
    if (!p) return Math.max(0, t)
    return p.hold != null ? p.hold : (p.from ?? 0) + Math.min(p.ms - 1, Math.max(0, t - p.at)) * (p.speed ?? 1)
  }

  /** Stop at the clip's end (on its last frame) */
  function stopAtEnd(el: HTMLVideoElement) {
    cancelTick(el)
    cancelAnimationFrame(rafRef.current)
    holdRef.current = null
    el.pause()
    setPlaying(false)
    const total = piecesTotal()
    setCurrentTimeMs(Math.max(0, total - 1))
    seekVideo(el, (clipStartMs + videoOfTime(total - 1)) / 1000)
  }
  /** On to piece `i` from its start (`run`: playing) */
  function enterPiece(el: HTMLVideoElement, i: number, run: boolean) {
    const p = piecesRef.current[i]
    if (!p) { stopAtEnd(el); return }
    if (p.hold != null) { enterHold(el, p, p.at, run); return }
    holdRef.current = null
    const want = clipStartMs + (p.from ?? 0)
    if (Math.abs(el.currentTime * 1000 - want) > CONTIGUOUS_MS) el.currentTime = want / 1000
    setRate(el, p)
    setCurrentTimeMs(p.at)
    if (run) {
      if (el.paused) safePlay(el)
      else scheduleTick(el)
    }
  }

  /** The clock running the timeline through a video put in between (the main video is held meanwhile) */
  function holdTick() {
    if (!usePlayerStore.getState().playing) return
    const h = holdRef.current
    const el = videoRef.current
    if (!h || !el) return
    // The inserted video's own playback drives the clock when it can tell (it waits while that
    // video starts; never runs ahead of its picture). Otherwise: the wall clock, from when it started.
    const played = heldPlayedRef.current?.(h.piece)
    const wall = h.piece.at + (performance.now() - h.startWall)
    let t = wall
    if (played != null) {
      t = h.piece.at + Math.max(0, played)
      h.startWall = performance.now() - (t - h.piece.at)   // (the wall clock carries on from here if it stops telling)
    } else if (played === null && heldPlayedRef.current && performance.now() - h.enteredWall < 1500) {
      // Not playing yet (just started, still loading): wait for it, up to 1.5 s
      t = Math.max(h.piece.at, Math.min(wall, liveTime.get()))
      h.startWall = performance.now() - (t - h.piece.at)
    }
    if (t < h.piece.at + h.piece.ms) {
      setCurrentTimeMs(t)
      rafRef.current = requestAnimationFrame(holdTick) as unknown as number
      isVFCRef.current = false
      return
    }
    // Through it: on to the next piece
    enterPiece(el, piecesRef.current.indexOf(h.piece) + 1, true)
  }
  /** Start (or resume) playing through held piece `piece` from timeline `ms` */
  function enterHold(el: HTMLVideoElement, piece: Piece, ms: number, run: boolean) {
    holdRef.current = { piece, startWall: performance.now() - Math.max(0, ms - piece.at), enteredWall: performance.now() }
    const want = clipStartMs + (piece.hold ?? 0)
    if (Math.abs(el.currentTime * 1000 - want) > CONTIGUOUS_MS) seekVideo(el, want / 1000)
    if (!el.paused) el.pause()   // (onPause sees holdRef: the player stays "playing")
    setRate(el, null)
    setCurrentTimeMs(ms)
    if (run) {
      cancelAnimationFrame(rafRef.current)
      isVFCRef.current = false
      rafRef.current = requestAnimationFrame(holdTick) as unknown as number
    }
  }

  // ── helpers (use refs so closures never go stale) ────────────────────────────

  // Cancel whichever tick type is currently scheduled.
  // cancelAnimationFrame is a no-op on VFC handles (separate ID space) — must use
  // cancelVideoFrameCallback for those, otherwise orphan ticks accumulate and multiple
  // concurrent ticks cause competing el.play() / el.pause() calls that abort each other.
  function cancelTick(el?: HTMLVideoElement | null) {
    if (isVFCRef.current && el) {
      el.cancelVideoFrameCallback(rafRef.current)
      isVFCRef.current = false
    } else {
      cancelAnimationFrame(rafRef.current)
    }
    rafRef.current = 0
  }

  // Schedule the main-video tick (VFC when supported, rAF otherwise).
  function scheduleTick(el: HTMLVideoElement) {
    if ('requestVideoFrameCallback' in el) {
      rafRef.current = el.requestVideoFrameCallback(tick)
      isVFCRef.current = true
    } else {
      rafRef.current = requestAnimationFrame(tick) as unknown as number
      isVFCRef.current = false
    }
  }

  function safePlay(el: HTMLVideoElement) {
    el.play().catch(e => { if (e?.name !== 'AbortError') console.error(e) })
  }

  // ── Main video tick ──────────────────────────────────────────────────────────

  const tick = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    const keptNow = keptRef.current
    if (keptNow) {
      const at = followKept(el, keptNow, JOIN_LOOKAHEAD_MS)
      if (at === null) { setCurrentTimeMs(keptLength(keptNow)); return }
      setCurrentTimeMs(at)
      scheduleTick(el)
      return
    }
    const pieces = piecesRef.current
    if (pieces.length) {
      if (holdRef.current) return
      // The piece the timeline is in: the video plays it from its own moment
      const i = Math.max(0, pieceIndexAt(liveTime.get()))
      const p = pieces[i]
      if (p.hold != null) { enterHold(el, p, Math.max(p.at, liveTime.get()), usePlayerStore.getState().playing); return }
      const v = el.currentTime * 1000 - clipStartMs
      const from = p.from ?? 0, speed = p.speed ?? 1
      // (a piece at speed s plays ms · s of video; its timeline time is the video's ÷ s)
      if (v >= from + p.ms * speed - JOIN_LOOKAHEAD_MS * speed) { enterPiece(el, i + 1, usePlayerStore.getState().playing); return }
      if (v < from - SEEK_SLACK_MS) el.currentTime = (clipStartMs + from) / 1000
      // the next cut coming up: get where the video goes on ready (the main video's next piece, or
      // where it waits during a video put in between)
      const next = pieces[i + 1], endV = from + p.ms * speed
      if (next && endV - v < WARM_AHEAD_MS * speed) {
        const goesOn = next.hold ?? next.from ?? 0
        if (Math.abs(goesOn - endV) > CONTIGUOUS_MS) warm(el, (clipStartMs + goesOn) / 1000)
      }
      setRate(el, p)
      const t = p.at + Math.max(0, v - from) / speed
      if (speed < 1) {
        // (slowed: the glide carries the clock between frames; a frame never puts it back by the
        // little the glide went ahead — at most one frame's worth)
        const ahead = 1000 / 24 / speed
        const now = liveTime.get()
        setCurrentTimeMs(now > t && now - t < ahead ? now : t)
        // (the glide always starts from the frame's true time: it never runs further ahead than one frame)
        glideRef.current = { t, wall: performance.now(), ahead }
        if (!glideRafRef.current) glideRafRef.current = requestAnimationFrame(glide)
      } else {
        glideRef.current = null
        setCurrentTimeMs(t)
      }
      scheduleTick(el)
      return
    }
    const absoluteMs = el.currentTime * 1000
    if (clipEndMs !== undefined && absoluteMs >= clipEndMs) {
      el.pause()
      el.currentTime = (clipEndMs - 1) / 1000  // stay on last valid frame, not the continuation
      setPlaying(false)
      setCurrentTimeMs(Math.max(0, clipEndMs - clipStartMs - 1))
      return
    }
    setCurrentTimeMs(Math.max(0, absoluteMs - clipStartMs))
    scheduleTick(el)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipStartMs, clipEndMs, setCurrentTimeMs, setPlaying])

  // ── Event wiring ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const el = videoRef.current
    if (!el) return

    const onPlay = () => {
      setPlaying(true)
      const h = holdRef.current
      const now = liveTime.get()
      if (h && now >= h.piece.at && now < h.piece.at + h.piece.ms) {
        // In a video put in between: the main video waits, the clock plays it
        enterHold(el, h.piece, now, true)
        return
      }
      holdRef.current = null
      scheduleTick(el)
    }
    const onPause = () => {
      if (holdRef.current && usePlayerStore.getState().playing) return  // held for an insert: still playing
      setPlaying(false)
      cancelTick(el)
      stopGlide()
    }
    const onLoaded = () => {
      const k = keptRef.current
      if (k) {
        setDurationMs(keptLength(k))
        if (k[0][0] > 0) el.currentTime = k[0][0] / 1000
        return
      }
      if (piecesRef.current.length) {
        setDurationMs(piecesTotal())
        el.currentTime = (clipStartMs + videoOfTime(0)) / 1000
        return
      }
      const clipDuration = clipEndMs !== undefined
        ? clipEndMs - clipStartMs
        : el.duration * 1000 - clipStartMs
      setDurationMs(clipDuration)
      if (clipStartMs > 0) el.currentTime = clipStartMs / 1000
    }

    // Safety net: fires even when VFC/rAF is paused (e.g. background tab).
    // Stops the video if it drifts past clipEndMs while the tick was suspended.
    const onTimeUpdate = () => {
      const k = keptRef.current
      if (k) {
        // Past the end of a kept part while the tick slept: move on (or stop at the end)
        if (el.paused || el.seeking) return
        const at = followKept(el, k, 0)
        if (at === null) {
          cancelTick(el)
          cancelAnimationFrame(rafRef.current)
          setCurrentTimeMs(keptLength(k))
        }
        return
      }
      if (piecesRef.current.length || clipEndMs === undefined || holdRef.current) return
      const absMs = el.currentTime * 1000
      if (absMs >= clipEndMs) {
        cancelTick(el)
        cancelAnimationFrame(rafRef.current)
        el.pause()
        el.currentTime = (clipEndMs - 1) / 1000  // stay on the last valid frame
        setPlaying(false)
        setCurrentTimeMs(Math.max(0, clipEndMs - clipStartMs - 1))
      }
    }

    // When the video file ends naturally (el.duration reached), snap to clip end.
    const onEnded = () => {
      cancelTick(el)
      cancelAnimationFrame(rafRef.current)
      holdRef.current = null
      setPlaying(false)
      const k = keptRef.current
      if (k) {
        el.currentTime = (k[k.length - 1][1] - 1) / 1000
        setCurrentTimeMs(keptLength(k))
        return
      }
      if (piecesRef.current.length) { setCurrentTimeMs(Math.max(0, piecesTotal() - 1)); return }
      if (clipEndMs !== undefined) {
        el.currentTime = (clipEndMs - 1) / 1000
        setCurrentTimeMs(Math.max(0, clipEndMs - clipStartMs - 1))
      }
    }

    // A seek finished: no new one until the next drawing, then the one asked for meanwhile (the
    // latest). Started at once, the video was seeking again before the preview (a canvas, drawn once
    // a screen refresh) came to copy this frame: dragging, it got a third of the frames the video showed
    const onSeeked = () => {
      if (seekWaitRef.current) return
      seekWaitRef.current = requestAnimationFrame(() => {
        seekWaitRef.current = 0
        const p = pendingSeekRef.current
        if (p == null) return
        pendingSeekRef.current = null
        if (Math.abs(el.currentTime - p) > 0.001) el.currentTime = p
      })
    }
    el.addEventListener('seeked', onSeeked)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('loadedmetadata', onLoaded)
    el.addEventListener('timeupdate', onTimeUpdate)
    el.addEventListener('ended', onEnded)
    if (el.readyState >= 1) onLoaded()
    return () => {
      el.removeEventListener('seeked', onSeeked)
      cancelAnimationFrame(seekWaitRef.current)
      seekWaitRef.current = 0
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('loadedmetadata', onLoaded)
      el.removeEventListener('timeupdate', onTimeUpdate)
      el.removeEventListener('ended', onEnded)
      cancelTick(el)
    }
  }, [tick, clipStartMs, clipEndMs, setDurationMs, setPlaying, setCurrentTimeMs])

  // The clip's length follows the kept parts and the pieces when they change (a part removed, a
  // video put in, an undo)
  const keptKey = kept && kept.length ? kept.map(r => r.join('-')).join(',') : ''
  const piecesKey = piecesRef.current.map(p => `${p.at}+${p.ms}:${p.from ?? ''}@${p.hold ?? ''}x${p.speed ?? 1}${p.pitch ? 'p' : ''}`).join(',')
  useEffect(() => {
    const k = keptRef.current
    if (k) setDurationMs(keptLength(k))
    else if (piecesRef.current.length) setDurationMs(piecesTotal())
    else if (clipEndMs !== undefined) setDurationMs(clipEndMs - clipStartMs)
    // A held piece that changed under a running clock: off it (the playhead stays put)
    const h = holdRef.current
    if (h && !piecesRef.current.some(p => p.at === h.piece.at && p.ms === h.piece.ms && p.hold === h.piece.hold)) holdRef.current = null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keptKey, piecesKey, clipStartMs, clipEndMs, setDurationMs])

  // ── Public controls ───────────────────────────────────────────────────────────

  const play = useCallback(() => {
    const el = videoRef.current; if (!el) return
    const pieces = piecesRef.current
    if (!keptRef.current && pieces.length) {
      let now = liveTime.get()
      if (now >= piecesTotal() - 1) now = 0   // (at the end: from the start again)
      const i = Math.max(0, pieceIndexAt(now)), p = pieces[i]
      if (p.hold != null) { setPlaying(true); enterHold(el, p, Math.max(p.at, now), true); return }
      holdRef.current = null
      const want = clipStartMs + (p.from ?? 0) + Math.max(0, now - p.at) * (p.speed ?? 1)
      if (Math.abs(el.currentTime * 1000 - want) > CONTIGUOUS_MS) el.currentTime = want / 1000
      setRate(el, p)
      setCurrentTimeMs(now)
      safePlay(el)
      return
    }
    holdRef.current = null
    setRate(el, null)
    safePlay(el)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setPlaying, clipStartMs])

  const pause = useCallback(() => {
    cancelTick(videoRef.current)
    cancelAnimationFrame(rafRef.current)  // also the insert clock (a plain rAF)
    setPlaying(false)
    videoRef.current?.pause()
    // (holdRef stays: play resumes in the inserted video from here)
  }, [setPlaying])

  const togglePlay = useCallback(() => {
    if (usePlayerStore.getState().playing) pause()
    else play()
  }, [play, pause])

  const seekToMs = useCallback((ms: number) => {
    const el = videoRef.current; if (!el) return
    cancelTick(el)
    cancelAnimationFrame(rafRef.current)  // also the insert clock
    const playing = usePlayerStore.getState().playing

    // Removed parts: the timeline runs over the kept parts only
    const k = keptRef.current
    if (k) {
      holdRef.current = null
      const at = Math.max(0, Math.min(ms, keptLength(k)))
      seekVideo(el, Math.min(keptToVideo(k, at), k[k.length - 1][1] - 1) / 1000)
      setCurrentTimeMs(at)
      if (playing) {
        if (el.paused) safePlay(el)
        else scheduleTick(el)
      }
      return
    }

    const pieces = piecesRef.current
    if (pieces.length) {
      const at = Math.max(0, Math.min(ms, piecesTotal() - 1))
      const p = pieces[Math.max(0, pieceIndexAt(at))]
      // Into a video put in between: the main video waits where it goes in, the clock takes over
      if (p.hold != null) { enterHold(el, p, at, playing); return }
      holdRef.current = null
      seekVideo(el, (clipStartMs + videoOfTime(at)) / 1000)
      setRate(el, p)
      setCurrentTimeMs(at)
      if (playing) {
        if (el.paused) safePlay(el)
        else scheduleTick(el)
      }
      return
    }

    holdRef.current = null
    const at = Math.max(0, clipEndMs !== undefined ? Math.min(ms, clipEndMs - clipStartMs) : ms)
    seekVideo(el, (clipStartMs + at) / 1000)
    setCurrentTimeMs(at)
    if (playing) {
      if (el.paused) safePlay(el)
      else scheduleTick(el)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipStartMs, clipEndMs, setCurrentTimeMs])

  return { videoRef, play, pause, togglePlay, seekToMs }
}

// Polyfill for environments without requestVideoFrameCallback / cancelVideoFrameCallback
declare global {
  interface HTMLVideoElement {
    requestVideoFrameCallback(callback: FrameRequestCallback): number
    cancelVideoFrameCallback(handle: number): void
  }
}
