'use client'

import { useEffect, useRef, useState } from 'react'
import { RangeTrack, MIN_VIDEO_MS } from './VideoPanel'

/** The part of a video picked to go in: from / to, in the video's own time (ms) */
export interface VideoPart { from_ms: number; to_ms: number }

const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 100) / 10); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` }
// The window is always dark: the bar's own colours (--ed-fg) are set to white inside it
const DARK_FG = { ['--ed-fg' as string]: '255 255 255' } as React.CSSProperties

/**
 * Before a video goes into a frame's slot or the Videos lane (user, 2026-11-05): play it and
 * pick the part that goes in — the bright part of the bar, its ends dragged to set the start and
 * end. That part plays from where it goes in, as long as it is; where there's less room (the next
 * item on the lane, the frame's end) it's cut there. "Use whole video" puts it in as before.
 */
export function VideoPartChooser({ url, durationMs, roomMs, initial, confirmLabel = 'Insert selected part', onConfirm, onWhole, onBack }: {
  url: string
  /** The video's length if known (the player's own reading wins) */
  durationMs?: number | null
  /** How long it can play where it goes (null: no limit) */
  roomMs?: number | null
  /** The part picked before ("Change part") */
  initial?: VideoPart
  confirmLabel?: string
  onConfirm: (part: VideoPart) => void
  /** Absent: no "Use whole video" button */
  onWhole?: () => void
  onBack?: () => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [total, setTotal] = useState<number | null>(durationMs ?? null)
  const [part, setPart] = useState<VideoPart | null>(null)
  const [now, setNow] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const partRef = useRef(part)
  partRef.current = part

  // The first part: the one picked before, else from the start for as long as there's room
  useEffect(() => {
    if (!total || part) return
    const from = Math.min(initial?.from_ms ?? 0, Math.max(0, total - MIN_VIDEO_MS))
    const to = Math.min(total, initial ? initial.to_ms : from + (roomMs ?? total))
    setPart({ from_ms: from, to_ms: Math.max(Math.min(total, from + MIN_VIDEO_MS), to) })
    seek(from)
  }, [total]) // eslint-disable-line react-hooks/exhaustive-deps

  // Playing stops at the part's end (and goes back to its start)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const v = ref.current, p = partRef.current
      if (!v || !p) return
      const t = v.currentTime * 1000
      setNow(t)
      if (t >= p.to_ms) { v.pause(); setPlaying(false); seek(p.from_ms); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  function seek(ms: number) {
    const v = ref.current
    if (!v) return
    v.currentTime = ms / 1000
    setNow(ms)
  }
  function togglePlay() {
    const v = ref.current
    if (!v || !part) return
    if (playing) { v.pause(); setPlaying(false); return }
    if (now < part.from_ms || now >= part.to_ms - 50) seek(part.from_ms)
    v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }

  const len = part ? part.to_ms - part.from_ms : 0
  const cut = part && roomMs != null && len > roomMs

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3" style={DARK_FG}>
      {onBack && (
        <button type="button" onClick={onBack} className="self-start text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>← Back</button>
      )}
      <div className="relative rounded-xl overflow-hidden" style={{ aspectRatio: '16/9', background: '#000' }}>
        <video ref={ref} src={url} preload="auto" playsInline className="w-full h-full object-contain"
          onLoadedMetadata={e => {
            const d = e.currentTarget.duration
            if (isFinite(d) && d > 0) setTotal(Math.round(d * 1000))
            // (a part picked before the video loaded: show its first frame)
            if (partRef.current) seek(partRef.current.from_ms)
          }}
          onError={() => setFailed(true)}
          onPause={() => setPlaying(false)} />
        {part && (
          <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play the part'}
            className="absolute left-2 bottom-2 flex items-center justify-center rounded-full"
            style={{ width: 32, height: 32, background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.2)' }}>
            {playing
              ? <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1" width="2.5" height="8" fill="white"/><rect x="6" y="1" width="2.5" height="8" fill="white"/></svg>
              : <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1l7 4-7 4V1z" fill="white"/></svg>}
          </button>
        )}
      </div>

      {failed ? (
        <p className="text-xs" style={{ color: '#f87171' }}>This video can&apos;t be played here, so a part can&apos;t be picked. It can still go in whole.</p>
      ) : !part || !total ? (
        <div className="h-11 rounded-md" style={{ background: 'rgba(255,255,255,0.06)' }} />
      ) : (
        <>
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>Pick the part</span>
            <span className="text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {fmt(part.from_ms)} – {fmt(part.to_ms)} · {(len / 1000).toFixed(1)} s of {fmt(total)}
            </span>
          </div>
          <RangeTrack label="Which part of the video goes in" total={total} from={part.from_ms} to={part.to_ms} now={now}
            minLen={Math.min(MIN_VIDEO_MS, total)} disabled={false} thumbs={url}
            onChange={(a, b, kind) => {
              if (playing) { ref.current?.pause(); setPlaying(false) }
              setPart({ from_ms: a, to_ms: b })
              seek(kind === 'end' ? Math.max(a, b - 40) : a)
            }} />
          <p className="text-[10.5px] leading-snug" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Drag the ends to set where it starts and ends; drag the bright part to move it.
          </p>
          {cut && (
            <p className="text-[11px] rounded-md px-2 py-1.5" style={{ background: 'rgba(251,191,36,0.08)', color: '#fcd34d' }}>
              Only {(roomMs! / 1000).toFixed(1)} s fit here: it&apos;s cut at {fmt(part.from_ms + roomMs!)}.
            </p>
          )}
        </>
      )}

      <div className="flex gap-2" style={{ marginTop: 'auto' }}>
        {onWhole && (
          <button type="button" onClick={onWhole}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
            Use whole video
          </button>
        )}
        <button type="button" onClick={() => part && onConfirm(part)} disabled={!part || failed}
          className="flex-1 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40" style={{ background: '#c8ff00', color: '#000' }}>
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}

/** The chooser on its own (a video put in from the Media library, dropped, or "Change part") */
export function VideoPartModal({ title = 'Choose the part', onClose, ...props }: React.ComponentProps<typeof VideoPartChooser> & { title?: string; onClose: () => void }) {
  const backdropRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={backdropRef} className="fixed inset-0 z-[120] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === backdropRef.current) onClose() }}>
      <div className="flex flex-col rounded-2xl overflow-hidden"
        style={{ width: 400, maxHeight: '80vh', background: '#1c1c1c', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 32px 80px rgba(0,0,0,0.7)' }}>
        <div className="shrink-0 flex items-center justify-between px-4 pt-4 pb-2">
          <p className="text-sm font-bold text-white">{title}</p>
          <button onClick={onClose} aria-label="Close" className="flex items-center justify-center rounded-xl" style={{ width: 30, height: 30, background: 'rgba(255,255,255,0.07)' }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
        <VideoPartChooser {...props} />
      </div>
    </div>
  )
}
