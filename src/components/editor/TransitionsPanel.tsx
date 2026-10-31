'use client'

import { useEffect, useRef, useState } from 'react'
import type { Transition, TransitionType } from '@chai-cut/shared'

/** A place where one section of the main strip ends and the next begins (timeline ms) */
export interface TransitionJoin {
  /** The section before the join (transitions.after_segment_id) */
  afterId: string
  at: number
  /** The two formats, as names ("Vertical", "Split screen") */
  from: string
  to: string
  /** Both sides are one continuous shot framed the same (an edge-only change won't show) */
  sameShot?: boolean
  /** The longest a transition can play here: the shorter of the two parts' lengths (ms) */
  room: number
  /** Which of the two parts is that shorter one */
  shortSide: 'before' | 'after'
}

/**
 * The kinds of transition, most used in short-form editing first. Each tile plays a little loop
 * of what it does: one plain black frame gives way to another (drawn in CSS, no photos).
 * Styles: .tr-* in globals.css. The export draws them with ffmpeg's xfade (render.py); the preview
 * the same way (VideoPreview drawTransition).
 *
 * `hidden`: no longer offered (rare in short video, or doubling another one: the four slides are
 * one "Slide"). A clip that already has one keeps it: it still plays and exports, and its tile shows
 * while it is the picked one.
 */
export const TRANSITION_KINDS: { type: TransitionType; name: string; hidden?: boolean; trending?: boolean; fresh?: boolean }[] = [
  { type: 'cut', name: 'None' },
  { type: 'fade', name: 'Dissolve', trending: true },
  { type: 'fadeblack', name: 'Fade black' },
  { type: 'fadewhite', name: 'Flash' },
  { type: 'zoomin', name: 'Zoom', trending: true },
  { type: 'smoothleft', name: 'Whip', trending: true },
  { type: 'hblur', name: 'Blur', trending: true },
  { type: 'slideleft', name: 'Slide' },
  // Trending on Reels, Shorts and TikTok (render.py _CUSTOM_TRANSITIONS; swipeup a smeared slideup)
  { type: 'velocity', name: 'Speed ramp', fresh: true },
  { type: 'zoomout', name: 'Zoom out', fresh: true },
  { type: 'swipeup', name: 'Swipe up', fresh: true },
  { type: 'shake', name: 'Shake', fresh: true },
  { type: 'glitch', name: 'Glitch', fresh: true },
  { type: 'flare', name: 'Light leak', fresh: true },
  { type: 'spin', name: 'Spin', fresh: true },
  { type: 'warp', name: 'Warp', fresh: true },
  { type: 'slideright', name: 'Slide right', hidden: true },
  { type: 'slideup', name: 'Slide up', hidden: true },
  { type: 'slidedown', name: 'Slide down', hidden: true },
  { type: 'wipe', name: 'Wipe', hidden: true },
  { type: 'circleopen', name: 'Circle', hidden: true },
  { type: 'radial', name: 'Clock', hidden: true },
  { type: 'pixelize', name: 'Pixelate', hidden: true },
]
/** What a tile dragged from the panel carries (its kind): dropped on a cut on the timeline (Timeline.tsx) */
export const TRANSITION_DRAG_TYPE = 'application/x-shortcut-transition'
/** A kind's name ('cut' = None) */
export const transitionName = (t: string) => TRANSITION_KINDS.find(k => k.type === t)?.name ?? 'Transition'
/** A length in seconds: 0.5 s, 0.45 s, 1.0 s */
export const transitionSecs = (ms: number) => `${(ms / 1000).toFixed(ms % 100 === 0 ? 1 : 2)} s`

/** A small picture of each kind (24 x 24, drawn in currentColor), for the cuts on the timeline */
export function TransitionGlyph({ type, size = 12 }: { type: string; size?: number }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const f = { fill: 'currentColor', stroke: 'none' }
  const shape = (() => {
    switch (type) {
      case 'fade': return <><rect x="3" y="4" width="12" height="12" rx="2.5" {...p} /><rect x="9" y="8" width="12" height="12" rx="2.5" {...f} opacity=".55" /></>
      case 'fadeblack': return <><rect x="3.5" y="3.5" width="17" height="17" rx="3.5" {...p} /><path d="M12 3.5H7a3.5 3.5 0 0 0-3.5 3.5v10A3.5 3.5 0 0 0 7 20.5h5z" {...f} /></>
      case 'fadewhite': return <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M18.7 5.3l-2.8 2.8M8.1 15.9l-2.8 2.8" {...p} />
      case 'zoomin': return <><path d="M3.5 9V3.5H9M20.5 9V3.5H15M3.5 15v5.5H9M20.5 15v5.5H15" {...p} /><rect x="9" y="9" width="6" height="6" rx="1.2" {...f} /></>
      case 'smoothleft': return <path d="M2.5 8h9M4.5 12h10M2.5 16h9M15 7l5 5-5 5" {...p} />
      case 'hblur': return <path d="M3 9c2.5-2.5 6 2.5 9 0s6.5-2.5 9 0M3 15c2.5-2.5 6 2.5 9 0s6.5-2.5 9 0" {...p} />
      case 'slideleft': return <path d="M20 12H4M10 6l-6 6 6 6" {...p} />
      case 'slideright': return <path d="M4 12h16M14 6l6 6-6 6" {...p} />
      case 'slideup': return <path d="M12 20V4M6 10l6-6 6 6" {...p} />
      case 'slidedown': return <path d="M12 4v16M6 14l6 6 6-6" {...p} />
      case 'wipe': case 'wipeleft': return <><rect x="3.5" y="3.5" width="17" height="17" rx="3.5" {...p} /><path d="M12 3.5h5a3.5 3.5 0 0 1 3.5 3.5v10a3.5 3.5 0 0 1-3.5 3.5h-5z" {...f} /></>
      case 'circleopen': return <><circle cx="12" cy="12" r="8.5" {...p} /><circle cx="12" cy="12" r="3.6" {...f} /></>
      case 'radial': return <><circle cx="12" cy="12" r="8.5" {...p} /><path d="M12 12V3.5A8.5 8.5 0 0 1 20.5 12z" {...f} /></>
      case 'pixelize': return <><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" {...p} /><path d="M3.5 3.5h8.5v8.5H3.5zM12 12h8.5v8.5H12z" {...f} /></>
      case 'cut': return <path d="M12 5v14M5 12h14" {...p} strokeWidth={2.8} />
      // (a kind with no picture of its own: the split square)
      default: return <><rect x="3.5" y="3.5" width="17" height="17" rx="3.5" {...p} /><path d="M3.5 7v-.1a3.4 3.4 0 013.4-3.4H20.5L3.5 20.5z" {...f} /></>
    }
  })()
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{shape}</svg>
}

/** How long a new transition lasts, and the range it can be set to (ms) */
export const TRANSITION_DEFAULT_MS = 500
const MIN_MS = 200, MAX_MS = 1500
/** The slider moves in these steps (ms) */
const STEP_MS = 50
/** Shorter than this a transition can't show: the export plays the join as a plain cut (render.py _MIN_TRANSITION_MS) */
export const TRANSITION_MIN_SHOWN_MS = 80

/**
 * How long a transition really plays at a join: never longer than either part beside it, and none
 * at all (a plain cut) when that leaves under 80 ms. The export's rule (render.py
 * _transition_joins), so the preview plays exactly what the export makes.
 */
export function playedTransitionMs(durationMs: number, room: number) {
  const d = Math.min(Math.round(durationMs), Math.round(room))
  return d >= TRANSITION_MIN_SHOWN_MS ? d : 0
}

/** A time on the clip as m:ss.t (0:10.8): cuts a fraction of a second apart read differently */
function fmt(ms: number) {
  const t = Math.max(0, Math.round(ms / 100))
  return `${Math.floor(t / 600)}:${String(Math.floor(t / 10) % 60).padStart(2, '0')}.${t % 10}`
}
const secs = transitionSecs
const nameOf = (t: TransitionType) => TRANSITION_KINDS.find(k => k.type === t)?.name ?? 'None'
/**
 * Kinds that only blend or uncover the new picture in place: between two (almost) identical
 * pictures — one continuous shot split in two, framed the same — they look like a plain cut,
 * in the preview and in the export alike (measured). The moving ones (slides, Whip, Zoom,
 * the flashes, Blur, Pixelate) still show there.
 */
const NEEDS_CHANGE: TransitionType[] = ['fade', 'wipe', 'circleopen', 'radial']
const SAME_SHOT_TIP = 'Dissolve looks like a plain cut there. Pick Slide, Whip, Zoom, Flash or Blur — or change the framing of one side.'

/**
 * The Transitions tool, one set of controls for the whole clip:
 *
 *  - "Cut": which cut the controls are for — the one picked on the timeline, else the one nearest
 *    the playhead (a chip per join, by its time; picking one moves the playhead there; the playhead
 *    put on a cut picks it). A dot on a chip: that cut has a transition.
 *  - The tiles: that cut's transition — picking one changes that cut only. "Apply to all cuts"
 *    gives every cut the same one (with the same length).
 *  - Length, then Preview (plays through the cut, or the first one) and "+ Add cut" (splits the
 *    clip at the playhead: a new join).
 *
 * With no joins yet the tiles still show: picking one splits the clip at the playhead and puts
 * that transition on the new join (onAddHere).
 */
export function TransitionsPanel({ joins, transitions, currentTimeMs, canAddHere, onAddHere, onSet, onPreview, onSeek, savedAsDissolve, focusJoin, onShownJoin, frameA, frameB, grabFrame }: {
  joins: TransitionJoin[]
  transitions: Transition[]
  currentTimeMs: number
  /** The playhead is inside a part of the clip (not on its first or last moment): it can be split there */
  canAddHere: boolean
  /** Split the clip at the playhead and give the new join this transition */
  onAddHere: (type: TransitionType) => void
  onSet: (afterId: string, type: TransitionType, durationMs: number) => void
  /** Play the clip through this join (from a moment before it) */
  onPreview: (at: number, durationMs: number) => void
  /** Move the playhead (to a cut picked in "Apply to") */
  onSeek?: (ms: number) => void
  /** The last save kept newer kinds as Dissolve: the database doesn't take them until the backend restarts */
  savedAsDissolve?: boolean
  /** Opened from the transition button between two parts on the timeline: that cut (`n` changes each time) */
  focusJoin?: { id: string; n: number } | null
  /** The cut the controls are on (its section id; null: none), so the timeline can mark it */
  onShownJoin?: (afterId: string | null) => void
  /** Two pictures of the clip being edited (read as the editor opens): the tiles play their transition between
   *  them, not grey boxes (user, 2026-10-31) */
  frameA?: string | null
  frameB?: string | null
  /** The picture on the preview right now, at once: the tiles show it until the two pictures are in, so they
   *  are never blank boxes (user, 2026-10-31: "a black blank, then the content after some time") */
  grabFrame?: () => string | null
}) {
  const [instant] = useState(() => ((!frameA || !frameB) && grabFrame ? grabFrame() : null))
  const shotA = frameA ?? instant
  const shotB = frameB ?? frameA ?? instant
  const frames = shotA && shotB ? { a: shotA, b: shotB } : null
  // The cut the controls are for (its section id): the one picked, else the one nearest the playhead
  const nearestJoin = () => [...joins].sort((a, b) => Math.abs(a.at - currentTimeMs) - Math.abs(b.at - currentTimeMs))[0]
  const [scope, setScope] = useState<string>(() => (focusJoin && joins.some(j => j.afterId === focusJoin.id) ? focusJoin.id : nearestJoin()?.afterId ?? ''))
  useEffect(() => { if (focusJoin && joins.some(j => j.afterId === focusJoin.id)) setScope(focusJoin.id) }, [focusJoin?.n]) // eslint-disable-line react-hooks/exhaustive-deps
  // (the playhead put on a cut: that cut)
  useEffect(() => {
    const on = joins.find(j => Math.abs(j.at - currentTimeMs) < 150)
    if (on && on.afterId !== scope) setScope(on.afterId)
  }, [currentTimeMs]) // eslint-disable-line react-hooks/exhaustive-deps
  // The cut picked stays the same cut: when the part before it is split, its id goes with the left
  // half (now before the new cut), so the pick follows the cut to the part now before it
  // (only when the same pick's cut moved or went: a different cut picked is just recorded)
  const pickedAt = useRef<{ id: string; at: number } | null>(null)
  useEffect(() => {
    const j = joins.find(x => x.afterId === scope)
    const was = pickedAt.current
    if (was && was.id === scope && (!j || Math.abs(j.at - was.at) > 1)) {
      const same = joins.find(x => Math.abs(x.at - was.at) <= 1)
      if (same) { pickedAt.current = { id: same.afterId, at: same.at }; setScope(same.afterId); return }
    }
    pickedAt.current = j ? { id: scope, at: j.at } : null
  }, [scope, joins])

  // (the cut the controls are on: the one picked, else the nearest — the timeline marks it)
  const shownId = (joins.find(j => j.afterId === scope) ?? nearestJoin())?.afterId ?? null
  useEffect(() => { onShownJoin?.(shownId) }, [shownId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onShownJoin?.(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  if (joins.length === 0) {
    return (
      <div className="flex flex-col gap-3 px-4 pb-5 pt-1">
        <div className="tr-start">
          <span className="tr-empty-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2.5" y="5" width="8" height="14" rx="2" /><rect x="13.5" y="5" width="8" height="14" rx="2" /><path d="M10.5 12h3" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="tr-empty-title">Add a transition</p>
            <p className="tr-empty-text">
              {canAddHere
                ? <>Pick one: the clip is cut at the playhead (<b className="tabular-nums">{fmt(currentTimeMs)}</b>) and it plays there.</>
                : <>Move the playhead to where one shot should give way to the next, then pick one.</>}
            </p>
          </div>
        </div>
        <KindTiles frames={frames} picked={null} label="Add a transition at the playhead" disabled={!canAddHere} weak
          onPick={t => { if (t !== 'cut') onAddHere(t) }} />
        {canAddHere && <span className="tr-hint">This splits one shot in two, framed the same on both sides: {SAME_SHOT_TIP}</span>}
      </div>
    )
  }

  const trOf = (j: TransitionJoin) => transitions.find(t => t.after_segment_id === j.afterId)
  const typeOf = (j: TransitionJoin): TransitionType => trOf(j)?.type ?? 'cut'
  /** What really plays at a join, as the export makes it (ms; 0 = a plain cut) */
  const playedOf = (j: TransitionJoin) => (typeOf(j) === 'cut' ? 0 : playedTransitionMs(trOf(j)?.duration_ms || TRANSITION_DEFAULT_MS, j.room))
  const sideName = (j: TransitionJoin) => (j.shortSide === 'before' ? 'part before' : 'part after')
  // (a cut picked that is gone — deleted or joined: the one nearest the playhead)
  const one: TransitionJoin | null = joins.find(j => j.afterId === scope) ?? nearestJoin() ?? null
  const targets = one ? [one] : joins
  // What the tiles show: the cut's own, or for All cuts the one they share (none lit when mixed)
  const types = new Set(targets.map(typeOf))
  const picked: TransitionType | null = types.size === 1 ? [...types][0] : null
  const withTr = targets.filter(j => typeOf(j) !== 'cut')
  const firstOn = withTr[0]
  /** A cut's own length as set (what is saved) */
  const lenOf = (j: TransitionJoin) => trOf(j)?.duration_ms || TRANSITION_DEFAULT_MS
  // For All cuts the lengths can differ: then the slider shows "Mixed" (and moving it sets them all)
  const mixedLen = new Set(withTr.map(lenOf)).size > 1
  const ms = firstOn ? lenOf(firstOn) : TRANSITION_DEFAULT_MS
  const anyOn = !!firstOn
  const onJoin = joins.some(j => Math.abs(j.at - currentTimeMs) < 150)
  const preview = one ?? firstOn ?? joins[0]
  // The length slider: for one cut it goes no longer than that cut has room for
  const cap = one ? Math.min(MAX_MS, one.room) : MAX_MS
  const sliderMax = Math.max(STEP_MS, Math.floor(cap / STEP_MS) * STEP_MS)
  const sliderMin = Math.min(MIN_MS, sliderMax)
  // For All cuts: the ones that play shorter than the length set (a part beside them is short)
  const shortened = one ? [] : withTr.filter(j => playedOf(j) < lenOf(j))
  // Same shot on both sides with a kind that only blends in place: it would look like a plain cut
  const unseen = withTr.filter(j => j.sameShot && NEEDS_CHANGE.includes(typeOf(j)))
  // "Add cut" splits one shot in two, framed the same: the shared kind, unless it wouldn't show there
  const addType: TransitionType = picked && picked !== 'cut' && !NEEDS_CHANGE.includes(picked) ? picked : 'zoomin'

  /** Play through the cut nearest the playhead among these (or the one picked), as long as it plays there */
  function previewNear(js: TransitionJoin[], lenFor: (j: TransitionJoin) => number) {
    const near = one ?? [...js].sort((a, b) => Math.abs(a.at - currentTimeMs) - Math.abs(b.at - currentTimeMs))[0]
    if (near) onPreview(near.at, playedTransitionMs(lenFor(near), near.room))
  }
  /** A kind picked: on every target. Each cut that had a transition keeps its own length; one that
   *  had none takes the shared length (the default when they differ) */
  function apply(type: TransitionType) {
    const lenFor = (j: TransitionJoin) => (typeOf(j) !== 'cut' ? lenOf(j) : mixedLen ? TRANSITION_DEFAULT_MS : ms)
    for (const j of targets) onSet(j.afterId, type, lenFor(j))
    // (and it plays through the cut — the one picked, or the nearest — so what was picked is seen)
    if (type !== 'cut') previewNear(targets, lenFor)
  }
  /** The same-shot fix: these cuts get a kind that shows there (each keeps its length) */
  function swap(js: TransitionJoin[], type: TransitionType) {
    for (const j of js) onSet(j.afterId, type, lenOf(j))
    previewNear(js, lenOf)
  }

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-5 pt-1">
      {/* Apply to: all cuts, or one */}
      <div className="flex flex-col gap-1.5">
        <span className="tr-label">{joins.length > 1 ? 'Cut' : 'The cut'}</span>
        <div className="tr-scope" role="radiogroup" aria-label="Which cut">
          {joins.map(j => (
            <button key={j.afterId} type="button" role="radio" aria-checked={one?.afterId === j.afterId} data-on={one?.afterId === j.afterId || undefined}
              title={`Cut at ${fmt(j.at)}: ${nameOf(typeOf(j))}${typeOf(j) !== 'cut' && playedOf(j) === 0 ? ' (a part beside it is too short: it plays as a plain cut)' : ''}`}
              onClick={() => { setScope(j.afterId); onSeek?.(j.at) }}>
              <span className="tabular-nums">{fmt(j.at)}</span>
              {typeOf(j) !== 'cut' && <i className="tr-scope-dot" aria-label={playedOf(j) ? 'has a transition' : 'has a transition, too short to show'} style={playedOf(j) ? undefined : { opacity: 0.35 }} />}
            </button>
          ))}
        </div>
      </div>

      <KindTiles frames={frames} picked={picked} label={one ? `Transition at ${fmt(one.at)}` : 'Transition on every cut'} onPick={t => apply(t)}
        weak={targets.every(j => j.sameShot)} />
      {/* the same transition on every cut: this cut's, with its length */}
      {one && joins.length > 1 && (() => {
        const t = typeOf(one), len = lenOf(one)
        const same = joins.every(j => typeOf(j) === t && (t === 'cut' || lenOf(j) === len))
        return (
          <button type="button" className="tr-all" disabled={same}
            title={same ? `Every cut already has ${nameOf(t)}` : `Give all ${joins.length} cuts ${nameOf(t)}${t !== 'cut' ? ` (${secs(len)})` : ''}`}
            onClick={() => { for (const j of joins) onSet(j.afterId, t, len) }}>
            {same ? `All ${joins.length} cuts have ${nameOf(t)}` : `Apply ${nameOf(t)} to all ${joins.length} cuts`}
          </button>
        )
      })()}
      {unseen.length > 0 ? (
        // A kind that won't show picked on a same-shot cut: say so, and offer one that does in a tap
        <div className="tr-hint flex flex-col gap-2" data-tone="warn" role="alert">
          <span>
            {one
              ? <>{nameOf(typeOf(one))} won&apos;t show here: both sides of this cut are the same shot, framed the same, so it looks like a plain cut.</>
              : <>At {unseen.map(j => fmt(j.at)).join(', ')}, {[...new Set(unseen.map(j => nameOf(typeOf(j))))].join(' / ')} won&apos;t show: both sides are the same shot, framed the same, so it looks like a plain cut.</>}
          </span>
          <span className="flex gap-2">
            <button type="button" className="tr-play flex-1 justify-center" onClick={() => swap(unseen, 'zoomin')}>Use Zoom</button>
            <button type="button" className="tr-play flex-1 justify-center" onClick={() => swap(unseen, 'smoothleft')}>Use Whip</button>
          </span>
        </div>
      ) : targets.some(j => j.sameShot && typeOf(j) === 'cut') && (
        <span className="tr-hint">
          {targets.every(j => j.sameShot) ? 'Both sides of this cut are the same shot, framed the same: ' : 'Some cuts have the same shot on both sides, framed the same: '}{SAME_SHOT_TIP}
        </span>
      )}
      {savedAsDissolve && (
        <span className="tr-hint" data-tone="warn">
          The new transitions aren&apos;t switched on yet, so this one was saved as Dissolve for now. Pick it again once they&apos;re switched on.
        </span>
      )}

      {anyOn && (one && one.room < TRANSITION_MIN_SHOWN_MS ? (
        <span className="tr-hint" data-tone="warn">
          The {sideName(one)} this cut is only {secs(Math.max(0, Math.round(one.room)))} long: too short for a transition, so it plays as a plain cut. Make that part longer to see it.
        </span>
      ) : (
        <div className="flex flex-col gap-1">
          <label className="flex items-center justify-between text-[11.5px]" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>
            <span>Length</span>
            {/* (one cut: what really plays there) */}
            <span className="tabular-nums font-semibold" style={{ color: 'var(--ed-text)' }}>{mixedLen ? 'Mixed' : secs(one ? playedOf(one) : ms)}</span>
          </label>
          {sliderMin < sliderMax && (
            <input type="range" min={sliderMin} max={sliderMax} step={STEP_MS} value={Math.max(sliderMin, Math.min(ms, sliderMax))} aria-label="Transition length"
              onChange={e => {
                const len = Number(e.target.value)
                for (const j of targets) if (typeOf(j) !== 'cut') onSet(j.afterId, typeOf(j), len)
              }} className="tr-range" />
          )}
          {mixedLen && (
            <span className="tr-hint">The cuts have different lengths: moving the slider gives them all the same one.</span>
          )}
          {one && cap < MAX_MS && (
            <span className="tr-hint">At most {secs(Math.round(cap))} here: the {sideName(one)} this cut is {secs(Math.round(one.room))} long.</span>
          )}
          {shortened.length > 0 && (
            <span className="tr-hint">
              Shorter where a part beside the cut is short: {shortened.map(j => `${fmt(j.at)} ${playedOf(j) ? `plays ${secs(playedOf(j))}` : 'plays as a plain cut'}`).join(', ')}.
            </span>
          )}
        </div>
      ))}

      <div className="flex items-center gap-2">
        <button type="button" className="tr-play flex-1 justify-center" onClick={() => onPreview(preview.at, playedOf(preview))}
          title={`Play the clip through the cut at ${fmt(preview.at)}`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>
          Preview {fmt(preview.at)}
        </button>
        <button type="button" className="tr-play flex-1 justify-center" disabled={!canAddHere || onJoin} onClick={() => { onAddHere(addType); setScope('') }}
          title={canAddHere && !onJoin ? `Cut the clip at ${fmt(currentTimeMs)} and add ${nameOf(addType)} there` : 'Move the playhead inside a part of the clip'}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          Add cut at {fmt(currentTimeMs)}
        </button>
      </div>
    </div>
  )
}

/** A small flame: trending (beside a tile's name, and on the trending section's heading) */
function Flame() {
  return (
    <svg className="tr-flame" width="9" height="11" viewBox="0 0 12 15" fill="currentColor" aria-hidden="true">
      <path d="M6.6.4c.4 2.3-.6 3.6-1.7 4.8C3.6 6.6 2 8.1 2 10.4 2 12.9 3.8 14.6 6 14.6s4-1.7 4-4.1c0-1.6-.7-2.7-1.4-3.6-.2 1-.8 1.8-1.6 2.2.3-2.6-.2-5.5-.4-8.7Z" />
    </svg>
  )
}

/** The tiles of every kind; `picked` is lit */
function KindTiles({ picked, label, disabled, weak, onPick, frames }: {
  /** Two pictures of the clip: shot A and shot B in every tile */
  frames?: { a: string; b: string } | null
  picked: TransitionType | null
  label: string
  disabled?: boolean
  /** Both sides are the same shot: the kinds that won't show there are marked */
  weak?: boolean
  onPick: (type: TransitionType) => void
}) {
  const tile = (k: (typeof TRANSITION_KINDS)[number]) => (
    <button key={k.type} type="button" role="radio" aria-checked={picked === k.type} disabled={disabled}
      // (drag it onto a cut on the timeline: that cut gets it)
      draggable={!disabled} onDragStart={e => { e.dataTransfer.setData(TRANSITION_DRAG_TYPE, k.type); e.dataTransfer.effectAllowed = 'copy' }}
      className="tr-tile" data-on={picked === k.type || undefined} data-weak={(weak && NEEDS_CHANGE.includes(k.type)) || undefined}
      title={weak && NEEDS_CHANGE.includes(k.type) ? `${k.name} barely shows between two parts of the same shot` : undefined}
      onClick={() => onPick(k.type)}>
      {/* the picture plays the transition; nothing laid over it */}
      <span className="tr-demo" data-kind={k.type} aria-hidden="true">
        <i className="tr-a" /><i className="tr-b" /><i className="tr-fx" />
      </span>
      {/* its name — trending ones with a small flame (the new ones are under their own heading) */}
      <span className="tr-name">{k.trending && !k.fresh && <Flame />}{k.name}</span>
    </button>
  )
  // (an older kind shows only while it is the one picked, so the clip's own choice stays visible)
  const shown = TRANSITION_KINDS.filter(k => !k.hidden || picked === k.type)
  return (
    <div className="tr-kinds" role="radiogroup" aria-label={label} data-frames={frames ? '' : undefined}
      style={frames ? { ['--tr-a' as string]: `url("${frames.a}")`, ['--tr-b' as string]: `url("${frames.b}")` } : undefined}>
      <span className="tr-label">Basic</span>
      <div className="tr-grid">{shown.filter(k => !k.fresh).map(tile)}</div>
      <span className="tr-label tr-label-hot"><Flame />Trending on Reels and Shorts</span>
      <div className="tr-grid">{shown.filter(k => k.fresh).map(tile)}</div>
    </div>
  )
}
