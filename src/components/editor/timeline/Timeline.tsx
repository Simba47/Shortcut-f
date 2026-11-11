'use client'

import { useRef, useState, useEffect, useLayoutEffect, useCallback, Fragment } from 'react'
import { createPortal } from 'react-dom'
import type { SegmentLocal, TextOverlay, FrameItem, FrameHold, FrameLane } from '@chai-cut/shared'
import type { TrackRef } from '@/modules/editor/tracks'
import { Waveform } from '../Waveform'
import { liveTime, usePlayerStore } from '@/modules/player/store'
import { isMainHold, sameLayer, movedHold, isFrameLayout, FRAME_TEMPLATES, frameOf, laneItems, itemBounds, MIN_ITEM_MS, isTextLane } from '@/modules/editor/frames'
import { isShot } from '@/modules/editor/shots'
import { isGapPart } from '@/modules/editor/visibility'
import { goesAfterMain } from '@/modules/editor/inserts'
import { TransitionGlyph, TRANSITION_DRAG_TYPE, TRANSITION_DEFAULT_MS, playedTransitionMs, transitionName, transitionSecs } from '../TransitionsPanel'
import {
  VideoThumbnails, LAYOUT_COLORS, FRAME_ITEM_COLORS, frameItemColor, visibleLanes, thumbsFor, nearestThumb,
  ACCENT, SELECTED_RING, msToLabel, LANE_META, type LaneMeta, InsertTag, MEDIA_COLORS,
  StateBadges, MediaIcon, MAX_ZOOM, STOCK_DRAG_TYPE, MEDIA_DRAG_TYPE, draggedIn, markTimelineOpened,
  type LaneCtl, type LaneCtlKey,
} from '../SegmentTimeline'

/** How near a part's end a video on a row must start to be offered a transition there (ms) */
const JOIN_REACH_MS = 500
/** A frozen video piece on a frame lane: pale ice-blue stripes over its colour */
/** A frozen stretch on a bar: see-through blue (user, 2026-11-10) */
const FROZEN_BLUE = 'rgba(59,130,246,0.32)'

/** A bar with freeze ranges on it (FrameSettings.freeze, or an older FrameItem.holds) */
interface FreezeBar {
  holds: FrameHold[]
  /** Clip time its `at_ms` count from */
  origin: number
  /** What of it shows here, clip time */
  from: number
  to: number
  /** Picked: the ranges can be dragged */
  on: boolean
  locked: boolean
  /** Dragging its end adds time, rather than meeting what's next */
  grows?: boolean
  /** Freeze `i` is now `h` (null: removed) */
  set: (i: number, h: FrameHold | null) => void
}

/**
 * The editor's timeline: the whole clip across the width, the playhead line moving over it. Press
 * or drag anywhere to move the playhead (near a cut it clicks onto it); pinch or Ctrl + wheel to
 * zoom, and the view then follows the playhead. Each part of the main video is its own block (its
 * format, its length), with a transition button in the gap between two parts; tap a block to
 * select it and drag its lime grips to trim. Videos on top, photos, text and music are slim
 * coloured bars on rows under it.
 *
 * The whole timeline is one layer, scrolled by moving it sideways; the playhead line is moved every
 * frame from the player's live time (no redraw while playing). Times are placed in % of the layer,
 * so every drag works out its time from where the layer is on screen (msFromClientX).
 */

/** Where a new row would open while something is carried: a quiet line, as in Resolve (the carried clip itself shows where it goes) */
const NEW_ROW_LINE = 'rgb(var(--ed-fg) / 0.5)'

export interface TimelineProps {
  segments: SegmentLocal[]
  clipStartMs: number
  clipEndMs: number
  currentTimeMs: number
  activeSegmentId: string | null
  videoUrl?: string
  sourceAt?: (clipMs: number) => number
  sourceKey?: string
  safeDurationMs?: number
  onSeek: (ms: number) => void
  /** Moving through the clip by hand starts: playback stops */
  onScrubStart?: () => void
  onSelectSegment: (id: string) => void
  /** A part's grip dragged (live: `done` false; once more on release) — see SegmentTimeline */
  onEdgeTrim?: (segId: string, edge: 'start' | 'end', fromMs: number, toMs: number, done: boolean) => void
  /** How much later the clip's end can go (more of the video after it): the last part's end grip stops
   *  there. Unset: no stop here (the editor stops it) */
  clipEndRoomMs?: number
  textOverlays?: TextOverlay[]
  activeTextOverlayId?: string | null
  onSelectTextOverlay?: (id: string) => void
  onTextOverlayUpdate?: (id: string, updates: { start_ms?: number; end_ms?: number }) => void
  frameSeg?: SegmentLocal | null
  activeFrameItemId?: string | null
  laneHighlight?: { lane: FrameLane; n: number; focusPlus?: boolean; openMenu?: boolean } | null
  videoTitles?: Record<string, string>
  onSelectFrameItem?: (id: string | null) => void
  onUpdateFrameItem?: (id: string, patch: Partial<Pick<FrameItem, 'start_ms' | 'end_ms' | 'source_offset_ms' | 'holds' | 'dim'>>) => void
  /** Freeze `n` of a layer of the frame changed on its bar: now `h`, or removed (null) */
  onFrameFreeze?: (layer: string, n: number, h: FrameHold | null) => void
  /** One of a main video part's freezes changed on its block */
  onPartFreeze?: (segId: string, i: number, h: FrameHold | null) => void
  /** `at`: an empty spot clicked (that frame, from that time); else the frame under the playhead, at it */
  onAddFrameItem?: (lane: FrameLane, anchor: DOMRect, at?: { segId: string; t: number }) => void
  onJumpToFrameItem?: (segId: string, itemId: string) => void
  viewMarkers?: { t_ms: number; cut: boolean }[]
  selectedViewT?: number | null
  onSelectView?: (t: number) => void
  onMoveView?: (from: number, to: number) => number | void
  onRemoveView?: (t: number) => void
  onDuplicateView?: (t: number) => void
  videoUrls?: Record<string, string>
  mediaLengths?: Record<string, number>
  mainVideoId?: string | null
  onBrollChange?: (segId: string, startMs: number, endMs: number, done?: boolean) => void
  pickedSegmentId?: string | null
  selectedId?: string | null
  onPickSegment?: (id: string | null) => void
  musicTracks?: { id: string; name: string; start_ms: number; duration_ms?: number; original?: boolean; muted?: boolean; locked?: boolean; track?: number; url?: string; key?: string; offset_ms?: number }[]
  onMusicMove?: (id: string, startMs: number) => void
  onMusicTrim?: (id: string, edge: 'start' | 'end', ms: number) => void
  selectedMusicId?: string | null
  onSelectMusic?: (id: string) => void
  onAddKind?: (kind: 'video' | 'broll' | 'photo' | 'music' | 'text' | 'insert' | 'pip' | 'overlay', atMs?: number) => void
  /** Where a removed part closed up inside a part (timeline ms): drawn as a cut in its block */
  cutJoins?: number[]
  isStock?: (seg: SegmentLocal) => boolean
  /** The main video's own sound is off: the button at the start of the main row shows it */
  mainMuted?: boolean
  /** "Mute clip audio" at the start of the main row */
  onToggleMainMute?: () => void
  /** A row's view, sound and lock (on = on for everything on it), for the buttons beside it; null: none */
  laneCtl?: (kind: string) => LaneCtl | null
  /** One of a row's buttons pressed: it switches for everything on the row */
  onLaneCtl?: (kind: string, key: LaneCtlKey) => void
  /**
   * The Captions row: the caption parts (captions/parts.ts playedParts, clip ms), each named by its
   * style, and the one picked ('first' for the first part, else its id; null: none). None: no row.
   */
  /**
   * The Captions row (as CapCut's caption track): each caption line a block with its words, in its
   * style's colour (`on`: selected — the Captions panel styles the lines selected). None: no row.
   */
  captionRow?: { lines: { start: number; end: number; text: string; color: string; name: string; on: boolean }[] } | null
  /** A caption line clicked (`add`: Shift / Ctrl — added to the selection, or taken off) */
  onCaptionLineClick?: (index: number, add: boolean) => void
  /** A stretch dragged across on the Captions row (clip ms): the lines in it are selected */
  onSelectCaptionRange?: (range: [number, number], add: boolean) => void
  /** The clip's transitions (after which part, which kind, how long): the marker on each cut shows it */
  transitions?: { after_segment_id: string; type: string; duration_ms?: number | null }[]
  /** A cut's transition taken away (its marker's menu, or Delete on it) */
  onRemoveTransition?: (afterSegmentId: string) => void
  /** This cut's kind on every cut (each keeps its own length) */
  onApplyTransitionToAll?: (afterSegmentId: string) => void
  /** A tile from the Transitions panel dropped on a cut */
  onDropTransition?: (afterSegmentId: string, type: string) => void
  /** The cut the Transition tool is on (its section id): marked on the timeline, with its transition */
  focusCut?: string | null
  /** The transition button between two parts: open the Transition tool on that cut */
  onOpenTransition?: (afterSegmentId: string, atMs: number) => void
  onDropFiles?: (files: File[], atMs: number, lane: string | null) => void
  onDropStock?: (json: string, atMs: number, lane?: string | null) => void
  onDropMedia?: (json: string, atMs: number, lane: string | null) => void
  photos?: { id: string; start_ms: number; end_ms: number; url?: string; hidden?: boolean; locked?: boolean; track?: number; video?: { url?: string; offset: number; muted?: boolean }; /** covers the whole frame */ full?: boolean }[]
  /** Something dragged to another row: a track, or a new row above all (`'new'`) or under the main video (`'new-below'`) */
  onTrackDrop?: (ref: TrackRef, target: number | 'new' | 'new-below') => void
  /** How many of the rows of videos, photos and text sit under the main video (tracks 0 … n-1); the rest are above it */
  belowRows?: number
  /** A block of the main row (a video put in, a part of the main video) dragged off it, onto a row (or a new one above / under the main video), starting at `atMs` */
  onPartToTrack?: (segId: string, target: number | 'new' | 'new-below', atMs: number) => void
  /** A video on a row dragged onto the main row: it goes in there, at `atMs` (a part of the main video on a row: starting at `startMs`, where it was let go) */
  onShotToMain?: (segId: string, atMs: number, startMs: number) => void
  /** How long the timeline can grow for a video on top dragged past its end (ms; the editor makes the room) */
  maxMs?: number
  /** A block of the main row (a part, or a video put in) dragged along it, let go at `toMs` (where it goes in, timeline ms) */
  onMovePart?: (segId: string, toMs: number) => void
  /** A part of the main row let go over empty room, its start at `startMs`: it goes exactly there (nothing else moves) */
  onPlacePart?: (segId: string, startMs: number) => void
  activePhotoId?: string | null
  onSelectPhoto?: (id: string) => void
  onPhotoTimeChange?: (id: string, updates: { start_ms: number; end_ms: number }) => void
  zoom?: number
  onZoomChange?: (z: number) => void
  /**
   * Several things picked at once (as in Resolve): videos and photos on rows, text, music — by
   * dragging a box over them from an empty spot, or Ctrl / Shift + click. Dragged, they move together;
   * Delete takes them all. The main video's own parts aren't among them (that row closes up).
   */
  groupSel?: string[]
  onGroupSel?: (ids: string[]) => void
  /** Groups made (as Resolve's Link Clips): a click on any member picks them all; Alt + click one alone */
  groups?: string[][]
  /** What's picked made one group / its groups undone (the right-click menu; Ctrl+G, Ctrl+Shift+G) */
  onGroup?: () => void
  onUngroup?: () => void
  /**
   * What's picked together carried up or down: every member of that kind of row (videos, photos and
   * text: 'visual'; music: 'audio') `delta` rows (+: further from the bottom for visual rows, further
   * down for music) — the editor refuses if anything else is in the way there
   */
  onGroupRows?: (ids: string[], delta: number, family: 'visual' | 'audio') => void
  /** The main video's parts among what's picked, carried along: each goes exactly there (or none, if one has no room) */
  onGroupParts?: (moves: { id: string; startMs: number }[]) => void
  /** The main video's parts among what's picked, carried off the main row onto a row (or a new one) */
  onGroupPartsToRow?: (moves: { id: string; startMs: number }[], target: number | 'new' | 'new-below') => void
  /**
   * How tall the timeline is with just the ruler, the main video and its own rows (captions, sound,
   * views), px: the editor opens it this tall — the other rows scroll inside until it's dragged taller
   */
  onBaseHeight?: (px: number) => void
}

/** What the + adds (at the playhead): a video (picked in Media), sound, or text */
const ADD_CHOICES: { kind: 'video' | 'music' | 'text'; label: string; hint: string; color: string; icon: React.ReactNode }[] = [
  { kind: 'video', label: 'Video', hint: 'Pick one from your media', color: MEDIA_COLORS.video,
    icon: <><rect x="2.5" y="5" width="14" height="14" rx="3" /><path d="M16.5 10l5-3v10l-5-3" /></> },
  { kind: 'music', label: 'Music & sound', hint: 'Songs, effects or your audio', color: MEDIA_COLORS.music,
    icon: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></> },
  { kind: 'text', label: 'Text', hint: 'Words on the video', color: MEDIA_COLORS.text,
    icon: <path d="M4 7V4h16v3M9 20h6M12 4v16" /> },
]

const RULER_H = 26
const BLOCK_H = 40
const MAIN_PAD = 6
const VIEW_ROW_H = 20
const ORIG_ROW_H = 24
/** The Captions row: one block per caption part, each in its own style */
const CAP_ROW_H = 30
/** The Captions row's icon (lane meta, as the other rows have) */
const CAPTIONS_META: LaneMeta = { label: 'Captions', color: '#e5e7eb', icon: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M10 10.2a2.2 2.2 0 100 3.6M16.5 10.2a2.2 2.2 0 100 3.6" /></> }
const ROW_H = 30
/** A row of videos, photos and text: its bars as tall as the main video's parts (BLOCK_H) */
const VIS_ROW_H = BLOCK_H + 4
const ROW_GAP = 3
const FRAME_LANE_H = 26
/** The picked frame's name and time over its rows */
const FRAME_HEAD_H = 16
const LEFT_W = 52
/** With a row's buttons beside its icon (view, sound, lock: as in Resolve's track header) */
const LEFT_W_CTL = 104
/** Where each of a row's buttons sits in the left column (px from its left edge): evenly spaced from
 *  the left, the same columns on every row (the main row's too), under the + button (user, 2026-10-30) */
const ROW_CTL_X: Record<LaneCtlKey, number> = { hidden: 10, muted: 34, locked: 58 }
/** Where a row's icon sits after its buttons (only a row of one kind of media has one) */
const ROW_ICO_X = 82
/** The + button over the buttons: as wide as the three of them */
const ADD_CTL_BOX = { left: 10, width: 68 }
/** Room at each end of the timeline, so the grips at the clip's very ends stay clear of the border */
const PAD = 16
/** An end grip dragged out: how far past it the timeline opens up (room to drag into) */
const REACH_AHEAD_MS = 6000
/** A grip dragged: how often the clip itself is worked out again (the grip follows every frame) */
const LIVE_APPLY_MS = 90
/** Holding a grip at the view's edge: the fastest it scrolls (px a frame), and (ms of video a frame: 15 s a second) */
const EDGE_SCROLL_MAX = 60
const EDGE_SCROLL_MAX_MS = 250
const GRIP_W = 14
/** Within this many pixels of a cut (or an item's edge) the playhead clicks onto it */
const SNAP_PX = 8
const MIN_PART_MS = 300

/** Bars whose name has been shown (each shows its name once, when it goes in), and since when the timeline is open */
const barNamesSeen = new Set<string>()
let barsSince = 0
/** A video's name on its bar for 3 s after it goes in (as a video put in the main row), then `short` */
function BarName({ id, name, short }: { id: string; name: string; short: string }) {
  const [fresh, setFresh] = useState(() => {
    const f = typeof performance !== 'undefined' && barsSince > 0 && performance.now() - barsSince > 1500 && !barNamesSeen.has(id)
    barNamesSeen.add(id)
    return f
  })
  useEffect(() => {
    if (!fresh) return
    const t = setTimeout(() => setFresh(false), 3000)
    return () => clearTimeout(t)
  }, [fresh])
  return <span className="truncate">{fresh ? name : short}</span>
}

/** A clip time as the playhead's bubble shows it: 0:12.4 */
function clockLabel(ms: number) {
  // (to tenths first: 9.96 s is 0:10.0, not 0:010.0)
  const tenths = Math.round(Math.max(0, ms) / 100)
  const m = Math.floor(tenths / 600), s = (tenths % 600) / 10
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`
}
/** How long a part just made longer shows what it gained (then it looks as any other part) */
const GROWN_SHOW_MS = 1600
/** A block's length: 12.4s, or 1:05.2 */
function lenLabel(ms: number) {
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : clockLabel(ms)
}
/** A format's short name on its block */
function formatTag(seg: SegmentLocal): string {
  if (isFrameLayout(seg.layout)) return FRAME_TEMPLATES[seg.layout].name
  if (seg.layout === 'split') return 'Split'
  return seg.layout.charAt(0).toUpperCase() + seg.layout.slice(1)
}

export function Timeline({
  segments, mainVideoId, clipStartMs, clipEndMs, currentTimeMs, activeSegmentId, videoUrl, sourceAt, sourceKey,
  safeDurationMs, onSeek, onScrubStart, onSelectSegment, onEdgeTrim, clipEndRoomMs,
  textOverlays = [], photos = [], activePhotoId = null, onSelectPhoto, onPhotoTimeChange,
  musicTracks = [], onMusicMove, onMusicTrim, selectedMusicId = null, onSelectMusic,
  activeTextOverlayId, onSelectTextOverlay, onTextOverlayUpdate,
  frameSeg, activeFrameItemId, laneHighlight, videoTitles = {}, onSelectFrameItem, onUpdateFrameItem, onFrameFreeze, onPartFreeze, onAddFrameItem, onJumpToFrameItem,
  viewMarkers = [], selectedViewT = null, onSelectView, onMoveView, onRemoveView, onDuplicateView,
  onBrollChange, videoUrls = {}, mediaLengths = {}, zoom: zoomProp, onZoomChange,
  onAddKind, cutJoins = [], isStock, onDropFiles, onDropStock, onDropMedia,
  mainMuted = false, onToggleMainMute, laneCtl, onLaneCtl, captionRow, onCaptionLineClick, onSelectCaptionRange, transitions = [], focusCut = null, onOpenTransition, onRemoveTransition, onApplyTransitionToAll, onDropTransition,
  onTrackDrop, belowRows = 0, onMovePart, onPlacePart, onPartToTrack, onShotToMain, maxMs, pickedSegmentId = null, selectedId, onPickSegment,
  groupSel = [], onGroupSel, groups = [], onGroup, onUngroup, onGroupRows, onGroupParts, onGroupPartsToRow, onBaseHeight,
}: TimelineProps) {
  const viewRef = useRef<HTMLDivElement>(null)        // what shows (the playhead sits in its middle)
  const contentRef = useRef<HTMLDivElement>(null)     // the layer that slides under it
  const trackRef = useRef<HTMLDivElement>(null)       // the whole layer (ruler on top): times and rows are measured on it
  const lineRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const [viewW, setViewW] = useState(0)
  const [zoomState, setZoomState] = useState(1)
  const zoom = zoomProp ?? zoomState
  const setZoom = (z: number) => { if (onZoomChange) onZoomChange(z); else setZoomState(z) }
  const [dragging, setDragging] = useState<string | null>(null)
  const [snapLine, setSnapLine] = useState<number | null>(null)
  const [viewDragT, setViewDragT] = useState<number | null>(null)
  /** A grip being dragged: where its edge is now (the start of a block applies on release) */
  const [edgeGhost, setEdgeGhost] = useState<{ id: string; from: number; to: number; edge: 'start' | 'end' } | null>(null)
  // A part just made longer by dragging an edge out: which, at which edge, and how long it was before —
  // what it gained shows for a moment (GROWN_SHOW_MS), then it looks as any other part
  const [grown, setGrown] = useState<{ id: string; edge: 'start' | 'end'; before: number; key: number } | null>(null)
  useEffect(() => {
    if (!grown) return
    const t = setTimeout(() => setGrown(g => (g && g.key === grown.key ? null : g)), GROWN_SHOW_MS)
    return () => clearTimeout(t)
  }, [grown])
  /** While a grip is dragged the timeline keeps its scale (the clip's length changes under it) */
  const [frozenDur, setFrozenDur] = useState<number | null>(null)
  /** While something is carried along (carryAlong): the scale it started at (px per ms) */
  const carryScaleRef = useRef<number | null>(null)
  const [brollGhost, setBrollGhost] = useState<{ id: string; start: number; end: number } | null>(null)
  /** A bar dragged by its body: it follows the pointer up and down too (it lands on the row it's let go
   *  over), and its new time shows over the timeline */
  const [lift, setLift] = useState<{ id: string; dy: number; start: number; end: number } | null>(null)
  /**
   * The view markers (where the picture's frame was placed or moved) show for 3 s after each change,
   * then fade: pointing at their row, a picked one or one being dragged brings them back (their row
   * keeps its room, so nothing moves when they fade)
   */
  const viewsKey = viewMarkers.map(v => `${v.t_ms}:${v.cut ? 1 : 0}`).join(',')
  const [viewsFresh, setViewsFresh] = useState(false)
  const [viewsHover, setViewsHover] = useState(false)
  const viewsSeenRef = useRef<string | null>(null)
  useEffect(() => {
    // (as the editor opens: hidden; from then on each change shows them for 3 s)
    if (viewsSeenRef.current === null) { viewsSeenRef.current = viewsKey; return }
    if (viewsSeenRef.current === viewsKey) return
    viewsSeenRef.current = viewsKey
    if (!viewsKey) return
    setViewsFresh(true)
    const t = setTimeout(() => setViewsFresh(false), 3000)
    return () => clearTimeout(t)
  }, [viewsKey])
  /** A bar being trimmed by a grip: its new length, over the edge being moved */
  const [barTip, setBarTip] = useState<{ id: string; at: number; text: string } | null>(null)
  /** A video put in the main row, carried along it: where it will go in (`to`), how far it's carried */
  const [insertDrag, setInsertDrag] = useState<{ id: string; to: number; dx: number; dy: number; off?: boolean; place?: number } | null>(null)
  /** A video on a row carried over the main row: where it would go in (it goes in there when let go) */
  const [mainDropAt, setMainDropAt] = useState<number | null>(null)
  const [addMenu, setAddMenu] = useState<DOMRect | null>(null)
  /** `end`: a video that goes on after the main row's last part, there (goesAfterMain) */
  const [dropAt, setDropAt] = useState<{ ms: number; lane: string | null; what: string; y: number; end?: number } | null>(null)
  /** How far what's being dragged in reaches (ms), while it reaches past the clip's end */
  const [dropReach, setDropReach] = useState<number | null>(null)
  /** An end grip dragged out: the timeline reaches this far (the scale held), so there is room to drag into and scroll along */
  const [edgeReach, setEdgeReach] = useState<number | null>(null)
  // A transition tile dragged over the timeline: the cut it would land on
  const [dropCut, setDropCut] = useState<string | null>(null)
  // A cut's marker right-clicked: its menu (where, which cut)
  const [cutMenu, setCutMenu] = useState<{ afterId: string; at: number; x: number; y: number } | null>(null)
  const [trackHover, setTrackHover] = useState<{ family: 'visual' | 'audio'; target: number | 'new' | 'new-below' } | null>(null)
  const trackHoverRef = useRef<typeof trackHover>(null)
  const [pulseLane, setPulseLane] = useState<FrameLane | null>(null)
  const lanesRef = useRef<HTMLDivElement>(null)
  const plusRefs = useRef(new Map<string, HTMLButtonElement>())
  const noSnapRef = useRef(false)
  const nowRef = useRef(currentTimeMs)
  nowRef.current = currentTimeMs

  useEffect(() => { markTimelineOpened(); if (!barsSince) barsSince = performance.now() }, [])
  useEffect(() => {
    if (!addMenu) return
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setAddMenu(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [addMenu])
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    setViewW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  // A lane pointed at from the preview: scroll to it, focus its "+", pulse it
  useEffect(() => {
    if (!laneHighlight) return
    setPulseLane(laneHighlight.lane)
    lanesRef.current?.scrollIntoView({ block: 'nearest', behavior: laneHighlight.openMenu ? 'auto' : 'smooth' })
    const plus = plusRefs.current.get(String(laneHighlight.lane))
    if (laneHighlight.focusPlus !== false) plus?.focus({ preventScroll: true })
    if (laneHighlight.openMenu && plus) onAddFrameItem?.(laneHighlight.lane, plus.getBoundingClientRect())
    const t = setTimeout(() => setPulseLane(null), 1800)
    return () => clearTimeout(t)
  }, [laneHighlight]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scale: at 1× the whole clip fills the width; zoomed in, the view scrolls along it ──
  const duration = (clipEndMs - clipStartMs) || safeDurationMs || 0
  const base = Math.max(120, viewW - PAD * 2)
  // (media dragged in past the end: the timeline grows to show all of it, as for a bar carried there)
  const scaleDur = Math.max(1, frozenDur ?? Math.max(duration, dropReach ?? 0))
  // (while something is carried the scale is held exactly as it was: nothing — the clip growing, the
  // view's own width — changes it under the pointer)
  const pxPerMs = carryScaleRef.current ?? (zoom * base) / scaleDur
  const viewDur = Math.max(duration, frozenDur ?? 0, dropReach ?? 0, edgeReach ?? 0, 1)
  const contentW = viewDur * pxPerMs
  const pct = (ms: number) => (ms / viewDur) * 100
  const at = pct

  // ── The playhead line moves over the clip (every frame from the live time); zoomed in, the view
  //    follows it when it would leave the view ──
  /** How far the view is scrolled along the clip (px) */
  const scrollRef = useRef(0)
  /** While a grip is dragged the view keeps still (set: the layer's x) */
  const freezeRef = useRef<number | null>(null)
  /** When the view was last scrolled by hand: it doesn't follow the playhead right after */
  const handScrollAt = useRef(0)
  const geoRef = useRef({ viewW, pxPerMs, contentW, duration })
  geoRef.current = { viewW, pxPerMs, contentW, duration }
  const maxScroll = () => Math.max(0, geoRef.current.contentW - (geoRef.current.viewW - PAD * 2))
  const clampScroll = (x: number) => Math.max(0, Math.min(maxScroll(), x))
  const place = useCallback(() => {
    const c = contentRef.current, line = lineRef.current
    if (!c) return
    const { viewW: w, pxPerMs: k } = geoRef.current
    const now = liveTime.get()
    if (freezeRef.current == null) {
      scrollRef.current = clampScroll(scrollRef.current)
      // (the playhead about to leave the view: the view moves on, the playhead at a fifth of it)
      const x = now * k - scrollRef.current, span = w - PAD * 2
      if ((x < 0 || x > span - 16) && performance.now() - handScrollAt.current > 800) scrollRef.current = clampScroll(now * k - span * 0.2)
    }
    const tx = freezeRef.current ?? PAD - scrollRef.current
    c.style.transform = `translate3d(${tx}px,0,0)`
    if (line) line.style.transform = `translate3d(${tx + now * k}px,0,0)`
    if (bubbleRef.current) bubbleRef.current.textContent = clockLabel(now)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(place)
  useEffect(() => liveTime.subscribe(place), [place])
  /** The layer's x offset right now */
  const currentTx = () => freezeRef.current ?? PAD - scrollRef.current
  /** Let go of a frozen view: it stays where it was */
  const unfreeze = () => {
    if (freezeRef.current != null) scrollRef.current = clampScroll(PAD - freezeRef.current)
    freezeRef.current = null
    handScrollAt.current = performance.now()
    place()
  }
  // Zoomed with the wheel: the moment under the pointer stays under the pointer
  const zoomAnchor = useRef<{ t: number; x: number } | null>(null)
  useLayoutEffect(() => {
    const a = zoomAnchor.current
    if (!a) return
    zoomAnchor.current = null
    scrollRef.current = clampScroll(a.t * pxPerMs - a.x)
    handScrollAt.current = performance.now()
    place()
  }, [pxPerMs]) // eslint-disable-line react-hooks/exhaustive-deps

  // (from the layer's place and the scale as they are now — a drag keeps calling these while the clip
  // grows under it, so never this render's length: the time under the pointer would drift back)
  function msFromClientX(clientX: number): number {
    return Math.min(rawMsFromClientX(clientX), geoRef.current.duration)
  }
  /** As msFromClientX, but not stopped at the timeline's end (a video on top can be taken past it) */
  function rawMsFromClientX(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect()
    const k = geoRef.current.pxPerMs
    if (!rect || rect.width <= 0 || !(k > 0)) return 0
    return Math.max(0, (clientX - rect.left) / k)
  }
  const msPerPx = () => 1 / Math.max(1e-9, pxPerMs)

  // ── The parts of the main row, the videos on top, the rows under it ──
  const byTime = [...segments].sort((a, b) => a.start_ms - b.start_ms)
  const brolls = byTime.filter(sg => isShot(sg, mainVideoId))
  const mains = byTime.filter(sg => !isShot(sg, mainVideoId))
  const junctions: { left: SegmentLocal; right: SegmentLocal }[] = []
  for (let i = 0; i + 1 < mains.length; i++) {
    if (Math.abs(mains[i + 1].start_ms - mains[i].end_ms) <= 1) junctions.push({ left: mains[i], right: mains[i + 1] })
  }
  const isSel = (id: string, own: boolean) => (selectedId !== undefined ? id === selectedId : own)
  const musicEnd = (m: { start_ms: number; duration_ms?: number }) => Math.min(duration, m.start_ms + (m.duration_ms ?? duration))
  const originals = musicTracks.filter(m => m.original)
  const songs = musicTracks.filter(m => !m.original)
  type Visual = { kind: 'shot'; id: string; track: number; seg: SegmentLocal }
    | { kind: 'photo'; id: string; track: number; ph: (typeof photos)[number] }
    | { kind: 'text'; id: string; track: number; o: TextOverlay }
  const visual: Visual[] = [
    ...brolls.map(seg => ({ kind: 'shot' as const, id: seg.id, track: seg.track ?? 0, seg })),
    ...photos.map(ph => ({ kind: 'photo' as const, id: ph.id, track: ph.track ?? 0, ph })),
    ...textOverlays.map(o => ({ kind: 'text' as const, id: o.id, track: o.track ?? 0, o })),
  ]
  const visualTracks = [...new Set(visual.map(v => v.track))].sort((a, b) => b - a)
  const songTracks = [...new Set(songs.map(m => m.track ?? 0))].sort((a, b) => a - b)
  const transitionAfter = new Map(transitions.map(t => [t.after_segment_id, t]))

  // ── Moving the playhead: press or drag anywhere on the ruler or the rows; it clicks onto cuts ──
  /** Where the playhead clicks to: cuts, the clip's ends, and the edges of everything on the rows */
  const snapTargets = () => {
    const out = [0, duration, ...cutJoins]
    for (const s of segments) out.push(s.start_ms, s.end_ms)
    for (const p of photos) out.push(p.start_ms, p.end_ms)
    for (const o of textOverlays) out.push(o.start_ms, o.end_ms)
    for (const m of musicTracks) out.push(m.start_ms, musicEnd(m))
    return out
  }
  const [snapFlash, setSnapFlash] = useState(0)
  function scrubTo(t: number, snap = true) {
    let best = Math.max(0, Math.min(duration, t))
    if (snap) {
      const tol = SNAP_PX * msPerPx()
      let bestD = tol, hit: number | null = null
      for (const x of snapTargets()) { const d = Math.abs(x - t); if (d < bestD) { bestD = d; hit = x } }
      if (hit !== null) {
        // (on the last frame of the part before a cut, not past the clip's end)
        best = Math.min(hit, Math.max(0, duration - 1))
        if (snapAtRef.current !== hit) { snapAtRef.current = hit; setSnapFlash(n => n + 1) }
      } else snapAtRef.current = null
    }
    onSeek(best)
  }
  const snapAtRef = useRef<number | null>(null)
  /** The main row's part under the pointer (null: none there) */
  const partAt = (clientX: number, clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return undefined
    // (the main row sits under the ruler and the rows on top of it)
    const y = clientY - rect.top
    if (y < mainTop + MAIN_PAD || y > mainTop + MAIN_PAD + BLOCK_H) return undefined
    const t = msFromClientX(clientX)
    return mains.find(m => t >= m.start_ms && t < m.end_ms) ?? null
  }
  // ── Several picked at once (as in Resolve): a box dragged from an empty spot, Ctrl / Shift + click ──
  const groupSet = new Set(groupSel)
  /** The made group `id` is in (its members still on the timeline), if any */
  const madeGroupOf = (id: string) => {
    const g = groups.find(x => x.includes(id))
    return g ? g.filter(x => !!groupItem(x)) : null
  }
  /** Ids with every member of their made groups added */
  const withMade = (ids: string[]) => [...new Set(ids.flatMap(id => madeGroupOf(id) ?? [id]))]
  /** The right-click menu on picked things: group / ungroup / where (screen px) */
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number; canGroup: boolean; canUngroup: boolean; n: number } | null>(null)
  type GroupItem = { id: string; kind: 'shot' | 'photo' | 'text' | 'music' | 'part'; start: number; end: number; track: number }
  /** What a picked id is on the timeline (null: nothing that can be one of a group) */
  const groupItem = (id: string): GroupItem | null => {
    const sg = brolls.find(x => x.id === id)
    if (sg) return sg.locked ? null : { id, kind: 'shot', start: sg.start_ms, end: sg.end_ms, track: sg.track ?? 0 }
    const ph = photos.find(x => x.id === id)
    if (ph) return ph.locked ? null : { id, kind: 'photo', start: ph.start_ms, end: ph.end_ms, track: ph.track ?? 0 }
    const o = textOverlays.find(x => x.id === id)
    if (o) return o.locked ? null : { id, kind: 'text', start: o.start_ms, end: o.end_ms, track: o.track ?? 0 }
    const m = musicTracks.find(x => x.id === id)
    if (m) return m.locked || m.original ? null : { id, kind: 'music', start: m.start_ms, end: musicEnd(m), track: m.track ?? 0 }
    // A part of the main video (not the room after it, not an empty stretch): it moves only along its row
    const mp = mains.find(x => x.id === id)
    if (mp) return mp.locked || !onGroupParts || isTailPart(mp) || isGapPart(mp, mainVideoId) ? null : { id, kind: 'part', start: mp.start_ms, end: mp.end_ms, track: 0 }
    return null
  }
  /** Which rows a picked thing moves up and down among (a part of the main video: none) */
  const familyOf = (k: GroupItem['kind']) => (k === 'music' ? 'audio' as const : k === 'part' ? null : 'visual' as const)
  /**
   * While picked things are carried: how far along (px: for the main video's parts, which move on
   * release) and how far up or down the ones of the grabbed one's kind of row go (px, and in rows)
   */
  const [groupShift, setGroupShift] = useState<{ dx: number; dy: number; rows: number; family: 'visual' | 'audio' | null; dys?: Record<string, number>; pdy?: number } | null>(null)
  /** The one thing picked on its own now, if it can join a group (Ctrl-click a second thing: both are picked) */
  const pickedAlone = () => viewRef.current?.querySelector('.tl2-bar[data-sel][data-pick]:not([data-group]), .tl2-block[data-selected][data-pick]:not([data-group])')?.getAttribute('data-item-id') ?? null
  /**
   * A press on a bar, before the bar's own handling: Ctrl / Shift / ⌘ + click adds it to the picked
   * ones or takes it off; pressed while one of several picked, the group is carried. True: handled here.
   */
  function groupPointer(e: React.PointerEvent, id: string, kind: string): boolean {
    if (!onGroupSel || e.button !== 0 || kind === 'frame') return false
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.stopPropagation(); e.preventDefault()
      if (!groupItem(id)) return true
      const base = groupSel.length ? groupSel : withMade([pickedAlone()].filter((x): x is string => !!x && x !== id))
      // (a member of a made group: the whole group comes and goes together)
      const these = e.altKey ? [id] : madeGroupOf(id) ?? [id]
      const next = base.includes(id) ? base.filter(x => !these.includes(x)) : [...new Set([...base, ...these])]
      onPickSegment?.(null)
      onGroupSel(next.length > 1 ? next : [])
      // (one left: it's simply the one picked)
      if (next.length === 1) pickOne(next[0])
      return true
    }
    if (groupSet.has(id) && groupSel.length > 1) { handleGroupDown(e, id); return true }
    // A member of a made group (no Alt: Alt + click picks it alone, to trim it): the whole group is
    // picked, and a drag carries it at once
    const made = !e.altKey ? madeGroupOf(id) : null
    if (made && made.length > 1) {
      onPickSegment?.(null)
      onGroupSel(made)
      handleGroupDown(e, id, made)
      return true
    }
    // (a plain click on something else: just that one is picked, as before)
    if (groupSel.length) onGroupSel([])
    return false
  }
  /** One thing picked the usual way (its own row's pick) */
  function pickOne(id: string) {
    const it = groupItem(id)
    if (!it) return
    if (it.kind === 'shot' || it.kind === 'part') onPickSegment?.(id)
    else if (it.kind === 'photo') onSelectPhoto?.(id)
    else if (it.kind === 'text') onSelectTextOverlay?.(id)
    else onSelectMusic?.(id)
  }
  /**
   * The picked ones carried together (as in Resolve): along the timeline they keep their places to each
   * other, never start before the clip or (but music) are held at its end, and the group's start or end
   * clicks onto the edges of what isn't in it. Up or down, the ones on the grabbed one's kind of row
   * (videos, photos and text; or music) go as many rows as it does — onto other rows, or a new one on
   * top. The main video's parts go along their row only, placed on release. Not moved: a click — just
   * that one is picked.
   */
  function handleGroupDown(e: React.PointerEvent, id: string, ids: string[] = groupSel) {
    e.stopPropagation(); e.preventDefault()
    const items = ids.map(groupItem).filter((x): x is GroupItem => !!x)
    const inIt = new Set(ids)
    if (!items.length) return
    // (how far is measured on the timeline, not the screen: it holds while the timeline scrolls along)
    const sx = e.clientX, k = msPerPx(), t0 = rawMsFromClientX(sx)
    const first = Math.min(...items.map(x => x.start)), last = Math.max(...items.map(x => x.end))
    const room = Math.max(duration, maxMs ?? duration)
    let lo = -first
    // (music stays within the clip; videos, photos and text on top can go on past its end)
    let hi = Math.min(...items.map(x => (x.kind === 'music' ? duration : room) - x.end))
    // The main video's parts among them stop at the parts of the main video that aren't (empty
    // stretches and the room after the row are free): the whole group stops with them, so it all
    // moves or none of it does
    // (off the main row, its parts aren't held by the rest of it)
    const freeLo = lo, freeHi = hi
    const solid = mains.filter(m => !inIt.has(m.id) && !isTailPart(m) && !isGapPart(m, mainVideoId))
    for (const it of items) {
      if (it.kind !== 'part') continue
      const before = solid.filter(m => m.end_ms <= it.start + 1).reduce((a, m) => Math.max(a, m.end_ms), 0)
      const after = solid.filter(m => m.start_ms >= it.end - 1).reduce((a, m) => Math.min(a, m.start_ms), Infinity)
      lo = Math.max(lo, before - it.start)
      hi = Math.min(hi, after - it.end)
    }
    const others = [0, duration, ...cutJoins,
      ...segments.filter(s => !inIt.has(s.id)).flatMap(s => [s.start_ms, s.end_ms]),
      ...photos.filter(p => !inIt.has(p.id)).flatMap(p => [p.start_ms, p.end_ms]),
      ...textOverlays.filter(o => !inIt.has(o.id)).flatMap(o => [o.start_ms, o.end_ms]),
      ...musicTracks.filter(m => !inIt.has(m.id)).flatMap(m => [m.start_ms, musicEnd(m)])]
    let moved = false, d = 0, rows = 0
    const sy = e.clientY
    // Up or down: the rows of the grabbed one's kind, measured as they're drawn
    const grabbed = items.find(x => x.id === id)
    const family = grabbed ? familyOf(grabbed.kind) : null
    const homeRow = (e.currentTarget as Element | null)?.closest?.('[data-track-row]') as HTMLElement | null
    const lowest = family ? Math.min(...items.filter(x => familyOf(x.kind) === family).map(x => x.track)) : 0
    const rowsAt = (y: number): { rows: number; dy: number } => {
      if (!family || !homeRow || !grabbed || !onGroupRows) return { rows: 0, dy: 0 }
      const list = [...(viewRef.current?.querySelectorAll<HTMLElement>(`[data-track-row="${family}"]`) ?? [])]
      const home = homeRow.getBoundingClientRect()
      if (!list.length) return { rows: 0, dy: 0 }
      let pool = list
      if (family === 'visual') {
        // Measured against the main video, as one thing dragged on its own (hoverTrack): on it, the
        // group stays on its rows; above it, the rows above (past the highest, a new row on top);
        // under it, the rows under it. (Measured against the topmost row alone, a group on the rows
        // under the main video jumped over it to a new top row at the first move up.)
        const main = trackRef.current?.querySelector('[data-lane="main"]')?.getBoundingClientRect()
        const above = list.filter(r => Number(r.dataset.track) >= belowRows)
        const under = list.filter(r => Number(r.dataset.track) < belowRows)
        if (main && y >= main.top && y <= main.bottom) return { rows: 0, dy: 0 }
        if (!main || y < main.top) {
          const tb = (above[0] ?? null)?.getBoundingClientRect()
          if (!tb || y < tb.top - ROW_GAP) {
            const maxT = Math.max(belowRows - 1, ...list.map(r => Number(r.dataset.track)))
            const roof = tb ? tb.top : (main?.top ?? home.top)
            return { rows: maxT + 1 - grabbed.track, dy: roof - VIS_ROW_H - ROW_GAP - home.top }
          }
          pool = above
        } else {
          // (past the lowest row under it: a new row at the bottom, the group's lowest one on it)
          const low = under.length ? under[under.length - 1].getBoundingClientRect() : main
          if (low && y > low.bottom + ROW_GAP) {
            const lowRow = list.find(r => Number(r.dataset.track) === lowest)?.getBoundingClientRect()
            return lowRow ? { rows: -lowest - 1, dy: low.bottom + ROW_GAP - lowRow.top } : { rows: 0, dy: 0 }
          }
          if (under.length) pool = under
        }
      }
      let best = homeRow, bestD = Infinity
      for (const r of pool) {
        const b = r.getBoundingClientRect()
        const dd = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0
        if (dd < bestD) { best = r; bestD = dd }
      }
      const n = Number(best.dataset.track) - grabbed.track
      // (none below the lowest row: the group stops where its lowest member is on row 0)
      if (n < -lowest) {
        const floor = list.find(r => Number(r.dataset.track) === grabbed.track - lowest)
        return floor ? { rows: -lowest, dy: floor.getBoundingClientRect().top - home.top } : { rows: 0, dy: 0 }
      }
      return { rows: n, dy: best.getBoundingClientRect().top - home.top }
    }
    const fam = family ? items.filter(x => familyOf(x.kind) === family) : []
    // Where each one lands, drawn row by row (the rows aren't evenly spaced across the main video, so
    // one shift for all drew the ones crossing it on top of it); rows that don't exist yet, where they'll open
    const rowStep = VIS_ROW_H + ROW_GAP
    const topOf = (t: number, list: HTMLElement[], main: DOMRect | undefined): number | null => {
      const r = list.find(x => Number(x.dataset.track) === t)
      if (r) return r.getBoundingClientRect().top
      if (family !== 'visual') return null
      if (t >= belowRows) {
        const up = list.filter(x => Number(x.dataset.track) >= belowRows)
        if (up.length) { const maxT = Number(up[0].dataset.track); return up[0].getBoundingClientRect().top - (t - maxT) * rowStep }
        return main ? main.top - ROW_GAP - VIS_ROW_H - (t - belowRows) * rowStep : null
      }
      const floor = list.find(x => Number(x.dataset.track) === 0)?.getBoundingClientRect() ?? main
      return floor ? floor.bottom + ROW_GAP + (-t - 1) * rowStep : null
    }
    const landing = (n: number, dy: number) => {
      if (!family || !n) return undefined
      const list = [...(viewRef.current?.querySelectorAll<HTMLElement>(`[data-track-row="${family}"]`) ?? [])]
      const main = trackRef.current?.querySelector('[data-lane="main"]')?.getBoundingClientRect()
      const out: Record<string, number> = {}
      for (const it of fam) {
        const from = topOf(it.track, list, main), to = topOf(it.track + n, list, main)
        out[it.id] = from != null && to != null ? to - from : dy
      }
      return out
    }
    setDragging(`group-${id}`)
    const parts = items.filter(x => x.kind === 'part')
    // Grabbed by one of the main video's parts: up or down, its parts leave the main row for a row
    // above or below it (or a new one), as one part dragged on its own does (hoverTrack)
    const partsOff = grabbed?.kind === 'part' && !!onGroupPartsToRow
    let off = false
    // Set once, on release (while carried they're only drawn moved: nothing is saved per pointer move,
    // so it keeps up with the pointer). Never settled one by one: the group is placed as a whole after
    // (onGroupRows), so none is bumped onto another row on its own
    const apply = () => {
      if (!Math.round(d)) return
      for (const it of items) {
        const s = Math.round(it.start + d), en = Math.round(it.end + d)
        if (it.kind === 'part') continue
        if (it.kind === 'shot') onBrollChange?.(it.id, s, en, false)
        else if (it.kind === 'photo') onPhotoTimeChange?.(it.id, { start_ms: s, end_ms: en })
        else if (it.kind === 'text') onTextOverlayUpdate?.(it.id, { start_ms: s, end_ms: en })
        else onMusicMove?.(it.id, s)
      }
    }
    // (one redraw per frame, however many pointer moves come in)
    let raf = 0, lastEv: PointerEvent | null = null
    track(ev => {
      lastEv = ev
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (lastEv) step(lastEv) })
    }, () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; if (lastEv) step(lastEv) }
      finish()
    }, true)
    function step(ev: PointerEvent) {
      if (!moved && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return
      moved = true
      if (partsOff) {
        const main = trackRef.current?.querySelector('[data-lane="main"]')?.getBoundingClientRect()
        off = !!main && (ev.clientY < main.top - 8 || ev.clientY > main.bottom + 8)
        if (off) hoverTrack(ev, 'visual', -1)
        else if (trackHoverRef.current) { trackHoverRef.current = null; setTrackHover(null) }
      }
      const minD = off ? freeLo : lo, maxD = off ? freeHi : hi
      let want = Math.max(minD, Math.min(maxD, rawMsFromClientX(ev.clientX) - t0))
      // (the group's start or end onto another thing's edge, whichever is nearer)
      if (!ev.altKey) {
        const tol = SNAP_PX * k
        let best: { dd: number; at: number } | null = null
        for (const x of others) for (const edge of [first, last]) {
          const dd = x - edge
          if (Math.abs(dd - want) < tol && (!best || Math.abs(dd - want) < Math.abs(best.dd - want))) best = { dd, at: x }
        }
        if (best && best.dd >= minD && best.dd <= maxD) { want = best.dd; setSnapLine(best.at) } else setSnapLine(null)
      }
      d = want
      const v = rowsAt(ev.clientY)
      rows = v.rows
      setGroupShift({ dx: d * geoRef.current.pxPerMs, dy: rows ? v.dy : 0, rows, family, dys: landing(rows, v.dy), pdy: off ? ev.clientY - sy : 0 })
    }
    function finish() {
      setGroupShift(null)
      if (moved) {
        apply()
        if (partsOff) {
          const h = trackHoverRef.current
          trackHoverRef.current = null
          setTrackHover(null)
          // (off the main row, over a row or where a new one opens: the parts go onto it)
          if (off && h && h.target !== -1) onGroupPartsToRow?.(parts.map(p => ({ id: p.id, startMs: Math.round(p.start + d) })), h.target as number | 'new' | 'new-below')
          if (off) return
        }
        // (on rows that are taken there, rows open for them right there: EditorShell moveGroupRows)
        if (family && (rows !== 0 || Math.round(d) !== 0)) onGroupRows?.(fam.map(x => x.id), rows, family)
        if (parts.length && Math.round(d) !== 0) onGroupParts?.(parts.map(p => ({ id: p.id, startMs: Math.round(p.start + d) })))
        return
      }
      // A click on one of a made group: the group stays picked. Of a group picked only for now:
      // just that one, picked the usual way
      if (madeGroupOf(id)?.length) return
      onGroupSel?.([])
      pickOne(id)
    }
  }
  /**
   * Right-click on something that can be grouped: picked first if it wasn't (with its made group),
   * then a menu — Group what's picked, Ungroup it
   */
  function openGroupMenu(e: React.MouseEvent, id: string) {
    e.preventDefault(); e.stopPropagation()
    let ids = groupSel
    if (!groupSet.has(id)) {
      ids = madeGroupOf(id) ?? [id]
      onPickSegment?.(null)
      if (ids.length > 1) onGroupSel?.(ids); else { onGroupSel?.([]); pickOne(id) }
    }
    const inMade = ids.some(x => madeGroupOf(x)?.length)
    const oneMade = inMade && ids.every(x => madeGroupOf(ids[0])?.includes(x)) && madeGroupOf(ids[0])!.length === ids.length
    setGroupMenu({ x: e.clientX, y: e.clientY, canGroup: ids.length > 1 && !oneMade, canUngroup: inMade, n: ids.length })
  }
  /** The box being dragged out (screen px), to draw it */
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  /**
   * A press on an empty spot of the rows: dragged, a box is drawn and everything it touches is picked
   * (Ctrl / Shift / ⌘: added to what's picked); not dragged, a click — the playhead goes there, as
   * before, and what was picked is let go
   */
  function beginBox(e: React.PointerEvent) {
    e.preventDefault()
    const add = e.shiftKey || e.ctrlKey || e.metaKey
    const base = add ? (groupSel.length ? groupSel : [pickedAlone()].filter((x): x is string => !!x)) : []
    const sx = e.clientX, sy = e.clientY
    let moved = false, last = ''
    if (!add) onPickSegment?.(null)
    track(ev => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
      moved = true
      const r = { x0: Math.min(sx, ev.clientX), y0: Math.min(sy, ev.clientY), x1: Math.max(sx, ev.clientX), y1: Math.max(sy, ev.clientY) }
      setBox(r)
      const hits = [...(viewRef.current?.querySelectorAll<HTMLElement>('.tl2-bar[data-pick][data-item-id], .tl2-block[data-pick][data-item-id]') ?? [])].filter(el => {
        const b = el.getBoundingClientRect()
        return b.right >= r.x0 && b.left <= r.x1 && b.bottom >= r.y0 && b.top <= r.y1
      }).map(el => el.getAttribute('data-item-id')!)
      const next = withMade([...new Set([...base, ...hits])])
      const key = next.join(',')
      if (key === last) return
      last = key
      if (next.length > 1) { onPickSegment?.(null); onGroupSel?.(next) }
      else { onGroupSel?.([]); if (next.length === 1) pickOne(next[0]) }
    }, () => {
      setBox(null)
      if (moved) return
      if (!add) onGroupSel?.([])
      onScrubStart?.()
      scrubTo(msFromClientX(sx), !e.altKey)
    })
  }

  function handleScrubDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    // The block under the finger (a very short part is drawn a little wider than its time: it is
    // still the one picked), else the part at that time on the main row
    const blockEl = (e.target as Element | null)?.closest?.('.tl2-block[data-part]')
    const hit = blockEl ? mains[Number(blockEl.getAttribute('data-part')) - 1] ?? null : partAt(e.clientX, e.clientY)
    // An empty spot of the rows (not the ruler, which always moves the playhead): a click there moves
    // the playhead, a drag draws a box that picks what it touches (beginBox)
    const onRuler = (e.currentTarget as Element).classList?.contains('tl2-ruler')
    if (onGroupSel && !onRuler && (!hit || isTailPart(hit) || isGapPart(hit, mainVideoId))) { beginBox(e); return }
    // A part of the main video picked with others (Ctrl / Shift + click, one of those picked, one of a group)
    if (hit && !onRuler && groupItem(hit.id) && groupPointer(e, hit.id, 'part')) return
    if (groupSel.length) onGroupSel?.([])
    // On the main row: that part is picked. Anywhere else (the ruler, an empty spot): nothing is —
    // a click outside the selected part lets go of it (the playhead still moves there)
    onPickSegment?.(hit && !isTailPart(hit) && !isGapPart(hit, mainVideoId) ? hit.id : null)
    // A block of the main row: dragged, it moves (a tap still moves the playhead). With only one
    // part there's nowhere to move it: dragging moves the playhead, as on the ruler
    if (hit && onMovePart && !hit.locked && (mains.filter(m => !isTailPart(m)).length > 1 || !!onPartToTrack) && !isTailPart(hit) && !isGapPart(hit, mainVideoId)) { handlePartDown(e, hit); return }
    const { setScrubbing } = usePlayerStore.getState()
    onScrubStart?.()
    setScrubbing(true)
    setDragging('scrub')
    scrubTo(msFromClientX(e.clientX), !e.altKey)
    const move = (ev: PointerEvent) => scrubTo(msFromClientX(ev.clientX), !ev.altKey)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setScrubbing(false); setDragging(null); snapAtRef.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  /**
   * A block of the main row (a part of the main video, or a video put in) dragged: it's carried with
   * the pointer, and a line shows where it will go in — between two parts (it clicks onto the
   * joins), or into a part, which it cuts in two. Let go: it moves there (onMovePart). Not moved:
   * a tap, the playhead goes there.
   */
  function handlePartDown(e: React.PointerEvent, seg: SegmentLocal) {
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY
    const grab = msFromClientX(sx) - seg.start_ms
    // (the joins of the main video's own row: never past its end, into the room after it)
    const own = mains.filter(m => !isTailPart(m))
    const joins = [0, ...own.flatMap(m => [m.start_ms, m.end_ms])]
    // (any block can leave the main row for a row above or below it, as in Resolve: a part of the
    // main video shows the same stretch of it there)
    const canLeave = !!onPartToTrack
    let moved = false, to = seg.start_ms, off = false, lastX = sx
    // Free placement (a part of the main video itself): over empty room — the space deleted parts
    // left, its own place, past the end of the row — it can go at any time, its edges clicking onto
    // the parts' edges nearby (Alt: no clicking)
    const len = seg.end_ms - seg.start_ms
    const canPlace = !!onPlacePart && !isInsertPart(seg)
    const solid = own.filter(m => m.id !== seg.id && !isGapPart(m, mainVideoId))
    const edges = [0, ...solid.flatMap(m => [m.start_ms, m.end_ms])]
    let place: number | null = null
    setDragging(`insert-${seg.id}`)
    track(ev => {
      if (!moved && Math.abs(ev.clientX - sx) < 4 && Math.abs(ev.clientY - sy) < 4) return
      moved = true
      lastX = ev.clientX
      const main = trackRef.current?.querySelector('[data-lane="main"]')?.getBoundingClientRect()
      off = canLeave && !!main && (ev.clientY < main.top - 8 || ev.clientY > main.bottom + 8)
      if (off) hoverTrack(ev, 'visual', -1)
      else if (trackHoverRef.current) { trackHoverRef.current = null; setTrackHover(null) }
      const raw = msFromClientX(ev.clientX)
      let best = raw, bestD = ev.altKey ? 0 : 14 * msPerPx()
      for (const j of joins) { const d = Math.abs(j - raw); if (d < bestD) { best = j; bestD = d } }
      to = Math.round(best)
      place = null
      if (canPlace && !off) {
        // Where its start would be, clicked onto a nearby edge with either of its ends
        let start = Math.max(0, raw - grab), snapD = ev.altKey ? 0 : 10 * msPerPx(), snapped = start
        for (const j of edges) {
          if (Math.abs(j - start) < snapD) { snapped = j; snapD = Math.abs(j - start) }
          if (Math.abs(j - (start + len)) < snapD && j - len >= 0) { snapped = j - len; snapD = Math.abs(j - (start + len)) }
        }
        start = Math.round(snapped)
        // Only empty room there (no other part of the main video in the way)
        if (!solid.some(m => m.start_ms < start + len - 1 && m.end_ms > start + 1)) place = start
      }
      setInsertDrag({ id: seg.id, to, dx: ev.clientX - sx, dy: ev.clientY - sy, off, ...(place != null ? { place } : {}) })
    }, () => {
      setInsertDrag(null)
      if (!moved) { scrubTo(msFromClientX(sx)); return }
      const h = trackHoverRef.current
      trackHoverRef.current = null
      setTrackHover(null)
      // Off the main row, over a row (or where a new one opens): onto it, from where it was let go
      if (off && h && h.target !== -1) {
        onPartToTrack?.(seg.id, h.target as number | 'new' | 'new-below', Math.max(0, Math.round(msFromClientX(lastX) - grab)))
        return
      }
      if (off) return
      // Over empty room: exactly there
      if (place != null) { if (Math.abs(place - seg.start_ms) >= 30) onPlacePart?.(seg.id, place); return }
      // (let go over itself: it stays)
      if (to > seg.start_ms && to < seg.end_ms) return
      onMovePart?.(seg.id, to)
    }, true)
  }
  /** A video put in the main row (not a part of the main video itself) */
  const isInsertPart = (s: SegmentLocal) => s.video_offset_ms != null && !!s.crop_boxes[0]?.source_video_id
  /** The empty stretch after the main video (what's on top runs on there): put in, hidden — the editor makes and sizes it */
  const isTailPart = (s: SegmentLocal) => isInsertPart(s) && !!s.hidden && !!s.crop_boxes[0]?.hidden
  /**
   * The parts of the main row with only empty room after them and a video on a row starting at (or
   * near) their end: a transition goes between the two there, the video staying on its row (the
   * export plays them one after the other: EditorShell transitionJoins). Part id → that video.
   */
  const rowJoins = new Map<string, SegmentLocal>()
  for (const left of mains) {
    if (isTailPart(left) || isGapPart(left, mainVideoId)) continue
    const next = mains.find(m => m.id !== left.id && Math.abs(m.start_ms - left.end_ms) <= 1)
    if (next && !isTailPart(next) && !isGapPart(next, mainVideoId)) continue
    const shot = brolls.find(b => !b.crop_boxes[0]?.hidden && Math.abs(b.start_ms - left.end_ms) <= JOIN_REACH_MS)
    if (shot) rowJoins.set(left.id, shot)
  }
  /** Whether the video on a row starts exactly at that part's end (else a click lines it up first) */
  const rowJoinExact = (leftId: string) => {
    const left = mains.find(m => m.id === leftId), shot = rowJoins.get(leftId)
    return !!left && !!shot && Math.abs(shot.start_ms - left.end_ms) <= 1
  }
  // Wheel / trackpad: Ctrl + wheel or a pinch zooms (the moment under the pointer stays put);
  // sideways (or Shift) scrolls the zoomed timeline; up and down goes through the rows
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const setZoomRef = useRef(setZoom)
  setZoomRef.current = setZoom
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const k = e.ctrlKey && Math.abs(e.deltaY) < 40 ? 0.012 : 0.0026
        const z0 = zoomRef.current
        const z = Math.round(Math.max(1, Math.min(MAX_ZOOM, z0 * Math.exp(-e.deltaY * k))) * 100) / 100
        if (z === z0) return
        const x = e.clientX - el.getBoundingClientRect().left - PAD
        zoomAnchor.current = { t: (scrollRef.current + x) / geoRef.current.pxPerMs, x }
        setZoomRef.current(z)
        return
      }
      const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY)
      if (!sideways && !e.shiftKey) return   // (up and down through the rows)
      // (taken even with nothing to scroll: a sideways swipe must never reach the browser, which
      // would take it as "go back" and leave the editor)
      e.preventDefault()
      if (maxScroll() <= 0) return
      scrollRef.current = clampScroll(scrollRef.current + (sideways ? e.deltaX : e.deltaY))
      handScrollAt.current = performance.now()
      place()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Grips: trim the selected part (live for an end; a start applies on release) ──
  function handleEdgeDown(e: React.PointerEvent, seg: SegmentLocal, edge: 'start' | 'end') {
    e.stopPropagation()
    e.preventDefault()
    if (e.button !== 0) return
    onSelectSegment(seg.id)
    if (seg.locked || !onEdgeTrim) return
    const sx = e.clientX
    const from = edge === 'start' ? seg.start_ms : seg.end_ms
    let to = from, moved = false, lastX = sx
    const k = msPerPx()
    // A start dragged out brings back the video before the part — as far back as the video goes
    // (its own start: 0 s of the video). Holding at the view's left edge keeps bringing more back:
    // the layer stays still meanwhile (the part's end and its grip stay where they are, in view), the
    // start stays at the view's edge, and how much is coming back counts up (`extra`, on the tip)
    let extra = 0
    const isMain = !(seg.video_offset_ms != null && seg.crop_boxes[0]?.source_video_id)
    const videoBefore = edge === 'start' && isMain ? Math.max(0, sourceAt ? sourceAt(seg.start_ms) : clipStartMs + seg.start_ms) : 0
    const minTo = edge === 'start' ? from - videoBefore : -Infinity
    // The clip's own end dragged out: as far as there is more video (clipEndRoomMs). The timeline opens
    // up past it as it goes, so there's room to drag straight out at any zoom (user, 2026-11-04:
    // extending "takes a bit harder… keep it simple")
    const atClipEnd = edge === 'end' && from >= duration - 1
    const maxTo = atClipEnd && clipEndRoomMs != null ? from + Math.max(0, clipEndRoomMs) : Infinity
    const opens = atClipEnd && maxTo > from
    const reachFor = (t: number) => Math.min(Math.max(from, t) + REACH_AHEAD_MS, maxTo + 400)
    // The layer keeps still meanwhile (the playhead line goes to the edge being cut, as in CapCut)
    const tx0 = currentTx()
    freezeRef.current = tx0
    setFrozenDur(duration)
    if (opens) setEdgeReach(reachFor(from))
    setDragging(`${edge}-${seg.id}`)
    const vr = viewRef.current?.getBoundingClientRect()
    let raf = 0, timer = 0, seekRaf = 0, auto = 0, lastApply = 0, held = 0
    // The preview shows the frame the edge is on: a start dragged in, its new first frame; an end, its
    // new last frame, in or out (out: the last of what comes back), once the clip is redrawn with it
    const follow = () => {
      if (seekRaf) return
      seekRaf = requestAnimationFrame(() => {
        seekRaf = requestAnimationFrame(() => {
          seekRaf = 0
          if (edge === 'start' && to > from) onSeek(Math.round(to))
          if (edge === 'end' && to !== from) onSeek(Math.max(seg.start_ms, Math.round(to) - 1))
        })
      })
    }
    // The clip itself is worked out again at most every LIVE_APPLY_MS (each time the whole editor
    // redraws); the grip, its outline and its time follow the pointer every frame meanwhile
    const apply = () => {
      raf = 0; timer = 0
      const wait = LIVE_APPLY_MS - (performance.now() - lastApply)
      if (wait > 0) { timer = window.setTimeout(apply, wait); return }
      lastApply = performance.now()
      onEdgeTrim(seg.id, edge, Math.round(from), Math.round(to), false)
      follow()
    }
    const update = () => {
      // (the layer may have been scrolled along by holding near the view's edge)
      const shift = (freezeRef.current ?? tx0) - tx0
      const t = from + (lastX - sx - shift) * k - extra
      to = edge === 'start' ? Math.max(minTo, Math.min(seg.end_ms - MIN_PART_MS, t)) : Math.min(maxTo, Math.max(seg.start_ms + MIN_PART_MS, t))
      setEdgeGhost({ id: seg.id, from, to, edge })
      if (opens) setEdgeReach(r => { const want = reachFor(to); return r != null && want <= r ? r : want })
      if (edge === 'end' && !raf && !timer) raf = requestAnimationFrame(apply)
      if (edge === 'start') follow()
    }
    // Holding near the view's edge scrolls the timeline along (more to cut, or to bring back): faster
    // the deeper into the edge and the longer it's held, so a long stretch is a short hold
    const autoScroll = () => {
      auto = 0
      if (!vr || freezeRef.current == null) return
      const edgeZone = 48
      // (only towards where the pointer went from where it pressed: a grip near the view's edge, grabbed
      // and dragged the other way, doesn't set the view scrolling)
      const v = lastX < vr.left + edgeZone && lastX < sx - 4 ? (vr.left + edgeZone - lastX)
        : lastX > vr.right - edgeZone && lastX > sx + 4 ? -(lastX - (vr.right - edgeZone)) : 0
      held = v !== 0 && moved ? held + 1 : 0
      // (in time, not pixels, so it feels the same at any zoom: a few seconds of video a second at first,
      // up to EDGE_SCROLL_MAX_MS a frame after a few seconds held; px a frame, at most EDGE_SCROLL_MAX)
      const speed = (depth: number) => Math.min(EDGE_SCROLL_MAX, Math.min(EDGE_SCROLL_MAX_MS, (20 + Math.min(depth, 80) * 1) * (1 + Math.min(held / 90, 3))) / k)
      // A start held at the left edge with the layer as far left as it goes (the clip's 0:00 in view):
      // more video comes back, faster the further into the edge, the layer still
      if (v > 0 && moved && edge === 'start' && freezeRef.current >= PAD - 0.5 && to > minTo + 1) {
        extra = Math.min(from - minTo, extra + speed(v) * k)
        update()
        auto = requestAnimationFrame(autoScroll)
        return
      }
      if (v !== 0 && moved) {
        // (only as far as there is more of the clip to show, or, the clip's end dragged out, the room opened past it)
        const next = Math.max(PAD - maxScroll(), Math.min(PAD, freezeRef.current + Math.sign(v) * speed(Math.abs(v))))
        if (next !== freezeRef.current) {
          freezeRef.current = next
          place()
          update()
        }
      }
      auto = requestAnimationFrame(autoScroll)
    }
    auto = requestAnimationFrame(autoScroll)
    const move = (ev: PointerEvent) => {
      lastX = ev.clientX
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      update()
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (raf) cancelAnimationFrame(raf)
      if (timer) clearTimeout(timer)
      if (seekRaf) cancelAnimationFrame(seekRaf)
      if (auto) cancelAnimationFrame(auto)
      setDragging(null)
      setEdgeGhost(null)
      setFrozenDur(null)
      setEdgeReach(null)
      if (moved) onEdgeTrim(seg.id, edge, Math.round(from), Math.round(to), true)
      // (dragged out: what it gained shows for a moment)
      if (moved && (edge === 'start' ? to < from : to > from)) setGrown({ id: seg.id, edge, before: seg.end_ms - seg.start_ms, key: performance.now() })
      unfreeze()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ── Bars on the rows (as before: the body moves them, the ends trim them, up / down: another
  //    track). A tap selects; it doesn't move the playhead ──
  function edgeSnap(t: number, ignoreId?: string): number | null {
    if (noSnapRef.current) return null
    const tol = 10 * msPerPx()
    let best: number | null = null, bestD = tol
    for (const x of [0, duration, nowRef.current, ...segments.filter(sg => sg.id !== ignoreId).flatMap(sg => [sg.start_ms, sg.end_ms])]) {
      const d = Math.abs(x - t)
      if (d < bestD) { best = x; bestD = d }
    }
    return best
  }
  function snapEdgeAt(t: number, ignoreId?: string): number {
    const sn = edgeSnap(t, ignoreId)
    setSnapLine(sn)
    return sn ?? t
  }
  function snapSpanAt(st: number, len: number, ignoreId?: string): number {
    const a = edgeSnap(st, ignoreId), b = edgeSnap(st + len, ignoreId)
    const da = a === null ? Infinity : Math.abs(a - st), db = b === null ? Infinity : Math.abs(b - (st + len))
    if (a !== null && da <= db) { setSnapLine(a); return a }
    if (b !== null) { setSnapLine(b); return Math.max(0, b - len) }
    setSnapLine(null)
    return st
  }
  /**
   * Something carried along the timeline (a bar, a part, a group): the timeline holds its scale and its
   * place meanwhile — the clip getting longer under it doesn't shrink everything away from the pointer —
   * and held near either edge it scrolls along, the carried thing following (`move` again with the last
   * pointer), as far as it goes: no letting go and picking up again. Settles once it's let go.
   */
  function carryAlong(move: (ev: PointerEvent) => void) {
    freezeRef.current = currentTx()
    carryScaleRef.current = geoRef.current.pxPerMs
    setFrozenDur(duration)
    const vr = viewRef.current?.getBoundingClientRect()
    let last: PointerEvent | null = null, raf = 0
    const tick = () => {
      raf = 0
      if (!last || !vr || freezeRef.current == null) return
      const zone = 56, x = last.clientX
      const v = x < vr.left + zone ? vr.left + zone - x : x > vr.right - zone ? -(x - (vr.right - zone)) : 0
      if (v !== 0) {
        // (faster the nearer the edge — and past it)
        const step = Math.max(-28, Math.min(28, v * 0.4))
        // (on past the clip's end, into the room after it — up to the longest a clip can be: what's
        // carried there makes the clip longer behind it)
        const { pxPerMs: kk, viewW: w, duration: len } = geoRef.current
        const far = Math.max(maxScroll(), Math.max(len, maxMs ?? 0) * kk - (w - PAD * 2))
        const next = Math.max(PAD - far, Math.min(PAD, freezeRef.current + step))
        if (next !== freezeRef.current) { freezeRef.current = next; place(); move(last) }
      }
      raf = requestAnimationFrame(tick)
    }
    return {
      /** The pointer moved: where it is now */
      at(ev: PointerEvent) { last = ev; if (!raf) raf = requestAnimationFrame(tick) },
      stop() {
        if (raf) cancelAnimationFrame(raf)
        raf = 0; last = null
        carryScaleRef.current = null
        setFrozenDur(null)
        unfreeze()
      },
    }
  }
  function track(move: (ev: PointerEvent) => void, done?: () => void, carry = false) {
    const along = carry ? carryAlong(move) : null
    const up = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      along?.stop()
      setDragging(null); setSnapLine(null); setLift(null); done?.()
    }
    const onMove = (ev: PointerEvent) => { noSnapRef.current = ev.altKey; move(ev); along?.at(ev) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  function hoverTrack(ev: PointerEvent, family: 'visual' | 'audio', current: number) {
    const rows = [...(viewRef.current?.querySelectorAll<HTMLElement>(`[data-track-row="${family}"]`) ?? [])]
    const y = ev.clientY
    if (!rows.length) {
      const main = family === 'visual' ? trackRef.current?.querySelector('[data-lane="main"]')?.getBoundingClientRect() : null
      if (!main) return
      const t: 'new' | 'new-below' | null = y < main.top ? 'new' : y > main.bottom ? 'new-below' : null
      const next = t ? { family, target: t } : null
      trackHoverRef.current = next
      setTrackHover(prev => (prev?.family === next?.family && prev?.target === next?.target ? prev : next))
      return
    }
    const first = rows[0].getBoundingClientRect(), last = rows[rows.length - 1].getBoundingClientRect()
    let target: number | 'new' | 'new-below'
    // The row nearest the pointer of these (null: none)
    const nearest = (list: HTMLElement[]) => {
      let best: HTMLElement | null = null, bestD = Infinity
      for (const r of list) {
        const b = r.getBoundingClientRect()
        const d = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0
        if (d < bestD) { best = r; bestD = d }
      }
      return best
    }
    if (family === 'visual') {
      // Measured against the main video: above it the rows above (past the highest, a new one on
      // top); under it the rows under (past the lowest, a new one at the bottom); on it, it stays
      const main = trackRef.current?.querySelector('[data-lane="main"]')?.getBoundingClientRect()
      const above = rows.filter(r => Number(r.dataset.track) >= belowRows)
      const under = rows.filter(r => Number(r.dataset.track) < belowRows)
      if (main && y >= main.top && y <= main.bottom) target = current
      else if (!main || y < main.top) {
        const top = above[0]?.getBoundingClientRect()
        target = !top || y < top.top - ROW_GAP ? 'new' : Number(nearest(above)!.dataset.track)
      } else {
        const low = under[under.length - 1]?.getBoundingClientRect()
        target = !low || y > low.bottom + ROW_GAP ? 'new-below' : Number(nearest(under)!.dataset.track)
      }
    } else if (y > last.bottom + ROW_GAP) target = 'new'
    else target = Number((rows.find(r => y < r.getBoundingClientRect().bottom + ROW_GAP / 2) ?? rows[rows.length - 1]).dataset.track)
    const next = target === current ? null : { family, target }
    trackHoverRef.current = next
    setTrackHover(prev => (prev?.family === next?.family && prev?.target === next?.target ? prev : next))
  }
  function endTrackDrag(ref: TrackRef, current: number) {
    const h = trackHoverRef.current
    trackHoverRef.current = null
    setTrackHover(null)
    onTrackDrop?.(ref, h?.target ?? current)
  }
  function handleBrollDown(e: React.PointerEvent, seg: SegmentLocal, part: 'body' | 'start' | 'end') {
    e.stopPropagation(); e.preventDefault()
    onPickSegment?.(seg.id)
    if (seg.locked) return
    if (part !== 'body') { handleShotTrim(e, seg, part); return }
    const sx = e.clientX, sy = e.clientY
    const grab = msFromClientX(e.clientX) - seg.start_ms
    const len = seg.end_ms - seg.start_ms
    const box0 = seg.crop_boxes[0]
    const anchor = seg.start_ms - (box0?.source_offset_ms ?? 0)
    const full = mediaLengths[box0?.source_video_id ?? '']
    const minStart = Math.max(0, anchor)
    // (past the timeline's end too: the editor makes room, up to `maxMs`)
    const room = Math.max(duration, maxMs ?? duration)
    const maxEnd = full ? Math.min(room, anchor + full) : room
    let moved = false, overMain: number | null = null
    let next = { start: seg.start_ms, end: seg.end_ms }
    setDragging(`broll-${part}-${seg.id}`)
    // (carried: the timeline holds its scale and scrolls along at its edges — carryAlong)
    // eslint-disable-next-line prefer-const
    let along: ReturnType<typeof carryAlong> | null = null
    const move = (ev: PointerEvent) => {
      along?.at(ev)
      if (!moved && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return
      moved = true
      noSnapRef.current = ev.altKey
      const t = rawMsFromClientX(ev.clientX)
      if (part === 'body') {
        // Where it starts, as carried: it goes exactly there (wherever it's let go)
        const st = snapSpanAt(Math.max(0, Math.min(room - len, t - grab)), len, seg.id)
        // Over the main row: it would go in there, where its start is (a line there); else onto the row under the pointer
        const main = onShotToMain ? trackRef.current?.querySelector('[data-lane="main"]')?.getBoundingClientRect() : null
        overMain = main && ev.clientY >= main.top && ev.clientY <= main.bottom ? Math.round(st) : null
        setMainDropAt(overMain)
        if (overMain != null) { if (trackHoverRef.current) { trackHoverRef.current = null; setTrackHover(null) } }
        else hoverTrack(ev, 'visual', seg.track ?? 0)
        next = { start: st, end: Math.min(room, st + len) }
        setBrollGhost({ id: seg.id, ...next })
        // (carried past the end: the timeline grows now, so it can be seen where it goes)
        if (next.end > duration + 1) onBrollChange?.(seg.id, Math.round(next.start), Math.round(next.end), false)
        setLift({ id: seg.id, dy: ev.clientY - sy, ...next })
        return
      }
      if (part === 'start') next = { start: Math.max(minStart, Math.min(seg.end_ms - 500, snapEdgeAt(t, seg.id))), end: seg.end_ms }
      else next = { start: seg.start_ms, end: Math.min(maxEnd, Math.max(seg.start_ms + 500, snapEdgeAt(t, seg.id))) }
      onBrollChange?.(seg.id, Math.round(next.start), Math.round(next.end), false)
    }
    if (part === 'body') along = carryAlong(ev => { const a = along; along = null; move(ev); along = a })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      along?.stop()
      setDragging(null); setBrollGhost(null); setSnapLine(null); setLift(null); setMainDropAt(null)
      if (!moved) return
      if (overMain != null) { trackHoverRef.current = null; setTrackHover(null); onShotToMain?.(seg.id, overMain, Math.round(next.start)); return }
      onBrollChange?.(seg.id, Math.round(next.start), Math.round(next.end), true)
      endTrackDrag({ kind: 'shot', id: seg.id }, seg.track ?? 0)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  /**
   * A video on top trimmed by a grip, as a part of the main video is: the timeline holds still (and
   * scrolls along while the grip is held at the view's edge), a bubble over the edge shows its new
   * length, the preview shows the frame the cut lands on, and pulled outward it brings its video back
   * (to its first / last frame; past the main video's end too). Live; once more on release.
   */
  function handleShotTrim(e: React.PointerEvent, seg: SegmentLocal, edge: 'start' | 'end') {
    if (e.button !== 0) return
    const box0 = seg.crop_boxes[0]
    const anchor = seg.start_ms - (box0?.source_offset_ms ?? 0)
    const full = mediaLengths[box0?.source_video_id ?? '']
    const room = Math.max(duration, maxMs ?? duration)
    const minStart = Math.max(0, anchor)
    const maxEnd = full ? Math.min(room, anchor + full) : room
    const sx = e.clientX
    let next = { start: seg.start_ms, end: seg.end_ms }, moved = false, lastX = sx
    onScrubStart?.()
    // The layer keeps still meanwhile, at this scale (it grows to the right if the video goes past the end)
    freezeRef.current = currentTx()
    setFrozenDur(duration)
    setDragging(`broll-${edge}-${seg.id}`)
    const vr = viewRef.current?.getBoundingClientRect()
    let seekRaf = 0, auto = 0
    const update = () => {
      const t = rawMsFromClientX(lastX)
      next = edge === 'start'
        ? { start: Math.round(Math.max(minStart, Math.min(seg.end_ms - 500, snapEdgeAt(t, seg.id)))), end: seg.end_ms }
        : { start: seg.start_ms, end: Math.round(Math.min(maxEnd, Math.max(seg.start_ms + 500, snapEdgeAt(t, seg.id)))) }
      onBrollChange?.(seg.id, next.start, next.end, false)
      setBarTip({ id: seg.id, at: edge === 'start' ? next.start : next.end, text: lenLabel(next.end - next.start) })
      // (the preview shows the frame the cut lands on: its new first frame, or its new last)
      if (!seekRaf) seekRaf = requestAnimationFrame(() => { seekRaf = 0; onSeek(edge === 'start' ? next.start : Math.max(next.start, next.end - 1)) })
    }
    // Held near the view's edge, the timeline scrolls along (more to cut, or to bring back)
    const autoScroll = () => {
      auto = 0
      if (!vr || freezeRef.current == null) return
      const zone = 40
      const v = lastX < vr.left + zone ? vr.left + zone - lastX : lastX > vr.right - zone ? -(lastX - (vr.right - zone)) : 0
      if (v !== 0 && moved) {
        const nextTx = Math.max(PAD - maxScroll(), Math.min(PAD, freezeRef.current + Math.max(-18, Math.min(18, v * 0.35))))
        if (nextTx !== freezeRef.current) { freezeRef.current = nextTx; place(); update() }
      }
      auto = requestAnimationFrame(autoScroll)
    }
    auto = requestAnimationFrame(autoScroll)
    const move = (ev: PointerEvent) => {
      lastX = ev.clientX
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      noSnapRef.current = ev.altKey
      update()
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (seekRaf) cancelAnimationFrame(seekRaf)
      if (auto) cancelAnimationFrame(auto)
      setDragging(null); setSnapLine(null); setBarTip(null); setFrozenDur(null)
      if (moved) onBrollChange?.(seg.id, next.start, next.end, true)
      unfreeze()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  /** A video on top trimmed from the keyboard (a grip focused): ← → move that end 0.1 s (Shift: 1 s) */
  function keyTrimShot(seg: SegmentLocal, edge: 'start' | 'end', delta: number) {
    if (seg.locked) return
    const box0 = seg.crop_boxes[0]
    const anchor = seg.start_ms - (box0?.source_offset_ms ?? 0)
    const full = mediaLengths[box0?.source_video_id ?? '']
    const room = Math.max(duration, maxMs ?? duration)
    if (edge === 'start') onBrollChange?.(seg.id, Math.round(Math.max(Math.max(0, anchor), Math.min(seg.end_ms - 500, seg.start_ms + delta))), seg.end_ms, true)
    else onBrollChange?.(seg.id, seg.start_ms, Math.round(Math.min(full ? Math.min(room, anchor + full) : room, Math.max(seg.start_ms + 500, seg.end_ms + delta))), true)
  }
  function handleMusicDrag(e: React.PointerEvent, m: (typeof musicTracks)[number]) {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectMusic?.(m.id)
    if (m.locked) return
    const sx = e.clientX, sy = e.clientY, len = musicEnd(m) - m.start_ms, t0 = rawMsFromClientX(sx)
    setDragging(`music-${m.id}`)
    let dragged = false
    track(ev => {
      if (!dragged && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return
      dragged = true
      const st = Math.round(snapSpanAt(Math.max(0, Math.min(duration - 200, m.start_ms + rawMsFromClientX(ev.clientX) - t0)), len))
      onMusicMove?.(m.id, st)
      // (the clip's own sound stays on its row: only along)
      setLift({ id: m.id, dy: m.original ? 0 : ev.clientY - sy, start: st, end: Math.min(duration, st + len) })
      if (!m.original) hoverTrack(ev, 'audio', m.track ?? 0)
    }, () => { if (dragged && !m.original) endTrackDrag({ kind: 'music', id: m.id }, m.track ?? 0) }, true)
  }
  function handleMusicTrim(e: React.PointerEvent, m: (typeof musicTracks)[number], edge: 'start' | 'end') {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectMusic?.(m.id)
    if (m.locked) return
    const k = msPerPx(), sx = e.clientX
    const orig = edge === 'start' ? m.start_ms : musicEnd(m)
    setDragging(`music-${m.id}`)
    track(ev => onMusicTrim?.(m.id, edge, Math.round(snapEdgeAt(orig + (ev.clientX - sx) * k))),
      () => { if (!m.original) endTrackDrag({ kind: 'music', id: m.id }, m.track ?? 0) })
  }
  function handlePhotoDrag(e: React.PointerEvent, ph: (typeof photos)[number], part: 'body' | 'start' | 'end') {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectPhoto?.(ph.id)
    if (ph.locked) return
    const sx = e.clientX, sy = e.clientY, len = ph.end_ms - ph.start_ms, t0 = rawMsFromClientX(sx)
    // (past the clip's end too, as a video on top: the editor makes room after it, up to `maxMs`)
    const room = Math.max(duration, maxMs ?? duration)
    setDragging(`photo-${ph.id}`)
    let dragged = false
    track(ev => {
      if (!dragged && Math.abs(ev.clientX - sx) < 3 && (part !== 'body' || Math.abs(ev.clientY - sy) < 3)) return
      dragged = true
      const d = rawMsFromClientX(ev.clientX) - t0
      if (part === 'body') {
        const st = Math.round(snapSpanAt(Math.max(0, Math.min(room - len, ph.start_ms + d)), len))
        onPhotoTimeChange?.(ph.id, { start_ms: st, end_ms: st + len })
        setLift({ id: ph.id, dy: ev.clientY - sy, start: st, end: st + len })
        hoverTrack(ev, 'visual', ph.track ?? 0)
      } else if (part === 'start') {
        onPhotoTimeChange?.(ph.id, { start_ms: Math.round(Math.max(0, Math.min(ph.end_ms - 200, snapEdgeAt(ph.start_ms + d)))), end_ms: ph.end_ms })
      } else {
        onPhotoTimeChange?.(ph.id, { start_ms: ph.start_ms, end_ms: Math.round(Math.min(room, Math.max(ph.start_ms + 200, snapEdgeAt(ph.end_ms + d)))) })
      }
    }, () => { if (dragged) endTrackDrag({ kind: 'photo', id: ph.id }, ph.track ?? 0) }, true)
  }
  function handleTextDrag(e: React.PointerEvent, o: TextOverlay, part: 'body' | 'start' | 'end') {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectTextOverlay?.(o.id)
    if (o.locked) return
    const sx = e.clientX, sy = e.clientY, len = o.end_ms - o.start_ms, trackNo = o.track ?? 0, t0 = rawMsFromClientX(sx)
    // (past the clip's end too, as a video on top: the editor makes room after it, up to `maxMs`)
    const room = Math.max(duration, maxMs ?? duration)
    setDragging(`text-${o.id}`)
    let dragged = false
    track(ev => {
      if (!dragged && Math.abs(ev.clientX - sx) < 3 && (part !== 'body' || Math.abs(ev.clientY - sy) < 3)) return
      dragged = true
      const d = rawMsFromClientX(ev.clientX) - t0
      if (part === 'body') {
        const st = Math.round(snapSpanAt(Math.max(0, Math.min(room - len, o.start_ms + d)), len))
        onTextOverlayUpdate?.(o.id, { start_ms: st, end_ms: st + len })
        setLift({ id: o.id, dy: ev.clientY - sy, start: st, end: st + len })
        hoverTrack(ev, 'visual', trackNo)
      } else if (part === 'start') {
        onTextOverlayUpdate?.(o.id, { start_ms: Math.round(Math.max(0, Math.min(o.end_ms - 200, snapEdgeAt(o.start_ms + d)))) })
      } else {
        onTextOverlayUpdate?.(o.id, { end_ms: Math.round(Math.min(room, Math.max(o.start_ms + 200, snapEdgeAt(o.end_ms + d)))) })
      }
    }, () => { if (dragged) endTrackDrag({ kind: 'text', id: o.id }, trackNo) }, true)
  }
  function handleFrameItemDown(e: React.PointerEvent, item: FrameItem, mode: 'move' | 'start' | 'end') {
    if (e.button !== 0 || !frameSeg) return
    e.stopPropagation(); e.preventDefault()
    onSelectFrameItem?.(item.id)
    if (frameSeg.locked || item.locked) return
    const frame = frameOf(frameSeg)
    const { min, max } = itemBounds(frame, item, frameSeg)
    const s0 = Math.max(item.start_ms, frameSeg.start_ms), e0 = Math.min(item.end_ms, frameSeg.end_ms)
    const len = Math.min(e0 - s0, max - min)
    const tol = SNAP_PX * msPerPx()
    const targets = [nowRef.current, frameSeg.start_ms, frameSeg.end_ms]
    for (const it of frame.items ?? []) if (it.id !== item.id) targets.push(it.start_ms, it.end_ms)
    const snapT = (t: number) => { let best = t, bestD = tol; for (const x of targets) { const d = Math.abs(x - t); if (d < bestD) { best = x; bestD = d } } return best }
    const sx = e.clientX, k = msPerPx()
    let moved = false
    setDragging(`item-${item.id}`)
    track(ev => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      const d = (ev.clientX - sx) * k
      if (mode === 'move') {
        const a = snapT(s0 + d), b = snapT(s0 + d + len) - len
        const ns = Math.round(Math.max(min, Math.min(max - len, a !== s0 + d ? a : b)))
        onUpdateFrameItem?.(item.id, { start_ms: ns, end_ms: ns + len })
      } else if (mode === 'start') {
        const ns = Math.round(Math.max(min, Math.min(e0 - MIN_ITEM_MS, snapT(s0 + d))))
        const off = item.kind === 'video' ? { source_offset_ms: Math.max(0, (item.source_offset_ms ?? 0) + (ns - item.start_ms)) } : {}
        onUpdateFrameItem?.(item.id, { start_ms: ns, ...off })
        setSnapLine(ns)
      } else {
        const ne = Math.round(Math.min(max, Math.max(s0 + MIN_ITEM_MS, snapT(e0 + d))))
        onUpdateFrameItem?.(item.id, { end_ms: ne })
        setSnapLine(ne)
      }
    })
  }
  /** A freeze range pressed: its middle moves it, its ends resize it (never over the next one, or off the bar) */
  function handleFreezeDown(e: React.PointerEvent, bar: FreezeBar, i: number, mode: 'move' | 'start' | 'end') {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    if (bar.locked) return
    const h0 = bar.holds[i]
    const lo = i ? bar.holds[i - 1].at_ms + bar.holds[i - 1].len_ms : bar.from - bar.origin
    const hi = bar.grows && mode === 'end' ? Infinity : i < bar.holds.length - 1 ? bar.holds[i + 1].at_ms : bar.to - bar.origin
    const sx = e.clientX, k = msPerPx()
    let moved = false
    setDragging(`freeze-${i}`)
    track(ev => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      bar.set(i, movedHold(h0, mode, (ev.clientX - sx) * k, lo, hi))
    })
  }
  /** The blue ranges on a bar; picked, each has its handles and an ✕ */
  function freezeRanges(bar: FreezeBar) {
    return bar.holds.map((h, i) => {
      const a = Math.max(bar.from, bar.origin + h.at_ms), b = Math.min(bar.to, bar.origin + h.at_ms + h.len_ms)
      if (b <= a) return null
      const handle = (mode: 'start' | 'end') => (
        <div className="absolute inset-y-0 flex items-center justify-center cursor-col-resize" aria-hidden="true"
          style={{ [mode === 'start' ? 'left' : 'right']: 0, width: 12, background: 'rgba(59,130,246,0.6)' }}
          onPointerDown={e => handleFreezeDown(e, bar, i, mode)}>
          <svg width="8" height="10" viewBox="0 0 8 10" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={mode === 'start' ? 'M5.5 1.5L2.5 5l3 3.5' : 'M2.5 1.5l3 3.5-3 3.5'} /></svg>
        </div>
      )
      return (
        <div key={i} className="absolute inset-y-0 overflow-hidden" title={`Frozen ${msToLabel(a)}–${msToLabel(b)}${bar.on ? ' · drag to move, drag its ends to change it' : ''}`}
          onPointerDown={bar.on ? e => handleFreezeDown(e, bar, i, 'move') : undefined}
          style={{
            left: `${((a - bar.from) / (bar.to - bar.from)) * 100}%`, width: `${((b - a) / (bar.to - bar.from)) * 100}%`, background: FROZEN_BLUE, zIndex: 11,
            boxShadow: 'inset 0 0 0 1.5px rgba(96,165,250,0.85)', borderRadius: 4, pointerEvents: bar.on ? 'auto' : 'none', cursor: 'grab', touchAction: 'none',
          }}>
          {bar.on && !bar.locked && (<>
            {handle('start')}
            {handle('end')}
            <button type="button" aria-label={`Remove the freeze ${msToLabel(a)}–${msToLabel(b)}`} title="Let it play here again"
              className="absolute top-1/2 left-1/2 flex items-center justify-center rounded-full"
              style={{ transform: 'translate(-50%, -50%)', width: 14, height: 14, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 9, lineHeight: 1 }}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); bar.set(i, null) }}>✕</button>
          </>)}
        </div>
      )
    })
  }
  function handleViewDown(e: React.PointerEvent, t: number, first: boolean) {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectView?.(t)
    if (first || !onMoveView) return
    const sx = e.clientX
    let cur = t, moved = false
    setDragging(`view-${t}`)
    track(ev => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      const landed = onMoveView(cur, Math.round(msFromClientX(ev.clientX)))
      if (typeof landed === 'number') { cur = landed; setSnapLine(landed); setViewDragT(landed) }
    }, () => setViewDragT(null))
  }

  // ── Drops from outside (files, stock footage, the Media library) ──
  const laneAt = (el: Element) => el.closest?.('[data-lane]')?.getAttribute('data-lane') ?? null
  const dropKind = (e: React.DragEvent) => e.dataTransfer.types.includes(STOCK_DRAG_TYPE) ? 'stock' : e.dataTransfer.types.includes(MEDIA_DRAG_TYPE) ? 'media' : e.dataTransfer.types.includes('Files') ? 'files' : null
  /** The cut a transition dropped at this x lands on: the nearest one, if within reach (24 px) */
  const cutNear = (clientX: number) => {
    const ms = msFromClientX(clientX)
    let best: { id: string; d: number } | null = null
    for (const left of [...junctions.map(j => j.left), ...mains.filter(m => rowJoinExact(m.id))]) {
      const d = Math.abs(left.end_ms - ms) * pxPerMs
      if (d <= 24 && (!best || d < best.d)) best = { id: left.id, d }
    }
    return best?.id ?? null
  }
  function onDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes(TRANSITION_DRAG_TYPE)) {
      // A transition tile: only over a cut can it be dropped (elsewhere: not allowed)
      const id = onDropTransition ? cutNear(e.clientX) : null
      setDropCut(prev => (prev === id ? prev : id))
      if (id) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
      return
    }
    const kind = dropKind(e)
    if (!kind || (kind === 'files' && !onDropFiles) || (kind === 'stock' && !onDropStock) || (kind === 'media' && !onDropMedia)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const lane = laneAt(e.target as Element)
    const ms = Math.round(msFromClientX(e.clientX))
    // (a video at the main video's end or past it goes on after its last part)
    const mainEnd = Math.max(0, ...mains.filter(m => !isTailPart(m)).map(m => m.end_ms))
    const end = (kind === 'stock' || draggedIn.current?.kind === 'video') && goesAfterMain(ms, lane, mainEnd) ? mainEnd : undefined
    // (on the main row a video goes into the clip; anywhere else it goes on top)
    const what = end != null ? 'After the main video' : lane === 'main' ? 'Insert into the main video' : lane?.startsWith('audio-') ? 'Music'
      : lane === 'track-below' || (/^track-(\d+)$/.test(lane ?? '') && Number(lane!.slice(6)) < belowRows) ? 'Below the main video' : 'Above the main video'
    const y = Math.round(e.clientY)
    setDropAt(prev => (prev && prev.ms === ms && prev.lane === lane && prev.y === y && prev.end === end ? prev : { ms, lane, what, y, end }))
    const reach = Math.min(maxMs ?? Infinity, ms + Math.max(500, draggedIn.current?.ms ?? 0))
    if (reach > Math.max(duration, dropReach ?? 0) + 200) setDropReach(reach)
  }
  function onDrop(e: React.DragEvent) {
    if (e.dataTransfer.types.includes(TRANSITION_DRAG_TYPE)) {
      const id = cutNear(e.clientX), type = e.dataTransfer.getData(TRANSITION_DRAG_TYPE)
      setDropCut(null)
      if (id && type && onDropTransition) { e.preventDefault(); onDropTransition(id, type) }
      return
    }
    const kind = dropKind(e)
    setDropAt(null); setDropReach(null)
    if (!kind) return
    e.preventDefault()
    const lane = laneAt(e.target as Element)
    const ms = Math.round(msFromClientX(e.clientX))
    if (kind === 'stock') onDropStock?.(e.dataTransfer.getData(STOCK_DRAG_TYPE), ms, lane)
    else if (kind === 'media') onDropMedia?.(e.dataTransfer.getData(MEDIA_DRAG_TYPE), ms, lane)
    else if (e.dataTransfer.files.length) onDropFiles?.([...e.dataTransfer.files], ms, lane)
  }

  // ── The left column: what each row is (lined up with the rows) ──
  const [laneSpans, setLaneSpans] = useState<{ kind: string; top: number; h: number }[]>([])
  /** A stretch being dragged across on the Captions row (clip ms) */
  const [capDrag, setCapDrag] = useState<[number, number] | null>(null)
  const measureLanes = () => {
    const box = viewRef.current
    if (!box) return
    const base0 = box.getBoundingClientRect().top
    const by = new Map<string, { top: number; bottom: number }>()
    box.querySelectorAll<HTMLElement>('[data-lane]').forEach(el => {
      const r = el.getBoundingClientRect(), k = el.dataset.lane!
      const cur = by.get(k)
      by.set(k, { top: Math.min(cur?.top ?? Infinity, r.top - base0), bottom: Math.max(cur?.bottom ?? -Infinity, r.bottom - base0) })
    })
    // (every row scrolls, the main one too: a row scrolled up past the top — under the + button — has no icon)
    const next = [...by].map(([kind, v]) => ({ kind, top: Math.round(v.top), h: Math.round(v.bottom - v.top) }))
      .filter(sp => sp.top + sp.h / 2 > RULER_H)
    setLaneSpans(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }
  useLayoutEffect(measureLanes)
  /** Where the main row is in the view now (it scrolls; absent: scrolled up under the ruler) */
  const mainSpan = laneSpans.find(sp => sp.kind === 'main')
  const metaOf = (kind: string): LaneMeta | undefined => {
    if (kind === 'main' || kind === 'views' || kind === 'frame') return undefined
    if (kind === 'captions') return CAPTIONS_META
    if (LANE_META[kind]) return LANE_META[kind]
    const vt = /^track-(\d+)$/.exec(kind)
    if (vt) {
      // The row's icon only says what's on it when it's all one kind — videos, photos or text; a row
      // with a photo among its videos has none (user, 2026-10-30)
      const kinds = new Set(visual.filter(v => v.track === Number(vt[1]))
        .map(v => (v.kind === 'shot' || (v.kind === 'photo' && v.ph.video) ? 'video' : v.kind)))
      if (kinds.size !== 1) return undefined
      const like = LANE_META[[...kinds][0] as 'video' | 'photo' | 'text']
      return { label: like.label, color: like.color, icon: like.icon }
    }
    if (/^audio-\d+$/.test(kind)) return { ...LANE_META.music, label: 'Music' }
    if (kind.startsWith('frame:')) return LANE_META.frame
    return undefined
  }

  // ── Ruler ticks ──
  const TICKS: [number, number][] = [[100, 2], [200, 2], [500, 5], [1000, 5], [2000, 4], [5000, 5], [10000, 5], [15000, 3], [30000, 6], [60000, 6], [120000, 4], [300000, 5]]
  const [majorMs, minorPer] = TICKS.find(([ms]) => ms * pxPerMs >= 64) ?? TICKS[TICKS.length - 1]
  const minorMs = majorMs / minorPer
  const ticks: { t: number; major: boolean }[] = []
  for (let i = 0; i * minorMs <= viewDur + 1; i++) ticks.push({ t: i * minorMs, major: i % minorPer === 0 })
  const tickLabel = (t: number) => (majorMs < 1000 ? clockLabel(t) : msToLabel(t))

  // ── Pieces of the main row ──
  const trimming = edgeGhost
  const blockBox = (start: number, end: number): React.CSSProperties => ({
    left: `calc(${at(start)}% + 1.5px)`, width: `max(6px, calc(${pct(end - start)}% - 3px))`, top: MAIN_PAD, height: BLOCK_H,
  })
  const mainBlock = (seg: SegmentLocal, i: number) => {
    // (the room after the main video, for what's on top to run on: nothing in the main row there)
    if (isTailPart(seg)) return null
    const isInsert = seg.video_offset_ms != null && !!seg.crop_boxes[0]?.source_video_id
    const sel = isSel(seg.id, seg.id === (pickedSegmentId ?? activeSegmentId))
    const g = trimming && trimming.id === seg.id ? trimming : null
    // A start being dragged: the block shows where it will start (applied on release) — from no
    // further left than the view's edge, so its grip stays in sight (dragged out before the clip's 0:00)
    const viewLeftMs = freezeRef.current != null ? (2 - freezeRef.current) / pxPerMs : -Infinity
    const start = g && g.edge === 'start' ? Math.max(g.to, viewLeftMs) : seg.start_ms
    const end = seg.end_ms
    const box = seg.crop_boxes[0]
    const name = isInsert ? (videoTitles[box?.source_video_id ?? ''] ?? 'Video').replace(/^(Pixabay|Pexels): /, '').split(',')[0] : formatTag(seg)
    const color = isInsert ? MEDIA_COLORS.video : LAYOUT_COLORS[seg.layout]
    const url = isInsert ? videoUrls[box?.source_video_id ?? ''] : videoUrl
    const st = mainMuted && !isInsert ? { ...seg, muted: true } : seg
    const comingBack = g && g.edge === 'start' && g.to < g.from
    // A deleted part: nothing at all in the row there (what's under the main video plays there).
    // It isn't a part — it can't be picked; dragging the part after it in closes it
    if (isGapPart(seg, mainVideoId)) return null
    return (
      <div key={seg.id} className="tl2-block absolute" data-part={i + 1} data-seg-id={seg.id} data-selected={sel || undefined}
        data-item-id={seg.id} data-pick={(onGroupSel && groupItem(seg.id)) ? '' : undefined} data-group={groupSet.has(seg.id) || undefined}
        data-shifted={groupSet.has(seg.id) && groupShift?.dx ? '' : undefined}
        title={`${isInsert ? 'Inserted video' : 'Part'} ${i + 1} · ${name} · ${msToLabel(seg.start_ms)}–${msToLabel(seg.end_ms)} · tap to select it${onMovePart && mains.filter(m => !isTailPart(m)).length > 1 ? ', drag to move it' : ''}`}
        // (a part narrower than it is drawn lies over its neighbours: it can still be tapped)
        style={{
          ...blockBox(start, end), zIndex: sel ? 3 : (end - start) * pxPerMs < 12 ? 2 : 1,
          ...(onMovePart && mains.filter(m => !isTailPart(m)).length > 1 && !seg.locked ? { cursor: 'grab' } : {}),
          // (carried: it is drawn over everything instead, following the pointer — blockGhost)
          ...(insertDrag?.id === seg.id ? { opacity: 0, cursor: 'grabbing' } : {}),
          // (carried along with what's picked with it: drawn where it will go, placed on release)
          ...(groupSet.has(seg.id) && groupShift?.dx && !groupShift.pdy ? { transform: `translateX(${groupShift.dx}px)` } : {}),
          // (carried off the main row with what's picked: drawn over everything, following the pointer)
          ...(groupSet.has(seg.id) && groupShift?.pdy ? { opacity: 0 } : {}),
        }}>
        {insertDrag?.id === seg.id && blockGhost(seg, insertDrag, name, isInsert, url, box?.source_offset_ms ?? 0, end - start)}
        {groupSet.has(seg.id) && !!groupShift?.pdy && blockGhost(seg, { dx: groupShift.dx, dy: groupShift.pdy }, name, isInsert, url, box?.source_offset_ms ?? 0, end - start)}
        <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: 8 }}>
          {url && (
            <VideoThumbnails tile videoUrl={url} radius={0} dim={false}
              startMs={isInsert ? (box?.source_offset_ms ?? 0) : (sourceAt ? sourceAt(seg.start_ms) : clipStartMs + seg.start_ms)}
              durationMs={Math.max(1, seg.end_ms - seg.start_ms)}
              sourceAt={!isInsert && sourceAt ? (c => sourceAt(seg.start_ms + c)) : undefined}
              sourceKey={`${sourceKey ?? ''}|${seg.start_ms}`} />
          )}
          {/* what comes back over the part before it, while a start is dragged out */}
          {comingBack && <div className="tl2-grow absolute inset-y-0 left-0" data-edge="start" style={{ width: `${(Math.max(0, g!.from - start) / Math.max(1, end - start)) * 100}%` }} />}
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.45), transparent 38%, transparent 62%, rgba(0,0,0,0.55))' }} />
        </div>
        {/* its format (an inserted video: just "Video" — its name shows for 3 s after it goes in, in
            InsertTag, and stays in the tooltip), its length, its state */}
        <span className="tl2-tag absolute left-1.5 top-1">
          <i style={{ background: color }} />{isInsert ? 'Video' : name}
        </span>
        <span className="tl2-len absolute right-1.5 bottom-1">{lenLabel(end - start)}</span>
        <span className="absolute right-1 top-1"><StateBadges st={st} /></span>
        {isInsert && <InsertTag id={`${box?.source_video_id}@${seg.video_offset_ms}`} name={name} />}
        {/* cuts inside the part (where a removed piece closed up) */}
        {cutJoins.filter(t => t > seg.start_ms + 50 && t < seg.end_ms - 50).map(t => (
          <span key={t} className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${((t - start) / Math.max(1, end - start)) * 100}%`, width: 3, marginLeft: -1.5, background: 'var(--ed-track)' }} />
        ))}
        {/* just made longer: what it gained, for a moment (then fades) */}
        {grown && grown.id === seg.id && !g && (() => {
          const gain = (seg.end_ms - seg.start_ms) - grown.before
          if (gain < 50) return null
          const w = (gain / Math.max(1, seg.end_ms - seg.start_ms)) * 100
          return <div key={grown.key} className="tl2-grow tl2-grown absolute inset-y-0 pointer-events-none" data-edge={grown.edge}
            style={{ width: `${w}%`, [grown.edge === 'start' ? 'left' : 'right']: 0, borderRadius: grown.edge === 'start' ? '8px 0 0 8px' : '0 8px 8px 0' }} />
        })()}
        {/* its freezes (the time they add is in the part) */}
        {!isInsert && !g && freezeRanges({
          holds: (seg.frame?.freeze?.holds ?? []).filter(isMainHold), origin: seg.start_ms, from: seg.start_ms, to: seg.end_ms, on: sel, grows: true,
          locked: !!seg.locked, set: (n, h) => onPartFreeze?.(seg.id, n, h),
        })}
        {/* selected: a plain outline (the grips say it's selected) */}
        {sel && <div className="absolute inset-0 pointer-events-none" style={{ borderRadius: 8, boxShadow: `inset 0 0 0 2px ${ACCENT}` }} />}
        {sel && (['start', 'end'] as const).map(edge => grip(seg, i, edge))}
      </div>
    )
  }
  /**
   * A part of the main row being carried: drawn over the whole page at the pointer (as in Resolve /
   * CapCut) — never under the rows or cut off by them, wherever it goes, onto a row above or below
   * too. Its own place is left empty meanwhile.
   */
  function blockGhost(seg: SegmentLocal, d: { dx: number; dy: number }, name: string, isInsert: boolean, url: string | undefined, offsetMs: number, lenMs: number) {
    const home = document.querySelector<HTMLElement>(`.tl2-block[data-seg-id="${CSS.escape(seg.id)}"]`)
    if (!home || typeof document === 'undefined') return null
    const r = anchorOf(seg.id, home)
    return createPortal(
      <div className="tl2-block" aria-hidden="true"
        style={{
          position: 'fixed', left: r.left + d.dx, top: r.top + d.dy, width: r.width, height: r.height, zIndex: 1000, pointerEvents: 'none',
          opacity: 0.92, cursor: 'grabbing', borderRadius: 8, filter: 'drop-shadow(0 10px 18px rgba(0,0,0,0.65))', boxShadow: `inset 0 0 0 2px ${ACCENT}`,
        }}>
        <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: 8 }}>
          {url && (
            <VideoThumbnails tile videoUrl={url} radius={0} dim={false}
              startMs={isInsert ? offsetMs : (sourceAt ? sourceAt(seg.start_ms) : clipStartMs + seg.start_ms)}
              durationMs={Math.max(1, seg.end_ms - seg.start_ms)}
              sourceAt={!isInsert && sourceAt ? (c => sourceAt(seg.start_ms + c)) : undefined}
              sourceKey={`${sourceKey ?? ''}|${seg.start_ms}`} />
          )}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.45), transparent 38%, transparent 62%, rgba(0,0,0,0.55))' }} />
        </div>
        <span className="tl2-tag absolute left-1.5 top-1"><i style={{ background: isInsert ? MEDIA_COLORS.video : LAYOUT_COLORS[seg.layout] }} />{isInsert ? 'Video' : name}</span>
        <span className="tl2-len absolute right-1.5 bottom-1">{lenLabel(lenMs)}</span>
      </div>,
      document.body,
    )
  }
  const grip = (seg: SegmentLocal, i: number, edge: 'start' | 'end') => {
    const t = edge === 'start' ? seg.start_ms : seg.end_ms
    const label = `${edge === 'start' ? 'Start' : 'End'} of part ${i + 1} (`
    return (
      <button key={edge} type="button" className="tl2-grip absolute" data-edge={edge} data-on={dragging === `${edge}-${seg.id}` || undefined}
        onPointerDown={e => handleEdgeDown(e, seg, edge)}
        onKeyDown={e => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault(); e.stopPropagation()
          if (seg.locked || !onEdgeTrim) return
          const step = (e.shiftKey ? 1000 : 100) * (e.key === 'ArrowLeft' ? -1 : 1)
          const to = edge === 'start' ? Math.min(seg.end_ms - MIN_PART_MS, t + step) : Math.max(seg.start_ms + MIN_PART_MS, t + step)
          if (Math.abs(to - t) < 50) return
          onEdgeTrim(seg.id, edge, Math.round(t), Math.round(to), true)
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const again = [...document.querySelectorAll<HTMLElement>('button[aria-label]')].find(b => b.getAttribute('aria-label')!.startsWith(label))
            if (again && document.activeElement !== again) again.focus()
          }))
        }}
        aria-label={`${label}${formatTag(seg)}) at ${msToLabel(t)}. Drag or use arrow keys to trim`}
        title={`Drag to trim the ${edge === 'start' ? 'start' : 'end'} of this part (arrow keys: 0.1 s)`}
        style={{ [edge === 'start' ? 'left' : 'right']: 0, width: GRIP_W }}>
        <svg width="7" height="12" viewBox="0 0 8 12" aria-hidden="true" style={{ transform: edge === 'start' ? 'none' : 'scaleX(-1)' }}>
          <path d="M6 1.5L1.8 6 6 10.5" stroke="#0a0a0a" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    )
  }

  // ── Bars on the rows: slim, in their kind's colour; selected: taller, with grips ──
  const bar = (key: string, kind: 'video' | 'broll' | 'photo' | 'text' | 'music', start: number, end: number, sel: boolean, on: boolean,
    st: { hidden?: boolean; muted?: boolean; locked?: boolean; fixed?: boolean }, name: string, onBody: (e: React.PointerEvent) => void,
    onEdge: ((e: React.PointerEvent, edge: 'start' | 'end') => void) | null, title: string, inside?: React.ReactNode,
    keyTrim?: (edge: 'start' | 'end', deltaMs: number) => void) => {
    const color = MEDIA_COLORS[kind]
    const lifted = lift?.id === key ? lift : null
    const tip = barTip?.id === key ? barTip : null
    // (one of several picked: ringed as selected, without grips — the group moves as one)
    const grouped = groupSet.has(key)
    if (grouped) sel = true
    // (carried up or down with its group: drawn where it will land)
    const shifted = grouped && groupShift && groupShift.rows && groupShift.family === (kind === 'music' ? 'audio' : 'visual') ? (groupShift.dys?.[key] ?? groupShift.dy) : 0
    // (carried along: drawn moved, its times set on release)
    const slid = grouped && groupShift ? groupShift.dx : 0
    const pick = onGroupSel && !st.locked && !st.fixed
    // (in a made group: a link on it, as Resolve marks linked clips)
    const linked = pick && !!madeGroupOf(key)?.length
    return (
      <Fragment key={key}>
      <div className="tl2-bar absolute" data-sel={sel || undefined} data-group={grouped || undefined} data-shifted={shifted || slid ? '' : undefined} data-pick={pick || undefined} data-kind={kind} data-item-id={key}
        onPointerDown={e => { if (!groupPointer(e, key, kind)) onBody(e) }} title={linked ? `${title} · grouped (Alt + click: this one alone)` : title}
        onContextMenu={pick && (onGroup || onUngroup) ? e => openGroupMenu(e, key) : undefined}
        style={{
          left: `${at(start)}%`, width: `max(10px, ${pct(end - start)}%)`,
          '--bar-c': color, cursor: st.locked ? 'pointer' : on ? 'grabbing' : 'grab', zIndex: sel ? 3 : 1,
          ...(st.hidden ? { opacity: 0.45 } : {}),
          ...(shifted || slid ? { transform: `translate(${slid}px, ${shifted}px)`, zIndex: 4 } : {}),
          // (carried: it is drawn over everything instead, following the pointer — liftedGhost)
          ...(lifted ? { opacity: 0, cursor: 'grabbing' } : {}),
        } as React.CSSProperties}>
        {inside && (
          // (a video's own pictures, plain as the main video's; a light shade keeps its name readable)
          <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ borderRadius: 'inherit', opacity: kind === 'video' || kind === 'broll' ? 1 : sel ? 0.55 : 0.35 }}>
            {inside}
            {(kind === 'video' || kind === 'broll') && <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.55), rgba(0,0,0,0.1) 45%, transparent)' }} />}
          </div>
        )}
        <span className="relative flex items-center gap-1 min-w-0 pointer-events-none" style={{ paddingLeft: sel ? GRIP_W - 4 : 2, paddingRight: 6 }}>
          <MediaIcon kind={kind} />
          {linked && (
            <svg className="shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-label="Grouped">
              <path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7" />
            </svg>
          )}
          {kind === 'video' || kind === 'broll'
            ? <BarName id={key} name={name} short={`${kind === 'broll' ? 'B-roll' : 'Video'}${/ · (full screen|window)$/.exec(name)?.[0] ?? ''}`} />
            : <span className="truncate">{name}</span>}
          {sel && <span className="tl2-bar-len">{lenLabel(end - start)}</span>}
          <StateBadges st={st} />
        </span>
        {/* the main video's grips: drag, or ← → (Shift: 1 s) */}
        {sel && !grouped && onEdge && !st.locked && (['start', 'end'] as const).map(edge => (
          <button key={edge} type="button" className="tl2-grip absolute" data-edge={edge} data-on={dragging?.includes(`-${edge}-${key}`) || undefined}
            onPointerDown={e => { e.stopPropagation(); onEdge(e, edge) }}
            onKeyDown={e => {
              if (!keyTrim || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
              e.preventDefault(); e.stopPropagation()
              keyTrim(edge, (e.shiftKey ? 1000 : 100) * (e.key === 'ArrowLeft' ? -1 : 1))
            }}
            aria-label={`${edge === 'start' ? 'Start' : 'End'} of the ${kind === 'broll' ? 'B-roll' : kind} at ${msToLabel(edge === 'start' ? start : end)}. Drag or use arrow keys to trim`}
            title={`Drag to trim the ${edge} (arrow keys: 0.1 s)`}
            style={{ [edge === 'start' ? 'left' : 'right']: 0, width: 12 }}>
            <svg width="6" height="10" viewBox="0 0 8 12" aria-hidden="true" style={{ transform: edge === 'start' ? 'none' : 'scaleX(-1)' }}>
              <path d="M6 1.5L1.8 6 6 10.5" stroke="#0a0a0a" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>
      {tip && <span className="tl2-bar-tip" style={{ left: `${at(tip.at)}%` }}>{tip.text}</span>}
      {lifted && liftedGhost(key, kind, lifted, name, st, inside)}
      </Fragment>
    )
  }
  /**
   * Something dragged in from a panel or from the computer, while it's over the timeline: a copy of
   * it where it would go (its start at the pointer, on the row under the pointer), with the time on
   * it — as a clip carried along the timeline shows itself (liftedGhost). On the main row a thin
   * line marks where it goes in.
   */
  function dropGhost(d: { ms: number; lane: string | null; y: number; end?: number }) {
    const layer = trackRef.current
    // (wherever the pointer is over the timeline, as a carried bar shows: not only once a row is known)
    if (!layer || typeof document === 'undefined') return null
    const what = draggedIn.current
    const kind = what?.kind === 'image' ? 'photo' : what?.kind === 'audio' || !!d.lane?.startsWith('audio-') ? 'music' : 'video'
    const len = Math.max(500, what?.ms ?? 5000)
    const tr = layer.getBoundingClientRect()
    // (going on after the main row's last part: there)
    const ms = d.end ?? d.ms
    const x = tr.left + (ms / viewDur) * tr.width, w = Math.max(24, (len / viewDur) * tr.width)
    // (as tall as a bar on the row it goes on, held at its middle: it follows the pointer up and down)
    const h = kind === 'music' ? ROW_H - 2 : BLOCK_H
    // Its pictures, as a bar on a row shows them
    const inside = what?.url && kind === 'video'
      ? <VideoThumbnails tile videoUrl={what.url} startMs={0} durationMs={len} radius={0} dim={false} />
      : what?.url && kind === 'photo' ? <div className="absolute inset-0" style={{ backgroundImage: `url("${what.url}")`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }} />
      : what?.thumb ? <div className="absolute inset-0" style={{ backgroundImage: `url("${what.thumb}")`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }} />
      : undefined
    // (named as it will be on a row: a video covers the frame)
    const name = `${what?.name ?? 'Media'}${kind === 'video' && d.lane !== 'main' && d.end == null ? ' · full screen' : ''}`
    return ghostBar({ left: x, top: d.y - h / 2, width: w, height: h }, kind, name, ms, what?.ms ? ms + len : null, inside)
  }
  /**
   * Where the carried thing was when it was picked up (screen px), kept for the whole drag: the
   * copy is drawn from there plus how far the pointer went, so it stays under the pointer even when
   * the rows scroll or open up meanwhile
   */
  const ghostAnchor = useRef<{ id: string; left: number; top: number; width: number; height: number } | null>(null)
  if (!lift && !insertDrag) ghostAnchor.current = null
  const anchorOf = (id: string, home: HTMLElement) => {
    if (ghostAnchor.current?.id !== id) {
      const r = home.getBoundingClientRect()
      ghostAnchor.current = { id, left: r.left, top: r.top, width: r.width, height: r.height }
    }
    return ghostAnchor.current
  }
  /**
   * A bar being carried (as in Resolve / CapCut): drawn over the whole page, where it would go, at
   * the pointer's height — never under the main video or cut off by the rows around it, so it can
   * be seen all the way to wherever it's let go. Its own place is left empty meanwhile.
   */
  function liftedGhost(key: string, kind: 'video' | 'broll' | 'photo' | 'text' | 'music', l: { dy: number; start: number; end: number }, name: string,
    st: { hidden?: boolean; muted?: boolean; locked?: boolean }, inside?: React.ReactNode) {
    // (rows under the main video scroll on their own, outside the layer: looked for on the page)
    const layer = trackRef.current
    const home = document.querySelector<HTMLElement>(`.tl2-bar[data-item-id="${CSS.escape(key)}"]:not([aria-hidden])`)
    if (!layer || !home || typeof document === 'undefined') return null
    const tr = layer.getBoundingClientRect(), r = anchorOf(key, home)
    const x = tr.left + (l.start / viewDur) * tr.width, w = Math.max(10, ((l.end - l.start) / viewDur) * tr.width)
    return ghostBar({ left: x, top: r.top + l.dy, width: w, height: r.height }, kind, name, l.start, l.end, inside, !!st.hidden)
  }
  /**
   * A carried bar, drawn over the whole page at `box` (screen px): solid (what it passes over
   * doesn't show through it), its pictures, its name and length, and the time it would go to on it.
   * One look for a bar moved along the timeline and for media dragged in (dropGhost). `line`: a
   * thin mark down the row it goes into (the main row).
   */
  function ghostBar(box: { left: number; top: number; width: number; height: number }, kind: 'video' | 'broll' | 'photo' | 'text' | 'music', name: string,
    start: number, end: number | null, inside?: React.ReactNode, hidden = false, line?: { top: number; height: number }) {
    const video = kind === 'video' || kind === 'broll'
    return createPortal(
      <div aria-hidden="true" style={{ position: 'fixed', ...box, zIndex: 1000, pointerEvents: 'none' }}>
      {/* where it goes, on it */}
      <span className="absolute whitespace-nowrap text-[10.5px] font-bold px-1.5 rounded-full" style={{ left: 0, bottom: '100%', marginBottom: 3, background: 'rgba(10,10,10,0.85)', color: '#fff', fontVariantNumeric: 'tabular-nums', boxShadow: '0 0 0 1px rgb(var(--ed-fg) / 0.15)' }}>
        {clockLabel(start)}{end != null ? ` – ${clockLabel(end)}` : ''}
      </span>
      {line && <span className="absolute" style={{ left: -1, top: line.top - box.top, height: line.height, width: 2, background: ACCENT }} />}
      <div className="tl2-bar" data-sel="" data-kind={kind}
        style={{
          position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
          '--bar-c': MEDIA_COLORS[kind], // (text: black, as on its row — its colour only on its T)
          background: video || kind === 'text' ? '#0d0d0d' : `color-mix(in srgb, ${MEDIA_COLORS[kind]} 55%, #0d0d0d)`,
          cursor: 'grabbing', filter: 'drop-shadow(0 10px 18px rgba(0,0,0,0.65))', ...(hidden ? { opacity: 0.7 } : {}),
        } as React.CSSProperties}>
        {inside && <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: 'inherit', opacity: video ? 1 : 0.55 }}>{inside}</div>}
        <span className="relative flex items-center gap-1 min-w-0" style={{ paddingLeft: 8, paddingRight: 6 }}>
          <MediaIcon kind={kind} />
          <span className="truncate">{name}</span>
          {end != null && <span className="tl2-bar-len">{lenLabel(end - start)}</span>}
        </span>
      </div>
      </div>,
      document.body,
    )
  }
  /**
   * The Captions row (as CapCut's caption track): each caption line a block with its words, a line
   * in its style's colour along its top. Click a line to select it (Shift / Ctrl: add more), drag
   * across the row to select every line in that stretch: the Captions panel styles them.
   */
  function captionStrip(row: NonNullable<TimelineProps['captionRow']>) {
    const startSelect = (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.stopPropagation(); e.preventDefault()
      const add = e.shiftKey || e.ctrlKey || e.metaKey
      const sx = e.clientX, t0 = Math.max(0, Math.min(duration, rawMsFromClientX(e.clientX)))
      let moved = false, range: [number, number] = [t0, t0]
      setDragging('caption-range')
      track(ev => {
        if (!moved && Math.abs(ev.clientX - sx) < 4) return
        moved = true
        const t1 = Math.max(0, Math.min(duration, rawMsFromClientX(ev.clientX)))
        range = [Math.round(Math.min(t0, t1)), Math.round(Math.max(t0, t1))]
        setCapDrag(range)
      }, () => {
        setCapDrag(null)
        if (moved && range[1] - range[0] >= 150) { onSelectCaptionRange?.(range, add); return }
        // A click: the line there (or the nearest one), and the playhead goes there
        const i = row.lines.findIndex(l => t0 >= l.start && t0 < l.end)
        const near = i >= 0 ? i : row.lines.reduce((best, l, k) => (Math.abs((l.start + l.end) / 2 - t0) < Math.abs((row.lines[best].start + row.lines[best].end) / 2 - t0) ? k : best), 0)
        if (row.lines.length) onCaptionLineClick?.(near, add)
        onSeek(Math.round(t0))
      })
    }
    return (
      <div data-lane="captions" className="tl2-caps relative" style={{ height: CAP_ROW_H }} onPointerDown={startSelect}
        title="Captions: click a line to style it (Shift-click or drag across for more)">
        {row.lines.map((l, i) => (
          <div key={`${l.start}-${i}`} className="tl2-capline" data-on={l.on || undefined} title={`${l.text}\n${l.name}`}
            style={{ left: `${at(l.start)}%`, width: `max(3px, ${pct(l.end - l.start)}%)`, '--cap-c': l.color } as React.CSSProperties}>
            <span>{l.text}</span>
          </div>
        ))}
        {capDrag && capDrag[1] > capDrag[0] && (
          <div className="tl2-caps-sel" style={{ left: `${at(capDrag[0])}%`, width: `${pct(capDrag[1] - capDrag[0])}%` }}>
            <span>{clockLabel(capDrag[0])} – {clockLabel(capDrag[1])}</span>
          </div>
        )}
      </div>
    )
  }
  /**
   * A row's view, sound or lock button (as in Resolve's track header): grey while everything on the
   * row is shown, heard and free; marked while it's hidden, muted or locked. It switches for all of it.
   */
  const rowButton = (kind: string, k: LaneCtlKey, on: boolean, mid: number, what: string, note?: string) => {
    const row = kind === 'main' ? `the main video${note ? ` (${note})` : ''}` : note ? `${what.toLowerCase()} (${note})` : `this row (${what.toLowerCase()})`
    const label = k === 'hidden' ? (on ? `Show ${row}` : `Hide ${row}`)
      : k === 'muted' ? (on ? `Turn the sound of ${row} back on` : `Mute ${row}`)
      : on ? `Unlock ${row}` : `Lock ${row}`
    return (
      <button key={k} type="button" className="tl2-row-ctl" data-key={k} data-on={on || undefined} aria-pressed={on} aria-label={label} title={label}
        onClick={() => onLaneCtl?.(kind, k)} style={{ top: mid - 10, left: ROW_CTL_X[k] }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {k === 'hidden' && (on
            ? <><path d="M9.9 4.2A9.6 9.6 0 0112 4c5 0 9 5 10 8a13 13 0 01-2.2 3.4M6.6 6.6C4.4 8 2.8 10.1 2 12c1 3 5 8 10 8 1.9 0 3.6-.6 5.1-1.6" /><path d="M3 3l18 18M9.9 9.9a3 3 0 004.2 4.2" /></>
            : <><path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>)}
          {k === 'muted' && (on
            ? <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M22 9l-6 6M16 9l6 6" /></>
            : <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14" /></>)}
          {k === 'locked' && (on
            ? <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>
            : <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 017.5-2" /></>)}
        </svg>
      </button>
    )
  }
  const trackRow = (family: 'visual' | 'audio', t: number, edge: 'top' | 'bottom' | null, children: React.ReactNode, inHead = false) => {
    const hover = trackHover?.family === family ? trackHover.target : dropAt?.lane === `${family === 'visual' ? 'track' : 'audio'}-${t}` ? t : null
    return (
      <div key={`${family}-${t}`} data-lane={`${family === 'visual' ? 'track' : 'audio'}-${t}`} data-track-row={family} data-track={t}
        className="relative" style={{ height: family === 'visual' ? VIS_ROW_H : ROW_H, ...(hover === t ? { background: 'rgb(var(--ed-fg) / 0.045)', borderRadius: 6 } : {}) }}
        // (the rows above the main video are in the head, which moves the playhead itself)
        onPointerDown={inHead ? undefined : handleScrubDown}>
        {hover === 'new' && edge && (
          <div className="absolute left-0 right-0 pointer-events-none rounded-full" aria-hidden="true"
            style={{ [edge]: -ROW_GAP / 2 - 1, height: 2, background: NEW_ROW_LINE, zIndex: 20 }} />
        )}
        {children}
      </div>
    )
  }
  const visualBar = (v: Visual) => {
    if (v.kind === 'shot') {
      const seg = v.seg
      const kind = isStock?.(seg) ? 'broll' as const : 'video' as const
      const sel = isSel(seg.id, seg.id === activeSegmentId || seg.id === pickedSegmentId)
      const shown = brollGhost?.id === seg.id ? { start_ms: brollGhost.start, end_ms: brollGhost.end } : seg
      const box = seg.crop_boxes[0]
      const name = (videoTitles[box?.source_video_id ?? ''] ?? (kind === 'broll' ? 'B-roll' : 'Video')).replace(/^(Pixabay|Pexels): /, '').split(',')[0]
      const url = videoUrls[box?.source_video_id ?? '']
      return bar(seg.id, kind, shown.start_ms, shown.end_ms, sel, !!dragging?.endsWith(seg.id), { hidden: box?.hidden, muted: box?.muted !== false, locked: seg.locked }, `${name} · full screen`,
        e => handleBrollDown(e, seg, 'body'), (e, edge) => handleBrollDown(e, seg, edge),
        `Overlay (full screen) · ${name} · ${msToLabel(seg.start_ms)}–${msToLabel(seg.end_ms)} · click to select, drag to move`,
        url && <VideoThumbnails tile videoUrl={url} startMs={box?.source_offset_ms ?? 0} durationMs={seg.end_ms - seg.start_ms} radius={0} dim={false} />,
        (edge, d) => keyTrimShot(seg, edge, d))
    }
    if (v.kind === 'photo') {
      const ph = v.ph
      const sel = isSel(ph.id, ph.id === activePhotoId)
      const full = !ph.video && ph.full
      return bar(ph.id, ph.video ? 'video' : 'photo', ph.start_ms, ph.end_ms, sel, dragging === `photo-${ph.id}`, ph.video ? { ...ph, muted: ph.video.muted } : ph,
        ph.video ? 'Video · window' : full ? 'Photo · full screen' : 'Photo · window', e => handlePhotoDrag(e, ph, 'body'), (e, edge) => handlePhotoDrag(e, ph, edge),
        `Overlay (${ph.video ? 'video' : 'photo'}, ${full ? 'full screen' : 'window'}) · ${msToLabel(ph.start_ms)}–${msToLabel(ph.end_ms)} · click to select, drag to move`,
        ph.video ? (ph.video.url && <VideoThumbnails tile videoUrl={ph.video.url} startMs={ph.video.offset} durationMs={ph.end_ms - ph.start_ms} radius={0} dim={false} />)
          : ph.url ? <div className="absolute inset-0" style={{ backgroundImage: `url("${ph.url}")`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }} /> : null,
        (edge, d) => {
          if (ph.locked) return
          if (edge === 'start') onPhotoTimeChange?.(ph.id, { start_ms: Math.round(Math.max(0, Math.min(ph.end_ms - 200, ph.start_ms + d))), end_ms: ph.end_ms })
          else onPhotoTimeChange?.(ph.id, { start_ms: ph.start_ms, end_ms: Math.round(Math.min(duration, Math.max(ph.start_ms + 200, ph.end_ms + d))) })
        })
    }
    const o = v.o
    const sel = isSel(o.id, o.id === activeTextOverlayId)
    return bar(o.id, 'text', o.start_ms, o.end_ms, sel, dragging === `text-${o.id}`, o, o.text?.trim() || 'Text',
      e => handleTextDrag(e, o, 'body'), (e, edge) => handleTextDrag(e, o, edge),
      `Text · “${o.text}” · ${msToLabel(o.start_ms)}–${msToLabel(o.end_ms)} · tap to select, drag to move`, undefined,
      (edge, d) => {
        if (o.locked) return
        if (edge === 'start') onTextOverlayUpdate?.(o.id, { start_ms: Math.round(Math.max(0, Math.min(o.end_ms - 200, o.start_ms + d))) })
        else onTextOverlayUpdate?.(o.id, { end_ms: Math.round(Math.min(duration, Math.max(o.start_ms + 200, o.end_ms + d))) })
      })
  }
  const musicBar = (m: (typeof musicTracks)[number]) => {
    const end = musicEnd(m)
    const sel = isSel(m.id, selectedMusicId === m.id)
    // (the clip's own sound goes with the main video: not one of a group)
    return bar(m.id, 'music', m.start_ms, end, sel, dragging === `music-${m.id}`, { ...m, fixed: m.original }, m.original ? 'Original sound' : m.name,
      e => handleMusicDrag(e, m), onMusicTrim ? (e, edge) => handleMusicTrim(e, m, edge) : null,
      `${m.original ? 'Original sound' : `Music · ${m.name}`} · ${msToLabel(m.start_ms)}–${msToLabel(end)} · tap to select, drag to move`,
      <Waveform url={m.url} srcKey={m.key} offsetMs={m.offset_ms ?? 0} durationMs={end - m.start_ms} />,
      (edge, d) => { if (!m.locked) onMusicTrim?.(m.id, edge, Math.round((edge === 'start' ? m.start_ms : end) + d)) })
  }

  // ── Frame lanes: only the frame picked (the one under the playhead) — its own rows, under its name
  // and time, each with its own eye / sound / lock (user, 2026-11-06: rows shared by every frame
  // didn't say which frame was shown, hidden or muted). Another frame picked: the rows switch to it ──
  const frameLanes = () => {
    const seg = frameSeg && isFrameLayout(frameSeg.layout) ? frameSeg : null
    if (!seg || !visibleLanes(seg).length) return null
    // The other frames on the rows they have too, with what's in them (user, 2026-11-09: display
    // everything — they were blank grey bars): quieter, and only to see; a click there moves the
    // playhead onto that frame, which picks it. A row only another frame has stays too, with no buttons
    const others = mains.filter(s => s.id !== seg.id && isFrameLayout(s.layout))
    const rows = [...visibleLanes(seg)]
    for (const o of others) for (const r of visibleLanes(o)) if (!rows.some(x => x.lane === r.lane)) rows.push(r)
    const frame = seg ? frameOf(seg) : null
    const main = frame?.main_slots ?? [0]
    const inSection = !!seg && currentTimeMs >= seg.start_ms && currentTimeMs < seg.end_ms
    const plusAt = seg ? (inSection ? currentTimeMs : seg.start_ms) : 0
    const itemName = (it: FrameItem) => it.kind === 'video' ? (videoTitles[it.source_video_id ?? ''] ?? 'Video') : it.kind === 'photo' ? 'Photo' : it.captions ? 'Captions' : (it.text?.trim() || 'Text')
    const isMainLane = (f: SegmentLocal, lane: FrameLane) => !isTextLane(lane) && (frameOf(f).main_slots ?? [0]).includes(lane as number)
    // The empty spots of the frame's lane (user, 2026-11-06: named, dashed, "+ Add" on
    // hover — a faint grey strip didn't say what it was). Clicked: the add menu for that spot there
    const empties = (f: SegmentLocal, lane: FrameLane, label: string) => {
      if (isMainLane(f, lane)) return null
      const out: Array<{ from: number; to: number }> = []
      let from = f.start_ms
      for (const it of laneItems(frameOf(f), lane, f)) {
        if (it.start_ms - from >= MIN_ITEM_MS) out.push({ from, to: it.start_ms })
        from = Math.max(from, it.end_ms)
      }
      if (f.end_ms - from >= MIN_ITEM_MS) out.push({ from, to: f.end_ms })
      const what = isTextLane(lane) ? 'text' : 'a photo or video'
      return out.map(g => (
        <button key={`empty-${f.id}-${g.from}`} type="button" className="group/empty absolute inset-y-0.5 flex items-center gap-1.5 overflow-hidden"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            // (the menu opens at the pointer, not at the spot's far corner)
            const r = e.currentTarget.getBoundingClientRect()
            onAddFrameItem?.(lane, new DOMRect(e.clientX - 9, r.top, 18, r.height), { segId: f.id, t: g.from })
          }}
          aria-label={`${label}, empty ${msToLabel(g.from)}–${msToLabel(g.to)}: add ${what} here`}
          title={`${label} is empty here · click to add ${what}`}
          style={{ left: `${at(g.from)}%`, width: `${pct(g.to - g.from)}%`, borderRadius: 5, background: 'rgb(var(--ed-fg) / 0.035)', border: '1px dashed rgb(var(--ed-fg) / 0.25)' }}>
          <span className="pl-2 truncate text-[10px] font-semibold pointer-events-none" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>{label} · empty</span>
          <span className="shrink-0 pr-2 text-[10px] font-bold pointer-events-none opacity-0 group-hover/empty:opacity-100 transition-opacity" style={{ color: ACCENT }}>+ Add</span>
        </button>
      ))
    }
    return (
      <div ref={lanesRef} className="relative flex flex-col" style={{ gap: 2, paddingTop: 4, paddingBottom: 2 }}>
        {/* Whose rows these are: the frame's name and time, a bracket over its stretch */}
        <div className="relative pointer-events-none" style={{ height: FRAME_HEAD_H }} aria-label={`Rows of ${formatTag(seg)}, ${msToLabel(seg.start_ms)}–${msToLabel(seg.end_ms)}`}>
          <div className="absolute bottom-0.5 flex items-end gap-1.5 whitespace-nowrap" style={{ left: `${at(seg.start_ms)}%`, minWidth: `${pct(seg.end_ms - seg.start_ms)}%`, borderBottom: `1.5px solid ${LAYOUT_COLORS[seg.layout] ?? ACCENT}88` }}>
            <span className="text-[10px] font-bold pl-1" style={{ color: LAYOUT_COLORS[seg.layout] ?? ACCENT }}>{formatTag(seg)}</span>
            <span className="text-[10px] tabular-nums pb-px" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>{msToLabel(seg.start_ms)}–{msToLabel(seg.end_ms)}</span>
          </div>
        </div>
        {rows.map(lane => {
          const laneKey = String(lane.lane)
          const row = visibleLanes(seg).find(r => r.lane === lane.lane)
          const isMain = !!row && !isTextLane(row.lane) && main.includes(row.lane)
          const mainId = `main:${lane.lane}`
          const pulsing = pulseLane === lane.lane
          return (
            <div key={laneKey} data-lane={`frame:${laneKey}`} className="group/lane relative" style={{ height: FRAME_LANE_H }}
              onPointerDown={e => { onSelectFrameItem?.(null); handleScrubDown(e) }}>
              {others.filter(o => visibleLanes(o).some(r => r.lane === lane.lane)).map(o => (
                <Fragment key={o.id}>
                  <div className="absolute inset-y-0.5 pointer-events-none" title={formatTag(o)}
                    style={{ left: `${at(o.start_ms)}%`, width: `${pct(o.end_ms - o.start_ms)}%`, borderRadius: 5, background: 'rgb(var(--ed-fg) / 0.045)' }} />
                  {isMainLane(o, lane.lane) && (
                    <div className="absolute inset-y-0.5 flex items-center overflow-hidden pointer-events-none"
                      style={{ left: `${at(o.start_ms)}%`, width: `${pct(o.end_ms - o.start_ms)}%`, borderRadius: 5, background: `${FRAME_ITEM_COLORS.main}18` }}>
                      <span className="px-2 truncate text-[10px] font-semibold" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>{lane.label} · Main video</span>
                    </div>
                  )}
                  {laneItems(frameOf(o), lane.lane, o).map(it => {
                    const from = Math.max(it.start_ms, o.start_ms), to = Math.min(it.end_ms, o.end_ms)
                    if (to <= from) return null
                    return (
                      <div key={it.id} className="absolute inset-y-0.5 flex items-center overflow-hidden pointer-events-none"
                        style={{ left: `${at(from)}%`, width: `max(8px, ${pct(to - from)}%)`, borderRadius: 5, zIndex: 1, background: it.freeze ? FROZEN_BLUE : `${frameItemColor(it)}28`, boxShadow: `inset 2px 0 0 ${frameItemColor(it)}88` }}>
                        {it.kind === 'photo' && it.image_url && <img src={it.image_url} alt="" crossOrigin="anonymous" className="h-full w-7 object-cover shrink-0" style={{ marginLeft: 2, opacity: 0.75 }} />}
                        <span className="px-2 truncate text-[10px] font-semibold" style={{ color: 'rgb(var(--ed-fg) / 0.72)' }}>{it.kind === 'text' && !it.captions ? 'T · ' : ''}{it.freeze || it.holds?.length ? '❄ ' : ''}{itemName(it)}</span>
                      </div>
                    )
                  })}
                </Fragment>
              ))}
              {frame && row && (<>
                <div className="absolute inset-y-0.5 pointer-events-none" style={{
                  left: `${at(seg.start_ms)}%`, width: `${pct(seg.end_ms - seg.start_ms)}%`, borderRadius: 5,
                  background: pulsing ? 'rgba(200,255,0,0.12)' : 'rgb(var(--ed-fg) / 0.045)', boxShadow: pulsing ? `inset 0 0 0 1.5px ${ACCENT}` : 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.06)',
                }} />
                {empties(seg, row.lane, row.label)}
                {isMain && (() => {
                  const on = isSel(mainId, activeFrameItemId === mainId)
                  return (
                    <div className="absolute inset-y-0.5 flex items-center overflow-hidden"
                      onPointerDown={e => { e.stopPropagation(); onSelectFrameItem?.(mainId) }}
                      title="Main video · select it to change its sound or take it out of this slot"
                      style={{ left: `${at(seg.start_ms)}%`, width: `${pct(seg.end_ms - seg.start_ms)}%`, borderRadius: 5, background: `${FRAME_ITEM_COLORS.main}${on ? '40' : '24'}`, boxShadow: on ? SELECTED_RING : `inset 2px 0 0 ${FRAME_ITEM_COLORS.main}`, zIndex: on ? 3 : undefined }}>
                      <span className="px-2 truncate text-[10px] font-semibold pointer-events-none" style={{ color: 'rgb(var(--ed-fg) / 0.75)' }}>{row.label} · Main video</span>
                      {freezeRanges({
                        holds: (frame.freeze?.holds ?? []).filter(isMainHold), origin: seg.start_ms, from: seg.start_ms, to: seg.end_ms, on, grows: true,
                        locked: !!seg.locked || !!frame.main_locked?.[String(row.lane)], set: (i, h) => onFrameFreeze?.(mainId, i, h),
                      })}
                    </div>
                  )
                })()}
                {laneItems(frame, row.lane, seg).map(it => {
                  const from = Math.max(it.start_ms, seg.start_ms), to = Math.min(it.end_ms, seg.end_ms)
                  const on = isSel(it.id, it.id === activeFrameItemId)
                  const color = frameItemColor(it)
                  return (
                    <div key={it.id} className="absolute inset-y-0.5 flex items-center overflow-hidden"
                      onPointerDown={e => handleFrameItemDown(e, it, 'move')}
                      title={`${itemName(it)} · ${msToLabel(from)}–${msToLabel(to)} · drag to move, drag the ends to trim`}
                      style={{ left: `${at(from)}%`, width: `max(8px, ${pct(to - from)}%)`, borderRadius: 5, zIndex: on ? 3 : 2, background: it.freeze ? FROZEN_BLUE : `${color}${on ? '55' : '38'}`, boxShadow: on ? SELECTED_RING : `inset 0 0 0 1px ${color}88`, cursor: 'grab', touchAction: 'none' }}>
                      {/* Its freeze stretches: striped where it holds a still picture (it stays one piece) */}
                      {!it.freeze && it.kind === 'video' && freezeRanges({
                        holds: (frame.freeze?.holds ?? []).filter(h => sameLayer(h, it.id)), origin: seg.start_ms, from, to, on, grows: true, locked: !!seg.locked || !!it.locked,
                        set: (i, h) => onFrameFreeze?.(it.id, i, h),
                      })}
                      {/* (a freeze from before they added time: it can still be changed or taken off) */}
                      {!it.freeze && freezeRanges({
                        holds: it.holds ?? [], origin: it.start_ms, from, to, on, locked: !!seg.locked || !!it.locked,
                        set: (i, h) => {
                          const holds = (it.holds ?? []).flatMap((x, j) => (j !== i ? [x] : h ? [h] : []))
                          onUpdateFrameItem?.(it.id, holds.length ? { holds } : { holds: null, dim: false })
                        },
                      })}
                      <div className="absolute left-0 inset-y-0 w-2 cursor-col-resize z-10" style={{ background: 'rgba(0,0,0,0.25)' }} onPointerDown={e => handleFrameItemDown(e, it, 'start')} />
                      {it.kind === 'photo' && it.image_url && <img src={it.image_url} alt="" crossOrigin="anonymous" className="h-full w-7 object-cover shrink-0 pointer-events-none" style={{ marginLeft: 8, opacity: 0.9 }} />}
                      <span className="px-2.5 truncate text-[10px] font-semibold pointer-events-none" style={{ color: 'rgb(var(--ed-fg) / 0.92)' }}>{it.kind === 'text' && !it.captions ? 'T · ' : ''}{it.freeze || it.holds?.length ? '❄ ' : ''}{itemName(it)}</span>
                      <span className="shrink-0 pr-2.5 pointer-events-none"><StateBadges st={it} /></span>
                      <div className="absolute right-0 inset-y-0 w-2 cursor-col-resize z-10" style={{ background: 'rgba(0,0,0,0.25)' }} onPointerDown={e => handleFrameItemDown(e, it, 'end')} />
                    </div>
                  )
                })}
                {(() => {
                  // (the main video fills its row too: no + on something already there)
                  const taken = isMain || laneItems(frame, row.lane, seg).some(it => it.start_ms <= plusAt && plusAt < it.end_ms)
                  if (taken && !pulsing) return null
                  return (
                    <button ref={el => { if (el) plusRefs.current.set(laneKey, el); else plusRefs.current.delete(laneKey) }}
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); onAddFrameItem?.(row.lane, e.currentTarget.getBoundingClientRect()) }}
                      aria-label={`Add to the ${row.label.toLowerCase()} ${isTextLane(row.lane) ? 'area' : 'slot'} at ${msToLabel(plusAt)}`}
                      title={isTextLane(row.lane) ? 'Add text here' : 'Add a photo, video or text here'}
                      className="absolute top-1/2 flex items-center justify-center rounded-full hover:scale-110"
                      style={{ left: `${at(plusAt)}%`, transform: 'translate(-50%, -50%)', width: 18, height: 18, zIndex: 41, background: ACCENT, color: '#000', border: '1.5px solid rgba(0,0,0,0.7)' }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                    </button>
                  )
                })()}
              </>)}
            </div>
          )
        })}
      </div>
    )
  }

  // The rows of videos, photos and text on top sit above the main video (the highest track at the
  // top, as V2 over V1 in Premiere / Resolve); music stays under it
  const aboveTracks = visualTracks.filter(t => t >= belowRows)
  const belowTracks = visualTracks.filter(t => t < belowRows)
  const visualH = aboveTracks.length ? aboveTracks.length * VIS_ROW_H + (aboveTracks.length - 1) * ROW_GAP + 6 + 2 : 0
  const mainTop = RULER_H + visualH
  const mainRowH = BLOCK_H + MAIN_PAD * 2
  const headH = mainTop + mainRowH + (captionRow ? CAP_ROW_H : 0) + (originals.length ? ORIG_ROW_H : 0) + (viewMarkers.length ? VIEW_ROW_H : 0)
  // (the rows that always show, and the frame's border round them: onBaseHeight)
  const baseH = headH - visualH + 2
  useLayoutEffect(() => { onBaseHeight?.(baseH) }, [baseH]) // eslint-disable-line react-hooks/exhaustive-deps
  // Opened with rows over the main video: the view starts at the main video (those rows are a scroll up)
  // — once, as the clip opens, and only while it hasn't been scrolled by hand
  const openedAt = useRef(typeof performance !== 'undefined' ? performance.now() : 0)
  const startedAtMain = useRef(false)
  // (each render until then: the panel may only now have its opening height, so only now scroll)
  useLayoutEffect(() => {
    const v = viewRef.current
    if (startedAtMain.current || !v || !visualH || performance.now() - openedAt.current > 4000) return
    // (the panel at its opening height first — not still at the size it had before saying it — and rows to scroll)
    if (v.clientHeight > baseH + 2 || v.scrollHeight <= v.clientHeight + 1) return
    startedAtMain.current = true
    if (v.scrollTop < visualH / 2) v.scrollTop = visualH
  })

  return (
    <div className="tl2 flex items-stretch flex-auto min-h-0 select-none"
      // A click anywhere else in the timeline (under the rows, the margins, the left column) also
      // lets go of the selected part; what handles its own clicks (the rows, parts, bars, buttons,
      // grips, menus) is left to do so
      onPointerDown={e => {
        if (e.button !== 0) return
        const el = e.target as Element
        if (el.closest?.('[data-tl-head], .tl2-block, .tl2-bar, button, a, input, [role="menu"], [data-lane], [data-keep-selection]')) return
        onPickSegment?.(null)
        // (the empty room under the rows, in the view: a box can start there too — a click there lets
        // go of what's picked; elsewhere in the timeline's margins, a click just lets go)
        // (the room between the rows starts its own box: contentRef's handler)
        if (contentRef.current?.contains(el)) return
        if (onGroupSel && viewRef.current?.contains(el)) { beginBox(e); return }
        if (groupSel.length) onGroupSel?.([])
      }}>
      {/* ── Left column: add, the main video's sound, what each row is ── */}
      <div className="tl2-left relative shrink-0" style={{ width: laneCtl ? LEFT_W_CTL : LEFT_W }} aria-label="Timeline rows">
        {onAddKind && (
          <>
            <button type="button" className="tl2-add" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setAddMenu(addMenu ? null : r) }}
              aria-haspopup="menu" aria-expanded={!!addMenu} aria-label="Add media at the playhead" title="Add media at the playhead"
              style={{ top: 2, ...(laneCtl ? ADD_CTL_BOX : {}) }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                <path d={addMenu ? 'M6 6l12 12M18 6L6 18' : 'M12 5v14M5 12h14'} />
              </svg>
            </button>
            {addMenu && (
              <>
                <div className="fixed inset-0" style={{ zIndex: 90 }} onClick={() => setAddMenu(null)} aria-hidden="true" />
                {/* Three choices, at the playhead: a video (Media opens to pick it), sound, text (styles: .tl2-addmenu) */}
                <div role="menu" aria-label="Add at the playhead" className="tl2-addmenu fixed flex flex-col"
                  style={{ zIndex: 91, left: Math.min(addMenu.left, window.innerWidth - 280), ...(addMenu.bottom + 220 <= window.innerHeight ? { top: addMenu.bottom + 8 } : { bottom: window.innerHeight - addMenu.top + 8 }) }}>
                  <span className="tl2-addmenu-head">Add at the playhead</span>
                  {ADD_CHOICES.map(c => (
                    <button key={c.kind} type="button" role="menuitem" onClick={() => { setAddMenu(null); onAddKind(c.kind) }}
                      style={{ '--c': c.color } as React.CSSProperties}>
                      <span className="tl2-addmenu-ico">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{c.icon}</svg>
                      </span>
                      <span className="flex flex-col min-w-0 flex-1">
                        <span className="tl2-addmenu-label">{c.label}</span>
                        <span className="tl2-addmenu-hint">{c.hint}</span>
                      </span>
                      <svg className="tl2-addmenu-go" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {cutMenu && (() => {
          const tr = transitionAfter.get(cutMenu.afterId)
          const close = () => setCutMenu(null)
          return (
            <>
              <div className="fixed inset-0" style={{ zIndex: 90 }} onClick={close} onContextMenu={e => { e.preventDefault(); close() }} aria-hidden="true" />
              <div role="menu" aria-label={`Transition at ${msToLabel(cutMenu.at)}`} className="tl2-menu fixed flex flex-col py-1.5"
                onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}
                ref={el => { if (el && !el.dataset.focused) { el.dataset.focused = '1'; el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }) } }}
                style={{ zIndex: 91, left: Math.min(cutMenu.x, window.innerWidth - 230), top: Math.min(cutMenu.y + 4, window.innerHeight - 150), minWidth: 210 }}>
                <span className="tl2-menu-hint px-3 pb-1">{tr ? `${transitionName(tr.type)} at ${msToLabel(cutMenu.at)}` : ''}</span>
                <button type="button" role="menuitem" onClick={() => { close(); onOpenTransition?.(cutMenu.afterId, cutMenu.at) }}>Change…</button>
                {onApplyTransitionToAll && junctions.length > 1 && (
                  <button type="button" role="menuitem" onClick={() => { close(); onApplyTransitionToAll(cutMenu.afterId) }}>Apply to all cuts</button>
                )}
                {onRemoveTransition && (
                  <button type="button" role="menuitem" onClick={() => { close(); onRemoveTransition(cutMenu.afterId) }}>Remove</button>
                )}
              </div>
            </>
          )
        })()}
        {groupMenu && (() => {
          const close = () => setGroupMenu(null)
          return (
            <>
              <div className="fixed inset-0" style={{ zIndex: 90 }} onClick={close} onContextMenu={e => { e.preventDefault(); close() }} aria-hidden="true" />
              <div role="menu" aria-label="Group" className="tl2-menu fixed flex flex-col py-1.5"
                onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}
                ref={el => { if (el && !el.dataset.focused) { el.dataset.focused = '1'; el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }) } }}
                style={{ zIndex: 91, left: Math.min(groupMenu.x, window.innerWidth - 240), top: Math.min(groupMenu.y + 4, window.innerHeight - 130), minWidth: 220 }}>
                <span className="tl2-menu-hint px-3 pb-1">{groupMenu.n > 1 ? `${groupMenu.n} picked` : '1 picked — Ctrl + click or drag a box to pick more'}</span>
                {onGroup && (
                  <button type="button" role="menuitem" disabled={!groupMenu.canGroup} style={groupMenu.canGroup ? undefined : { opacity: 0.4 }}
                    onClick={() => { close(); onGroup() }}>Group<span className="tl2-menu-hint ml-auto pl-4">Ctrl+G</span></button>
                )}
                {onUngroup && (
                  <button type="button" role="menuitem" disabled={!groupMenu.canUngroup} style={groupMenu.canUngroup ? undefined : { opacity: 0.4 }}
                    onClick={() => { close(); onUngroup() }}>Ungroup<span className="tl2-menu-hint ml-auto pl-4">Ctrl+Shift+G</span></button>
                )}
              </div>
            </>
          )
        })()}
        {/* "Mute clip audio" (as in CapCut), level with the main row: with the rows' own buttons, the main row's speaker is it */}
        {onToggleMainMute && !laneCtl && mainSpan && (
          <button type="button" className="tl2-mute" data-on={mainMuted || undefined} onClick={onToggleMainMute}
            aria-pressed={mainMuted} aria-label={mainMuted ? 'Turn the clip’s audio back on' : 'Mute clip audio'} title={mainMuted ? 'Clip audio is off — click to turn it on' : 'Mute clip audio'}
            style={{ top: mainSpan.top + MAIN_PAD + BLOCK_H / 2 - 20 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {mainMuted ? <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M22 9l-6 6M16 9l6 6" /></> : <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14" /></>}
            </svg>
            <span>{mainMuted ? 'Off' : 'Audio'}</span>
          </button>
        )}
        {laneSpans.map(sp => {
          const meta = metaOf(sp.kind)
          // (the main row keeps its own sound button: beside it, its lock. A frame's rows: theirs, for
          // that frame only — the frame picked, whose rows these are)
          const ctl = laneCtl && (sp.kind === 'main' || /^(track|audio)-\d+$/.test(sp.kind) || sp.kind.startsWith('frame:')) ? laneCtl(sp.kind) : null
          if (!meta && !ctl) return null
          const frameRow = sp.kind.startsWith('frame:') && frameSeg && isFrameLayout(frameSeg.layout)
            ? visibleLanes(frameSeg).find(r => `frame:${r.lane}` === sp.kind) : undefined
          const mid = sp.kind === 'main' ? sp.top + MAIN_PAD + BLOCK_H / 2 : sp.top + sp.h / 2
          return (
            <Fragment key={sp.kind}>
              {meta && (
                <span className="tl2-row-ico" title={meta.label} style={{ top: mid - 9, color: meta.color, ...(laneCtl ? { left: ROW_ICO_X } : {}) }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{meta.icon}</svg>
                </span>
              )}
              {/* (the main row has no icon: photos and frames go in it too — user, 2026-10-30) */}
              {ctl && !ctl.empty && ctl.can.map(k => rowButton(sp.kind, k, !!ctl.state[k], mid,
                sp.kind === 'main' ? 'Main video' : frameRow && frameSeg ? `${frameRow.label} in ${formatTag(frameSeg)}` : meta?.label ?? 'Media', ctl.note))}
            </Fragment>
          )
        })}
      </div>

      {/* ── The timeline: the layer slides under the playhead in the middle ── */}
      <div className="tl2-frame relative flex-1 min-w-0">
      <div ref={viewRef} className="tl2-view" onScroll={measureLanes}
        onDragOver={onDragOver} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setDropAt(null); setDropCut(null); setDropReach(null) } }} onDrop={onDrop}>
        <div ref={el => { contentRef.current = el; trackRef.current = el }} className="relative" style={{ width: contentW, willChange: 'transform' }}
          // (the room between and under the rows: a box can start there too)
          onPointerDown={e => {
            const el = e.target as Element
            if (!onGroupSel || e.button !== 0 || el.closest?.('[data-lane], [data-tl-head], .tl2-bar, .tl2-block, button, [role="menu"]')) return
            beginBox(e)
          }}>
          {/* (what's dragged in shows itself where it would go: dropGhost) */}
          {dropAt && dropGhost(dropAt)}
          {/* The box being dragged out to pick what it touches */}
          {box && typeof document !== 'undefined' && createPortal(
            <div className="tl2-pickbox" aria-hidden="true" style={{ left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 }}>
              {groupSel.length > 1 && <span>{groupSel.length} picked</span>}
            </div>,
            document.body,
          )}
          {/* The ruler: always at the top, as in Premiere, Resolve and CapCut; every row scrolls under it */}
          <div data-tl-head className="tl2-ruler" style={{ height: RULER_H }} onPointerDown={handleScrubDown}>
              {ticks.map(({ t, major }) => (
                <div key={t} className={major ? 'tl2-tick tl2-tick-major' : 'tl2-tick'} style={{ left: `${pct(t)}%` }}>
                  {major && <span>{tickLabel(t)}</span>}
                </div>
              ))}
              {/* While something is dragged in: drop it here to put it on top of the video (a new
                  row over the others); on the main video it goes into the clip instead */}
              {dropAt && <div data-lane="track-new" className="tl2-dropzone tl2-dropzone-top" data-on={dropAt.lane === 'track-new' || undefined} aria-label="A new row above the main video" />}
          </div>
          {/* The rows on top of the main video, the main row and its own rows (captions, sound, views) */}
          <div data-tl-head className="tl2-head" style={{ height: headH - RULER_H }} onPointerDown={handleScrubDown}>
            {/* dragged up with no rows above yet: a new one opens here, over the main video */}
            {trackHover?.family === 'visual' && trackHover.target === 'new' && aboveTracks.length === 0 && (
              <div className="absolute left-0 right-0 pointer-events-none rounded-full" aria-hidden="true" style={{ top: 0, height: 2, zIndex: 25, background: NEW_ROW_LINE }} />
            )}
            {/* Rows on top of the main video: videos, photos, text */}
            {aboveTracks.length > 0 && (
              <div className="relative flex flex-col" style={{ gap: ROW_GAP, paddingTop: 6, paddingBottom: 2 }}>
                {aboveTracks.map((t, i) => trackRow('visual', t, i === 0 ? 'top' : null, visual.filter(v => v.track === t).map(visualBar), true))}
              </div>
            )}
            {/* Main row: one block per part; a transition button between touching parts */}
            <div data-lane="main" className="relative" style={{ height: mainRowH }}>
              {mains.map((seg, i) => mainBlock(seg, i))}
              {/* a video from a row carried over the main row: it goes in here */}
              {/* (a video carried over the main row, from a row or dragged in from a panel: where it goes in) */}
              {(mainDropAt ?? dropAt?.end ?? (dropAt?.lane === 'main' ? dropAt.ms : null)) != null && (() => {
                const t = (mainDropAt ?? dropAt!.end ?? dropAt!.ms)
                const after = mainDropAt == null && dropAt?.end != null
                return (
                  <div className="absolute pointer-events-none" style={{ left: `${at(t)}%`, top: 0, bottom: 0, zIndex: 35 }}>
                    <div className="absolute top-0 bottom-0 rounded-full" style={{ left: -1, width: 2, background: ACCENT }} />
                    <span className="absolute whitespace-nowrap text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ top: -2, left: 6, background: ACCENT, color: '#000' }}>{after ? `After the main video · ${clockLabel(t)} · a transition can go between` : `Insert into the main video · ${clockLabel(t)}`}</span>
                  </div>
                )
              })()}
              {/* a video in the main row being carried: where it will go in */}
              {/* Let go over empty room: exactly here — its outline where it will be */}
              {insertDrag && !insertDrag.off && insertDrag.place != null && (() => {
                const seg = mains.find(m => m.id === insertDrag.id)
                if (!seg) return null
                const len = seg.end_ms - seg.start_ms
                return (
                  <div className="absolute pointer-events-none" style={{ ...blockBox(insertDrag.place, insertDrag.place + len), zIndex: 35, borderRadius: 8,
                    boxShadow: `inset 0 0 0 2px ${ACCENT}`, background: 'color-mix(in srgb, #c8ff00 10%, transparent)' }}>
                    <span className="absolute whitespace-nowrap text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ top: -18, left: 0, background: ACCENT, color: '#000' }}>
                      {`Place here · starts at ${clockLabel(insertDrag.place)}`}
                    </span>
                  </div>
                )
              })()}
              {insertDrag && !insertDrag.off && insertDrag.place == null && (() => {
                const seg = mains.find(m => m.id === insertDrag.id)
                if (!seg) return null
                const stays = insertDrag.to > seg.start_ms && insertDrag.to < seg.end_ms
                const lands = insertDrag.to >= seg.end_ms ? insertDrag.to - (seg.end_ms - seg.start_ms) : insertDrag.to
                return (
                  <div className="absolute pointer-events-none" style={{ left: `${at(insertDrag.to)}%`, top: 0, bottom: 0, zIndex: 35 }}>
                    {!stays && <div className="absolute top-0 bottom-0 rounded-full" style={{ left: -1, width: 2, background: ACCENT }} />}
                    <span className="absolute whitespace-nowrap text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ top: -2, left: 6, background: ACCENT, color: '#000' }}>
                      {stays ? 'Let go: it stays here' : `Move here · starts at ${clockLabel(lands)}`}
                    </span>
                  </div>
                )
              })()}
              {!dragging && junctions.filter(j => !isTailPart(j.right) && !rowJoins.has(j.left.id)).map(({ left, right }) => {
                // A marker on every cut, as in CapCut: lime with its kind's picture when it has a
                // transition, a grey "+" when not. Beside the selected part it moves off the cut, onto
                // the other part, so the selected part's grip stays free to drag
                const selPart = selectedId !== undefined ? selectedId : (pickedSegmentId ?? activeSegmentId)
                const room = Math.min(left.end_ms - left.start_ms, right.end_ms - right.start_ms)
                const tr = transitionAfter.get(left.id)
                const on = !!tr && tr.type !== 'cut'
                // (beside an empty stretch of the main row: only a cut with a transition, so it's seen)
                if (!on && (isGapPart(left, mainVideoId) || isGapPart(right, mainVideoId))) return null
                const focus = focusCut === left.id
                // (a part too narrow on screen to hold it: a cut with a transition keeps a small dot, one
                // without none. The dot sits just under the row, so the narrow part stays free to tap)
                const small = room * pxPerMs < 30
                if (small && !on) return null
                const set = on ? (tr!.duration_ms || TRANSITION_DEFAULT_MS) : 0
                const played = on ? playedTransitionMs(set, room) : 0
                const name = on ? transitionName(tr!.type) : ''
                const half = small ? 3.5 : 10
                const shift = small || !selPart ? -half : left.id === selPart ? 1.5 : right.id === selPart ? -half * 2 - 1.5 : -half
                const what = on ? (played ? `${name} · ${transitionSecs(played)}${played < set ? ' (a part beside it is short)' : ''}` : `${name} · a part beside it is too short: plays as a plain cut`) : ''
                return (
                  <button key={`tr-${left.id}`} type="button" className="tl2-trans absolute" data-on={on || undefined} data-small={small || undefined}
                    data-off={(on && !played) || undefined} data-drop={dropCut === left.id || undefined} data-focus={focus || undefined} data-kind={on ? tr!.type : undefined}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); onOpenTransition?.(left.id, left.end_ms) }}
                    onContextMenu={e => {
                      e.preventDefault(); e.stopPropagation()
                      if (!on) { onOpenTransition?.(left.id, left.end_ms); return }
                      setCutMenu({ afterId: left.id, at: left.end_ms, x: e.clientX, y: e.clientY })
                    }}
                    onKeyDown={e => {
                      // (Delete on a marker takes its transition away, never the part that is selected)
                      if (e.key !== 'Delete' && e.key !== 'Backspace') return
                      e.preventDefault(); e.stopPropagation()
                      if (on) onRemoveTransition?.(left.id)
                    }}
                    aria-label={on ? `Transition at ${msToLabel(left.end_ms)}: ${what}. Change it` : `Add a transition at ${msToLabel(left.end_ms)}`}
                    title={on ? `${what} — click to change it, right-click for more` : 'Add a transition between these parts'}
                    style={{ left: `${at(left.end_ms)}%`, top: small ? MAIN_PAD + BLOCK_H + 3 : MAIN_PAD + BLOCK_H / 2, marginLeft: shift }}>
                    {!small && <TransitionGlyph type={on ? tr!.type : 'cut'} size={on ? 12 : 10} />}
                  </button>
                )
              })}
              {/* A video on a row starting where a part of the main row ends (rowJoins): a marker on that
                  cut, as on any other — the transition plays from the part into the video, which stays
                  on its row. Starting a little after the end, a click first lines it up there (on its
                  own row: it only slides along it) */}
              {!dragging && onOpenTransition && [...rowJoins].map(([leftId, shot]) => {
                const left = mains.find(m => m.id === leftId)
                if (!left) return null
                const exact = rowJoinExact(leftId)
                if (!exact && (shot.locked || !onBrollChange)) return null
                const tr = transitionAfter.get(leftId)
                const on = exact && !!tr && tr.type !== 'cut'
                const room = Math.min(left.end_ms - left.start_ms, shot.end_ms - shot.start_ms)
                const set = on ? (tr!.duration_ms || TRANSITION_DEFAULT_MS) : 0
                const played = on ? playedTransitionMs(set, room) : 0
                const what = on ? `${transitionName(tr!.type)} · ${played ? transitionSecs(played) : 'too short to show'}` : ''
                return (
                  <button key={`row-${leftId}`} type="button" className={`tl2-trans absolute${on ? '' : ' tl2-join'}`} data-on={on || undefined}
                    data-off={(on && !played) || undefined} data-drop={dropCut === leftId || undefined} data-focus={focusCut === leftId || undefined} data-kind={on ? tr!.type : undefined}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => {
                      e.stopPropagation()
                      // (a little after the part's end: slid along its own row to start right there)
                      if (!exact) onBrollChange?.(shot.id, left.end_ms, left.end_ms + (shot.end_ms - shot.start_ms), true)
                      onOpenTransition(leftId, left.end_ms)
                    }}
                    onContextMenu={e => {
                      e.preventDefault(); e.stopPropagation()
                      if (!on) { e.currentTarget.click(); return }
                      setCutMenu({ afterId: leftId, at: left.end_ms, x: e.clientX, y: e.clientY })
                    }}
                    onKeyDown={e => {
                      if (e.key !== 'Delete' && e.key !== 'Backspace') return
                      e.preventDefault(); e.stopPropagation()
                      if (on) onRemoveTransition?.(leftId)
                    }}
                    aria-label={on ? `Transition at ${msToLabel(left.end_ms)} into the video below: ${what}. Change it` : `Add a transition at ${msToLabel(left.end_ms)}, into the video below`}
                    title={on ? `${what} — into the video below. Click to change it, right-click for more`
                      : exact ? 'Add a transition from this part into the video below (it stays on its row)'
                      : 'Add a transition into the video below: it slides to start right here, on its own row'}
                    style={{ left: `${at(left.end_ms)}%`, top: MAIN_PAD + BLOCK_H / 2, marginLeft: -10 }}>
                    <TransitionGlyph type={on ? tr!.type : 'cut'} size={on ? 12 : 10} />
                  </button>
                )
              })}
              {/* The cut the Transition tool is on. With a transition: a zone over the clip as wide as
                  it plays (stripes drifting through it, fading in and out at its ends, as one shot
                  gives way to the next) and a badge under it — its kind, its length. Without one: a
                  dashed seam and a quiet badge */}
              {!dragging && !dropCut && focusCut && (() => {
                const left = junctions.find(x => x.left.id === focusCut)?.left ?? (rowJoinExact(focusCut) ? mains.find(m => m.id === focusCut) : undefined)
                if (!left) return null
                const right = junctions.find(x => x.left.id === focusCut)?.right ?? rowJoins.get(focusCut)
                const tr = transitionAfter.get(focusCut)
                const on = !!tr && tr.type !== 'cut'
                const room = right ? Math.min(left.end_ms - left.start_ms, right.end_ms - right.start_ms) : 0
                const played = on ? playedTransitionMs(tr!.duration_ms || TRANSITION_DEFAULT_MS, room) : 0
                const cut = left.end_ms
                const badge = (
                  <span className="tl2-cutfocus-badge" data-on={on || undefined}>
                    <TransitionGlyph type={on ? tr!.type : 'cut'} size={10} />
                    {on ? <>{transitionName(tr!.type)}<i>{played ? transitionSecs(played) : 'too short'}</i></> : 'No transition'}
                  </span>
                )
                return played ? (
                  <div className="tl2-cutfocus-zone absolute pointer-events-none" aria-hidden="true"
                    style={{ left: `${at(cut - played / 2)}%`, width: `max(14px, ${pct(played)}%)`, top: MAIN_PAD, height: BLOCK_H, zIndex: 5 }}>
                    {badge}
                  </div>
                ) : (
                  <div className="tl2-cutfocus-seam absolute pointer-events-none" aria-hidden="true"
                    style={{ left: `${at(cut)}%`, top: MAIN_PAD, height: BLOCK_H, zIndex: 5 }}>
                    {badge}
                  </div>
                )
              })()}
              {/* a transition tile dragged over the timeline: the cut it will land on */}
              {dropCut && (() => {
                const j = junctions.find(x => x.left.id === dropCut)
                if (!j) return null
                return (
                  <div className="absolute pointer-events-none" style={{ left: `${at(j.left.end_ms)}%`, top: 0, bottom: 0, zIndex: 7 }}>
                    <div className="absolute top-0 bottom-0" style={{ left: -1, width: 2, background: ACCENT }} />
                    <span className="absolute whitespace-nowrap text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ top: -2, left: 6, background: ACCENT, color: '#000' }}>Transition at {msToLabel(j.left.end_ms)}</span>
                  </div>
                )
              })()}
              {/* while a grip is dragged: the part's new length, over the grip */}
              {edgeGhost && (() => {
                const seg = mains.find(m => m.id === edgeGhost.id)
                if (!seg) return null
                const len = edgeGhost.edge === 'start' ? seg.end_ms - edgeGhost.to : seg.end_ms - seg.start_ms
                const viewLeftMs = freezeRef.current != null ? (2 - freezeRef.current) / pxPerMs : -Infinity
                const x = edgeGhost.edge === 'start' ? Math.max(edgeGhost.to, viewLeftMs + 40 / Math.max(1e-6, pxPerMs)) : seg.end_ms
                const gain = edgeGhost.edge === 'start' ? seg.start_ms - edgeGhost.to : 0
                return <span className="tl2-trim-tip absolute" style={{ left: `${at(x)}%` }}>{lenLabel(len)}{gain >= 100 ? ` · +${lenLabel(gain)}` : ''}</span>
              })()}
            </div>
            {/* Captions: one block per part, each in its own style — pick one to style it (the Captions
                panel), Split (S) to start a new style at the playhead, drag the edge between two */}
            {captionRow && captionStrip(captionRow)}
            {originals.length > 0 && (
              <div data-lane="original" className="relative" style={{ height: ORIG_ROW_H }}>
                {originals.map(musicBar)}
              </div>
            )}
            {viewMarkers.length > 0 && (
              <div data-lane="views" className="relative" onPointerEnter={() => setViewsHover(true)} onPointerLeave={() => setViewsHover(false)}
                style={{
                  height: VIEW_ROW_H, transition: 'opacity .45s ease',
                  ...(viewsFresh || viewsHover || selectedViewT != null || viewDragT !== null ? {} : { opacity: 0 }),
                }}>
                <div className="absolute left-0 right-0 top-1/2 pointer-events-none" style={{ height: 1, background: 'rgb(var(--ed-fg) / 0.08)' }} />
                {viewDragT !== null && (() => {
                  const cache = videoUrl ? thumbsFor(videoUrl) : undefined
                  const src = cache ? nearestThumb(cache, sourceAt ? sourceAt(viewDragT) : clipStartMs + viewDragT, Math.max(1500, duration / 40)) : undefined
                  return (
                    <div className="absolute pointer-events-none flex flex-col items-center gap-1" style={{ left: `${at(viewDragT)}%`, bottom: 'calc(100% + 6px)', transform: 'translateX(-50%)', zIndex: 60 }}>
                      {src && <img src={src} alt="" draggable={false} style={{ width: 80, height: 56, objectFit: 'cover', borderRadius: 8, boxShadow: `0 0 0 2px ${ACCENT}` }} />}
                      <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums" style={{ background: ACCENT, color: '#111' }}>{msToLabel(viewDragT)}</span>
                    </div>
                  )
                })()}
                {viewMarkers.map((v, i) => {
                  const on = selectedViewT === v.t_ms
                  const first = i === 0
                  const size = on ? 13 : 10
                  return (
                    <Fragment key={`view-${v.t_ms}`}>
                      <button type="button" onPointerDown={e => handleViewDown(e, v.t_ms, first)}
                        onKeyDown={e => {
                          if ((e.key === 'Delete' || e.key === 'Backspace') && !first) { e.preventDefault(); e.stopPropagation(); onRemoveView?.(v.t_ms) }
                          if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); e.stopPropagation(); onDuplicateView?.(v.t_ms) }
                        }}
                        aria-label={`${first ? 'First view' : v.cut ? 'View change' : 'Motion point'} at ${msToLabel(v.t_ms)}${first ? '' : '. Drag to move, Delete to remove'}`}
                        title={`${first ? 'First view' : v.cut ? 'View change (cut)' : 'Motion point (glide)'} · ${msToLabel(v.t_ms)}`}
                        className="absolute top-1/2"
                        style={{
                          left: `${at(v.t_ms)}%`, width: size, height: size, transform: 'translate(-50%, -50%) rotate(45deg)',
                          borderRadius: v.cut || first ? 3 : 999, background: on ? ACCENT : v.cut || first ? 'rgb(var(--ed-fg) / 0.9)' : 'rgb(var(--ed-fg) / 0.5)',
                          border: '1.5px solid rgba(0,0,0,0.7)', cursor: first ? 'pointer' : 'ew-resize', touchAction: 'none', zIndex: on ? 36 : 35,
                        }} />
                      {on && onDuplicateView && (
                        <button type="button" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onDuplicateView(v.t_ms) }}
                          aria-label={`Duplicate the view at ${msToLabel(v.t_ms)}`} title="Duplicate this view (Ctrl+D)"
                          className="absolute top-1/2 flex items-center justify-center rounded-full"
                          style={{ left: `calc(${at(v.t_ms)}% + 10px)`, transform: 'translateY(-50%)', width: 16, height: 16, zIndex: 37, background: ACCENT, color: '#111' }}>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>
                        </button>
                      )}
                      {on && !first && onRemoveView && (
                        <button type="button" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onRemoveView(v.t_ms) }}
                          aria-label={`Remove the view change at ${msToLabel(v.t_ms)}`} title="Remove this view change (Delete)"
                          className="absolute top-1/2 flex items-center justify-center rounded-full"
                          style={{ left: `calc(${at(v.t_ms)}% + ${onDuplicateView ? 30 : 10}px)`, transform: 'translateY(-50%)', width: 16, height: 16, zIndex: 37, background: '#ef4444', color: '#fff', fontSize: 10, lineHeight: 1 }}>✕</button>
                      )}
                    </Fragment>
                  )
                })}
              </div>
            )}
            {snapLine !== null && <div className="absolute pointer-events-none" style={{ left: `${at(snapLine)}%`, top: 0, bottom: 0, width: 0, borderLeft: `1.5px dashed ${ACCENT}`, zIndex: 20 }} />}
            {/* a bar being dragged: where it will play */}
            {/* (a carried bar says where it goes on itself: liftedGhost) */}
          </div>

          {/* Rows under the main video (videos, photos and text, played over it like the rows above) */}
          {(dropAt || belowTracks.length > 0 || trackHover?.target === 'new-below') && (
            <div className="relative flex flex-col" style={{ gap: ROW_GAP, paddingTop: 2, paddingBottom: 2 }}>
              {belowTracks.map(t => trackRow('visual', t, null, visual.filter(v => v.track === t).map(visualBar)))}
              {dropAt && <div data-lane="track-below" className="tl2-dropzone" data-on={dropAt.lane === 'track-below' || undefined} style={{ height: VIS_ROW_H, margin: 0 }} aria-label="A new row below the main video" />}
              {trackHover?.target === 'new-below' && (
                <div className="pointer-events-none rounded-full" aria-hidden="true" style={{ height: 2, background: NEW_ROW_LINE }} />
              )}
            </div>
          )}

          {frameLanes()}

          {/* Music, under the main video */}
          {songs.length > 0 && (
            <div className="relative flex flex-col" style={{ gap: ROW_GAP, paddingTop: 6, paddingBottom: 8 }}>
              {songTracks.map((t, i) => trackRow('audio', t, i === songTracks.length - 1 ? 'bottom' : null, songs.filter(m => (m.track ?? 0) === t).map(musicBar)))}
            </div>
          )}
        </div>

      </div>
        {/* The playhead: in the middle of the view (while a grip is dragged: at the edge being cut) */}
        <div ref={lineRef} className="tl2-playhead" data-snap={snapFlash % 2 ? 'a' : 'b'} aria-hidden="true">
          <span ref={bubbleRef} className="tl2-bubble">{clockLabel(currentTimeMs)}</span>
        </div>
      </div>
    </div>
  )
}
