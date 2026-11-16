'use client'

import { useState } from 'react'

/**
 * The clip board's scan over the video while AI works on it. Styles: .vscan in globals.css (not "ai-scan": the
 * Ask AI button's flash already has that name). The editor keeps its own CaptionScan.
 *
 * Two looks (user, 2026-11-12):
 *  - read / make (reading the video, Make my clips): the picture dims, a soft band of light glides down it with
 *    fine dots in its wake, and thin corner marks (user, 2026-11-13: the waveform above the controls taken out).
 *  - find (an Ask AI search): "Moment finder" — a light flows round the frame's edge, the words searched for
 *    stand in the middle (each fading in out of a blur) with "Searching all 11:12 of your video" under them,
 *    over the picture made to look like an AI image being made: blurred and dim, a band sweeping down where it
 *    comes into focus for a moment, a fine living grain, soft light drifting (user, 2026-11-13: the timeline
 *    with pins taken out). The player's controls step aside while it runs (globals.css).
 * Both: a frosted pill at the top says what AI is doing; a small player gets a simpler version; still for
 * reduced motion. A loop, not progress. Clicks go through it, except during a search.
 */

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

export function AiScan({ label, mode = 'read', query, durationMs, full = false }: {
  /** What AI is doing, shown in the pill; null: no scan */
  label: string | null
  /** read / make: the reading look · find: the Ask AI look */
  mode?: 'read' | 'make' | 'find'
  /** find: the words searched for */
  query?: string
  /** find: the video's length, for "Searching all 11:12 of your video" */
  durationMs?: number | null
  /** The player's controls are hidden (Make my clips working): the scan goes down to the video's bottom */
  full?: boolean
}) {
  // (while it fades out, label is already null: it keeps the look and words it had, not the defaults)
  const [kept, setKept] = useState({ mode, query })
  if (label !== null && (kept.mode !== mode || kept.query !== query)) setKept({ mode, query })
  const find = kept.mode === 'find'
  const words = (kept.query ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 12)
  return (
    <div className="vscan" data-on={label !== null || undefined} data-mode={find ? 'find' : 'read'} data-full={full || undefined} aria-hidden="true">
      <div className="vscan-veil" />
      {find ? (
        <>
          {/* the picture as an AI image being made: two blur layers that lift where a band sweeps down (the deeper one
              breathing), soft light drifting, a fine living grain */}
          <div className="vscan-blur" />
          <div className="vscan-blur-deep" />
          <div className="vscan-glow"><i /><i /><i /></div>
          <div className="vscan-grain" />
          {/* the light flowing round the edge, and its soft glow */}
          <div className="vscan-edge vscan-edge-glow" />
          <div className="vscan-edge" />
          {words.length > 0 && (
            <div className="vscan-query">
              <p className="vscan-q">
                <span className="vscan-q-mark">“</span>
                {words.map((w, i) => <span key={`${i}-${w}`} className="vscan-q-word" style={{ '--i': i } as React.CSSProperties}>{w}</span>)}
                <span className="vscan-q-mark">”</span>
              </p>
              <p className="vscan-q-sub">{durationMs ? `Searching all ${clock(durationMs)} of your video` : 'Searching your whole video'}</p>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="vscan-field">
            <div className="vscan-sweep">
              <div className="vscan-trail" />
              <div className="vscan-line"><i /></div>
            </div>
          </div>
          <i className="vscan-corner" data-c="tl" />
          <i className="vscan-corner" data-c="tr" />
          <i className="vscan-corner" data-c="bl" />
          <i className="vscan-corner" data-c="br" />
        </>
      )}
      {label !== null && (
        // (key: a new step fades in rather than the words just swapping)
        <span key={label} className="vscan-pill">
          <i className="vscan-ring" />
          <span className="vscan-text">{label}</span>
        </span>
      )}
    </div>
  )
}
