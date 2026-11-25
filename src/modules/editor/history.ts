'use client'

import { create } from 'zustand'
import { useEditorStore, type KeyframeMap } from './store'
import { useMediaStore } from '@/modules/media/store'
import { useCaptionStore } from '@/modules/captions/store'
import { useBrandStore } from './brandState'
import { useGroupStore } from './groups'
import { describeEdits } from './editTracking'
import { track } from '@/lib/analytics'

// Undo / redo for everything the editor saves: formats and frames, crop boxes and their motion,
// removed parts of the video, overlays, text, audio, transitions, filters and the caption style.
// Selection is not history.
//
// One step = one burst of edits: a whole drag (until the pointer is released) or a run of typing
// counts once. The auto-save watches the same state, so an undo is saved like any other edit.

interface Snapshot {
  segments: ReturnType<typeof useEditorStore.getState>['segments']
  keyframes: KeyframeMap
  trims: ReturnType<typeof useEditorStore.getState>['trims']
  clipRange: ReturnType<typeof useEditorStore.getState>['clipRange']
  overlays: ReturnType<typeof useMediaStore.getState>['overlays']
  textOverlays: ReturnType<typeof useMediaStore.getState>['textOverlays']
  audioTracks: ReturnType<typeof useMediaStore.getState>['audioTracks']
  transitions: ReturnType<typeof useMediaStore.getState>['transitions']
  filters: ReturnType<typeof useMediaStore.getState>['filters']
  captionStyle: ReturnType<typeof useCaptionStore.getState>['captionStyle']
  /** The caption parts after the first, each in its own look (captions/parts.ts) */
  captionParts: ReturnType<typeof useCaptionStore.getState>['captionParts']
  /** The brand kit on the clip (brandState.ts): turning it on or off is one step like any edit */
  brand: ReturnType<typeof useBrandStore.getState>['on']
  /** Groups on the timeline (groups.ts): joining or undoing one is a step like any edit */
  groups: ReturnType<typeof useGroupStore.getState>['groups']
}

const LIMIT = 100
// Edits closer together than this belong to the same step
const BURST_IDLE_MS = 600

/** The saved state of the clip as the stores hold it now (the auto-save also uses this) */
export function editableSnapshot(): Snapshot { return take() }
/** Whether two snapshots hold the same saved state */
export function sameEditable(a: Snapshot, b: Snapshot) { return same(a, b) }
export type EditableSnapshot = Snapshot

function take(): Snapshot {
  const e = useEditorStore.getState(), m = useMediaStore.getState(), c = useCaptionStore.getState()
  return {
    segments: e.segments, keyframes: e.keyframes, trims: e.trims, clipRange: e.clipRange,
    overlays: m.overlays, textOverlays: m.textOverlays, audioTracks: m.audioTracks, transitions: m.transitions, filters: m.filters,
    captionStyle: c.captionStyle, captionParts: c.captionParts,
    brand: useBrandStore.getState().on,
    groups: useGroupStore.getState().groups,
  }
}

// Stores replace what they change, so comparing references finds real edits
function same(a: Snapshot, b: Snapshot) {
  return (Object.keys(a) as (keyof Snapshot)[]).every(k => a[k] === b[k])
}

function restore(s: Snapshot) {
  useEditorStore.setState({ segments: s.segments, keyframes: s.keyframes, trims: s.trims, clipRange: s.clipRange })
  useMediaStore.setState({ overlays: s.overlays, textOverlays: s.textOverlays, audioTracks: s.audioTracks, transitions: s.transitions, filters: s.filters })
  useCaptionStore.getState().setCaptionParts(s.captionParts)
  useCaptionStore.setState({ captionStyle: s.captionStyle, romanize: s.captionStyle.language === 'roman' })
  useBrandStore.setState({ on: s.brand })
  useGroupStore.setState({ groups: s.groups })
}

export const useHistory = create<{ canUndo: boolean; canRedo: boolean }>(() => ({ canUndo: false, canRedo: false }))

let past: Snapshot[] = []
let future: Snapshot[] = []
/** State at the end of the last step — what an edit starting now would be undone to */
let committed: Snapshot | null = null
let inBurst = false
let restoring = false
let pointerDown = false
let timer: ReturnType<typeof setTimeout> | null = null

function sync() {
  useHistory.setState({ canUndo: past.length > 0 || inBurst, canRedo: future.length > 0 })
}

function endBurst() {
  if (timer) { clearTimeout(timer); timer = null }
  inBurst = false
  const before = past[past.length - 1]
  committed = take()
  // Google Analytics: what kind of edit this step was (editTracking.ts), never what it says
  if (before) {
    try {
      for (const e of describeEdits(before, committed, useEditorStore.getState().mainVideoId)) track('editor_edit', { area: e.area, change: e.change, detail: e.detail })
    } catch { /* counting never stops an edit */ }
  }
}

function settle() {
  // A drag isn't over until the pointer is released
  if (pointerDown) { timer = setTimeout(settle, BURST_IDLE_MS); return }
  endBurst()
  sync()
}

function onChange() {
  if (restoring || !committed) return
  if (!inBurst) {
    if (same(take(), committed)) return // only the selection changed
    past.push(committed)
    if (past.length > LIMIT) past.shift()
    future = []
    inBurst = true
    sync()
  }
  if (timer) clearTimeout(timer)
  timer = setTimeout(settle, BURST_IDLE_MS)
}

export function undo() {
  if (inBurst) endBurst()
  const prev = past.pop()
  if (!prev) { sync(); return }
  track('editor_action', { action: 'undo' })
  future.push(take())
  restoring = true
  restore(prev)
  restoring = false
  committed = prev
  sync()
}

export function redo() {
  if (inBurst) endBurst()
  const next = future.pop()
  if (!next) { sync(); return }
  track('editor_action', { action: 'redo' })
  past.push(take())
  restoring = true
  restore(next)
  restoring = false
  committed = next
  sync()
}

/**
 * A change to the caption style that isn't the user's edit (AI's key words, picked by themselves
 * when the clip has captions: useAutoKeyWords) — not an undo step, and every step keeps it, so an
 * undo never takes them off.
 */
export function addToCaptionStyleQuietly(patch: Partial<Snapshot['captionStyle']>) {
  const add = (s: Snapshot): Snapshot => ({ ...s, captionStyle: { ...s.captionStyle, ...patch } })
  restoring = true
  useCaptionStore.setState(s => ({ captionStyle: { ...s.captionStyle, ...patch } }))
  restoring = false
  past = past.map(add)
  future = future.map(add)
  if (committed) committed = inBurst ? add(committed) : take()
}

/** Start recording (call once the stores hold the loaded clip). Returns a stop function. */
export function startHistory(): () => void {
  past = []; future = []; inBurst = false; committed = take()
  sync()
  const unsubs = [useEditorStore.subscribe(onChange), useMediaStore.subscribe(onChange), useCaptionStore.subscribe(onChange), useBrandStore.subscribe(onChange), useGroupStore.subscribe(onChange)]
  const down = () => { pointerDown = true }
  const up = () => { pointerDown = false }
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', up, true)
  return () => {
    unsubs.forEach(u => u())
    window.removeEventListener('pointerdown', down, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', up, true)
    if (timer) clearTimeout(timer)
    past = []; future = []; committed = null; inBurst = false
    sync()
  }
}
