'use client'

import { useEffect, useState } from 'react'
import type { FrameItem, SegmentLocal } from '@chai-cut/shared'
import { frameOf, itemBounds, MIN_ITEM_MS } from '@/modules/editor/frames'

type TimePatch = Partial<Pick<FrameItem, 'start_ms' | 'end_ms' | 'source_offset_ms'>>

/** Start and end of a frame lane item: type a time, or set it to the playhead. Stays inside its frame and off its neighbours. */
export function ItemTimeRange({ item, segment, currentTimeMs, onChange }: {
  item: FrameItem
  segment: SegmentLocal
  currentTimeMs: number
  onChange: (patch: TimePatch) => void
}) {
  const { min, max } = itemBounds(frameOf(segment), item, segment)
  const start = Math.max(item.start_ms, segment.start_ms)
  const end = Math.min(item.end_ms, segment.end_ms)

  function setStart(ms: number) {
    const t = Math.round(Math.max(min, Math.min(end - MIN_ITEM_MS, ms)))
    // A video keeps showing the same moment at its end: move where it starts in the source too
    const off = item.kind === 'video' ? { source_offset_ms: Math.max(0, (item.source_offset_ms ?? 0) + (t - item.start_ms)) } : {}
    onChange({ start_ms: t, ...off })
  }
  function setEnd(ms: number) {
    onChange({ end_ms: Math.round(Math.min(max, Math.max(start + MIN_ITEM_MS, ms))) })
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <TimeField label="Starts" ms={start} onCommit={setStart} onNow={() => setStart(currentTimeMs)} />
      <TimeField label="Ends" ms={end} onCommit={setEnd} onNow={() => setEnd(currentTimeMs)} />
    </div>
  )
}

/** Start and end of any timed item (photo, text…): type a time, or set it to the playhead */
export function TimeRange({ startMs, endMs, currentTimeMs, onStart, onEnd }: {
  startMs: number
  endMs: number
  currentTimeMs: number
  onStart: (ms: number) => void
  onEnd: (ms: number) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <TimeField label="Starts" ms={startMs} onCommit={onStart} onNow={() => onStart(currentTimeMs)} />
      <TimeField label="Ends" ms={endMs} onCommit={onEnd} onNow={() => onEnd(currentTimeMs)} />
    </div>
  )
}

export function TimeField({ label, ms, onCommit, onNow }: { label: string; ms: number; onCommit: (ms: number) => void; onNow: () => void }) {
  const [draft, setDraft] = useState(format(ms))
  useEffect(() => { setDraft(format(ms)) }, [ms])
  function commit() {
    const t = parse(draft)
    if (t === null) setDraft(format(ms))
    else onCommit(t)
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
        {label} <span style={{ color: 'rgb(var(--ed-fg) / 0.35)' }}>(min:sec)</span>
      </span>
      <div className="flex items-center gap-1">
        <input value={draft} inputMode="decimal" aria-label={`${label} at (minutes:seconds)`}
          onChange={e => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
          className="w-full min-w-0 h-7 px-2 rounded-md text-xs tabular-nums outline-none text-[var(--ed-text)]"
          style={{ background: 'rgb(var(--ed-fg) / 0.06)', border: '1px solid rgb(var(--ed-fg) / 0.12)' }} />
        <button onClick={onNow} title={`${label} at the playhead`} aria-label={`${label} at the playhead`}
          className="h-7 px-1.5 shrink-0 rounded-md text-[10px] font-semibold transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
          style={{ color: 'rgb(var(--ed-fg) / 0.6)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)' }}>
          Now
        </button>
      </div>
    </div>
  )
}

/** 65400 → "01:05.4" — two-digit minutes, so "0:03.0" isn't read as hours (user, 2026-11-09) */
function format(ms: number) {
  const tenths = Math.round(ms / 100)
  const m = Math.floor(tenths / 600)
  const s = (tenths % 600) / 10
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}

/** 65400 → "01:05" — the same clock without tenths, for buttons and tips next to these fields */
export function clockLabel(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** "01:05.4", "1:05.4", "65.4" or "65" → ms */
function parse(v: string): number | null {
  const t = v.trim()
  const m = /^(?:(\d+):)?(\d+(?:\.\d*)?)$/.exec(t)
  if (!m) return null
  return Math.round(((m[1] ? Number(m[1]) * 60 : 0) + Number(m[2])) * 1000)
}
