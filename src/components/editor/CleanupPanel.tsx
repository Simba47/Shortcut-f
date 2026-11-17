'use client'

import { Spinner } from '@/components/ui/spinner'
import { useEffect, useRef, useState } from 'react'
import type { CleanupCard, CleanupKind } from '@/modules/editor/cleanup'

/**
 * The Cleanup tool (user, 2026-10-18): Detect lists the clip's silences, filler words and repeated
 * words as cards. Each plays on its own and can be deleted (cut out of the clip); a deleted card
 * stays, greyed, with Restore. Delete all takes every card still there; Undo (here, the editor's
 * arrow, Ctrl+Z) brings back what went.
 */

export interface CleanupRow extends CleanupCard {
  deleted: boolean
  /** Where it is in the clip as it plays now (timeline ms) */
  at: number
}

const KIND: Record<CleanupKind, { name: string; color: string }> = {
  silence: { name: 'Silence', color: '#7dd3fc' },
  filler: { name: 'Filler', color: '#fbbf24' },
  repeat: { name: 'Repeat', color: '#c4b5fd' },
}

const fmt = (ms: number) => {
  const s = Math.max(0, ms) / 1000
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
}

export function CleanupPanel({ rows, detected, working, error, blockedNote, onDetect, onPlay, onDelete, onRestore, onDeleteAll, onUndo }: {
  rows: CleanupRow[]
  /** Detect has been run for this clip (the list is there, even when it's empty) */
  detected: boolean
  /** What Detect is doing now (null: nothing) */
  working: string | null
  error: string | null
  /** Why cards can't be deleted or restored here (they can still be played); null: they can */
  blockedNote: string | null
  onDetect: () => void
  onPlay: (row: CleanupRow) => void
  onDelete: (row: CleanupRow) => void
  onRestore: (row: CleanupRow) => void
  onDeleteAll: () => void
  onUndo: () => void
}) {
  // "Deleted · Undo" for a few seconds after a delete
  const [undoNote, setUndoNote] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const flash = (text: string) => {
    setUndoNote(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setUndoNote(null), 6000)
  }

  const left = rows.filter(r => !r.deleted)
  const leftMs = left.reduce((s, r) => s + (r.b - r.a), 0)
  const goneMs = rows.filter(r => r.deleted).reduce((s, r) => s + (r.b - r.a), 0)
  const muted = 'rgb(var(--ed-fg) / 0.5)'

  return (
    <div className="flex flex-col gap-3 p-4 min-h-0">
      <p className="text-xs leading-relaxed" style={{ color: muted }}>
        Find the silences, filler words (um, uh, matlab, ante…) and repeated words in this clip. Play each one, and delete what you don&rsquo;t want.
      </p>

      <button type="button" onClick={onDetect} disabled={!!working}
        className="h-10 flex items-center justify-center gap-2 rounded-lg text-[13px] font-bold transition-colors disabled:opacity-60"
        style={detected
          ? { background: 'rgb(var(--ed-fg) / 0.06)', color: 'var(--ed-text)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }
          : { background: '#c8ff00', color: '#000' }}>
        {working && <Spinner />}
        {working ? 'Detecting…' : detected ? 'Detect again' : 'Detect silences, fillers & repeats'}
      </button>
      {working && <p role="status" className="-mt-1 text-[11.5px] leading-relaxed" style={{ color: 'var(--ed-accent-text)' }}>{working}</p>}
      {error && <p role="alert" className="-mt-1 text-[11.5px]" style={{ color: '#f87171' }}>{error}</p>}

      {detected && !working && (
        <>
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs" style={{ color: muted }}>
              {rows.length === 0 ? 'Nothing found — this clip is clean.'
                : `${left.length} to go through${left.length ? ` · ${(leftMs / 1000).toFixed(1)} s` : ''}${goneMs ? ` · ${(goneMs / 1000).toFixed(1)} s deleted` : ''}`}
            </span>
            {left.length > 0 && (
              <button type="button" disabled={!!blockedNote} onClick={() => { onDeleteAll(); flash(`Deleted ${left.length}`) }}
                title={blockedNote ?? `Delete all ${left.length} — Undo brings them back`}
                className="h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-colors disabled:opacity-40"
                style={{ background: 'rgba(248,113,113,0.12)', color: '#fca5a5', boxShadow: 'inset 0 0 0 1px rgba(248,113,113,0.3)' }}>
                Delete all
              </button>
            )}
          </div>
          {blockedNote && <p className="-mt-1 text-[11px] leading-relaxed" style={{ color: muted }}>{blockedNote}</p>}

          <div className="flex flex-col gap-1.5 overflow-y-auto -mr-2 pr-2" style={{ maxHeight: 520 }}>
            {rows.map(r => {
              const k = KIND[r.kind]
              return (
                <div key={r.id} data-deleted={r.deleted || undefined}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg transition-opacity"
                  style={{ background: 'rgb(var(--ed-fg) / 0.04)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.07)', opacity: r.deleted ? 0.5 : 1 }}>
                  <button type="button" onClick={() => onPlay(r)}
                    aria-label={r.deleted ? `Play where the ${k.name.toLowerCase()} was cut` : `Play this ${k.name.toLowerCase()}`}
                    title={r.deleted ? 'Play across where it was cut' : 'Play it'}
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full transition-colors hover:bg-[rgb(var(--ed-fg)/0.14)]"
                    style={{ background: 'rgb(var(--ed-fg) / 0.08)', color: 'var(--ed-text)' }}>
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M3 1.5l7.5 4.5L3 10.5V1.5z" /></svg>
                  </button>
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: r.deleted ? muted : k.color }}>{k.name}</span>
                      <span className="text-[11px] tabular-nums" style={{ color: muted }}>{fmt(r.at)}</span>
                      {r.deleted && <span className="text-[10px] font-semibold px-1.5 rounded" style={{ color: muted, background: 'rgb(var(--ed-fg) / 0.08)' }}>Deleted</span>}
                    </span>
                    <span className="text-xs truncate" style={{ color: 'var(--ed-text)', textDecoration: r.deleted ? 'line-through' : undefined }}>
                      {r.words.length ? `“${r.words.join(' ')}”` : 'No sound'}
                      <span className="tabular-nums" style={{ color: muted }}> · {((r.b - r.a) / 1000).toFixed(1)} s</span>
                    </span>
                  </span>
                  {r.deleted ? (
                    <button type="button" disabled={!!blockedNote} onClick={() => onRestore(r)} title={blockedNote ?? 'Put it back in the clip'}
                      className="shrink-0 h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-colors hover:bg-[rgb(var(--ed-fg)/0.14)] disabled:opacity-40"
                      style={{ background: 'rgb(var(--ed-fg) / 0.08)', color: 'var(--ed-text)' }}>
                      Restore
                    </button>
                  ) : (
                    <button type="button" disabled={!!blockedNote} onClick={() => { onDelete(r); flash(`Deleted the ${k.name.toLowerCase()}`) }}
                      aria-label={`Delete this ${k.name.toLowerCase()}`} title={blockedNote ?? 'Cut it out of the clip'}
                      className="shrink-0 h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-colors disabled:opacity-40"
                      style={{ background: 'rgba(248,113,113,0.12)', color: '#fca5a5' }}>
                      Delete
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {undoNote && (
        <div role="status" className="sticky bottom-0 flex items-center gap-3 px-3 py-2 rounded-lg text-xs"
          style={{ background: 'var(--ed-popover)', boxShadow: '0 0 0 1px rgb(var(--ed-fg) / 0.12), 0 6px 20px rgba(0,0,0,0.5)' }}>
          <span className="flex-1" style={{ color: 'var(--ed-text)' }}>{undoNote}</span>
          <button type="button" onClick={() => { onUndo(); setUndoNote(null) }} className="font-bold hover:underline" style={{ color: 'var(--ed-accent-text)' }}>Undo</button>
        </div>
      )}
    </div>
  )
}
