'use client'

import { useEffect, useRef, useState } from 'react'
import { EmptyState } from './EditorTour'
import { VideoThumbnails } from './SegmentTimeline'

const muted = (a: number) => `rgb(var(--ed-fg) / ${a})`
const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 100) / 10); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` }
const VIDEO_COLOR = '#f97316'
const BROLL_COLOR = '#eab308'
/** Width of the drag handles at a part's ends (px) */
const HANDLE_W = 10
// The settings of a picked video, one kind at a time (the last one opened stays open for the next)
type SettingsTab = 'position' | 'trim' | 'sound'
const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; tip: string }> = [
  { id: 'position', label: 'Position', tip: 'Where it plays in the clip' },
  { id: 'trim', label: 'Trim', tip: 'Which part of the video plays' },
  { id: 'sound', label: 'Sound', tip: 'Its own sound, or the speaker under it' },
]
let lastTab: SettingsTab = 'position'
/** Shortest a video on top can be (the timeline lane uses the same) */
export const MIN_VIDEO_MS = 500

/** A video put over the clip (B-roll or one the user added), as the panel shows it */
export interface PanelVideo {
  id: string
  title: string
  url?: string
  /** Where it plays in the clip (clip ms) */
  start_ms: number
  end_ms: number
  /** Where in its own video it starts (ms) */
  source_offset_ms: number
  /** The whole video's length, when known */
  source_ms?: number | null
  /** Its own sound: off (the speaker carries on under it) unless switched on */
  muted: boolean
  volume: number
  hidden: boolean
  locked: boolean
}

/**
 * Video: everything about one video put over the clip, and two small timelines to adjust it.
 *  - "In the clip": where it plays. Drag the block to move it, its ends to make it start / end
 *    earlier or later.
 *  - "From the video": which part of the video plays. Drag the window to show another part (it
 *    keeps its place in the clip), its ends to trim the video's start or end.
 * Every change goes through the editor's own actions, so locks, undo and saving work as for the
 * timeline.
 */
export function VideoPanel({ kind = 'video', videos, selectedId, clipLengthMs, currentTimeMs, onSelect, onSeek, onRetime, onSlip, onSound, onToggle, onRemove, onAdd }: {
  /** 'video': the user's own videos (Video panel); 'broll': stock footage (under the B-roll search) */
  kind?: 'video' | 'broll'
  videos: PanelVideo[]
  selectedId: string | null
  clipLengthMs: number
  currentTimeMs: number
  onSelect: (id: string) => void
  onSeek: (ms: number) => void
  /** New place in the clip. `moved`: the whole video moved (it shows the same pictures); otherwise an end was trimmed */
  onRetime: (id: string, startMs: number, endMs: number, moved: boolean) => void
  /** Another part of the video plays from where it starts in the clip */
  onSlip: (id: string, sourceOffsetMs: number) => void
  onSound: (id: string, patch: { muted?: boolean; volume?: number }) => void
  onToggle: (id: string, key: 'hidden' | 'locked') => void
  onRemove: (id: string) => void
  /** The "+ Add a video" button (the B-roll panel adds from its search instead) */
  onAdd?: () => void
}) {
  const broll = kind === 'broll'
  const color = broll ? BROLL_COLOR : VIDEO_COLOR
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selectedId) listRef.current?.querySelector(`[data-video-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])
  const sorted = [...videos].sort((a, b) => a.start_ms - b.start_ms)

  return (
    <div className="flex flex-col gap-3 p-4">
      {onAdd && (
        <button onClick={onAdd}
          className="py-2 rounded-lg text-sm font-medium text-[var(--ed-text)] transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)]"
          style={{ background: muted(0.04), border: `1px dashed ${muted(0.2)}` }}>
          + Add a video at {fmt(currentTimeMs)}
        </button>
      )}
      {broll && sorted.length > 0 && <span className="text-xs font-medium" style={{ color: muted(0.5) }}>B-roll in this clip</span>}

      {sorted.length === 0 ? (broll ? null : (
        <EmptyState icon={<><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" /></>}
          title="No videos on this clip yet" tip="Add one from your computer or your videos: above, or with the + on the Videos lane of the timeline. Its settings open here." />
      )) : (
        <div ref={listRef} className="flex flex-col gap-2">
          {sorted.map((v, i) => {
            const on = v.id === selectedId
            return (
              <div key={v.id} data-video-id={v.id} className="flex flex-col rounded-lg overflow-hidden"
                style={{ background: muted(on ? 0.07 : 0.04), boxShadow: on ? `inset 0 0 0 1.5px ${color}` : `inset 0 0 0 1px ${muted(0.08)}` }}>
                <div role="button" tabIndex={0} aria-pressed={on}
                  onClick={() => { onSelect(v.id); onSeek(v.start_ms) }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(v.id); onSeek(v.start_ms) } }}
                  className="flex items-center gap-2.5 px-2 py-2 cursor-pointer">
                  <span className="relative w-14 h-10 rounded-md shrink-0 overflow-hidden" style={{ background: muted(0.1) }}>
                    {v.url && <VideoThumbnails videoUrl={v.url} startMs={v.source_offset_ms} durationMs={Math.max(1, v.end_ms - v.start_ms)} count={1} radius={6} dim={false} />}
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="text-[13px] font-medium text-[var(--ed-text)] truncate">{v.title || `${broll ? 'B-roll' : 'Video'} ${i + 1}`}</span>
                    <span className="text-[11px] tabular-nums" style={{ color: muted(0.5) }}>
                      {fmt(v.start_ms)} → {fmt(v.end_ms)} · {((v.end_ms - v.start_ms) / 1000).toFixed(1)} s
                      {v.hidden ? ' · hidden' : ''}{v.locked ? ' · locked' : ''}
                    </span>
                  </span>
                  <button onClick={e => { e.stopPropagation(); onRemove(v.id) }} aria-label={broll ? 'Delete this B-roll' : 'Delete this video'} title={broll ? 'Delete this B-roll' : 'Delete this video'}
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-xs transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
                    style={{ color: muted(0.5) }}>✕</button>
                </div>
                {on && <VideoSettings v={v} color={color} clipLengthMs={clipLengthMs} currentTimeMs={currentTimeMs}
                  onSeek={onSeek} onRetime={onRetime} onSlip={onSlip} onSound={onSound} onToggle={onToggle} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function VideoSettings({ v, color, clipLengthMs, currentTimeMs, onSeek, onRetime, onSlip, onSound, onToggle }: {
  v: PanelVideo
  color: string
  clipLengthMs: number
  currentTimeMs: number
  onSeek: (ms: number) => void
  onRetime: (id: string, startMs: number, endMs: number, moved: boolean) => void
  onSlip: (id: string, sourceOffsetMs: number) => void
  onSound: (id: string, patch: { muted?: boolean; volume?: number }) => void
  onToggle: (id: string, key: 'hidden' | 'locked') => void
}) {
  const len = v.end_ms - v.start_ms
  // The video's own length: as saved, else read from the file
  const [readMs, setReadMs] = useState<number | null>(null)
  useEffect(() => {
    if (v.source_ms || !v.url) return
    const el = document.createElement('video')
    el.preload = 'metadata'
    el.muted = true
    el.onloadedmetadata = () => { if (isFinite(el.duration)) setReadMs(Math.round(el.duration * 1000)) }
    el.src = v.url
    return () => { el.removeAttribute('src'); el.load() }
  }, [v.url, v.source_ms])
  const sourceMs = v.source_ms || readMs
  const playsTo = v.source_offset_ms + len
  // Past the end of its video, the video starts again from its beginning in the export
  const runsOut = !!sourceMs && playsTo > sourceMs + 50
  const locked = v.locked

  const nudge = (which: 'start' | 'end', d: number) => {
    if (which === 'start') onRetime(v.id, Math.max(0, Math.min(v.end_ms - MIN_VIDEO_MS, v.start_ms + d)), v.end_ms, false)
    else onRetime(v.id, v.start_ms, Math.min(clipLengthMs, Math.max(v.start_ms + MIN_VIDEO_MS, v.end_ms + d, )), false)
  }
  const fitVideo = () => sourceMs && onRetime(v.id, v.start_ms, Math.min(clipLengthMs, v.start_ms + Math.max(MIN_VIDEO_MS, sourceMs - v.source_offset_ms)), false)

  const [tab, setTabState] = useState<SettingsTab>(lastTab)
  const setTab = (t: SettingsTab) => { lastTab = t; setTabState(t) }
  // The bar is the video itself; when the clip part runs past its end, only the part it has is bright
  const shownTo = sourceMs ? Math.min(playsTo, sourceMs) : playsTo
  const btnStyle = { color: muted(0.75), boxShadow: `inset 0 0 0 1px ${muted(0.12)}` }

  return (
    <div className="flex flex-col gap-3 px-3 pb-3 pt-2" style={{ borderTop: `1px solid ${muted(0.07)}` }}>
      {locked && <p className="text-[11px]" style={{ color: 'var(--ed-accent-text)' }}>Locked: unlock it below to change it.</p>}

      {/* Its settings, one kind at a time (like other editors): where it plays, which part of it, its sound */}
      <div role="tablist" aria-label="Settings of this video" className="grid grid-cols-3 gap-0.5 p-0.5 rounded-lg" style={{ background: muted(0.06) }}>
        {SETTINGS_TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} title={t.tip}
            className="h-7 rounded-md text-[11px] font-semibold transition-colors"
            style={tab === t.id ? { background: muted(0.16), color: 'var(--ed-text)' } : { color: muted(0.55) }}>
            {t.label}{t.id === 'trim' && runsOut ? ' •' : ''}
          </button>
        ))}
      </div>

      {tab === 'position' && (
        <section role="tabpanel" aria-label="Position" className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-semibold" style={{ color: muted(0.7) }}>In the clip</span>
            <span className="text-[11px] tabular-nums" style={{ color: muted(0.5) }}>{fmt(v.start_ms)} – {fmt(v.end_ms)} of {fmt(clipLengthMs)}</span>
          </div>
          <RangeTrack label="Where the video plays in the clip" total={clipLengthMs} from={v.start_ms} to={v.end_ms} now={currentTimeMs}
            disabled={locked} minLen={MIN_VIDEO_MS} color={color}
            onChange={(a, b, kind) => onRetime(v.id, a, b, kind === 'move')}
            onDone={a => onSeek(a)} />
          <p className="text-[10.5px] leading-snug" style={{ color: muted(0.45) }}>Drag it to move it in the clip; drag its ends to start or end it earlier or later.</p>
          <div className="grid grid-cols-2 gap-2">
            <EdgeField label="Starts at" value={v.start_ms} disabled={locked} onNudge={d => nudge('start', d)} onPlayhead={() => onRetime(v.id, Math.min(currentTimeMs, v.end_ms - MIN_VIDEO_MS), v.end_ms, false)} />
            <EdgeField label="Ends at" value={v.end_ms} disabled={locked} onNudge={d => nudge('end', d)} onPlayhead={() => onRetime(v.id, v.start_ms, Math.max(currentTimeMs, v.start_ms + MIN_VIDEO_MS), false)} />
          </div>
          <p className="text-[11px] tabular-nums" style={{ color: muted(0.55) }}>Length {(len / 1000).toFixed(1)} s</p>
        </section>
      )}

      {tab === 'trim' && (
        <section role="tabpanel" aria-label="Trim" className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-semibold" style={{ color: muted(0.7) }}>From the video</span>
            <span className="text-[11px] tabular-nums" style={{ color: muted(0.5) }}>
              {fmt(v.source_offset_ms)} – {fmt(shownTo)}{sourceMs ? ` of ${fmt(sourceMs)}` : ''}
            </span>
          </div>
          {sourceMs ? (
            <RangeTrack label="Which part of the video plays" total={sourceMs} from={Math.min(v.source_offset_ms, sourceMs - 1)} to={shownTo}
              disabled={locked} minLen={Math.min(MIN_VIDEO_MS, sourceMs)} thumbs={v.url} color="#fdba74"
              onChange={(a, b, kind) => {
                // Sliding the window shows another part from the same place in the clip; its ends trim the video
                if (kind === 'move') { if (!runsOut) onSlip(v.id, a) }
                else if (kind === 'start') onRetime(v.id, Math.max(0, v.start_ms + (a - v.source_offset_ms)), v.end_ms, false)
                else onRetime(v.id, v.start_ms, Math.min(clipLengthMs, v.start_ms + (b - a)), false)
              }}
              onDone={() => onSeek(v.start_ms)} />
          ) : <div className="h-11 rounded-md" style={{ background: muted(0.06) }} />}
          <p className="text-[10.5px] leading-snug" style={{ color: muted(0.45) }}>
            The whole video is the bar. Drag the bright part to pick which moment shows; drag its ends to cut the video&apos;s start or end.
          </p>
          {runsOut && (
            <div className="flex items-center gap-2 text-[11px] rounded-md px-2 py-1.5" style={{ background: 'rgba(251,191,36,0.08)', color: '#fcd34d' }}>
              <span className="flex-1">The video is {fmt(sourceMs!)} long but plays for {fmt(len)} here: for the last {fmt(playsTo - sourceMs!)} it starts again from its beginning.</span>
              {!locked && <button type="button" onClick={fitVideo} className="shrink-0 rounded px-2 py-0.5 font-semibold" style={{ border: '1px solid rgba(251,191,36,0.4)' }} title="Make it as long as what is left of the video">Fit</button>}
            </div>
          )}
        </section>
      )}

      {tab === 'sound' && (
        <section role="tabpanel" aria-label="Sound" className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-1">
            {([[true, 'Speaker keeps talking'], [false, 'Video\u2019s own sound']] as const).map(([m, label]) => (
              <button key={label} type="button" disabled={locked} aria-pressed={v.muted === m} onClick={() => onSound(v.id, { muted: m })}
                className="h-8 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-50"
                style={v.muted === m ? { background: muted(0.14), color: 'var(--ed-text)' } : { color: muted(0.6), boxShadow: `inset 0 0 0 1px ${muted(0.12)}` }}>
                {label}
              </button>
            ))}
          </div>
          {v.muted ? (
            <p className="text-[10.5px] leading-snug" style={{ color: muted(0.45) }}>The video is silent; the speaker keeps talking under it.</p>
          ) : (
            <label className="flex items-center gap-2 text-[11px]" style={{ color: muted(0.55) }}>
              <span className="shrink-0 w-12">Volume</span>
              <input type="range" min={0} max={100} step={1} value={Math.round(v.volume * 100)} disabled={locked} aria-label="Volume of the video"
                onChange={e => onSound(v.id, { volume: Number(e.target.value) / 100 })}
                className="ed-zoom-range flex-1" style={{ '--p': `${Math.round(v.volume * 100)}%` } as React.CSSProperties} />
              <span className="w-9 text-right tabular-nums">{Math.round(v.volume * 100)}%</span>
            </label>
          )}
        </section>
      )}

      {/* Always at hand, whatever tab is open */}
      <div className="grid grid-cols-3 gap-1 pt-2" style={{ borderTop: `1px solid ${muted(0.06)}` }}>
        <button type="button" onClick={() => onSeek(v.start_ms)}
          className="h-8 rounded-md text-[11px] font-semibold transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)]" style={btnStyle}>
          Go to start
        </button>
        <button type="button" disabled={locked} onClick={() => onToggle(v.id, 'hidden')} aria-pressed={v.hidden}
          className="h-8 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-50"
          style={v.hidden ? { background: 'rgba(239,68,68,0.12)', color: '#f87171' } : btnStyle}>
          {v.hidden ? 'Show' : 'Hide'}
        </button>
        <button type="button" onClick={() => onToggle(v.id, 'locked')} aria-pressed={v.locked}
          className="h-8 rounded-md text-[11px] font-semibold transition-colors"
          style={v.locked ? { background: 'rgba(200,255,0,0.12)', color: 'var(--ed-accent-text)' } : btnStyle}>
          {v.locked ? 'Unlock' : 'Lock'}
        </button>
      </div>
    </div>
  )
}

/** A time with buttons to move it a little, or to the playhead */
function EdgeField({ label, value, disabled, onNudge, onPlayhead }: { label: string; value: number; disabled: boolean; onNudge: (d: number) => void; onPlayhead: () => void }) {
  const btn = 'w-6 h-6 flex items-center justify-center rounded text-[11px] font-bold transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)] disabled:opacity-40'
  return (
    <div className="flex flex-col gap-1 rounded-md px-2 py-1.5" style={{ boxShadow: `inset 0 0 0 1px ${muted(0.1)}` }}>
      <span className="text-[10px]" style={{ color: muted(0.5) }}>{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" className={btn} disabled={disabled} onClick={() => onNudge(-100)} aria-label={`${label}: 0.1 s earlier`} title="0.1 s earlier">‹</button>
        <span className="flex-1 text-center text-[12.5px] font-semibold tabular-nums text-[var(--ed-text)]">{fmt(value)}</span>
        <button type="button" className={btn} disabled={disabled} onClick={() => onNudge(100)} aria-label={`${label}: 0.1 s later`} title="0.1 s later">›</button>
      </div>
      <button type="button" disabled={disabled} onClick={onPlayhead}
        className="text-[10px] font-semibold rounded py-0.5 transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)] disabled:opacity-40" style={{ color: muted(0.6) }}>
        Set to playhead
      </button>
    </div>
  )
}

/**
 * A small timeline: a bar `total` ms long with the part [from, to) bright. Drag the part to move
 * it, its ends to change one side. Changes are sent live while dragging (rounded to 0.1 s).
 */
export function RangeTrack({ label, total, from, to, now, minLen, disabled, thumbs, color = VIDEO_COLOR, onChange, onDone }: {
  label: string
  total: number
  from: number
  to: number
  now?: number
  minLen: number
  disabled: boolean
  /** A video file: its frames under the bar */
  thumbs?: string
  color?: string
  onChange: (from: number, to: number, kind: 'move' | 'start' | 'end') => void
  onDone?: (from: number, to: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<'move' | 'start' | 'end' | null>(null)
  const pct = (ms: number) => `${Math.max(0, Math.min(100, (ms / Math.max(1, total)) * 100))}%`

  function down(e: React.PointerEvent, kind: 'move' | 'start' | 'end') {
    if (disabled || e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const rect = ref.current!.getBoundingClientRect()
    const x0 = e.clientX, a0 = from, b0 = to, len = to - from
    let last = { a: from, b: to }
    setDragging(kind)
    const move = (ev: PointerEvent) => {
      const d = Math.round(((ev.clientX - x0) / rect.width) * total / 100) * 100
      let a = a0, b = b0
      if (kind === 'move') { a = Math.max(0, Math.min(total - len, a0 + d)); b = a + len }
      else if (kind === 'start') a = Math.max(0, Math.min(b0 - minLen, a0 + d))
      else b = Math.min(total, Math.max(a0 + minLen, b0 + d))
      if (a === last.a && b === last.b) return
      last = { a, b }
      onChange(a, b, kind)
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setDragging(null)
      onDone?.(last.a, last.b)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // The handles sit just outside the part's ends, so a short part can still be grabbed in the
  // middle to move it; the bar has room for them at its own ends (HANDLE_W of padding)
  return (
    <div role="group" aria-label={label} className="relative h-11 rounded-md select-none"
      style={{ background: muted(0.07), opacity: disabled ? 0.55 : 1, touchAction: 'none', padding: `0 ${HANDLE_W}px` }}>
      <div ref={ref} className="relative h-full">
        {thumbs && <span className="absolute inset-0 pointer-events-none opacity-35 overflow-hidden"><VideoThumbnails videoUrl={thumbs} startMs={0} durationMs={total} count={8} radius={4} dim={false} /></span>}
        {now !== undefined && <span className="absolute top-0 bottom-0 w-px pointer-events-none" style={{ left: pct(now), background: 'rgba(255,255,255,0.6)', zIndex: 3 }} />}
        <div onPointerDown={e => down(e, 'move')} aria-label={`${label}: drag to move`} title="Drag to move"
          className="absolute top-0 bottom-0"
          style={{
            left: pct(from), width: pct(to - from), minWidth: 4, zIndex: 2,
            background: `${color}66`, boxShadow: `inset 0 0 0 2px ${color}`, cursor: disabled ? 'not-allowed' : dragging === 'move' ? 'grabbing' : 'grab',
          }}>
          {(['start', 'end'] as const).map(edge => (
            <span key={edge} onPointerDown={e => down(e, edge)} role="slider" aria-label={`${label}: drag the ${edge}`} aria-valuenow={edge === 'start' ? from : to}
              title={edge === 'start' ? 'Drag to change the start' : 'Drag to change the end'}
              className="absolute top-0 bottom-0 flex items-center justify-center"
              style={{
                [edge === 'start' ? 'right' : 'left']: '100%', width: HANDLE_W, cursor: disabled ? 'not-allowed' : 'ew-resize', background: color,
                borderRadius: edge === 'start' ? '5px 0 0 5px' : '0 5px 5px 0',
              }}>
              <span className="block w-0.5 h-4 rounded-full" style={{ background: 'rgba(0,0,0,0.55)' }} />
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
