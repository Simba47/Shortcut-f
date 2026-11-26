'use client'

import { useEffect, useRef, useState } from 'react'
import type { AudioTrack } from '@chai-cut/shared'
import { EmptyState } from './EditorTour'
import { TimeRange } from './ItemTimeRange'
import { CC_BY_SUFFIX, type SoundItem, type SoundKind } from '@/modules/editor/soundCatalog'

interface Props {
  tracks: AudioTrack[]
  onAddTrack: (file: File) => void
  /** A sound picked in the sound library (stored, then put on the clip at the playhead) */
  onAddSound?: (item: SoundItem, kind: SoundKind) => Promise<void>
  onUpdateTrack: (id: string, updates: Partial<AudioTrack>) => void
  onRemoveTrack: (id: string) => void
  /** The track picked on the timeline (or here): highlighted, with its timing */
  selectedId?: string | null
  onSelect?: (id: string) => void
  currentTimeMs?: number
  clipLengthMs?: number
  /** Each song's full length (ms), once known */
  durations?: Record<string, number>
  /** The name shown for a track (default: its file name) */
  nameOf?: (track: AudioTrack) => string
  /** Songs still uploading, or whose upload failed */
  uploads?: Record<string, 'uploading' | 'failed'>
  /** A song with no file to play (saved before uploads existed): offer "Re-add this song" */
  missing?: (track: AudioTrack) => boolean
  onReadd?: (id: string, file: File) => void
  /** A message for the last thing tried (e.g. a file over 20 MB) */
  notice?: string | null
  /** Record voice: opens the recorder (VoiceRecorder) */
  onRecord?: () => void
}

/** Any audio file, or a video (its sound is used) */
const MUSIC_ACCEPT = 'audio/*,video/*'

export function AudioMixerPanel({ tracks, onAddTrack, onUpdateTrack, onRemoveTrack, selectedId = null, onSelect, currentTimeMs = 0, clipLengthMs, durations = {}, nameOf, uploads = {}, missing, onReadd, notice, onRecord }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  // "Re-add this song": which track the picked file is for
  const readdRef = useRef<HTMLInputElement>(null)
  const readdIdRef = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selectedId) listRef.current?.querySelector(`[data-track-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  // CC BY sounds in the clip: the lines to credit when it is published ("Name by Author (CC BY, Freesound)")
  const [copied, setCopied] = useState(false)
  const credits = tracks.flatMap(t => {
    const n = (nameOf ? nameOf(t) : t.storage_path.split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '')
    return n.endsWith(`-${CC_BY_SUFFIX}`) || n.endsWith(` ${CC_BY_SUFFIX}`) ? [`${n.slice(0, -CC_BY_SUFFIX.length - 1).replace(/-/g, ' ')} (CC BY, Freesound)`] : []
  })
  const creditText = [...new Set(credits)].join('\n')

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) onAddTrack(f)
    e.target.value = ''
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Audio Mixer
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept={MUSIC_ACCEPT}
        className="hidden"
        onChange={handleFileChange}
      />
      <input ref={readdRef} type="file" accept={MUSIC_ACCEPT} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f && readdIdRef.current) onReadd?.(readdIdRef.current, f) }} />

      <button
        onClick={() => fileInputRef.current?.click()}
        className="py-2 rounded-lg text-sm font-medium text-white"
        style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}
      >
        + Add background music
      </button>
      <p className="-mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>Any audio file, or a video for its sound · up to 20 MB</p>
      {onRecord && (
        <button type="button" onClick={onRecord}
          className="-mt-1 py-2 rounded-lg text-sm font-medium text-white flex items-center justify-center gap-2"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.45)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="2.5" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" />
          </svg>
          Record voice
        </button>
      )}
      {notice && <p role="alert" className="-mt-1 text-xs" style={{ color: '#f87171' }}>{notice}</p>}

      {creditText && (
        <button type="button" onClick={() => { navigator.clipboard?.writeText(creditText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {}) }}
          className="py-2 rounded-lg text-xs font-medium text-white" style={{ background: 'var(--surface-2)' }}
          title="Sounds that need their author named when you publish">
          {copied ? 'Copied ✓' : `Copy credits (${new Set(credits).size})`}
        </button>
      )}

      {tracks.length === 0 ? (
        <EmptyState icon={<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>}
          title="No music yet" tip="Add a background track or record your voice above, then set its volume so your voice stays clear." />
      ) : (
        <div ref={listRef} className="flex flex-col gap-3">
          {tracks.map(track => {
            const on = track.id === selectedId
            // Where it stops: its trim end, else the song's end (or the clip's end while unknown)
            const len = clipLengthMs ?? Infinity
            const songEnd = durations[track.id] != null ? track.start_ms + durations[track.id] - (track.offset_ms ?? 0) : len
            const endMs = Math.min(len, track.end_ms ?? songEnd)
            return (
            <div key={track.id} data-track-id={track.id} onPointerDown={() => { if (!on) onSelect?.(track.id) }}
              className="flex flex-col gap-2 p-3 rounded-lg"
              style={{ background: 'var(--surface-2)', boxShadow: on ? 'inset 0 0 0 1.5px #c084fc' : undefined }}>
              <div className="flex items-center justify-between">
                <span className="min-w-0 flex items-center gap-1.5">
                  <span className="text-xs text-white truncate">{nameOf ? nameOf(track) : track.storage_path.split('/').pop()}</span>
                  {uploads[track.id] === 'uploading' && <span className="shrink-0 text-[10px]" style={{ color: 'var(--text-muted)' }}>Uploading…</span>}
                </span>
                <button
                  onClick={() => onRemoveTrack(track.id)}
                  className="text-xs shrink-0 ml-2"
                  style={{ color: 'var(--danger)' }}
                >
                  ✕
                </button>
              </div>

              {/* No file behind it (saved before uploads existed, or its upload failed): it can't play or export */}
              {(uploads[track.id] === 'failed' || (missing?.(track) && uploads[track.id] !== 'uploading')) && (
                <div className="flex items-center gap-2 p-2 rounded-md text-[11px]" style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24' }}>
                  <span className="flex-1">{uploads[track.id] === 'failed' ? 'Upload failed — this song won’t be in the export.' : 'This song’s file is missing, so it won’t play or export.'}</span>
                  <button type="button" onClick={() => { readdIdRef.current = track.id; readdRef.current?.click() }}
                    className="shrink-0 px-2 py-1 rounded font-semibold" style={{ background: '#fbbf24', color: '#000' }}>
                    Re-add this song
                  </button>
                </div>
              )}

              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span>Volume</span>
                  <span>{Math.round(track.volume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={track.volume}
                  onChange={e => onUpdateTrack(track.id, { volume: Number(e.target.value) })}
                  className="accent-purple-500"
                />
              </div>

              {track.voice ? (
                // A recorded voice: it is the speech (never dips); a dub mutes the original under it
                <label className="flex items-center gap-2 cursor-pointer text-xs text-white">
                  <input
                    type="checkbox"
                    checked={!!track.mutes_original}
                    onChange={e => onUpdateTrack(track.id, { mutes_original: e.target.checked })}
                    className="accent-purple-500"
                  />
                  Mute the original under it (dub)
                </label>
              ) : (
              <label className="flex items-center gap-2 cursor-pointer text-xs text-white">
                <input
                  type="checkbox"
                  checked={track.duck_under_speech}
                  onChange={e => onUpdateTrack(track.id, { duck_under_speech: e.target.checked })}
                  className="accent-purple-500"
                />
                Duck under speech
              </label>
              )}

              {/* Fade-in / fade-out (0.5 s each), in the preview and the export */}
              <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Fades">
                {([['fade_in', 'Fade in'], ['fade_out', 'Fade out']] as const).map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={!!track[k]}
                    onClick={() => onUpdateTrack(track.id, { [k]: !track[k] })}
                    title={`${label} over half a second${track[k] ? ' (on)' : ''}`}
                    className="py-1.5 rounded-md text-xs font-semibold transition-colors"
                    style={track[k]
                      ? { background: 'rgba(192,132,252,0.18)', color: '#e9d5ff', boxShadow: 'inset 0 0 0 1px rgba(192,132,252,0.55)' }
                      : { background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}>
                    {k === 'fade_in' ? '◢' : '◣'} {label}
                  </button>
                ))}
              </div>

              {on && clipLengthMs != null && (
                <TimeRange startMs={track.start_ms} endMs={endMs} currentTimeMs={currentTimeMs}
                  onStart={ms => {
                    // Moving the start keeps a trimmed track's length
                    const start = Math.round(Math.max(0, Math.min(clipLengthMs - 200, ms)))
                    onUpdateTrack(track.id, { start_ms: start, ...(track.end_ms != null ? { end_ms: Math.min(clipLengthMs, start + track.end_ms - track.start_ms) } : {}) })
                  }}
                  onEnd={ms => onUpdateTrack(track.id, { end_ms: Math.round(Math.min(songEnd, clipLengthMs, Math.max(track.start_ms + 200, ms))) })} />
              )}
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
