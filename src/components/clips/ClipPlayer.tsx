'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CaptionStyle, Overlay, SegmentLocal, TextOverlay, TranscriptWord } from '@chai-cut/shared'
import { OutputCanvas } from '@/components/editor/VideoPreview'
import { getBoxPositionAtLerp } from '@/lib/interpolation'
import { BorrowedPool, isBorrowedSlot } from '@/modules/editor/brollSources'
import { createFrameMediaPool } from '@/modules/editor/frameMedia'
import { MAIN_SOURCE } from '@/modules/editor/frames'
import { insertsOf, piecesOf, piecesLength, pieceAt, videoAtPieces, timelineAtPieces, pieceVideoMs, type Piece } from '@/modules/editor/inserts'

/** The video plays a piece at its speed (a part played faster or slower): its voice natural unless its pitch follows */
function rateFor(v: HTMLVideoElement, p: Piece | null | undefined) {
  const rate = p && p.hold == null ? (p.speed ?? 1) : 1
  if (v.playbackRate !== rate) v.playbackRate = rate
  const el = v as HTMLVideoElement & { preservesPitch?: boolean }
  if (el.preservesPitch !== !p?.pitch) el.preservesPitch = !p?.pitch
}
import { isShot } from '@/modules/editor/shots'
import { cleanTrims, trimMap } from '@/lib/trims'
import { toTimelineState } from '@/modules/editor/trimState'

const NO_TRIMS: [number, number][] = []
const NO_OVERLAYS: Overlay[] = []

/** The card playing now: starting another pauses it (a gallery plays one reel at a time) */
let playingNow: { stop: () => void } | null = null

/**
 * A clip played in 9:16 without exporting it: the source video drawn through the clip's framing,
 * captions and text, exactly as the editor's preview draws it (OutputCanvas), with hard cuts
 * between formats and the B-roll shots in place, as in the export.
 * Videos put in between (modules/editor/inserts.ts): the source video waits where one goes in
 * while a clock plays it, then carries on — the clip is that much longer.
 */
export function ClipPlayer({ videoUrl, mainVideoId, stockUrls = {}, startMs, endMs, segments: savedSegments, words, captionStyle, textOverlays: savedTexts, trims = NO_TRIMS, overlays: savedOverlays = NO_OVERLAYS }: {
  videoUrl: string
  /** The clip's own video: split/trio slots naming it are borrowed reactions from another moment */
  mainVideoId?: string | null
  /** Signed URLs of the B-roll videos the clip shows, by video id */
  stockUrls?: Record<string, string>
  startMs: number
  endMs: number
  segments: SegmentLocal[]
  words: TranscriptWord[]
  captionStyle: Partial<CaptionStyle> | null
  textOverlays: TextOverlay[]
  /** Its removed parts (clips.trim_ranges, source ms) */
  trims?: [number, number][]
  /** Its pictures on top (a brand kit's logo, photos), signed (preview_url), clip time */
  overlays?: Overlay[]
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [tMs, setTMs] = useState(0)   // clip-relative
  // Removed parts (the editor's Delete, Cleanup, Make my clips' pauses): the clip plays without them,
  // as the export cuts them (render.ts condenseClip) — its sections and text moved up to where they
  // now play (the editor's toTimelineState), the video jumping over each removed part as over video
  // cut out of a clip of pieces. (Before 2026-11-04 the whole stretch played: longer than the export.)
  const removed = useMemo(() => {
    const clean = cleanTrims(trims, startMs, endMs)
    if (!clean.length) return null
    const map = trimMap(clean, startMs, endMs)
    const keyframes = Object.fromEntries(savedSegments.flatMap(sg => sg.crop_boxes.map(b => [b.id, b.keyframes.map((k, i) => ({ ...k, id: `${b.id}-${i}`, box_id: b.id }))] as const)))
    const st = toTimelineState({ segments: savedSegments, keyframes, overlays: savedOverlays, textOverlays: savedTexts, audioTracks: [], transitions: [] }, map, startMs)
    let at = 0
    const kept: Piece[] = map.kept.map(([a, b], i) => { const p = { id: `kept-${i}`, at, ms: b - a, from: a - startMs }; at += b - a; return p })
    return {
      segments: st.segments.map(sg => ({ ...sg, crop_boxes: sg.crop_boxes.map(b => ({ ...b, keyframes: st.keyframes[b.id]?.map(({ t_ms, x, y, w, h }) => ({ t_ms, x, y, w, h })) ?? b.keyframes })) })),
      textOverlays: st.textOverlays, overlays: st.overlays, pieces: kept,
    }
  }, [trims, startMs, endMs, savedSegments, savedTexts, savedOverlays])
  const segments = removed?.segments ?? savedSegments
  const textOverlays = removed?.textOverlays ?? savedTexts
  const overlays = removed?.overlays ?? savedOverlays
  // A clip of pieces (inserts.ts): each part from its own moment of the video (a part can skip
  // video), and during a video put in between the clip's own clock runs while the source waits
  const pieces = useMemo(() => {
    if (removed) return removed.pieces
    const all = piecesOf(segments, mainVideoId, s => isShot(s, mainVideoId))
    return insertsOf(segments, mainVideoId).length || all.some(p => (p.from != null && Math.abs(p.from - p.at) > 1) || (p.speed ?? 1) !== 1) ? all : []
  }, [segments, mainVideoId, removed])
  const lengthMs = pieces.length ? piecesLength(pieces) : endMs - startMs
  const tRef = useRef(0)
  const holdRef = useRef<{ piece: Piece; wall: number } | null>(null)
  /** Clip time → the source video's time (clip-relative ms); inside a video put in between: where the source waits */
  const toVideo = (t: number) => (pieces.length ? videoAtPieces(pieces, t) : t)

  // Full screen: the reel as big as the screen allows, still 9:16 (black either side). Where a
  // page can't go full screen (iPhone Safari), it fills the window instead. Esc / the button leave.
  const boxRef = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState<'screen' | 'window' | null>(null)
  // Loads only near the screen: a gallery's cards each play the whole video from their own moment,
  // and all loading at once shared the connection until none had its moment (cards spinning for
  // minutes). Once loaded a card keeps its video, so scrolling back plays at once.
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = boxRef.current
    if (near || !el) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setNear(true) }, { rootMargin: '300px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  useEffect(() => {
    const onChange = () => setFull(f => (document.fullscreenElement === boxRef.current ? 'screen' : f === 'screen' ? null : f))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  useEffect(() => {
    if (full !== 'window') return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(null) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [full])
  function toggleFull() {
    if (full === 'screen') { void document.exitFullscreen().catch(() => {}); return }
    if (full === 'window') { setFull(null); return }
    const el = boxRef.current
    if (el?.requestFullscreen) el.requestFullscreen().then(() => setFull('screen')).catch(() => setFull('window'))
    else setFull('window')
  }

  const keyframes = useMemo(() => {
    const map: Record<string, SegmentLocal['crop_boxes'][number]['keyframes']> = {}
    for (const s of segments) for (const b of s.crop_boxes) map[b.id] = b.keyframes
    return map
  }, [segments])
  const getPositionAt = useMemo(() => (boxId: string, t: number) => getBoxPositionAtLerp(t, keyframes[boxId] ?? []), [keyframes])
  const bySegmentTime = useMemo(() => [...segments].sort((a, b) => a.start_ms - b.start_ms), [segments])
  const segmentAt = useMemo(() => (t: number) =>
    bySegmentTime.find(s => t >= s.start_ms && t < s.end_ms) ?? bySegmentTime[bySegmentTime.length - 1] ?? null,
  [bySegmentTime])
  const activeSegment = segmentAt(tMs)
  // Frames: the other videos and photos in their slots (the canvas keeps them in step)
  const stockUrlsRef = useRef(stockUrls)
  stockUrlsRef.current = stockUrls
  const videoUrlRef = useRef(videoUrl)
  videoUrlRef.current = videoUrl
  const framePool = useMemo(() => createFrameMediaPool(id => id === MAIN_SOURCE ? videoUrlRef.current : stockUrlsRef.current[id]), [])
  useEffect(() => () => framePool.dispose(), [framePool])

  // B-roll: the stock videos, drawn in place of the source during their shots (muted: the
  // speaker keeps talking, as in the export)
  const stockRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const brollOf = (seg: SegmentLocal | null) => {
    const box = seg?.crop_boxes[0]
    return box?.source_video_id && box.source_video_id !== mainVideoId && stockUrls[box.source_video_id] ? box : null
  }

  // Borrowed reaction slots: the same video from another moment, from a small shared pool that
  // loads nothing until the clip plays and parks the next split/trio ahead of time
  const hasBorrowed = useMemo(() => segments.some(seg => seg.crop_boxes.some(b => isBorrowedSlot(seg, b, mainVideoId))), [segments, mainVideoId])
  const poolRef = useRef<BorrowedPool | null>(null)
  useEffect(() => {
    if (!hasBorrowed || !mainVideoId) return
    poolRef.current = new BorrowedPool(videoUrl, mainVideoId)
    return () => { poolRef.current?.dispose(); poolRef.current = null }
  }, [hasBorrowed, mainVideoId, videoUrl])
  const slotSourceFor = (seg: SegmentLocal | null, box: SegmentLocal['crop_boxes'][number]) =>
    isBorrowedSlot(seg, box, mainVideoId) ? poolRef.current?.source(box.id) ?? false : null
  function syncBorrowed(rel: number, play: boolean) {
    poolRef.current?.sync(bySegmentTime, rel, play)
  }
  const sourceFor = (seg: SegmentLocal | null) => {
    const box = brollOf(seg)
    return box ? stockRefs.current[box.source_video_id!] ?? null : null
  }
  /** Keep the stock video of the shot under the playhead in step; pause the others */
  function syncStock(rel: number, play: boolean) {
    const seg = segmentAt(rel)
    const box = brollOf(seg)
    for (const [id, el] of Object.entries(stockRefs.current)) {
      if (!el) continue
      if (box && id === box.source_video_id && seg) {
        const want = ((box.source_offset_ms ?? 0) + rel - seg.start_ms) / 1000
        if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want
        if (play && el.paused) el.play().catch(() => {})
        if (!play && !el.paused) el.pause()
      } else if (!el.paused) el.pause()
    }
  }

  // Captions: Roman letters when the style says so; after a video put in between, later by its length
  const shownWords = useMemo(() => {
    const placed = pieces.length
      ? words.flatMap(w => {
        const rel = w.start_ms - startMs
        if (rel < 0) return [w]
        const mid = (w.start_ms + w.end_ms) / 2 - startMs
        if (!pieces.some(p => p.from != null && mid >= p.from && mid < p.from + pieceVideoMs(p))) return []   // (in video cut out)
        // (both ends: in a part played faster or slower the word is shorter or longer too)
        const a = timelineAtPieces(pieces, rel), b = Math.max(a + 1, timelineAtPieces(pieces, w.end_ms - startMs))
        return a === rel && b === w.end_ms - startMs ? [w] : [{ ...w, start_ms: startMs + a, end_ms: startMs + b }]
      })
      : words
    return captionStyle?.language === 'roman' ? placed.map(w => ({ ...w, word: w.word_roman ?? w.word, source_word: w.word })) : placed
  }, [words, captionStyle?.language, pieces, startMs])
  const showCaptions = !!captionStyle && captionStyle.enabled !== false && words.length > 0

  // Follow the video: the time drives which format is on screen; the clip loops within its range
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const v = videoRef.current
      if (v) {
        let rel: number
        const h = holdRef.current
        /** On to piece `i`: a held one starts its clock, a played one its own moment of the video */
        const enter = (i: number): number => {
          const n = pieces[i]
          if (!n) return lengthMs
          if (n.hold != null) {
            v.pause()
            if (Math.abs(v.currentTime * 1000 - (startMs + n.hold)) > 80) v.currentTime = (startMs + n.hold) / 1000
            holdRef.current = { piece: n, wall: performance.now() }
          } else {
            holdRef.current = null
            if (Math.abs(v.currentTime * 1000 - (startMs + (n.from ?? 0))) > 80) v.currentTime = (startMs + (n.from ?? 0)) / 1000
            rateFor(v, n)
            if (v.paused) v.play().catch(() => {})
          }
          return n.at
        }
        if (!pieces.length) rel = v.currentTime * 1000 - startMs
        else if (h) {
          // In a video put in between: the clock runs it; through it, on to the next piece
          rel = h.piece.at + (performance.now() - h.wall)
          if (rel >= h.piece.at + h.piece.ms) rel = enter(pieces.indexOf(h.piece) + 1)
        } else {
          const p = pieceAt(pieces, tRef.current) ?? pieces[0]
          if (p.hold != null) rel = enter(pieces.indexOf(p))
          else {
            const vm = v.currentTime * 1000 - startMs, sp = p.speed ?? 1
            rateFor(v, p)
            // The end of this piece: on to the next (a jump over video cut out, or a held one); a
            // piece at another speed plays ms · speed of video, its time the video's ÷ speed
            rel = vm >= (p.from ?? 0) + pieceVideoMs(p) - 34 * sp ? enter(pieces.indexOf(p) + 1) : p.at + Math.max(0, vm - (p.from ?? 0)) / sp
          }
        }
        if (rel >= lengthMs) { v.pause(); holdRef.current = null; v.currentTime = startMs / 1000; tRef.current = 0; setPlaying(false); setTMs(0); syncStock(0, false); syncBorrowed(0, false); return }
        tRef.current = Math.max(0, rel)
        setTMs(tRef.current)
        syncStock(tRef.current, true)
        syncBorrowed(tRef.current, true)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, startMs, lengthMs, pieces]) // eslint-disable-line react-hooks/exhaustive-deps

  function pause() {
    videoRef.current?.pause(); holdRef.current = null; setPlaying(false); syncStock(tRef.current, false); syncBorrowed(tRef.current, false)
  }
  const stopRef = useRef({ stop: pause })
  stopRef.current.stop = pause
  useEffect(() => {
    const me = stopRef.current
    if (playing) { if (playingNow && playingNow !== me) playingNow.stop(); playingNow = me }
    else if (playingNow === me) playingNow = null
  }, [playing])
  useEffect(() => { const me = stopRef.current; return () => { if (playingNow === me) playingNow = null } }, [])

  function toggle() {
    const v = videoRef.current
    if (!v) return
    if (playing) { pause(); return }
    if (tRef.current >= lengthMs - 1) tRef.current = 0
    const t = tRef.current
    const want = startMs + toVideo(t)
    if (Math.abs(v.currentTime * 1000 - want) > 100) v.currentTime = want / 1000
    const at = pieces.length ? pieceAt(pieces, t) : null
    if (at?.hold != null) {
      // Starting in a video put in between: the clock plays it, the source waits
      holdRef.current = { piece: at, wall: performance.now() - (t - at.at) }
      setPlaying(true)
      return
    }
    holdRef.current = null
    rateFor(v, at)
    v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }

  function seekTo(fraction: number) {
    const v = videoRef.current
    if (!v) return
    const t = fraction * lengthMs
    tRef.current = t
    v.currentTime = (startMs + toVideo(t)) / 1000
    const p = pieces.length ? pieceAt(pieces, t) : null
    const held = p?.hold != null ? p : null
    holdRef.current = held && playing ? { piece: held, wall: performance.now() - (t - held.at) } : null
    if (playing) { if (held) v.pause(); else v.play().catch(() => {}) }
    setTMs(t)
    syncStock(t, playing)
    syncBorrowed(t, playing)
  }

  const fmt = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

  return (
    <div ref={boxRef} className={full ? 'flex items-center justify-center bg-black' : 'w-full'}
      style={full === 'window' ? { position: 'fixed', inset: 0, zIndex: 300 } : full ? { width: '100%', height: '100%' } : undefined}>
    <div className={`relative overflow-hidden bg-black ${full ? 'h-full' : 'w-full rounded-xl'}`} style={{ aspectRatio: '9 / 16', ...(full ? { maxWidth: '100%' } : {}) }}>
      {/* The source video, drawn onto the 9:16 canvas below (kept in the page so it decodes) */}
      <video
        ref={videoRef}
        src={near && videoUrl ? `${videoUrl}#t=${startMs / 1000}` : undefined}
        preload={near ? 'auto' : 'none'}
        playsInline
        onLoadedData={() => setReady(true)}
        onSeeked={() => setReady(true)}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
      {/* (B-roll: only its first picture until the clip plays, then all of it) */}
      {near && Object.entries(stockUrls).map(([id, url]) => (
        <video key={id} ref={el => { stockRefs.current[id] = el }} src={url} muted playsInline preload={playing ? 'auto' : 'metadata'}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
      ))}
      <OutputCanvas
        videoRef={videoRef} currentTimeMs={tMs} clipStartMs={startMs}
        // (videos put in between: the clip's own clock and time map, the source waits during one)
        {...(pieces.length ? {
          clock: () => tRef.current,
          videoToTimeline: (v: number) => timelineAtPieces(pieces, v - startMs),
          timelineToVideo: (t: number) => startMs + videoAtPieces(pieces, t),
        } : {})}
        activeSegment={activeSegment} getPositionAt={getPositionAt}
        segmentAt={segmentAt} hardCuts sourceFor={sourceFor} slotSourceFor={slotSourceFor} frameMedia={framePool}
        words={shownWords} captionStyle={captionStyle ?? {}} showCaptions={showCaptions}
        textOverlays={textOverlays}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
      {/* Pictures on top (a brand kit's logo, photos): where, how big, how see-through and how turned
          the export draws them (render.py image overlays), the higher z_index over the lower; only to
          look at here (the editor moves them) */}
      {overlays.filter(o => o.preview_url && o.start_ms <= tMs && tMs < o.end_ms).map(o => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={o.id} src={o.preview_url} alt="" draggable={false} aria-hidden="true"
          style={{
            position: 'absolute', left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%`,
            objectFit: 'fill', pointerEvents: 'none', opacity: o.opacity ?? 1,
            ...(o.rotation ? { transform: `rotate(${o.rotation}deg)` } : {}),
          }} />
      ))}
      {/* Play / pause over the whole picture */}
      <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}
        className="absolute inset-0 flex items-center justify-center transition-opacity"
        style={{ background: playing ? 'transparent' : 'rgba(0,0,0,0.25)' }}>
        {!playing && (
          <span className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
            {ready
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="white" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              : <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          </span>
        )}
      </button>
      {/* Progress: click to jump */}
      <div className="absolute left-0 right-0 bottom-0 px-2 pb-2 pt-4 flex items-center gap-2"
        style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.6))' }}>
        <div className="flex-1 h-1.5 rounded-full cursor-pointer" style={{ background: 'rgba(255,255,255,0.25)' }}
          onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seekTo(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))) }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, (tMs / lengthMs) * 100)}%`, background: '#c8ff00' }} />
        </div>
        <span className={`${full ? 'text-xs' : 'text-[10px]'} tabular-nums text-white/80`}>{fmt(tMs)} / {fmt(lengthMs)}</span>
        <button type="button" onClick={toggleFull} aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen (Esc)' : 'Full screen'}
          className="shrink-0 -my-1 -mr-1 w-7 h-7 grid place-items-center rounded-md text-white/85 transition-colors hover:bg-white/15 hover:text-white">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={full
              ? 'M9 4v4a1 1 0 0 1-1 1H4M15 4v4a1 1 0 0 0 1 1h4M9 20v-4a1 1 0 0 0-1-1H4M15 20v-4a1 1 0 0 1 1-1h4'
              : 'M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4'} />
          </svg>
        </button>
      </div>
    </div>
    </div>
  )
}
