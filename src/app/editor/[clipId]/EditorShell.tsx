'use client'

import { useFrameAt } from '@/modules/clips/thumbs'
import { InfoTip } from '@/components/ui/info-tip'
import { musicGainAt, speechRangesInVideo, speechRanges, heardSpeech, type Range as SpeechRange } from '@/modules/editor/musicGain'
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
import type { Clip, Segment, CropBox, BoxKeyframe, CaptionStyle, TextOverlay, AudioTrack, Transition, TranscriptWord, LayoutType, Overlay } from '@chai-cut/shared'
import { VideoPreview, OutputCanvas, buildCaptionChunks, captionWordsPerLine, captionDefaultY } from '@/components/editor/VideoPreview'
import { withoutRanges } from '@/lib/cuts'
import { inLineText } from '@/lib/inLine'
import { cleanTrims, trimMap, addTrim, wordsOnTimeline, MAX_CLIP_MS, MIN_CLIP_MS } from '@/lib/trims'
import { toTimelineState, toSourceState, rippleDelete, rippleStretch, lockedInRange, insertAtStart, extendEnd, type TimedState } from '@/modules/editor/trimState'
import { insertsOf, insertedMs, rippleInsert, isInsert, goesAfterMain, piecesOf, piecesLength, videoAtPieces, timelineAtPieces, rippleCut, pieceAt, speedOf, pieceVideoMs, mainFrom } from '@/modules/editor/inserts'
import { PostText, type PostTextValue } from '@/components/clips/PostText'
import { BrollPanel, type StockResult } from '@/components/editor/BrollPanel'
import { VideoPanel, type PanelVideo } from '@/components/editor/VideoPanel'
import { MediaLibrary, type LibraryItem, type MediaSection } from '@/components/editor/MediaLibrary'
import { PhotoSearch } from '@/components/editor/PhotoSearch'
import { MemesPanel } from '@/components/editor/MemesPanel'
import { useBrollSources, useBorrowedSlots } from '@/modules/editor/brollSources'
import { SOUND_DEFAULTS, type SoundItem, type SoundKind } from '@/modules/editor/soundCatalog'
import { Timeline } from '@/components/editor/timeline/Timeline'
import { memoStable } from '@/components/editor/memoStable'
import { useFreeWatermark } from '@/components/editor/watermark'
import { LAYOUT_COLORS, MAX_ZOOM, zoomStep, zoomLabel, STOCK_DRAG_TYPE, type LaneCtl, type LaneCtlKey } from '@/components/editor/SegmentTimeline'
import { useVideoUpload } from '@/modules/upload/useVideoUpload'
import { TranscriptPanel } from '@/components/editor/TranscriptPanel'
import { CaptionStyler } from '@/components/editor/CaptionStyler'
import { TextOverlayPanel } from '@/components/editor/TextOverlayPanel'
import { AudioMixerPanel } from '@/components/editor/AudioMixerPanel'
import { MediaPickerModal } from '@/components/editor/MediaPickerModal'
import { shownSegment, addedVideoBox, isGapPart, isMainShot, STAND_IN_SUFFIX } from '@/modules/editor/visibility'
import { placeInRow, liftToRow, lowerToRow, liftBlock, fillUncovered } from '@/modules/editor/place'
import { splitTargets } from '@/modules/editor/split'
import { AccountMenu } from '@/components/ui/account-menu'
import ThemeSwitch from '@/components/ui/cinematic-theme-switcher'
import { BrandLogo } from '@/components/ui/brand-logo'
import { BrandLoader } from '@/components/ui/brand-loader'
import { SpinningBorderButton } from '@/components/ui/spinning-border-button'
import { FramesPanel } from '@/components/editor/FramesPanel'
import { FrameTextPanel } from '@/components/editor/FrameTextPanel'
import { useConfirm } from '@/components/editor/ConfirmDialog'
import { BrandKitPanel, BrandKitStudio, useBrandKits } from '@/components/editor/BrandKit'
import { useBrandStore, setBrandOn, type BrandOn } from '@/modules/editor/brandState'
import { putBrandOn, takeBrandOff, brandNewFrames, updateBrand, brandChanged, fillBrandCard, type BrandTarget } from '@/modules/brand/engine'
import { EditorBrandMenu } from '@/components/brand/EditorBrandMenu'
import { CleanupPanel, type CleanupRow } from '@/components/editor/CleanupPanel'
import { cleanupCards, isDeleted } from '@/modules/editor/cleanup'
import { brandPalette, brandLockOf, brandTextStyle, brandCaptionLooks, brandCaptionStyle, captionBand, sameEndVideo, type FrameRect, type BrandKit, type BrandTextKind, type ProgressBar } from '@/lib/shared/brandKit'
import { brandTextLook } from '@/modules/editor/textStyle'
import { brandCaptionWords, type BrandWords } from '@/lib/brandWords'
import { lockClipLook, lockHolds, lockSetOf, type LockSet } from '@/lib/shared/brandTeam'
import { BrandCaptionLooks } from '@/components/brand/BrandCaptionLooks'
import { setBrandPalette, setBrandLock } from '@/components/editor/brandPalette'
import { setBrandFonts, ensureBrandFont } from '@/components/editor/brandFonts'
import { EditorTour, hasSeenEditorTour } from '@/components/editor/EditorTour'
import { FrameAddMenu, addChoices, type AddChoice } from '@/components/editor/FrameAddMenu'
import { createFrameMediaPool } from '@/modules/editor/frameMedia'
import { FRAME_TEMPLATES, isFrameLayout, frameOf, mainAudioVolume, mainSlotSound, frameLanes, frameSlotLabels, emptySlotStretches, slotOffers, laneInRowKey, newItemCorners, frameSlotCount, itemAt, isTextLane, textLaneLook, type TextLane } from '@/modules/editor/frames'
import { signOut } from 'next-auth/react'
import { PlatformOverlay, PLATFORM_SAFE, type Platform } from '@/components/editor/PlatformOverlay'
// ── Domain stores ──────────────────────────────────────────────────────────────
import { useEditorStore, MIN_FORMAT_MS, type KeyframeMap } from '@/modules/editor/store'
import { startHistory, undo, redo, useHistory, editableSnapshot, sameEditable, type EditableSnapshot } from '@/modules/editor/history'
import { useGroupStore, cleanGroups, joinGroup, splitGroups, groupOf, type Groups } from '@/modules/editor/groups'
import { usePlayerStore, liveTime, useLiveTimeMs } from '@/modules/player/store'
import { trackPresentedFrame } from '@/modules/player/presentedFrame'
import { useVideoSync } from '@/modules/player/useSync'
import { useCaptionStore } from '@/modules/captions/store'
import { cleanParts, playedParts, playedPartAt, applyLook, lookOf, isLookChange, LOOK_KEYS, type CaptionPart } from '@/modules/captions/parts'
import { CAPTION_TEMPLATES } from '@/modules/captions/templates'
import { useMediaStore } from '@/modules/media/store'
import { rowsToLocal, normalizeCoverage, uncoveredRanges, defaultCropForSlot, msToLabel } from '@/modules/editor/utils'
import { isShot, flattenShots, toSaved, restoreLayers, asMainPart } from '@/modules/editor/shots'
import { applyGroupShots, applyFormatSpans } from '@/modules/editor/groupShots'
import { LAYOUT_SLOT_COUNT } from '@chai-cut/shared'
import { fitsOn, freeTrackIn, settleTracks, savedLanes, type TrackItem, type TrackRef } from '@/modules/editor/tracks'
import { viewChanges } from '@/modules/editor/views'
import { subjectBoxAt, seenShare, followChanges, autoDirectChanges, type SubjectPoint } from '@/modules/editor/subjects'
import { buildKeyframes } from '@/modules/editor/views'
import { frameSlotSize } from '@/modules/editor/frames'
import { getBoxPositionAtLerp, type BoxPosition } from '@/lib/interpolation'
import { SubjectsPanel, type SubjectItem, type AnglesView } from '@/components/editor/SubjectsPanel'
import { angleRows, angleAt, type Angle, type AngleRow } from '@/modules/editor/angles'
import { decideFormat, decideVertical, AUTO_FORMAT, keepsAll, viewsOverlap } from '@/modules/editor/autoFormat'
import type { SegmentLocal, CropBoxLocal, FrameLayout, FrameLane, FrameItem, TransitionType } from '@chai-cut/shared'
import { SPEED_MIN, SPEED_MAX } from '@chai-cut/shared'
import { TransitionsPanel, TRANSITION_DEFAULT_MS, TRANSITION_KINDS, playedTransitionMs, type TransitionJoin } from '@/components/editor/TransitionsPanel'

type Tool = 'format' | 'subjects' | 'frames' | 'captions' | 'transitions' | 'text' | 'media' | 'music' | 'cleanup' | 'post' | 'brand'
/** Media: the user's imported media, or Library (stock footage) */
type MediaFilter = 'all' | 'video' | 'audio' | 'image'
type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'retrying'

interface SegmentRow extends Omit<Segment, never> {
  crop_boxes: (CropBox & { box_keyframes: BoxKeyframe[] })[]
}

interface Props {
  clip: Clip
  videoUrl: string
  words: TranscriptWord[]
  initialSegments: SegmentRow[]
  initialCaptionStyles: CaptionStyle[]
  initialTextOverlays: TextOverlay[]
  initialAudioTracks: AudioTrack[]
  /** Playable links for stored songs, by track id (songs saved before uploads existed have none) */
  initialMusicUrls?: Record<string, string>
  /** The clip's own sound as saved (top of the Music panel) */
  initialOriginalSound?: { volume: number; muted: boolean }
  /** The clip's progress bar as saved (null = none) */
  initialProgressBar?: ProgressBar | null
  /** The brand kit switched on for this clip, and what it changed (clips.brand); null = off */
  initialBrand?: BrandOn | null
  initialTransitions: Transition[]
  initialOverlays: Overlay[]
  /** The clip board it was opened from (the dashboard's AI edit / Manual edit choice), so "Clip board" returns to it */
  backStart?: 'ai' | 'manual'
}

const LAYOUTS: { id: LayoutType; label: string }[] = [
  { id: 'vertical', label: 'Vertical' }, { id: 'split', label: 'Split screen' },
  { id: 'trio', label: 'Trio' }, { id: 'horizontal', label: 'Horizontal' },
]
// Stand-in format for time no format covers: centred Vertical, the same default render.py uses
const PLATFORM_OPTIONS: { id: Platform; label: string; icon: React.ReactNode }[] = [
  { id: 'off', label: 'Off', icon: <><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10 18.5h4" /></> },
  { id: 'instagram', label: 'Reels', icon: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17.5 6.5h.01" /></> },
  { id: 'youtube', label: 'Shorts', icon: <><rect x="2.5" y="5" width="19" height="14" rx="4" /><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" /></> },
]
// Options sidebar width (px): it opens this wide for every tool and stays so until its edge is dragged
// (user, 2026-10-31: the size in their screenshot as the default — room for a scene's faces and Mark as group
// on one line; was 272, then 338)
const OPTIONS_W = 384
// The Preview column's smallest width; it opens as wide as the 9:16 preview needs to fill its height (user,
// 2026-10-31: "so much gap above and below, increase the size"), until its edge is dragged
const PREVIEW_W = 260
/** The preview card's height in widths: the 9:16 video */
const PREVIEW_H_PER_W = 16 / 9
// The editing panel (timeline) opens just as tall as its ruler, the clip's strip and the strip's own
// rows (user, 2026-10-28: the same on every clip, the video and preview never squeezed): rows of
// media, text and music scroll inside it. Dragging the line above the play bar makes it taller for
// that visit; a double-click goes back. Until the timeline has said how tall that is: up to this
const TIMELINE_MAX_H = '28vh'
/** The timeline panel's own padding round the timeline (pt-3 pb-4) */
const TIMELINE_PAD_Y = 28
// How wide the side columns can be dragged
const OPTIONS_RANGE: [number, number] = [220, 520]
const PREVIEW_RANGE: [number, number] = [260, 620]
const DEFAULT_SEG_ID = '__default-format'
const DEFAULT_BOX_ID = '__default-box'
const ACCENT = '#c8ff00'

const TOOLS: { id: Tool; label: string; title: string; hint: string; icon: React.ReactNode }[] = [
  {
    id: 'format', label: 'Format', title: 'Formats',
    hint: 'Pick a layout and it starts at the playhead. Drag the view to reframe — each change is a ◆.',
    icon: <path d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  },
  // (Frames first, Subjects under it: user, 2026-10-30)
  {
    id: 'frames', label: 'Frames', title: 'Frames',
    hint: 'Combine videos, photos and a text letterbox in one reel. Pick a frame for the selected format.',
    icon: <><rect x="6" y="2.5" width="12" height="19" rx="2.5" stroke="currentColor" strokeWidth="1.8" fill="none" /><path d="M6 9.5h12M6 14.5h12" stroke="currentColor" strokeWidth="1.8" fill="none" /></>,
  },
  {
    id: 'subjects', label: 'Subjects', title: 'Subjects',
    hint: 'Mark each person once: the view then switches between them through the whole clip, to whoever is talking. Mark a group shot to keep its format wherever it comes back.',
    icon: <><circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" fill="none" /><path d="M3.5 19.5c.6-3 2.8-5 5.5-5s4.9 2 5.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" /><path d="M16 5.5a3 3 0 010 5.6M18 14.6c1.4.7 2.3 2.4 2.6 4.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" /></>,
  },
  {
    id: 'captions', label: 'Captions', title: 'Captions',
    hint: 'Auto-generated from the audio. Style changes show on the preview straight away.',
    icon: <><rect x="2.5" y="5" width="19" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" fill="none" /><path d="M10 10.2a2.2 2.2 0 100 3.6M17 10.2a2.2 2.2 0 100 3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" /></>,
  },
  {
    id: 'transitions', label: 'Transition', title: 'Transitions',
    hint: 'How one part of the clip gives way to the next: a dissolve, a slide, a wipe… Pick one for each join; it plays in the preview and the export.',
    icon: <><rect x="2.5" y="5" width="8" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none" /><rect x="13.5" y="5" width="8" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none" strokeDasharray="2.4 2" /><path d="M8.5 12h7M13.5 9.5L16 12l-2.5 2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>,
  },
  {
    id: 'text', label: 'Text', title: 'Text',
    hint: 'Add titles, hooks or call-outs on top of the video.',
    icon: <path d="M5 6V4h14v2M12 4v16M9 20h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  },
  {
    id: 'media', label: 'Media', title: 'Media',
    hint: 'Everything you put on top of the clip: your own videos, B-roll (stock footage) and photos. Add them, then set where they play, which part and their sound.',
    icon: <><rect x="2.5" y="6.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none" /><path d="M15.5 10.5l5-2.5v8l-5-2.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none" /><path d="M6 3.5h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>,
  },
  {
    id: 'music', label: 'Music', title: 'Music',
    hint: 'Add background music under your clip and set how loud it is. It gets quieter by itself while someone is talking.',
    icon: <><path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" /><circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" /><circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" /></>,
  },
  {
    id: 'cleanup', label: 'Cleanup', title: 'Remove pauses & filler words',
    hint: 'Cuts long pauses and filler words (um, uh, matlab, ante…) out of the export. Laughs and reaction moments (splits, trios) are kept. The preview plays the full clip.',
    icon: <><circle cx="6" cy="6" r="2.6" stroke="currentColor" strokeWidth="1.8" fill="none" /><circle cx="6" cy="18" r="2.6" stroke="currentColor" strokeWidth="1.8" fill="none" /><path d="M8.2 7.6L20 17M8.2 16.4L20 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" /></>,
  },
  {
    id: 'post', label: 'Post', title: 'Post text',
    hint: 'A title, caption and hashtags to post the clip with. Copy them, or have AI write them again.',
    icon: <path d="M9 4L7 20M17 4l-2 16M4.5 9h16M3.5 15h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />,
  },
  {
    // (user, 2026-10-17) Its workshop takes the video's place in the middle, for more room
    id: 'brand', label: 'Brand kit', title: 'Brand kit',
    hint: 'Your colours, logo, @handle and title style, saved for every clip. Set a kit up, then Apply it to this clip.',
    icon: <><path d="M12 21a9 9 0 110-18 8.5 8.5 0 018.5 8.2c0 2.6-1.8 3.8-3.8 3.8h-1.9a1.9 1.9 0 00-1 3.5A1.9 1.9 0 0112 21z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none" /><circle cx="7.6" cy="11" r="1.3" fill="currentColor" /><circle cx="10.4" cy="7" r="1.3" fill="currentColor" /><circle cx="15.2" cy="7.6" r="1.3" fill="currentColor" /></>,
  },
]

// The timeline redraws only when what it shows changes (memoStable: not on every mouse move of a drag elsewhere)
const StableTimeline = memoStable(Timeline)

/** How Auto format lays the scenes (Subjects tool): every scene Vertical on whoever talks, or the Rulebook's formats */
type AutoMode = 'vertical' | 'cuts'
/** Auto format's mode, the places it laid ([source start ms, source end ms, layout]) and the groups it made */
type AutoRecord = { mode: AutoMode; places: Array<[number, number, string]>; groups: string[] }

export function EditorShell({
  clip: savedClip, videoUrl, words: initialWords, initialSegments,
  initialCaptionStyles, initialTextOverlays, initialAudioTracks, initialTransitions, initialOverlays,
  initialMusicUrls, initialOriginalSound, initialProgressBar, initialBrand, backStart,
}: Props) {
  // (compiled by React's compiler: next.config.ts reactCompiler, annotation mode)
  'use memo'
  // ── Removed parts of the video (lib/trims.ts, modules/editor/trimState.ts) ───
  // The editor works on the clip as it plays. `rawClip` is the clip's stretch of the source video
  // (as saved, or as its start / end was dragged since: clipRange). `clip` is that with the removed
  // parts closed up — it ends where what's left ends, and every time below is timeline time.
  // Nothing removed: the two are the same.
  const trims = useEditorStore(s => s.trims)
  const clipRange = useEditorStore(s => s.clipRange)
  const rawClip = useMemo(
    () => (clipRange ? { ...savedClip, start_ms: clipRange[0], end_ms: clipRange[1] } : savedClip),
    [savedClip, clipRange],
  )
  const trim = useMemo(() => trimMap(trims, rawClip.start_ms, rawClip.end_ms), [trims, rawClip.start_ms, rawClip.end_ms])
  const trimmed = trims.length > 0
  // ── Videos put in between (modules/editor/inserts.ts) ──
  // The main video waits where one goes in and carries on after it: the clip gets that much longer.
  // (Not together with removed parts yet: a clip has one or the other.)
  const storeSegments = useEditorStore(s => s.segments)
  const ownVideoIdForInserts = (savedClip as unknown as { video_id: string }).video_id
  const inserts = useMemo(() => (trimmed ? [] : insertsOf(storeSegments, ownVideoIdForInserts)), [trimmed, storeSegments, ownVideoIdForInserts])
  const hasInserts = inserts.length > 0
  // The clip as pieces (inserts.ts): each part from its own moment of the main video — so a part can
  // skip video (cut from its edge) and an inserted video holds it. Used once the parts don't simply
  // follow the video (a video put in between, or a part cut that way); otherwise the plain clip.
  /**
   * How many rows of videos, photos and text sit under the main video on the timeline (tracks
   * 0 … n-1; the rest are above it). Saved with the clip (layers.below). Stacked as shown: the rows
   * above cover the main video, the main video covers the rows under it (flattenShots).
   */
  const [belowRows, setBelowRows] = useState(() => {
    const n = ((savedClip as unknown as { layers?: { below?: unknown } | null }).layers)?.below
    return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0
  })
  const belowRowsRef = useRef(belowRows)
  belowRowsRef.current = belowRows
  /**
   * The main row as it plays: a part of the main video moved onto a row plays there as a part of
   * the main video — the main row with those laid over it, as the rows stack (flattenShots)
   */
  const mainRowOf = (segs: SegmentLocal[], below = belowRowsRef.current) => {
    const id = ownVideoIdForInserts
    return segs.some(s => isMainShot(s, id)) ? flattenShots(segs.filter(s => !isShot(s, id) || isMainShot(s, id)), id, false, below, rawClip.start_ms) : segs
  }
  // (the space a part left holds the video: its moment is seen where the part is now)
  const allPieces = useMemo(
    () => (trimmed ? [] : piecesOf(mainRowOf(storeSegments, belowRows), ownVideoIdForInserts, s => isShot(s, ownVideoIdForInserts), true)),
    [trimmed, storeSegments, ownVideoIdForInserts, belowRows, rawClip.start_ms], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const piecesOn = hasInserts || allPieces.some(p => p.from != null && Math.abs(p.from - p.at) > 1) || allPieces.some(p => (p.speed ?? 1) !== 1)
  const pieces = useMemo(() => (piecesOn ? allPieces : []), [piecesOn, allPieces])
  const insertsKey = pieces.map(p => `${p.id}:${p.at}+${p.ms}:${p.from ?? ''}@${p.hold ?? ''}x${p.speed ?? 1}`).join(',')
  const clip = useMemo(
    () => (trimmed ? { ...rawClip, end_ms: rawClip.start_ms + trim.lengthMs } : piecesOn ? { ...rawClip, end_ms: rawClip.start_ms + piecesLength(pieces) } : rawClip),
    [rawClip, trimmed, trim.lengthMs, piecesOn, pieces],
  )
  /** The main video's own time (ms) → timeline time; undefined while the clip simply follows the video */
  const videoToTimeline = useMemo(
    () => (trimmed ? trim.toTimeline : piecesOn ? (v: number) => timelineAtPieces(pieces, v - rawClip.start_ms) : undefined),
    [trimmed, trim, piecesOn, pieces, rawClip.start_ms],
  )
  /** Timeline time → the main video's own time (ms); undefined while the clip simply follows the video */
  const timelineToVideo = useMemo(
    () => (trimmed ? trim.toSource : piecesOn ? (t: number) => rawClip.start_ms + videoAtPieces(pieces, t) : undefined),
    [trimmed, trim, piecesOn, pieces, rawClip.start_ms],
  )
  /** Whether this database can save removed parts yet (its backend adds the field when it starts) */
  const canTrim = 'trim_ranges' in (rawClip as object)
  /** Parts are cut out as removed parts of the source (trims): not in a clip of pieces (it cuts its own way) */
  const trimOk = canTrim && !piecesOn
  /** Parts can be cut out (from their edges, Delete) one way or the other */
  const cutOk = trimOk || piecesOn

  // ── Video player ─────────────────────────────────────────────────────────────
  // (an inserted video drives the clock while it plays: it is asked how far it has got — brollSource, below)
  const heldPlayedRef = useRef<(id: string) => number | null | undefined>(() => null)
  const { videoRef, seekToMs, togglePlay, pause } = useVideoSync(rawClip.start_ms, rawClip.end_ms, pieces, trimmed ? trim.kept : undefined,
    piecesOn ? p => (p.id ? heldPlayedRef.current(p.id) : null) : undefined)
  const { currentTimeMs, durationMs, playing } = usePlayerStore()
  // Append media fragment so browser seeks to clip start at network level,
  // preventing a flash of the video's frame 0 on page load / cache hit.
  const clipVideoUrl = videoUrl && savedClip.start_ms > 0
    ? `${videoUrl}#t=${savedClip.start_ms / 1000}`
    : videoUrl

  // ── Domain stores ────────────────────────────────────────────────────────────
  const {
    segments, keyframes, activeSegmentId, activeBoxId,
    hydrate: hydrateEditor, updateSegment, removeSegment,
    splitAtMs, updateBoxSource, applyLayout, setSegmentEdge, addFormat, moveJunction, absorbSection,
    neighbourFraming, joinSameLayoutNeighbours, setViewAt, recordMotionAt, removeViewChange, moveViewChange,
    placeBroll, retimeBroll: retimeShot, removeBroll: removeBrollShot, duplicateViewChange,
    upsertKeyframe, setBoxKeyframes, getPositionAt, updateFrameBand,
    updateFrame, addFrameItem, updateFrameItem, removeFrameItem, splitFrameItem,
    setActiveSegmentId, setActiveBoxId,
  } = useEditorStore()

  const {
    words: sourceWords, captionStyle, captionTextCase, showCaptions, romanize,
    retranscribing, retranscribeElapsed, retranscribeError, retranscribePlace,
    hydrate: hydrateCaptions, setWords, updateWord, updateCaptionStyle,
    setCaptionTextCase, setShowCaptions, setRomanize,
    setRetranscribing, setRetranscribeElapsed, setRetranscribeError, setRetranscribePlace,
  } = useCaptionStore()

  // The words as the brand writes them (brand kit Phase 5: the kit's spellings, its hidden words — set
  // below from the kit on the clip, else the default one). They came that way; this keeps them so live
  // as the kit changes. (Nothing is changed where they're saved: the export spells them the same.)
  const [captionBrandWords, setCaptionBrandWords] = useState<BrandWords | null>(null)
  const brandedWords = useMemo(() => brandCaptionWords(sourceWords, captionBrandWords), [sourceWords, captionBrandWords])
  // Words where they are heard in the clip as it plays (those in removed parts are left out; after
  // a video put in between, later by its length)
  const words = useMemo(
    () => (trimmed ? wordsOnTimeline(brandedWords, trim, rawClip.start_ms, rawClip.end_ms)
      : piecesOn ? brandedWords.flatMap(w => {
        const s0 = w.start_ms - rawClip.start_ms
        if (s0 < 0) return [w]
        // Where the word is heard on the timeline; a word in video cut out is gone
        const mid = (w.start_ms + w.end_ms) / 2 - rawClip.start_ms
        if (!pieces.some(p => p.from != null && mid >= p.from && mid < p.from + pieceVideoMs(p))) return []
        // (both ends: in a part played faster or slower the word is shorter or longer too)
        const a = timelineAtPieces(pieces, s0), b = Math.max(a + 1, timelineAtPieces(pieces, w.end_ms - rawClip.start_ms))
        return a === s0 && b === w.end_ms - rawClip.start_ms ? [w] : [{ ...w, start_ms: rawClip.start_ms + a, end_ms: rawClip.start_ms + b }]
      })
      : brandedWords),
    [brandedWords, trimmed, trim, rawClip.start_ms, rawClip.end_ms, piecesOn, pieces],
  )

  const {
    overlays, textOverlays, audioTracks, transitions, filters, activeOverlayId,
    hydrate: hydrateMedia, setOverlays, setTextOverlays, setAudioTracks, setTransitions,
    setActiveOverlayId, updateOverlay, deleteOverlay,
    updateTextOverlay, deleteTextOverlay,
  } = useMediaStore()

  // Loading the clip changes the stores but isn't an edit: remember the loaded state, and only
  // start auto-saving once the state differs from it (opening a clip must not write anything)
  const loadedStateRef = useRef<EditableSnapshot | null>(null)
  const editedSinceLoadRef = useRef(false)

  // ── Hydrate stores from server props (once on mount) ─────────────────────────
  useEffect(() => {
    // Saved as one row of parts, a video on top (B-roll) cutting the section under it: here the
    // sections are whole again and the videos lie over them (shots.ts)
    const ownVideoId = (savedClip as unknown as { video_id: string }).video_id
    const restored = restoreLayers(rowsToLocal(initialSegments), (savedClip as unknown as { layers?: unknown }).layers, ownVideoId)
    // (videos put in between make the clip longer than its stretch of the video)
    const lenMs = Math.max(savedClip.end_ms - savedClip.start_ms + insertedMs(insertsOf(restored.segments, ownVideoId)), ...restored.segments.map(s => s.end_ms))
    const localSegments = [
      // (time no part covers gets a Vertical part of its own: no "default framing" anywhere)
      ...fillUncovered(normalizeCoverage(restored.segments.filter(s => !isShot(s, ownVideoId)), lenMs), lenMs, ownVideoId),
      ...restored.segments.filter(s => isShot(s, ownVideoId)).map(s => ({ ...s, end_ms: Math.min(s.end_ms, lenMs) })).filter(s => s.end_ms - s.start_ms >= 100),
    ].sort((a, b) => a.start_ms - b.start_ms)
    const initialKeyframeMap: KeyframeMap = {}
    for (const seg of localSegments) {
      for (const box of seg.crop_boxes) {
        const kfs = box.keyframes?.length ? box.keyframes : [{ t_ms: seg.start_ms, ...defaultCropForSlot(seg.layout as LayoutType, box.slot_index) }]
        initialKeyframeMap[box.id] = kfs.map(k => ({ id: (k as { id?: string }).id ?? crypto.randomUUID(), box_id: box.id, t_ms: k.t_ms, x: k.x, y: k.y, w: k.w, h: k.h })) as typeof initialKeyframeMap[string]
      }
    }
    // A transition after a part that was joined back into its section stays with that section
    const loadedTransitions = initialTransitions
      .map(t => (restored.renamed[t.after_segment_id] ? { ...t, after_segment_id: restored.renamed[t.after_segment_id] } : t))
      .filter((t, i, all) => all.findIndex(x => x.after_segment_id === t.after_segment_id) === i)
    // Saved in source clip time; shown with the removed parts closed up
    const savedTrims = cleanTrims((savedClip as unknown as { trim_ranges?: unknown }).trim_ranges, savedClip.start_ms, savedClip.end_ms)
    let loaded: TimedState = {
      segments: localSegments, keyframes: initialKeyframeMap,
      overlays: initialOverlays, textOverlays: initialTextOverlays, audioTracks: initialAudioTracks, transitions: loadedTransitions,
    }
    if (savedTrims.length) loaded = toTimelineState(loaded, trimMap(savedTrims, savedClip.start_ms, savedClip.end_ms), savedClip.start_ms)
    // Tracks (as in CapCut, tracks.ts): videos on top, photos and text share the visual tracks,
    // music has its own. Each goes back on the track it was saved on.
    {
      const lanes = savedLanes((savedClip as unknown as { layers?: unknown }).layers)
      const vis = settleTracks([
        ...loaded.segments.filter(s => isShot(s, ownVideoId)).map(s => ({ id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, track: s.track ?? 0 })),
        ...loaded.overlays.filter(o => o.type === 'image').map(o => ({ id: o.id, start_ms: o.start_ms, end_ms: o.end_ms })),
        ...loaded.textOverlays.map(o => ({ id: o.id, start_ms: o.start_ms, end_ms: o.end_ms })),
      ], lanes)
      // Music keeps its saved track (a song's own length isn't known yet); music saved without one gets the lowest with room
      const songs = loaded.audioTracks.filter(t => !isMainAudio(t))
        .map((t): TrackItem => ({ id: t.id, start_ms: t.start_ms, end_ms: t.end_ms ?? lenMs, ...(lanes[t.id] != null ? { track: lanes[t.id] } : {}) }))
      const aud: Record<string, number> = {}
      const placed = songs.filter(t => t.track != null)
      for (const t of placed) aud[t.id] = t.track!
      for (const t of songs.filter(x => x.track == null).sort((a, b) => a.start_ms - b.start_ms)) {
        aud[t.id] = freeTrackIn(placed, t.start_ms, t.end_ms)
        placed.push({ ...t, track: aud[t.id] })
      }
      loaded = {
        ...loaded,
        segments: loaded.segments.map(s => (isShot(s, ownVideoId) && vis[s.id] != null && (s.track ?? 0) !== vis[s.id] ? { ...s, track: vis[s.id] } : s)),
        overlays: loaded.overlays.map(o => (vis[o.id] != null ? { ...o, track: vis[o.id] } : o)),
        textOverlays: loaded.textOverlays.map(o => (vis[o.id] != null ? { ...o, track: vis[o.id] } : o)),
        audioTracks: loaded.audioTracks.map(t => (aud[t.id] != null ? { ...t, track: aud[t.id] } : t)),
      }
    }
    hydrateEditor(loaded.segments, loaded.keyframes, savedTrims, ownVideoId)

    // Captions on/off: the saved choice when the clip has a caption style; a clip without one yet
    // starts with captions on if it has words (a style saved before the on/off field counts as on)
    const savedStyle = initialCaptionStyles[0]
    // Off until switched on (captions cost money to make); a clip with a saved style keeps its choice
    const showCaptions = savedStyle ? savedStyle.enabled !== false : false
    hydrateCaptions(initialWords, savedStyle ?? { color: '#FFE700' }, showCaptions)
    // Caption parts, each in its own look (captions/parts.ts), saved beside the rows
    useCaptionStore.getState().setCaptionParts(cleanParts((savedClip as unknown as { layers?: { captionParts?: unknown } | null }).layers?.captionParts, lenMs))
    useCaptionStore.getState().pickCaptionPart(null)

    hydrateMedia({
      overlays: loaded.overlays,
      textOverlays: loaded.textOverlays,
      audioTracks: loaded.audioTracks,
      transitions: loaded.transitions,
    })

    // The clip as loaded: the auto-save stays quiet until the state differs from this
    setBrandOn(initialBrand ?? null)
    // Its groups on the timeline (groups.ts), saved beside the rows
    useGroupStore.setState({ groups: cleanGroups((savedClip as unknown as { layers?: { groups?: unknown } | null }).layers?.groups) })
    loadedStateRef.current = editableSnapshot()

    // Undo/redo records from here on: the loaded clip is the starting point
    const stopHistory = startHistory()
    return () => { stopHistory(); useEditorStore.getState().reset() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Local UI state (not shared across components) ─────────────────────────────
  const [activeTextOverlayId, setActiveTextOverlayId] = useState<string | null>(null)
  const videoStatus = (clip as unknown as { video_status?: string }).video_status
  // Captions are on their way while a caption job for this video is waiting/running (e.g. the
  // whole-video job right after upload) and this clip doesn't have its words yet
  const captionsPending = !!(clip as unknown as { captions_pending?: boolean }).captions_pending
  // (lists from the server are in the video's own time: the saved clip's stretch)
  const clipHasWords = (list: { start_ms: number }[]) => list.some(w => w.start_ms >= rawClip.start_ms && w.start_ms < rawClip.end_ms)
  const [transcribing, setTranscribing] = useState(
    !clipHasWords(initialWords) && (captionsPending || (videoStatus !== 'ready' && videoStatus !== 'failed'))
  )
  const [isFreePlan, setIsFreePlan] = useState(false)
  /** The Free plan's watermark shows on the preview, where the export will put it */
  const showWatermark = useFreeWatermark()
  const [tool, setTool] = useState<Tool>('subjects')
  // The Transition tiles' two pictures of this clip (a quarter and two thirds in), read in the background soon
  // after the editor opens — not when the tool opens, which showed blank tiles for a moment (user, 2026-10-31).
  // (a second and a half in, so the preview's own video loads first; at once if Transitions opens before that)
  const [trFramesOn, setTrFramesOn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setTrFramesOn(true), 1500); return () => clearTimeout(t) }, [])
  const trFrameMs = useMemo<[number, number]>(() => {
    const len = rawClip.end_ms - rawClip.start_ms
    return [rawClip.start_ms + Math.round(len * 0.25), rawClip.start_ms + Math.round(len * 0.68)]
  }, [rawClip.start_ms, rawClip.end_ms])
  const trFrameA = useFrameAt(trFramesOn || tool === 'transitions' ? videoUrl : null, trFrameMs[0])
  const trFrameB = useFrameAt(trFramesOn || tool === 'transitions' ? videoUrl : null, trFrameMs[1])
  /** The picture on the preview right now (the editor's own video, already loaded), for the tiles until theirs are in */
  const grabPreviewFrame = useCallback(() => {
    const v = videoRef.current
    if (!v || !v.videoWidth || v.readyState < 2) return null
    try {
      const c = document.createElement('canvas')
      c.width = 192; c.height = Math.max(1, Math.round((192 * v.videoHeight) / v.videoWidth))
      c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height)
      return c.toDataURL('image/jpeg', 0.7)
    } catch { return null }
  }, [videoRef])
  // The editor always opens the same way — a new clip, a refresh, or coming from any board: the
  // tool rail with the options panel closed (a tool opens it), the video, the Preview column on the
  // right at its usual width (Off) and the timeline at its usual height. Sizes dragged while editing
  // last for that visit only; nothing about the layout is remembered.
  const [optionsOpen, setOptionsOpen] = useState(false)
  // The brand kit's workshop (in the video's place): open when the tool opens; its X or Done closes it, Edit kit
  // opens it again. Closing the options sidebar leaves it open
  const [kitStudio, setKitStudio] = useState(true)
  useEffect(() => { if (tool === 'brand') setKitStudio(true) }, [tool])
  // What was open before the Brand kit (user, 2026-10-28: closing it goes back there — Brand kit isn't on
  // the rail any more, so nothing else would close its panel)
  const beforeBrandRef = useRef<{ tool: Tool; open: boolean }>({ tool: 'subjects', open: false })
  const lastToolRef = useRef<{ tool: Tool; open: boolean }>({ tool: 'subjects', open: false })
  useEffect(() => {
    if (tool === 'brand') { if (lastToolRef.current.tool !== 'brand') beforeBrandRef.current = lastToolRef.current }
    lastToolRef.current = { tool, open: optionsOpen }
  }, [tool, optionsOpen])
  // The Preview column on the right: can be closed for more room to edit
  const [previewOpen, setPreviewOpen] = useState(true)
  // Full view: the preview big, to check it properly. The browser's fullscreen when it allows it,
  // else over the whole editor window (fullViewFallback)
  const fullViewRef = useRef<HTMLDivElement>(null)
  const [fullView, setFullView] = useState(false)
  const [fullViewFallback, setFullViewFallback] = useState(false)
  async function openFullView() {
    setFullView(true)
    try {
      await fullViewRef.current?.requestFullscreen()
      setFullViewFallback(false)
    } catch {
      setFullViewFallback(true)
    }
  }
  function closeFullView() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    setFullView(false); setFullViewFallback(false)
  }
  useEffect(() => {
    // Esc (or the browser's own exit) leaves fullscreen: leave full view with it
    const onChange = () => { if (!document.fullscreenElement) { setFullView(false); setFullViewFallback(false) } }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  useEffect(() => {
    // Over the window (no fullscreen): Esc leaves it too
    if (!fullViewFallback) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeFullView() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [fullViewFallback]) // eslint-disable-line react-hooks/exhaustive-deps
  // Widths of the two side columns, dragged at their inner edge (this visit only)
  const [optionsW, setOptionsW] = useState(OPTIONS_W)
  const [previewW, setPreviewW] = useState(PREVIEW_W)
  // The Preview column follows its height (the phone fills it, no gap above or below) until its edge is
  // dragged; a double-click on the edge goes back to that
  const [previewFit, setPreviewFit] = useState(true)
  const previewBodyRef = useRef<HTMLDivElement>(null)
  const [resizing, setResizing] = useState<'options' | 'preview' | 'timeline' | null>(null)
  // The timeline's height, dragged at the line above the play bar (null = its usual size; this visit only)
  const [timelineH, setTimelineH] = useState<number | null>(null)
  // How tall the timeline is with just its ruler and the clip's strip (Timeline onBaseHeight)
  const [timelineBaseH, setTimelineBaseH] = useState<number | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Sizes an older version remembered in this browser: gone, so every visit opens the usual way
    try { for (const k of ['editor.timelineH', 'editor.optionsW', 'editor.previewW', 'editor.platformPreview']) localStorage.removeItem(k) } catch { /* storage blocked */ }
  }, [])
  /** Drag the line between the video and the play bar: up makes the timeline taller, down the video bigger */
  function startTimelineResize(e: React.PointerEvent) {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const y0 = e.clientY
    const h0 = timelineRef.current?.offsetHeight ?? 220
    const max = Math.round(window.innerHeight * 0.7)
    let h = h0
    setResizing('timeline')
    const move = (ev: PointerEvent) => { h = Math.round(Math.max(90, Math.min(max, h0 + (y0 - ev.clientY)))); setTimelineH(h) }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setResizing(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  function resetTimelineHeight() { setTimelineH(null) }
  /** Drag a side column's inner edge to resize it; double-click puts its usual width back */
  function startColumnResize(e: React.PointerEvent, which: 'options' | 'preview') {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const x0 = e.clientX
    const w0 = which === 'options' ? optionsW : previewW
    const [lo, hi] = which === 'options' ? OPTIONS_RANGE : PREVIEW_RANGE
    let w = w0
    setResizing(which)
    if (which === 'preview') setPreviewFit(false)
    const move = (ev: PointerEvent) => {
      // The options column grows to the right, the preview column to the left
      const d = which === 'options' ? ev.clientX - x0 : x0 - ev.clientX
      w = Math.round(Math.max(lo, Math.min(hi, w0 + d)))
      if (which === 'options') setOptionsW(w); else setPreviewW(w)
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setResizing(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  function resetColumn(which: 'options' | 'preview') {
    if (which === 'options') setOptionsW(OPTIONS_W); else setPreviewFit(true)
  }
  // While the Brand kit's workshop is open the preview keeps its size: the workshop tucks the timeline away,
  // the Preview's body grew taller and the card with it (user, 2026-10-31). Set from studioShown below
  const previewFrozenRef = useRef(false)
  // Fitted: the column as wide as the 9:16 card is at the full height of the Preview's body (its height
  // doesn't depend on the column's width, so this settles at once), within PREVIEW_RANGE
  useEffect(() => {
    const el = previewBodyRef.current
    if (!previewFit || !el) return
    const fit = () => {
      if (previewFrozenRef.current) return
      const cs = getComputedStyle(el)
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
      const cardW = (el.clientHeight - padY) / PREVIEW_H_PER_W
      if (!(cardW > 0)) return
      const [lo, hi] = PREVIEW_RANGE
      setPreviewW(Math.round(Math.max(lo, Math.min(hi, cardW + padX))))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [previewFit])

  // First-time tour: opens once the page has settled; the header's "?" replays it
  const [tourOpen, setTourOpen] = useState(false)
  useEffect(() => {
    if (hasSeenEditorTour()) return
    const t = setTimeout(() => setTourOpen(true), 900)
    return () => clearTimeout(t)
  }, [])
  const [editingTranscript, setEditingTranscript] = useState(false)
  const [pickerAtMs, setPickerAtMs] = useState<number | null>(null)
  // The "+" menu opens the picker for one kind only (a video or a photo)
  const [pickerOnly, setPickerOnly] = useState<'video' | 'photo' | null>(null)
  // A text just added from the "+" menu: its box in the Text panel takes focus to type into
  const [focusTextId, setFocusTextId] = useState<string | null>(null)
  // A text just added: typed in right on the preview (or in the Text panel when the preview is closed)
  const [editTextId, setEditTextId] = useState<string | null>(null)
  // Hidden file input for "+" → Music, and where that music goes
  const musicInputRef = useRef<HTMLInputElement>(null)
  const musicAtRef = useRef<number | 'end'>(0)
  // Frames: the selected lane item (or `main:<slot>`), the "+" menu, and the media picker filling a lane
  const [activeFrameItemId, setActiveFrameItemId] = useState<string | null>(null)
  const [laneHighlight, setLaneHighlight] = useState<{ lane: FrameLane; n: number; focusPlus?: boolean; openMenu?: boolean } | null>(null)
  const [addMenu, setAddMenu] = useState<{ segId: string; lane: FrameLane; t: number; anchor: DOMRect } | null>(null)
  const [framePicker, setFramePicker] = useState<{ segId: string; kind: 'video' | 'photo'; lane?: FrameLane; t?: number; replaceId?: string } | null>(null)
  const [videoLibrary, setVideoLibrary] = useState<Record<string, { url: string; title: string; duration_ms?: number | null; stock?: boolean }>>({})
  const videoLibraryRef = useRef(videoLibrary)
  videoLibraryRef.current = videoLibrary
  const framePool = useMemo(() => createFrameMediaPool(id => videoLibraryRef.current[id]?.url), [])
  useEffect(() => () => framePool.dispose(), [framePool])
  async function loadVideoLibrary() {
    const res = await fetch('/api/videos?assets=1').catch(() => null)
    if (!res?.ok) return videoLibraryRef.current
    const { videos } = await res.json() as { videos: { id: string; title?: string | null; video_url?: string | null; index?: number; duration_ms?: number | null; is_asset?: boolean; is_upload_asset?: boolean }[] }
    // stock: footage saved from Pexels / Pixabay (an asset that wasn't uploaded) — B-roll, not one of the user's videos
    const lib = Object.fromEntries(videos.filter(v => v.video_url).map(v => [v.id, {
      url: v.video_url!, title: v.title?.trim() || `Video ${v.index ?? ''}`.trim(), duration_ms: v.duration_ms ?? null,
      stock: !!v.is_asset && !v.is_upload_asset,
    }]))
    videoLibraryRef.current = lib
    setVideoLibrary(lib)
    return lib
  }
  useEffect(() => { loadVideoLibrary() }, [])
  const videoTitles = useMemo(() => Object.fromEntries(Object.entries(videoLibrary).map(([id, v]) => [id, v.title])), [videoLibrary])
  // (the main video too: a part of it moved onto a row shows its pictures there)
  const videoUrls = useMemo(() => ({ [ownVideoIdForInserts]: videoUrl, ...Object.fromEntries(Object.entries(videoLibrary).map(([id, v]) => [id, v.url])) }), [videoLibrary, ownVideoIdForInserts, videoUrl])
  /** Each video's full length, where known: a video on top can't be trimmed past its own ends */
  const videoLengths = useMemo(() => Object.fromEntries(Object.entries(videoLibrary).flatMap(([id, v]) => (v.duration_ms ? [[id, v.duration_ms]] : []))), [videoLibrary])
  // B-roll shots are drawn from their own videos in the preview (muted; the speaker carries on)
  const mainVideoId = (clip as unknown as { video_id: string }).video_id
  // `segments` holds the sections (they frame the main video and never overlap) AND the videos
  // put on top of them (B-roll: layers, see shots.ts). `playParts` is the clip as it plays: each
  // section cut where a video plays over it — what the preview draws and what is saved.
  const sections = useMemo(() => segments.filter(s => !isShot(s, mainVideoId)), [segments, mainVideoId])
  const shots = useMemo(() => segments.filter(s => isShot(s, mainVideoId)).sort((a, b) => a.start_ms - b.start_ms), [segments, mainVideoId])
  const playParts = useMemo(() => flattenShots(segments, mainVideoId, false, belowRows, rawClip.start_ms), [segments, mainVideoId, belowRows, rawClip.start_ms])
  /** The gaps deleted parts left in the main row (timeline ms): no captions there */
  // (but where a part of the main video on a row plays there, its words are heard: the room the
  // main row leaves up to such a part is no gap of its own, flattenShots, and has no words)
  const gapRanges = useMemo(() => {
    const over = segments.filter(s => isMainShot(s, mainVideoId) && !s.crop_boxes[0]?.hidden)
    return segments.filter(s => isGapPart(s, mainVideoId)).flatMap(s => {
      let left: (readonly [number, number])[] = [[s.start_ms, s.end_ms]]
      for (const o of over) left = left.flatMap(([a, b]) => (o.end_ms <= a || o.start_ms >= b ? [[a, b] as const] : [[a, o.start_ms] as const, [o.end_ms, b] as const].filter(([x, y]) => y > x)))
      return left
    })
  }, [segments, mainVideoId])

  // ── Transitions: where one section of the main strip ends exactly where the next begins ──
  const transitionJoins = useMemo<TransitionJoin[]>(() => {
    const byTime = [...sections].sort((a, b) => a.start_ms - b.start_ms)
    const name = (sg: SegmentLocal) => isFrameLayout(sg.layout) ? `Frame · ${FRAME_TEMPLATES[sg.layout].name}` : LAYOUTS.find(l => l.id === sg.layout)?.label ?? sg.layout
    // Both sides one continuous shot, framed the same: the main video carrying straight on, the same
    // layout and every slot where it was — a blend of two (almost) identical pictures
    const toVideo = (t: number) => (timelineToVideo ? timelineToVideo(t) : clip.start_ms + t)
    const own = (sg: SegmentLocal) => sg.crop_boxes.every(bx => !bx.source_video_id || bx.source_video_id === mainVideoId)
    const sameShot = (a: SegmentLocal, b: SegmentLocal, at: number) => {
      if (a.layout !== b.layout || isFrameLayout(a.layout) || !own(a) || !own(b) || a.crop_boxes.length !== b.crop_boxes.length) return false
      // (one side hidden is black: a blend into it shows)
      if (!!a.hidden !== !!b.hidden) return false
      if (Math.abs(toVideo(at) - toVideo(at - 1) - 1) > 80) return false
      return a.crop_boxes.every((bx, k) => {
        const p = getPositionAt(bx.id, at - 1), q = getPositionAt(b.crop_boxes[k].id, at)
        return Math.abs(p.x - q.x) + Math.abs(p.y - q.y) + Math.abs(p.w - q.w) + Math.abs(p.h - q.h) < 0.04
      })
    }
    // (the empty room after a part: a stretch left where a part went to a row, or the hidden tail)
    const empty = (sg: SegmentLocal) => isGapPart(sg, mainVideoId) || (isInsert(sg, mainVideoId) && !!sg.hidden && !!sg.crop_boxes[0]?.hidden)
    // A video on a row starting just where a part ends, with only empty room after the part on the
    // main row: the export plays the two one after the other (render.py takes every part and video
    // on a row as one sequence in time order), so a transition goes between them — the video stays
    // on its row
    const rowVideoAt = (t: number) => shots.find(sh => !sh.crop_boxes[0]?.hidden && Math.abs(sh.start_ms - t) <= 1)
    const out: TransitionJoin[] = []
    for (let i = 0; i < byTime.length; i++) {
      const a = byTime[i], next = byTime[i + 1]
      const touching = next && Math.abs(next.start_ms - a.end_ms) <= 1 ? next : null
      const onRow = !empty(a) && (!touching || empty(touching)) ? rowVideoAt(a.end_ms) : undefined
      const b = onRow ?? touching
      if (!b) continue
      // (a transition plays no longer than either part: the export's rule, render.py _transition_joins)
      const lenA = Math.round(a.end_ms) - Math.round(a.start_ms), lenB = Math.round(b.end_ms) - Math.round(b.start_ms)
      out.push({ afterId: a.id, at: a.end_ms, from: name(a), to: onRow ? 'Video' : name(b), sameShot: !onRow && sameShot(a, b, a.end_ms),
        room: Math.min(lenA, lenB), shortSide: lenA <= lenB ? 'before' : 'after' })
    }
    return out
  }, [sections, shots, keyframes, timelineToVideo, mainVideoId, clip.start_ms]) // eslint-disable-line react-hooks/exhaustive-deps
  /** What the preview plays at each join that has a transition (timeline ms): as long as the export
   *  plays it there, and none where that's too short to show */
  const transitionCuts = useMemo(() => transitionJoins.flatMap(j => {
    const tr = transitions.find(t => t.after_segment_id === j.afterId)
    const ms = tr && tr.type !== 'cut' ? playedTransitionMs(tr.duration_ms || TRANSITION_DEFAULT_MS, j.room) : 0
    return tr && ms > 0 ? [{ at: j.at, ms, type: tr.type }] : []
  }), [transitionJoins, transitions])
  /** A join's transition picked (or its length changed): 'cut' takes it away */
  function setTransitionAt(afterId: string, type: TransitionType, durationMs: number) {
    setTransitions(prev => {
      const rest = prev.filter(t => t.after_segment_id !== afterId)
      if (type === 'cut') return rest
      const had = prev.find(t => t.after_segment_id === afterId)
      return [...rest, { id: had?.id ?? crypto.randomUUID(), clip_id: clip.id, after_segment_id: afterId, type, duration_ms: Math.round(durationMs) }]
    })
  }
  /** A cut's kind on every cut (its marker's menu): each cut with a transition keeps its own length,
   *  one without takes this cut's length */
  function applyTransitionToAll(afterId: string) {
    const src = transitions.find(t => t.after_segment_id === afterId)
    if (!src || src.type === 'cut') return
    for (const j of transitionJoins) {
      const had = transitions.find(t => t.after_segment_id === j.afterId)
      setTransitionAt(j.afterId, src.type, had && had.type !== 'cut' ? (had.duration_ms || TRANSITION_DEFAULT_MS) : (src.duration_ms || TRANSITION_DEFAULT_MS))
    }
  }
  /** A tile from the Transitions panel dropped on a cut on the timeline: that cut gets it (keeping its
   *  length if it had one; None takes it away), the panel shows that cut, and it plays */
  function dropTransition(afterId: string, type: string) {
    const j = transitionJoins.find(x => x.afterId === afterId)
    if (!j || !TRANSITION_KINDS.some(k => k.type === type)) return
    const had = transitions.find(t => t.after_segment_id === afterId)
    const len = had && had.type !== 'cut' ? (had.duration_ms || TRANSITION_DEFAULT_MS) : TRANSITION_DEFAULT_MS
    setTransitionAt(afterId, type as TransitionType, len)
    setTransitionFocus({ id: afterId, n: Date.now() })
    if (type !== 'cut') previewJoin(j.at, playedTransitionMs(len, j.room))
  }
  /**
   * A transition picked with no join at the playhead: the part of the clip there is split at the
   * playhead (as S does) and the new join gets that transition. The left half keeps its id, so it
   * is the section before the join.
   */
  const canAddTransitionAt = (seg: SegmentLocal | undefined, ms: number) => !!seg && ms > seg.start_ms + 100 && ms < seg.end_ms - 100
  function addTransitionHere(type: TransitionType) {
    const seg = activeSegment
    if (!seg || !canAddTransitionAt(seg, currentTimeMs) || sectionBlocked(seg.id)) return
    pause()
    skipCanvasTransitionRef.current = true
    if (!splitAtMs(seg.id, currentTimeMs, getPositionAt)) return
    setTransitionAt(seg.id, type, TRANSITION_DEFAULT_MS)
    // (and it plays at once, so what was picked is seen — as long as the two new halves let it)
    previewJoin(currentTimeMs, playedTransitionMs(TRANSITION_DEFAULT_MS, Math.min(currentTimeMs - seg.start_ms, seg.end_ms - currentTimeMs)))
  }
  /**
   * "Preview" on a join: the preview opens and plays the clip from a moment before it. It waits a
   * moment first, so the preview has the transition's held frames ready (OutputCanvas stills).
   */
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function previewJoin(at: number, durationMs: number) {
    pause()
    togglePreview(true)
    seekToMs(Math.max(0, at - durationMs / 2 - 1200))
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => { previewTimer.current = null; if (!usePlayerStore.getState().playing) togglePlay() }, 500)
  }
  // (with videos put in between, the clip's clock runs the added videos: the main video waits during one)
  const brollSource = useBrollSources(videoRef, clip.start_ms, id => videoLibraryRef.current[id]?.url, mainVideoId, videoToTimeline,
    hasInserts || pieces.some(p => p.hold != null) ? () => ({ ms: liveTime.get(), playing: usePlayerStore.getState().playing }) : undefined)
  heldPlayedRef.current = id => {
    const seg = useEditorStore.getState().segments.find(s => s.id === id)
    // The empty stretch after the main video has no video of its own to follow (its box only names
    // one of the videos running on there — following that one ran the clock away): real time runs it
    // (nor has the empty space a part left: piecesOf gapsHold)
    if (seg && ((isInsert(seg, mainVideoId) && seg.hidden && seg.crop_boxes[0]?.hidden) || isGapPart(seg, mainVideoId))) return undefined
    // (no part of the editor's own: the room up to a part of the main video on a row, flattenShots)
    return seg ? brollSource.playedMs(seg) : undefined
  }
  // Borrowed reaction slots (Make my clips): the clip's own video from another moment, per slot
  const borrowed = useBorrowedSlots(videoRef, clip.start_ms, mainVideoId, videoUrl, videoToTimeline)
  const [pendingBrollMs, setPendingBrollMs] = useState<number | null>(null)
  const [clipStatus, setClipStatus] = useState<string>(clip.status)
  const [outputUrl, setOutputUrl] = useState<string | null>(clip.output_url)
  const [exporting, setExporting] = useState(false)
  // Remove pauses and filler words (the cut is made by the export; see src/lib/cuts.ts)
  const [removeFillers, setRemoveFillersState] = useState(!!(clip as Clip & { remove_fillers?: boolean }).remove_fillers)
  const removeFillersRef = useRef(removeFillers)
  // Words to post the clip with (AI clips come with them; any clip can have them written)
  const [postText, setPostText] = useState<PostTextValue>(() => {
    const c = clip as Clip & { title?: string | null; post_caption?: string | null; hashtags?: string[] | null }
    return { title: c.title ?? null, post_caption: c.post_caption ?? null, hashtags: c.hashtags ?? null }
  })
  const [exportError, setExportError] = useState<string | null>(null)
  // What exports have always been rendered at (the worker ignored the 2160p asked for here)
  const renderQuality = '1080p' as const
  const [renderStuckSince, setRenderStuckSince] = useState<number | null>(clip.status === 'rendering' ? Date.now() : null)
  const [renderElapsed, setRenderElapsed] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  /** The transition button between two parts on the timeline: the Transition tool opens on that cut */
  const [transitionFocus, setTransitionFocus] = useState<{ id: string; n: number } | null>(null)
  /** The cut the Transition tool's controls are on (its section id): marked on the timeline */
  const [transitionShown, setTransitionShown] = useState<string | null>(null)
  /** The last save had to keep newer transitions as a Dissolve (the database doesn't take them yet) */
  const [trAsDissolve, setTrAsDissolve] = useState(false)
  const [motionMode, setMotionMode] = useState(false)
  // The timeline always opens at 1x, the whole clip across it (zoom in with + or a pinch)
  const [timelineZoom, setTimelineZoom] = useState(1)
  const [timelineHidden, setTimelineHidden] = useState(false)
  // The kit's workshop open: the timeline tucked away for its room (the ⌃ in the timeline bar brings it
  // back); closed, the timeline as it was (user, 2026-10-28)
  const studioShown = tool === 'brand' && kitStudio
  // (before the timeline is tucked away below, so the preview doesn't follow that height)
  useLayoutEffect(() => { previewFrozenRef.current = studioShown }, [studioShown])
  const timelineBeforeStudio = useRef<boolean | null>(null)
  useEffect(() => {
    if (studioShown) {
      if (timelineBeforeStudio.current === null) { timelineBeforeStudio.current = timelineHidden; setTimelineHidden(true) }
    } else if (timelineBeforeStudio.current !== null) {
      setTimelineHidden(timelineBeforeStudio.current)
      timelineBeforeStudio.current = null
    }
  }, [studioShown]) // eslint-disable-line react-hooks/exhaustive-deps
  /** The kit's workshop closed: back to what was open before the Brand kit */
  function closeKitStudio() {
    setKitStudio(false)
    const was = beforeBrandRef.current
    setTool(was.tool === 'brand' || was.tool === 'format' ? 'subjects' : was.tool)
    setOptionsOpen(was.open && was.tool !== 'brand')
  }
  // Esc closes it (not while typing in a field of it)
  useEffect(() => {
    if (!studioShown) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      // (a field being typed in, or a menu / dialog open: Esc is theirs first)
      if (t?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"]')) return
      closeKitStudio()
    }
    // (before the editor's other Esc handlers, which let go of what's picked)
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [studioShown]) // eslint-disable-line react-hooks/exhaustive-deps
  // Cleanup: the list of cuts can be folded away
  const [cutsOpen, setCutsOpen] = useState(true)
  // Lengths of music files added in this session (read from the file), so their timeline bars
  // show the right length; tracks without one run to the clip's end
  const [musicDurations, setMusicDurations] = useState<Record<string, number>>({})
  // The main video's own sound (top of the Music panel): applied to the preview here, saved with
  // the clip and used by the export
  const [originalVolume, setOriginalVolume] = useState(initialOriginalSound?.volume ?? 1)
  const [originalMuted, setOriginalMuted] = useState(initialOriginalSound?.muted ?? false)
  const originalSoundRef = useRef({ volume: originalVolume, muted: originalMuted })
  const originalLoadedRef = useRef(true)
  useEffect(() => {
    originalSoundRef.current = { volume: originalVolume, muted: originalMuted }
    if (originalLoadedRef.current) { originalLoadedRef.current = false; return }
    // A change is saved like any other edit (2.5 s later)
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    unsavedRef.current = true
    editVersionRef.current++
    autoSaveTimerRef.current = setTimeout(() => latestHandleSaveRef.current(), 2500)
  }, [originalVolume, originalMuted]) // eslint-disable-line react-hooks/exhaustive-deps
  // The clip's progress bar (Brand kit panel; a kit with one puts it on: modules/brand/engine.ts): drawn on the preview,
  // saved with the clip, drawn by the export (render.py)
  const [progressBar, setProgressBar] = useState<ProgressBar | null>(initialProgressBar ?? null)
  // The brand kit switched on for this clip (modules/editor/brandState.ts)
  const brandOn = useBrandStore(st => st.on)
  const progressBarRef = useRef(progressBar)
  const progressLoadedRef = useRef(true)
  useEffect(() => {
    progressBarRef.current = progressBar
    if (progressLoadedRef.current) { progressLoadedRef.current = false; return }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    unsavedRef.current = true
    editVersionRef.current++
    autoSaveTimerRef.current = setTimeout(() => latestHandleSaveRef.current(), 2500)
  }, [progressBar]) // eslint-disable-line react-hooks/exhaustive-deps
  // A muted section (its own sound off): the video is silent while the playhead is in it
  const [sectionMuted, setSectionMuted] = useState(false)
  // The frame sound sync sets the main video's volume every frame, so the level goes through it
  // (it multiplies each frame's own slot sound); mute is the element's own switch
  useEffect(() => {
    framePool.setMainGain(originalVolume)
    const v = videoRef.current
    if (!v) return
    v.volume = Math.max(0, Math.min(1, originalVolume))
    v.muted = originalMuted || sectionMuted
  }, [originalVolume, originalMuted, sectionMuted]) // framePool never changes (made once), so it isn't a dependency
  // Music heard in the preview: one <audio> per track added in this session, playing the picked
  // file in step with the video (tracks loaded from a saved clip have no file here yet)
  const musicEls = useRef(new Map<string, HTMLAudioElement>())
  // Stored songs' playable links, songs still uploading or whose upload failed, and the last message
  const [musicUrls, setMusicUrls] = useState<Record<string, string>>(initialMusicUrls ?? {})
  const [musicUploads, setMusicUploads] = useState<Record<string, 'uploading' | 'failed'>>({})
  const [musicNotice, setMusicNotice] = useState<string | null>(null)
  /** Stores a picked song (any audio, or a video's sound; up to 20 MB) */
  async function uploadMusicFile(f: File): Promise<{ storage_path: string; url: string }> {
    const form = new FormData()
    form.append('file', f)
    const res = await fetch('/api/audio/upload', { method: 'POST', body: form })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'The song could not be uploaded')
    return data
  }
  /** Plays a song file in the preview (and learns its length for the timeline bar) */
  function attachMusicEl(id: string, src: string) {
    const old = musicEls.current.get(id)
    if (old) { old.pause(); if (old.src.startsWith('blob:')) URL.revokeObjectURL(old.src) }
    const a = new Audio()
    a.preload = 'auto'
    a.onloadedmetadata = () => { if (isFinite(a.duration)) setMusicDurations(d => ({ ...d, [id]: Math.round(a.duration * 1000) })) }
    a.src = src
    musicEls.current.set(id, a)
    return a
  }
  function sendMusic(id: string, f: File) {
    setMusicUploads(u => ({ ...u, [id]: 'uploading' }))
    uploadMusicFile(f).then(({ storage_path, url }) => {
      setAudioTracks(prev => prev.map(t => t.id === id ? { ...t, storage_path } : t))
      setMusicUrls(m => ({ ...m, [id]: url }))
      setMusicUploads(u => { const n = { ...u }; delete n[id]; return n })
    }).catch((e: unknown) => {
      setMusicUploads(u => ({ ...u, [id]: 'failed' }))
      setMusicNotice(e instanceof Error ? e.message : 'The song could not be uploaded')
    })
  }
  const MAX_MUSIC_MB = 20
  function musicTooBig(f: File) {
    if (f.size <= MAX_MUSIC_MB * 1024 * 1024) return false
    setMusicNotice(`Music files can be up to ${MAX_MUSIC_MB} MB. Pick a smaller file or a shorter song.`)
    return true
  }
  /** "Re-add this song": a song saved before uploads existed (or whose upload failed) gets its file */
  function readdMusic(id: string, f: File) {
    if (musicTooBig(f)) return
    setMusicNotice(null)
    attachMusicEl(id, URL.createObjectURL(f))
    sendMusic(id, f)
  }
  function addMusicTrack(f: File, at?: number | 'end') {
    if (musicTooBig(f)) return
    setMusicNotice(null)
    const id = crypto.randomUUID()
    // The music starts where the playhead is (where you paused), not at the start of the clip —
    // or where the "+" menu says: the start, or so that it ends with the clip
    const startMs = typeof at === 'number' ? at : at === 'end' ? 0 : Math.max(0, Math.round(currentTimeMs))
    // The whole song plays from there (to the clip's end at most): drag its ends on the timeline to trim it
    const sectionEnd: number | undefined = undefined
    // Fades on by default (the buttons switch them off); the name stands in until the upload is stored
    setAudioTracks(prev => [...prev, { id, clip_id: clip.id, storage_path: f.name, start_ms: startMs, ...(sectionEnd !== undefined ? { end_ms: sectionEnd } : {}), volume: 0.5, duck_under_speech: true, fade_in: true, fade_out: true }])
    sendMusic(id, f)
    const a = attachMusicEl(id, URL.createObjectURL(f))
    a.onloadedmetadata = () => {
      if (!isFinite(a.duration)) return
      const lenMs = Math.round(a.duration * 1000)
      setMusicDurations(d => ({ ...d, [id]: lenMs }))
      if (at === 'end') {
        const start = Math.max(0, clip.end_ms - clip.start_ms - lenMs)
        setAudioTracks(prev => prev.map(t => t.id === id ? { ...t, start_ms: start } : t))
      } else {
        // It stops where the song ends, or at the clip's end
        const clipLen = clip.end_ms - clip.start_ms
        setAudioTracks(prev => prev.map(t => t.id === id ? { ...t, end_ms: Math.min(clipLen, t.start_ms + lenMs) } : t))
      }
    }
  }
  // Stored songs (a saved clip, or after "Re-add") play from storage
  useEffect(() => {
    for (const t of audioTracks) {
      if (isMainAudio(t) || musicEls.current.has(t.id) || !musicUrls[t.id]) continue
      attachMusicEl(t.id, musicUrls[t.id])
    }
  }, [audioTracks, musicUrls]) // eslint-disable-line react-hooks/exhaustive-deps
  // Where the voice is actually heard (clip time): music dips only there, as in the export — not
  // while the original sound is muted, in muted sections, under a B-roll's own sound, in a frame
  // whose main video is silent; with the sound detached, where its bars play
  const speech = useMemo(() => {
    const originals = audioTracks.filter(isMainAudio)
    const span = (s: { start_ms: number; end_ms: number }): SpeechRange => [s.start_ms, s.end_ms]
    return heardSpeech({
      // Detached sound bars play the video's own file: the words in the video's own time
      speechInVideo: speechRangesInVideo(sourceWords, rawClip.start_ms, rawClip.end_ms),
      ...(trimmed || piecesOn ? { speechInClip: speechRanges(words, clip.start_ms, clip.end_ms) } : {}),
      clipStartMs: clip.start_ms, clipLenMs: clip.end_ms - clip.start_ms,
      originals: originals.length ? originals : null,
      mainVolume: originalMuted ? 0 : originalVolume,
      mutedSections: playParts.filter(s => s.muted).map(span),
      quietSections: playParts.filter(s => isFrameLayout(s.layout)
        ? mainAudioVolume(frameOf(s)) <= 0
        : addedVideoBox(s, mainVideoId)?.muted === false).map(span),
    })
  }, [words, sourceWords, trimmed, hasInserts, piecesOn, clip.start_ms, clip.end_ms, audioTracks, originalMuted, originalVolume, playParts, mainVideoId]) // eslint-disable-line react-hooks/exhaustive-deps
  // Keep every track's audio in step with the playhead: play while the playhead is inside it,
  // re-sync if it drifts, pause otherwise; follow each track's volume
  // (every frame while playing, from the live time: the editor itself redraws only now and then)
  const syncMusic = (t: number, isPlaying: boolean) => {
    const muteHere = sectionMutedAt(t)
    for (const [id, el] of musicEls.current) {
      const tr = audioTracks.find(x => x.id === id)
      if (!tr) {
        el.pause(); musicEls.current.delete(id)
        if (![...musicEls.current.values()].some(o => o.src === el.src)) URL.revokeObjectURL(el.src)
        continue
      }
      // Volume, fades and the dip under speech — the same rules as the export's mix
      el.volume = isMainAudio(tr) && muteHere ? 0 : musicGainAt(tr, t, musicDurations[id], speech, clipLengthMs)
      const local = (t - tr.start_ms + (tr.offset_ms ?? 0)) / 1000
      const stop = tr.end_ms ?? Infinity
      const inside = t >= tr.start_ms && t < stop && (!isFinite(el.duration) || local < el.duration)
      if (isPlaying && inside) {
        if (el.paused || Math.abs(el.currentTime - local) > 0.6) el.currentTime = local
        if (el.paused) el.play().catch(() => {})
      } else if (!el.paused) {
        el.pause()
      }
    }
  }
  const syncMusicRef = useRef(syncMusic)
  syncMusicRef.current = syncMusic
  useEffect(() => { syncMusic(liveTime.get(), playing) }, [playing, currentTimeMs, audioTracks, sectionMuted, musicDurations, speech]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => liveTime.subscribe(() => { if (usePlayerStore.getState().playing) syncMusicRef.current(liveTime.get(), true) }), [])
  useEffect(() => () => { for (const el of musicEls.current.values()) { el.pause(); URL.revokeObjectURL(el.src) } }, [])
  // Format panel: sections whose "what's in it" list is open, the kind of item shown, and the list
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set())
  const [sectionFilter, setSectionFilter] = useState<'all' | SectionItemKind>('all')
  // Format panel: layout groups (Vertical, Split screen, Trio) that are unfolded; all start folded shut
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())
  const sectionListRef = useRef<HTMLDivElement>(null)
  // Picking a photo, text or music (timeline, preview or its panel) opens its settings on the left
  const openSettings = (t: Tool) => { setTool(t); toggleOptions(true) }
  // Media: the library (Import ▸ Media, or Library = stock footage), and the item whose settings
  // are open over it (picked on the timeline, or just added)
  const [mediaSection, setMediaSection] = useState<MediaSection>('media')
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all')
  const openMedia = (section: MediaSection, filter?: MediaFilter) => {
    setMediaSection(section); if (filter) setMediaFilter(filter); openSettings('media')
  }
  // (`open` false: select only — a single click on the timeline doesn't open the sidebar)
  // One thing is picked at a time — a section, a video on top, a photo, a text or music: picking
  // one lets go of the others, so Hide / Mute / Lock, Trim and Delete are always about what was
  // picked last (they used to act on an earlier pick that was still held: bug #5)
  /** A photo picked (timeline, preview): selected — moved, resized and turned on the preview, trimmed on the timeline (no settings page) */
  function pickPhoto(id: string, _open = true) { setActiveOverlayId(id); setActiveTextOverlayId(null); setPickedSegIdState(null); setPickedMusicId(null); setLastPick('overlay') }
  // A picked photo or video on top lets go when anything else is clicked — not the photo itself on
  // the preview, its bar on the timeline, the timeline's buttons that act on it (Split, Delete,
  // Hide, Mute, Lock…, and a row's own eye / sound / lock) or a dialog (Delete asks first)
  useEffect(() => {
    if (!activeOverlayId) return
    const id = activeOverlayId
    const away = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (!t || !t.isConnected || !t.closest) return
      if (t.closest(`[data-photo-id="${id}"], [data-item-id="${id}"], .ed-tl-btn, .lane-ctl, .tl2-row-ctl, [role="dialog"], [role="alertdialog"]`)) return
      setActiveOverlayId(null)
    }
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [activeOverlayId]) // eslint-disable-line react-hooks/exhaustive-deps
  function pickText(id: string, open = true) { setActiveTextOverlayId(id); setActiveOverlayId(null); setPickedSegIdState(null); setPickedMusicId(null); setLastPick('text'); if (open) openSettings('text') }
  function pickMusicTrack(id: string, open = true) { pickMusic(id); if (open) openSettings('music') }
  // Timeline clicks select; the same thing clicked again quickly (a double tap) opens its settings
  const lastTapRef = useRef<{ key: string; at: number } | null>(null)
  function doubleTap(key: string) {
    const now = performance.now(), last = lastTapRef.current
    lastTapRef.current = { key, at: now }
    return !!last && last.key === key && now - last.at < 450
  }
  // "Locked" note: a short message when an edit is refused because something is locked
  const [lockNote, setLockNote] = useState<string | null>(null)
  const lockNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function notifyLocked(msg: string, ms = 2200) {
    if (quietRef.current) return   // (a live drag: told once, on release)
    setLockNote(msg)
    if (lockNoteTimer.current) clearTimeout(lockNoteTimer.current)
    lockNoteTimer.current = setTimeout(() => setLockNote(null), ms)
  }
  // The section the user clicked (on the timeline strip or its card): the Delete buttons show only then
  const [pickedSegId, setPickedSegIdState] = useState<string | null>(null)
  // Music track selected on the timeline (Trim / Delete act on it). Only one thing is selected:
  // picking a video section clears the music, a photo and a text, and the other way round
  const [pickedMusicId, setPickedMusicId] = useState<string | null>(null)
  // Several things picked on the timeline at once (a box dragged over them, or Ctrl / Shift + click):
  // videos and photos on rows, text, music. They move together; Delete takes them all (one undo step)
  const [groupPick, setGroupPick] = useState<string[]>([])
  // Groups made of them (as Resolve's Link Clips): picked and moved as one from then on (groups.ts)
  const groups = useGroupStore(st => st.groups)
  const setPickedSegId = (id: string | null) => {
    setPickedSegIdState(id); setPickedMusicId(null)
    if (id) { setActiveOverlayId(null); setActiveTextOverlayId(null); setLastPick('section') }
  }
  const pickMusic = (id: string) => { setPickedSegIdState(null); setActiveOverlayId(null); setActiveTextOverlayId(null); setPickedMusicId(id); setLastPick('music') }
  // What was picked last (on the timeline, the preview or a panel): the Delete button and key act on it
  const [lastPick, setLastPick] = useState<'music' | 'overlay' | 'text' | 'section' | 'frameItem' | null>(null)
  // Export press: the download animation plays first, then the render starts (see .ed-export in globals.css)
  const [exportPress, setExportPress] = useState(false)
  function pressExport() {
    if (exportPress) return
    setExportPress(true)
    setTimeout(() => { setExportPress(false); requestExport() }, 750)
  }
  // Click counters that replay each toolbar button's own animation (keys remount the icon)
  const [formatPlay, setFormatPlay] = useState<{ id: LayoutType; n: number } | null>(null)
  const [splitPlay, setSplitPlay] = useState(0)
  const motionModeRef = useRef(false)
  useEffect(() => { motionModeRef.current = motionMode }, [motionMode])

  const retranscribeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unsavedRef = useRef(false)
  // Saves run one at a time: an edit made during a save queues exactly one more save after it
  const saveInFlightRef = useRef<Promise<void> | null>(null)
  const saveAgainRef = useRef(false)
  // A dropped connection (or a DB hiccup) retries on its own: 2s, 4s, 8s … up to 30s
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelayRef = useRef(2000)
  const editVersionRef = useRef(0)
  const latestHandleSaveRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const skipCanvasTransitionRef = useRef(false)

  // ── Derived values ────────────────────────────────────────────────────────────
  // The part under the playhead, or null where there is none. At the very end of the clip the
  // part that ends there still counts.
  const clipLengthMs = clip.end_ms - clip.start_ms
  const partAt = (parts: SegmentLocal[], t: number) => {
    const byTime = [...parts].sort((a, b) => a.start_ms - b.start_ms)
    return byTime.find(s => t >= s.start_ms && t < s.end_ms)
      ?? byTime.find(s => s.end_ms >= clipLengthMs && t >= clipLengthMs && s.start_ms < clipLengthMs)
      ?? null
  }
  // The next video coming up (an inserted video, a video on top): loaded and parked on its first
  // frame 2.5 s ahead, so it plays at once at the join instead of stalling there
  const preparePartsRef = useRef(playParts)
  preparePartsRef.current = playParts
  // …and, while playing, started (muted) just before its turn so it's already running in step at the join
  useEffect(() => {
    let last: string | null = null
    let rolled: SegmentLocal | null = null
    return liveTime.subscribe(() => {
      const t = liveTime.get()
      const playing = usePlayerStore.getState().playing
      const next = preparePartsRef.current
        .filter(s => s.start_ms > t && s.start_ms - t <= 2500 && addedVideoBox(s, mainVideoId))
        .sort((a, b) => a.start_ms - b.start_ms)[0]
      // (stopped just before the join: back to parked on its first frame)
      if (rolled && (!playing || rolled.id !== next?.id)) { if (!playing) brollSource.prepare(rolled); rolled = null }
      if (!next) return
      if (next.id !== last) { last = next.id; brollSource.prepare(next) }
      if (playing && !rolled && next.start_ms - t <= 400) { rolled = next; brollSource.preroll(next, next.start_ms - t) }
    })
  }, [brollSource, mainVideoId])
  // What plays here: a video on top, else the section (default framing where no format is set)
  const playingSegment = useMemo(() => partAt(playParts, currentTimeMs), [playParts, currentTimeMs, clipLengthMs]) // eslint-disable-line react-hooks/exhaustive-deps
  // The section here, whatever lies over it: formats, views, frames and trims are about it
  const playingSection = useMemo(() => partAt(sections, currentTimeMs), [sections, currentTimeMs, clipLengthMs]) // eslint-disable-line react-hooks/exhaustive-deps
  const playingAdded = playingSegment ? addedVideoBox(playingSegment, mainVideoId) : null
  const brollSoundOn = !!playingAdded && playingAdded.muted === false
  useEffect(() => { setSectionMuted(!!playingSegment?.muted || brollSoundOn) }, [playingSegment?.muted, brollSoundOn])
  // The editor redraws ~10 times a second (the player store): the main video's sound switches
  // exactly where a muted section (or a video with its own sound) starts, from the live time
  const liveMuteRef = useRef({ parts: playParts, original: originalMuted, partAt })
  liveMuteRef.current = { parts: playParts, original: originalMuted, partAt }
  useEffect(() => liveTime.subscribe(() => {
    const v = videoRef.current
    if (!v) return
    const m = liveMuteRef.current.original || sectionMutedAt(liveTime.get())
    if (v.muted !== m) v.muted = m
  }), [mainVideoId]) // eslint-disable-line react-hooks/exhaustive-deps
  /** The main video's own sound is off at clip time `t`: its section is muted, or a video on top plays its own sound there */
  function sectionMutedAt(t: number): boolean {
    const { parts, partAt: at } = liveMuteRef.current
    const part = at(parts, t)
    const added = part ? addedVideoBox(part, mainVideoId) : null
    return !!part?.muted || (!!added && added.muted === false)
  }
  // Uncovered stretch under the playhead, if any (not the room after the last part: empty, no
  // default framing there — what's on the rows reaches past the main row)
  const currentGap = useMemo(() => {
    if (playingSection) return null
    const rowEnd = Math.max(0, ...sections.map(s => s.end_ms))
    return uncoveredRanges(sections, clipLengthMs).find(g => g.start_ms < rowEnd - 1 && currentTimeMs >= g.start_ms && currentTimeMs <= g.end_ms) ?? null
  }, [playingSection, sections, clipLengthMs, currentTimeMs])
  // Selection follows the playhead: selecting a format seeks to it, so the crop boxes,
  // layout buttons, timeline highlight and preview always talk about the same format.
  // (the empty space a deleted part left is no part: no layout, nothing to frame or change there)
  const inGap = !!playingSection && isGapPart(playingSection, mainVideoId)
  const activeSegment = (inGap ? null : playingSection) ?? undefined
  useEffect(() => {
    if (playingSection && playingSection.id !== activeSegmentId) setActiveSegmentId(playingSection.id)
  }, [playingSection, activeSegmentId, setActiveSegmentId])

  const hasRoman = words.some(w => w.word_roman)
  const scriptLabel = useMemo(() => {
    const sample = words.find(w => w.word.trim())?.word ?? ''
    if (/[ఀ-౿]/.test(sample)) return 'Tenglish'
    if (/[ऀ-ॿ]/.test(sample)) return 'Hinglish'
    if (/[஀-௿]/.test(sample)) return 'Tanglish'
    if (/[ಀ-೿]/.test(sample)) return 'Kanglish'
    if (/[ഀ-ൿ]/.test(sample)) return 'Manglish'
    if (/[ঀ-৿]/.test(sample)) return 'Banglish'
    return 'Romanize'
  }, [words])
  const displayWords = useMemo(
    // source_word keeps the original punctuation so the preview can break lines at sentence ends
    () => romanize ? words.map(w => ({ ...w, word: w.word_roman ?? w.word, source_word: w.word })) : words,
    [words, romanize],
  )
  const clipDurationMs = (clip.end_ms - clip.start_ms) || durationMs || 1
  const clipTitle = (clip as unknown as { title?: string | null }).title?.trim() || 'Untitled clip'
  const videoId = (clip as unknown as { video_id: string }).video_id
  const videoTitle = (clip as unknown as { video_title?: string | null }).video_title?.trim() || 'Video'
  const clipBoardHref = backStart ? `/videos/${videoId}?start=${backStart}` : `/videos/${videoId}`

  // Crop positions in playback order — sort_order drifts from time order after splits and B-roll inserts
  const cropPositions = useMemo(
    () => sections.filter(s => s.end_ms - s.start_ms > 50).sort((a, b) => a.start_ms - b.start_ms),
    [sections],
  )
  // (not the room after the last part: it's empty, what's on the rows reaches past the main row)
  const uncovered = useMemo(() => {
    const rowEnd = Math.max(0, ...sections.map(s => s.end_ms))
    return uncoveredRanges(sections, clipLengthMs).filter(g => g.start_ms < rowEnd - 1)
  }, [sections, clipLengthMs])

  function getVideoAR() {
    const v = videoRef.current
    return v && v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : undefined
  }

  // What the canvases show: the format under the playhead, or the default framing in a gap
  const defaultFormat = useMemo<SegmentLocal | null>(() => currentGap ? {
    id: DEFAULT_SEG_ID, start_ms: currentGap.start_ms, end_ms: currentGap.end_ms, layout: 'vertical', sort_order: -1,
    crop_boxes: [{ id: DEFAULT_BOX_ID, slot_index: 0, source_video_id: null, source_offset_ms: currentGap.start_ms, keyframes: [] }],
  } : null, [currentGap])
  // As the export shows it: a hidden added video gives way to the main video, hidden frame items
  // aren't drawn, a hidden main video is black
  const shownPlaying = useMemo(() => playingSegment ? shownSegment(playingSegment, mainVideoId, getVideoAR()) : null, [playingSegment, mainVideoId]) // eslint-disable-line react-hooks/exhaustive-deps
  const viewSegment = shownPlaying ?? defaultFormat
  /**
   * What the canvases show at a clip time, worked out from the exact time (they ask every frame;
   * the editor itself redraws only a few times a second): the same as viewSegment, but never late
   * where one section (or a video on top) gives way to the next.
   */
  const viewAt = useMemo(() => {
    const shown = new WeakMap<SegmentLocal, SegmentLocal>()
    const gaps = new Map<string, SegmentLocal>()
    return (ms: number): SegmentLocal | null => {
      const part = partAt(playParts, ms)
      if (part) {
        let s = shown.get(part)
        if (!s) {
          const ar = getVideoAR()
          s = shownSegment(part, mainVideoId, ar)
          if (ar) shown.set(part, s)  // (kept once the video's shape is known: a stand-in's framing needs it)
        }
        return s
      }
      const gap = uncovered.find(g => ms >= g.start_ms && ms <= g.end_ms)
      if (!gap) return null
      const key = `${gap.start_ms}-${gap.end_ms}`
      let g = gaps.get(key)
      if (!g) {
        g = {
          id: DEFAULT_SEG_ID, start_ms: gap.start_ms, end_ms: gap.end_ms, layout: 'vertical', sort_order: -1,
          crop_boxes: [{ id: DEFAULT_BOX_ID, slot_index: 0, source_video_id: null, source_offset_ms: gap.start_ms, keyframes: [] }],
        } as SegmentLocal
        gaps.set(key, g)
      }
      return g
    }
  }, [playParts, uncovered, mainVideoId, clipLengthMs]) // eslint-disable-line react-hooks/exhaustive-deps
  const viewGetPositionAt = useMemo(
    () => (boxId: string, t: number) => boxId === DEFAULT_BOX_ID || boxId.endsWith(STAND_IN_SUFFIX) ? defaultCropForSlot('vertical', 0, getVideoAR()) : getPositionAt(boxId, t),
    [getPositionAt], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Free plan: lock captions, stop spinner
  useEffect(() => {
    fetch('/api/billing/plan')
      .then(r => r.json())
      .then((d: { autoCaption?: boolean }) => {
        if (d.autoCaption === false) {
          setIsFreePlan(true)
          setTranscribing(false)
        }
      })
      .catch(() => {})
  }, [])

  // ── Polls ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!transcribing || isFreePlan) return
    const videoId = (clip as unknown as { video_id: string }).video_id
    const interval = setInterval(async () => {
      // (only this clip's own caption job keeps it waiting)
      const res = await fetch(`/api/transcribe/words?video_id=${videoId}&clip_id=${clip.id}`)
      if (!res.ok) return
      const { words: newWords, video_status: vs, pending } = await res.json()
      if (newWords && clipHasWords(newWords)) {
        setWords(newWords)
        setShowCaptions(true)
        setTranscribing(false)
        clearInterval(interval)
      } else if (!pending && (vs === 'ready' || vs === 'failed')) {
        // Nothing left running: show whatever exists (e.g. a clip with no speech)
        if (newWords?.length) setWords(newWords)
        setTranscribing(false)
        clearInterval(interval)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [transcribing, isFreePlan, clip, setWords, setShowCaptions])

  const refreshWordsOnDoneRef = useRef(false)

  useEffect(() => {
    if (clipStatus !== 'rendering') { setRenderStuckSince(null); setRenderElapsed(0); return }
    const startedAt = renderStuckSince ?? Date.now()
    if (!renderStuckSince) setRenderStuckSince(startedAt)
    const tick = setInterval(() => setRenderElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    const poll = setInterval(async () => {
      const res = await fetch(`/api/clips/${clip.id}/status`)
      if (!res.ok) return
      const data = await res.json()
      setClipStatus(data.status)
      if (data.output_url) setOutputUrl(data.output_url)
      if (data.status === 'done' && refreshWordsOnDoneRef.current) {
        refreshWordsOnDoneRef.current = false
        const videoId = (clip as unknown as { video_id: string }).video_id
        fetch(`/api/transcribe/words?video_id=${videoId}`).then(r => r.ok ? r.json() : null)
          .then(d => { if (d?.words?.length) setWords(d.words) }).catch(() => {})
      }
      if (data.status === 'failed') setExportError('Render failed. Try exporting again.')
      if (data.status !== 'rendering') clearInterval(poll)
    }, 3000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [clip.id, clipStatus])

  // ── Auto-save: trigger 2.5 s after any meaningful edit ───────────────────────

  useEffect(() => {
    if (!editedSinceLoadRef.current) {
      const loaded = loadedStateRef.current
      if (!loaded || sameEditable(editableSnapshot(), loaded)) return
      editedSinceLoadRef.current = true
    }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    unsavedRef.current = true
    editVersionRef.current++
    autoSaveTimerRef.current = setTimeout(() => latestHandleSaveRef.current(), 2500)
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, keyframes, trims, clipRange, captionStyle, textOverlays, audioTracks, transitions, filters, overlays, brandOn, groups])

  // The social media preview: Off each time the editor opens (part of its usual layout)
  const [platform, setPlatform] = useState<Platform>('off')
  /**
   * Add a video, photo, song or text at a time (the playhead): from a sub timeline (its icon or its
   * empty row). A video or photo lasts 5 s, text 3 s (moved back to fit before the clip's end);
   * music plays until the section ends.
   */
  function addMediaAt(kind: 'video' | 'broll' | 'photo' | 'music' | 'text' | 'insert' | 'pip' | 'overlay', atMs: number) {
    pause()
    // Overlay: the next video or photo picked in Media goes on top here (a video full screen; the
    // switch on the toolbar makes it a window)
    if (kind === 'overlay') {
      const t = Math.max(0, Math.min(Math.round(atMs), clipLengthMs - 500))
      setInsertAtMs(null); setPipAtMs(null)
      setOverlayAtMs(t)
      seekToMs(t)
      openMedia('media', 'all')
      return
    }
    // Music & sound: its tool (add a file, the sound library), from the playhead
    if (kind === 'music') {
      seekToMs(Math.max(0, Math.min(atMs, clipLengthMs - 50)))
      openSettings('music')
      return
    }
    // Picture in picture: the next video picked in Media goes in a small window over the clip here
    if (kind === 'pip') {
      const t = Math.max(0, Math.min(Math.round(atMs), clipLengthMs - 500))
      setInsertAtMs(null)
      setPipAtMs(t)
      seekToMs(t)
      openMedia('media', 'video')
      return
    }
    // Insert: the next video picked in Media goes in here, in between (insertVideo)
    if (kind === 'insert') {
      const t = Math.max(0, Math.min(Math.round(atMs), clipLengthMs))
      setPipAtMs(null); setOverlayAtMs(null)
      setInsertAtMs(t)
      seekToMs(Math.min(t, clipLengthMs - 1))
      openMedia('media', 'video')
      return
    }
    // B-roll: stock footage is searched for in its panel, then added at the playhead
    if (kind === 'broll') { seekToMs(Math.max(0, Math.min(atMs, clipLengthMs - 50))); openMedia('library'); return }
    const t = Math.max(0, Math.min(atMs, clipLengthMs - 50))
    // Videos and photos: picked in the Media library, then added at the playhead (+ or drag)
    if (kind === 'video' || kind === 'photo') { seekToMs(t); openMedia('media', kind === 'photo' ? 'image' : 'video'); return }
    const len = Math.min(3000, clipLengthMs)
    const start = Math.max(0, Math.min(t, clipLengthMs - len))
    const id = crypto.randomUUID()
    setTextOverlays(prev => [...prev, {
      id, clip_id: clip.id, text: 'Your text', start_ms: start, end_ms: start + len,
      x: 0.1, y: 0.4, font: 'sans-serif', size: 72, color: '#ffffff',
      // (with a brand kit: in its title style — brand kit Phase 3)
      ...(styleKit ? brandTextLook(brandTextStyle(styleKit.data, 'title')) : {}),
    }])
    setActiveTextOverlayId(id)
    if (previewOpen) setEditTextId(id); else setFocusTextId(id)
    seekToMs(start)
    setTool('text'); toggleOptions(true)
  }
  function togglePreview(open: boolean) { setPreviewOpen(open) }
  function toggleOptions(open: boolean) { setOptionsOpen(open) }


  // ── Save / export ─────────────────────────────────────────────────────────────

  // Two saves writing the same clip at once can collide (one deletes a format the other is still
  // writing) — so never overlap them. Callers get a promise that resolves once everything is saved.
  // Resolves true when the latest save succeeded
  const lastSaveOkRef = useRef(true)
  function handleSave(): Promise<void> {
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null }
    if (saveInFlightRef.current) { saveAgainRef.current = true; return saveInFlightRef.current }
    const run = async () => {
      do { saveAgainRef.current = false; lastSaveOkRef.current = await saveOnce() } while (saveAgainRef.current)
    }
    saveInFlightRef.current = run().finally(() => { saveInFlightRef.current = null })
    return saveInFlightRef.current
  }

  async function saveOnce(): Promise<boolean> {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaveState('saving')
    const version = editVersionRef.current
    // Read fresh state imperatively — avoids stale closure in auto-save ref
    const editor = useEditorStore.getState()
    const { captionStyle } = useCaptionStore.getState()
    const media = useMediaStore.getState()
    const { filters } = media
    // The editor holds timeline time; a clip is saved in source clip time, with what was removed
    let state: TimedState = {
      segments: editor.segments, keyframes: editor.keyframes,
      overlays: media.overlays, textOverlays: media.textOverlays, audioTracks: media.audioTracks, transitions: media.transitions,
    }
    // (the clip's start and end as they are now: they may have been dragged)
    const range = editor.clipRange ?? [savedClip.start_ms, savedClip.end_ms]
    if (editor.trims.length) state = toSourceState(state, trimMap(editor.trims, range[0], range[1]), range[0])
    const { segments, keyframes, overlays, textOverlays, audioTracks, transitions } = state
    // A video on top (B-roll) is a layer here; a clip is saved as one row of parts that never
    // overlap, which the export and the clip board read (shots.ts)
    const saved = toSaved(segments.map(s => ({
      ...s,
      crop_boxes: s.crop_boxes.map(b => ({ ...b, keyframes: (keyframes[b.id] ?? b.keyframes ?? []).map(({ t_ms, x, y, w, h }) => ({ t_ms, x, y, w, h })) })),
    })), mainVideoId, belowRowsRef.current, range[0])
    // (the brand as sent: once saved, it's what the server has — brand kit Phase 2, the clip board check below)
    const sentBrand = useBrandStore.getState().on
    try {
      const res = await fetch(`/api/clips/${clip.id}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments: saved.rows,
          layers: withGroupsSaved(withCaptionParts(withLanes(saved.layers, [...overlays, ...textOverlays, ...audioTracks], belowRowsRef.current), useCaptionStore.getState().captionParts),
            cleanGroups(useGroupStore.getState().groups, id => editor.segments.some(s => s.id === id) || [...overlays, ...textOverlays, ...audioTracks].some(x => x.id === id))),
          captionStyle, textOverlays, audioTracks, transitions, filters,
          // A photo on a higher track is drawn over one on a lower track (the export orders photos by z_index)
          overlays: overlays.map(o => (o.type === 'image' && o.track != null ? { ...o, z_index: o.track + 1 } : o)),
          ...(canTrim ? { trims: editor.trims } : {}),
          // Always the clip's start and end as they are now (an undo back to how it loaded must be saved too;
          // the server only writes a change)
          ...(canTrim ? { range } : {}),
          removeFillers: removeFillersRef.current,
          originalSound: originalSoundRef.current,
          progressBar: progressBarRef.current,
          brand: sentBrand,
        }),
      })
      if (!res.ok) {
        const msg = await res.json().then(j => j.error, () => null)
        throw Object.assign(new Error(msg ?? 'Save failed'), { status: res.status })
      }
      const reply = await res.json().catch(() => null) as { transitionsAsDissolve?: number; speedNotSaved?: number } | null
      setTrAsDissolve((reply?.transitionsAsDissolve ?? 0) > 0)
      // (the database doesn't take a part's speed until the backend has been restarted once)
      if ((reply?.speedNotSaved ?? 0) > 0) notifyLocked('A part\u2019s speed isn\u2019t saved yet: restart the backend once (it updates the database)')
      // Only clear "unsaved" if nothing changed while this save was in flight
      if (editVersionRef.current === version) unsavedRef.current = false
      serverKitRef.current = sentBrand?.kit_id ?? null
      retryDelayRef.current = 2000
      setSaveState('saved')
      saveTimerRef.current = setTimeout(() => setSaveState('idle'), 2500)
      return true
    } catch (err) {
      console.error('[save]', err)
      // No response at all (offline, DNS) or a server-side failure: nothing is wrong with the
      // edit itself, so keep trying quietly. A 4xx means the save was refused — show Retry.
      const status = (err as { status?: number }).status
      if (status === undefined || status >= 500 || status === 429) {
        setSaveState('retrying')
        const delay = retryDelayRef.current
        retryDelayRef.current = Math.min(delay * 2, 30000)
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
        retryTimerRef.current = setTimeout(() => { retryTimerRef.current = null; latestHandleSaveRef.current?.() }, delay)
      } else {
        setSaveState('error')
      }
      return false
    }
  }
  latestHandleSaveRef.current = handleSave

  // Back online: don't wait out the backoff
  useEffect(() => {
    const onOnline = () => { if (retryTimerRef.current) { retryDelayRef.current = 2000; latestHandleSaveRef.current?.() } }
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [])

  // Leaving the editor: flush a pending auto-save first so the last edit isn't lost
  const [leaving, setLeaving] = useState(false)
  async function leaveTo(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return // let new-tab clicks through
    e.preventDefault()
    leave(() => { window.location.href = href })
  }
  async function leave(go: () => void) {
    if (leaving) return
    setLeaving(true)
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    if (unsavedRef.current) await handleSave()
    // Save failed: stay put so the edit isn't lost; the header shows "Couldn't save · Retry"
    if (unsavedRef.current) { setLeaving(false); return }
    go()
  }

  // retranscribe: Re-render also regenerates captions (Gemini) before rendering
  async function handleExport(retranscribe = false) {
    setExporting(true); setExportError(null)
    try {
      await handleSave()
      // Rendering now would export the previous version and silently drop the latest edits
      if (!lastSaveOkRef.current) throw new Error("Couldn't save your latest edits, so nothing was exported. Check your connection and try again.")
      const res = await fetch('/api/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_id: clip.id, quality: renderQuality, retranscribe, remove_fillers: removeFillersRef.current }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Export failed')
      refreshWordsOnDoneRef.current = retranscribe
      setClipStatus('rendering')
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  async function handleResetStuckRender() {
    await fetch(`/api/clips/${clip.id}/reedit`, { method: 'POST' })
    setClipStatus('draft'); setOutputUrl(null); setRenderStuckSince(null); setRenderElapsed(0)
  }

  /**
   * Whether part of the clip as it plays was never captioned: no words at all, or a stretch of
   * more than CAPTION_GAP_MS at its start or end with none (the clip was made longer after its
   * captions were made). A pause that long at an end is rare; captioning it again is cheap.
   */
  const CAPTION_GAP_MS = 4000
  function needsCaptions(): boolean {
    const kept = trim.kept
    if (!kept.length) return false
    const inside = sourceWords.filter(w => kept.some(([a, b]) => w.start_ms >= a && w.start_ms < b)).sort((a, b) => a.start_ms - b.start_ms)
    if (!inside.length) return true
    return inside[0].start_ms - kept[0][0] > CAPTION_GAP_MS || kept[kept.length - 1][1] - inside[inside.length - 1].end_ms > CAPTION_GAP_MS
  }
  /** Make captions for the clip as it is now: save first, so the job reads its current start and end */
  async function makeCaptions() {
    if (transcribing || retranscribing || isFreePlan) return
    setRetranscribing(true)
    await handleSave()
    handleRetranscribe('unknown')
  }
  /** Captions on: made now for this clip if any part of it has none yet (nothing is captioned until asked) */
  function turnCaptions(on: boolean) {
    setShowCaptions(on)
    if (on && needsCaptions()) makeCaptions()
  }
  // Captions are on and the clip was just made longer: caption the new part too (once the drag is over)
  const captionAfterEdgeRef = useRef(false)
  const [edgeDragsDone, setEdgeDragsDone] = useState(0)
  useEffect(() => {
    if (!captionAfterEdgeRef.current) return
    captionAfterEdgeRef.current = false
    if (showCaptions && needsCaptions()) makeCaptions()
  }, [edgeDragsDone]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRetranscribe(languageCode: string) {
    setRetranscribing(true); setRetranscribeElapsed(0); setRetranscribeError(null); setRetranscribePlace(null)
    if (retranscribeTimerRef.current) clearInterval(retranscribeTimerRef.current)
    const startedAt = Date.now()
    retranscribeTimerRef.current = setInterval(
      () => setRetranscribeElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000,
    )
    const stopTimer = () => {
      if (retranscribeTimerRef.current) { clearInterval(retranscribeTimerRef.current); retranscribeTimerRef.current = null }
      setRetranscribePlace(null)
    }
    try {
      const res = await fetch('/api/transcribe/retranscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_id: clip.id, language_code: languageCode }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody?.error ?? `Retranscription failed (${res.status})`)
      }
      const videoId = (clip as unknown as { video_id: string }).video_id
      const queuedAt = new Date().toISOString()
      const { job_id: jobId } = await res.json().catch(() => ({})) as { job_id?: string | null }
      const poll = async () => {
        const deadline = Date.now() + 5 * 60 * 1000
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 3000))
          const res = await fetch(`/api/transcribe/words?video_id=${videoId}&since=${encodeURIComponent(queuedAt)}${jobId ? `&job=${jobId}` : ''}`)
          if (res.ok) {
            const { words: newWords, failed, place } = await res.json()
            // Waiting its turn (many people making captions at once): say where it is in line
            setRetranscribePlace(typeof place === 'number' ? place : null)
            if (newWords && newWords.length > 0) {
              setWords(newWords)
              stopTimer(); setRetranscribing(false); return
            }
            // The caption job stopped with an error: say so instead of waiting on
            if (failed) {
              stopTimer(); setRetranscribing(false)
              setRetranscribeError(`Captions couldn't be made: ${failed}`)
              return
            }
          }
        }
        stopTimer(); setRetranscribing(false)
        setRetranscribeError('Captions are taking too long. Try again in a minute.')
      }
      poll()
    } catch (err) {
      stopTimer(); setRetranscribing(false)
      setRetranscribeError(err instanceof Error ? err.message : 'Retranscription failed')
    }
  }

  // ── Editor actions ────────────────────────────────────────────────────────────

  // Format buttons and Frames ('fromPlayhead'): picking a layout mid-section starts it at the
  // playhead and it runs to the end of that section; what came before keeps its layout (e.g. Single
  // 0:00–0:20, then pick Split at 0:20 → Split 0:20–1:00, no Split button needed). At the very start
  // of a section the whole section changes. A new layout starts from the view of the nearest
  // section with that layout, and joins a touching neighbour with the same layout so no pieces are
  // left behind (frames never join: each keeps its own lanes).
  // 'section': the layout changes the WHOLE section under the playhead.
  const LAYOUT_SNAP_MS = 300
  /** How near a camera cut a format change snaps onto it */
  const CUT_SNAP_MS = 1000
  /** The camera cut nearest `t` (timeline ms) within CUT_SNAP_MS, or null */
  function cutNear(t: number): number | null {
    let best: number | null = null
    for (const c of cameraCuts) if (Math.abs(c - t) <= CUT_SNAP_MS && (best === null || Math.abs(c - t) < Math.abs(best - t))) best = c
    return best
  }
  /** `spans` (timeline ms) given `layout` (applyFormatSpans), then each joined to a touching neighbour in the same format */
  function formatSpans(spans: ReadonlyArray<readonly [number, number]>, layout: LayoutType, framing: Array<BoxPosition | undefined> | undefined) {
    const done = applyFormatSpans(spans, layout, framing, clipLengthMs, getVideoAR(), mainVideoId)
    for (const [a, b] of done) {
      const ids = useEditorStore.getState().segments.filter(x => !isShot(x, mainVideoId) && x.end_ms > a && x.start_ms < b).map(x => x.id)
      for (const id of ids) if (useEditorStore.getState().segments.some(x => x.id === id)) joinSameLayoutNeighbours(id, transitionAfter())
    }
    return done
  }
  // (read live: a split just before, in the same action, moves the transition at a part's end)
  const transitionAfter = () => new Set(useMediaStore.getState().transitions.map(tr => tr.after_segment_id))
  function handleLayoutChange(layout: LayoutType, mode: 'section' | 'fromPlayhead' = 'section') {
    let t = currentTimeMs
    const ar = getVideoAR()
    if (activeSegment && sectionBlocked(activeSegment.id)) return
    // Picked within a second of a camera cut: the new format starts on the cut (user, 2026-10-20 —
    // picked half a second into a scene, its first moments kept the format before). It runs to the
    // end of the format the playhead is in, as from the playhead
    const cut = mode === 'fromPlayhead' ? cutNear(t) : null
    if (cut !== null && Math.abs(cut - t) > 1) {
      if (isFrameLayout(layout)) {
        // (a frame: only inside the section under the playhead — a new frame starts with its own lanes)
        if (activeSegment && cut >= activeSegment.start_ms && cut <= activeSegment.end_ms) t = cut
      } else {
        const gaps = uncoveredRanges(sections, clipLengthMs)
        const endOf = (x: number) => (sections.find(s => x >= s.start_ms && x < s.end_ms) ?? gaps.find(g => x >= g.start_ms && x < g.end_ms))?.end_ms ?? x
        const end = Math.max(endOf(cut + 1), endOf(t))
        if (end - cut >= 300) {
          pause()
          skipCanvasTransitionRef.current = true
          setActiveBoxId(null)
          formatSpans([[cut, end]], layout, neighbourFraming(layout, cut, end))
          if (t < cut) seekToMs(cut)
          return
        }
      }
    }
    if (!activeSegment && currentGap) {
      // No format here yet: create one over the uncovered stretch (from the playhead, unless 'section')
      const start = mode === 'section' || t - currentGap.start_ms <= LAYOUT_SNAP_MS ? currentGap.start_ms : t
      if (currentGap.end_ms - start < 300) return
      pause()
      skipCanvasTransitionRef.current = true
      const id = addFormat(start, currentGap.end_ms, layout, ar, neighbourFraming(layout, start, currentGap.end_ms))
      joinSameLayoutNeighbours(id, transitionAfter())
      if (mode !== 'section' && start !== t) seekToMs(start)
      return
    }
    const seg = activeSegment
    // A frame already is Vertical as a format: picking Vertical keeps the frame
    if (!seg || seg.layout === layout || formatLayoutOf(seg.layout) === layout) return
    pause()
    skipCanvasTransitionRef.current = true
    setActiveBoxId(null)

    if (mode === 'section') {
      applyLayout(seg.id, layout, ar, neighbourFraming(layout, seg.start_ms, seg.end_ms, seg.id))
      joinSameLayoutNeighbours(seg.id, transitionAfter())
      return
    }

    if (t - seg.start_ms <= LAYOUT_SNAP_MS) {
      applyLayout(seg.id, layout, ar, neighbourFraming(layout, seg.start_ms, seg.end_ms, seg.id))
      joinSameLayoutNeighbours(seg.id, transitionAfter())
      return
    }
    if (seg.end_ms - t <= LAYOUT_SNAP_MS) {
      // Playhead is on the line into what follows: change the next format if it touches this one
      const next = [...sections].sort((a, b) => a.start_ms - b.start_ms).find(s => s.start_ms >= seg.end_ms - 1)
      if (next && next.start_ms - seg.end_ms < LAYOUT_SNAP_MS) {
        if (next.layout !== layout && formatLayoutOf(next.layout) !== layout && !sectionBlocked(next.id)) {
          applyLayout(next.id, layout, ar, neighbourFraming(layout, next.start_ms, next.end_ms, next.id))
          seekToMs(joinSameLayoutNeighbours(next.id, transitionAfter()) === next.id ? next.start_ms : seg.end_ms)
        }
        return
      }
      // A stretch with no part follows: give it the new format (not the room after the last part:
      // that is empty, what's on the rows reaches past the main row)
      const gapEnd = next ? next.start_ms : seg.end_ms
      if (gapEnd - seg.end_ms >= 300) {
        const id = addFormat(seg.end_ms, gapEnd, layout, ar, neighbourFraming(layout, seg.end_ms, gapEnd))
        joinSameLayoutNeighbours(id, transitionAfter())
        seekToMs(seg.end_ms)
      }
      return
    }
    const newId = splitAtMs(seg.id, t, getPositionAt)
    if (newId) {
      // A layout or frame picked from the playhead starts fresh: the split gave the new part a copy
      // of the frame's texts, photos and videos (a split within one frame keeps them on both sides),
      // but a new frame has its own — nothing typed before the playhead shows up in it (user,
      // 2026-10-17). What came before keeps everything. (Its look — band colour — still carries.)
      const fresh = useEditorStore.getState().segments.find(x => x.id === newId)
      if (fresh?.frame?.items?.length) updateSegment(newId, { frame: { ...fresh.frame, items: [] } })
      applyLayout(newId, layout, ar, neighbourFraming(layout, t, seg.end_ms, newId))
      joinSameLayoutNeighbours(newId, transitionAfter())
    }
  }

  /**
   * A join dragged onto the next join: the section between goes and the section it was dragged
   * from takes its time (keeping its own layout); then it joins a neighbour with the same layout.
   * A frame with photos, videos or text in it asks first. One undo step.
   */
  function swallowSection(removeId: string, keepId: string) {
    if (blocked({ kind: 'section', id: removeId }) || blocked({ kind: 'section', id: keepId })) return
    const gone = segments.find(x => x.id === removeId)
    if (!gone) return
    const go = () => {
      pause()
      skipCanvasTransitionRef.current = true
      absorbSection(removeId, keepId)
      const kept = transitions.filter(tr => tr.after_segment_id !== removeId)
      if (kept.length !== transitions.length) setTransitions(kept)
      joinSameLayoutNeighbours(keepId, new Set(kept.map(tr => tr.after_segment_id)))
      if (pickedSegId === removeId) setPickedSegId(null)
    }
    // (straight away, no question: Ctrl+Z brings it back)
    go()
  }

  // Split: cut the format under the playhead in two. Both halves keep its layout and views, so a
  // different layout can then be picked for one of them.
  // A video on top that is picked, with the playhead inside it, is the one cut; else the section here
  // (as in Resolve, only clips are cut: where the main row is empty — the room after the main video
  // for what's on top to run on, or the space a deleted part left — nothing of it is cut, which made
  // a piece of that hidden room show up as a "Video" part; the videos on top or below under the
  // playhead are cut there instead)
  const pickedShot = pickedSegId ? shots.find(x => x.id === pickedSegId) : undefined
  const splitTo = splitTargets(currentTimeMs, playingSection, shots, pickedShot, mainVideoId)
  const canSplitHere = splitTo.ids.length > 0
  function splitHere() {
    if (!canSplitHere) return
    const ids = splitTo.main ? splitTo.ids.filter(id => !sectionBlocked(id)) : splitTo.ids.filter(id => !blocked({ kind: 'broll', id }))
    if (!ids.length) return
    pause()
    skipCanvasTransitionRef.current = true
    for (const id of ids) splitAtMs(id, currentTimeMs, getPositionAt)
  }

  const musicName = (t: { storage_path: string }) => {
    if (isMainAudio(t)) return 'Original sound'
    // Stored as "<id>--<the file's name>": just the name (older files have only the id)
    const file = (t.storage_path.split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '')
    const name = file.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(--)?/i, '')
    return name || 'Music'
  }
  /** Where a music track stops on the clip's timeline */
  const musicEnd = (t: AudioTrack) => t.end_ms
    ?? (musicDurations[t.id] != null ? t.start_ms + musicDurations[t.id] - (t.offset_ms ?? 0) : clipDurationMs)
  /** Cut a music track in two at `t` (the right part plays on from the same moment of the song) */
  function splitMusicAt(tr: AudioTrack, t: number) {
    const id = crypto.randomUUID()
    const right: AudioTrack = { ...tr, id, start_ms: t, offset_ms: (tr.offset_ms ?? 0) + (t - tr.start_ms) }
    setAudioTracks(prev => prev.flatMap(x => x.id === tr.id ? [{ ...x, end_ms: t }, right] : [x]))
    const el = musicEls.current.get(tr.id)
    if (el) { const copy = new Audio(); copy.preload = 'auto'; copy.src = el.src; musicEls.current.set(id, copy) }
    if (musicDurations[tr.id] != null) setMusicDurations(d => ({ ...d, [id]: d[tr.id] }))
  }
  // ── Split on media (see splitSelected): cut the selected media — a video on top, B-roll, music, a photo or text — at the
  //    playhead. Two splits make three parts; pick a part and Delete removes it. Each press cuts
  //    the part of that same media under the playhead, so the next split can be anywhere along it. ──
  type PointTarget = { kind: 'broll' | 'music' | 'photo' | 'text'; id: string; name: string }
  const POINT_MIN_MS = 100
  /** The part of the selected media under the playhead that a point would cut (null: nothing to cut there) */
  function pointTarget(): PointTarget | null {
    const sel = selTarget
    if (!sel) return null
    const t = liveTime.get()
    const inside = (a: number, b: number) => t > a + POINT_MIN_MS && t < b - POINT_MIN_MS
    if (sel.kind === 'broll') {
      const me = shots.find(x => x.id === sel.id)
      if (!me) return null
      const src = me.crop_boxes[0]?.source_video_id
      const part = inside(me.start_ms, me.end_ms) ? me
        : shots.find(x => x.crop_boxes[0]?.source_video_id === src && (x.track ?? 0) === (me.track ?? 0) && inside(x.start_ms, x.end_ms))
      return part ? { kind: 'broll', id: part.id, name: 'the video' } : null
    }
    if (sel.kind === 'music') {
      const me = audioTracks.find(x => x.id === sel.id)
      if (!me) return null
      const part = inside(me.start_ms, musicEnd(me)) ? me
        : audioTracks.find(x => x.storage_path === me.storage_path && (x.track ?? 0) === (me.track ?? 0) && inside(x.start_ms, musicEnd(x)))
      return part ? { kind: 'music', id: part.id, name: 'the music' } : null
    }
    if (sel.kind === 'photo') {
      const me = overlays.find(x => x.id === sel.id)
      if (!me || me.type !== 'image') return null
      const part = inside(me.start_ms, me.end_ms) ? me
        : overlays.find(x => x.type === 'image' && x.storage_path === me.storage_path && inside(x.start_ms, x.end_ms))
      return part ? { kind: 'photo', id: part.id, name: 'the photo' } : null
    }
    if (sel.kind === 'text') {
      const me = textOverlays.find(x => x.id === sel.id)
      if (!me) return null
      const part = inside(me.start_ms, me.end_ms) ? me
        : textOverlays.find(x => x.text === me.text && (x.track ?? 0) === (me.track ?? 0) && inside(x.start_ms, x.end_ms))
      return part ? { kind: 'text', id: part.id, name: 'the text' } : null
    }
    return null
  }
  /** Cut the selected media in two at the playhead (it stays selected) */
  function pointHere() {
    const p = pointTarget()
    if (!p) return
    const ctl: CtlTarget = p.kind === 'broll' ? { kind: 'broll', id: p.id } : { kind: p.kind, id: p.id }
    if (blocked(ctl)) return
    pause()
    const t = Math.round(liveTime.get())
    if (p.kind === 'broll') { skipCanvasTransitionRef.current = true; splitAtMs(p.id, t, getPositionAt); return }
    if (p.kind === 'music') { const tr = audioTracks.find(x => x.id === p.id); if (tr) splitMusicAt(tr, t); return }
    if (p.kind === 'photo') {
      setOverlays(prev => prev.flatMap(o => (o.id === p.id ? [{ ...o, end_ms: t }, { ...o, id: crypto.randomUUID(), start_ms: t }] : [o])))
      return
    }
    setTextOverlays(prev => prev.flatMap(o => (o.id === p.id ? [{ ...o, end_ms: t }, { ...o, id: crypto.randomUUID(), start_ms: t }] : [o])))
  }
  /** The picked item in a frame's lanes, when the playhead is inside it (where a split would cut it) */
  function frameItemCut(): { segId: string; id: string } | null {
    const sel = selTarget
    if (sel?.kind !== 'frameItem' || !sel.segId) return null
    const seg = segments.find(x => x.id === sel.segId)
    const it = seg ? frameOf(seg).items?.find(x => x.id === sel.id) : undefined
    if (!seg || !it) return null
    const t = liveTime.get()
    return t > Math.max(it.start_ms, seg.start_ms) + POINT_MIN_MS && t < Math.min(it.end_ms, seg.end_ms) - POINT_MIN_MS ? { segId: seg.id, id: it.id } : null
  }
  /**
   * Split (S): every cut at the playhead is this one button. With media selected — a video on
   * top, B-roll, music, a photo, text or an item in a frame — that media is cut in two, and it
   * stays selected so the next split can follow (two splits make three parts: pick one, Delete).
   * With a section of the main video selected (a format or a frame), or nothing selected, the
   * section under the playhead is cut.
   */
  function splitSelected() {
    if (selTarget && selTarget.kind !== 'section') {
      if (pointTarget()) { pointHere(); return }
      const f = frameItemCut()
      if (!f || frameItemBlocked(f.segId, f.id)) return
      pause()
      splitFrameItem(f.segId, f.id, Math.round(liveTime.get()))
      return
    }
    splitHere()
  }

  /**
   * A music bar's end dragged on the timeline. The start cuts into the song (the track's end stays
   * where it was; never before the song's own start), the end shortens or lengthens the track
   * (never past the song's end or the clip's).
   */
  function trimMusicEdge(id: string, edge: 'start' | 'end', ms: number) {
    if (blocked({ kind: 'music', id })) return
    setAudioTracks(prev => prev.map(t => {
      if (t.id !== id) return t
      const off = t.offset_ms ?? 0
      const end = Math.min(clipLengthMs, musicEnd(t))
      if (edge === 'end') {
        const songEnd = musicDurations[t.id] != null ? t.start_ms + musicDurations[t.id] - off : clipLengthMs
        return { ...t, end_ms: Math.round(Math.min(songEnd, clipLengthMs, Math.max(t.start_ms + 200, ms))) }
      }
      const s = Math.round(Math.max(0, t.start_ms - off, Math.min(end - 200, ms)))
      return { ...t, start_ms: s, offset_ms: off + (s - t.start_ms), end_ms: end }
    }))
  }
  /**
   * Detach audio: the main video's sound becomes its own bar on the Music lane (trim it, move it,
   * change its volume) and the video itself goes quiet. It plays from the main video's file, so it
   * comes back after a reload too. Already detached: picks that bar.
   */
  function detachAudio() {
    const existing = audioTracks.find(isMainAudio)
    if (existing) { pickMusicTrack(existing.id, false); return }
    // (its sound would have to play faster and slower in places: not yet)
    if (allPieces.some(p => (p.speed ?? 1) !== 1)) { notifyLocked('A part of the clip plays at another speed: set it back to 1× to detach the sound'); return }
    pause()
    const id = crypto.randomUUID()
    // Its "song" is the whole main video: one bar for each part of it that stays in the clip
    // (one bar from the clip's start when nothing was removed)
    setAudioTracks(prev => [...prev, ...trim.kept.map(([from, to], i) => ({
      id: i === 0 ? id : crypto.randomUUID(), clip_id: clip.id, storage_path: `${MAIN_AUDIO_PREFIX}${mainVideoId}`,
      start_ms: trim.starts[i], end_ms: trim.starts[i] + (to - from), offset_ms: from,
      volume: originalMuted ? 1 : Math.min(1, originalVolume), duck_under_speech: false,
    }))])
    pickMusicTrack(id, false)
  }
  // Each detached-sound track plays the main video's own file (so it also works after a reload / undo)
  useEffect(() => {
    // Saving keeps only a track's start, volume and ducking (not where in its file it starts), so a
    // reloaded detached sound gets its place in the video back: in step with the clip
    if (audioTracks.some(t => isMainAudio(t) && t.offset_ms == null)) {
      setAudioTracks(prev => prev.map(t => isMainAudio(t) && t.offset_ms == null ? { ...t, offset_ms: trim.toSource(t.start_ms) } : t))
      return
    }
    for (const t of audioTracks) {
      if (!isMainAudio(t) || musicEls.current.has(t.id) || !videoUrl) continue
      const a = new Audio()
      a.preload = 'metadata'
      a.onloadedmetadata = () => { if (isFinite(a.duration)) setMusicDurations(d => ({ ...d, [t.id]: Math.round(a.duration * 1000) })) }
      a.src = videoUrl
      musicEls.current.set(t.id, a)
    }
  }, [audioTracks, videoUrl])
  // While the sound is detached the video itself is quiet (and comes back when that bar is deleted)
  const hasMainAudio = audioTracks.some(isMainAudio)
  const hadMainAudioRef = useRef(hasMainAudio)
  useEffect(() => {
    if (hadMainAudioRef.current === hasMainAudio) return
    hadMainAudioRef.current = hasMainAudio
    setOriginalMuted(hasMainAudio)
  }, [hasMainAudio])

  function deleteMusic(id: string) {
    if (blocked({ kind: 'music', id })) return
    setAudioTracks(prev => prev.filter(t => t.id !== id))
    setPickedMusicId(null)
  }

  // Moving the view (the crop box):
  //  • Motion off — a VIEW CHANGE at the playhead: the new view shows from here until the next
  //    change (a cut); everything before stays as it was. On an existing change (◆ on the timeline)
  //    it edits that change; at the format's start it edits the first view.
  //  • Motion on — records points while the video plays; the view glides between them.
  // The preview and the export both follow these changes (see views.ts).
  const [selectedView, setSelectedView] = useState<{ boxId: string; t: number } | null>(null)
  // The ◆ markers on the timeline: view changes of the selected crop box (or the first one) in the
  // format under the playhead
  const viewBox = activeSegment ? (activeSegment.crop_boxes.find(b => b.id === activeBoxId) ?? activeSegment.crop_boxes[0]) : undefined
  const viewMarkers = useMemo(
    () => viewBox && activeSegment
      ? viewChanges(keyframes[viewBox.id] ?? []).filter(v => v.t_ms >= activeSegment.start_ms - 1 && v.t_ms < activeSegment.end_ms)
      : [],
    [viewBox, activeSegment, keyframes],
  )
  // (for the timeline: when and whether a cut — the view's place changes with every move of a drag,
  // and the timeline doesn't show it, so it isn't redrawn for it)
  const viewMarkerKey = viewMarkers.map(v => `${v.t_ms}:${v.cut ? 1 : 0}`).join(',')
  const timelineViewMarkers = useMemo(() => viewMarkers.map(v => ({ t_ms: v.t_ms, cut: v.cut })), [viewMarkerKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSelectedView(null) }, [viewBox?.id])
  function handleBoxChange(boxId: string, pos: { x: number; y: number; w: number; h: number }) {
    if (boxId === DEFAULT_BOX_ID) {
      // First move creates a format over the gap; the rest of the same drag (whose handler still
      // points at the default box) reframes that new format instead of creating more
      const gap = currentGap
      if (!gap) return
      const made = useEditorStore.getState().segments.find(x => x.start_ms === gap.start_ms && x.end_ms === gap.end_ms && !isShot(x, mainVideoId))
      if (made?.crop_boxes[0]) { setBoxKeyframes(made.crop_boxes[0].id, [{ t_ms: made.start_ms, ...pos }]); return }
      addFormat(gap.start_ms, gap.end_ms, 'vertical', getVideoAR(), pos)
      return
    }
    const vid = videoRef.current
    if (sectionBlocked(segments.find(s => s.crop_boxes.some(b => b.id === boxId))?.id)) return
    if (motionModeRef.current) {
      const t_ms = vid && !vid.paused ? Math.round(trim.toTimeline(vid.currentTime * 1000)) : currentTimeMs
      recordMotionAt(boxId, Math.max(0, t_ms), pos)
      return
    }
    const seg = segments.find(s => s.crop_boxes.some(b => b.id === boxId))
    if (!seg || sectionBlocked(seg.id)) return
    // One drag = one view change at one moment: stop playback so the playhead can't run on
    if (vid && !vid.paused) pause()
    // At the start of the frame on screen: a change at a camera cut starts on the new shot's first
    // frame (the playhead can sit inside a frame: the arrow keys step 1/30 s, videos are often 25 fps)
    const t = Math.max(seg.start_ms, Math.min(seg.end_ms - 1, frameStartAt(liveTime.get())))
    setViewAt(boxId, t, pos, seg.start_ms)
  }
  // ── Subjects (SubjectsPanel, modules/editor/subjects.ts) ─────────────────────
  // People marked in the clip and tracked by the worker. Marking starts the tracking by itself;
  // when it's done every section's view switches between them through the clip, to whoever is
  // talking (one undo step, saved like any edit).
  type SubjectRow = SubjectItem & {
    mark_ms: number; mark_x: number; mark_y: number; path: SubjectPoint[] | null; scan_start_ms: number | null; scan_end_ms: number | null
    cuts?: number[] | null; speaking?: Array<[number, number]> | null
    /** A group subject (a marked camera shot): its format and views, and wherever the clip shows that shot (source ms) */
    shot?: { layout: LayoutType; boxes: Array<{ slot_index: number; x: number; y: number; w: number; h: number }> } | null
    spans?: Array<[number, number]> | null
  }
  /** Their face for the card's picture: the tracked face nearest where they were marked (within 1.5 s), else around the mark */
  const subjectFace = (s: SubjectRow): SubjectItem['face'] => {
    // A group not looked for yet: its first view's picture
    if (s.shot && !s.path?.length && s.shot.boxes[0]) { const b = s.shot.boxes[0]; return { ms: s.mark_ms, box: { x: b.x, y: b.y, w: b.w, h: b.h } } }
    const near = (s.path ?? []).reduce<SubjectPoint | null>((best, p) => (!best || Math.abs(p[0] - s.mark_ms) < Math.abs(best[0] - s.mark_ms) ? p : best), null)
    if (near && Math.abs(near[0] - s.mark_ms) <= 1500) return { ms: near[0], box: { x: near[1], y: near[2], w: near[3], h: near[4] } }
    return { ms: s.mark_ms, box: { x: Math.max(0, s.mark_x - 0.06), y: Math.max(0, s.mark_y - 0.12), w: 0.12, h: 0.2 } }
  }
  /** The camera cuts the tracker found (source ms, in order) */
  const subjectCuts = (list: SubjectRow[]) => [...new Set(list.flatMap(s => s.cuts ?? []))].sort((a, b) => a - b)
  const [subjects, setSubjects] = useState<SubjectRow[]>([])
  const [subjectsLoaded, setSubjectsLoaded] = useState(false)
  const [subjectsLoading, setSubjectsLoading] = useState(false)
  const [subjectsError, setSubjectsError] = useState<string | null>(null)
  const [marking, setMarking] = useState(false)
  const [showSubjects, setShowSubjects] = useState(true)
  const [subjectNotice, setSubjectNotice] = useState<string | null>(null)
  const subjectsUrl = `/api/clips/${savedClip.id}/subjects`
  const takeSubjects = useCallback((list: unknown) => {
    if (!Array.isArray(list)) return
    setSubjects(list.map((r: SubjectRow) => ({ ...r, seen: null, stale: false })))
  }, [])
  const loadSubjects = useCallback(async () => {
    setSubjectsLoading(true)
    try {
      const res = await fetch(subjectsUrl)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not load the subjects')
      takeSubjects(data.subjects)
      setSubjectsError(null)
    } catch (e) {
      setSubjectsError(e instanceof Error ? e.message : 'Could not load the subjects')
    } finally {
      setSubjectsLoading(false); setSubjectsLoaded(true)
    }
  }, [subjectsUrl, takeSubjects])
  useEffect(() => { if (tool === 'subjects' && !subjectsLoaded) loadSubjects() }, [tool, subjectsLoaded, loadSubjects])
  // While tracking: check every few seconds
  const subjectsBusy = subjects.some(s => s.status === 'queued' || s.status === 'running')
  useEffect(() => {
    if (!subjectsBusy) return
    const id = setInterval(loadSubjects, 2500)
    return () => clearInterval(id)
  }, [subjectsBusy, loadSubjects])
  // Marking stops with Esc, or when the Subjects tool closes
  useEffect(() => {
    if (!marking) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMarking(false) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [marking])
  useEffect(() => { if (tool !== 'subjects') setMarking(false) }, [tool])
  async function subjectsCall(url: string, init: RequestInit) {
    const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Something went wrong')
    return data
  }
  // A tap while the last mark is still being saved is ignored (user, 2026-10-24: a double tap on a
  // face made C and C — the face showed unmarked until the first was saved)
  const markingSubjectRef = useRef(false)
  /** `atSourceMs`: a moment of the source video (a face of a camera angle); else the moment on screen */
  /** `followNow`: + Add (a click on the video) — follow them at once, not after the rest are marked */
  async function markSubject(x: number, y: number, atSourceMs?: number, followNow = false) {
    if (markingSubjectRef.current) return
    pause()
    setMarking(false)
    setSubjectNotice(null)
    // The moment on screen, in the source video's time
    const mark_ms = atSourceMs ?? Math.round(trim.toSource(Math.max(0, liveTime.get())))
    markingSubjectRef.current = true
    try {
      const { subject } = await subjectsCall(subjectsUrl, { method: 'POST', body: JSON.stringify({ mark_ms, x, y }) })
      setSubjects(list => [...list, { ...subject, seen: null, stale: false }])
      setSubjectsError(null)
      // Not looked for yet: everyone and every group is marked first, then Mark in the whole clip
      // (markInWholeClip) finds them all together — except + Add (user, 2026-10-29: a person added by a
      // click on the video showed nothing, and was clicked again): they are followed at once, and once
      // found they join the scene (angles.ts angleRows). The views after it keep Auto format's rules,
      // when it laid this clip (a view on two or more people holds)
      if (followNow) {
        const laid = readAutoRecord()
        if (laid.places.length) autoFollowRef.current = laid.mode
        setSubjectNotice(`${subject.label} is marked — following them now. They join the scene when found.`)
        await trackSubjectsNow(false)
      }
    } catch (e) { setSubjectsError(e instanceof Error ? e.message : 'Could not mark them') }
    finally { markingSubjectRef.current = false }
  }
  /**
   * Mark the subject: whoever the view (the 9:16 box) is on right now — no second click. Only where
   * the view is the whole picture (Horizontal) does it ask to click on the person instead.
   */
  function markFromView() {
    setSubjectNotice(null)
    if (marking) { setMarking(false); return }
    const seg = activeSegment
    // The view showing the main video: the picked box, else (in a frame) its first main slot
    const mainSlots = seg && isFrameLayout(seg.layout) ? frameOf(seg).main_slots ?? [0] : null
    const box = seg && viewBox && !viewBox.image_path && !(viewBox.source_video_id && viewBox.source_video_id !== mainVideoId)
      && (!mainSlots || mainSlots.includes(viewBox.slot_index))
      ? viewBox
      : seg?.crop_boxes.find(b => !b.image_path && (!mainSlots || mainSlots.includes(b.slot_index)))
    if (!seg || !box || seg.layout === 'horizontal') { setMarking(true); return }
    const v = getPositionAt(box.id, Math.round(liveTime.get()))
    if (v.w > 0.9 && v.h > 0.9) { setMarking(true); return }
    markSubject(v.x + v.w / 2, v.y + v.h / 2)
  }
  /**
   * Mark the shot (a group subject): the format on screen and where its views are become this camera
   * shot's own — wherever the clip shows the same shot again (the same people in the same places),
   * it gets this format and these views, over following whoever is talking.
   */
  // A press while the last one is still being saved is ignored: it would make a second group (and a second "Group 2")
  const markingShotRef = useRef(false)
  async function markShot() {
    if (markingShotRef.current) return
    setSubjectNotice(null)
    setMarking(false)
    const seg = activeSegment
    if (!seg) { setSubjectsError('Pick a format here first (Vertical, Split, Trio…) and place its views, then mark the shot.'); return }
    if (isFrameLayout(seg.layout)) { setSubjectsError('A frame can’t be a group’s format yet — use Vertical, Split, Trio or another format.'); return }
    if (seg.crop_boxes.some(b => b.image_path || (b.source_video_id && b.source_video_id !== mainVideoId))) {
      setSubjectsError('Every view has to show this clip’s video to mark the shot.'); return
    }
    pause()
    const t = Math.round(liveTime.get())
    const boxes = [...seg.crop_boxes].sort((a, b) => a.slot_index - b.slot_index).map(b => {
      const v = getPositionAt(b.id, t)
      return { slot_index: b.slot_index, x: v.x, y: v.y, w: v.w, h: v.h }
    })
    markingShotRef.current = true
    try {
      const { subject } = await subjectsCall(subjectsUrl, {
        method: 'POST',
        body: JSON.stringify({ mark_ms: Math.round(trim.toSource(Math.max(0, t))), x: 0.5, y: 0.5, shot: { layout: seg.layout, boxes } }),
      })
      setSubjects(list => [...list, { ...subject, seen: null, stale: false }])
      setSubjectsError(null)
    } catch (e) { setSubjectsError(e instanceof Error ? e.message : 'Could not mark the shot') }
    finally { markingShotRef.current = false }
  }
  /**
   * Mark in the whole clip: once everyone and every group is marked, they are all looked for through
   * the whole clip together (who is who, and who is talking, is worked out between all of them);
   * when that's done the clip is laid out once — the groups' formats, and the view on whoever is talking.
   */
  async function markInWholeClip() {
    setMarking(false)
    await trackSubjectsNow(true)
  }
  async function trackSubjectsNow(all: boolean) {
    setSubjectNotice(null)
    try {
      const { subjects: list } = await subjectsCall(`${subjectsUrl}/track`, { method: 'POST', body: JSON.stringify({ start_ms: rawClip.start_ms, end_ms: rawClip.end_ms, all }) })
      takeSubjects(list)
      setSubjectsError(null)
    } catch (e) { setSubjectsError(e instanceof Error ? e.message : 'Could not start tracking') }
  }
  async function removeSubject(id: string) {
    setSubjects(list => list.filter(s => s.id !== id))
    try { await subjectsCall(`${subjectsUrl}?id=${encodeURIComponent(id)}`, { method: 'DELETE' }) }
    catch (e) { setSubjectsError(e instanceof Error ? e.message : 'Could not remove them'); loadSubjects() }
  }
  async function renameSubject(id: string, label: string) {
    setSubjects(list => list.map(s => (s.id === id ? { ...s, label } : s)))
    try { await subjectsCall(subjectsUrl, { method: 'PATCH', body: JSON.stringify({ id, label }) }) }
    catch (e) { setSubjectsError(e instanceof Error ? e.message : 'Could not rename them'); loadSubjects() }
  }
  // How much of the clip each is seen in, and whether the clip has grown past what was tracked
  const subjectItems = useMemo<SubjectItem[]>(() => subjects.map(s => ({
    ...s,
    // A group read by a worker from before group subjects (it followed one face instead of finding
    // the shot): it needs looking for again — Mark in the whole clip offers it
    ...(s.shot && s.status === 'done' && !s.spans
      ? { status: 'failed' as const, error: 'Not looked for as a group yet — press Mark in the whole clip again.' }
      : {}),
    seen: s.status === 'done' && s.path ? seenShare(s.path, 0, clipLengthMs, trim.toSource) : null,
    stale: s.status === 'done' && s.scan_start_ms !== null && s.scan_end_ms !== null
      && (rawClip.start_ms < s.scan_start_ms - 500 || rawClip.end_ms > s.scan_end_ms + 500),
    face: subjectFace(s),
    group: s.shot ? { layout: s.shot.layout, places: s.spans?.length ?? 0 } : null,
  })), [subjects, clipLengthMs, trim, rawClip.start_ms, rawClip.end_ms])
  /**
   * Frame the whole clip on the tracked subjects. Group subjects first: wherever the clip shows a
   * marked shot, it gets that group's format and views (applyGroupShots) — the user's own choice wins.
   * Everywhere else, in every section, a view showing the main video switches between the people —
   * to whoever is talking (autoDirectChanges); a section with two or three such views (split, trio,
   * a frame) puts one person in each. Views keep their size. Locked sections, photos and other
   * videos are left alone. One undo step.
   */
  function frameClipOnSubjects(list: SubjectRow[]) {
    // (a group whose saved views overlap is never laid again: Auto format rebuilds it — views never overlap)
    const groups = list.filter(s => s.status === 'done' && s.shot && s.spans?.length
      && !viewsOverlap([...s.shot.boxes].sort((p, q) => p.slot_index - q.slot_index)))
    const tracked = list.filter(s => s.status === 'done' && !s.shot && s.path?.length) as Array<SubjectRow & { path: SubjectPoint[] }>
    if (!tracked.length && !groups.length) return
    const held = groups.length ? applyGroupShots(groups.map(g => ({
      layout: g.shot!.layout, boxes: g.shot!.boxes,
      spans: g.spans!.map(([a, b]) => [trim.toTimeline(a), trim.toTimeline(b)] as [number, number]),
    })), clipLengthMs, getVideoAR(), mainVideoId) : []
    const inGroup = (seg: { start_ms: number; end_ms: number }) => held.some(([a, b]) => seg.start_ms >= a - 150 && seg.end_ms <= b + 150)
    const groupNote = held.length
      ? `${groups.map(g => g.label).join(', ')}: ${held.length === 1 ? 'its shot has' : `its shot comes up ${held.length} times — each has`} the format you marked. `
      : ''
    if (!tracked.length) {
      setSubjectNotice(held.length ? `${groupNote}Undo takes it back.` : 'The marked shot isn’t seen anywhere else in this clip.')
      return
    }
    const cuts = subjectCuts(tracked)
    const { segments: segs, keyframes: kfs } = useEditorStore.getState()
    const next = { ...kfs }
    let framed = 0
    // After Auto format (Cuts): a view it placed on two or more people (the middle two of a Trio, a side
    // of the table, everyone in one Vertical) holds where it is — following would put it on one of them.
    // After Auto format (Vertical): one view, on whoever talks (each held MIN_HOLD)
    const auto = autoFollowRef.current
    autoFollowRef.current = null
    const holdGroups = auto === 'cuts'
    /** Someone talks in the section (the tracker's turns, or its talking readings) */
    const talksIn = (seg: SegmentLocal) => {
      const a = trim.toSource(seg.start_ms), b = trim.toSource(seg.end_ms)
      return tracked.some(s => s.speaking?.some(([x, y]) => y > a && x < b) || s.path.some(pt => pt[5] === 1 && pt[0] >= a && pt[0] < b))
    }
    /** The view has two or more of them in it most of the time (someone leaning in for a moment isn't it) */
    const onSeveral = (seg: SegmentLocal, box: CropBoxLocal) => {
      let seen = 0, several = 0
      for (let t = seg.start_ms; t < seg.end_ms; t += 500) {
        const v = getBoxPositionAtLerp(t, kfs[box.id] ?? box.keyframes ?? [])
        const inside = tracked.filter(p => {
          const face = subjectBoxAt(p.path, trim.toSource(t), cuts)
          if (!face) return false
          const cx = face.x + face.w / 2, cy = face.y + face.h / 2
          return cx >= v.x && cx <= v.x + v.w && cy >= v.y && cy <= v.y + v.h
        }).length
        if (inside) seen++
        if (inside >= 2) several++
      }
      return seen > 0 && several * 2 >= seen
    }
    for (const seg of segs.filter(x => !isShot(x, mainVideoId) && x.end_ms - x.start_ms > 250).sort((a, b) => a.start_ms - b.start_ms)) {
      if (seg.locked || seg.layout === 'horizontal' || inGroup(seg)) continue
      const frame = isFrameLayout(seg.layout)
      const mainSlots = frame ? frameOf(seg).main_slots ?? [0] : null
      // The views that show the main video (in a frame: its main slots, not one shown whole)
      const views = [...seg.crop_boxes].sort((a, b) => a.slot_index - b.slot_index).filter(b => !b.image_path
        && !(b.source_video_id && b.source_video_id !== mainVideoId)
        && (!mainSlots || (mainSlots.includes(b.slot_index) && frameSlotSize(seg.layout as FrameLayout, true, b.slot_index, seg.frame) !== null)))
      // Two or more views: each follows the person inside it, nobody in two (viewPeople)
      const who = views.length > 1 ? viewPeople(seg, views, tracked, kfs, cuts) : null
      // Views side by side that don't overlap where they start (a Split or Trio Auto format laid, say)
      // keep to their own strips while they follow (the user, 2026-10-25: views must never overlap): each
      // from halfway between it and the view on its left to halfway to the one on its right
      const starts = views.map(b => getBoxPositionAtLerp(seg.start_ms, kfs[b.id] ?? b.keyframes ?? []))
      const apart = views.length > 1 && starts.every((p, a) => starts.every((q, b) => a >= b
        || Math.min(p.x + p.w, q.x + q.w) <= Math.max(p.x, q.x) + 1e-6 || Math.min(p.y + p.h, q.y + q.h) <= Math.max(p.y, q.y) + 1e-6))
      const byLeft = starts.map((p, i) => ({ p, i })).sort((a, b) => a.p.x - b.p.x)
      const stripOf = (i: number): readonly [number, number] => {
        if (!apart) return [0, 1]
        const k = byLeft.findIndex(e => e.i === i)
        const prev = byLeft[k - 1]?.p, nxt = byLeft[k + 1]?.p, me = starts[i]
        return [prev ? (prev.x + prev.w + me.x) / 2 : 0, nxt ? (me.x + me.w + nxt.x) / 2 : 1]
      }
      views.forEach((box, i) => {
        if (holdGroups && onSeveral(seg, box)) return
        const size = starts[i]
        const view = { w: size.w, h: size.h }
        let person = who ? who[i] : null
        if (who && !person) return
        // Vertical mode, nobody talking in the section: it holds on the people it was placed on, or
        // follows the one (the biggest face, as placed) — not the first one marked
        if (auto === 'vertical' && !who && !talksIn(seg)) {
          if (onSeveral(seg, box)) return
          person = viewPeople(seg, [box], tracked, kfs, cuts)[0]
          if (!person) return
        }
        const found = !person
          ? autoDirectChanges(tracked, seg.start_ms, seg.end_ms, trim.toSource, view, cuts, trim.toTimeline, auto === 'vertical' ? AUTO_FORMAT.MIN_HOLD * 1000 : undefined)
          : followChanges(person.path, seg.start_ms, seg.end_ms, trim.toSource, view, 'smooth', cuts)
        if (!found?.length) return
        const [sl, sr] = stripOf(i)
        const changes = found.map(c => {
          const inStrip = { ...c, x: Math.max(sl, Math.min(c.x, sr - c.w)) }
          // Their face drifting out of the view (kept in its strip): the view widens, inside the strip
          // and the picture, to keep them whole (never ignore anyone)
          const face = person && apart ? subjectBoxAt(person.path, trim.toSource(c.t_ms), cuts) : null
          if (!face || (face.x >= inStrip.x && face.x + face.w <= inStrip.x + inStrip.w)) return inStrip
          const l = Math.max(sl, Math.min(inStrip.x, face.x)), r = Math.min(sr, Math.max(inStrip.x + inStrip.w, face.x + face.w))
          const w = r - l, h = Math.min(1, w * (c.h / c.w))
          const wide = h * (c.w / c.h)
          return { ...c, x: Math.max(sl, Math.min(l, sr - wide)), w: wide, h, y: Math.max(0, Math.min(c.y - (h - c.h) * 0.4, 1 - h)) }
        })
        next[box.id] = buildKeyframes(changes.map((c, k) => (k === 0 ? { ...c, t_ms: seg.start_ms } : c)))
          .map(k => ({ id: crypto.randomUUID(), box_id: box.id, t_ms: k.t_ms, x: k.x, y: k.y, w: k.w, h: k.h }))
        framed++
      })
    }
    if (!framed) {
      setSubjectNotice(held.length ? `${groupNote}Undo takes it back.` : 'They aren’t seen in the parts of the clip that can be framed on them.')
      return
    }
    useEditorStore.setState({ keyframes: next })
    const names = tracked.map(s => s.label)
    setSubjectNotice(groupNote + (names.length > 1
      ? `${groupNote ? 'Elsewhere the' : 'The'} view switches between ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} through the clip — to whoever is talking. Undo takes it back.`
      : `${groupNote ? 'Elsewhere the' : 'The'} view follows ${names[0]} through the clip. Undo takes it back.`))
  }
  /**
   * Who each view of a section with two or more (Split, Trio, a frame) follows (user, 2026-10-20: a
   * Trio placed on three people had its third view sent to the first view's person): the tracked
   * person whose face is inside it most often through the section — as the user placed it — each
   * person in one view at most. A view with none of them inside stays as it is (null). When no view
   * has anyone inside (views never placed on anyone), the people seen in the section, one per view.
   */
  function viewPeople<P extends { path: SubjectPoint[] }>(
    seg: SegmentLocal, views: CropBoxLocal[], tracked: P[], kfs: Record<string, BoxKeyframe[]>, cuts: number[],
  ): Array<P | null> {
    const moments: number[] = []
    for (let t = seg.start_ms; t < seg.end_ms; t += 500) moments.push(t)
    const faceAt = (p: P, t: number) => subjectBoxAt(p.path, trim.toSource(t), cuts)
    const pairs = views.flatMap((box, i) => tracked.map((p, k) => ({
      i, k,
      n: moments.filter(t => {
        const face = faceAt(p, t)
        if (!face) return false
        const v = getBoxPositionAtLerp(t, kfs[box.id] ?? box.keyframes ?? [])
        const cx = face.x + face.w / 2, cy = face.y + face.h / 2
        return cx >= v.x && cx <= v.x + v.w && cy >= v.y && cy <= v.y + v.h
      }).length,
    }))).filter(x => x.n > 0).sort((a, b) => b.n - a.n)
    const out: Array<P | null> = views.map(() => null)
    const taken = new Set<number>()
    for (const { i, k } of pairs) if (!out[i] && !taken.has(k)) { out[i] = tracked[k]; taken.add(k) }
    if (!out.some(x => x !== null)) {
      tracked.filter(p => moments.some(t => faceAt(p, t))).slice(0, views.length).forEach((p, i) => { out[i] = p })
    }
    return out
  }
  // When tracking finishes, the clip is framed on them
  const wasBusyRef = useRef(false)
  useEffect(() => {
    const busy = subjects.some(s => s.status === 'queued' || s.status === 'running')
    if (wasBusyRef.current && !busy) frameClipOnSubjects(subjects)
    wasBusyRef.current = busy
  }, [subjects]) // eslint-disable-line react-hooks/exhaustive-deps
  // The clip grew past what was tracked, or they were tracked by an older worker (no camera cuts, no
  // talking): they need following again. Never started by itself (user, 2026-10-24: nothing calls the
  // worker unless pressed) — the panel says so and Follow them again does it
  const needsRetrack = !subjectsBusy && (
    subjects.some(s => s.status === 'done' && (s.cuts === undefined || s.cuts === null) && s.path?.length && s.path[0].length < 6)
    || subjectItems.some(s => s.status === 'done' && s.stale))
  // The tracked people on the video, at a clip time (while the Subjects tool is open)
  const subjectsAt = useMemo(() => {
    const tracked = subjects.filter(s => s.status === 'done' && s.path?.length)
    if (tool !== 'subjects' || !showSubjects || !tracked.length) return undefined
    const cuts = subjectCuts(tracked)
    return (ms: number) => tracked.flatMap(s => {
      const box = subjectBoxAt(s.path!, trim.toSource(ms), cuts)
      return box ? [{ id: s.id, label: s.label, color: s.color, box }] : []
    })
  }, [subjects, tool, showSubjects, trim])

  // ── Camera angles (modules/editor/angles.ts) ──
  // Every angle of the clip, listed in the Subjects tool so each gets its subject or its group. The
  // worker looks for them only when Detect subjects (or Detect again) is pressed (user, 2026-10-24:
  // opening the tool started a scan by itself); a list found before is read when the editor opens.
  type AnglesData = { status: 'none' | 'queued' | 'running' | 'done' | 'failed' | 'unavailable'; progress: number; error: string | null; angles: Angle[]; scan_start_ms: number | null; scan_end_ms: number | null }
  const [anglesData, setAnglesData] = useState<AnglesData | null>(null)
  // Bumped by Stop: an answer to a request sent before it (a status check, or the scan's start, slow on a
  // slow database) no longer counts — it put "Detecting…" back after Stop (user, 2026-10-31)
  const stopGenRef = useRef(0)
  // The scenes last found: what a stopped scan goes back to (as the server's stop does)
  const lastDoneAnglesRef = useRef<AnglesData | null>(null)
  useEffect(() => { if (anglesData?.status === 'done') lastDoneAnglesRef.current = anglesData }, [anglesData])
  const loadAngles = useCallback(async (scan = false) => {
    const gen = stopGenRef.current
    try {
      const res = await fetch(`${subjectsUrl}/angles`, scan
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start_ms: rawClip.start_ms, end_ms: rawClip.end_ms }) }
        : undefined)
      const data = await res.json().catch(() => ({}))
      if (gen !== stopGenRef.current) {
        // Stopped meanwhile. A scan that only now got started is stopped again, so it doesn't run on
        if (scan && res.ok) fetch(`${subjectsUrl}/stop`, { method: 'POST' }).catch(() => {})
        return
      }
      if (!res.ok) throw new Error(data.error ?? 'The camera angles could not be listed.')
      setAnglesData(data)
    } catch (e) {
      if (gen !== stopGenRef.current) return
      setAnglesData({ status: 'failed', progress: 0, error: e instanceof Error ? e.message : 'The camera angles could not be listed.', angles: [], scan_start_ms: null, scan_end_ms: null })
    }
  }, [subjectsUrl, rawClip.start_ms, rawClip.end_ms])
  // (read when the editor opens — no scan — so a format picked anywhere can snap to the camera cuts)
  useEffect(() => { if (!anglesData) loadAngles() }, [anglesData, loadAngles])
  // The clip grew past what was read: the list misses the new part (Detect again)
  const anglesStale = anglesData?.status === 'done' && anglesData.scan_start_ms !== null && anglesData.scan_end_ms !== null
    && (rawClip.start_ms < anglesData.scan_start_ms - 500 || rawClip.end_ms > anglesData.scan_end_ms + 500)
  const anglesBusy = anglesData?.status === 'queued' || anglesData?.status === 'running'
  useEffect(() => {
    if (!anglesBusy || tool !== 'subjects') return
    const id = setInterval(() => loadAngles(), 2500)
    return () => clearInterval(id)
  }, [anglesBusy, tool, loadAngles])
  const angleItems = useMemo(() => {
    if (anglesData?.status !== 'done') return []
    // A scene's format: the one section covering exactly each of its stretches (Auto format, or a format picked here)
    const formatOf = (a: number, b: number) => {
      const over = sections.filter(x => x.end_ms > a + 50 && x.start_ms < b - 50)
      return over.length === 1 && Math.abs(over[0].start_ms - a) <= 150 && Math.abs(over[0].end_ms - b) <= 150 ? over[0].layout : null
    }
    return angleRows(anglesData.angles, subjects, subjectCuts(subjects), trim.toTimeline, clipLengthMs, formatOf)
  }, [anglesData, subjects, trim, clipLengthMs, sections]) // eslint-disable-line react-hooks/exhaustive-deps
  const angleNow = useMemo(() => (tool === 'subjects' && angleItems.length ? angleAt(angleItems, currentTimeMs) : null), [tool, angleItems, currentTimeMs])
  const anglesView = useMemo<AnglesView>(() => ({
    status: !anglesData ? 'loading' : anglesData.status === 'queued' || anglesData.status === 'running' ? 'scanning' : anglesData.status,
    progress: anglesData?.progress ?? 0, error: anglesData?.error ?? null, items: angleItems, now: angleNow, stale: !!anglesStale,
  }), [anglesData, angleItems, angleNow, anglesStale])
  // The camera cuts on the timeline (ms): where one scene meets another, from the scenes list
  const cameraCuts = useMemo(() => {
    const at = new Set<number>()
    for (const r of angleItems) for (const [a, b] of r.shown) { if (a > 0) at.add(a); if (b < clipLengthMs) at.add(b) }
    return [...at].sort((a, b) => a - b)
  }, [angleItems, clipLengthMs])
  /** A scene's views for `layout`: one person in Vertical → the view on them; else none of its own */
  function sceneFraming(row: AngleRow, layout: LayoutType): Array<BoxPosition | undefined> | undefined {
    const found = row.faces.filter(f => !f.pending)
    if (layout !== 'vertical' || found.length !== 1) return undefined
    const f = found[0].box
    return [defaultCropForSlot('vertical', 0, getVideoAR(), f.x + f.w / 2)]
  }
  /**
   * In the Subjects tool a format picked is the scene's (user, 2026-10-20): the whole camera shot, cut
   * to cut, and everywhere the clip shows it again — not from the playhead on. False: not on a scene
   * (or a frame was picked), so it's picked as anywhere else.
   */
  function pickForScene(layout: LayoutType): boolean {
    if (isFrameLayout(layout)) return false
    const i = angleAt(angleItems, currentTimeMs)
    const row = i === null ? null : angleItems[i]
    // (people 0: the other shots together — not one scene)
    if (!row || row.people === 0) return false
    if (activeSegment && sectionBlocked(activeSegment.id)) return true
    pause()
    skipCanvasTransitionRef.current = true
    setActiveBoxId(null)
    const here = row.shown.find(([a, b]) => currentTimeMs >= a && currentTimeMs < b) ?? row.shown[0]
    const done = formatSpans(row.shown, layout, sceneFraming(row, layout) ?? neighbourFraming(layout, here[0], here[1]))
    const name = layout === 'vertical' ? 'Vertical' : layout === 'split' ? 'Split' : layout === 'trio' ? 'Trio' : layout === 'horizontal' ? 'Horizontal' : 'this format'
    setSubjectNotice(done.length > 1
      ? `This scene is ${name} now, all of it — and everywhere the clip shows it (${done.length} places). Undo takes it back.`
      : `This scene is ${name} now, all of it. Undo takes it back.`)
    return true
  }
  // One-person scenes are Vertical, on the person (user, 2026-10-20): where a format of two or more
  // views (Split, Trio…) runs into such a scene from the one beside it, or covers only part of it,
  // that part becomes Vertical. A format given to exactly that scene is the user's and stays; locked
  // parts, frames and a scene with a group marked stay too. Once for each scenes list, in the tool.
  const soloScenesRef = useRef<unknown>(null)
  useEffect(() => {
    if (tool !== 'subjects' || !angleItems.length || soloScenesRef.current === anglesData) return
    soloScenesRef.current = anglesData
    const sectionsNow = () => useEditorStore.getState().segments.filter(x => !isShot(x, mainVideoId))
    // Where a group was found (Follow): its format, whatever the scenes list says (user, 2026-10-24: a
    // wide shot listed in a close-up's scene had its group's Trio turned back to Vertical here)
    const groupPlaces = subjects.filter(s => s.shot && s.status === 'done' && s.spans?.length)
      .flatMap(s => s.spans!.map(([a, b]) => [trim.toTimeline(a), trim.toTimeline(b)] as const))
    let fixed = 0
    for (const row of angleItems) {
      if (row.people !== 1 || row.group) continue
      const spans = row.shown.filter(([a, b]) => {
        if (groupPlaces.some(([x, y]) => Math.min(b, y) - Math.max(a, x) >= 300)) return false
        const over = sectionsNow().filter(x => x.end_ms > a + 50 && x.start_ms < b - 50)
        if (!over.some(x => !x.locked && !isFrameLayout(x.layout) && (LAYOUT_SLOT_COUNT[x.layout] ?? 1) > 1)) return false
        return !(over.length === 1 && Math.abs(over[0].start_ms - a) <= 150 && Math.abs(over[0].end_ms - b) <= 150)
      })
      if (!spans.length) continue
      fixed += formatSpans(spans, 'vertical', sceneFraming(row, 'vertical')).length
    }
    if (fixed) setSubjectNotice(`${fixed === 1 ? 'A one-person scene had' : `${fixed} one-person scenes had`} a Split or Trio running into ${fixed === 1 ? 'it' : 'them'} — made Vertical, on the person. Undo takes it back.`)
  }, [tool, angleItems, anglesData]) // eslint-disable-line react-hooks/exhaustive-deps
  function openAngle(i: number) {
    const a = angleItems[i]
    if (!a) return
    setSubjectNotice(null)
    pause()
    seekToMs(a.jumpMs)
  }
  /** A click on a face of an angle: that person, marked at the angle's own moment */
  const [savingFace, setSavingFace] = useState<{ index: number; face: number } | null>(null)
  async function markAngleFace(i: number, k: number) {
    const a = angleItems[i], f = a?.faces[k]
    if (!f || f.subject || markingSubjectRef.current) return
    // (the face shows it is being saved until it turns into their letter)
    setSavingFace({ index: i, face: k })
    try { await markSubject(f.box.x + f.box.w / 2, f.box.y + f.box.h / 2, a.at) }
    finally { setSavingFace(null) }
  }
  function markByClick() {
    setSubjectNotice(null)
    pause()
    setMarking(m => !m)
  }

  /**
   * Auto format (user, 2026-10-24: "after Detect, the format should be made automatically"): every
   * place of every scene not formatted yet gets the format the user's decision table gives it, views
   * on its people (modules/editor/autoFormat.ts decideFormat — who talks there decides who goes at the
   * bottom); everyone is marked (each once — who they are) and Follow starts. A place formatted by
   * hand, or a scene with a group marked, stays as it is. The formats are one undo step.
   * Not detected yet (or the clip grew since): it detects first (runAutoFormat).
   */
  const [autoPhase, setAutoPhase] = useState<'idle' | 'detecting' | 'formatting'>('idle')
  /** Stop was pressed: Auto format goes no further */
  const stopAskedRef = useRef(false)
  /** Auto format is waiting for its scan: when the scenes are in, it formats */
  const autoAfterScanRef = useRef(false)
  /** This Auto format laid formats (Stop says they stay) */
  const formatsLaidRef = useRef(false)
  /** The following Auto format started, in its mode: when done, Cuts — views on two or more people hold;
   *  Vertical — the view goes to whoever talks (frameClipOnSubjects) */
  const autoFollowRef = useRef<AutoMode | null>(null)
  /**
   * Auto format's mode (user, 2026-10-28): 'vertical' — every scene Vertical, on whoever talks; 'cuts' — the
   * Rulebook's formats (decideFormat). With it, the places Auto format laid (source ms, so trimming doesn't
   * move them) and the groups it made: running it again — in either mode — redoes its own places; a place
   * formatted by hand stays. Kept in this browser, per clip (on another, its places count as by hand)
   */
  const autoKey = `chai-cut:auto-format:${savedClip.id}`
  const readAutoRecord = (): AutoRecord => {
    try {
      const r = JSON.parse(localStorage.getItem(autoKey) ?? 'null')
      if (r && (r.mode === 'vertical' || r.mode === 'cuts') && Array.isArray(r.places) && Array.isArray(r.groups)) return r
    } catch { /* none, or not readable */ }
    return { mode: 'cuts', places: [], groups: [] }
  }
  const writeAutoRecord = (r: AutoRecord) => { try { localStorage.setItem(autoKey, JSON.stringify(r)) } catch { /* private window: not kept */ } }
  const [autoMode, setAutoModeNow] = useState<AutoMode>('cuts')
  useEffect(() => { setAutoModeNow(readAutoRecord().mode) }, [autoKey]) // eslint-disable-line react-hooks/exhaustive-deps
  function setAutoMode(mode: AutoMode) {
    setAutoModeNow(mode)
    writeAutoRecord({ ...readAutoRecord(), mode })
  }
  function runAutoFormat() {
    if (autoPhase !== 'idle') return
    stopAskedRef.current = false
    formatsLaidRef.current = false
    if (anglesData?.status === 'done' && !anglesStale) { void autoFormat(); return }
    setSubjectNotice(null)
    setSubjectsError(null)
    setAutoPhase('detecting')
    autoAfterScanRef.current = true
    void loadAngles(true)
  }
  // Auto format's scan is done: format (or it failed: Auto format ends there, the panel says why)
  useEffect(() => {
    if (!autoAfterScanRef.current || !anglesData || anglesData.status === 'queued' || anglesData.status === 'running') return
    autoAfterScanRef.current = false
    setAutoPhase('idle')
    if (anglesData.status === 'done' && !stopAskedRef.current) void autoFormat()
  }, [anglesData, angleItems]) // eslint-disable-line react-hooks/exhaustive-deps
  async function autoFormat() {
    if (autoPhase === 'formatting' || markingSubjectRef.current || anglesData?.status !== 'done') return
    pause()
    setMarking(false)
    setSubjectNotice(null)
    setSubjectsError(null)
    setAutoPhase('formatting')
    markingSubjectRef.current = true
    try {
      const ar = getVideoAR()
      const mode = autoMode
      const record = readAutoRecord()
      const sectionsNow = () => useEditorStore.getState().segments.filter(x => !isShot(x, mainVideoId))
      /** Auto format laid this place in that format, and it is still as laid */
      const laidByAuto = ([a, b]: readonly [number, number], layout: string) => record.places.some(([x, y, l]) => l === layout
        && Math.abs(trim.toSource(a) - x) <= 150 && Math.abs(trim.toSource(b) - y) <= 150)
      // A place formatted by hand — exactly one section, as a format picked in this tool leaves it, and
      // not as Auto format laid it — or a scene with a group marked stays as it is
      const byHand = ([a, b]: readonly [number, number]) => {
        const over = sectionsNow().filter(x => x.end_ms > a + 50 && x.start_ms < b - 50)
        return over.length === 1 && Math.abs(over[0].start_ms - a) <= 150 && Math.abs(over[0].end_ms - b) <= 150 && !laidByAuto([a, b], over[0].layout)
      }
      const rows = angleItems.filter(r => r.people > 0)
      // A group whose saved views overlap or leave someone out (marked before these rules) is rebuilt by
      // the rules, not kept (the user, 2026-10-26: views never overlap; never ignore anyone)
      const rebuilt = new Set<AngleRow>()
      for (const row of rows) {
        if (!row.group) continue
        const g = subjects.find(x => x.shot && x.label === row.group!.label)
        if (!g?.shot) continue
        const boxes = [...g.shot.boxes].sort((p, q) => p.slot_index - q.slot_index)
        // (and in Vertical, a group Auto format made: a Split or Trio of its own — the user's groups stay)
        const madeByAuto = mode === 'vertical' && record.groups.includes(g.id)
        if (!madeByAuto && !viewsOverlap(boxes) && keepsAll(g.shot.layout as LayoutType, boxes, row.faces.filter(f => !f.pending).map(f => f.box))) continue
        try {
          await subjectsCall(`${subjectsUrl}?id=${encodeURIComponent(g.id)}`, { method: 'DELETE' })
          setSubjects(list => list.filter(x => x.id !== g.id))
          rebuilt.add(row)
        } catch { /* it stays as it was */ }
      }
      // Each place of each scene on its own (who talks differs between them: modules/editor/autoFormat.ts),
      // all decided first, then laid at once (one undo step)
      const decided = rows.filter(r => !r.group || rebuilt.has(r)).flatMap(row => row.places.filter(pl => rebuilt.has(row) || !byHand(pl.shown)).flatMap(pl => {
        // (people marked by hand and found count too; marks not found yet don't: where they are isn't known)
        const faces = row.faces.filter(f => !f.pending).map(f => f.box)
        const plan = mode === 'vertical' ? decideVertical(faces, pl.talk, ar) : decideFormat(faces, pl.talk, ar)
        return plan ? [{ row, shown: pl.shown, plan }] : []
      })).sort((p, q) => p.shown[0] - q.shown[0])
      // A very short place (under SHORT_PLACE) takes the format of the place right before it, so fast
      // cutting doesn't flicker (the Rulebook, section 6) — only when that format holds everyone in this
      // place too (never ignore anyone); the first, or one after a gap, keeps its own
      const plans = decided.map((x, i) => {
        const before = i > 0 ? decided[i - 1] : null
        const short = x.shown[1] - x.shown[0] < AUTO_FORMAT.SHORT_PLACE * 1000
        const fits = before && keepsAll(before.plan.layout, before.plan.framing, x.row.faces.filter(f => !f.pending).map(f => f.box))
        return mode === 'cuts' && short && before && fits && Math.abs(before.shown[1] - x.shown[0]) <= 150 ? { ...x, plan: before.plan } : x
      })
      // A scene of two or more that gets the same format and views in every place (who talks changes
      // nothing there: four people's Trio, say) becomes a group with it (user, 2026-10-24: the scene
      // showed "Mark as group" after Auto format): wherever its shot comes back, Follow gives it the
      // same — even a piece the scenes list missed. One whose speaker changes between places stays
      // as laid, place by place (it shows as formatted)
      const sameEverywhere = (row: AngleRow) => {
        const mine = plans.filter(x => x.row === row)
        if (row.people < 2 || mine.length !== row.places.length) return null
        const key = (x: typeof mine[number]) => JSON.stringify([x.plan.layout, x.plan.framing.map(b => [b.x, b.y, b.w, b.h].map(v => Math.round(v * 1000)))])
        return mine.every(x => key(x) === key(mine[0])) ? mine[0].plan : null
      }
      const groups = rows.flatMap(row => {
        const plan = sameEverywhere(row)
        return plan && (plan.layout === 'split' || plan.layout === 'trio')
          ? [{ at: row.at, layout: plan.layout, boxes: plan.framing.map((b, i) => ({ slot_index: i, x: b.x, y: b.y, w: b.w, h: b.h })) }]
          : []
      })
      const laid = { vertical: 0, split: 0, trio: 0, whole: 0 }
      const places: AutoRecord['places'] = []
      for (const { shown, plan } of plans) {
        if (stopAskedRef.current) break
        // (the whole picture: a frame showing all of the video — no views to place.) Each place its own
        // section, not joined to a neighbour in the same format: the scene shows as formatted, and the
        // next Auto format knows it as its own
        if (!applyFormatSpans([shown], plan.layout, plan.framing.length ? plan.framing : undefined, clipLengthMs, ar, mainVideoId).length) continue
        formatsLaidRef.current = true
        places.push([Math.round(trim.toSource(shown[0])), Math.round(trim.toSource(shown[1])), plan.layout])
        if (plan.why === 'whole') laid.whole++
        else if (plan.layout === 'vertical' || plan.layout === 'split' || plan.layout === 'trio') laid[plan.layout]++
      }
      // Who to follow: everyone whose face can be told (once each, where it is biggest), and the person
      // of a one-person scene even when it can't — a view on one person keeps on them as they move
      const people = new Map<string, { at: number; x: number; y: number; size: number }>()
      for (const row of rows) for (const f of row.faces) {
        if (f.subject || (f.box.person === undefined && row.people !== 1)) continue
        const key = f.box.person !== undefined ? `p${f.box.person}` : `s${row.at}`
        const size = f.box.w * f.box.h, best = people.get(key)
        if (!best || size > best.size) people.set(key, { at: row.at, x: f.box.x + f.box.w / 2, y: f.box.y + f.box.h / 2, size })
      }
      // (a person already marked is theirs: not marked again)
      const markedPersons = new Set(rows.flatMap(r => r.faces.filter(f => f.subject && f.box.person !== undefined).map(f => `p${f.box.person}`)))
      const added: SubjectRow[] = []
      for (const [key, m] of people) {
        if (stopAskedRef.current) break
        if (markedPersons.has(key)) continue
        try {
          const { subject } = await subjectsCall(subjectsUrl, { method: 'POST', body: JSON.stringify({ mark_ms: m.at, x: m.x, y: m.y }) })
          added.push({ ...subject, seen: null, stale: false })
        } catch { /* already marked, or the list is full: the rest go on */ }
      }
      for (const g of groups) {
        if (stopAskedRef.current) break
        try {
          const { subject } = await subjectsCall(subjectsUrl, { method: 'POST', body: JSON.stringify({ mark_ms: g.at, x: 0.5, y: 0.5, shot: { layout: g.layout, boxes: g.boxes } }) })
          added.push({ ...subject, seen: null, stale: false })
        } catch { /* the most groups a clip can have, say: the scene stays as laid */ }
      }
      if (added.length) setSubjects(list => [...list, ...added])
      // What Auto format laid and made, for the next time: its places from before that it decided again
      // drop out (laid again, or by hand since and left alone — not its own any more), and the groups it
      // took away
      const decidedSrc = plans.map(pl => [trim.toSource(pl.shown[0]), trim.toSource(pl.shown[1])] as const)
      const removedGroups = new Set(subjects.filter(x => x.shot && [...rebuilt].some(r => r.group?.label === x.label)).map(x => x.id))
      writeAutoRecord({
        mode,
        places: [...record.places.filter(([x, y]) => !decidedSrc.some(([a, b]) => Math.min(b, y) - Math.max(a, x) > 0)), ...places],
        groups: [...record.groups.filter(id => !removedGroups.has(id)), ...added.filter(x => x.shot).map(x => x.id)],
      })
      const scenes = laid.vertical + laid.split + laid.trio + laid.whole
      const what = [laid.vertical && `${laid.vertical} Vertical`, laid.split && `${laid.split} Split`, laid.trio && `${laid.trio} Trio`,
        laid.whole && `${laid.whole} whole picture (Blur fill, so nobody is cut out)`].filter(Boolean).join(', ')
      if (stopAskedRef.current) return
      if (!scenes && !added.length) {
        setSubjectNotice('Every scene already has its format — nothing to do.')
        return
      }
      // When the following is done: Cuts — a view on two or more people holds where it is; Vertical — the
      // view goes to whoever talks (frameClipOnSubjects)
      autoFollowRef.current = mode
      // Follow them (it runs in the background; the bar at the bottom shows it)
      await trackSubjectsNow(true)
      setSubjectNotice(mode === 'vertical'
        ? `${scenes ? `${scenes} ${scenes === 1 ? 'place' : 'places'} made Vertical. ` : ''}Following them now — the view cuts to whoever is talking, at least ${AUTO_FORMAT.MIN_HOLD} seconds on each. Undo takes the formats back.`
        : `${scenes ? `${scenes} ${scenes === 1 ? 'place' : 'places'} formatted (${what}). ` : ''}Following them now — the views keep on the people as they move. Undo takes the formats back.`)
    } catch (e) {
      setSubjectsError(e instanceof Error ? e.message : 'Auto format didn’t finish')
    } finally {
      markingSubjectRef.current = false
      setAutoPhase('idle')
    }
  }
  /**
   * Stop (next to Detect and Auto format): whatever is running stops — Auto format at the step it is
   * on, the scan (back to the scenes found before it), the following (the people stay marked, ready to
   * follow again). Formats Auto format already laid stay; Undo takes them back.
   */
  async function stopSubjectsWork() {
    stopAskedRef.current = true
    autoAfterScanRef.current = false
    setAutoPhase('idle')
    // At once on screen (user, 2026-10-31: Stop waited on a slow server and the scan carried on showing):
    // the scan goes back to the scenes found before it (none: not detected yet), the people being
    // followed are marked again, and answers to requests sent before now are ignored
    const gen = ++stopGenRef.current
    setAnglesData(a => a && (a.status === 'queued' || a.status === 'running')
      ? (lastDoneAnglesRef.current ?? { status: 'none', progress: 0, error: null, angles: [], scan_start_ms: null, scan_end_ms: null })
      : a)
    setSubjects(list => list.map(s => (s.status === 'queued' || s.status === 'running' ? { ...s, status: 'new', progress: 0 } : s)))
    setSubjectsError(null)
    // (no "Stopped." line — user, 2026-10-31: the buttons going back say it; only the Undo hint stays, when formats were laid)
    setSubjectNotice(formatsLaidRef.current ? 'The formats already laid stay — Undo takes them back.' : null)
    // Then the server, which stops the worker's jobs: tried again while the database is slow (each try up to 20 s)
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), 20_000)
      try {
        const data = await subjectsCall(`${subjectsUrl}/stop`, { method: 'POST', signal: ctl.signal })
        if (gen === stopGenRef.current) {
          takeSubjects(data.subjects)
          if (data.angles) setAnglesData(data.angles)
        }
        return
      } catch (e) {
        if (attempt === 2) setSubjectsError(`Stop didn’t reach the server (${e instanceof Error && e.name !== 'AbortError' ? e.message : 'the connection is slow'}). Press Stop again.`)
      } finally { clearTimeout(t) }
    }
  }

  // The frame on screen: its own time in the video (see frameStartAt)
  const shownFrameRef = useRef<number | null>(null)
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    return trackPresentedFrame(v, ms => { shownFrameRef.current = ms })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  /** The start of the frame on screen at clip time `t` (ms, on the clip's timeline), or `t` when not known */
  function frameStartAt(t: number): number {
    const src = shownFrameRef.current
    if (src == null) return t
    const shown = Math.floor(videoToTimeline ? videoToTimeline(src) : src - clip.start_ms)
    // (only the frame that covers the playhead: a frame lasts well under 0.1 s)
    return shown <= t + 0.5 && t - shown < 100 ? Math.max(0, shown) : t
  }

  // Frames work like the Format layouts: picking one mid-section starts a new frame at the playhead
  // (e.g. Single 0:00–0:15, then Dual Video from 0:15), each with its own ◆ keys and lanes
  // A Branded card picked: it's filled from the brand kit once it's there (see below)
  const brandFillRef = useRef<{ t: number; until: number } | null>(null)
  function handleApplyFrame(layout: FrameLayout) {
    // (with the brand kit on, the brand-on watcher below dresses it, from the kit that's on)
    brandFillRef.current = layout === 'frame_brand_card' && !useBrandStore.getState().on ? { t: currentTimeMs, until: Date.now() + 4000 } : null
    handleLayoutChange(layout, 'fromPlayhead')
  }
  // What a layout or frame picked now will cover (see handleLayoutChange)
  const frameTarget = (() => {
    const t = currentTimeMs
    if (activeSegment) {
      const whole = t - activeSegment.start_ms <= LAYOUT_SNAP_MS || activeSegment.end_ms - t <= LAYOUT_SNAP_MS
      return `${msToLabel(whole ? activeSegment.start_ms : t)}–${msToLabel(activeSegment.end_ms)}`
    }
    if (currentGap) return `${msToLabel(t - currentGap.start_ms <= LAYOUT_SNAP_MS ? currentGap.start_ms : t)}–${msToLabel(currentGap.end_ms)}`
    return null
  })()

  // ── Frame lanes ─────────────────────────────────────────────────────────────
  const frameSeg = activeSegment && isFrameLayout(activeSegment.layout) ? activeSegment : null
  // A selection belongs to the frame it was made in
  // (a pick made in the Frames list for another frame lands once the playhead has moved there)
  const pendingFrameSelectRef = useRef<string | null>(null)
  useEffect(() => {
    setActiveFrameItemId(pendingFrameSelectRef.current)
    pendingFrameSelectRef.current = null
    setAddMenu(null)
  }, [frameSeg?.id])

  // Text (band text, text cards, captions) is edited in the Text tool; photos, videos and the main video in Frames
  function selectFrameItem(id: string | null, segId = frameSeg?.id, open = true) {
    if (segId && segId !== frameSeg?.id) pendingFrameSelectRef.current = id
    else setActiveFrameItemId(id)
    if (id) setLastPick('frameItem')
    if (!id || !open) return
    const seg = segments.find(x => x.id === segId)
    const it = seg ? frameOf(seg).items?.find(x => x.id === id) : undefined
    setTool(it?.kind === 'text' ? 'text' : 'frames')
    toggleOptions(true)
  }

  function addToLane(segId: string, lane: FrameLane, t: number, item: Omit<FrameItem, 'id' | 'lane' | 'start_ms' | 'end_ms'>) {
    const id = addFrameItem(segId, lane, t, item)
    if (id) {
      setActiveFrameItemId(id)
      setTool(item.kind === 'text' ? 'text' : 'frames')
      toggleOptions(true)
    }
    else setLaneHighlight(h => ({ lane, n: (h?.n ?? 0) + 1 }))
    return id
  }

  // Text on a frame's band: added straight away at the playhead, then typed in the Text tool
  /** Text on a frame's band (or its second text area: a name tag, a badge, a ticker) at `t` */
  function addBandText(segId: string, t: number, lane: TextLane = 'band') {
    const seg = segments.find(x => x.id === segId)
    if (!seg || sectionBlocked(segId)) return
    pause()
    // The text area's own look where it has one (a white comment bubble, a lime badge…)
    const look = textLaneLook(seg, lane)
    addToLane(segId, lane, t, { kind: 'text', text: '', bg: look.bg, color: look.color, size: look.size })
  }

  function handleAddChoice(choice: AddChoice) {
    if (!addMenu) return
    const { segId, lane, t } = addMenu
    setAddMenu(null)
    if (sectionBlocked(segId)) return
    const seg = segments.find(x => x.id === segId)
    if (!seg) return
    if (choice === 'photo' || choice === 'video') { setFramePicker({ segId, kind: choice, lane, t }); return }
    // Text on the band — the band appears with its first text
    if (choice === 'bandtext') { addBandText(segId, t, isTextLane(lane) ? lane : 'band'); return }
    if (choice === 'main') {
      const f = frameOf(seg)
      const main = f.main_slots ?? [0]
      // "Same video" is the same sound as the slot already showing it, so this slot starts muted
      // (its own sound setting; unmute it to hear both)
      if (typeof lane === 'number' && !main.includes(lane)) {
        updateFrame(segId, {
          main_slots: [...main, lane].sort(),
          main_mutes: { ...f.main_mutes, [String(lane)]: main.length > 0 },
          main_volumes: { ...f.main_volumes, [String(lane)]: 1 },
        })
      }
      selectFrameItem(`main:${lane}`)
    }
  }

  function handlePickedVideo(videoId: string) {
    const p = framePicker
    setFramePicker(null)
    if (!videoLibraryRef.current[videoId]) loadVideoLibrary()
    if (!p) return
    if (p.replaceId) { updateFrameItem(p.segId, p.replaceId, { kind: 'video', source_video_id: videoId, source_offset_ms: 0, image_path: null, image_url: null }); return }
    if (p.lane !== undefined) addToLane(p.segId, p.lane, p.t ?? currentTimeMs, { kind: 'video', source_video_id: videoId, source_offset_ms: 0, volume: 1, muted: false, corners: cornersFor(p.segId, p.lane) })
  }

  function handlePickedPhoto(storagePath: string, url: string) {
    const p = framePicker
    setFramePicker(null)
    if (!p) return
    if (p.replaceId) { updateFrameItem(p.segId, p.replaceId, { kind: 'photo', image_path: storagePath, image_url: url || null, source_video_id: null }); return }
    if (p.lane !== undefined) addToLane(p.segId, p.lane, p.t ?? currentTimeMs, { kind: 'photo', image_path: storagePath, image_url: url || null, motion: 'none', corners: cornersFor(p.segId, p.lane) })
  }
  /** Corners a photo or video put in a frame's slot starts with: the frame's own (newItemCorners) */
  function cornersFor(segId: string, lane: FrameLane): number {
    const seg = segments.find(x => x.id === segId)
    return seg && isFrameLayout(seg.layout) && typeof lane === 'number' ? newItemCorners(seg.layout, lane) : 0
  }

  /**
   * Where a photo or video put in at `atMs` goes when a frame shows there. Dropped on one of its
   * lanes (`frame:<slot>`): that slot — or `refused` (with why) when the slot doesn't take it.
   * Added without a lane (the Media library's +): the first slot that takes it and is free at that
   * moment (no photo or video of its own, not showing the main video). Null: not into a frame
   * (it goes on top, as anywhere else).
   */
  function frameSlotFor(atMs: number, lane: string | null, kind: 'video' | 'photo'): { segId: string; slot: number } | 'refused' | null {
    const seg = sections.find(s => atMs >= s.start_ms && atMs < s.end_ms && isFrameLayout(s.layout))
    if (!seg || !isFrameLayout(seg.layout)) return null
    const m = lane ? /^frame:(.+)$/.exec(lane) : null
    const what = kind === 'photo' ? 'a photo' : 'a video'
    if (m) {
      // The row's lane in this frame (a frame swapped with the bar's swap has its own order)
      const inRow = laneInRowKey(seg, m[1])
      const slot = inRow ? (typeof inRow.lane === 'number' ? inRow.lane : NaN) : Number(m[1])
      if (!Number.isInteger(slot)) { notifyLocked(`That’s a text area: drop ${what} on a picture lane`); return 'refused' }
      if (slot >= frameSlotCount(seg.layout) || !slotOffers(seg.layout, slot)[kind]) {
        notifyLocked(`This slot doesn’t take ${what}`); return 'refused'
      }
      if (sectionBlocked(seg.id)) return 'refused'
      return { segId: seg.id, slot }
    }
    if (lane !== null || sectionBlocked(seg.id)) return null
    const f = frameOf(seg)
    const main = f.main_slots ?? [0]
    for (let slot = 0; slot < frameSlotCount(seg.layout); slot++) {
      if (!slotOffers(seg.layout, slot)[kind] || main.includes(slot) || itemAt(f, slot, atMs, seg)) continue
      return { segId: seg.id, slot }
    }
    return null
  }
  /** A video from the user's library put in a frame's slot at `atMs` */
  function videoIntoSlot(target: { segId: string; slot: number }, videoId: string, atMs: number) {
    pause()
    seekToMs(atMs)
    addToLane(target.segId, target.slot, atMs, { kind: 'video', source_video_id: videoId, source_offset_ms: 0, volume: 1, muted: false, corners: cornersFor(target.segId, target.slot) })
  }
  /** A stored photo put in a frame's slot at `atMs` */
  function photoIntoSlot(target: { segId: string; slot: number }, storagePath: string, url: string | null, atMs: number) {
    pause()
    seekToMs(atMs)
    addToLane(target.segId, target.slot, atMs, { kind: 'photo', image_path: storagePath, image_url: url || null, motion: 'none', corners: cornersFor(target.segId, target.slot) })
  }

  // "+" in the preview (or an empty lane in the panel) points at the lane on the timeline.
  // On the band it adds the text right away: it shows up on the band lane, ready to type and time.
  function focusLane(lane: FrameLane) {
    pause()
    // Band: the new text's box takes the keyboard focus, so the lane's "+" doesn't.
    // Slot: the lane's own "+" menu opens on the timeline (same video / upload video / photo).
    setLaneHighlight(h => ({ lane, n: (h?.n ?? 0) + 1, focusPlus: !isTextLane(lane), openMenu: !isTextLane(lane) }))
    if (isTextLane(lane) && frameSeg) addBandText(frameSeg.id, currentTimeMs, lane)
  }

  // Frames list: pick something in a frame. The playhead moves onto it unless it's already showing.
  function selectInFrame(segId: string, id: string | null, atMs?: number) {
    const seg = segments.find(x => x.id === segId)
    if (!seg) return
    const it = id ? frameOf(seg).items?.find(x => x.id === id) : undefined
    const from = it ? Math.max(it.start_ms, seg.start_ms) : seg.start_ms
    const to = it ? Math.min(it.end_ms, seg.end_ms) : seg.end_ms
    if (id && atMs !== undefined && (currentTimeMs < from || currentTimeMs >= to)) { pause(); seekToMs(atMs) }
    selectFrameItem(id, segId)
  }

  function openFrame(segId: string) {
    const seg = segments.find(x => x.id === segId)
    if (!seg) return
    setActiveSegmentId(seg.id)
    if (currentTimeMs < seg.start_ms || currentTimeMs >= seg.end_ms) seekToMs(seg.start_ms)
  }

  function removeFrame(segId: string) {
    pause()
    skipCanvasTransitionRef.current = true
    applyLayout(segId, 'vertical', getVideoAR())
  }

  // ── Reset all edits ─────────────────────────────────────────────────────────
  // Back to how the clip was made: its original start and end (before any drag of its ends), no
  // part of it cut out, one Vertical format over the whole of it, no frames, text, media, music,
  // transitions or filters, pauses kept, and the default caption look. The captions themselves
  // (words, language, on/off) stay. It's one undo step, so Undo brings everything back.
  const [confirmResetAll, setConfirmResetAll] = useState(false)
  function handleResetAll() {
    setConfirmResetAll(false)
    pause()
    skipCanvasTransitionRef.current = true
    setActiveFrameItemId(null)
    setActiveTextOverlayId(null)
    setSelectedView(null)
    edgeBaseRef.current = null
    // Where the clip was made: kept when its ends were first dragged (else: as it was loaded)
    const made = savedClip as typeof savedClip & { original_start_ms?: number | null; original_end_ms?: number | null }
    const origStart = made.original_start_ms ?? savedClip.start_ms
    const origEnd = made.original_end_ms ?? savedClip.end_ms
    useEditorStore.setState({
      segments: [], keyframes: {}, trims: [], activeSegmentId: null, activeBoxId: null,
      clipRange: origStart === savedClip.start_ms && origEnd === savedClip.end_ms ? null : [origStart, origEnd],
    })
    seekAfterTrimRef.current = 0
    // The playhead goes back to the start of the clip, once the reset clip is in place (the
    // removed-parts effect does it only when those changed; this always does, and clears its ask)
    setTimeout(() => { seekAfterTrimRef.current = null; seekToMs(0) }, 0)
    addFormat(0, origEnd - origStart, 'vertical', getVideoAR())
    if (removeFillers) setRemoveFillers(false)
    useMediaStore.setState({
      overlays: [], textOverlays: [], audioTracks: [], transitions: [],
      filters: { brightness: 100, contrast: 100, saturation: 100 }, activeOverlayId: null,
    })
    // Explicit defaults (not blanks): the save only writes caption fields that have a value
    useCaptionStore.setState(st => ({
      // (one caption style for the whole clip again: no parts)
      captionParts: [], pickedCaptionPart: null,
      captionStyle: { ...st.captionStyle, font: null, size: null, color: '#FFE700', position: null, position_y: null, position_x: null, animation: 'karaoke', template: null },
    }))
    // The video's own sound: full volume, not muted; and nothing stays selected
    setOriginalVolume(1)
    setOriginalMuted(false)
    setPickedSegIdState(null)
    setPickedMusicId(null)
    // Everyone marked in Subjects goes too (they're saved on their own: Undo doesn't bring them back)
    setMarking(false)
    setSubjectNotice(null)
    setSubjects([])
    wasBusyRef.current = false
    fetch(`${subjectsUrl}?all=1`, { method: 'DELETE' })
      .then(r => { if (!r.ok) throw new Error() })
      .catch(() => { setSubjectsError('The marked people could not be removed. Try again.'); loadSubjects() })
  }
  useEffect(() => {
    if (!confirmResetAll) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setConfirmResetAll(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmResetAll])

  function trimSelectedTo(edge: 'start' | 'end') {
    if (!activeSegment) return
    setSegmentEdge(activeSegment.id, edge, currentTimeMs, clipLengthMs)
  }

  function handleResetPositions() {
    const first = [...sections].sort((a, b) => a.start_ms - b.start_ms)[0]
    if (!first) return
    if (hasInserts) { notifyLocked('Remove the inserted videos first: resetting would cover them'); return }
    if (sections.some(x => x.locked)) { notifyLocked('Some sections are locked — unlock them first'); return }
    sections.filter(s => s.id !== first.id).forEach(s => removeSegment(s.id))
    updateSegment(first.id, { start_ms: 0, end_ms: clipLengthMs })
    setActiveSegmentId(first.id)
  }

  // (never taken out, leaving time with no part: that would be "default framing". Its look goes
  // back to Vertical instead; empty space stays empty)
  function handleDeleteFormat(segId: string) {
    const seg = cropPositions.find(s => s.id === segId)
    if (!seg) return
    if (isGapPart(seg, mainVideoId)) { notifyLocked('This empty space can’t be cut out here: a clip must stay at least a second long'); return }
    pause()
    skipCanvasTransitionRef.current = true
    applyLayout(seg.id, 'vertical', getVideoAR())
  }

  // ── Every delete asks first ─────────────────────────────────────────────────
  const { confirm, dialog: confirmDialog } = useConfirm()
  const UNDO_NOTE = 'You can undo this.'

  // ── Brand kit (user, 2026-10-17) ──────────────────────────────────────────────
  // The account's kits (components/editor/BrandKit.tsx); Apply puts one on this clip as ordinary
  // edits — a photo, text styles, frame colours — so it shows in the Preview and the export, and
  // one Undo takes it all back.
  const brand = useBrandKits()
  /**
   * The brand kit the server has on this clip, as this editor last loaded or saved it (brand kit
   * Phase 2). Back in view, a different one there means it was changed elsewhere — "Put on all" on
   * the clip board — while this clip was open: the editor makes the same change itself (the same
   * brand engine), so its next save keeps it instead of putting back what it had. Unsaved edits stay.
   */
  const serverKitRef = useRef<string | null>(initialBrand?.kit_id ?? null)
  const brandSyncRef = useRef<{ on: (kit: BrandKit) => void; off: () => void; kits: BrandKit[] } | null>(null)
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return
      fetch(`/api/clips/${clip.id}/brand`).then(r => (r.ok ? r.json() : null)).then((d: { kit_id: string | null } | null) => {
        const sync = brandSyncRef.current
        if (!d || !sync) return
        const there = d.kit_id ?? null
        if (there === serverKitRef.current) return
        const here = useBrandStore.getState().on?.kit_id ?? null
        if (there === here) { serverKitRef.current = there; return }
        if (!there) {
          sync.off(); serverKitRef.current = null
          notifyLocked('The brand was taken off this clip on the clip board', 3500)
          return
        }
        // (a kit this editor doesn't list yet: tried again next time it's back in view, once the kits are read again)
        const kit = sync.kits.find(k => k.id === there)
        if (!kit) return
        sync.on(kit); serverKitRef.current = there
        notifyLocked(`${kit.name} was put on this clip on the clip board`, 3500)
      }).catch(() => { /* checked again next time */ })
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check) }
  }, [clip.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // The brand colours shown first in the colour choices: the default kit's, else the one picked
  const paletteKit = brand.kits.find(k => k.data.is_default) ?? brand.current
  const paletteKey = paletteKit ? brandPalette(paletteKit.data).join(',') : ''
  useEffect(() => { setBrandPalette(paletteKey ? paletteKey.split(',') : []) }, [paletteKey])
  useEffect(() => () => setBrandPalette([]), [])
  // Brand lock (brand kit Phase 6): the kit on this clip, shared with this user to use (not to edit) and
  // locked by its owner — the colour and font choices offer only its own, the clip keeps to them (below,
  // as the server does when it's saved: brandTeam.ts lockClipLook), and only the owner takes it off
  const lockKit = brandOn ? brand.kits.find(k => k.id === brandOn.kit_id && !!k.shared_by && lockHolds(k.data, k.role ?? 'use')) ?? null : null
  const lockKey = lockKit ? JSON.stringify({ by: lockKit.shared_by!, ...brandLockOf(lockKit.data) }) : ''
  useEffect(() => { setBrandLock(lockKey ? JSON.parse(lockKey) as { by: string; colors: string[]; fonts: string[] } : null) }, [lockKey])
  useEffect(() => () => setBrandLock(null), [])
  const lockSetKey = lockKit ? JSON.stringify(lockSetOf(lockKit.data)) : ''
  const lockParts = useCaptionStore(st => st.captionParts)
  useEffect(() => {
    if (!lockSetKey) return
    const set = JSON.parse(lockSetKey) as LockSet
    const cap = useCaptionStore.getState()
    const kept = lockClipLook({ texts: useMediaStore.getState().textOverlays, caption: cap.captionStyle, parts: cap.captionParts, segments: useEditorStore.getState().segments }, set)
    if (!kept.changed) return
    if (kept.texts.some((t, i) => t !== useMediaStore.getState().textOverlays[i])) setTextOverlays(kept.texts)
    if (kept.caption !== cap.captionStyle) useCaptionStore.setState({ captionStyle: kept.caption })
    if (kept.parts.some((x, i) => x !== cap.captionParts[i])) cap.setCaptionParts(kept.parts)
    if (kept.segments.some((x, i) => x !== useEditorStore.getState().segments[i])) useEditorStore.setState({ segments: kept.segments })
  }, [lockSetKey, textOverlays, captionStyle, lockParts, segments]) // eslint-disable-line react-hooks/exhaustive-deps
  // Every kit's own fonts in the font pickers (and loaded, so text in them draws)
  const fontsKey = brand.kits.flatMap(k => k.data.fonts.map(f => `${f.family}=${f.name}`)).join('|')
  useEffect(() => {
    setBrandFonts(fontsKey ? fontsKey.split('|').map(x => { const [family, ...n] = x.split('='); return { family, name: n.join('=') } })
      .filter((f, i, all) => all.findIndex(y => y.family === f.family) === i) : [])
  }, [fontsKey])
  useEffect(() => () => setBrandFonts([]), [])
  // Brand fonts this clip's captions and text are in (a kit since deleted, too): loaded to draw them
  const usedFonts = [captionStyle.font, ...textOverlays.map(t => t.font)].filter(Boolean).join('|')
  useEffect(() => { usedFonts.split('|').forEach(f => { ensureBrandFont(f) }) }, [usedFonts])

  // The Branded card just picked in Frames, once it's on the timeline (a pick can ask first)
  useEffect(() => {
    const pick = brandFillRef.current, kit = brand.current
    if (!pick) return
    if (!kit || Date.now() > pick.until) { brandFillRef.current = null; return }
    const seg = segments.find(x => x.layout === 'frame_brand_card' && pick.t >= x.start_ms - LAYOUT_SNAP_MS && pick.t < x.end_ms)
    if (!seg) return
    brandFillRef.current = null
    if ((frameOf(seg).items ?? []).some(it => it.kind === 'text')) return
    useEditorStore.setState(st => ({ segments: st.segments.map(x => (x.id === seg.id ? fillBrandCard(x, kit) : x)) }))
  }, [segments]) // eslint-disable-line react-hooks/exhaustive-deps

  /** This clip's parts as the brand engine takes them (modules/brand/engine.ts): the stores' values now, not this render's */
  function brandTarget(): BrandTarget {
    const m = useMediaStore.getState(), c = useCaptionStore.getState()
    return {
      clipId: clip.id, lengthMs: clipLengthMs, mainVideoId: mainVideoId ?? null,
      overlays: m.overlays, texts: m.textOverlays, caption: c.captionStyle, textCase: c.captionTextCase,
      segments: useEditorStore.getState().segments, progressBar: progressBarRef.current, avoid: brandAvoid(),
      keyframes: useEditorStore.getState().keyframes, transitions: m.transitions, timelineEdits: true,
      // (removed parts the older way: the clip first becomes pieces — brandNeedsPieces — then the intro and outro go in)
      audioTracks: m.audioTracks, canInsert: !trimmed, videoAt: t => videoAtPieces(allPieces, t),
    }
  }
  /**
   * The kit has an intro or outro the clip couldn't take yet (its parts removed the older way): the
   * clip becomes pieces, and once it has, the brand follows the kit again (the effect below)
   */
  function brandNeedsPieces(kit: BrandKit, applied: BrandKit['data']) {
    if (trimmed && (!sameEndVideo(kit.data.ends.intro, applied.ends.intro) || !sameEndVideo(kit.data.ends.outro, applied.ends.outro))) trimsToPieces()
  }
  /**
   * What the kit's logo keeps off on this clip (brand kit Phase 4, smart spot): the captions' band, and
   * the tracked faces in its full-frame parts (one view of the main video), about once a second — a
   * face seen longer weighs more
   */
  function brandAvoid(): FrameRect[] {
    const c = useCaptionStore.getState(), { segments: segs, keyframes: kfs } = useEditorStore.getState()
    const out: FrameRect[] = []
    if (c.captionStyle.enabled !== false) out.push(captionBand(c.captionStyle.position_y ?? captionDefaultY(c.captionStyle)))
    const tracked = subjects.filter(s => s.status === 'done' && !s.shot && s.path?.length) as Array<SubjectRow & { path: SubjectPoint[] }>
    if (!tracked.length) return out
    const cuts = subjectCuts(tracked)
    for (const seg of segs) {
      const box = seg.crop_boxes.length === 1 ? seg.crop_boxes[0] : null
      if (seg.layout !== 'vertical' || !box || box.image_path || (box.source_video_id && box.source_video_id !== mainVideoId)) continue
      for (let t = seg.start_ms; t < seg.end_ms; t += 1000) {
        const v = getBoxPositionAtLerp(t, kfs[box.id] ?? box.keyframes ?? [])
        if (v.w <= 0 || v.h <= 0) continue
        for (const p of tracked) {
          const f = subjectBoxAt(p.path, trim.toSource(t), cuts)
          if (!f) continue
          const x = (f.x - v.x) / v.w, y = (f.y - v.y) / v.h, w = f.w / v.w, h = f.h / v.h
          if (x + w > 0 && x < 1 && y + h > 0 && y < 1) out.push({ x, y, w, h })
        }
      }
    }
    return out
  }
  /** What the brand engine gave, written back: only the parts it changed (one undo step with the rest of the change) */
  function writeBrand(was: BrandTarget, t: BrandTarget) {
    const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)
    if (!same(t.overlays, was.overlays)) setOverlays(t.overlays)
    if (!same(t.texts, was.texts)) setTextOverlays(t.texts)
    const cur = was.caption as unknown as Record<string, unknown>, next = t.caption as unknown as Record<string, unknown>
    const patch = Object.fromEntries(Object.keys(next).filter(k => !same(next[k], cur[k])).map(k => [k, next[k]])) as Partial<CaptionStyle>
    if (Object.keys(patch).length) updateCaptionStyle(patch)
    if (t.textCase !== was.textCase) setCaptionTextCase(t.textCase as typeof captionTextCase)
    // (an end card, intro or outro changes the parts, their views and the transitions together; an intro
    // or outro taken out leaves the clip as long as its video again — as removeInsert does)
    if (t.keyframes !== was.keyframes) {
      const editor = useEditorStore.getState()
      const fewer = insertsOf(t.segments, mainVideoId).length < insertsOf(was.segments, mainVideoId).length
      skipCanvasTransitionRef.current = true
      editor.applyTrim(t.segments, t.keyframes, editor.trims, fewer ? rangeAfterPieces(t.segments) : undefined)
    } else if (!same(t.segments, was.segments)) useEditorStore.setState({ segments: t.segments })
    if (t.transitions !== was.transitions) useMediaStore.getState().setTransitions(t.transitions)
    if (t.audioTracks !== was.audioTracks) useMediaStore.setState({ audioTracks: t.audioTracks })
    // (the bar isn't in Undo: it's changed back in the Brand kit panel)
    if (!same(t.progressBar, was.progressBar)) { progressBarRef.current = t.progressBar; setProgressBar(t.progressBar) }
  }

  /** A locked team kit is on this clip (Phase 6): it stays — said why */
  function lockedOn(): boolean {
    if (!lockKit) return false
    notifyLocked(`${lockKit.shared_by} locked “${lockKit.name}”: only they can take it off this clip`, 3200)
    return true
  }

  /** The brand kit switched on for this clip (user, 2026-10-19): a different kit on before comes off first. One undo step. */
  function turnBrandOn(kit: BrandKit) {
    const cur = useBrandStore.getState().on
    if (cur && cur.kit_id !== kit.id && lockedOn()) return
    if (cur) turnBrandOff()
    const was = brandTarget()
    const r = putBrandOn(was, kit)
    writeBrand(was, r.target)
    // (the kit's settings as they went on: when they change, the clip follows — updateBrand)
    setBrandOn({ kit_id: kit.id, before: r.before, applied: r.applied })
    if (r.note) notifyLocked(r.note)
    brandNeedsPieces(kit, r.applied)
  }

  /**
   * The brand kit switched off (the brand engine's takeBrandOff): what it put on comes off and what
   * it changed goes back where the user hasn't changed it since — its end card too. One undo step.
   */
  function turnBrandOff() {
    const on = useBrandStore.getState().on
    if (!on || lockedOn()) return
    const kit = brand.kits.find(k => k.id === on.kit_id) ?? null
    // (the kit as it is, else — deleted since — as it was when it last went on: its text and caption
    // styles still come off)
    const d = kit?.data ?? on.applied ?? null, b = on.before
    const was = brandTarget()
    writeBrand(was, takeBrandOff(was, d, b))
    setBrandOn(null)
  }

  // While the brand is on: every frame picked gets it (a new section, or a section given another
  // frame), and the logo keeps covering the whole clip when the kit shows it throughout. In the same
  // undo step as the pick (history.ts groups a burst of changes).
  // The brand kit new text, its ready styles and caption looks come from (brand kit Phase 3): the one
  // on this clip, else the account's default one
  const styleKit = (brandOn ? brand.kits.find(k => k.id === brandOn.kit_id) : undefined) ?? brand.kits.find(k => k.data.is_default) ?? null
  // (its words on the captions: the same kit — brandedWords above)
  const styleWordsKey = JSON.stringify(styleKit?.data.words ?? null)
  useEffect(() => { setCaptionBrandWords(styleKit?.data.words ?? null) }, [styleWordsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const BRAND_TEXT: Array<{ id: BrandTextKind; name: string; text: string }> = [
    { id: 'title', name: 'Title', text: 'Your title' },
    { id: 'subtitle', name: 'Subtitle', text: 'Your subtitle' },
    // (the kit's own main line, brand kit Phase 5)
    { id: 'cta', name: 'Call to action', text: styleKit?.data.words?.lines[0] ?? 'Follow for more' },
  ]
  const brandTextStyles = styleKit ? BRAND_TEXT.map(x => ({ ...x, look: brandTextLook(brandTextStyle(styleKit.data, x.id)) })) : null
  /** The kit's title font on every text and frame text of this clip (locked ones stay): one undo step */
  function brandFontOnAll() {
    const font = styleKit?.data.title.font
    if (!font) return
    setTextOverlays(prev => prev.map(t => (t.locked ? t : { ...t, font })))
    useEditorStore.setState(st => ({
      segments: st.segments.map(seg => {
        if (!isFrameLayout(seg.layout) || seg.locked) return seg
        const f = frameOf(seg)
        return { ...seg, frame: { ...f, items: (f.items ?? []).map(it => (it.kind === 'text' && !it.captions && !it.locked ? { ...it, font } : it)) } }
      }),
    }))
    notifyLocked(`All text is in ${font} now`, 2600)
  }
  // (the clip board check above uses these: this render's, so never stale ones)
  brandSyncRef.current = { on: turnBrandOn, off: turnBrandOff, kits: brand.kits }
  const kitOn = brandOn ? brand.kits.find(k => k.id === brandOn.kit_id) ?? null : null
  // The kit on this clip is gone (deleted, or no longer shared with this user): the clip keeps its
  // look, the switch goes off — it pointed at a kit no list had, so every kit said "another kit is
  // on" and none could switch it off. Only once the kits are read (not while they load or failed).
  useEffect(() => {
    if (brandOn && !brand.loading && !brand.error && !brand.kits.some(k => k.id === brandOn.kit_id)) setBrandOn(null)
  }, [brandOn, brand.kits, brand.loading, brand.error])
  useEffect(() => {
    const on = useBrandStore.getState().on
    if (!on || !kitOn) return
    const was = brandTarget()
    const r = brandNewFrames(was, kitOn, on.before)
    if (!r) return
    writeBrand(was, r.target)
    setBrandOn({ ...on, before: r.before })
  }, [segments, kitOn?.id, clipLengthMs]) // eslint-disable-line react-hooks/exhaustive-deps
  // The kit changed since it went on this clip (a new logo, other colours — here, on the Brands page,
  // by a teammate): the clip follows it, where it still shows what the kit put there (updateBrand).
  // A clip branded before the kit's settings were kept with it takes the kit as it is now, and
  // follows it from there.
  useEffect(() => {
    const on = useBrandStore.getState().on
    if (!on || !kitOn) return
    if (!on.applied) { setBrandOn({ ...on, applied: kitOn.data }); return }
    if (!brandChanged(on.applied, kitOn.data)) return
    const was = brandTarget()
    const r = updateBrand(was, on.applied, kitOn, on.before)
    writeBrand(was, r.target)
    setBrandOn({ ...on, before: r.before, applied: r.applied })
    if (r.note) notifyLocked(r.note)
    brandNeedsPieces(kitOn, r.applied)
  }, [kitOn, trimmed]) // eslint-disable-line react-hooks/exhaustive-deps

  function askDeleteBrandKit(kit: BrandKit) {
    confirm({
      title: `Delete “${kit.name}”?`,
      body: 'The kit goes from your account. Clips it was put on keep their look.',
      confirmLabel: 'Delete kit',
    }, () => { brand.remove(kit.id).catch(() => brand.reload()) })
  }

  /**
   * Cut timeline [a, b) out of the clip and close the gap (trimState.ts rippleDelete): that part
   * of the video is removed, what was only in it goes with it, what comes after moves up. One
   * undo step. Saved as a removed part of the source video; the export cuts it out.
   */
  function removePart(a: number, b: number) {
    pause()
    const editor = useEditorStore.getState(), media = useMediaStore.getState()
    const state: TimedState = {
      segments: editor.segments, keyframes: editor.keyframes,
      overlays: media.overlays, textOverlays: media.textOverlays, audioTracks: media.audioTracks, transitions: media.transitions,
    }
    const locked = lockedInRange(state, a, b)
    if (locked.length) { notifyLocked(`${locked[0][0].toUpperCase()}${locked[0].slice(1)} in this part is locked — unlock it first`); return }
    if (piecesOn) {
      // A clip of pieces: the parts keep their moments of the video, what follows moves up
      if (segments.some(s => isInsert(s, mainVideoId) && s.start_ms < b && s.end_ms > a && !(s.start_ms >= a && s.end_ms <= b))) {
        notifyLocked('Part of an inserted video is in the way: delete the inserted video itself instead'); return
      }
      const next = rippleCut(state, Math.round(a), Math.round(b), rippleDelete)
      skipCanvasTransitionRef.current = true
      seekAfterInsertRef.current = a
      editor.applyTrim(next.segments, next.keyframes, editor.trims, rangeAfterPieces(next.segments))
      useMediaStore.setState({ overlays: next.overlays, textOverlays: next.textOverlays, audioTracks: next.audioTracks, transitions: next.transitions })
      return
    }
    const map = trimMap(editor.trims, rawClip.start_ms, rawClip.end_ms)
    const nextTrims = addTrim(editor.trims, map, Math.round(a), Math.round(b), rawClip.start_ms, rawClip.end_ms)
    const gone = map.lengthMs - trimMap(nextTrims, rawClip.start_ms, rawClip.end_ms).lengthMs
    // (a start or end dragged back over a removed part makes it part of the clip again: see moveClipEdge)
    const added = withoutRanges(nextTrims, editor.trims)
    if (gone <= 0 || !added.length) return
    // What went, in the timeline as it was (a sliver left beside an earlier cut goes with it)
    const from = map.toTimeline(added[0][0])
    const next = rippleDelete(state, from, from + gone)
    skipCanvasTransitionRef.current = true
    seekAfterTrimRef.current = from
    editor.applyTrim(next.segments, next.keyframes, nextTrims)
    useMediaStore.setState({ overlays: next.overlays, textOverlays: next.textOverlays, audioTracks: next.audioTracks, transitions: next.transitions })
  }
  // ── A video put in between (modules/editor/inserts.ts) ──────────────────────────
  /** "Insert video" picked: the next video chosen in Media goes in here (timeline ms) */
  const [insertAtMs, setInsertAtMs] = useState<number | null>(null)
  /** "Picture in picture" picked: the next video chosen in Media goes in a window over the clip here */
  const [pipAtMs, setPipAtMs] = useState<number | null>(null)
  /** "Overlay" picked: the next video or photo chosen in Media goes on top of the clip here */
  const [overlayAtMs, setOverlayAtMs] = useState<number | null>(null)
  /**
   * Picture in picture (as in InShot): video `videoId` in a small window over the clip from
   * `atMs`, its whole length (up to the clip's end), with its sound. Its box keeps the video's
   * shape — 45% of the frame's width, top right — and is moved, resized and trimmed like a photo.
   */
  function addPip(videoId: string, atMs: number, ownMs: number | null) {
    setPipAtMs(null)
    const at = Math.max(0, Math.min(Math.round(atMs), clipLengthMs - 500))
    const len = Math.min(ownMs && ownMs > 0 ? ownMs : 5000, clipLengthMs - at)
    const id = crypto.randomUUID()
    const url = videoLibraryRef.current[videoId]?.url
    const place = (ar: number) => {
      // The output is 9:16: a box w of the frame's width is w·(9/16)/ar of its height for the video's shape
      const w = 0.45, h = Math.min(0.8, (w * (9 / 16)) / Math.max(0.2, ar))
      return { x: 1 - w - 0.04, y: 0.05, w, h }
    }
    setOverlays(prev => [...prev, {
      id, clip_id: clip.id, type: 'video' as const, storage_path: null, preview_url: url,
      source_video_id: videoId, source_offset_ms: 0, ...place(16 / 9),
      start_ms: at, end_ms: at + len, z_index: prev.length + 1, created_at: new Date().toISOString(), muted: false,
    }])
    // Its own shape once the video's size is known (left alone if it was moved or resized meanwhile)
    if (url) {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.onloadedmetadata = () => {
        const ar = v.videoWidth / v.videoHeight
        if (!(ar > 0) || !isFinite(ar)) return
        const first = place(16 / 9)
        setOverlays(prev => prev.map(o => (o.id === id && o.x === first.x && o.y === first.y && o.w === first.w && o.h === first.h ? { ...o, ...place(ar) } : o)))
      }
      v.src = url
    }
    pickPhoto(id)
    seekToMs(at)
  }
  // (the playhead goes to a video just put in, once the player knows about it)
  const seekAfterInsertRef = useRef<number | null>(null)
  useEffect(() => {
    const t = seekAfterInsertRef.current
    if (t == null) return
    seekAfterInsertRef.current = null
    seekToMs(t)
  }, [insertsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * Put video `videoId` in at timeline `atMs` (its whole length, `ownMs`, up to the clip's 5
   * minutes): the main video waits there while it plays and carries on after it; everything
   * after moves later (rippleInsert). A part of the clip running across the spot is cut in two.
   * Close to a join, it goes in at the join. One undo step.
   */
  function insertVideo(videoId: string, atMs: number, ownMs: number | null, snapMs = 60, from?: { offsetMs: number; muted?: boolean; volume?: number }) {
    setInsertAtMs(null)
    if (trimmed) {
      // Parts cut out the older way (removed parts of the source): first the clip becomes pieces —
      // each part keeps its own moment of the video, so nothing it plays changes — then the video
      // goes in (once the editor has redrawn with the pieces). (A kit's intro and outro wait together.)
      const first = !pendingInsertRef.current.length
      pendingInsertRef.current.push({ videoId, atMs, ownMs, snapMs, from })
      if (first) trimsToPieces()
      return
    }
    pause()
    const editor = useEditorStore.getState(), media = useMediaStore.getState()
    const len = Math.round(Math.min(ownMs && ownMs > 0 ? ownMs : 5000, MAX_CLIP_MS - clipLengthMs))
    if (len < 300) { notifyLocked('The clip is as long as a clip can be (5 minutes): there is no room for another video'); return }
    // Close to where two parts meet: there, not a sliver beside it (the nearest one)
    const joins = [0, clipLengthMs, ...sections.flatMap(s => [s.start_ms, s.end_ms])]
    const near = joins.filter(j => Math.abs(j - atMs) <= snapMs).sort((a, b) => Math.abs(a - atMs) - Math.abs(b - atMs))[0]
    // (onto a join: exactly there — rounding it could leave a sliver of a part beside it)
    const at = near != null ? near : Math.round(Math.max(0, Math.min(clipLengthMs, atMs)))
    const state: TimedState = {
      segments: editor.segments, keyframes: editor.keyframes,
      overlays: media.overlays, textOverlays: media.textOverlays, audioTracks: media.audioTracks, transitions: media.transitions,
    }
    if (state.segments.some(s => s.locked && s.start_ms < at && s.end_ms > at)) { notifyLocked('The part of the clip here is locked \u2014 unlock it first'); return }
    const hold = Math.round(videoAtPieces(allPieces, at))
    const next = rippleInsert(state, at, len)
    const id = crypto.randomUUID(), boxId = crypto.randomUUID()
    const view = { x: 0, y: 0, w: 1, h: 1 }
    const box = {
      id: boxId, slot_index: 0, source_video_id: videoId, source_offset_ms: Math.max(0, Math.round(from?.offsetMs ?? 0)),
      image_path: null, image_motion: null, volume: from?.volume ?? 1, muted: from?.muted ?? false,
      keyframes: [{ t_ms: at, ...view }],
    } as CropBoxLocal
    const seg: SegmentLocal = { id, start_ms: at, end_ms: at + len, layout: 'vertical', sort_order: 0, crop_boxes: [box], video_offset_ms: hold }
    const segs = [...next.segments, seg].sort((a, b) => a.start_ms - b.start_ms || a.sort_order - b.sort_order).map((s, i) => ({ ...s, sort_order: i }))
    skipCanvasTransitionRef.current = true
    seekAfterInsertRef.current = at
    editor.applyTrim(segs, { ...next.keyframes, [boxId]: [{ id: crypto.randomUUID(), box_id: boxId, t_ms: at, ...view }] }, editor.trims)
    useMediaStore.setState({ overlays: next.overlays, textOverlays: next.textOverlays, audioTracks: next.audioTracks, transitions: next.transitions })
    setActiveSegmentId(id)
  }
  // ── After the main video: room for what's on top to run on ──────────────────────
  // Videos on top keep their whole length wherever they go, as in Premiere / Resolve / CapCut: the
  // timeline is as long as whatever reaches furthest. Past the main video's end the main row is
  // empty (nothing drawn on the timeline): underneath there's a hidden, muted stretch ("the tail") —
  // a video put in at the end, so the player and the export go on there, black (render.ts
  // blankRanges, as the preview) and silent, with what's on top over it. One effect makes it, sizes
  // it and takes it away, from how far the things on top reach; it's added at the end directly
  // (never rippled in, so nothing on top is cut or moved by it).
  const isTail = (s: SegmentLocal) => isInsert(s, mainVideoId) && !!s.hidden && !!s.crop_boxes[0]?.hidden
  const tailOf = (segs = useEditorStore.getState().segments) => segs.find(isTail) ?? null
  /** Where the main row's last part ends (the tail after it isn't one) */
  const mainEndMs = () => Math.max(0, ...useEditorStore.getState().segments.filter(s => !isShot(s, mainVideoId) && !isTail(s)).map(s => s.end_ms))
  /** A video dropped here goes on after the main row's last part, not on top (goesAfterMain) */
  const afterMain = (atMs: number, lane: string | null | undefined) => !!mainVideoId && goesAfterMain(atMs, lane, mainEndMs())
  useEffect(() => {
    if (!mainVideoId) return
    const editor = useEditorStore.getState(), m = useMediaStore.getState()
    const segs = editor.segments
    const tail = tailOf(segs)
    const mainEnd = tail ? tail.start_ms : clipLengthMs
    // How far the things on top reach: videos on top, photos and videos in a window, text
    const shotsOn = segs.filter(x => isShot(x, mainVideoId))
    const reach = Math.max(0, ...shotsOn.map(x => x.end_ms), ...m.overlays.map(o => o.end_ms), ...m.textOverlays.map(o => o.end_ms))
    const want = Math.min(Math.round(reach - mainEnd), Math.max(0, MAX_CLIP_MS - mainEnd))
    if (want <= 100) {
      if (!tail) return
      // Nothing past the main video any more: the room after it goes
      editor.applyTrim(segs.filter(x => x.id !== tail.id), editor.keyframes, editor.trims)
      useMediaStore.setState(st => ({ transitions: st.transitions.filter(t => t.after_segment_id !== tail.id) }))
      return
    }
    if (tail) {
      if (Math.abs((tail.end_ms - tail.start_ms) - want) > 30) updateSegment(tail.id, { end_ms: tail.start_ms + want })
      return
    }
    // (removed parts the older way: first the clip becomes pieces, then this runs again)
    if (trimmed) { trimsToPieces(); return }
    // Its box names one of the videos running on there (a video put in shows another video; hidden, it shows none)
    // (not a part of the main video on a row: past the main row, the room up to it is its own — flattenShots)
    const others = shotsOn.filter(x => !isMainShot(x, mainVideoId))
    const vid = others.find(x => x.end_ms > mainEnd)?.crop_boxes[0]?.source_video_id
      ?? m.overlays.find(o => o.end_ms > mainEnd && o.source_video_id)?.source_video_id
      ?? others[0]?.crop_boxes[0]?.source_video_id
    if (!vid) return
    const id = crypto.randomUUID(), boxId = crypto.randomUUID()
    const view = { x: 0, y: 0, w: 1, h: 1 }
    const hold = Math.round(videoAtPieces(piecesOf(segs, mainVideoId, x => isShot(x, mainVideoId)), Math.max(0, mainEnd - 1)))
    const box = {
      id: boxId, slot_index: 0, source_video_id: vid, source_offset_ms: 0, image_path: null, image_motion: null,
      volume: 1, muted: true, hidden: true, keyframes: [{ t_ms: mainEnd, ...view }],
    } as CropBoxLocal
    const seg: SegmentLocal = { id, start_ms: mainEnd, end_ms: mainEnd + want, layout: 'vertical', sort_order: segs.length, crop_boxes: [box], video_offset_ms: hold, hidden: true }
    editor.applyTrim([...segs, seg], { ...editor.keyframes, [boxId]: [{ id: crypto.randomUUID(), box_id: boxId, t_ms: mainEnd, ...view }] }, editor.trims)
  }, [storeSegments, overlays, textOverlays, trimmed]) // eslint-disable-line react-hooks/exhaustive-deps
  /** Videos waiting to go in until a clip with removed parts has become pieces (insertVideo), in order */
  const pendingInsertRef = useRef<Array<{ videoId: string; atMs: number; ownMs: number | null; snapMs: number; from?: { offsetMs: number; muted?: boolean; volume?: number } }>>([])
  useEffect(() => {
    const list = pendingInsertRef.current
    if (!list.length || trimmed) return
    pendingInsertRef.current = []
    list.forEach(p => insertVideo(p.videoId, p.atMs, p.ownMs, p.snapMs, p.from))
  }, [trimmed]) // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * The removed parts (trims) made into pieces: each part of the main row is cut where a removed
   * part closed up, and says itself which moment of the video it starts at — then nothing is
   * removed any more, and the clip plays exactly as before (its parts skip what was removed).
   * Everything else already sits in the clip's time. One step (undo brings the removed parts back).
   */
  function trimsToPieces() {
    const editor = useEditorStore.getState()
    const map = trimMap(editor.trims, rawClip.start_ms, rawClip.end_ms)
    const layer = (s: SegmentLocal) => isShot(s, mainVideoId)
    // Cut the parts in two where a removed part closed up (each half from its own moment)
    for (const t of map.starts.slice(1)) {
      const s = useEditorStore.getState().segments.find(x => !layer(x) && x.start_ms < t - 100 && x.end_ms > t + 100)
      if (s) useEditorStore.getState().splitAtMs(s.id, t, useEditorStore.getState().getPositionAt)
    }
    // The clip's own range comes in to what is kept: video removed from its start or its end is
    // simply not in the clip any more (only removed parts in between become jumps between pieces).
    // Without this, the removed start / end came back as an empty "default framing" stretch.
    const first = map.kept[0], last = map.kept[map.kept.length - 1]
    const range: [number, number] | undefined = first && last && (first[0] > rawClip.start_ms || last[1] < rawClip.end_ms)
      ? [first[0], last[1]] : undefined
    const start = range ? range[0] : rawClip.start_ms
    const st = useEditorStore.getState()
    const segs = st.segments.map(s => (layer(s) || isInsert(s, mainVideoId) ? s : {
      ...s,
      crop_boxes: s.crop_boxes.map(b => (b.source_video_id || b.image_path ? b
        : { ...b, source_offset_ms: Math.max(0, Math.round(map.toSource(s.start_ms) - start)) })),
    }))
    skipCanvasTransitionRef.current = true
    st.applyTrim(segs, st.keyframes, [], range)
  }
  /**
   * A clip of pieces whose last video put in between (and last skip) goes in an edit plays simply
   * again — over its stretch of the video (rawClip). Video cut from its end meanwhile must stay cut:
   * the clip's own end comes in to where its last part now ends (same undo step). Undefined: no change.
   */
  function rangeAfterPieces(segs: SegmentLocal[]): [number, number] | undefined {
    const all = piecesOf(mainRowOf(segs), mainVideoId, s => isShot(s, mainVideoId))
    if (!all.length || insertsOf(segs, mainVideoId).length || all.some(p => (p.from != null && Math.abs(p.from - p.at) > 1) || (p.speed ?? 1) !== 1)) return undefined
    const last = all[all.length - 1]
    const end = rawClip.start_ms + (last.from ?? last.at) + pieceVideoMs(last)
    return end < rawClip.end_ms - 1 ? [rawClip.start_ms, Math.round(end)] : undefined
  }
  /**
   * A part of the main video played faster or slower (as CapCut's Speed): it keeps its stretch of
   * the video and lasts that ÷ speed on the timeline; everything after it moves up or later. Its
   * views keep their places in it. One undo step. A clip with removed parts becomes pieces first.
   */
  /** A speed change waiting until a clip with removed parts has become pieces (what to do, not a
   *  function: one made then would still see the clip as it was, with its removed parts) */
  type PendingSpeed = { segId: string; speed: number; opts: { smooth?: boolean; pitch?: boolean } }
  const pendingSpeedRef = useRef<PendingSpeed | null>(null)
  /**
   * How much of the video the part last given a speed plays, exactly — its length on the timeline is
   * rounded to the ms each time, so working it out again from that would drift a little with every
   * change (the slider changes it several times a second while dragged). Good while the part is as
   * that change left it.
   */
  const speedBaseRef = useRef<{ id: string; videoMs: number; len: number; speed: number } | null>(null)
  /** How much of the main video a part plays (ms) */
  function partVideoMs(seg: SegmentLocal) {
    const b = speedBaseRef.current, len = seg.end_ms - seg.start_ms
    return b && b.id === seg.id && b.len === len && b.speed === speedOf(seg) ? b.videoMs : len * speedOf(seg)
  }
  /** A part of the main video whose speed can change (not a video on top, an inserted video or a frame layout) */
  const speedable = (s: SegmentLocal) => !isShot(s, mainVideoId) && !isInsert(s, mainVideoId) && !isFrameLayout(s.layout)
  /**
   * How slow and how fast a part can play: no shorter than the shortest part (MIN_FORMAT_MS), and
   * the clip no longer than its limit (`clipMs`: the clip's length now — with other parts changed
   * in the same go, as it will be). Each with why, for the Speed panel.
   */
  function speedLimits(seg: SegmentLocal, clipMs = clipLengthMs) {
    const len = seg.end_ms - seg.start_ms
    const videoMs = partVideoMs(seg)
    const max = Math.max(SPEED_MIN, Math.min(SPEED_MAX, Math.floor((videoMs / MIN_FORMAT_MS) * 100) / 100))
    const room = len + Math.max(0, MAX_CLIP_MS - clipMs)
    const min = Math.min(max, Math.max(SPEED_MIN, Math.ceil((videoMs / room) * 100) / 100))
    return {
      min, max,
      maxNote: `That\u2019s the fastest this part can go (${max}×): a part can\u2019t be shorter than ${MIN_FORMAT_MS / 1000} s`,
      minNote: `That\u2019s the slowest this part can go (${min}×): the clip can\u2019t be longer than ${Math.round(MAX_CLIP_MS / 60000)} minutes`,
    }
  }
  function setPartSpeed(segId: string, speedIn: number, opts: { smooth?: boolean; pitch?: boolean } = {}, clipMs?: number) {
    const editor0 = useEditorStore.getState()
    const seg0 = editor0.segments.find(s => s.id === segId)
    // (back to normal speed is always allowed: a part slowed down before it became a frame)
    if (!seg0 || (!speedable(seg0) && !(speedIn === 1 && !isShot(seg0, mainVideoId) && !isInsert(seg0, mainVideoId)))) return
    if (blocked({ kind: 'section', id: segId })) return
    if (audioTracks.some(isMainAudio)) { notifyLocked('The clip\u2019s sound is detached: attach it again (Music) to change a part\u2019s speed'); return }
    if (trimmed) { pendingSpeedRef.current = { segId, speed: speedIn, opts }; trimsToPieces(); return }
    pause()
    const media = useMediaStore.getState()
    const editor = useEditorStore.getState()
    const seg = editor.segments.find(s => s.id === segId)!
    const lim = speedLimits(seg, clipMs)
    const speed = Math.max(lim.min, Math.min(lim.max, Math.round(speedIn * 100) / 100))
    const len = seg.end_ms - seg.start_ms
    const videoMs = partVideoMs(seg)
    const newLen = Math.max(MIN_FORMAT_MS, Math.round(videoMs / speed))
    const diff = newLen - len
    if (diff > 0 && (clipMs ?? clipLengthMs) + diff > MAX_CLIP_MS) { notifyLocked('The clip would be longer than 5 minutes'); return }
    speedBaseRef.current = { id: segId, videoMs, len: newLen, speed }
    let state: TimedState = {
      segments: editor.segments, keyframes: editor.keyframes,
      overlays: media.overlays, textOverlays: media.textOverlays, audioTracks: media.audioTracks, transitions: media.transitions,
    }
    const end = seg.end_ms
    if (diff > 0) state = rippleInsert(state, end, diff)
    else if (diff < 0) {
      // Everything after the part moves up by as much (what runs across its end gets shorter)
      const d = -diff
      const earlier = (t: number) => (t >= end ? t - d : t)
      const kf = { ...state.keyframes }
      state = {
        ...state,
        segments: state.segments.map(s => {
          if (s.start_ms < end) return s
          for (const b of s.crop_boxes) if (kf[b.id]) kf[b.id] = kf[b.id].map(k => ({ ...k, t_ms: k.t_ms - d }))
          return { ...s, start_ms: s.start_ms - d, end_ms: s.end_ms - d,
            frame: s.frame?.items ? { ...s.frame, items: s.frame.items.map(it => ({ ...it, start_ms: it.start_ms - d, end_ms: it.end_ms - d })) } : s.frame }
        }),
        keyframes: kf,
        overlays: state.overlays.map(o => ({ ...o, start_ms: earlier(o.start_ms), end_ms: o.end_ms > end ? Math.max(earlier(o.start_ms) + 200, o.end_ms - d) : Math.min(o.end_ms, end - d) })),
        textOverlays: state.textOverlays.map(o => ({ ...o, start_ms: earlier(o.start_ms), end_ms: o.end_ms > end ? Math.max(earlier(o.start_ms) + 200, o.end_ms - d) : Math.min(o.end_ms, end - d) })),
        audioTracks: state.audioTracks.map(t => (t.start_ms >= end ? { ...t, start_ms: t.start_ms - d, ...(t.end_ms != null ? { end_ms: t.end_ms - d } : {}) } : t)),
      }
    }
    // The part itself: its new length and speed; its views at the same moments of it
    const scale = newLen / len
    const kf = { ...state.keyframes }
    const segs = state.segments.map(s => {
      if (s.id !== segId) return s
      for (const b of s.crop_boxes) if (kf[b.id]) kf[b.id] = kf[b.id].map(k => ({ ...k, t_ms: Math.round(s.start_ms + Math.max(0, k.t_ms - s.start_ms) * scale) }))
      const { speed: _s, smooth: _m, pitch: _p, ...rest } = s
      void _s; void _m; void _p
      return {
        ...rest, end_ms: s.start_ms + newLen,
        ...(speed !== 1 ? { speed } : {}),
        ...((opts.smooth ?? s.smooth) && speed < 1 ? { smooth: true } : {}),
        ...((opts.pitch ?? s.pitch) && speed !== 1 ? { pitch: true } : {}),
      }
    })
    skipCanvasTransitionRef.current = true
    seekAfterInsertRef.current = seg.start_ms
    editor.applyTrim(segs, kf, editor.trims)
    useMediaStore.setState({ overlays: state.overlays, textOverlays: state.textOverlays, audioTracks: state.audioTracks, transitions: state.transitions })
  }
  // (a clip with removed parts became pieces: now its speed)
  useEffect(() => {
    const p = pendingSpeedRef.current
    if (!p || trimmed) return
    pendingSpeedRef.current = null
    setPartSpeed(p.segId, p.speed, p.opts)
  }, [trimmed]) // eslint-disable-line react-hooks/exhaustive-deps
  // Speed was taken out of the editor (user, 2026-10-20). A clip opened with parts still played faster
  // or slower gets them back at normal speed (setPartSpeed: its stretch of the video, at 1×, and
  // everything after it moved), when the clip opens, so what's seen and exported is the video as filmed
  useEffect(() => {
    const parts = useEditorStore.getState().segments.filter(s => !isShot(s, mainVideoId) && !isInsert(s, mainVideoId) && speedOf(s) !== 1 && !isLocked({ kind: 'section', id: s.id }))
    if (!parts.length) return
    for (const sp of parts) setPartSpeed(sp.id, 1)
    notifyLocked(`${parts.length === 1 ? 'A part' : `${parts.length} parts`} of this clip played faster or slower — back at normal speed now`, 8000)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  /** An inserted video taken out: what came after it moves back, and the parts it had cut in two join again */
  function removeInsert(segId: string) {
    const editor = useEditorStore.getState(), media = useMediaStore.getState()
    const ins = editor.segments.find(s => s.id === segId)
    if (!ins || !isInsert(ins, mainVideoId)) return
    pause()
    const state: TimedState = {
      segments: editor.segments, keyframes: editor.keyframes,
      overlays: media.overlays, textOverlays: media.textOverlays, audioTracks: media.audioTracks, transitions: media.transitions,
    }
    const next = rippleCut(state, ins.start_ms, ins.end_ms, rippleDelete)
    skipCanvasTransitionRef.current = true
    seekAfterInsertRef.current = ins.start_ms
    editor.applyTrim(next.segments, next.keyframes, editor.trims, rangeAfterPieces(next.segments))
    useMediaStore.setState({ overlays: next.overlays, textOverlays: next.textOverlays, audioTracks: next.audioTracks, transitions: next.transitions })
    // The part before it and the part after it are one stretch of the video again
    const before = next.segments.find(s => !isShot(s, mainVideoId) && Math.abs(s.end_ms - ins.start_ms) <= 1)
    if (before) joinSameLayoutNeighbours(before.id, new Set(next.transitions.map(t => t.after_segment_id)))
  }
  /**
   * A block of the main row dragged along it and let go at `toMs` (where it goes in, in the timeline
   * as it was): a part of the main video, or a video put in between. It's taken out where it was and
   * put in there, playing just what it played (each part keeps its own moment of the video: the clip
   * becomes pieces). The clip keeps its length; photos, text, music and videos on top stay where they
   * are (as in Resolve); the main video's own sound goes with its parts. One step.
   */
  const pendingMoveRef = useRef<{ segId: string; toMs: number; place?: boolean; row?: number | 'new' | 'new-below' } | null>(null)
  function movePart(segId: string, toMs: number) {
    if (trimmed) {
      // Parts cut out the older way: first the clip becomes pieces, then the move (once redrawn)
      pendingMoveRef.current = { segId, toMs }
      trimsToPieces()
      return
    }
    const editor = useEditorStore.getState(), media = useMediaStore.getState()
    const seg = editor.segments.find(x => x.id === segId)
    if (!seg || isShot(seg, mainVideoId)) return
    if (seg.locked) { notifyLocked('This part is locked — unlock it to move it'); return }
    const ins = isInsert(seg, mainVideoId)
    if (isTail(seg) || isGapPart(seg, mainVideoId)) return
    // Dragged into the empty space a deleted part left next to it: the two sides join — the space
    // closes (what comes after moves up), as in other editors
    const gapNext = editor.segments.find(x => isGapPart(x, mainVideoId) && (Math.abs(x.end_ms - seg.start_ms) <= 1 || Math.abs(x.start_ms - seg.end_ms) <= 1))
    if (gapNext) {
      const before = gapNext.end_ms <= seg.start_ms + 1
      const into = before ? toMs < seg.start_ms - 30 : toMs > seg.end_ms + 30
      if (into) { removePart(gapNext.start_ms, gapNext.end_ms); return }
    }
    const tailNow = tailOf()
    if (tailNow && toMs > tailNow.start_ms) toMs = tailNow.start_ms
    const a = seg.start_ms, len = seg.end_ms - seg.start_ms
    // (where it goes, in the clip without it)
    const at = Math.round(toMs >= seg.end_ms ? toMs - len : toMs > a ? a : Math.max(0, toMs))
    if (Math.abs(at - a) < 30) return
    // Every part of the main video says which moment of it it starts at (as it plays now), so moved
    // parts keep playing their own stretch of the video
    const main = (b: { source_video_id?: string | null; image_path?: string | null }) => !b.source_video_id && !b.image_path
    const pinned = editor.segments.map(x => {
      if (isShot(x, mainVideoId) || isInsert(x, mainVideoId)) return x
      const was = mainFrom(x)
      const d = (piecesOn ? was ?? x.start_ms : x.start_ms) - (was ?? 0)
      return d ? { ...x, crop_boxes: x.crop_boxes.map(box => (main(box) ? { ...box, source_offset_ms: Math.max(0, (box.source_offset_ms ?? 0) + d) } : box)) } : x
    })
    const me = pinned.find(x => x.id === segId)!
    const state: TimedState = {
      segments: pinned, keyframes: editor.keyframes,
      overlays: media.overlays, textOverlays: media.textOverlays, audioTracks: media.audioTracks, transitions: media.transitions,
    }
    const out = rippleCut(state, a, seg.end_ms, rippleDelete)
    if (out.segments.some(x => x.locked && x.start_ms < at && x.end_ms > at)) { notifyLocked('The part of the clip there is locked — unlock it first'); return }
    pause()
    const next = rippleInsert(out, at, len)
    const d = at - a
    const moved: SegmentLocal = {
      ...me, start_ms: at, end_ms: at + len,
      ...(ins ? { video_offset_ms: Math.round(videoAtPieces(piecesOf(out.segments, mainVideoId, x => isShot(x, mainVideoId)), at)) } : {}),
      frame: me.frame?.items ? { ...me.frame, items: me.frame.items.map(it => ({ ...it, start_ms: it.start_ms + d, end_ms: it.end_ms + d })) } : me.frame,
    }
    // (videos on top stay where they were too, as they are)
    const onTop = editor.segments.filter(x => isShot(x, mainVideoId))
    const segs = [...next.segments.filter(x => x.id !== segId && !isShot(x, mainVideoId)), ...onTop, moved]
      .sort((x, y) => x.start_ms - y.start_ms || x.sort_order - y.sort_order).map((x, i) => ({ ...x, sort_order: i }))
    const kfs = { ...next.keyframes }
    for (const x of onTop) for (const box of x.crop_boxes) kfs[box.id] = editor.keyframes[box.id] ?? []
    for (const box of seg.crop_boxes) kfs[box.id] = (editor.keyframes[box.id] ?? []).map(k => ({ ...k, t_ms: k.t_ms + d }))
    skipCanvasTransitionRef.current = true
    seekAfterInsertRef.current = at
    editor.applyTrim(segs, kfs, editor.trims, rangeAfterPieces(segs))
    useMediaStore.setState({
      audioTracks: [...next.audioTracks.filter(isMainAudio), ...media.audioTracks.filter(t => !isMainAudio(t))],
      transitions: next.transitions.filter(t => segs.some(x => x.id === t.after_segment_id)),
    })
    // Parts that now play on without a jump are one part again: where it was, and where it went
    const gap = at < a ? a + len : a
    const left = segs.find(x => !isShot(x, mainVideoId) && !isInsert(x, mainVideoId) && Math.abs(x.end_ms - gap) <= 1)
    if (left) joinSameLayoutNeighbours(left.id, transitionAfter())
    const kept = ins ? segId : joinSameLayoutNeighbours(segId, transitionAfter())
    setActiveSegmentId(kept ?? segId)
  }
  useEffect(() => {
    const p = pendingMoveRef.current
    if (!p || trimmed) return
    pendingMoveRef.current = null
    if (p.row != null) partToTrack(p.segId, p.row, p.toMs)
    else if (p.place) placePart(p.segId, p.toMs)
    else movePart(p.segId, p.toMs)
  }, [trimmed]) // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * A part of the main row let go over empty room (the space deleted parts left, its own place, or
   * past the end of the row) with its start at `startMs`: it goes exactly there, as in CapCut —
   * nothing else moves. Where it was becomes empty space (visibility.ts isGapPart), the space it
   * lands in is cut round it, empty space left at the end of the row goes. It plays just what it
   * played (each part keeps its own moment of the video: the clip becomes pieces). One step.
   * (Dropped onto another part it goes in between instead: movePart.)
   */
  function placePart(segId: string, startMs: number) {
    if (trimmed) {
      pendingMoveRef.current = { segId, toMs: startMs, place: true }
      trimsToPieces()
      return
    }
    const editor = useEditorStore.getState(), media = useMediaStore.getState()
    const seg = editor.segments.find(x => x.id === segId)
    if (!seg) return
    if (seg.locked) { notifyLocked('This part is locked — unlock it to move it'); return }
    // (the main video's own sound, detached, moves with its parts: that is the in-between move's work)
    if (media.audioTracks.some(isMainAudio)) { movePart(segId, startMs); return }
    const next = placeInRow(editor.segments, editor.keyframes, segId, startMs, mainVideoId, piecesOn, MAX_CLIP_MS)
    if (next === 'between') { movePart(segId, startMs); return }
    if (!next) return
    pause()
    skipCanvasTransitionRef.current = true
    seekAfterInsertRef.current = next.segments.find(x => x.id === segId)?.start_ms ?? startMs
    editor.applyTrim(next.segments, next.keyframes, editor.trims, rangeAfterPieces(next.segments))
    // (a transition at a join that isn't there any more goes)
    useMediaStore.setState({ transitions: media.transitions.filter(t => t.after_segment_id !== segId && next.segments.some(x => x.id === t.after_segment_id)) })
    setActiveSegmentId(segId)
  }
  /**
   * A block of the main row dragged off it, onto a row above or below the main video, from `atMs`:
   *  - a video put in: it comes out of the main row (which closes up: removeInsert) and goes on that
   *    row — the same part of the same video, with its own sound as it was
   *  - a part of the main video (as in Resolve): it goes on that row showing the same stretch of the
   *    main video, framed as it was, with its sound; where it was is left empty (place.ts liftToRow)
   */
  function partToTrack(segId: string, target: number | 'new' | 'new-below', atMs: number) {
    const seg = useEditorStore.getState().segments.find(x => x.id === segId)
    if (!seg) return
    if (seg.locked) { notifyLocked(isInsert(seg, mainVideoId) ? 'This video is locked — unlock it to move it' : 'This part is locked — unlock it to move it'); return }
    if (!isInsert(seg, mainVideoId)) { liftPart(seg, target, atMs); return }
    const box = seg.crop_boxes[0]
    if (!box?.source_video_id) return
    const len = seg.end_ms - seg.start_ms
    const clipLen = clipLengthMs - len
    removeInsert(segId)
    const at = Math.round(Math.max(0, Math.min(atMs, clipLen - 200)))
    const end = Math.min(clipLen, at + len)
    if (end - at < 200) return
    const items = visualItems()
    const track = target === 'new-below' ? openRowBelow()
      : target === 'new' ? newTopTrack(items)
      : fitsOn(items, target, at, end) ? target : freeTrackIn(items, at, end, undefined, target)
    const id = placeBroll(box.source_video_id, at, end, undefined, track)
    const nb = useEditorStore.getState().segments.find(x => x.id === id)?.crop_boxes[0]
    if (nb) updateSegment(id, { crop_boxes: [{ ...nb, source_offset_ms: box.source_offset_ms ?? 0, muted: box.muted, volume: box.volume }] })
    pickShot(id)
  }
  /** A part of the main video dragged onto a row (partToTrack): it goes there as one step */
  function liftPart(seg: SegmentLocal, target: number | 'new' | 'new-below', atMs: number) {
    if (isTail(seg) || isGapPart(seg, mainVideoId)) return
    const why = liftBlock(seg)
    if (why) {
      notifyLocked(why === 'speed' ? 'This part plays faster or slower — set it back to 1× to move it to another row'
        : 'Only a part showing the video full screen can move to another row — set its format to Full first')
      return
    }
    if (trimmed) {
      // Parts cut out the older way: first the clip becomes pieces, then the move (once redrawn)
      pendingMoveRef.current = { segId: seg.id, toMs: atMs, row: target }
      trimsToPieces()
      return
    }
    const len = seg.end_ms - seg.start_ms
    const at = Math.round(Math.max(0, Math.min(atMs, MAX_CLIP_MS - len)))
    const items = visualItems()
    const track = target === 'new-below' ? openRowBelow()
      : target === 'new' ? newTopTrack(items)
      : fitsOn(items, target, at, at + len) ? target : freeTrackIn(items, at, at + len, undefined, target)
    const editor = useEditorStore.getState(), media = useMediaStore.getState()
    const next = liftToRow(editor.segments, editor.keyframes, seg.id, at, track, mainVideoId, piecesOn, rawClip.start_ms)
    if (!next) return
    pause()
    skipCanvasTransitionRef.current = true
    seekAfterInsertRef.current = at
    editor.applyTrim(next.segments, next.keyframes, editor.trims, rangeAfterPieces(next.segments))
    // (no transition joins it to the main row any more)
    useMediaStore.setState({ transitions: media.transitions.filter(t => t.after_segment_id !== seg.id && next.segments.some(x => x.id === t.after_segment_id)) })
    pickShot(seg.id)
  }
  /**
   * The main video's parts picked together, carried off the main row onto a row (as in Resolve, a
   * selection dragged from V1 to V2): each lifts onto that row at its new start (liftToRow), keeping
   * their places to each other; where they were is left empty. All on one row: the one let go over
   * when they all fit there, else a new one (on top, or at the bottom under the main video). One step.
   */
  function liftParts(moves: { id: string; startMs: number }[], target: number | 'new' | 'new-below') {
    if (!moves.length) return
    if (trimmed) { trimsToPieces(); notifyLocked('The clip is ready to move its parts now — move them again'); return }
    const segs = moves.map(mv => useEditorStore.getState().segments.find(x => x.id === mv.id))
    if (segs.some(s => !s)) return
    if (segs.some(s => s!.locked)) { notifyLocked('A part is locked — unlock it to move it'); return }
    if (segs.some(s => isInsert(s!, mainVideoId))) { notifyLocked('A video put in the main row is among them — move it on its own'); return }
    const why = segs.map(s => liftBlock(s!)).find(Boolean)
    if (why) {
      notifyLocked(why === 'speed' ? 'A part plays faster or slower — set it back to 1× to move them to another row'
        : 'Only parts showing the video full screen can move to another row — set their format to Full first')
      return
    }
    const spans = moves.map((mv, i) => {
      const len = segs[i]!.end_ms - segs[i]!.start_ms
      const at = Math.round(Math.max(0, Math.min(mv.startMs, MAX_CLIP_MS - len)))
      return { id: mv.id, at, end: at + len }
    })
    const items = visualItems()
    const fitAll = (t: number) => spans.every(sp => fitsOn(items, t, sp.at, sp.end))
    const track = target === 'new-below' ? openRowBelow()
      : target === 'new' ? newTopTrack(items)
      : fitAll(target) ? target
      : target < belowRowsRef.current ? openRowBelow() : newTopTrack(items)
    const editor = useEditorStore.getState(), media = useMediaStore.getState()
    let segments = editor.segments, keyframes = editor.keyframes
    for (const sp of spans) {
      const next = liftToRow(segments, keyframes, sp.id, sp.at, track, mainVideoId, piecesOn, rawClip.start_ms)
      if (!next) return
      segments = next.segments; keyframes = next.keyframes
    }
    pause()
    skipCanvasTransitionRef.current = true
    seekAfterInsertRef.current = Math.min(...spans.map(sp => sp.at))
    editor.applyTrim(segments, keyframes, editor.trims, rangeAfterPieces(segments))
    // (no transition joins them to the main row any more)
    const gone = new Set(spans.map(sp => sp.id))
    useMediaStore.setState({ transitions: media.transitions.filter(t => !gone.has(t.after_segment_id) && segments.some(x => x.id === t.after_segment_id)) })
  }
  /**
   * A video on a row dragged onto the main row: it goes in there (insertVideo), showing the same part
   * of it, with its sound on. A part of the main video on a row goes back to being a part of the main
   * row, with its start at `startMs` (where it was let go) over empty room there, else in between
   * the parts at `atMs` (the rest move later).
   */
  function shotToMain(segId: string, atMs: number, startMs = atMs) {
    const seg = useEditorStore.getState().segments.find(x => x.id === segId)
    const box = seg?.crop_boxes[0]
    if (!seg || !box?.source_video_id || blocked({ kind: 'broll', id: segId })) return
    if (isMainShot(seg, mainVideoId)) { lowerPart(seg, atMs, startMs); return }
    // (at the main video's end or past it: on after its last part, never after the room past it)
    const end = mainEndMs()
    const at = goesAfterMain(atMs, 'main', end) ? end : atMs
    removeBrollShot(segId)
    tidyRowsBelow()
    insertVideo(box.source_video_id, at, seg.end_ms - seg.start_ms, at === end ? 0 : 60,{ offsetMs: box.source_offset_ms ?? 0, muted: false, volume: box.volume ?? 1 })
  }
  /** A part of the main video on a row dragged back onto the main row (shotToMain): one step */
  function lowerPart(seg: SegmentLocal, atMs: number, startMs: number) {
    const editor = useEditorStore.getState(), media = useMediaStore.getState()
    const next = lowerToRow(editor.segments, editor.keyframes, seg.id, startMs, mainVideoId, piecesOn, rawClip.start_ms, MAX_CLIP_MS)
    if (!next) return
    pause()
    skipCanvasTransitionRef.current = true
    if (next !== 'between') {
      seekAfterInsertRef.current = next.segments.find(x => x.id === seg.id)?.start_ms ?? startMs
      editor.applyTrim(next.segments, next.keyframes, editor.trims, rangeAfterPieces(next.segments))
      tidyRowsBelow()
      setActiveSegmentId(seg.id)
      return
    }
    // A part of the main video in the way: it goes in between there (as movePart puts a part in)
    const len = seg.end_ms - seg.start_ms
    const tailNow = tailOf()
    const at = Math.round(Math.max(0, tailNow ? Math.min(atMs, tailNow.start_ms) : atMs))
    const state: TimedState = {
      segments: editor.segments.filter(x => x.id !== seg.id), keyframes: editor.keyframes,
      overlays: media.overlays, textOverlays: media.textOverlays, audioTracks: media.audioTracks, transitions: media.transitions,
    }
    if (state.segments.some(x => x.locked && !isShot(x, mainVideoId) && x.start_ms < at && x.end_ms > at)) { notifyLocked('The part of the clip there is locked — unlock it first'); return }
    const ripple = rippleInsert(state, at, len)
    const part = { ...asMainPart(seg, rawClip.start_ms), start_ms: at, end_ms: at + len }
    // (videos on rows stay where they were, as they are)
    const onTop = editor.segments.filter(x => isShot(x, mainVideoId) && x.id !== seg.id)
    const segs = [...ripple.segments.filter(x => !isShot(x, mainVideoId)), ...onTop, part]
      .sort((x, y) => x.start_ms - y.start_ms || x.sort_order - y.sort_order).map((x, i) => ({ ...x, sort_order: i }))
    const kfs = { ...ripple.keyframes }
    for (const x of onTop) for (const b of x.crop_boxes) kfs[b.id] = editor.keyframes[b.id] ?? []
    for (const b of seg.crop_boxes) kfs[b.id] = (editor.keyframes[b.id] ?? []).map(k => ({ ...k, t_ms: k.t_ms + at - seg.start_ms }))
    seekAfterInsertRef.current = at
    editor.applyTrim(segs, kfs, editor.trims, rangeAfterPieces(segs))
    useMediaStore.setState({
      audioTracks: [...ripple.audioTracks.filter(isMainAudio), ...media.audioTracks.filter(t => !isMainAudio(t))],
      transitions: ripple.transitions.filter(t => segs.some(x => x.id === t.after_segment_id)),
    })
    tidyRowsBelow()
    setActiveSegmentId(seg.id)
  }

  /**
   * A part's edge being dragged (live, as the clip's own ends): each step starts again from the clip
   * as it was when the drag began, so the cut (or what comes back) follows the pointer both ways;
   * the whole drag is one undo step (history.ts counts a drag once). Problems are only told on release.
   */
  const liveEdgeRef = useRef<{ editor: Pick<ReturnType<typeof useEditorStore.getState>, 'segments' | 'keyframes' | 'trims' | 'clipRange'>; media: Pick<ReturnType<typeof useMediaStore.getState>, 'overlays' | 'textOverlays' | 'audioTracks' | 'transitions'> } | null>(null)
  const quietRef = useRef(false)
  function trimByEdgeLive(segId: string, edge: 'start' | 'end', from: number, to: number, done: boolean) {
    const e = useEditorStore.getState(), m = useMediaStore.getState()
    if (!liveEdgeRef.current) {
      liveEdgeRef.current = {
        editor: { segments: e.segments, keyframes: e.keyframes, trims: e.trims, clipRange: e.clipRange },
        media: { overlays: m.overlays, textOverlays: m.textOverlays, audioTracks: m.audioTracks, transitions: m.transitions },
      }
    } else {
      useEditorStore.setState(liveEdgeRef.current.editor)
      useMediaStore.setState(liveEdgeRef.current.media)
    }
    if (done) liveEdgeRef.current = null
    quietRef.current = !done
    try { if (Math.abs(to - from) >= 50) trimByEdge(segId, edge, from, to, done) }
    finally {
      quietRef.current = false
      // (a drag that went outwards at the clip's start or end and came back: its own base goes too)
      if (done) edgeBaseRef.current = null
    }
  }
  /**
   * A part's edge dragged on the timeline (as in InShot): inwards, the piece it passed over is cut
   * out (removePart: what follows moves up, no default framing is left); outwards, video cut at
   * that join before comes back, as much as it was dragged (restoreAtJoin), and what follows moves
   * later. At the clip's own start or end, outwards brings in more of the video (moveClipEdge).
   */
  function trimByEdge(segId: string, edge: 'start' | 'end', from: number, to: number, done = true) {
    if (blocked({ kind: 'section', id: segId })) return
    const inward = edge === 'start' ? to > from : to < from
    // An inserted video's own edges trim it (what plays of it), the same way
    const ins = useEditorStore.getState().segments.find(s => s.id === segId)
    if (ins && isInsert(ins, mainVideoId)) { trimInsert(ins, edge, from, to, inward); return }
    if (inward) {
      const [a, b] = edge === 'start' ? [from, to] : [to, from]
      if (clipLengthMs - (b - a) < MIN_CLIP_LEFT_MS) { notifyLocked('A clip must stay at least a second long'); return }
      removePart(a, b)
      return
    }
    const d = Math.abs(to - from)
    if (piecesOn) { restorePiece(segId, edge, from, d); return }
    if (edge === 'start' && from <= 1) { moveClipEdge('start', -d, done); return }
    if (edge === 'end' && from >= clipLengthMs - 1) { moveClipEdge('end', d, done); return }
    restoreAtJoin(segId, edge, from, d)
  }
  /**
   * An inserted video's edge dragged: inwards, less of it plays (its start or end cut; what follows
   * moves up); outwards, more of it again — as far as the video itself goes. The main video still
   * waits where it went in.
   */
  function trimInsert(ins: SegmentLocal, edge: 'start' | 'end', from: number, to: number, inward: boolean) {
    pause()
    const editor = useEditorStore.getState(), media = useMediaStore.getState()
    const state: TimedState = {
      segments: editor.segments, keyframes: editor.keyframes,
      overlays: media.overlays, textOverlays: media.textOverlays, audioTracks: media.audioTracks, transitions: media.transitions,
    }
    const box = ins.crop_boxes[0]
    if (inward) {
      const [a, b] = edge === 'start' ? [from, to] : [to, from]
      if (ins.end_ms - ins.start_ms - (b - a) < 300) return
      const next = rippleCut(state, Math.round(a), Math.round(b), rippleDelete)
      skipCanvasTransitionRef.current = true
      editor.applyTrim(next.segments, next.keyframes, editor.trims, rangeAfterPieces(next.segments))
      useMediaStore.setState({ overlays: next.overlays, textOverlays: next.textOverlays, audioTracks: next.audioTracks, transitions: next.transitions })
      return
    }
    // Outwards: back to the video's own start (before what plays now), or on to its end
    const own = videoLibraryRef.current[box?.source_video_id ?? '']?.duration_ms ?? null
    const offset = box?.source_offset_ms ?? 0
    const room = edge === 'start' ? offset : own != null ? own - (offset + (ins.end_ms - ins.start_ms)) : 0
    const amount = Math.round(Math.min(Math.abs(to - from), Math.max(0, room), MAX_CLIP_MS - clipLengthMs))
    if (amount < 50) { notifyLocked(room > 0 ? 'The clip is as long as a clip can be (5 minutes)' : edge === 'start' ? 'This is where the video starts' : 'This is where the video ends'); return }
    const t = edge === 'start' ? ins.start_ms : ins.end_ms
    const next = rippleInsert(state, t, amount)
    const segs = next.segments.map(s => (s.id !== ins.id ? s : edge === 'start'
      ? { ...s, start_ms: t, crop_boxes: s.crop_boxes.map((b, i) => (i === 0 ? { ...b, source_offset_ms: Math.max(0, (b.source_offset_ms ?? 0) - amount) } : b)) }
      : { ...s, end_ms: s.end_ms + amount }))
    const keyframes = { ...next.keyframes }
    if (edge === 'start') for (const b of ins.crop_boxes) {
      const kfs = keyframes[b.id] ?? []
      if (kfs.length) keyframes[b.id] = [{ ...kfs[0], id: crypto.randomUUID(), t_ms: t }, ...kfs]
    }
    skipCanvasTransitionRef.current = true
    editor.applyTrim(segs, keyframes, editor.trims)
    useMediaStore.setState({ overlays: next.overlays, textOverlays: next.textOverlays, audioTracks: next.audioTracks, transitions: next.transitions })
  }
  /**
   * A clip of pieces: video skipped at an edge of part `segId` comes back, up to `d` ms — before it
   * (edge 'start': it starts that much earlier in the video, and grows at the front) or after it
   * ('end': it plays on that much further). Only video the clip had skipped (or before its first
   * part, within the clip's stretch of the video). Everything after moves later.
   */
  function restorePiece(segId: string, edge: 'start' | 'end', t: number, d: number) {
    pause()
    const editor = useEditorStore.getState(), media = useMediaStore.getState()
    const seg = editor.segments.find(s => s.id === segId)
    if (!seg || isInsert(seg, mainVideoId)) return
    const all = piecesOf(editor.segments, mainVideoId, s => isShot(s, mainVideoId))
    const me = all.find(p => p.id === segId)
    if (!me || me.from == null) return
    const mains = all.filter(p => p.from != null)
    const i = mains.indexOf(me)
    const lenSrc = rawClip.end_ms - rawClip.start_ms
    // How much video lies skipped there: back to the part before it (or the clip's start) / on to the next one (or the clip's end)
    const room = edge === 'start'
      ? me.from - (i > 0 ? mains[i - 1].from! + pieceVideoMs(mains[i - 1]) : 0)
      : (i + 1 < mains.length ? mains[i + 1].from! : lenSrc) - (me.from + pieceVideoMs(me))
    // (room is video; at this part's speed it is room ÷ speed of timeline)
    const sp = me.speed ?? 1
    const amount = Math.round(Math.min(d, Math.max(0, room) / sp, MAX_CLIP_MS - clipLengthMs))
    if (amount < 50) { notifyLocked(room > 0 ? 'The clip is as long as a clip can be (5 minutes)' : 'Nothing was cut here: drag the edge inwards to cut, outwards brings back what was cut'); return }
    const state: TimedState = {
      segments: editor.segments, keyframes: editor.keyframes,
      overlays: media.overlays, textOverlays: media.textOverlays, audioTracks: media.audioTracks, transitions: media.transitions,
    }
    const next = rippleInsert(state, t, amount)
    const segs = next.segments.map(s => {
      if (s.id !== segId) return s
      return edge === 'start'
        // (it starts earlier in the video: each main-video box from that much before)
        ? { ...s, start_ms: t, crop_boxes: s.crop_boxes.map(b => (b.source_video_id || b.image_path ? b : { ...b, source_offset_ms: Math.max(0, (b.source_offset_ms ?? 0) - amount * sp) })) }
        : { ...s, end_ms: s.end_ms + amount }
    })
    const keyframes = { ...next.keyframes }
    if (edge === 'start') {
      for (const b of segs.find(s => s.id === segId)?.crop_boxes ?? []) {
        const kfs = keyframes[b.id] ?? []
        if (kfs.length) keyframes[b.id] = [{ ...kfs[0], id: crypto.randomUUID(), t_ms: t }, ...kfs]
      }
    }
    skipCanvasTransitionRef.current = true
    seekAfterInsertRef.current = edge === 'start' ? t : t + amount - 1
    editor.applyTrim(segs, keyframes, editor.trims)
    useMediaStore.setState({ overlays: next.overlays, textOverlays: next.textOverlays, audioTracks: next.audioTracks, transitions: next.transitions })
  }
  /**
   * Video cut out at the join `t` comes back, up to `d` ms of it: before the part `segId` starts
   * (edge 'start': it grows back towards the start) or after it ends ('end'). Everything after the
   * join moves later by as much.
   */
  function restoreAtJoin(segId: string, edge: 'start' | 'end', t: number, d: number) {
    pause()
    const editor = useEditorStore.getState(), media = useMediaStore.getState()
    const map = trimMap(editor.trims, rawClip.start_ms, rawClip.end_ms)
    // The cut that closed up at this join (source ms): it ends where the part starts / starts where it ends
    const at = edge === 'start' ? map.toSource(t) : map.toSourceEnd(t)
    const cut = editor.trims.find(([a, b]) => (edge === 'start' ? Math.abs(b - at) <= 2 : Math.abs(a - at) <= 2))
    if (!cut) { notifyLocked('Nothing was cut here: drag the edge inwards to cut, outwards brings back what was cut'); return }
    const room = Math.max(0, Math.min(MAX_CLIP_MS - clipLengthMs, cut[1] - cut[0]))
    const amount = Math.round(Math.min(d, room))
    if (amount < 50) { if (!room) notifyLocked('The clip is as long as a clip can be (5 minutes)'); return }
    const nextTrims = cleanTrims(editor.trims.flatMap(r => (r !== cut ? [r]
      : edge === 'start' ? (r[1] - amount > r[0] ? [[r[0], r[1] - amount] as [number, number]] : [])
        : (r[0] + amount < r[1] ? [[r[0] + amount, r[1]] as [number, number]] : []))), rawClip.start_ms, rawClip.end_ms)
    const state: TimedState = {
      segments: editor.segments, keyframes: editor.keyframes,
      overlays: media.overlays, textOverlays: media.textOverlays, audioTracks: media.audioTracks, transitions: media.transitions,
    }
    // Room for it at the join, then the part grows over it (from the earlier frames it gets back)
    const next = rippleInsert(state, t, amount)
    const segs = next.segments.map(s => {
      if (edge === 'start' && s.id === segId) {
        // (its video position needs no change: it is kept relative to its start, and saving maps it
        // through the removed parts — with less removed, it starts that much earlier in the video)
        return { ...s, start_ms: t }
      }
      if (edge === 'end' && s.id === segId) return { ...s, end_ms: s.end_ms + amount }
      return s
    })
    const keyframes = { ...next.keyframes }
    if (edge === 'start') {
      // The view it had at its first moment holds over what comes back
      const grown = segs.find(s => s.id === segId)
      for (const b of grown?.crop_boxes ?? []) {
        const kfs = keyframes[b.id] ?? []
        if (kfs.length) keyframes[b.id] = [{ ...kfs[0], id: crypto.randomUUID(), t_ms: t }, ...kfs]
      }
    }
    // The video's own sound (detached) comes back with its picture
    const audio = next.audioTracks.map(tr => {
      if (!isMainAudio(tr)) return tr
      if (edge === 'start' && Math.abs(tr.start_ms - (t + amount)) <= 1) return { ...tr, start_ms: t, ...(tr.offset_ms != null ? { offset_ms: tr.offset_ms - amount } : {}) }
      if (edge === 'end' && tr.end_ms != null && Math.abs(tr.end_ms - t) <= 1) return { ...tr, end_ms: t + amount }
      return tr
    })
    skipCanvasTransitionRef.current = true
    seekAfterTrimRef.current = edge === 'start' ? t : t + amount - 1
    editor.applyTrim(segs, keyframes, nextTrims)
    useMediaStore.setState({ overlays: next.overlays, textOverlays: next.textOverlays, audioTracks: audio, transitions: next.transitions })
  }

  // The removed parts changed (a part cut out, an undo, a redo): the video may be standing in a
  // part that no longer plays, so put the playhead back on the timeline — at the join after a cut
  const seekAfterTrimRef = useRef<number | null>(null)
  const trimsKey = `${rawClip.start_ms}:${rawClip.end_ms}|${trims.map(r => r.join('-')).join(',')}`
  const trimsSeenRef = useRef(trimsKey)
  useEffect(() => {
    if (trimsSeenRef.current === trimsKey) return
    trimsSeenRef.current = trimsKey
    const at = seekAfterTrimRef.current ?? usePlayerStore.getState().currentTimeMs
    seekAfterTrimRef.current = null
    pause()
    seekToMs(Math.max(0, Math.min(at, trim.lengthMs - 1)))
  }, [trimsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Where the clip started and ended when it was made (before its ends were moved), on the timeline:
  // the timeline marks them while an end is dragged back out
  const madeClip = savedClip as typeof savedClip & { original_start_ms?: number | null; original_end_ms?: number | null }
  const clipMade = {
    start: trim.toTimeline(madeClip.original_start_ms ?? savedClip.start_ms),
    end: trim.toTimeline(madeClip.original_end_ms ?? savedClip.end_ms),
  }

  /** The least of a clip that must stay when a part is cut out */
  const MIN_CLIP_LEFT_MS = MIN_CLIP_MS

  // ── The clip's own start and end (dragged at the ends of the timeline) ─────────
  // A clip can play at most MAX_CLIP_MS (one that is already longer can only get shorter), and
  // can't reach past the start or end of its video.
  const videoDurationMs = Number((savedClip as unknown as { video_duration_ms?: number | null }).video_duration_ms) || 0
  const maxClipMs = Math.max(MAX_CLIP_MS, trim.lengthMs)
  const clipEdgeLimits = {
    startEarlier: Math.max(0, Math.min(rawClip.start_ms, maxClipMs - trim.lengthMs)),
    startLater: Math.max(0, trim.lengthMs - MIN_CLIP_MS),
    endEarlier: Math.max(0, trim.lengthMs - MIN_CLIP_MS),
    endLater: videoDurationMs > rawClip.end_ms ? Math.max(0, Math.min(videoDurationMs - rawClip.end_ms, maxClipMs - trim.lengthMs)) : 0,
  }
  /**
   * Move the clip's start (`delta` < 0: earlier, more video; > 0: later, cut from the front) or its
   * end (> 0: later; < 0: earlier). Cutting works like deleting that part (rippleDelete); adding
   * video carries the first / last section over it.
   * While the handle is dragged this runs many times (`done` false), each time from the clip as it
   * was when the drag began, so the timeline and preview show the change live; the whole drag is
   * one undo step.
   */
  type EdgeBase = { state: TimedState; trims: typeof trims; clipRange: typeof clipRange; start: number; end: number; map: typeof trim; limits: typeof clipEdgeLimits }
  const edgeBaseRef = useRef<EdgeBase | null>(null)
  function moveClipEdge(edge: 'start' | 'end', delta: number, done = true) {
    let base = edgeBaseRef.current
    if (!base) {
      const editor = useEditorStore.getState(), media = useMediaStore.getState()
      base = {
        state: { segments: editor.segments, keyframes: editor.keyframes, overlays: media.overlays, textOverlays: media.textOverlays, audioTracks: media.audioTracks, transitions: media.transitions },
        trims: editor.trims, clipRange: editor.clipRange, start: rawClip.start_ms, end: rawClip.end_ms, map: trim, limits: clipEdgeLimits,
      }
      edgeBaseRef.current = base
      pause()
    }
    if (done) { edgeBaseRef.current = null; setEdgeDragsDone(n => n + 1) }
    const lim = base.limits
    const d = Math.round(edge === 'start'
      ? Math.max(-lim.startEarlier, Math.min(lim.startLater, delta))
      : Math.max(-lim.endEarlier, Math.min(lim.endLater, delta)))
    const editor = useEditorStore.getState()
    if (!d) {
      // Back where it started: the clip as it was
      useEditorStore.setState({ segments: base.state.segments, keyframes: base.state.keyframes, trims: base.trims, clipRange: base.clipRange })
      useMediaStore.setState({ overlays: base.state.overlays, textOverlays: base.state.textOverlays, audioTracks: base.state.audioTracks, transitions: base.state.transitions })
      return
    }
    const step = edgeStep(base, edge, d)
    if (!step) return
    if (step.added) captionAfterEdgeRef.current = true
    if (!done) captionAfterEdgeRef.current = false   // only once the drag is over
    skipCanvasTransitionRef.current = true
    seekAfterTrimRef.current = step.playhead
    editor.applyTrim(step.next.segments, step.next.keyframes, cleanTrims(base.trims, step.start, step.end), [step.start, step.end])
    useMediaStore.setState({ overlays: step.next.overlays, textOverlays: step.next.textOverlays, audioTracks: step.next.audioTracks, transitions: step.next.transitions })
  }
  /**
   * One end of the clip moved by `d` ms of timeline (start: < 0 earlier, more video; > 0 cut from the
   * front. End: > 0 later; < 0 cut from the back), worked out from `b` without applying it.
   * null when something locked is in the way (the user is told).
   */
  function edgeStep(b: { state: TimedState; start: number; end: number; map: typeof trim }, edge: 'start' | 'end', d: number) {
    const state = b.state, trim0 = b.map, len = trim0.lengthMs
    let next: TimedState, start = b.start, end = b.end, playhead: number, added = false
    const onTop = (s: SegmentLocal) => isShot(s, mainVideoId)
    if (edge === 'start' && d < 0) { next = insertAtStart(state, -d, onTop); start += d; playhead = 0; added = true }
    else if (edge === 'end' && d > 0) { next = extendEnd(state, len, len + d, onTop); end += d; playhead = len + d - 1; added = true }
    else {
      // Cutting from an end: what's there goes, as when a part is deleted
      const [a, z] = edge === 'start' ? [0, d] : [len + d, len]
      const locked = lockedInRange(state, a, z)
      if (locked.length) { notifyLocked(`${locked[0][0].toUpperCase()}${locked[0].slice(1)} there is locked — unlock it first`); return null }
      next = rippleDelete(state, a, z)
      if (edge === 'start') { start = trim0.toSource(d); playhead = 0 } else { end = trim0.toSourceEnd(len + d); playhead = Math.max(0, len + d - 1) }
    }
    return { next, start, end, playhead, added }
  }

  function askDeleteFormat(segId: string) {
    if (blocked({ kind: 'section', id: segId })) return
    // Deleting from the timeline happens straight away, no question (as in other editors): Ctrl+Z brings it back
    const ins = segments.find(x => x.id === segId)
    if (ins && isInsert(ins, mainVideoId)) { removeInsert(segId); return }
    const seg = cropPositions.find(x => x.id === segId)
    if (!seg) return
    // Deleting a part of the main row takes it out and leaves an empty space where it was: the clip
    // keeps its length and nothing after it moves (visibility.ts isGapPart: nothing of the main
    // video is in it — no switch brings it back; Ctrl+Z does). A video on top or below plays there,
    // silent; with nothing there it is black. Dragging the part after it in closes it (movePart),
    // as does deleting it again (below). Frames: theirs is cut out as before.
    const stored = segments.find(x => x.id === segId)
    if (stored && !isGapPart(stored, mainVideoId) && !isFrameLayout(stored.layout)) {
      if (stored.locked) { notifyLocked('This part is locked — unlock it first'); return }
      pause()
      updateSegment(segId, { hidden: true, muted: true, crop_boxes: stored.crop_boxes.map((b, i) => (i === 0 ? { ...b, hidden: true } : b)) })
      setActiveSegmentId(null)
      return
    }
    // Deleting a gap (or a frame) cuts that part of the video out — unless it is (nearly) the
    // whole clip, or parts can't be cut out now: then only its look is reset
    const length = seg.end_ms - seg.start_ms
    if (!cutOk || clipLengthMs - length < MIN_CLIP_LEFT_MS) handleDeleteFormat(segId)
    else removePart(seg.start_ms, seg.end_ms)
  }

  function askRemoveFrame(segId: string) {
    if (sectionBlocked(segId)) return
    // (straight away, no question: Ctrl+Z brings it back)
    removeFrame(segId)
  }


  /** A frame item's edit: blocked (with a note why) when it, or its frame's section, is locked */
  function frameItemBlocked(segId: string, id: string) { return blocked({ kind: 'frameItem', id, segId }) }
  /** Remove an item from a frame: straight away, as other media (Undo brings it back) */
  function askRemoveFrameItem(segId: string, id: string) {
    if (frameItemBlocked(segId, id)) return
    removeFrameItem(segId, id)
    setActiveFrameItemId(cur => cur === id ? null : cur)
  }

  function askRemoveMain(segId: string, slot: number) {
    if (frameItemBlocked(segId, `main:${slot}`)) return
    if (sectionBlocked(segId)) return
    const seg = segments.find(x => x.id === segId)
    if (!seg || !isFrameLayout(seg.layout)) return
    // (straight away, no question: Ctrl+Z brings it back)
    updateFrame(segId, { main_slots: (frameOf(seg).main_slots ?? [0]).filter(i => i !== slot) })
    setActiveFrameItemId(cur => cur === `main:${slot}` ? null : cur)
  }

  /** Delete a text straight away, no question (Ctrl+Z brings it back) */
  function askDeleteTextOverlay(id: string) {
    if (blocked({ kind: 'text', id })) return
    deleteTextOverlay(id)
    setActiveTextOverlayId(cur => cur === id ? null : cur)
  }

  // ── Export: warn about empty frame slots first ─────────────────────────────
  // If the user goes ahead, the time where a slot is empty becomes plain Vertical (the main
  // video) — visible on the timeline, and one Undo step — and then the export starts.
  // Previous / next buttons in the timeline bar: jump to where a section starts (or the clip's ends)
  function jumpPrevSection() {
    const starts = [0, ...cropPositions.map(x => x.start_ms)].sort((a, b) => a - b)
    const prev = [...starts].reverse().find(t => t < currentTimeMs - 300) ?? 0
    seekToMs(prev)
  }
  function jumpNextSection() {
    const starts = cropPositions.map(x => x.start_ms).sort((a, b) => a - b)
    seekToMs(starts.find(t => t > currentTimeMs + 1) ?? clipDurationMs)
  }

  function requestExport(retranscribe = false) {
    const frames = cropPositions.filter(x => isFrameLayout(x.layout))
    const found = frames.flatMap(seg => emptySlotStretches(seg).map(st => ({ seg, ...st })))
    if (!found.length) { handleExport(retranscribe); return }
    pause()
    const lines = found.slice(0, 6).map(f => {
      const names = frameSlotLabels(f.seg.layout as FrameLayout, f.seg.frame)
      const slots = f.slots.map(i => names[i] ?? `Slot ${i + 1}`).join(' & ')
      return `• Frame ${frames.indexOf(f.seg) + 1} · ${FRAME_TEMPLATES[f.seg.layout as FrameLayout].name}: ${slots} slot empty ${msToLabel(f.start_ms)}–${msToLabel(f.end_ms)}`
    })
    if (found.length > 6) lines.push(`…and ${found.length - 6} more`)
    confirm({
      title: found.length === 1 ? 'A frame slot is empty' : 'Some frame slots are empty',
      body: `${lines.join('\n')}\n\nIf you export anyway, these parts become plain Vertical (just the main video). You can undo this afterwards.`,
      confirmLabel: 'Convert to Vertical & export',
      cancelLabel: 'Go to it',
      tone: 'warning',
      onCancel: () => { seekToMs(found[0].start_ms); setTool('frames'); toggleOptions(true) },
    }, () => {
      convertEmptyToVertical(found)
      handleExport(retranscribe)
    })
  }

  function convertEmptyToVertical(found: { seg: SegmentLocal; start_ms: number; end_ms: number }[]) {
    skipCanvasTransitionRef.current = true
    // Per frame, the empty time as merged stretches
    const bySeg = new Map<string, { a: number; b: number }[]>()
    for (const f of found) {
      const list = bySeg.get(f.seg.id) ?? []
      list.push({ a: f.start_ms, b: f.end_ms })
      bySeg.set(f.seg.id, list)
    }
    for (const [segId, raw] of bySeg) {
      const merged: { a: number; b: number }[] = []
      for (const r of raw.sort((x, y) => x.a - y.a)) {
        const last = merged[merged.length - 1]
        if (last && r.a <= last.b) last.b = Math.max(last.b, r.b)
        else merged.push({ ...r })
      }
      // Right to left: splitting keeps the left part's id, so the rest of the frame stays addressable
      for (const { a, b } of merged.reverse()) {
        const cur = useEditorStore.getState().segments.find(x => x.id === segId)
        if (!cur) break
        if (b < cur.end_ms - 100) splitAtMs(cur.id, b, getPositionAt)
        let target = cur.id
        if (a > cur.start_ms + 100) target = splitAtMs(cur.id, a, getPositionAt) ?? cur.id
        applyLayout(target, 'vertical', getVideoAR())
      }
    }
  }

  /** Delete a photo (or video on top) straight away, no question (Ctrl+Z brings it back) */
  function askDeleteOverlay(id: string) {
    if (blocked({ kind: 'photo', id })) return
    deleteOverlay(id)
    if (activeOverlayId === id) setActiveOverlayId(null)
  }

  async function handleInsertBroll(videoId: string) {
    const atMs = pickerAtMs ?? pendingBrollMs ?? currentTimeMs
    setPickerAtMs(null); setPendingBrollMs(null); setPickerOnly(null)
    // 5 s from here, across section edges if it gets there (it isn't cut off at the section's end)
    const at = Math.max(0, Math.min(atMs, clipLengthMs - 500))
    // The whole video goes in (its handles trim it), past the main video's end too
    const own = await videoLengthMs(videoId)
    const end = Math.min(MAX_CLIP_MS, at + (own ?? clipLengthMs - at))
    if (rangeBlocked(at, end)) return
    const newId = placeBroll(videoId, at, end, undefined, freeTrack(at, end))
    // Its settings open straight away: where it plays, which part of it, its sound
    pickShot(newId, true); seekToMs(at)
  }

  // A video from before editing copies were made: ask the worker for one (used from the next
  // time the clip is opened; until then the original plays)
  useEffect(() => {
    if (!(clip as unknown as { needs_proxy?: boolean }).needs_proxy || !mainVideoId) return
    fetch(`/api/videos/${mainVideoId}/proxy`, { method: 'POST' }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Borrowed reaction slots look ahead through the parts to start each one on time
  const trackBorrowed = borrowed.track
  useEffect(() => { trackBorrowed(playParts) }, [playParts, trackBorrowed])

  // ── B-roll panel ──────────────────────────────────────────────────────────────
  const brollShots = useMemo(() => shots
    .map(sg => ({ id: sg.id, start_ms: sg.start_ms, end_ms: sg.end_ms, title: (videoTitles[sg.crop_boxes[0].source_video_id!] ?? 'Video').replace(/^(Pixabay|Pexels): /, '') })),
  [shots, videoTitles])
  /** A video's full length (ms): as listed, else read from the file; null when it can't be read */
  async function videoLengthMs(videoId: string): Promise<number | null> {
    let lib = videoLibraryRef.current[videoId]
    if (!lib?.duration_ms) lib = (await loadVideoLibrary())?.[videoId] ?? lib
    if (lib?.duration_ms) return lib.duration_ms
    if (!lib?.url) return null
    return new Promise(resolve => {
      const el = document.createElement('video')
      el.preload = 'metadata'; el.muted = true
      const done = (v: number | null) => { el.removeAttribute('src'); el.load(); resolve(v) }
      el.onloadedmetadata = () => done(isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 1000) : null)
      el.onerror = () => done(null)
      setTimeout(() => done(null), 8000)
      el.src = lib!.url
    })
  }
  /** Stock footage (B-roll) as opposed to the user's own video: they have their own lanes and panels */
  function isStockShot(sg: SegmentLocal) {
    // (a video uploaded in the B-roll panel is B-roll too)
    if (sg.lane === 'broll') return true
    const lib = videoLibraryRef.current[sg.crop_boxes[0]?.source_video_id ?? '']
    return lib?.stock ?? /^(Pixabay|Pexels): /.test(lib?.title ?? '')
  }
  // ── Tracks (as in CapCut, tracks.ts): videos on top, B-roll, photos and text share the visual
  //    tracks and can be dragged from one to another; music has its own audio tracks ──
  /** What is on the visual tracks, fresh from the stores (photos and text not yet given a track are left out) */
  function visualItems(): (TrackItem & { ref: TrackRef })[] {
    const m = useMediaStore.getState()
    return [
      ...useEditorStore.getState().segments.filter(s => isShot(s, mainVideoId))
        .map(s => ({ id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, track: s.track ?? 0, ref: { kind: 'shot' as const, id: s.id } })),
      ...m.overlays.filter(o => o.type === 'image' && o.track != null)
        .map(o => ({ id: o.id, start_ms: o.start_ms, end_ms: o.end_ms, track: o.track, ref: { kind: 'photo' as const, id: o.id } })),
      ...m.textOverlays.filter(o => o.track != null)
        .map(o => ({ id: o.id, start_ms: o.start_ms, end_ms: o.end_ms, track: o.track, ref: { kind: 'text' as const, id: o.id } })),
    ]
  }
  /** Where a song stops: its trimmed end, else the end of the song (or the clip) */
  const songEndMs = (t: { id: string; start_ms: number; end_ms?: number; offset_ms?: number }) => t.end_ms
    ?? Math.min(clipLengthMs, t.start_ms + (musicDurations[t.id] != null ? musicDurations[t.id] - (t.offset_ms ?? 0) : clipLengthMs))
  /** What is on the audio tracks */
  function audioItems(): (TrackItem & { ref: TrackRef })[] {
    return useMediaStore.getState().audioTracks.filter(t => !isMainAudio(t) && t.track != null)
      .map(t => ({ id: t.id, start_ms: t.start_ms, end_ms: songEndMs(t), track: t.track, ref: { kind: 'music' as const, id: t.id } }))
  }
  /** A track asked for by dropping something on that track's row: the next thing put in takes it (when it has room there) */
  const preferTrackRef = useRef<{ audio: boolean; track: number; at: number } | null>(null)
  /** A new row above all the others: higher than every track, and above the rows under the main video */
  const newTopTrack = (items: TrackItem[]) => Math.max(Math.max(-1, ...items.map(i => i.track ?? 0)) + 1, belowRowsRef.current)
  /** Rows under the main video left empty (the last thing moved off one) go: the rows above close up */
  function tidyRowsBelow() {
    let below = belowRowsRef.current
    for (let t = below - 1; t >= 0; t--) {
      const items = visualItems()
      if (items.some(i => (i.track ?? 0) === t)) continue
      for (const i of items) if ((i.track ?? 0) > t) setTrackOf(i.ref, (i.track ?? 0) - 1)
      below -= 1
    }
    if (below !== belowRowsRef.current) { belowRowsRef.current = below; setBelowRows(below) }
  }
  /** A new row under the main video, at the bottom: everything else moves up a track. Its track (0). */
  function openRowBelow(except?: string): number {
    for (const it of visualItems()) if (it.id !== except) setTrackOf(it.ref, (it.track ?? 0) + 1)
    setBelowRows(n => n + 1)
    belowRowsRef.current += 1
    return 0
  }
  function preferTrack(lane: string | null) {
    // Dropped on "below the main video": a new row at the bottom
    if (lane === 'track-below') {
      preferTrackRef.current = { audio: false, track: openRowBelow(), at: Date.now() }
      return
    }
    // Dropped on "above the main video" (the timeline's top): a new row over all the others
    if (lane === 'track-new') {
      preferTrackRef.current = { audio: false, track: newTopTrack(visualItems()), at: Date.now() }
      return
    }
    const m = lane ? /^(track|audio)-(\d+)$/.exec(lane) : null
    preferTrackRef.current = m ? { audio: m[1] === 'audio', track: Number(m[2]), at: Date.now() } : null
  }
  /** The track for something new at [start, end): the one it was dropped on, else the lowest with room */
  function freeTrack(start: number, end: number, exceptId?: string, audio = false, items: TrackItem[] = audio ? audioItems() : visualItems()): number {
    const want = preferTrackRef.current
    if (want && want.audio === audio && Date.now() - want.at < 120_000) {
      preferTrackRef.current = null
      return freeTrackIn(items, start, end, exceptId, want.track)
    }
    return freeTrackIn(items, start, end, exceptId)
  }
  // Photos, text and music put in without a track (however they were added) get one
  useEffect(() => {
    const photos = overlays.filter(o => o.type === 'image' && o.track == null)
    const texts = textOverlays.filter(o => o.track == null)
    if (photos.length || texts.length) {
      const placed: TrackItem[] = visualItems()
      const got: Record<string, number> = {}
      for (const it of [...photos, ...texts]) {
        got[it.id] = freeTrack(it.start_ms, it.end_ms, undefined, false, placed)
        placed.push({ id: it.id, start_ms: it.start_ms, end_ms: it.end_ms, track: got[it.id] })
      }
      if (photos.length) setOverlays(prev => prev.map(o => (o.track == null && got[o.id] != null ? { ...o, track: got[o.id] } : o)))
      if (texts.length) setTextOverlays(prev => prev.map(o => (o.track == null && got[o.id] != null ? { ...o, track: got[o.id] } : o)))
    }
    const songs = audioTracks.filter(t => !isMainAudio(t) && t.track == null)
    if (songs.length) {
      const placed: TrackItem[] = audioItems()
      const got: Record<string, number> = {}
      for (const t of songs) {
        const end = songEndMs(t)
        got[t.id] = freeTrack(t.start_ms, end, undefined, true, placed)
        placed.push({ id: t.id, start_ms: t.start_ms, end_ms: end, track: got[t.id] })
      }
      setAudioTracks(prev => prev.map(t => (t.track == null && got[t.id] != null ? { ...t, track: got[t.id] } : t)))
    }
  }, [overlays, textOverlays, audioTracks]) // eslint-disable-line react-hooks/exhaustive-deps
  function setTrackOf(ref: TrackRef, track: number) {
    if (ref.kind === 'shot') updateSegment(ref.id, { track })
    else if (ref.kind === 'photo') updateOverlay(ref.id, { track })
    else if (ref.kind === 'text') updateTextOverlay(ref.id, { track })
    else setAudioTracks(prev => prev.map(t => (t.id === ref.id ? { ...t, track } : t)))
  }
  /**
   * What's picked together carried (the timeline's group drag), once let go: each of `ids` on that
   * kind of row goes `delta` rows (as Resolve moves a selection across tracks), and where anything else
   * is on those rows there, rows open for them in place. One locked: they stay.
   */
  function moveGroupRows(ids: string[], delta: number, family: 'visual' | 'audio') {
    const m = useMediaStore.getState()
    const all: Array<TrackItem & { ref: TrackRef }> = family === 'audio'
      ? m.audioTracks.filter(t => !isMainAudio(t)).map(t => ({ id: t.id, start_ms: t.start_ms, end_ms: songEndMs(t), track: t.track ?? 0, ref: { kind: 'music' as const, id: t.id } }))
      : [
          ...useEditorStore.getState().segments.filter(s => isShot(s, mainVideoId))
            .map(s => ({ id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, track: s.track ?? 0, ref: { kind: 'shot' as const, id: s.id } })),
          ...m.overlays.filter(o => o.type === 'image' || (o.type === 'video' && o.source_video_id))
            .map(o => ({ id: o.id, start_ms: o.start_ms, end_ms: o.end_ms, track: o.track ?? 0, ref: { kind: 'photo' as const, id: o.id } })),
          ...m.textOverlays.map(o => ({ id: o.id, start_ms: o.start_ms, end_ms: o.end_ms, track: o.track ?? 0, ref: { kind: 'text' as const, id: o.id } })),
        ]
    const moving = all.filter(i => ids.includes(i.id))
    if (!moving.length) return
    const ctlOf = (r: TrackRef): CtlTarget => (r.kind === 'shot' ? { kind: 'broll', id: r.id } : { kind: r.kind, id: r.id })
    if (moving.some(i => blocked(ctlOf(i.ref)))) return
    const stay = all.filter(i => !ids.includes(i.id))
    // (videos, photos and text carried under the bottom row: new rows open there for them, as for one
    // thing let go under the lowest row)
    const under = family === 'visual' ? Math.max(0, -Math.min(...moving.map(i => (i.track ?? 0) + delta))) : 0
    if (family === 'audio' && moving.some(i => (i.track ?? 0) + delta < 0)) return
    const clash = moving.some(i => {
      const t = (i.track ?? 0) + delta
      return stay.some(o => (o.track ?? 0) === t && o.start_ms < i.end_ms && o.end_ms > i.start_ms)
    })
    if (!delta && !clash) return
    for (let k = 0; k < under; k++) openRowBelow()
    const want = new Map(moving.map(i => [i.id, (i.track ?? 0) + delta + under]))
    // Something else on the rows they land on there (as CapCut and Premiere do): rows open right there
    // for them — carried up, just above what's there; down, just below it — the rest moving out of the
    // way. Under the main video and above it separately, so none crosses over it
    if (clash) {
      const lift = delta >= 0 ? 1 : 0
      const below = family === 'visual' ? belowRowsRef.current : 0
      const ts = [...want.values()]
      const low = ts.filter(t => t < below), high = ts.filter(t => t >= below)
      const lowN = low.length ? Math.max(...low) - Math.min(...low) + 1 : 0
      const highN = high.length ? Math.max(...high) - Math.min(...high) + 1 : 0
      const lowAt = low.length ? Math.min(...low) + lift : 0, highAt = high.length ? Math.min(...high) + lift : 0
      const ids = new Set(moving.map(i => i.id))
      for (const o of family === 'audio'
        ? useMediaStore.getState().audioTracks.filter(t => !isMainAudio(t) && !ids.has(t.id)).map(t => ({ ref: { kind: 'music' as const, id: t.id }, track: t.track ?? 0 }))
        : visualItems().filter(i => !ids.has(i.id))) {
        const t = o.track ?? 0
        const by = (lowN && t >= lowAt ? lowN : 0) + (highN && t >= highAt ? highN : 0)
        if (by) setTrackOf(o.ref, t + by)
      }
      // (the ones above the main video go up past the rows opened under it)
      for (const [id, t] of want) want.set(id, t + lift + (lowN && t >= below ? lowN : 0))
      if (lowN) { belowRowsRef.current += lowN; setBelowRows(n => n + lowN) }
    }
    for (const i of moving) setTrackOf(i.ref, want.get(i.id)!)
    if (family === 'visual') tidyRowsBelow()
  }
  /**
   * The main video's parts among what's picked, carried along with it: each placed exactly at its new
   * start (placeInRow, as one part let go over empty room). All or none: one with no room there (another
   * part of the main video in the way) and they all stay, with a note.
   */
  function moveGroupParts(moves: { id: string; startMs: number }[]) {
    if (!moves.length) return
    const editor = useEditorStore.getState(), media = useMediaStore.getState()
    if (trimmed) { trimsToPieces(); notifyLocked('The clip is ready to move its parts now — move them again'); return }
    if (media.audioTracks.some(isMainAudio)) { notifyLocked('The main video’s sound is detached: move its parts one at a time'); return }
    if (moves.some(mv => editor.segments.find(x => x.id === mv.id)?.locked)) { notifyLocked('A part is locked — unlock it to move it'); return }
    // (the one going furthest first: later ones then land where the earlier ones were)
    const ahead = moves.map(mv => ({ ...mv, from: editor.segments.find(x => x.id === mv.id)?.start_ms ?? mv.startMs }))
    const right = ahead.some(mv => mv.startMs > mv.from)
    ahead.sort((a, b) => (right ? b.from - a.from : a.from - b.from))
    let segs = editor.segments, kfs = editor.keyframes, pinnedYet = piecesOn
    for (const mv of ahead) {
      const next = placeInRow(segs, kfs, mv.id, mv.startMs, mainVideoId, pinnedYet, MAX_CLIP_MS)
      if (next === null) continue
      if (next === 'between') { notifyLocked('Another part of the main video is in the way there — the parts stay where they were'); return }
      segs = next.segments; kfs = next.keyframes; pinnedYet = true
    }
    if (segs === editor.segments) return
    pause()
    skipCanvasTransitionRef.current = true
    editor.applyTrim(segs, kfs, editor.trims, rangeAfterPieces(segs))
    useMediaStore.setState({ transitions: media.transitions.filter(t => segs.some(x => x.id === t.after_segment_id)) })
  }
  /**
   * Something dragged to a track (`'new'`: a new track over the others, or under the music), or
   * moved in time on its own: it goes on that track when it has room there. Else, like CapCut, a
   * new track opens just above that one (the tracks above move up one); music takes the next audio
   * track with room.
   */
  function dropOnTrack(ref: TrackRef, target: number | 'new' | 'new-below') {
    const audio = ref.kind === 'music'
    const items = audio ? audioItems() : visualItems()
    const me = items.find(i => i.id === ref.id)
    if (!me) return
    if (target === 'new-below') {
      if (audio) return
      const ctl0: CtlTarget = ref.kind === 'shot' ? { kind: 'broll', id: ref.id } : { kind: ref.kind, id: ref.id }
      if (blocked(ctl0)) return
      // (it was the only thing on the lowest row under the main video: it stays there)
      if ((me.track ?? 0) === 0 && belowRowsRef.current > 0 && !items.some(i => i.id !== me.id && (i.track ?? 0) === 0)) return
      setTrackOf(ref, openRowBelow(ref.id))
      tidyRowsBelow()
      return
    }
    const cur = me.track ?? 0
    const ctl: CtlTarget = ref.kind === 'shot' ? { kind: 'broll', id: ref.id } : { kind: ref.kind, id: ref.id }
    if (target !== cur && blocked(ctl)) return
    const others = items.filter(i => i.id !== me.id)
    let t: number
    const lift: TrackRef[] = []
    if (target === 'new') t = audio ? Math.max(-1, ...others.map(i => i.track ?? 0)) + 1 : newTopTrack(others)
    else if (fitsOn(others, target, me.start_ms, me.end_ms)) t = target
    else if (audio) t = freeTrackIn(others, me.start_ms, me.end_ms, undefined, target)
    else {
      for (const i of others) if ((i.track ?? 0) > target) lift.push(i.ref)
      t = target + 1
      // (the new row opens next to one under the main video: it's under the main video too)
      if (target < belowRowsRef.current) { setBelowRows(n => n + 1); belowRowsRef.current += 1 }
    }
    if (t === cur && !lift.length) return
    for (const r of lift) setTrackOf(r, (items.find(i => i.id === r.id)!.track ?? 0) + 1)
    setTrackOf(ref, t)
    if (!audio) tidyRowsBelow()
  }
  /** B-roll uploaded from the device (B-roll panel, Upload): at the playhead, 5 s or the video's own length if shorter */
  async function addUploadedBroll(videoId: string) { await addUploadedVideo(videoId, currentTimeMs, 'broll') }
  /** An uploaded video put in at `atMs`: as B-roll, or as one of the user's videos (its panel opens) */
  async function addUploadedVideo(videoId: string, atMs: number, lane: 'broll' | 'video'): Promise<number | null> {
    const at = Math.max(0, Math.min(atMs, clipLengthMs - 500))
    // The whole video goes in (its handles trim it), past the main video's end too: the timeline
    // goes on for it, the main video staying as long as it is
    const own = await videoLengthMs(videoId)
    const len = Math.min(own ?? clipLengthMs - at, MAX_CLIP_MS - at)
    if (rangeBlocked(at, at + len)) return null
    const id = placeBroll(videoId, at, at + len, lane === 'broll' ? 'broll' : undefined, freeTrack(at, at + len))
    pickShot(id, lane === 'video')
    seekToMs(at)
    seekAfterInsertRef.current = at
    // (where it ends: the next of several files dropped together goes in there)
    return at + len
  }

  // ── Drag and drop: files from the computer (on the timeline or the sidebar), stock footage
  //    from the B-roll search (on the timeline) ──
  const dropTargetRef = useRef<{ atMs: number; lane: 'broll' | 'video' | 'insert'; frame?: { segId: string; slot: number } } | null>(null)
  /** Several files dropped together (dropSeveral): told where the video just uploaded ends (null: it didn't go in) */
  const dropNextRef = useRef<((endMs: number | null) => void) | null>(null)
  const dropNext = (endMs: number | null) => { const go = dropNextRef.current; dropNextRef.current = null; go?.(endMs) }
  const dropUpload = useVideoUpload(videoId => {
    const t = dropTargetRef.current
    dropTargetRef.current = null
    // Dropped on a frame's lane: into that slot once it's uploaded
    if (t?.frame && segments.some(x => x.id === t.frame!.segId)) { loadVideoLibrary(); videoIntoSlot(t.frame, videoId, t.atMs); dropNext(null) }
    else if (t?.lane === 'insert') {
      // Into the main strip, in between (inserts.ts)
      loadVideoLibrary().then(() => videoLengthMs(videoId)).then(len => { insertVideo(videoId, t.atMs, len); dropNext(len != null ? t.atMs + len : null) })
        .catch(e => { notifyLocked(e instanceof Error ? e.message : 'Could not put the video in'); dropNext(null) })
    } else if (t) addUploadedVideo(videoId, t.atMs, t.lane).then(dropNext, e => { notifyLocked(e instanceof Error ? e.message : 'Could not add the video'); dropNext(null) })
    else dropNext(null)
    loadLibrary()
  }, { asset: true })
  const dropUploading = dropUpload.state.phase === 'uploading' || dropUpload.state.phase === 'finishing'
  useEffect(() => {
    if (dropUpload.state.phase !== 'failed') return
    if (dropUpload.state.error) notifyLocked(`Upload failed: ${dropUpload.state.error}`)
    dropNext(null)
  }, [dropUpload.state.phase]) // eslint-disable-line react-hooks/exhaustive-deps
  const [sidebarDrop, setSidebarDrop] = useState(false)
  const kindOfFile = (f: File): 'video' | 'photo' | 'music' | null => {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    if (f.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'photo'
    if (f.type.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return 'music'
    if (f.type.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi'].includes(ext)) return 'video'
    return null
  }
  async function uploadPhotoFile(file: File): Promise<{ storage_path: string; preview_url: string }> {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/overlays/upload', { method: 'POST', body: form })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Could not upload the photo')
    return data
  }
  /** A photo uploaded and put in at `atMs` for 5 s (its settings open) */
  async function addPhotoFileAt(file: File, atMs: number) {
    const data = await uploadPhotoFile(file)
    addPhotoPathAt(data.storage_path, data.preview_url, atMs)
    loadLibrary()
  }
  /** A stored photo put in at `atMs` for 5 s (its settings open) */
  function addPhotoPathAt(storagePath: string, previewUrl: string | null, atMs: number) {
    const at = Math.max(0, Math.min(atMs, clipLengthMs - 500))
    const id = crypto.randomUUID()
    setOverlays(prev => [...prev, {
      id, clip_id: clip.id, type: 'image' as const,
      storage_path: storagePath, preview_url: previewUrl || undefined,
      source_video_id: null, source_offset_ms: 0,
      ...PHOTO_FIRST_BOX, start_ms: at, end_ms: Math.min(clipLengthMs, at + 5000),
      z_index: prev.length + 1, created_at: new Date().toISOString(),
    }])
    fitPhotoBox(id, previewUrl)
    pickPhoto(id)
    seekToMs(at)
  }
  /**
   * A photo just put in: its box takes the photo's own shape (not the whole frame) as soon as the
   * picture has loaded — 80% of the frame's width, less for a tall photo, in the middle. Left alone
   * if it was moved or resized meanwhile.
   */
  function fitPhotoBox(id: string, url: string | null | undefined) {
    if (!url) return
    const img = new Image()
    img.onload = () => {
      const ar = img.naturalWidth / img.naturalHeight
      if (!(ar > 0) || !isFinite(ar)) return
      const cur = useMediaStore.getState().overlays.find(o => o.id === id)
      if (!cur || cur.x !== PHOTO_FIRST_BOX.x || cur.y !== PHOTO_FIRST_BOX.y || cur.w !== PHOTO_FIRST_BOX.w || cur.h !== PHOTO_FIRST_BOX.h) return
      // In px of the 1080 × 1920 frame: as wide as 80% of it, at most 60% of its height
      let wPx = 1080 * 0.8, hPx = wPx / ar
      if (hPx > 1920 * 0.6) { hPx = 1920 * 0.6; wPx = hPx * ar }
      const w = wPx / 1080, h = hPx / 1920
      updateOverlay(id, { x: (1 - w) / 2, y: (1 - h) / 2, w, h })
    }
    img.src = url
  }
  // ── The Media library: the user's imported videos, photos and audio (api/media) ──
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [importCount, setImportCount] = useState(0)
  const importingLabel = importCount > 0 || dropUploading
    ? `Importing${dropUploading ? ` ${dropUpload.state.progress}%` : '…'}` : null
  async function loadLibrary() {
    setLibraryLoading(true)
    try {
      const res = await fetch('/api/media')
      if (res.ok) setLibraryItems(((await res.json()) as { items: LibraryItem[] }).items ?? [])
    } catch { /* offline: keep what is shown */ } finally { setLibraryLoading(false) }
  }
  useEffect(() => { if (tool === 'media' && optionsOpen) loadLibrary() }, [tool, optionsOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  /** What is already in this clip: the library marks it "Added" */
  const usedMedia = useMemo(() => new Set<string>([
    ...shots.map(s => s.crop_boxes[0]?.source_video_id ?? '').filter(Boolean),
    ...overlays.map(o => o.storage_path ?? '').filter(Boolean),
    ...audioTracks.map(t => t.storage_path),
  ]), [shots, overlays, audioTracks])
  /**
   * Delete from the library. Not something this clip uses (it's in the clip, maybe not saved yet)
   * or this clip's own video; the server also refuses what another clip uses.
   */
  async function deleteLibraryItem(item: LibraryItem) {
    if (item.kind === 'video' && item.id === mainVideoId) { notifyLocked('This is the video this clip is made from: it can\u2019t be deleted here'); return }
    if (usedMedia.has(item.id)) { notifyLocked('It\u2019s in this clip: take it out of the clip first'); return }
    try {
      const res = await fetch('/api/media', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: item.kind, id: item.id }) })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { notifyLocked(body.error || 'Could not delete it'); return }
      setLibraryItems(list => list.filter(i => !(i.kind === item.kind && i.id === item.id)))
    } catch { notifyLocked('Could not delete it: check your connection') }
  }
  /** Import: files go into the library (not onto the timeline): + or a drag puts them in */
  async function importMedia(files: File[]) {
    let videoStarted = false
    for (const f of files) {
      const kind = kindOfFile(f)
      if (kind === 'video') {
        if (videoStarted || dropUploading) { notifyLocked('One video at a time: import the next one when this one is in'); continue }
        videoStarted = true
        // (imported after "Insert video": it goes in there once it's up)
        dropTargetRef.current = insertAtMs != null ? { atMs: insertAtMs, lane: 'insert' } : null
        dropUpload.start(f)
        continue
      }
      if (!kind) { notifyLocked(`${f.name} can\u2019t be imported: pick videos, photos or audio`); continue }
      setImportCount(n => n + 1)
      try {
        if (kind === 'photo') await uploadPhotoFile(f)
        else { if (musicTooBig(f)) continue; await uploadMusicFile(f) }
      } catch (e) {
        notifyLocked(e instanceof Error ? e.message : `${f.name} could not be imported`)
      } finally { setImportCount(n => n - 1) }
    }
    loadLibrary()
  }
  /** Music already stored (from the library) put in at `atMs`: the whole song, up to the clip's end */
  function addStoredMusic(storagePath: string, url: string | null, atMs: number, set: { volume: number; duck_under_speech: boolean; fade_in: boolean; fade_out: boolean } = SOUND_DEFAULTS.music) {
    const id = crypto.randomUUID()
    const start = Math.max(0, Math.min(Math.round(atMs), clipLengthMs - 500))
    setAudioTracks(prev => [...prev, { id, clip_id: clip.id, storage_path: storagePath, start_ms: start, ...set }])
    if (url) setMusicUrls(m => ({ ...m, [id]: url }))
    pickMusicTrack(id, false)
    seekToMs(start)
  }
  /**
   * A sound picked in the Music tool's sound library: stored in the user's audio (the server), then
   * put on the clip at the playhead — a song as any song, a short effect without fades or ducking
   */
  async function addLibrarySound(item: SoundItem, kind: SoundKind) {
    const res = await fetch('/api/audio/library/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'The sound could not be added.')
    addStoredMusic(data.storage_path, data.url, currentTimeMs, SOUND_DEFAULTS[kind])
  }
  /** A library item put in at `atMs` (+ on it, or dragged onto the timeline: `lane` where it was dropped) */
  function addLibraryItem(item: LibraryItem, atMs: number, lane: string | null) {
    pause()
    // After "Picture in picture": the video goes in a small window over the clip
    // After "Overlay": a video goes on top full screen, a photo in its box (then the Full screen /
    // Window switch changes it)
    if (overlayAtMs != null && lane === null && item.kind !== 'audio') {
      const at = overlayAtMs
      setOverlayAtMs(null)
      if (item.kind === 'image') { addPhotoPathAt(item.id, item.url, at); return }
      addUploadedVideo(item.id, at, 'video').catch(e => notifyLocked(e instanceof Error ? e.message : 'Could not add the video'))
      return
    }
    if (item.kind === 'video' && pipAtMs != null && lane === null) {
      const at = pipAtMs
      videoLengthMs(item.id).then(len => addPip(item.id, at, len)).catch(e => notifyLocked(e instanceof Error ? e.message : 'Could not add the video'))
      return
    }
    // A video from Media goes into the main strip, in between (as in InShot / CapCut): where
    // "Insert video" was picked, where it was dropped on the strip, or at the playhead — at the
    // nearest cut when the playhead is close to one. (Video on top: the timeline's + menu, or
    // dropped on a lane under the strip.) At the main video's end or past it: on after its last part.
    if (item.kind === 'video' && afterMain(atMs, lane)) {
      videoLengthMs(item.id).then(len => insertVideo(item.id, mainEndMs(), len, 0)).catch(e => notifyLocked(e instanceof Error ? e.message : 'Could not put the video in'))
      return
    }
    if (item.kind === 'video' && (lane === null || lane === 'main')) {
      const at = lane === 'main' ? atMs : insertAtMs ?? atMs
      const snap = lane === null && insertAtMs == null ? 1500 : 60
      videoLengthMs(item.id).then(len => insertVideo(item.id, at, len, snap)).catch(e => notifyLocked(e instanceof Error ? e.message : 'Could not put the video in'))
      return
    }
    preferTrack(lane)
    // A frame showing there: into its slot (the one dropped on, or the first free one)
    if (item.kind === 'image' || item.kind === 'video') {
      const target = frameSlotFor(atMs, lane, item.kind === 'image' ? 'photo' : 'video')
      if (target === 'refused') return
      if (target) {
        if (item.kind === 'image') photoIntoSlot(target, item.id, item.url, atMs)
        else { if (!videoLibraryRef.current[item.id]) loadVideoLibrary(); videoIntoSlot(target, item.id, atMs) }
        return
      }
    }
    if (item.kind === 'image') { addPhotoPathAt(item.id, item.url, atMs); return }
    if (item.kind === 'audio') { addStoredMusic(item.id, item.url, atMs); return }
    addUploadedVideo(item.id, atMs, lane === 'broll' ? 'broll' : 'video').catch(e => notifyLocked(e instanceof Error ? e.message : 'Could not add the video'))
  }
  function dropMedia(json: string, atMs: number, lane: string | null) {
    let item: LibraryItem
    try { item = JSON.parse(json) as LibraryItem } catch { return }
    if (item?.id && item.kind) addLibraryItem(item, atMs, lane)
  }

  /**
   * Files dropped at `atMs`: the first one goes in. A video becomes B-roll on the B-roll lane (or
   * when dropped on the B-roll sidebar), else one of the user's videos; a video dropped on the
   * Music lane gives its sound. Photos and music go on their own lanes.
   */
  function dropFiles(files: File[], atMs: number, lane: string | null) {
    if (files.length > 1 && !lane?.startsWith('frame:')) { dropSeveral(files, atMs, lane); return }
    const f = files[0]
    if (!f) return
    const kind = (lane === 'music' || lane?.startsWith('audio-')) && kindOfFile(f) === 'video' ? 'music' : kindOfFile(f)
    pause()
    preferTrack(lane)
    if (kind === 'music') { addMusicTrack(f, Math.round(atMs)); openSettings('music'); return }
    // Dropped on a frame's lane: into that slot
    const target = (kind === 'photo' || kind === 'video') && lane?.startsWith('frame:') ? frameSlotFor(atMs, lane, kind) : null
    if (target === 'refused') return
    if (kind === 'photo') {
      if (target) {
        uploadPhotoFile(f).then(d => { photoIntoSlot(target, d.storage_path, d.preview_url, atMs); loadLibrary() })
          .catch(e => notifyLocked(e instanceof Error ? e.message : 'Could not add the photo'))
        return
      }
      addPhotoFileAt(f, atMs).catch(e => notifyLocked(e instanceof Error ? e.message : 'Could not add the photo')); return
    }
    if (kind === 'video') {
      if (dropUploading) { notifyLocked('Wait for the upload in progress to finish'); return }
      const asBroll = lane === 'broll' || (lane === null && tool === 'media' && mediaSection === 'library')
      const toEnd = !target && afterMain(atMs, lane)
      dropTargetRef.current = { atMs: toEnd ? mainEndMs() : atMs, lane: lane === 'main' || toEnd ? 'insert' : asBroll ? 'broll' : 'video', ...(target ? { frame: target } : {}) }
      openMedia(asBroll ? 'library' : 'media')
      dropUpload.start(f)
      return
    }
    notifyLocked('That kind of file can\u2019t be added: drop a video, a photo or music')
  }
  /** How long a song (or a video's sound) is, from the file (null: unknown) */
  function audioFileMs(f: File): Promise<number | null> {
    return new Promise(resolve => {
      const a = new Audio(), url = URL.createObjectURL(f)
      const done = (ms: number | null) => { URL.revokeObjectURL(url); resolve(ms) }
      a.preload = 'metadata'
      a.onloadedmetadata = () => done(isFinite(a.duration) ? Math.round(a.duration * 1000) : null)
      a.onerror = () => done(null)
      a.src = url
    })
  }
  /**
   * Several files dropped together (as in Resolve): each goes in where the one before ends, in the
   * order they were picked, on the row they were dropped on — a photo for 5 s, music and videos
   * their own length. Videos upload one at a time; what no longer fits before the clip's end, or
   * isn't a photo, video or music, is left out (and said so).
   */
  async function dropSeveral(files: File[], atMs: number, dropLane: string | null) {
    if (dropUploading) { notifyLocked('Wait for the upload in progress to finish'); return }
    pause()
    // (dropped on "above" / "below the main video": one new row there, all of them on it)
    const lane = dropLane === 'track-new' ? `track-${newTopTrack(visualItems())}`
      : dropLane === 'track-below' ? `track-${openRowBelow()}` : dropLane
    let at = Math.round(atMs), left = 0, opened = false
    for (const [i, f] of files.entries()) {
      const kind = (lane === 'music' || lane?.startsWith('audio-')) && kindOfFile(f) === 'video' ? 'music' : kindOfFile(f)
      if (!kind) { left++; continue }
      // (a video at the main video's end goes on after it: each next one then follows it there)
      const toEnd = kind === 'video' && afterMain(at, lane)
      if (!toEnd && at > clipLengthMs - 500) { left += files.length - i; break }
      preferTrack(lane)
      let end: number | null = null
      try {
        if (kind === 'photo') {
          await addPhotoFileAt(f, at)
          end = Math.min(clipLengthMs, at + 5000)
        } else if (kind === 'music') {
          if (musicTooBig(f)) { left++; continue }
          const len = await audioFileMs(f)
          addMusicTrack(f, at)
          end = Math.min(clipLengthMs, at + (len ?? 5000))
        } else {
          if (!opened) { opened = true; openMedia(lane === 'broll' ? 'library' : 'media') }
          end = await new Promise<number | null>(resolve => {
            dropNextRef.current = resolve
            dropTargetRef.current = { atMs: toEnd ? mainEndMs() : at, lane: lane === 'main' || toEnd ? 'insert' : lane === 'broll' ? 'broll' : 'video' }
            dropUpload.start(f)
          })
        }
      } catch (e) {
        notifyLocked(e instanceof Error ? e.message : 'Could not add that file')
      }
      if (end == null) { left++; continue }
      at = end
    }
    if (left) notifyLocked(`${left} of the ${files.length} files couldn\u2019t go in: no room before the clip\u2019s end, or not a photo, video or music`, 3500)
  }
  /** Stock footage dragged from the B-roll search onto the timeline: in at that spot, its whole length (up to the clip's end) */
  function dropStock(json: string, atMs: number, lane?: string | null) {
    let item: StockResult
    try { item = JSON.parse(json) as StockResult } catch { return }
    if (!item?.ref || !item.url) return
    const len = item.duration > 0 ? Math.round(item.duration * 1000) : 5000
    pause()
    preferTrack(lane ?? null)
    // Dropped on a frame's lane: into that slot
    const target = lane?.startsWith('frame:') ? frameSlotFor(atMs, lane, 'video') : null
    if (target === 'refused') return
    if (target) {
      importStock(item).then(videoId => videoIntoSlot(target, videoId, atMs))
        .catch(e => notifyLocked(e instanceof Error ? e.message : 'Could not add that video'))
      return
    }
    // At the main video's end or past it: on after its last part
    if (afterMain(atMs, lane)) {
      importStock(item).then(videoId => insertVideo(videoId, mainEndMs(), len, 0))
        .catch(e => notifyLocked(e instanceof Error ? e.message : 'Could not add that video'))
      return
    }
    addStockBroll(item, len, atMs).catch(e => notifyLocked(e instanceof Error ? e.message : 'Could not add that video'))
  }
  /** A video on top picked (on its lane, in a list): Hide / Mute / Lock, Trim and Delete act on it (its ends trim it on the timeline). The section under it is not picked. */
  function pickShot(id: string, _open = false) {
    setPickedSegId(id)
  }

  // ── Video panel: one video on top, its place in the clip, which part of it plays, its sound ──
  const panelVideos: (PanelVideo & { stock: boolean })[] = shots.map(sg => {
    const box = sg.crop_boxes[0]
    const lib = videoLibrary[box.source_video_id!]
    return {
      id: sg.id, title: (lib?.title ?? 'Video').replace(/^(Pixabay|Pexels): /, ''), url: lib?.url,
      start_ms: sg.start_ms, end_ms: sg.end_ms, source_offset_ms: box.source_offset_ms ?? 0, source_ms: lib?.duration_ms ?? null,
      muted: box.muted !== false, volume: box.volume ?? 1, hidden: !!box.hidden, locked: isLocked({ kind: 'broll', id: sg.id }),
      stock: isStockShot(sg),
    }
  })
  const ownVideos = panelVideos.filter(v => !v.stock), stockVideos = panelVideos.filter(v => v.stock)
  const shotPanelProps = {
    selectedId: pickedShot?.id ?? (playingAdded ? playingSegment?.id ?? null : null),
    clipLengthMs, currentTimeMs,
    onSelect: (id: string) => pickShot(id),
    onSeek: (ms: number) => { pause(); seekToMs(ms) },
    onRetime: panelRetime,
    onSlip: (id: string, offset: number) => patchShotBox(id, { source_offset_ms: Math.max(0, Math.round(offset)) }),
    onSound: (id: string, p: { muted?: boolean; volume?: number }) => patchShotBox(id, { ...(p.muted !== undefined ? { muted: p.muted } : {}), ...(p.volume !== undefined ? { volume: p.volume } : {}) }),
    onToggle: (id: string, k: 'hidden' | 'locked') => toggleCtl({ kind: 'broll', id }, k),
    onRemove: (id: string) => { if (!blocked({ kind: 'broll', id })) removeBroll(id) },
  }
  function panelRetime(id: string, startMs: number, endMs: number, moved: boolean) {
    if (blocked({ kind: 'broll', id })) return
    const start = Math.round(Math.max(0, startMs)), end = Math.round(Math.min(MAX_CLIP_MS, endMs))
    if (end - start < 300 || rangeBlocked(start, end, id)) return
    retimeShot(id, start, end, moved)
  }
  /** The first slot of a video on top changed (which part of its video, its sound) */
  function patchShotBox(id: string, patch: Partial<CropBoxLocal>) {
    if (blocked({ kind: 'broll', id })) return
    const sg = useEditorStore.getState().segments.find(x => x.id === id)
    if (sg) updateSegment(id, { crop_boxes: sg.crop_boxes.map((b, i) => (i === 0 ? { ...b, ...patch } : b)) })
  }

  /** Save the stock video as the user's asset, then put it in at the playhead as a muted cutaway */
  /** Stock footage copied into the user's videos (it becomes one of their videos): its id */
  async function importStock(item: StockResult): Promise<string> {
    const res = await fetch('/api/stock/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: item.ref, url: item.url, title: item.title }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Could not add that video')
    videoLibraryRef.current = { ...videoLibraryRef.current, [data.video_id]: { url: data.url, title: data.title, stock: true } }
    setVideoLibrary(videoLibraryRef.current)
    return data.video_id as string
  }
  /**
   * B-roll Make my clips laid: show another of the stock videos it chose from (user, 2026-10-29). The
   * video is added to the user's videos (once), then the item plays it from its start; the item keeps
   * its time, slot and sound.
   */
  const [swappingBroll, setSwappingBroll] = useState<string | null>(null)
  async function swapBroll(segId: string, itemId: string, index: number) {
    const seg = useEditorStore.getState().segments.find(x => x.id === segId)
    const item = seg?.frame?.items?.find(x => x.id === itemId)
    const alt = item?.broll?.alts[index]
    if (!item?.broll || !alt || swappingBroll) return
    setSwappingBroll(itemId)
    try {
      const videoId = await importStock(alt)
      updateFrameItem(segId, itemId, { source_video_id: videoId, source_offset_ms: 0, broll: { ...item.broll, at: index } })
    } catch (e) {
      notifyLocked(e instanceof Error ? e.message : 'Could not add that video')
    } finally {
      setSwappingBroll(null)
    }
  }
  async function addStockBroll(item: StockResult, lengthMs: number, atMs?: number) {
    const at = Math.max(0, Math.min(atMs ?? currentTimeMs, clipLengthMs - 500))
    if (rangeBlocked(at, Math.min(MAX_CLIP_MS, at + lengthMs))) return
    const videoId = await importStock(item)
    const end = Math.min(MAX_CLIP_MS, at + lengthMs)
    const segId = placeBroll(videoId, at, end, undefined, freeTrack(at, end))
    pickShot(segId)
    seekToMs(at)
    seekAfterInsertRef.current = at
  }

  /**
   * Give a video on top a new time. It is a layer: only it moves, the sections under it stay as
   * they are. Dragged as a whole it keeps its length (and shows the same pictures); an end
   * dragged trims it.
   */
  function retimeBroll(id: string, startMs: number, endMs: number, settle = true) {
    if (blocked({ kind: 'broll', id })) return
    const shot = useEditorStore.getState().segments.find(x => x.id === id)
    if (!shot) return
    const len = shot.end_ms - shot.start_ms
    const moved = Math.abs((endMs - startMs) - len) < 1
    // Trimmed: never past the video's own first or last frame (`anchor`: where its first frame sits)
    const box = shot.crop_boxes[0]
    const anchor = shot.start_ms - (box?.source_offset_ms ?? 0)
    const full = videoLengths[box?.source_video_id ?? '']
    // (past the main video's end too: the timeline goes on for it; only its own video and the longest clip limit it)
    let start = moved ? Math.max(0, Math.min(MAX_CLIP_MS - len, startMs)) : Math.max(0, anchor, startMs)
    let end = moved ? start + len : Math.min(MAX_CLIP_MS, full ? anchor + full : Infinity, Math.max(start + 500, endMs))
    if (!moved) start = Math.min(start, end - 500)
    if (rangeBlocked(start, end, id)) return
    retimeShot(id, Math.round(start), Math.round(end), moved)
    // Moved or stretched onto something else on its track: a new track opens above it (once let go)
    if (settle) dropOnTrack({ kind: 'shot', id }, shot.track ?? 0)
  }
  const moveBroll = (id: string, delta: number) => { const shot = shots.find(x => x.id === id); if (shot) retimeBroll(id, shot.start_ms + delta, shot.end_ms + delta) }
  const resizeBroll = (id: string, delta: number) => { const shot = shots.find(x => x.id === id); if (shot) retimeBroll(id, shot.start_ms, shot.end_ms + delta) }

  /** Remove a video on top: the sections under it show again, as they were */
  const removeBroll = (id: string) => {
    if (blocked({ kind: 'broll', id })) return
    removeBrollShot(id)
    if (pickedSegId === id) setPickedSegId(null)
  }

  function handleInsertBrollAfterSeg(afterSegId: string) {
    const seg = segments.find(s => s.id === afterSegId)
    if (seg) setPickerAtMs(seg.end_ms)
  }

  function handleInsertImage(storagePath: string, previewUrl: string) {
    const atMs = pickerAtMs ?? currentTimeMs
    const fromPlus = pickerOnly === 'photo'
    setPickerAtMs(null); setPickerOnly(null)
    const seg = sections.find(s => atMs >= s.start_ms && atMs <= s.end_ms)
    // From the "+" menu a photo shows for 5 s (then drag its ends on the timeline)
    const endMs = fromPlus ? Math.min(clipLengthMs, atMs + 5000) : seg ? seg.end_ms : atMs + 5000
    const id = crypto.randomUUID()
    if (fromPlus) { setActiveOverlayId(id); seekToMs(atMs) }
    setOverlays(prev => [...prev, {
      id, clip_id: clip.id, type: 'image' as const,
      storage_path: storagePath, preview_url: previewUrl || undefined,
      source_video_id: null, source_offset_ms: 0,
      ...PHOTO_FIRST_BOX, start_ms: atMs, end_ms: endMs,
      z_index: prev.length + 1, created_at: new Date().toISOString(),
    }])
    fitPhotoBox(id, previewUrl)
  }

  // ── Keyboard shortcuts: Space play/pause · S split · [ ] trim · Delete · ←/→ one frame (Shift: 5 s) ──
  /**
   * What the Delete button / key removes: the thing picked last — a song, a photo or video on top,
   * a text, something in a frame, an added video, or a section — if it's still there; otherwise
   * whatever is still picked, most specific first. Each asks first (except music) and can be undone.
   */
  function deleteTarget(): { label: string; run: () => void } | null {
    if (groupLive.length > 1) return { label: `the ${groupLive.length} selected items`, run: deleteGroup }
    const music = pickedMusicId ? audioTracks.find(t => t.id === pickedMusicId) : undefined
    const overlay = activeOverlayId ? overlays.find(o => o.id === activeOverlayId) : undefined
    const text = activeTextOverlayId ? textOverlays.find(o => o.id === activeTextOverlayId) : undefined
    const fItem = frameSeg && activeFrameItemId ? activeFrameItemId : null
    const seg = pickedSegId ? segments.find(x => x.id === pickedSegId) : undefined
    const options = {
      music: music && { label: 'the selected music', run: () => deleteMusic(music.id) },
      overlay: overlay && { label: overlay.type === 'video' ? 'the selected video' : 'the selected photo', run: () => askDeleteOverlay(overlay.id) },
      text: text && { label: 'the selected text', run: () => askDeleteTextOverlay(text.id) },
      frameItem: fItem && frameSeg && {
        label: fItem.startsWith('main:') ? 'the main video in this slot' : 'the selected item in the frame',
        run: () => fItem.startsWith('main:') ? askRemoveMain(frameSeg.id, Number(fItem.slice(5))) : askRemoveFrameItem(frameSeg.id, fItem),
      },
      section: seg && (brollShots.some(b => b.id === seg.id)
        // (straight away, no question: Ctrl+Z brings it back)
        ? { label: 'the selected video', run: () => { if (!blocked({ kind: 'broll', id: seg.id })) removeBroll(seg.id) } }
        : { label: 'the selected section', run: () => askDeleteFormat(seg.id) }),
    }
    if (lastPick && options[lastPick]) return options[lastPick] || null
    return options.frameItem || options.music || options.overlay || options.text || options.section || null
  }

  /** What's picked together made one group (Ctrl+G): a click on any of it picks it all from now on */
  function groupPicked() {
    if (groupLive.length < 2) { notifyLocked('Pick two or more things on the timeline first (drag a box over them, or Ctrl + click)'); return }
    useGroupStore.setState(st => ({ groups: joinGroup(st.groups, groupLive) }))
    notifyLocked(`Grouped ${groupLive.length} items — they move together now (Alt + click picks one alone)`, 3200)
  }
  /** The groups of what's picked undone (Ctrl+Shift+G): each thing is on its own again */
  function ungroupPicked() {
    const ids = groupLive.length ? groupLive : selTarget?.id ? [selTarget.id] : []
    if (!ids.some(id => groupOf(groups, id))) return
    useGroupStore.setState(st => ({ groups: splitGroups(st.groups, ids) }))
    notifyLocked('Ungrouped', 1800)
  }
  /** Everything picked together taken away, at once (one undo step: one burst of changes) */
  function deleteGroup() {
    for (const id of groupLive) {
      if (brollShots.some(b => b.id === id)) removeBroll(id)
      else if (overlays.some(o => o.id === id)) askDeleteOverlay(id)
      else if (textOverlays.some(o => o.id === id)) askDeleteTextOverlay(id)
      else if (audioTracks.some(t => t.id === id)) deleteMusic(id)
    }
    // The main video's parts last, the latest first (each leaves empty space, as Delete on one does)
    const parts = segments.filter(s => groupLive.includes(s.id) && !brollShots.some(b => b.id === s.id)).sort((a, b) => b.start_ms - a.start_ms)
    for (const p of parts) askDeleteFormat(p.id)
    setGroupPick([])
  }

  const shortcutsRef = useRef({ togglePlay, seekToMs, currentTimeMs, clipDurationMs, trimSelectedTo, splitSelected, deleteSelected: () => {}, letGoGroup: (): boolean => false, groupPicked: () => {}, ungroupPicked: () => {} })
  shortcutsRef.current = {
    togglePlay, seekToMs, currentTimeMs, clipDurationMs, trimSelectedTo, splitSelected,
    // (Esc lets go of what's picked together; false: nothing was)
    letGoGroup: () => { if (!groupLive.length) return false; setGroupPick([]); return true },
    groupPicked, ungroupPicked,
    // Delete acts on what's selected most specifically: a view change (◆), a text overlay, then an
    // image, then the format (an overlay only counts while it's on screen at the playhead, so a
    // stale selection can't be deleted by surprise)
    deleteSelected: () => {
      if (selectedView && viewMarkers.some(v => v.t_ms === selectedView.t) && viewMarkers.length > 1) {
        removeViewChange(selectedView.boxId, selectedView.t)
        setSelectedView(null)
        return
      }
      // What was picked (the same as the Delete button)
      const target = deleteTarget()
      if (target) { target.run(); return }
      const onScreen = (o: { start_ms: number; end_ms: number }) => currentTimeMs >= o.start_ms && currentTimeMs < o.end_ms
      const text = textOverlays.find(o => o.id === activeTextOverlayId && onScreen(o))
      if (text) { askDeleteTextOverlay(text.id); return }
      const image = overlays.find(o => o.id === activeOverlayId && onScreen(o))
      if (image) { askDeleteOverlay(image.id); return }
      if (frameSeg && activeFrameItemId) {
        if (activeFrameItemId.startsWith('main:')) askRemoveMain(frameSeg.id, Number(activeFrameItemId.slice(5)))
        else askRemoveFrameItem(frameSeg.id, activeFrameItemId)
        return
      }
      if (activeSegment) askDeleteFormat(activeSegment.id)
    },
  }
  // Holding ← / → skips through the video, faster the longer it's held (a tap still moves a frame)
  const [skipRate, setSkipRate] = useState<number | null>(null)
  useEffect(() => {
    // ── Hold to skip ─────────────────────────────────────────────────────────────
    // A press moves one frame (Shift: 5 s). Held, the key's auto-repeat starts a skip run on the
    // screen's own clock (smooth whatever the keyboard's repeat rate): 2× real time, doubling every
    // second held up to 16× (Shift: from 4×). Playing when it began: it pauses meanwhile and plays
    // on from where it stopped once the key is let go.
    let hold: { key: string; dir: number; shift: boolean; start: number; pos: number; last: number; raf: number; resume: boolean; rate: number } | null = null
    const rateAt = (heldSec: number, shift: boolean) => Math.min(16, (shift ? 4 : 2) * Math.pow(2, Math.max(0, Math.floor(heldSec))))
    function skipFrame(now: number) {
      const h = hold
      if (!h) return
      const s = shortcutsRef.current
      const rate = rateAt((now - h.start) / 1000, h.shift)
      if (rate !== h.rate) { h.rate = rate; setSkipRate(h.dir * rate) }
      h.pos = Math.max(0, Math.min(s.clipDurationMs - 1, h.pos + h.dir * rate * Math.min(now - h.last, 50)))
      h.last = now
      s.seekToMs(h.pos)
      if ((h.dir < 0 && h.pos <= 0) || (h.dir > 0 && h.pos >= s.clipDurationMs - 1)) return   // at an end: wait there
      h.raf = requestAnimationFrame(skipFrame)
    }
    function endSkip() {
      const h = hold
      hold = null
      if (!h) return
      cancelAnimationFrame(h.raf)
      setSkipRate(null)
      if (h.resume && !usePlayerStore.getState().playing) shortcutsRef.current.togglePlay()
    }
    function onKeyUp(e: KeyboardEvent) { if (hold && e.key === hold.key) endSkip() }
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      // Ctrl/⌘+Z undo · Ctrl/⌘+Shift+Z or Ctrl+Y redo. While typing in a text box the browser's own
      // text undo applies (sliders, colour pickers and the like don't count)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
        if (isTextEntry(target)) return
        e.preventDefault()
        if (e.key.toLowerCase() === 'y' || e.shiftKey) redo(); else undo()
        return
      }
      // Ctrl/⌘+G groups what's picked on the timeline · Ctrl/⌘+Shift+G ungroups it (as in Premiere; Resolve's Link Clips)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'g' || e.key === 'G')) {
        if (isTextEntry(target)) return
        e.preventDefault()
        if (e.shiftKey) shortcutsRef.current.ungroupPicked(); else shortcutsRef.current.groupPicked()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const s = shortcutsRef.current
      if (e.key === 'Escape') {
        if (s.letGoGroup()) e.preventDefault()
      } else if (e.code === 'Space') {
        // A focused button already handles Space itself
        if (target?.closest('button, a')) return
        e.preventDefault(); s.togglePlay()
      } else if (e.key === '[') {
        e.preventDefault(); s.trimSelectedTo('start')
      } else if (e.key === ']') {
        e.preventDefault(); s.trimSelectedTo('end')
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault(); s.splitSelected()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (target?.closest('button, a, [role="button"]') && e.key === 'Backspace') return
        e.preventDefault(); s.deleteSelected()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const dir = e.key === 'ArrowLeft' ? -1 : 1
        if (e.repeat) {
          // Held: skip (the run starts on the first repeat; later repeats just keep it going)
          if (!hold || hold.key !== e.key) {
            endSkip()
            const now = performance.now()
            const playing = usePlayerStore.getState().playing
            if (playing) s.togglePlay()
            hold = { key: e.key, dir, shift: e.shiftKey, start: now, pos: usePlayerStore.getState().currentTimeMs, last: now, raf: 0, resume: playing, rate: 0 }
            hold.raf = requestAnimationFrame(skipFrame)
          }
          return
        }
        // One frame per press (Shift: 5 s)
        const step = (e.shiftKey ? 5000 : FRAME_MS) * dir
        s.seekToMs(Math.max(0, Math.min(s.clipDurationMs, s.currentTimeMs + step)))
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', endSkip)
    // Pressing anywhere outside a text box ends typing in it. The timeline's handles stop the
    // browser from moving focus, so without this a text box stays focused through a drag and
    // takes the next Ctrl+Z (or Delete) for itself.
    function onPointerDown(e: PointerEvent) {
      const el = document.activeElement as HTMLElement | null
      if (!isTextEntry(el) || el!.contains(e.target as Node) || isTextEntry(e.target as HTMLElement)) return
      el!.blur()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      endSkip()
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', endSkip)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────────

  const rendering = clipStatus === 'rendering' || exporting
  const hasOutput = !!outputUrl && clipStatus === 'done'
  // ── Captions on demand (Post and Cleanup work from the clip's words) ──────────
  // A clip without captions gets them made (as the Captions tool does, not shown on the video);
  // this waits for them. Rejects with what to tell the user when they can't be made.
  const captionsWaitRef = useRef<{ resolve: () => void; reject: (e: Error) => void; started: boolean } | null>(null)
  function ensureCaptions(): Promise<void> {
    if (!needsCaptions()) return Promise.resolve()
    if (isFreePlan) return Promise.reject(new Error('Captions aren\u2019t part of the Free plan, so there are no words to work from.'))
    return new Promise((resolve, reject) => {
      captionsWaitRef.current = { resolve, reject, started: transcribing || retranscribing }
      if (!transcribing && !retranscribing) { setRetranscribeError(null); makeCaptions() }
    })
  }
  useEffect(() => {
    const w = captionsWaitRef.current
    if (!w) return
    if (transcribing || retranscribing) { w.started = true; return }
    if (!w.started) return
    captionsWaitRef.current = null
    if (retranscribeError) w.reject(new Error(retranscribeError))
    else if (!sourceWords.some(x => x.start_ms >= rawClip.start_ms && x.start_ms < rawClip.end_ms)) w.reject(new Error('No speech was found in this clip.'))
    else w.resolve()
  }, [transcribing, retranscribing, retranscribeError, sourceWords]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup (user, 2026-10-18): silences, filler words and repeated words as cards ──
  // Detect makes the captions if needed and has the worker find the silences; each card plays on
  // its own, Delete cuts it out (a removed part, as the timeline's delete), a deleted card stays
  // greyed with Restore. Cards are kept in source time (modules/editor/cleanup.ts).
  type SilencesData = { status: string; error: string | null; ranges: [number, number][] }
  const [silences, setSilences] = useState<SilencesData | null>(null)
  const [cleanupDetected, setCleanupDetected] = useState(false)
  const [cleanupWorking, setCleanupWorking] = useState<string | null>(null)
  const [cleanupError, setCleanupError] = useState<string | null>(null)
  const silencesUrl = `/api/clips/${clip.id}/silences`
  // A list found before shows when the tool opens
  useEffect(() => {
    if (tool !== 'cleanup' || silences) return
    fetch(silencesUrl).then(r => (r.ok ? r.json() : null)).then((d: SilencesData | null) => {
      if (!d) return
      setSilences(d)
      if (d.status === 'done') setCleanupDetected(true)
    }).catch(() => {})
  }, [tool]) // eslint-disable-line react-hooks/exhaustive-deps
  /** The worker looks for the silences of the clip as it is now; resolves with what it found */
  async function scanSilencesNow(): Promise<SilencesData> {
    const res = await fetch(silencesUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start_ms: rawClip.start_ms, end_ms: rawClip.end_ms }) })
    let d = await res.json().catch(() => ({})) as SilencesData
    if (!res.ok) throw new Error((d as { error?: string }).error ?? 'Looking for silences failed. Try again.')
    const deadline = Date.now() + 3 * 60_000
    while ((d.status === 'queued' || d.status === 'running') && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000))
      d = await fetch(silencesUrl).then(r => r.json())
    }
    if (d.status === 'unavailable') throw new Error('Finding silences needs the latest worker. Try again after it restarts.')
    if (d.status !== 'done') throw new Error(d.error ?? 'Looking for silences is taking too long. Try again in a minute.')
    return d
  }
  // The old "remove pauses and filler words at export" switch (AI edit clips have it on): the first
  // Detect deletes what it found instead, as cards — the export stays as clean, and it shows
  const autoDeleteRef = useRef(false)
  async function detectCleanup() {
    setCleanupError(null)
    const errors: string[] = []
    const silenceScan = scanSilencesNow().catch(e => { errors.push(e instanceof Error ? e.message : String(e)); return null })
    try {
      if (needsCaptions()) setCleanupWorking('Getting the clip\u2019s captions to find filler and repeated words \u2014 they won\u2019t show on the video\u2026')
      await ensureCaptions()
    } catch (e) { errors.push(e instanceof Error ? e.message : String(e)) }
    setCleanupWorking('Looking for silences in the clip\u2019s sound\u2026')
    const found = await silenceScan
    if (found) setSilences(found)
    setCleanupWorking(null)
    setCleanupDetected(true)
    setCleanupError(errors.length ? errors.join(' ') : null)
    if (removeFillersRef.current && !piecesOn) { autoDeleteRef.current = true; setRemoveFillers(false) }
  }
  const cleanupRows = useMemo<CleanupRow[]>(() => {
    if (!cleanupDetected) return []
    return cleanupCards(sourceWords, silences?.status === 'done' ? silences.ranges : null, rawClip.start_ms, rawClip.end_ms)
      .map(c => ({ ...c, deleted: isDeleted(c, trims), at: trim.toTimeline(c.a) }))
  }, [cleanupDetected, sourceWords, silences, rawClip.start_ms, rawClip.end_ms, trims, trim])
  useEffect(() => {
    if (!autoDeleteRef.current || !cleanupRows.length) return
    autoDeleteRef.current = false
    deleteCleanup(cleanupRows)
  }, [cleanupRows]) // eslint-disable-line react-hooks/exhaustive-deps
  /** Cut cards out of the clip — the last first, so an earlier cut doesn't move the later ones. One undo step. */
  function deleteCleanup(rows: CleanupRow[]) {
    for (const r of rows.filter(x => !x.deleted).sort((x, y) => y.a - x.a)) {
      const map = trimMap(useEditorStore.getState().trims, rawClip.start_ms, rawClip.end_ms)
      const a = map.toTimeline(r.a), b = map.toTimeline(r.b)
      if (b - a >= 20) removePart(a, b)
    }
  }
  /** A deleted card put back: its stretch of the video plays again where it was (trimState rippleStretch) */
  function restoreCleanup(r: CleanupRow) {
    pause()
    const editor = useEditorStore.getState(), media = useMediaStore.getState()
    const map = trimMap(editor.trims, rawClip.start_ms, rawClip.end_ms)
    const nextTrims = cleanTrims(withoutRanges(editor.trims, [[r.a, r.b]]), rawClip.start_ms, rawClip.end_ms)
    const d = trimMap(nextTrims, rawClip.start_ms, rawClip.end_ms).lengthMs - map.lengthMs
    if (d <= 0) return
    if (map.lengthMs + d > MAX_CLIP_MS) { notifyLocked('The clip is as long as a clip can be (5 minutes)'); return }
    const at = map.toTimeline(r.a)
    const state: TimedState = {
      segments: editor.segments, keyframes: editor.keyframes,
      overlays: media.overlays, textOverlays: media.textOverlays, audioTracks: media.audioTracks, transitions: media.transitions,
    }
    const next = rippleStretch(state, at, d, s => isShot(s, mainVideoId) || s.lane === 'broll')
    skipCanvasTransitionRef.current = true
    seekAfterTrimRef.current = at
    editor.applyTrim(next.segments, next.keyframes, nextTrims)
    useMediaStore.setState({ overlays: next.overlays, textOverlays: next.textOverlays, audioTracks: next.audioTracks, transitions: next.transitions })
  }
  /** A card played on its own: from a little before it to a little after (a deleted one: across where it was cut) */
  const cleanupPlayStopRef = useRef<(() => void) | null>(null)
  function playCleanup(r: CleanupRow) {
    cleanupPlayStopRef.current?.()
    const len = r.deleted ? 0 : Math.max(0, trim.toTimeline(r.b) - r.at)
    const from = Math.max(0, r.at - (r.deleted ? 1500 : 700))
    const to = Math.min(clipLengthMs, r.at + len + (r.deleted ? 1500 : 500))
    seekToMs(from)
    if (!usePlayerStore.getState().playing) togglePlay()
    const off = liveTime.subscribe(() => { if (liveTime.get() >= to) stop() })
    const guard = setTimeout(() => stop(false), to - from + 4000)
    function stop(pauseIt = true) {
      off(); clearTimeout(guard)
      if (cleanupPlayStopRef.current === stop) cleanupPlayStopRef.current = null
      if (pauseIt && usePlayerStore.getState().playing) pause()
    }
    cleanupPlayStopRef.current = stop
  }

  function setRemoveFillers(on: boolean) {
    if (on && hasInserts) { notifyLocked('Remove pauses can\u2019t be used with a video put in between (yet)'); return }
    setRemoveFillersState(on)
    removeFillersRef.current = on
    unsavedRef.current = true
    editVersionRef.current++
    latestHandleSaveRef.current()
  }
  const activeTool = TOOLS.find(t => t.id === tool)!

  /** A section picked: its card in the Format panel shows its contents (opened on a double tap on the timeline) */
  // A click anywhere outside the timeline's parts lets go of the picked part: on the page's empty
  // space — the preview's background, the panels', the header. What can be clicked or dragged keeps
  // it (buttons and fields act on it; a crop box, handles and the like show their own pointer), and
  // the timeline handles its own clicks
  // (everything that can be picked: a part, a text, a photo or video on top, a song, a frame item)
  const anyPickedRef = useRef(false)
  anyPickedRef.current = !!(pickedSegId || activeTextOverlayId || activeOverlayId || pickedMusicId || activeFrameItemId)
  const clearPicksRef = useRef<() => void>(() => {})
  clearPicksRef.current = () => {
    pickSection(null, false)
    setActiveTextOverlayId(null)
    setActiveOverlayId(null)
    setPickedMusicId(null)
    setActiveFrameItemId(null)
  }
  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (e.button !== 0 || !anyPickedRef.current) return
      const el = e.target as Element | null
      if (!el || !el.closest) return
      if (el.closest('.tl2, button, a, input, select, textarea, label, [role="menu"], [role="menuitem"], [role="dialog"], [role="alertdialog"], [role="slider"], [role="radio"], [role="separator"], [contenteditable="true"]')) return
      const cursor = getComputedStyle(el).cursor
      if (cursor !== 'auto' && cursor !== 'default') return
      clearPicksRef.current()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [])
  function pickSection(id: string | null, _open = true) {
    setPickedSegId(id)
    if (!id) return
    setActiveSegmentId(id)
    setOpenSections(prev => new Set(prev).add(id))
    // Its group must be open for the card to be there to scroll to
    const seg = segments.find(sg => sg.id === id)
    if (seg) setOpenGroups(prev => { const g = formatLayoutOf(seg.layout); return prev.has(g) ? prev : new Set(prev).add(g) })
  }
  useEffect(() => {
    if (tool !== 'format' || !pickedSegId) return
    sectionListRef.current?.querySelector(`[data-section-id="${pickedSegId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [tool, pickedSegId])

  // ── Caption styles line by line (as in CapCut): the Captions row shows each caption line as a
  //    block; the lines selected there take the style picked in the Captions panel, nothing
  //    selected: every caption. Kept as parts (captions/parts.ts), each from a pause between words ──
  const captionParts = useCaptionStore(st => st.captionParts)
  /** Every caption part as it plays (the first: the clip's own style); none while there is one style throughout */
  const playedCaptionParts = useMemo(() => (captionParts.length ? playedParts(captionStyle, captionParts, clipLengthMs) : undefined), [captionParts, captionStyle, clipLengthMs])
  const captionTemplateName = (id: string) => { const t = CAPTION_TEMPLATES[id]; return t ? `${t.group} · ${t.label}` : undefined }
  const captionLookName = (st: Partial<CaptionStyle>) => st.template ? captionTemplateName(st.template) ?? 'Style'
    : (st.animation ?? 'karaoke').replace(/^./, c => c.toUpperCase())
  /** A style's colour on the Captions row: its text colour (a caption style's own) */
  const captionLookColor = (st: Partial<CaptionStyle>) => (st.template ? CAPTION_TEMPLATES[st.template]?.color : undefined) ?? st.color ?? '#FFFFFF'
  /** The words in clip time (where a style starts and ends goes into the pauses between them) */
  const captionWordsRel = useMemo(() => displayWords.map(w => ({ word: w.word, start_ms: w.start_ms - clip.start_ms, end_ms: w.end_ms - clip.start_ms })), [displayWords, clip.start_ms])
  /** The caption lines as the preview shows them (each part's words, in its own words per line), in clip time */
  const captionLines = useMemo(() => {
    const parts = playedCaptionParts ?? playedParts(captionStyle, [], clipLengthMs)
    return parts.flatMap((p, i) => {
      const a = clip.start_ms + p.start_ms, b = i + 1 < parts.length ? clip.start_ms + p.end_ms : Infinity
      const own = displayWords.filter(w => (i === 0 || w.start_ms >= a) && w.start_ms < b)
      return buildCaptionChunks(own, captionWordsPerLine(p.style)).filter(ch => ch.length).map(ch => ({
        start: ch[0].start_ms - clip.start_ms, end: ch[ch.length - 1].end_ms - clip.start_ms,
        text: ch.map(w => w.word).join(' '), color: captionLookColor(p.style), name: captionLookName(p.style),
      }))
    })
  }, [playedCaptionParts, captionStyle, clipLengthMs, displayWords, clip.start_ms]) // eslint-disable-line react-hooks/exhaustive-deps
  /** The caption lines selected on the Captions row, as stretches of the clip (clip ms); none: every caption */
  const [captionSel, setCaptionSel] = useState<[number, number][]>([])
  const lineSelected = (l: { start: number; end: number }) => captionSel.some(([a, b]) => (l.start + l.end) / 2 >= a && (l.start + l.end) / 2 < b)
  const selectedLines = captionLines.filter(lineSelected)
  /** A caption line clicked on the Captions row: it alone (again: none), or added / taken off (Shift / Ctrl) */
  function clickCaptionLine(i: number, add: boolean) {
    const l = captionLines[i]
    if (!l) return
    clearPicksRef.current()
    const range: [number, number] = [l.start, l.end]
    const on = lineSelected(l)
    if (add) setCaptionSel(sel => (on ? sel.filter(([a, b]) => !((l.start + l.end) / 2 >= a && (l.start + l.end) / 2 < b)) : [...sel, range]))
    else setCaptionSel(on && selectedLines.length === 1 ? [] : [range])
    openSettings('captions')
  }
  /** A stretch dragged across on the Captions row: the lines in it (Shift / Ctrl: added) */
  function selectCaptionRange(r: [number, number], add: boolean) {
    clearPicksRef.current()
    setCaptionSel(sel => (add ? [...sel, r] : [r]))
    openSettings('captions')
  }
  /**
   * The Captions row is on the timeline only while the Captions panel is open (as a tool's own
   * row): it never sits among the media rows otherwise. Closed: no caption lines stay selected.
   */
  const captionsPanelOpen = optionsOpen && tool === 'captions'
  useEffect(() => { if (!captionsPanelOpen) setCaptionSel(s => (s.length ? [] : s)) }, [captionsPanelOpen])
  // Anything else picked: the caption lines aren't any more
  useEffect(() => {
    if (lastPick || pickedSegId || activeOverlayId || activeTextOverlayId || pickedMusicId) setCaptionSel(s => (s.length ? [] : s))
  }, [lastPick, pickedSegId, activeOverlayId, activeTextOverlayId, pickedMusicId])
  /** The style shown in the Captions panel: the first selected line's (nothing selected: the clip's) */
  const panelCaptionStyle = playedCaptionParts && selectedLines.length
    ? playedPartAt(playedCaptionParts, selectedLines[0].start + 1).style
    : captionStyle
  /** A change in the Captions panel: a look change goes to the selected lines (none selected: every caption); anything else is the whole clip's */
  function changeCaptionStyle(updates: Partial<CaptionStyle>) {
    const st = useCaptionStore.getState()
    const look = lookOf(updates)
    const rest = Object.fromEntries(Object.entries(updates).filter(([k]) => !(LOOK_KEYS as readonly string[]).includes(k))) as Partial<CaptionStyle>
    if (!isLookChange(updates) || (!selectedLines.length && !st.captionParts.length)) { updateCaptionStyle(updates); return }
    if (Object.keys(rest).length) updateCaptionStyle(rest)
    // The selected lines in runs of neighbours (each run one stretch, from the pause before its
    // first line to the pause after its last); none selected: the whole clip
    const runs: [number, number][] = []
    if (!selectedLines.length) runs.push([0, clipLengthMs])
    else {
      captionLines.forEach((l, i) => {
        if (!lineSelected(l)) return
        const prevOn = i > 0 && lineSelected(captionLines[i - 1])
        if (prevOn && runs.length) runs[runs.length - 1][1] = l.end - 1
        else runs.push([l.start + 1, l.end - 1])
      })
    }
    let base = st.captionStyle, parts = st.captionParts
    for (const [a, b] of runs) {
      const next = applyLook(base, parts, a, b, look, clipLengthMs, captionWordsRel)
      base = { ...base, ...next.baseLook }
      parts = next.parts
    }
    updateCaptionStyle(lookOf(base))
    st.setCaptionParts(parts)
  }
  /** The lines from the playhead to the end (a quick selection) */
  function selectCaptionsFromHere() {
    const t = liveTime.get()
    const from = captionLines.find(l => l.end > t)
    setCaptionSel(from ? [[from.start, clipLengthMs + 1]] : [])
  }
  /** One caption style for the whole clip again: the first part's */
  function oneCaptionStyle() {
    useCaptionStore.getState().setCaptionParts([])
  }

  // ── Hide / mute / lock ──────────────────────────────────────────────────────
  /** The hide / mute / lock state of a section, photo, text or music track */
  function ctlState(t: CtlTarget): { hidden?: boolean; muted?: boolean; locked?: boolean } | undefined {
    if (t.kind === 'section') {
      // The main video's sound here: off when this section is muted, or the whole clip's sound is
      // (the same on the timeline, in the section list, by Trim and Delete, and in the Music panel)
      const seg = segments.find(x => x.id === t.id)
      // A video put in between plays its own sound (the main video waits meanwhile): its mute is
      // that video's own (the box's, as the preview and the export read it)
      if (seg && isInsert(seg, mainVideoId)) return { hidden: seg.hidden, locked: seg.locked, muted: seg.crop_boxes[0]?.muted !== false }
      return seg && { hidden: seg.hidden, locked: seg.locked, muted: originalMuted || !!seg.muted }
    }
    if (t.kind === 'broll') {
      const seg = segments.find(x => x.id === t.id)
      // Shown unless hidden; its own sound off unless switched on (then it plays instead of the main video's)
      return seg && { hidden: seg.crop_boxes[0]?.hidden, locked: seg.locked, muted: seg.crop_boxes[0]?.muted !== false }
    }
    if (t.kind === 'frameItem') {
      const f = frameOf(segments.find(x => x.id === t.segId) ?? ({} as SegmentLocal))
      // The main video in a slot (main:<slot>): its own hide, sound and lock in the frame's settings
      const slot = mainSlotOf(t.id)
      if (slot !== null) return { hidden: !!f.main_hidden?.[String(slot)], muted: mainSlotSound(f, slot).muted, locked: !!f.main_locked?.[String(slot)] }
      const it = f.items?.find(x => x.id === t.id)
      return it && { hidden: it.hidden, muted: it.muted, locked: it.locked }
    }
    if (t.kind === 'photo') return overlays.find(x => x.id === t.id)
    if (t.kind === 'text') return textOverlays.find(x => x.id === t.id)
    return audioTracks.find(x => x.id === t.id)
  }
  /** The locked section an item's time falls in, if any: everything inside a locked section is locked too */
  function lockedSectionOver(startMs: number, endMs: number, exceptId?: string) {
    return sections.find(x => x.locked && x.id !== exceptId && x.start_ms < endMs && x.end_ms > startMs) ?? null
  }
  /** A thing's own time (for the section lock) */
  function spanOf(t: CtlTarget): [number, number] | null {
    if (t.kind === 'broll') { const o = shots.find(x => x.id === t.id); return o ? [o.start_ms, o.end_ms] : null }
    if (t.kind === 'photo') { const o = overlays.find(x => x.id === t.id); return o ? [o.start_ms, o.end_ms] : null }
    if (t.kind === 'text') { const o = textOverlays.find(x => x.id === t.id); return o ? [o.start_ms, o.end_ms] : null }
    if (t.kind === 'music') { const o = audioTracks.find(x => x.id === t.id); return o ? [o.start_ms, Math.min(clipLengthMs, musicEnd(o))] : null }
    return null
  }
  /** Locked itself, or inside a locked section (a frame item: its frame's section) */
  function isLocked(t: CtlTarget): boolean {
    if (ctlState(t)?.locked) return true
    if (t.kind === 'frameItem') return !!segments.find(x => x.id === t.segId)?.locked
    const span = spanOf(t)
    return !!span && !!lockedSectionOver(span[0], span[1])
  }
  /** Lock check for an edit: true (and a short note why) when the thing can't be changed */
  function blocked(t: CtlTarget): boolean {
    if (!isLocked(t)) return false
    const own = !!ctlState(t)?.locked
    notifyLocked(own ? 'This is locked — unlock it to change it' : 'Its section is locked — unlock the section to change it')
    return true
  }
  /** A section by id (frames, layouts, views): blocked when it's locked */
  function sectionBlocked(segId: string | null | undefined) { return !!segId && blocked({ kind: 'section', id: segId }) }
  /** Something new put over this time (a video on top): blocked by a locked section there */
  function rangeBlocked(startMs: number, endMs: number, exceptId?: string) {
    const sec = lockedSectionOver(startMs, endMs, exceptId)
    if (sec) notifyLocked(`The section ${msToLabel(sec.start_ms)}–${msToLabel(sec.end_ms)} is locked — unlock it first`)
    return !!sec
  }
  /** Which controls a thing has: the main video mutes and locks, an added video hides, mutes and locks, photos and text hide and lock, music mutes and locks */
  function canCtl(t: CtlTarget): CtlKey[] {
    if (t.kind === 'section') {
      const s = segments.find(x => x.id === t.id)
      // (an empty space left by a deleted part has nothing to show, sound or lock)
      if (s && isGapPart(s, mainVideoId)) return []
      return isFrameLayout(s?.layout ?? 'vertical') ? ['muted', 'locked'] : ['hidden', 'muted', 'locked']
    }
    if (t.kind === 'broll') return ['hidden', 'muted', 'locked']
    if (t.kind === 'frameItem') {
      if (mainSlotOf(t.id) !== null) return ['hidden', 'muted', 'locked']
      const it = frameOf(segments.find(x => x.id === t.segId) ?? ({} as SegmentLocal)).items?.find(x => x.id === t.id)
      return it?.kind === 'video' ? ['hidden', 'muted', 'locked'] : ['hidden', 'locked']
    }
    if (t.kind === 'photo') return overlays.find(o => o.id === t.id)?.type === 'video' ? ['hidden', 'muted', 'locked'] : ['hidden', 'locked']
    return t.kind === 'music' ? ['muted', 'locked'] : ['hidden', 'locked']
  }
  function toggleCtl(t: CtlTarget, k: CtlKey) {
    const patch = { [k]: !ctlState(t)?.[k] } as Partial<Record<CtlKey, boolean>>
    const insertSeg = t.kind === 'section' && k === 'muted' ? segments.find(x => x.id === t.id && isInsert(x, mainVideoId)) : undefined
    if (insertSeg) {
      // A video put in between: switch its own sound (the main video's mute doesn't reach it)
      updateSegment(insertSeg.id, { crop_boxes: insertSeg.crop_boxes.map((b, i) => i === 0 ? { ...b, muted: !!patch.muted } : b) })
    }
    else if (t.kind === 'section' && k === 'muted' && originalMuted) {
      // The whole clip's sound was off: this section's comes on, the others stay silent
      setOriginalMuted(false)
      for (const s of sections) if (s.id !== t.id && !s.muted) updateSegment(s.id, { muted: true })
      updateSegment(t.id, { muted: false })
    }
    else if (t.kind === 'section') updateSegment(t.id, patch)
    else if (t.kind === 'broll') {
      const seg = segments.find(x => x.id === t.id)
      if (!seg) return
      if (k === 'locked') updateSegment(seg.id, patch)
      else updateSegment(seg.id, { crop_boxes: seg.crop_boxes.map((b, i) => i === 0 ? { ...b, [k]: !!patch[k] } : b) })
    }
    else if (t.kind === 'frameItem') {
      const slot = mainSlotOf(t.id), sg = segments.find(x => x.id === t.segId)
      if (slot !== null && sg) {
        const f = frameOf(sg), key = String(slot), on = !!patch[k]
        if (k === 'muted') updateFrame(sg.id, { main_mutes: { ...f.main_mutes, [key]: on } })
        else if (k === 'hidden') updateFrame(sg.id, { main_hidden: { ...f.main_hidden, [key]: on } })
        else updateFrame(sg.id, { main_locked: { ...f.main_locked, [key]: on } })
      } else if (t.segId) updateFrameItem(t.segId, t.id, patch)
    }
    else if (t.kind === 'photo') updateOverlay(t.id, patch)
    else if (t.kind === 'text') updateTextOverlay(t.id, patch)
    else setAudioTracks(prev => prev.map(x => x.id === t.id ? { ...x, ...patch } : x))
  }

  /** The slot of the main video's id in a frame (main:<slot>), or null for anything else */
  function mainSlotOf(id: string): number | null {
    const m = /^main:(\d+)$/.exec(id)
    return m ? Number(m[1]) : null
  }

  // ── Lock / view / sound for a whole timeline lane: on = on for everything in it ──
  /**
   * A frame lane's kind → its frame and lane. The timeline names the frame (frame:<lane>@<frame id>):
   * its heads follow the live playhead — while playing or dragging the editor's own time waits — so
   * they act on the frame actually under the playhead. Without one: the frame at the editor's playhead.
   */
  function frameLaneOf(kind: string): { lane: FrameLane; seg: SegmentLocal } | null {
    const m = /^frame:([^@]+)(?:@(.+))?$/.exec(kind)
    if (!m) return null
    const seg = m[2] ? sections.find(s => s.id === m[2]) : frameSeg
    if (!seg || !isFrameLayout(seg.layout)) return null
    return { lane: /^\d+$/.test(m[1]) ? Number(m[1]) : (m[1] as FrameLane), seg }
  }
  /**
   * What a frame lane's lock / eye / sound act on (the frame at the playhead): the main video in its
   * slot, when it shows there, and everything put on the lane. Sound only where the lane plays some:
   * a slot showing the main video, or for videos (not a photo slot, nor text) — user, 2026-10-17
   */
  function frameLaneCan(kind: string): LaneCtlKey[] | undefined {
    const fl = frameLaneOf(kind)
    if (!fl) return undefined
    const { lane, seg } = fl
    // (a lane of another kind of frame, not this one: no buttons)
    if (!frameLanes(seg.layout as FrameLayout).some(r => r.lane === lane)) return undefined
    if (isTextLane(lane)) return ['locked', 'hidden']
    const f = frameOf(seg)
    const sound = (f.main_slots ?? [0]).includes(lane as number)
      || (f.items ?? []).some(it => it.lane === lane && it.kind === 'video')
      || FRAME_TEMPLATES[seg.layout as FrameLayout].defaults[lane as number] === 'video'
    return sound ? ['locked', 'hidden', 'muted'] : ['locked', 'hidden']
  }
  /** What a lane holds, as Hide / Mute / Lock targets */
  function laneTargets(kind: string): CtlTarget[] {
    const fl = frameLaneOf(kind)
    if (fl) {
      const f = frameOf(fl.seg), segId = fl.seg.id, lane = fl.lane
      const main: CtlTarget[] = typeof lane === 'number' && (f.main_slots ?? [0]).includes(lane) ? [{ kind: 'frameItem', id: `main:${lane}`, segId }] : []
      return [...main, ...(f.items ?? []).filter(it => it.lane === lane).map((it): CtlTarget => ({ kind: 'frameItem', id: it.id, segId }))]
    }
    const vt = /^track-(\d+)$/.exec(kind)
    if (vt) return visualItems().filter(i => (i.track ?? 0) === Number(vt[1]))
      .map((i): CtlTarget => (i.ref.kind === 'shot' ? { kind: 'broll', id: i.id } : { kind: i.ref.kind as 'photo' | 'text', id: i.id }))
    const at = /^audio-(\d+)$/.exec(kind)
    if (at) return audioItems().filter(i => (i.track ?? 0) === Number(at[1])).map((i): CtlTarget => ({ kind: 'music', id: i.id }))
    if (kind === 'main') return sections.map(sg => ({ kind: 'section', id: sg.id }))
    if (kind === 'broll') return stockVideos.map(v => ({ kind: 'broll', id: v.id }))
    if (kind === 'video') return ownVideos.map(v => ({ kind: 'broll', id: v.id }))
    if (kind === 'photo') return overlays.filter(o => o.type === 'image').map(o => ({ kind: 'photo', id: o.id }))
    if (kind === 'music') return audioTracks.filter(t => !isMainAudio(t)).map(t => ({ kind: 'music', id: t.id }))
    if (kind === 'text') return textOverlays.map(o => ({ kind: 'text', id: o.id }))
    return []
  }
  const LANE_CAN: Record<string, LaneCtlKey[]> = {
    main: ['locked', 'hidden', 'muted'], broll: ['locked', 'hidden', 'muted'], video: ['locked', 'hidden', 'muted'],
    photo: ['locked', 'hidden'], music: ['locked', 'muted'], text: ['locked', 'hidden'],
  }
  /** The parts of the main row the main row's buttons act on (not the empty space a part left, nor the room after the main video) */
  const mainRowTargets = (): CtlTarget[] => sections.filter(s => !isGapPart(s, mainVideoId) && !isTail(s)).map(s => ({ kind: 'section', id: s.id }))
  /** What's picked on the timeline now (several picked together, or the one picked), as ctlKey()s */
  function pickedCtlKeys(): Set<string> {
    if (groupLive.length) return new Set(groupLive)
    const out = new Set<string>()
    if (selTarget) out.add(ctlKey(selTarget))
    // (the main video in a frame's slot isn't one of selTarget's)
    if (lastPick === 'frameItem' && frameSeg && activeFrameItemId?.startsWith('main:')) out.add(`${frameSeg.id}|${activeFrameItemId}`)
    return out
  }
  /**
   * A row's eye / sound / lock act on what's picked on that row (one part, or the ones picked
   * together) and only with nothing picked there on the whole row (user, 2026-10-30: the eye of a
   * split part hid every part on its row)
   */
  function rowPick(all: CtlTarget[]): { targets: CtlTarget[]; picked: boolean } {
    const keys = pickedCtlKeys()
    const mine = keys.size ? all.filter(t => keys.has(ctlKey(t))) : []
    return mine.length ? { targets: mine, picked: true } : { targets: all, picked: false }
  }
  /** The buttons' note while they act on what's picked (their labels say so) */
  const pickNote = (n: number) => (n === 1 ? 'only the picked one' : `only the ${n} picked`)
  /**
   * The main row, as the other rows (Resolve's track header): its view, sound and lock for all of
   * it — or for its parts picked. Its sound is the whole clip's (what "Mute clip audio" was); a
   * frame has no view switch of its own (its slots are the frame).
   */
  function mainCtl(): LaneCtl {
    const all = mainRowTargets()
    const { targets, picked } = rowPick(all)
    const viewable = targets.filter(t => canCtl(t).includes('hidden'))
    const soundy = targets.filter(t => canCtl(t).includes('muted'))
    return {
      can: viewable.length ? ['locked', 'hidden', 'muted'] : ['locked', 'muted'],
      state: {
        locked: targets.length > 0 && targets.every(x => !!ctlState(x)?.locked),
        hidden: viewable.length > 0 && viewable.every(x => !!ctlState(x)?.hidden),
        muted: picked ? soundy.length > 0 && soundy.every(x => !!ctlState(x)?.muted) : mainAllMuted,
      },
      empty: all.length === 0,
      ...(picked ? { note: pickNote(targets.length) } : {}),
    }
  }
  function toggleMain(k: LaneCtlKey) {
    const cur = mainCtl()
    const { targets, picked } = rowPick(mainRowTargets())
    if (k === 'muted' && !picked) { setMainAllMuted(!cur.state.muted); return }
    const want = !cur.state[k]
    // Hide only what isn't locked; the lock itself switches for everything
    for (const t of targets) {
      if (!canCtl(t).includes(k) || !!ctlState(t)?.[k] === want) continue
      if (k !== 'locked' && isLocked(t)) continue
      toggleCtl(t, k)
    }
  }
  /** The main video is silent everywhere: the whole clip's switch is off, or every section is muted */
  // A section's sound is off: the main video's here, or (a video put in between) that video's own
  const insertMuted = (s: SegmentLocal) => s.crop_boxes[0]?.muted !== false
  const sectionSilent = (s: SegmentLocal) => isInsert(s, mainVideoId) ? insertMuted(s) : originalMuted || !!s.muted
  const mainAllMuted = sections.length > 0 ? sections.every(sectionSilent) : originalMuted
  const someSectionsMuted = !mainAllMuted && sections.some(sectionSilent)
  /** The Music panel's switch (and "Mute clip audio"): every part of the main row silent, inserted videos too (or all back on) */
  function setMainAllMuted(on: boolean) {
    setOriginalMuted(false)
    for (const s of sections) {
      if (isInsert(s, mainVideoId)) {
        if (insertMuted(s) !== on) updateSegment(s.id, { crop_boxes: s.crop_boxes.map((b, i) => i === 0 ? { ...b, muted: on } : b) })
      } else if (!!s.muted !== on) updateSegment(s.id, { muted: on })
    }
  }
  function laneCtl(kind: string): LaneCtl | null {
    if (kind === 'main') return mainCtl()
    // A track with a video on it has sound too
    const can: LaneCtlKey[] | undefined = frameLaneCan(kind) ?? LANE_CAN[kind]
      ?? (kind.startsWith('track-') ? (laneTargets(kind).some(t => t.kind === 'broll') ? ['locked', 'hidden', 'muted'] : ['locked', 'hidden'])
        : kind.startsWith('audio-') ? ['locked', 'muted'] : undefined)
    if (!can) return null
    const all = laneTargets(kind)
    const { targets, picked } = rowPick(all)
    const state: LaneCtl['state'] = {}
    for (const k of can) {
      const able = targets.filter(t => canCtl(t).includes(k))
      state[k] = able.length > 0 && able.every(t => !!ctlState(t)?.[k])
    }
    return { can, state, empty: all.length === 0, ...(picked ? { note: pickNote(targets.length) } : {}) }
  }
  function toggleLane(kind: string, k: LaneCtlKey) {
    if (kind === 'main') { toggleMain(k); return }
    const cur = laneCtl(kind)
    if (!cur) return
    const want = !cur.state[k]
    // Hide / mute only what isn't locked; the lock itself switches for everything
    for (const t of rowPick(laneTargets(kind)).targets) {
      if (!canCtl(t).includes(k) || !!ctlState(t)?.[k] === want) continue
      if (k !== 'locked' && isLocked(t)) continue
      toggleCtl(t, k)
    }
  }

  /** Everything shown during a section — its video, photos, text and music — each one a click from its settings */
  function sectionItems(seg: SegmentLocal): SectionItem[] {
    const out: SectionItem[] = []
    const inside = (s: number, e: number) => s < seg.end_ms && e > seg.start_ms
    const from = (s: number) => Math.max(s, seg.start_ms)
    const go = (s: number) => { pause(); seekToMs(from(s)) }
    for (const shot of shots) {
      if (!inside(shot.start_ms, shot.end_ms)) continue
      out.push({ key: `broll-${shot.id}`, kind: 'video', name: (videoTitles[shot.crop_boxes[0].source_video_id!] ?? 'Video').replace(/^(Pixabay|Pexels): /, ''), start: from(shot.start_ms), end: Math.min(shot.end_ms, seg.end_ms),
        focus: () => { go(shot.start_ms); pickShot(shot.id, true) }, ctl: { kind: 'broll', id: shot.id } })
    }
    if (isFrameLayout(seg.layout)) {
      for (const it of frameOf(seg).items ?? []) {
        if (!inside(it.start_ms, it.end_ms)) continue
        const kind: SectionItemKind = it.kind === 'video' ? 'video' : it.kind === 'photo' ? 'photo' : 'text'
        const name = it.kind === 'video' ? (videoTitles[it.source_video_id ?? ''] ?? 'Video') : it.kind === 'photo' ? 'Photo in the frame' : it.captions ? 'Captions' : (it.text?.trim() || 'Text')
        out.push({ key: it.id, kind, name, start: from(it.start_ms), end: Math.min(it.end_ms, seg.end_ms), thumb: it.kind === 'photo' ? it.image_url : null,
          focus: () => { selectInFrame(seg.id, it.id, from(it.start_ms)); openSettings(kind === 'text' ? 'text' : 'frames') },
          ctl: it.captions ? undefined : { kind: 'frameItem', id: it.id, segId: seg.id } })
      }
    }
    for (const o of overlays) {
      if (!inside(o.start_ms, o.end_ms)) continue
      out.push({ key: o.id, kind: o.type === 'image' ? 'photo' : 'video', name: o.type === 'image' ? 'Photo' : 'Video on top', start: from(o.start_ms), end: Math.min(o.end_ms, seg.end_ms), thumb: o.type === 'image' ? o.preview_url : null,
        focus: () => { go(o.start_ms); if (o.type === 'image') pickPhoto(o.id); else setActiveOverlayId(o.id) }, ctl: { kind: 'photo', id: o.id } })
    }
    for (const t of textOverlays) {
      if (!inside(t.start_ms, t.end_ms)) continue
      out.push({ key: t.id, kind: 'text', name: t.text.trim() || 'Text', start: from(t.start_ms), end: Math.min(t.end_ms, seg.end_ms),
        focus: () => { go(t.start_ms); pickText(t.id) }, ctl: { kind: 'text', id: t.id } })
    }
    for (const t of audioTracks) {
      const end = Math.min(clipLengthMs, t.end_ms ?? (musicDurations[t.id] != null ? t.start_ms + musicDurations[t.id] - (t.offset_ms ?? 0) : clipLengthMs))
      if (!inside(t.start_ms, end)) continue
      out.push({ key: t.id, kind: 'music', name: musicName(t), start: from(t.start_ms), end: Math.min(end, seg.end_ms),
        focus: () => { go(t.start_ms); pickMusicTrack(t.id) }, ctl: { kind: 'music', id: t.id } })
    }
    const order: SectionItemKind[] = ['video', 'photo', 'text', 'music']
    return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.start - b.start)
  }
  const itemsBySection = new Map(cropPositions.map(sg => [sg.id, sectionItems(sg)]))
  // What the Hide / Mute / Lock buttons by Trim and Delete act on: the last thing picked, as
  // Delete does (deleteTarget) — otherwise whatever is still picked, most specific first
  const pickedFrameItem = frameSeg && activeFrameItemId && !activeFrameItemId.startsWith('main:')
    ? frameOf(frameSeg).items?.find(x => x.id === activeFrameItemId && !x.captions) : undefined
  const selTargets: Record<NonNullable<typeof lastPick>, CtlTarget | null> = {
    music: pickedMusicId && audioTracks.some(t => t.id === pickedMusicId) ? { kind: 'music', id: pickedMusicId } : null,
    overlay: activeOverlayId && overlays.some(o => o.id === activeOverlayId) ? { kind: 'photo', id: activeOverlayId } : null,
    text: activeTextOverlayId && textOverlays.some(o => o.id === activeTextOverlayId) ? { kind: 'text', id: activeTextOverlayId } : null,
    frameItem: pickedFrameItem && frameSeg ? { kind: 'frameItem', id: pickedFrameItem.id, segId: frameSeg.id } : null,
    section: pickedSegId && segments.some(x => x.id === pickedSegId)
      ? { kind: brollShots.some(b => b.id === pickedSegId) ? 'broll' : 'section', id: pickedSegId } : null,
  }
  const selTarget: CtlTarget | null = (lastPick && selTargets[lastPick])
    || selTargets.frameItem || selTargets.music || selTargets.overlay || selTargets.text || selTargets.section || null
  const selName = !selTarget ? '' : selTarget.kind === 'section' ? 'the picked section' : selTarget.kind === 'broll' ? 'the picked video'
    : selTarget.kind === 'frameItem' ? (pickedFrameItem?.kind === 'video' ? 'the picked video' : pickedFrameItem?.kind === 'photo' ? 'the picked photo' : 'the picked text')
      : selTarget.kind === 'photo' && overlays.find(o => o.id === selTarget.id)?.type === 'video' ? 'the picked video'
        : `the picked ${selTarget.kind}`
  // (what's still there of what was picked together)
  const groupLive = groupPick.filter(id => segments.some(s => s.id === id) || overlays.some(o => o.id === id)
    || textOverlays.some(o => o.id === id) || audioTracks.some(t => t.id === id))
  // Something picked on its own (here, on the preview, in a panel): the group lets go
  useEffect(() => { if (selTarget?.id) setGroupPick(g => (g.length ? [] : g)) }, [selTarget?.id])
  // A click anywhere outside the timeline lets go of what's picked together too (the timeline lets
  // go itself on a click on an empty spot) — but not its toolbar (Delete, Group act on them), a menu
  // or a dialog
  const hasGroupPick = groupLive.length > 0
  useEffect(() => {
    if (!hasGroupPick) return
    const down = (e: PointerEvent) => {
      const el = e.target as Element | null
      if (!el || timelineRef.current?.contains(el) || el.closest?.('.ed-transport, [role="menu"], [role="dialog"], [data-keep-selection]')) return
      setGroupPick([])
    }
    window.addEventListener('pointerdown', down)
    return () => window.removeEventListener('pointerdown', down)
  }, [hasGroupPick])

  // Previous section · play · next section, in the timeline's bar beside the clock (user, 2026-10-29: on the
  // picture they covered the crop boxes; under it they took the video's height). Styles: .ed-transport .ed-player
  const playControls = (
    <div className="ed-player" data-playing={playing || undefined}>
      <div />
      <div className="flex items-center gap-1.5">
        <button onClick={jumpPrevSection} aria-label="Go to the previous section" title="Previous section"
          className="ed-tl-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="2.4" height="14" rx="1" /><path d="M19 5.8v12.4a.8.8 0 01-1.2.7L9.5 12.7a.8.8 0 010-1.4l8.3-6.2a.8.8 0 011.2.7z" /></svg>
        </button>
        {/* Film-reel play button (styles: .ed-play in globals.css) */}
        <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title={`${playing ? 'Pause' : 'Play'} (Space)`}
          data-playing={playing || undefined}
          className="ed-play w-10 h-10 flex items-center justify-center rounded-full shrink-0">
          <PlayRing lengthMs={clipDurationMs} />
          <span key={playing ? 'pause' : 'play'} className="ed-play-icon flex">
            {playing
              ? <svg width="13" height="13" viewBox="0 0 12 12" fill={ACCENT}><rect x="2" y="1.5" width="3" height="9" rx="1"/><rect x="7" y="1.5" width="3" height="9" rx="1"/></svg>
              : <svg width="13" height="13" viewBox="0 0 12 12" fill={ACCENT}><path d="M3.5 1.5l7.5 4.5L3.5 10.5V1.5z"/></svg>
            }
          </span>
        </button>
        <button onClick={jumpNextSection} aria-label="Go to the next section" title="Next section"
          className="ed-tl-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="16.6" y="5" width="2.4" height="14" rx="1" /><path d="M5 5.8v12.4a.8.8 0 001.2.7l8.3-6.2a.8.8 0 000-1.4L6.2 5.1A.8.8 0 005 5.8z" /></svg>
        </button>
      </div>
      <div />
    </div>
  )
  return (
    <div className="editor-theme h-screen flex flex-col overflow-hidden" style={{ background: 'var(--ed-app)', color: 'var(--ed-text)' }}>

      <EditorTour open={tourOpen} onClose={() => setTourOpen(false)} />

      {/* ── Header: logo · where am I · is it saved · export ───────────────────── */}
      {/* Above everything in the body (preview overlays use z-index 10–20), so the account menu isn't drawn underneath them */}
      <header className="app-nav relative shrink-0 flex items-center gap-3 px-4"
        style={{ height: 56, background: 'var(--ed-panel)', borderBottom: '1px solid rgb(var(--ed-fg) / 0.07)', zIndex: 60 }}>
        {/* Same vector logo (with its intro) as the landing page, dashboard and clip board */}
        <a href="/dashboard" onClick={e => leaveTo(e, '/dashboard')} title="Go to the dashboard" aria-label="Shortcut dashboard"
          className="flex items-center shrink-0 rounded-lg">
          <BrandLogo shine />
        </a>

        <div className="w-px h-6 shrink-0" style={{ background: 'rgb(var(--ed-fg) / 0.1)' }} />

        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0 text-sm">
          <a href="/dashboard" onClick={e => leaveTo(e, '/dashboard')}
            className="shrink-0 transition-colors hover:text-[var(--ed-text)]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
            Dashboard
          </a>
          <BreadcrumbChevron />
          <a href={clipBoardHref} onClick={e => leaveTo(e, clipBoardHref)} title={`Clip board: ${videoTitle}`}
            className="shrink-0 transition-colors hover:text-[var(--ed-text)]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
            Clip board
          </a>
          <BreadcrumbChevron />
          <span aria-current="page" className="font-semibold text-[var(--ed-text)] shrink-0" title={clipTitle}>Editing board</span>
        </nav>

        <SaveIndicator state={leaving ? 'saving' : saveState} leaving={leaving} onRetry={handleSave} />

        <div className="flex-1" />

        <div className="flex items-center gap-3 shrink-0">
          {/* The brand kit on this clip, one click away (brand kit Phase 2) */}
          <EditorBrandMenu kits={brand.kits} loading={brand.loading} onKitId={brandOn?.kit_id ?? null}
            onTurnOn={turnBrandOn} onTurnOff={turnBrandOff} onEdit={id => { if (id) brand.select(id); setKitStudio(true); openSettings('brand') }} />
          <button type="button" onClick={() => setTourOpen(true)} aria-label="Show the editor tour" title="How the editor works"
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
            style={{ color: 'rgb(var(--ed-fg) / 0.7)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.14)' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01" />
            </svg>
          </button>
          <ThemeSwitch />
          {/* Shared profile button; saves pending edits before leaving the editor */}
          <AccountMenu
            onNavigate={href => leave(() => { window.location.href = href })}
            onSignOut={() => leave(() => { signOut({ callbackUrl: '/login' }) })}
          />
        </div>
      </header>

      {exportError && (
        <div role="alert" className="shrink-0 flex items-center gap-3 px-4 py-2 text-xs"
          style={{ background: 'rgba(239,68,68,0.12)', borderBottom: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>
          <span className="flex-1">{exportError}</span>
          <button onClick={() => setExportError(null)} className="px-2 py-0.5 rounded hover:bg-[rgb(var(--ed-fg)/0.1)]" aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* ── Body: [tools + options · player · preview] on top, the timeline full width below. Each
          area is a card of its own (.ed-card), with a gap round and between them ── */}
      <div className="ed-body flex flex-col flex-1 min-h-0 overflow-hidden p-2">
      <div className="ed-top flex flex-1 min-h-0 overflow-hidden">

        {/* Tool rail: always there, down the left (open or closed, the options panel sits beside it) */}
        <ToolRail tool={tool} open={optionsOpen}
          onPick={id => {
            // (Brand kit pressed again while open: its workshop closes too, back to what was open before it)
            if (id === 'brand' && tool === 'brand') { closeKitStudio(); return }
            if (id === tool && optionsOpen) { toggleOptions(false); return }
            setTool(id); setEditingTranscript(false); toggleOptions(true)
          }} />

        {/* Options sidebar — settings for the selected tool only; collapsible */}
        <aside id="options-sidebar" data-layout-panel="Options" aria-label={`${activeTool.title} options`} aria-hidden={!optionsOpen}
          className="ed-options relative shrink-0 min-h-0 overflow-hidden" data-open={optionsOpen || undefined} data-resizing={resizing === 'options' || undefined}
          style={{ width: optionsOpen ? optionsW : 0, background: 'var(--ed-panel)' }}
          {...(!optionsOpen ? { inert: true } : {})}
          // Files from the computer dropped anywhere on the sidebar go in at the playhead (B-roll here: as B-roll)
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!sidebarDrop) setSidebarDrop(true) } }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSidebarDrop(false) }}
          onDrop={e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setSidebarDrop(false); dropFiles([...e.dataTransfer.files], currentTimeMs, null) }}>
          {sidebarDrop && (
            <div className="absolute inset-2 z-50 flex flex-col items-center justify-center gap-1 rounded-xl pointer-events-none text-center px-4"
              style={{ border: '2px dashed #c8ff00', background: 'rgba(12,12,12,0.86)' }}>
              <span className="text-sm font-bold" style={{ color: '#c8ff00' }}>Drop to add at {msToLabel(currentTimeMs)}</span>
              <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>
                {tool === 'media' && mediaSection === 'library' ? 'A video goes in as B-roll' : 'Videos, photos or music'}
              </span>
            </div>
          )}
          {/* Its right edge: drag to make the column wider or narrower */}
          {optionsOpen && (
            <div role="separator" aria-orientation="vertical" aria-label="Drag to resize the options panel. Double-click to reset."
              title="Drag to resize · double-click to reset" className="ed-col-handle" style={{ right: 0 }} data-on={resizing === 'options' || undefined}
              onPointerDown={e => startColumnResize(e, 'options')} onDoubleClick={() => resetColumn('options')} />
          )}
          {/* Fixed width inside, so the panel slides and fades as one piece while the column opens */}
          <div className="ed-options-inner h-full flex flex-col min-h-0" style={{ width: optionsW }}>
          {/* (no title: the tool's tab above already says which it is; its ⓘ explains it) */}
          <div className="shrink-0 pl-3 pr-2 py-1.5 flex items-center gap-2" style={{ borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
            <div className="flex-1 min-w-0">
            {tool === 'captions' && editingTranscript ? (
              <button onClick={() => setEditingTranscript(false)} className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ed-text)] hover:opacity-80">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M9 2.5L4.5 7 9 11.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Edit caption text
              </button>
            ) : (
              // The tool's explanation sits behind the ⓘ
              <div className="flex items-center h-7">
                <InfoTip label={`About ${activeTool.title}`}>{activeTool.hint}</InfoTip>
              </div>
            )}
            </div>
            {/* one chevron: tucks the options panel away to the left (styles: .ed-fold) */}
            <button onClick={() => toggleOptions(false)} aria-label="Close options sidebar" title="Close options sidebar"
              className="ed-fold" data-dir="left">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path className="fold-arrow" d="M14.5 6.5L9 12l5.5 5.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>

          {/* Keyed by tool: switching tools fades the new panel in */}
          <div key={tool} className="ed-options-body flex-1 min-h-0 overflow-y-auto">
            {tool === 'format' && (
              <div className="flex flex-col">
                <div className="px-4 pt-3 pb-2 flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--ed-text)]">Sections</span>
                  <span className="h-5 min-w-5 px-1.5 flex items-center justify-center rounded-full text-[11px] font-bold tabular-nums"
                    style={{ background: 'rgba(200,255,0,0.12)', color: 'var(--ed-accent-text)' }}>
                    {cropPositions.length}
                  </span>
                  <div className="flex-1" />
                  {cropPositions.length > 1 && (
                    <button onClick={() => confirm({
                        title: 'Remove every format except the first?',
                        body: 'The first format will cover the whole clip, and any frames among the others are removed too. You can undo this.',
                        confirmLabel: 'Remove',
                      }, handleResetPositions)}
                      title="Remove every format except the first"
                      className="h-7 px-2.5 flex items-center gap-1.5 rounded-lg text-[11px] font-medium transition-colors hover:bg-[rgb(var(--ed-fg)/0.06)] hover:text-[var(--ed-text)]"
                      style={{ color: 'rgb(var(--ed-fg) / 0.55)', border: '1px solid rgb(var(--ed-fg) / 0.12)' }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" /><path d="M3 3v5h5" />
                      </svg>
                      Reset
                    </button>
                  )}
                </div>
                {/* Show what's in the sections: everything, or one kind (sections without it fade) */}
                <div role="radiogroup" aria-label="Show in the sections" className="flex gap-1 mt-1 overflow-x-auto no-scrollbar -mx-1 px-1">
                  {(['all', ...SECTION_KINDS.map(k => k.id)] as const).map(id => {
                    const on = sectionFilter === id
                    const meta = SECTION_KINDS.find(k => k.id === id)
                    const n = id === 'all' ? null : [...itemsBySection.values()].reduce((c, list) => c + list.filter(x => x.kind === id).length, 0)
                    return (
                      <button key={id} role="radio" aria-checked={on} onClick={() => setSectionFilter(id)}
                        className="shrink-0 h-6 px-2 flex items-center gap-1 rounded-full text-[11px] font-medium transition-colors"
                        style={on
                          ? { background: meta ? `${meta.color}26` : 'rgb(var(--ed-fg) / 0.12)', color: 'var(--ed-text)', boxShadow: `inset 0 0 0 1px ${meta ? meta.color : 'rgb(var(--ed-fg) / 0.25)'}` }
                          : { color: 'rgb(var(--ed-fg) / 0.55)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }}>
                        {meta && <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />}
                        {meta ? meta.plural : 'All'}
                        {n != null && <span className="tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>{n}</span>}
                      </button>
                    )
                  })}
                </div>
                </div>
                <div ref={sectionListRef} className="px-3 pb-3 flex flex-col gap-1.5">
                  {(() => {
                  const renderSection = (seg: (typeof cropPositions)[number], i: number) => {
                    // A frame is one vertical 9:16 reel, so as a format it's Vertical (its contents live in Frames)
                    const shown = formatLayoutOf(seg.layout)
                    const col = LAYOUT_COLORS[shown]
                    const isActiveSeg = seg.id === activeSegment?.id
                    const name = LAYOUTS.find(l => l.id === shown)?.label ?? shown
                    const all = itemsBySection.get(seg.id) ?? []
                    const items = sectionFilter === 'all' ? all : all.filter(x => x.kind === sectionFilter)
                    // Open when toggled open, or when a kind is picked and this section has some
                    const open = openSections.has(seg.id) || (sectionFilter !== 'all' && items.length > 0)
                    const faded = sectionFilter !== 'all' && items.length === 0
                    return (
                      <div
                        key={seg.id}
                        data-section-id={seg.id}
                        role="button" tabIndex={0}
                        aria-current={isActiveSeg || undefined}
                        aria-label={`Section ${i + 1}: ${name}, ${msToLabel(seg.start_ms)} to ${msToLabel(seg.end_ms)}`}
                        className="group relative flex flex-col rounded-xl cursor-pointer overflow-hidden transition-[background,box-shadow,opacity] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(200,255,0,0.6)]"
                        style={{
                          background: isActiveSeg ? 'linear-gradient(180deg, rgba(200,255,0,0.06), rgba(200,255,0,0.015))' : 'rgb(var(--ed-fg) / 0.03)',
                          boxShadow: isActiveSeg ? 'inset 0 0 0 1px rgba(200,255,0,0.45), 0 8px 22px -16px rgba(200,255,0,0.5)' : 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.07)',
                          opacity: faded ? 0.45 : 1,
                        }}
                        onClick={() => { setActiveSegmentId(seg.id); setPickedSegId(seg.id); seekToMs(seg.start_ms) }}
                        onKeyDown={e => { if (e.key === 'Enter') { setActiveSegmentId(seg.id); setPickedSegId(seg.id); seekToMs(seg.start_ms) } }}>
                        <div className="flex items-start gap-2.5 pl-2.5 pr-1.5 pt-2 pb-1.5">
                          <span className="shrink-0 w-8 h-8 mt-px flex items-center justify-center rounded-lg"
                            style={{ background: isActiveSeg ? 'rgba(200,255,0,0.1)' : 'rgb(var(--ed-fg) / 0.06)' }}>
                            <LayoutGlyph layout={shown} color={isActiveSeg ? '#c8ff00' : '#9ca3af'} active={isActiveSeg} />
                          </span>
                          <div className="flex-1 min-w-0 flex flex-col">
                            {/* Line 1: name · time range · open */}
                            <div className="flex items-center gap-2 min-w-0 h-6">
                              <span className="text-[13px] font-semibold truncate text-[var(--ed-text)]">{name}</span>
                              {isActiveSeg && <span className="shrink-0 w-1.5 h-1.5 rounded-full" style={{ background: '#c8ff00' }} title="Under the playhead" />}
                              <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
                                {msToLabel(seg.start_ms)} – {msToLabel(seg.end_ms)}
                              </span>
                            </div>
                            {/* Line 2: length and what's in it (lock, delete, show and sound are on the timeline: user, 2026-10-29) */}
                            <div className="flex items-center gap-1 min-w-0 h-6">
                              <span className="flex-1 min-w-0 truncate text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.42)' }}>
                                {[lengthLabel(seg.end_ms - seg.start_ms), ...SECTION_KINDS.flatMap(k => {
                                  const c = all.filter(x => x.kind === k.id).length
                                  return c ? [`${c} ${(c === 1 ? k.one : k.plural).toLowerCase()}`] : []
                                })].join(' · ')}
                              </span>
                            </div>
                          </div>
                          {/* What's in this section: open / close its list */}
                          <button onClick={e => { e.stopPropagation(); setOpenSections(prev => { const n = new Set(prev); if (n.has(seg.id)) n.delete(seg.id); else n.add(seg.id); return n }) }}
                            aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} what's in section ${i + 1}`} title={open ? 'Hide what\u2019s in it' : 'Show what\u2019s in it'}
                            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)]"
                            style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                              style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><path d="M6 9l6 6 6-6" /></svg>
                          </button>
                        </div>
                        {open && (
                          <div className="mx-2 mb-2 flex flex-col rounded-lg overflow-hidden" onClick={e => e.stopPropagation()}
                            style={{ background: 'rgb(var(--ed-fg) / 0.035)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.05)' }}>
                            {/* The main video, in every section (under a video section its sound carries on) */}
                            {sectionFilter === 'all' && (
                              <div className="flex items-center gap-1 pr-1" style={{ opacity: seg.hidden ? 0.5 : 1 }}>
                                <button onClick={() => { pause(); seekToMs(seg.start_ms); setActiveSegmentId(seg.id); setPickedSegId(seg.id) }}
                                  title={`Main video · ${msToLabel(seg.start_ms)}–${msToLabel(seg.end_ms)}`}
                                  className="flex-1 min-w-0 h-8 flex items-center gap-2 pl-2 pr-1 text-left transition-colors hover:bg-[rgb(var(--ed-fg)/0.05)]">
                                  <span className="w-[18px] h-[18px] shrink-0 flex items-center justify-center rounded-[5px]" style={{ background: 'rgba(200,255,0,0.14)', color: 'var(--ed-accent-text)' }}>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
                                    </svg>
                                  </span>
                                  <span className="flex-1 min-w-0 truncate text-[11.5px] font-medium text-[var(--ed-text)]">
                                    Main video
                                  </span>
                                </button>
                              </div>
                            )}
                            {items.length === 0 ? (
                              sectionFilter === 'all' ? null : (
                                <span className="px-2.5 py-2 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>None of this kind here.</span>
                              )
                            ) : items.map(it => {
                              const k = SECTION_KINDS.find(x => x.id === it.kind)!
                              const st = it.ctl ? ctlState(it.ctl) : undefined
                              return (
                                <div key={it.key} className="flex items-center gap-1 pr-1" style={{ opacity: st?.hidden ? 0.5 : 1, borderTop: '1px solid rgb(var(--ed-fg) / 0.045)' }}>
                                <button onClick={it.focus}
                                  title={`${k.one} · ${msToLabel(it.start)}–${msToLabel(it.end)} · open its settings`}
                                  className="group/row flex-1 min-w-0 h-8 flex items-center gap-2 pl-2 pr-1 text-left transition-colors hover:bg-[rgb(var(--ed-fg)/0.05)]">
                                  {it.thumb
                                    // eslint-disable-next-line @next/next/no-img-element
                                    ? <img src={it.thumb} alt="" className="w-[18px] h-[18px] rounded-[5px] object-cover shrink-0" />
                                    : <span className="w-[18px] h-[18px] shrink-0 flex items-center justify-center rounded-[5px]" style={{ background: `${k.color}24`, color: k.color }}>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{k.icon}</svg>
                                      </span>}
                                  <span className="flex-1 min-w-0 truncate text-[11.5px] font-medium text-[var(--ed-text)]">{it.name}</span>
                                  <span className="shrink-0 text-[10px] tabular-nums opacity-0 group-hover/row:opacity-100 transition-opacity" style={{ color: 'rgb(var(--ed-fg) / 0.42)' }}>{msToLabel(it.start)}–{msToLabel(it.end)}</span>
                                </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  }
                  // Same layout together (Vertical, Split screen, Trio, …); inside a group the sections stay in time order
                  const layoutRank = (l: LayoutType) => { const n = LAYOUTS.findIndex(x => x.id === l); return n < 0 ? LAYOUTS.length : n }
                  const groups: { key: LayoutType; rows: { seg: (typeof cropPositions)[number]; i: number }[] }[] = []
                  cropPositions.forEach((seg, i) => {
                    const key = formatLayoutOf(seg.layout)
                    let g = groups.find(x => x.key === key)
                    if (!g) { g = { key, rows: [] }; groups.push(g) }
                    g.rows.push({ seg, i })
                  })
                  groups.sort((a, b) => layoutRank(a.key) - layoutRank(b.key))
                  const toggleGroup = (key: string) => setOpenGroups(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
                  return (
                    <>
                      {groups.map(g => {
                        const label = LAYOUTS.find(l => l.id === g.key)?.label ?? g.key
                        // A kind picked in the chips opens the groups that have some
                        const hasMatch = sectionFilter !== 'all' && g.rows.some(({ seg }) => (itemsBySection.get(seg.id) ?? []).some(x => x.kind === sectionFilter))
                        const open = openGroups.has(g.key) || hasMatch
                        return (
                          <div key={g.key} className="flex flex-col gap-1.5">
                            <SectionGroupHead label={label} layout={g.key} count={g.rows.length}
                              lengthMs={g.rows.reduce((n, { seg }) => n + seg.end_ms - seg.start_ms, 0)}
                              open={open} playing={g.rows.some(({ seg }) => seg.id === activeSegment?.id)} onToggle={() => toggleGroup(g.key)} />
                            {open && g.rows.map(({ seg, i }) => renderSection(seg, i))}
                          </div>
                        )
                      })}
                    </>
                  )
                  })()}
                  <p className="flex items-center gap-2 mt-1 px-1 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.38)' }}>
                    <kbd className="px-1.5 py-px rounded text-[10px] font-semibold" style={{ background: 'rgb(var(--ed-fg) / 0.08)', color: 'rgb(var(--ed-fg) / 0.7)', boxShadow: 'inset 0 -1px 0 rgb(var(--ed-fg) / 0.12)' }}>S</kbd>
                    Split at the playhead to add a section
                  </p>
                </div>
              </div>
            )}

            {tool === 'subjects' && (
              <SubjectsPanel
                angles={anglesView} onOpenAngle={openAngle} onMarkFace={markAngleFace} savingFace={savingFace} onClickMark={markByClick}
                onScanAngles={() => loadAngles(true)}
                subjects={subjectItems} loading={subjectsLoading} error={subjectsError}
                marking={marking} onToggleMarking={markFromView} onMarkShot={markShot} onMarkInClip={markInWholeClip} retrack={needsRetrack}
                onAutoFormat={runAutoFormat} autoPhase={autoPhase} autoMode={autoMode} onAutoMode={setAutoMode} onStop={stopSubjectsWork}
                onRemove={removeSubject} onRename={renameSubject}
                videoUrl={videoUrl}
                showOnVideo={showSubjects} onShowOnVideo={setShowSubjects} notice={subjectNotice}
              />
            )}

            {tool === 'frames' && (
              <FramesPanel
                frames={cropPositions.filter(x => isFrameLayout(x.layout))}
                segment={activeSegment ?? null}
                targetLabel={frameTarget}
                currentTimeMs={currentTimeMs}
                videoTitles={videoTitles}
                selected={activeFrameItemId}
                onApply={handleApplyFrame}
                onOpenFrame={openFrame}
                onSelectItem={selectInFrame}
                onToggleLock={segId => toggleCtl({ kind: 'section', id: segId }, 'locked')}
                onUpdateItem={(segId, id, patch) => {
                  const switchOnly = Object.keys(patch).every(k => k === 'hidden' || k === 'muted')
                  if (switchOnly || !frameItemBlocked(segId, id)) updateFrameItem(segId, id, patch)
                }}
                onRemoveItem={askRemoveFrameItem}
                onUpdateFrame={(segId, patch) => { if (!sectionBlocked(segId)) updateFrame(segId, patch) }}
                onReplaceMedia={(segId, id, kind) => { if (sectionBlocked(segId)) return; pause(); setFramePicker({ segId, kind, replaceId: id }) }}
                onSwapBroll={(segId, id, index) => { if (!frameItemBlocked(segId, id)) void swapBroll(segId, id, index) }}
                swappingBroll={swappingBroll}
                onRemoveFrame={askRemoveFrame}
                onRemoveMain={askRemoveMain}
              />
            )}

            {tool === 'captions' && (
              isFreePlan ? (
                <div className="m-4 flex flex-col items-center gap-3 py-8 px-4 rounded-xl text-center"
                  style={{ background: 'rgb(var(--ed-fg) / 0.03)', border: '1px solid rgb(var(--ed-fg) / 0.08)' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="10" rx="2" stroke="rgb(var(--ed-fg) / 0.6)" strokeWidth="1.8" />
                    <path d="M8 11V8a4 4 0 118 0v3" stroke="rgb(var(--ed-fg) / 0.6)" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-[var(--ed-text)]">Auto-captions are a paid feature</p>
                    <p className="text-xs mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>Available on Starter and above.</p>
                  </div>
                  <a href="/pricing" className="px-4 py-2 rounded-lg text-xs font-bold" style={{ background: ACCENT, color: '#000' }}>See plans</a>
                </div>
              ) : editingTranscript ? (
                <TranscriptPanel words={displayWords} clipStartMs={clip.start_ms} clipEndMs={clip.end_ms} currentTimeMs={currentTimeMs} onSeek={seekToMs} onWordChange={(id, text) => updateWord(id, text, romanize ? 'word_roman' : 'word')} />
              ) : (
                <div className="flex flex-col">
                  {/* ── Captions: on/off with its status, the language, and editing the words ── */}
                  <div className="p-4 flex flex-col gap-3">
                    <div className="cap-card">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-center gap-2.5">
                          <span className="cap-card-icon" data-on={showCaptions || undefined} aria-hidden="true">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10 10.5a2 2 0 100 3M16 10.5a2 2 0 100 3" />
                            </svg>
                          </span>
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-[var(--ed-text)]">Show captions</p>
                            {(transcribing || retranscribing) ? (
                              <p className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ed-accent-text)' }}>
                                <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-t-transparent animate-spin shrink-0" style={{ borderColor: ACCENT, borderTopColor: 'transparent' }} />
                                {retranscribePlace ? `Waiting its turn: ${inLineText(retranscribePlace)}` : 'Generating… this can take a minute'}
                              </p>
                            ) : words.length > 0 ? (
                              <p className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                                <span style={{ color: '#4ade80' }}>●</span> {words.length} words ready
                              </p>
                            ) : (
                              <p className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>No captions for this clip yet</p>
                            )}
                          </div>
                        </div>
                        <button role="switch" aria-checked={showCaptions} aria-label="Show captions" onClick={() => turnCaptions(!showCaptions)}
                          className="relative shrink-0 rounded-full transition-colors"
                          style={{ width: 40, height: 22, background: showCaptions ? ACCENT : 'rgb(var(--ed-fg) / 0.15)' }}>
                          <span className="absolute rounded-full transition-all"
                            style={{ top: 3, left: showCaptions ? 21 : 3, width: 16, height: 16, background: showCaptions ? '#0a0a0a' : '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                        </button>
                      </div>
                    </div>

                    {showCaptions && words.length > 0 && (
                      <>
                        <div className="cap-row">
                          <span className="cap-label">Language</span>
                          <div role="radiogroup" aria-label="Caption language" className="cap-seg">
                            {([[false, 'Original', 'As spoken, in its own script'], [true, 'English letters', hasRoman ? `In English letters (${scriptLabel})` : "English letters aren't available for these captions"]] as const).map(([v, label, title]) => {
                              const on = romanize === v
                              const disabled = v && !hasRoman
                              return (
                                <button key={label} role="radio" aria-checked={on} disabled={disabled} title={title}
                                  onClick={() => setRomanize(v)} className="cap-seg-btn" data-on={on || undefined}>
                                  {label}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                        <button onClick={() => setEditingTranscript(true)} className="cap-link">
                          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9.5 2L12 4.5M2 12l.7-2.8L10 1.5 12.5 4 4.8 11.3 2 12z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          <span className="flex-1 text-left">Edit caption words</span>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                        </button>
                      </>
                    )}
                  </div>
                  {showCaptions && words.length > 0 && (
                    <CaptionSelectBar lines={selectedLines} styles={playedCaptionParts?.length ?? 1}
                      onClear={() => setCaptionSel([])} onFromHere={selectCaptionsFromHere} onAll={() => setCaptionSel([[0, clipLengthMs + 1]])}
                      onOneStyle={oneCaptionStyle} />
                  )}
                  {/* (brand kit Phase 3) the kit's caption looks, one tap each */}
                  {showCaptions && styleKit && (
                    <BrandCaptionLooks kitName={styleKit.name} current={panelCaptionStyle}
                      looks={brandCaptionLooks(styleKit.data).filter(l => l.id !== 'main' || styleKit.data.captions.on)}
                      onPick={l => { changeCaptionStyle(brandCaptionStyle(l.captions)); setCaptionTextCase(l.captions.uppercase ? 'upper' : 'title') }} />
                  )}
                  {showCaptions && (
                    <CaptionStyler
                      style={panelCaptionStyle} textCase={captionTextCase}
                      onChange={changeCaptionStyle}
                      onTextCaseChange={setCaptionTextCase}
                      onEditCaptions={() => setEditingTranscript(true)}
                      onRetranscribe={handleRetranscribe}
                      retranscribing={retranscribing} retranscribeElapsed={retranscribeElapsed} retranscribePlace={retranscribePlace}
                      retranscribeError={retranscribeError} hasWords={words.length > 0}
                      hasRoman={hasRoman} romanize={romanize} romanizeLabel={scriptLabel}
                      onRomanizeChange={setRomanize}
                    />
                  )}
                </div>
              )
            )}

            {tool === 'cleanup' && (
              <CleanupPanel rows={cleanupRows} detected={cleanupDetected} working={cleanupWorking} error={cleanupError}
                blockedNote={piecesOn ? 'Deleting and restoring aren\u2019t available in a clip with a video put in between or a speed change. Play still works.' : null}
                onDetect={detectCleanup} onPlay={playCleanup}
                onDelete={r => deleteCleanup([r])} onDeleteAll={() => deleteCleanup(cleanupRows)} onRestore={restoreCleanup}
                onUndo={undo} />
            )}
            {tool === 'brand' && (
              <BrandKitPanel brand={brand} onKitId={brandOn?.kit_id ?? null} onTurnOn={turnBrandOn} onTurnOff={turnBrandOff} onDelete={askDeleteBrandKit} progressBar={progressBar} onProgressBarChange={setProgressBar}
                editing={kitStudio} onEdit={() => setKitStudio(true)} />
            )}

            {tool === 'post' && (
              <div className="p-4">
                <PostText clipId={clip.id} value={postText} prepare={async () => { await handleSave(); await ensureCaptions() }} onChange={v => setPostText({ title: v.title, post_caption: v.post_caption, hashtags: v.hashtags })} />
              </div>
            )}

            {/* Background music. The file isn't uploaded yet (same as the phone editor):
                TODO(backend): upload the track so the export can mix it in */}
            {tool === 'music' && (
              <>
              {/* The clip's own sound, always first: turn it down or off before adding music */}
              <div className="mx-4 mt-4 p-3 flex flex-col gap-2.5 rounded-xl"
                style={{ background: 'rgb(var(--ed-fg) / 0.04)', border: '1px solid rgb(var(--ed-fg) / 0.1)' }}>
                <div className="flex items-center gap-2.5">
                  <span className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg" style={{ background: 'rgba(200,255,0,0.12)', color: 'var(--ed-accent-text)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" />
                    </svg>
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="text-[13px] font-semibold text-[var(--ed-text)]">Original video sound</span>
                    <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                      {mainAllMuted ? 'Muted' : someSectionsMuted ? `${Math.round(originalVolume * 100)}% · muted in some sections` : `${Math.round(originalVolume * 100)}%`}
                    </span>
                  </span>
                  <button type="button" onClick={() => setMainAllMuted(!mainAllMuted)} aria-pressed={mainAllMuted}
                    aria-label={mainAllMuted ? 'Turn the original sound back on' : 'Mute the original sound'}
                    title={mainAllMuted ? 'Turn the original sound back on (every section)' : 'Mute the original sound (every section)'}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
                    style={mainAllMuted
                      ? { background: 'rgba(239,68,68,0.16)', color: '#fca5a5', boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.45)' }
                      : { background: 'rgb(var(--ed-fg) / 0.06)', color: 'rgb(var(--ed-fg) / 0.8)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M11 5L6 9H2v6h4l5 4V5z" />
                      {mainAllMuted ? <path d="M22 9l-6 6M16 9l6 6" /> : <path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14" />}
                    </svg>
                  </button>
                </div>
                <input type="range" min={0} max={100} step={1} value={mainAllMuted ? 0 : Math.round(originalVolume * 100)}
                  onChange={e => { const v = Number(e.target.value) / 100; setOriginalVolume(v); if ((v === 0) !== mainAllMuted) setMainAllMuted(v === 0) }}
                  aria-label="Original video sound volume"
                  className="ed-zoom-range w-full"
                  style={{ '--p': `${mainAllMuted ? 0 : Math.round(originalVolume * 100)}%` } as React.CSSProperties} />
              </div>
              <AudioMixerPanel tracks={audioTracks} nameOf={musicName}
                selectedId={pickedMusicId} onSelect={pickMusic}
                currentTimeMs={currentTimeMs} clipLengthMs={clipLengthMs} durations={musicDurations}
                onAddTrack={addMusicTrack} onAddSound={addLibrarySound}
                uploads={musicUploads}
                missing={t => !isMainAudio(t) && !t.storage_path.startsWith('audio/') && !musicEls.current.has(t.id)}
                onReadd={readdMusic}
                notice={musicNotice}
                onRemoveTrack={deleteMusic}
                onUpdateTrack={(id, u) => { if (!blocked({ kind: 'music', id })) setAudioTracks(prev => prev.map(t => t.id === id ? { ...t, ...u } : t)) }} />
              </>
            )}

            {/* Media: Import · B-roll · Photos · Memes (the switch on its own row: the names don't fit beside the header's buttons) */}
            {tool === 'media' && (() => {
              return (
                <div className="flex flex-col h-full min-h-0">
                <div role="tablist" aria-label="Media" className="shrink-0 grid grid-cols-4 gap-0.5 p-0.5 mx-3 mt-2 rounded-lg"
                  style={{ background: 'rgb(var(--ed-fg) / 0.06)', border: '1px solid rgb(var(--ed-fg) / 0.07)' }}>
                  {(['media', 'library', 'photos', 'memes'] as const).map(sec => {
                    const on = mediaSection === sec
                    return (
                      <button key={sec} type="button" role="tab" aria-selected={on} onClick={() => setMediaSection(sec)}
                        title={sec === 'media' ? 'Your videos, photos and audio' : sec === 'library' ? 'Stock footage to search' : sec === 'photos' ? 'Free stock photos to search' : 'Meme GIFs, memes and clips (KLIPY, GIPHY, Imgflip)'}
                        className="h-7 px-1 rounded-md text-[11.5px] font-semibold whitespace-nowrap transition-colors"
                        style={on ? { background: 'rgb(var(--ed-fg) / 0.12)', color: 'var(--ed-accent-text)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.08)' } : { color: 'rgb(var(--ed-fg) / 0.6)' }}>
                        {sec === 'media' ? 'Import' : sec === 'library' ? 'B-roll' : sec === 'photos' ? 'Photos' : 'Memes'}
                      </button>
                    )
                  })}
                </div>
                {/* After "Insert video": what picking a video does now, and a way out */}
                {overlayAtMs != null && (
                  <div className="ins-pick shrink-0 mx-3 mt-2" role="status">
                    <span className="ins-pick-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="2.5" /><rect x="11" y="10" width="8" height="7" rx="1.2" /></svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <b>Pick a video or photo to put on top at {msToLabel(overlayAtMs)}</b>
                      <span>It covers the clip there — make it a small window with Full screen / Window, above the timeline.</span>
                    </span>
                    <button type="button" className="ins-pick-x" onClick={() => setOverlayAtMs(null)} aria-label="Cancel the overlay" title="Cancel">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                )}
                {pipAtMs != null && (
                  <div className="ins-pick shrink-0 mx-3 mt-2" role="status">
                    <span className="ins-pick-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="2.5" /><rect x="12" y="11" width="7" height="6" rx="1.2" /></svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <b>Pick a video for picture in picture at {msToLabel(pipAtMs)}</b>
                      <span>It plays in a small window over the clip — move and resize it on the preview.</span>
                    </span>
                    <button type="button" className="ins-pick-x" onClick={() => setPipAtMs(null)} aria-label="Cancel picture in picture" title="Cancel">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                )}
                {insertAtMs != null && (
                  <div className="ins-pick shrink-0 mx-3 mt-2" role="status">
                    <span className="ins-pick-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="5" height="12" rx="1.5" /><rect x="17" y="6" width="5" height="12" rx="1.5" /><path d="M12 8v8M9 12h6" /></svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <b>Pick a video to put in at {msToLabel(insertAtMs)}</b>
                      <span>It plays there, then the clip carries on — everything after it moves later.</span>
                    </span>
                    <button type="button" className="ins-pick-x" onClick={() => setInsertAtMs(null)} aria-label="Cancel inserting a video" title="Cancel">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                )}
                <div className="flex-1 min-h-0">
                <MediaLibrary
                  items={libraryItems} loading={libraryLoading} used={usedMedia}
                  filter={mediaFilter} onFilter={setMediaFilter}
                  section={mediaSection}
                  importing={importingLabel} onImport={importMedia}
                  onAdd={item => addLibraryItem(item, currentTimeMs, null)}
                  onDelete={deleteLibraryItem}
                  library={
                    <BrollPanel searchOnly
                      clipId={clip.id}
                      currentTimeMs={currentTimeMs}
                      shots={brollShots.filter(b => stockVideos.some(v => v.id === b.id))}
                      selectedId={pickedShot?.id ?? (playingAdded ? playingSegment?.id ?? null : null)}
                      onAdd={addStockBroll}
                      onMove={moveBroll}
                      onResize={resizeBroll}
                      onRemove={removeBroll}
                      onSeek={seekToMs}
                      focusId={pickedShot && stockVideos.some(v => v.id === pickedShot.id) ? pickedShot.id : null}
                      onUploaded={addUploadedBroll}
                      settings={<VideoPanel kind="broll" videos={stockVideos} {...shotPanelProps} />}
                    />
                  }
                  photos={
                    <PhotoSearch clipId={clip.id} currentTimeMs={currentTimeMs}
                      onAdd={p => { addPhotoPathAt(p.storage_path, p.preview_url, currentTimeMs); loadLibrary() }} />
                  }
                  memes={
                    <MemesPanel currentTimeMs={currentTimeMs}
                      onAddVideo={addStockBroll}
                      onAddPhoto={p => { addPhotoPathAt(p.storage_path, p.preview_url, currentTimeMs); loadLibrary() }} />
                  }
                />
                </div>
                </div>
              )
            })()}

            {tool === 'transitions' && (
              <TransitionsPanel joins={transitionJoins} transitions={transitions} currentTimeMs={currentTimeMs}
                canAddHere={canAddTransitionAt(activeSegment, currentTimeMs)} onAddHere={addTransitionHere}
                onSet={setTransitionAt} onPreview={previewJoin} onSeek={ms => { pause(); seekToMs(ms) }} savedAsDissolve={trAsDissolve}
                focusJoin={transitionFocus} onShownJoin={setTransitionShown}
                // (the tiles show the transition between two pictures of this clip: a quarter and two thirds in)
                frameA={trFrameA} frameB={trFrameB} grabFrame={grabPreviewFrame} />
            )}

            {tool === 'text' && (
              <>
              <FrameTextPanel
                segment={frameSeg}
                currentTimeMs={currentTimeMs}
                selectedId={activeFrameItemId}
                onSelect={setActiveFrameItemId}
                onAdd={lane => { if (frameSeg && isTextLane(lane)) addBandText(frameSeg.id, currentTimeMs, lane) }}
                onUpdate={(id, patch) => { if (frameSeg && !frameItemBlocked(frameSeg.id, id)) updateFrameItem(frameSeg.id, id, patch) }}
                onRemove={id => { if (frameSeg) askRemoveFrameItem(frameSeg.id, id) }}
                onUpdateBand={patch => { if (frameSeg && !sectionBlocked(frameSeg.id)) updateFrameBand(frameSeg.id, patch) }}
              />
              <TextOverlayPanel
                overlays={textOverlays}
                currentTimeMs={currentTimeMs}
                clipDurationMs={clip.end_ms - clip.start_ms}
                onAdd={o => setTextOverlays(prev => [...prev, { ...o, id: crypto.randomUUID(), clip_id: clip.id }])}
                focusId={focusTextId}
                onFocused={() => setFocusTextId(null)}
                selectedId={activeTextOverlayId}
                onSelect={pickText}
                onUpdate={(id, patch) => { if (!blocked({ kind: 'text', id })) updateTextOverlay(id, patch) }}
                onRemove={askDeleteTextOverlay}
                brand={styleKit && brandTextStyles ? { name: styleKit.name, styles: brandTextStyles, lines: styleKit.data.words?.lines ?? [], onFontAll: styleKit.data.title.font ? brandFontOnAll : undefined } : null}
              />
              </>
            )}

          </div>
          </div>
        </aside>

        {/* The player: format bar, the video, play controls */}
        <main data-layout-panel="Video view" className="ed-card ed-video relative flex flex-col flex-1 min-w-0 min-h-0">
          {/* Brand kit: its workshop in the video's place (the video stays underneath: the Preview plays from it) */}
          {/* (not tied to the options sidebar: closing that leaves the workshop open — user, 2026-10-20) */}
          {tool === 'brand' && kitStudio && (
            <div className="absolute inset-0 overflow-hidden" style={{ zIndex: 30, borderRadius: 'inherit', background: 'var(--ed-panel)' }}>
              <BrandKitStudio brand={brand} onKitId={brandOn?.kit_id ?? null} onTurnOn={turnBrandOn} onTurnOff={turnBrandOff} onClose={closeKitStudio} clipMock={false} />
            </div>
          )}
          {/* Canvas toolbar, centred: the layouts as one sliding switch, then the Motion button.
              Styles: .ed-fmt* and .ed-motion* at the end of globals.css */}
          <div className="ed-canvas-bar shrink-0 flex items-center justify-center gap-3 px-4" style={{ minHeight: 60, borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
            {/* (in the empty space a deleted part left: nothing here — no layout to pick) */}
            {!inGap && <>
            <FormatSwitcher
              activeId={activeSegment ? formatLayoutOf(activeSegment.layout) : null}
              play={formatPlay}
              onPick={id => { setFormatPlay(p => ({ id, n: (p?.n ?? 0) + 1 })); if (tool === 'subjects' && pickForScene(id)) return; handleLayoutChange(id, 'fromPlayhead') }}
            />
            </>}

            {/* Motion: a button beside the layouts — a dot that goes red while it records (styles: .ed-motion) */}
            <button
              onClick={() => setMotionMode(m => !m)}
              aria-pressed={motionMode}
              title={motionMode
                ? 'Motion is on: drag the view while the video plays and it follows your hand smoothly'
                : 'Motion is off: moving the view changes it from the playhead on (a cut). Turn on to record a smooth follow while the video plays'}
              className="ed-motion select-none" data-on={motionMode || undefined}
            >
              <span className="ed-motion-dot" aria-hidden="true" />
              {motionMode ? 'Recording motion' : 'Motion'}
            </button>
          </div>

          {/* (behind the stage and the play bar together) */}
          <AmbientGlow videoRef={videoRef} />
          <div className="ed-stage relative flex-1 min-h-0" style={{ background: 'var(--ed-canvas)' }}>
            <div className="ed-stage-box absolute flex flex-col rounded-xl overflow-hidden" style={{ inset: 8, border: '1px solid rgb(var(--ed-fg) / 0.1)' }}>
              <VideoPreview live segmentAt={viewAt} overlaySource={brollSource} mainVideoId={mainVideoId}
                videoRef={videoRef} videoUrl={clipVideoUrl} currentTimeMs={currentTimeMs}
                activeSegment={viewSegment} getPositionAt={viewGetPositionAt}
                activeBoxId={activeBoxId ?? null}
                onSelectBox={(segId, boxId) => { setActiveSegmentId(segId); setActiveBoxId(boxId) }}
                onBoxChange={handleBoxChange}
                marking={marking} onMark={(x, y) => markSubject(x, y, undefined, true)} subjectsAt={subjectsAt}
              />
              {playingAdded && !playingAdded.hidden && (playingSegment && isInsert(playingSegment, mainVideoId)
                // (a quiet see-through tag; its dot says which: lime = a video put in between, as on the film strip; orange = B-roll)
                ? <div className="ed-pv-tag absolute top-3 left-3 pointer-events-none"><i style={{ background: '#c8ff00' }} />Inserted video</div>
                : <div className="ed-pv-tag absolute top-3 left-3 pointer-events-none"><i style={{ background: '#f97316' }} />B-roll</div>
              )}
              {/* Holding ← / →: how fast it's skipping */}
              {skipRate !== null && (
                <div className="ed-pv-tag ed-skip absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none" role="status">
                  {skipRate < 0 ? '⏪' : '⏩'} {Math.abs(skipRate)}×
                </div>
              )}
            </div>
          </div>

        </main>

        {/* Right column: 9:16 output preview, always visible */}
        {/* Closed: a slim rail to bring the Preview back */}
        {!previewOpen && (
          <div className="ed-preview-rail shrink-0 flex flex-col items-center gap-2 py-3" style={{ width: 52, background: 'var(--ed-panel)', borderLeft: '1px solid rgb(var(--ed-fg) / 0.07)' }}>
            {/* one chevron, pointing where the preview comes back from (styles: .ed-fold) */}
            <button onClick={() => togglePreview(true)} aria-label="Open the preview" title="Open the preview"
              className="ed-fold" data-dir="left" data-active>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path className="fold-arrow" d="M14.5 6.5L9 12l5.5 5.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button onClick={() => togglePreview(true)} title="Open the preview to watch and export"
              className="text-[11px] font-semibold tracking-wide transition-colors hover:text-[var(--ed-text)]"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', color: 'rgb(var(--ed-fg) / 0.5)' }}>
              Preview · Export
            </button>
          </div>
        )}
        <aside data-tour="export" data-layout-panel="Preview" aria-hidden={!previewOpen} className="ed-preview-col relative shrink-0 flex flex-col min-h-0 overflow-hidden" data-open={previewOpen || undefined} data-resizing={resizing === 'preview' || undefined}
          style={{ width: previewOpen ? previewW : 0, background: 'var(--ed-panel)' }}
          {...(!previewOpen ? { inert: true } : {})}>
          {/* Its left edge: drag to make the preview wider or narrower */}
          {previewOpen && (
            <div role="separator" aria-orientation="vertical" aria-label="Drag to resize the preview. Double-click to reset."
              title="Drag to resize · double-click to reset" className="ed-col-handle" style={{ left: 0 }} data-on={resizing === 'preview' || undefined}
              onPointerDown={e => startColumnResize(e, 'preview')} onDoubleClick={() => resetColumn('preview')} />
          )}
          <div className="ed-preview-inner flex flex-col min-h-0 h-full" style={{ width: previewW }}>
          {/* One row (user, 2026-10-29: more room for the phone): close · how it looks inside each app · Export */}
          <div className="ed-pv-head shrink-0 px-3 flex items-center gap-2" style={{ height: 52, borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
            <span className="flex items-center shrink-0">
              {/* one chevron: sends the preview off to the right (styles: .ed-fold) */}
              <button onClick={() => togglePreview(false)} aria-label="Close the preview" title="Close the preview (more room to edit)"
                className="ed-fold" data-dir="right">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path className="fold-arrow" d="M9.5 6.5L15 12l-5.5 5.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <span className="sr-only">Preview</span>
            </span>
            {/* (short names — Off, Reels, Shorts; only their icons when the column is narrow) */}
          <div role="radiogroup" aria-label="Show preview as" className="ed-pv-views flex-1 min-w-0 grid grid-cols-3 gap-0.5 p-[3px] rounded-full">
            {PLATFORM_OPTIONS.map(({ id, label, icon }) => {
              const on = platform === id
              return (
                <button key={id} role="radio" aria-checked={on} onClick={() => setPlatform(id)}
                  aria-label={id === 'off' ? 'Plain preview' : `${PLATFORM_SAFE[id].name} ${label}`}
                  title={id === 'off' ? 'Plain preview' : `See how it looks on ${PLATFORM_SAFE[id].name}`}
                  className="ed-pv-view flex items-center justify-center gap-1.5 h-7 min-w-0 px-1.5 rounded-full text-xs font-medium" data-on={on || undefined}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {icon}
                  </svg>
                  <span className="truncate">{label}</span>
                </button>
              )
            })}
          </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {rendering ? (
                // While the reel renders, the Export button stays and keeps playing its download
                // animation on a loop (.ed-export[data-busy] in globals.css) until it's done
                <span className="sbb ed-export" data-busy role="status"
                  aria-label={exporting ? 'Starting the export' : `Exporting, ${formatElapsed(renderElapsed)} so far`}
                  title={exporting ? 'Starting…' : `Exporting · ${formatElapsed(renderElapsed)}`}>
                  <span className="sbb-beam" aria-hidden="true" />
                  <span className="sbb-surface gap-1.5 h-8 px-3.5 text-xs font-bold">
                    <ExportIcon /> Exporting
                  </span>
                </span>
              ) : hasOutput ? (
                <>
                  <button onClick={() => requestExport(true)} aria-label="Re-render"
                    title="Render again with your latest edits. Captions are regenerated too."
                    className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
                    style={{ color: 'rgb(var(--ed-fg) / 0.75)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.14)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />
                    </svg>
                  </button>
                  <a href={`/api/clips/${clip.id}/download`} download
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold transition-opacity hover:opacity-90"
                    style={{ background: ACCENT, color: '#000' }}>
                    <DownloadIcon /> Download
                  </a>
                </>
              ) : (
                // Lime button with a light spinning round its border on hover (SpinningBorderButton);
                // clicking plays the download animation (.ed-export) before the render starts
                <SpinningBorderButton onClick={pressExport}
                  title="Render the reel so you can download it"
                  aria-busy={exportPress || undefined}
                  data-pressed={exportPress || undefined}
                  className="ed-export rounded-[10px]"
                  surfaceClassName="gap-1.5 h-8 px-3.5 text-xs font-bold">
                  <ExportIcon /> Export
                </SpinningBorderButton>
              )}
            </div>
          </div>

          {/* Preview fills the column: as wide as it can be while the full 9:16 frame fits the height */}
          <div ref={previewBodyRef} className="flex-1 min-h-0 px-2 py-1.5 overflow-hidden">
            <AmbientGlow videoRef={videoRef} />
            <div ref={fullViewRef} className="ed-pv-box h-full w-full flex justify-center" data-full-view={fullView || undefined}
              style={fullView
                ? { containerType: 'size', alignItems: 'center', background: '#000', padding: '24px 24px 84px', boxSizing: 'border-box',
                    ...(fullViewFallback ? { position: 'fixed', inset: 0, zIndex: 200, width: '100vw', height: '100vh' } : {}) }
                : { containerType: 'size', alignItems: 'flex-start' }}>
            {/* Not in full view: the 9:16 video on a card — rounded, a fine lime-to-white edge and a soft glow
                under it (user, 2026-10-31: "remove the mobile completely, a normal preview, a little creative";
                styles: .ed-pv-card). As big as the panel lets the full 9:16 be */}
            <div className={fullView ? undefined : 'ed-pv-card'} style={{ width: 'min(100cqw, calc(100cqh * 9 / 16))' }}>
              <div className={fullView ? undefined : 'ed-pv-card-in'}>
              <div className="relative">
              {rendering ? (
                <div className="flex flex-col items-center justify-center gap-4 rounded-xl" style={{ aspectRatio: '9/16', background: 'var(--ed-app)', border: '1px solid rgb(var(--ed-fg) / 0.08)' }}>
                  <BrandLoader size={48} />
                  <div className="text-center flex flex-col gap-1 px-6">
                    <p className="text-sm font-semibold text-[var(--ed-text)]">Rendering your reel…</p>
                    <p className="text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>Usually takes a minute or two. You can keep editing.</p>
                    {renderElapsed > 0 && <p className="text-xs tabular-nums mt-1" style={{ color: 'rgba(200,255,0,0.75)' }}>{formatElapsed(renderElapsed)}</p>}
                  </div>
                  {clipStatus === 'rendering' && renderElapsed > 180 && (
                    <button onClick={handleResetStuckRender}
                      className="text-xs px-4 py-1.5 rounded-lg"
                      style={{ color: '#f87171', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                      Taking too long? Cancel render
                    </button>
                  )}
                </div>
              ) : (
                <OutputCanvas live segmentAt={viewAt} transitionCuts={transitionCuts} watermark={showWatermark} progressBar={progressBar && { ...progressBar, lengthMs: clipLengthMs }} timelineToVideo={timelineToVideo} clock={hasInserts ? liveTime.get : undefined}
                  videoRef={videoRef} currentTimeMs={currentTimeMs} clipStartMs={clip.start_ms} videoToTimeline={videoToTimeline}
                  activeSegment={viewSegment} getPositionAt={viewGetPositionAt} sourceFor={brollSource} slotSourceFor={borrowed.slotSourceFor}
                  skipTransitionRef={skipCanvasTransitionRef} words={displayWords}
                  captionStyle={captionStyle} captionParts={playedCaptionParts} captionTextCase={captionTextCase} showCaptions={showCaptions}
                  // (no captions in a gap left by a deleted part: its words went with it)
                  captionsOffAt={t => gapRanges.some(([a, b]) => t >= a && t < b)}
                  // (a picture-in-picture video plays from its library link)
                  overlays={overlays.filter(o => !o.hidden).map(o => (o.type === 'video' && o.source_video_id ? { ...o, preview_url: videoUrls[o.source_video_id] ?? o.preview_url } : o))} activeOverlayId={activeOverlayId}
                  onOverlayChange={(id, u) => { if (!blocked({ kind: 'photo', id })) updateOverlay(id, u) }} onSelectOverlay={id => { const o = overlays.find(x => x.id === id); if (o?.type === 'image') pickPhoto(id); else { setActiveOverlayId(id); setLastPick('overlay') } }} onDeleteOverlay={askDeleteOverlay}
                  textOverlays={textOverlays.filter(o => !o.hidden)} activeTextOverlayId={activeTextOverlayId}
                  onTextOverlayChange={(id, u) => { if (!blocked({ kind: 'text', id })) updateTextOverlay(id, u) }} onSelectTextOverlay={id => { if (id) pickText(id, false); else setActiveTextOverlayId(null) }}
                  editTextOverlayId={previewOpen ? editTextId : null} onEditTextDone={() => setEditTextId(null)} onDeleteTextOverlay={askDeleteTextOverlay}
                  onCaptionPositionChange={(y, x) => updateCaptionStyle({ position_y: y, position_x: x })}
                  onCaptionSizeChange={size => changeCaptionStyle({ size })}
                  frameMedia={framePool}
                  onFrameLaneClick={focusLane}
                  activeFrameItemId={activeFrameItemId}
                  onFrameItemClick={selectFrameItem}
                  onFrameItemChange={(id, patch) => { if (frameSeg && !frameItemBlocked(frameSeg.id, id)) updateFrameItem(frameSeg.id, id, patch) }}
                  onDeleteFrameItem={id => { if (frameSeg) askRemoveFrameItem(frameSeg.id, id) }}
                  onFrameRowsChange={heights => { if (frameSeg && !sectionBlocked(frameSeg.id)) updateFrame(frameSeg.id, { row_h: heights }) }}
                  onFrameRowsSwap={order => { if (frameSeg && !sectionBlocked(frameSeg.id)) updateFrame(frameSeg.id, { row_order: order }) }}
                  onFrameBarChange={p => {
                    if (!frameSeg || sectionBlocked(frameSeg.id)) return
                    // (null: the bar back where the template has it)
                    updateFrame(frameSeg.id, {
                      ...('split' in p ? { split: p.split ?? undefined } : {}),
                      ...('split2' in p ? { split2: p.split2 ?? undefined } : {}),
                      ...('flip' in p ? { flip: p.flip || undefined } : {}),
                      ...('flip2' in p ? { flip2: p.flip2 || undefined } : {}),
                    })
                  }}
                  onFrameFaceChange={box => { if (frameSeg && !sectionBlocked(frameSeg.id)) updateFrame(frameSeg.id, { face_box: box ?? undefined }) }}
                  onFrameMainRectChange={(slot, rect) => {
                    if (!frameSeg || sectionBlocked(frameSeg.id) || frameItemBlocked(frameSeg.id, `main:${slot}`)) return
                    const rects = { ...frameOf(frameSeg).main_rects }
                    if (rect) rects[String(slot)] = rect; else delete rects[String(slot)]
                    updateFrame(frameSeg.id, { main_rects: rects })
                  }}
                  style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 10, border: '1px solid rgb(var(--ed-fg) / 0.1)', boxShadow: '0 4px 24px rgba(0,0,0,0.6)' }}
                />
              )}
              {!rendering && <PlatformOverlay platform={platform} />}
              {/* Full view: in the preview video's own bottom-right corner */}
              {!fullView && !rendering && (
                <button onClick={openFullView} aria-label="Full view: see the preview big" title="Full view (Esc to leave)"
                  className="ed-fullview-btn absolute w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-black/80"
                  style={{ right: 10, bottom: 10, zIndex: 20, color: '#fff', background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.14)', backdropFilter: 'blur(4px)' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                  </svg>
                </button>
              )}
              </div>
              </div>
            </div>
            {fullView && (
              <FullViewBar playing={playing} onTogglePlay={togglePlay} onSeek={seekToMs} lengthMs={clipDurationMs} onClose={closeFullView} />
            )}
            </div>
          </div>

          </div>
        </aside>
      </div>

      {/* The line between the video and the play bar: drag to resize (double-click resets) */}
      {!timelineHidden && (
        <div className="ed-row-wrap relative shrink-0" style={{ height: 0, zIndex: 30, transform: 'translateY(4px)' }}>
          <div role="separator" aria-orientation="horizontal" aria-label="Drag to resize the video and the timeline. Double-click to reset."
            title="Drag to resize · double-click to reset" className="ed-row-handle" data-on={resizing === 'timeline' || undefined}
            onPointerDown={startTimelineResize} onDoubleClick={resetTimelineHeight} />
        </div>
      )}
      {/* The editing panel: its bar and the timeline, one card. Nothing is clipped at its edges
          (overflow visible): the bar's "Reset all edits?" box and its labels open above it — the
          bar and the timeline round their own corners instead */}
      <div className="ed-card ed-dockpanel shrink-0 flex flex-col" style={{ marginTop: 8, overflow: 'visible' }}>
      {/* The timeline's own bar, full width: trim · delete · hide / mute / lock · reset … undo / redo · zoom */}
      <div className="ed-transport shrink-0 flex items-center gap-2 px-3"
        style={{ height: 46, background: 'var(--ed-panel)', borderRadius: timelineHidden ? 11 : '11px 11px 0 0' }}>
        {/* Left: timeline tools */}
        <div className="ed-transport-tools justify-self-start min-w-0 flex items-center gap-1">
          {/* Show / hide the timeline. The icon is the editor with its bottom panel (the timeline)
              and an arrow saying what a click does (down = tuck it away, up = bring it back); a
              label pops up instantly on hover (.ed-tip in globals.css) */}
          <button onClick={() => setTimelineHidden(h => !h)} aria-expanded={!timelineHidden}
            aria-label={timelineHidden ? 'Show the timeline' : 'Hide the timeline'}
            data-tip={timelineHidden ? 'Show timeline' : 'Hide timeline'}
            className="ed-tl-btn ed-tip ed-tl-fold" data-active={timelineHidden || undefined}>
            {/* one chevron: down = put the timeline away, up = bring it back (styles: .ed-tl-fold) */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path className="fold-arrow" d={timelineHidden ? 'M6.5 14.5L12 9l5.5 5.5' : 'M6.5 9.5L12 15l5.5-5.5'} stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="ed-tl-sep" aria-hidden="true" />
          {/* What's selected — Trim and Delete act on exactly this (click video or music on the timeline) */}
          {(() => {
            // Split cuts what's selected (media, or a frame's item) — or, with nothing selected or a
            // section picked, the main video's section under the playhead
            const media = !!selTarget && selTarget.kind !== 'section'
            const cutName = pointTarget()?.name ?? (frameItemCut() ? selName.replace('picked ', '') : null)
            const splitOk = media ? !!cutName : canSplitHere
            const splitTitle = media
              ? (cutName ? `Split (S): cut ${cutName} in two at the playhead. Split again for three parts, then pick a part and press Delete` : `Move the playhead inside ${selName} to split it`)
              : (canSplitHere ? 'Split (S): cut the video section under the playhead in two' : 'Move the playhead inside a section to split it')
            return (
              <>
                <button
                  onClick={() => { setSplitPlay(n => n + 1); splitSelected() }}
                  disabled={!splitOk}
                  aria-label={media && cutName ? `Split: cut ${cutName} at the playhead` : 'Split the video at the playhead'}
                  title={splitTitle}
                  className="ed-tl-btn"
                >
                  <svg key={splitPlay} className={splitPlay ? 'ed-snip' : undefined} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" />
                  </svg>
                </button>
                {/* Delete: whatever is selected — a song, photo, video, text, frame item or section */}
                {(() => {
                  const del = deleteTarget()
                  return (
                <button
                  onClick={() => del?.run()}
                  disabled={!del}
                  aria-label={del ? `Delete ${del.label}` : 'Delete'}
                  title={del ? `Delete ${del.label} (Delete key)` : 'Select a video, photo, song, text or section to delete it'}
                  className="ed-tl-btn ed-tl-danger"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
                  </svg>
                </button>
                  )
                })()}
                {/* Group / Ungroup what's picked on the timeline (as Resolve's Link Clips): shown while there's something to do */}
                {(() => {
                  const picked = groupLive.length ? groupLive : selTarget?.id ? [selTarget.id] : []
                  const made = picked.length ? groupOf(groups, picked[0]) : null
                  // (what's picked is exactly one group made before: Ungroup; else, two or more picked: Group)
                  const ungroup = !!made && picked.length === made.length && picked.every(id => made.includes(id))
                  if (!ungroup && groupLive.length < 2) return null
                  return (
                    <button onClick={ungroup ? ungroupPicked : groupPicked} className="ed-tl-btn" data-active={ungroup || undefined}
                      aria-label={ungroup ? 'Ungroup' : `Group the ${groupLive.length} picked items`}
                      title={ungroup ? 'Ungroup: each one on its own again (Ctrl+Shift+G)' : `Group the ${groupLive.length} picked items: they move together from now on (Ctrl+G)`}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7" />
                        {ungroup && <path d="M4 4l16 16" />}
                      </svg>
                    </button>
                  )
                })()}
                {/* Detach audio: the main video's sound onto its own Music bar */}
                <button onClick={detachAudio}
                  aria-label={hasMainAudio ? 'Select the detached original sound' : 'Detach the audio from the main video'}
                  title={hasMainAudio ? 'The original sound is on the Music lane — click to select it' : 'Detach audio: the main video\u2019s sound becomes its own bar on the Music lane (trim, move or change its volume)'}
                  className="ed-tl-btn" data-active={hasMainAudio || undefined}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 17V5l10-2v6" /><circle cx="6.5" cy="17" r="2.5" />
                    <path d="M15 14v7M12 18l3 3 3-3" stroke="#c084fc" />
                  </svg>
                </button>
                {/* (hide / mute / lock: beside each row on the timeline, not here) */}
              </>
            )
          })()}
        </div>
        <span className="ed-tl-sep" aria-hidden="true" />
        <UndoRedo />
        <div className="flex-1" />
        {playControls}
        {/* Where the playhead is, and how long the clip is — the one clock (user, 2026-10-28: here, not under the video) */}
        <ClipClock lengthMs={clipLengthMs} />
        <div className="flex-1" />
        <div className="ml-auto shrink-0 flex items-center gap-1">
          <div className="relative">
            <button onClick={() => setConfirmResetAll(v => !v)} aria-expanded={confirmResetAll}
              title="Reset all edits" data-tip="Reset all edits"
              className="ed-tl-btn ed-tip" data-active={confirmResetAll || undefined}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" /><path d="M3 3v5h5" />
              </svg>
            </button>
            {confirmResetAll && (
              <>
                <div className="fixed inset-0" style={{ zIndex: 70 }} onClick={() => setConfirmResetAll(false)} aria-hidden="true" />
                <div role="alertdialog" aria-labelledby="reset-all-title" aria-describedby="reset-all-desc"
                  className="absolute right-0 bottom-full mb-2 flex flex-col gap-3 p-4 rounded-xl"
                  style={{ width: 280, zIndex: 71, background: 'var(--ed-panel)', border: '1px solid rgb(var(--ed-fg) / 0.12)', boxShadow: '0 12px 32px rgba(0,0,0,0.55)' }}>
                  <p id="reset-all-title" className="text-sm font-semibold text-[var(--ed-text)]">Reset all edits?</p>
                  <p id="reset-all-desc" className="text-xs leading-relaxed" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
                    The clip goes back to how it was made: its original start and end, nothing cut out. Formats, frames, text, media, music, the video’s sound and the caption look go back to the start, and the people marked in Subjects are removed. Your captions stay. Undo brings back everything except the marked people.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setConfirmResetAll(false)} autoFocus
                      className="h-8 px-3 rounded-lg text-xs font-medium transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)]"
                      style={{ color: 'rgb(var(--ed-fg) / 0.75)' }}>Cancel</button>
                    <button onClick={handleResetAll}
                      className="h-8 px-3 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90"
                      style={{ background: '#ef4444', color: '#fff' }}>Reset everything</button>
                  </div>
                </div>
              </>
            )}
          </div>
          <span className="ed-tl-sep" aria-hidden="true" />
          <ZoomSlider zoom={timelineZoom} onZoom={setTimelineZoom} />
        </div>
      </div>

      {/* Timeline (hidden with "Hide timeline") */}
      {/* (it doesn't scroll as a whole: the ruler and the main video stay, the tracks under them scroll) */}
      <div ref={timelineRef} data-tour="timeline" data-layout-panel="Editing panel" hidden={timelineHidden} className="shrink-0 flex flex-col overflow-hidden px-4 pt-3 pb-4"
        style={{ ...(timelineH != null ? { height: timelineH } : timelineBaseH != null ? { height: timelineBaseH + TIMELINE_PAD_Y } : { maxHeight: TIMELINE_MAX_H }), background: 'var(--ed-track)', borderTop: '1px solid rgb(var(--ed-fg) / 0.06)', borderRadius: '0 0 11px 11px' }}>
        <StableTimeline
          onBaseHeight={setTimelineBaseH}
          selectedMusicId={pickedMusicId} onSelectMusic={id => pickMusicTrack(id, doubleTap(`m${id}`))}
          photos={overlays.filter(o => o.type === 'image' || (o.type === 'video' && o.source_video_id)).map(o => ({
            id: o.id, start_ms: o.start_ms, end_ms: o.end_ms, url: o.preview_url, hidden: o.hidden, locked: isLocked({ kind: 'photo', id: o.id }), track: o.track, full: o.x <= 0.001 && o.y <= 0.001 && o.w >= 0.999 && o.h >= 0.999,
            ...(o.type === 'video' ? { video: { url: videoUrls[o.source_video_id!] ?? o.preview_url, offset: o.source_offset_ms ?? 0, muted: !!o.muted } } : {}),
          }))}
          laneCtl={laneCtl} onLaneCtl={toggleLane}
          captionRow={captionsPanelOpen && showCaptions && words.length > 0 ? { lines: captionLines.map(l => ({ ...l, on: lineSelected(l) })) } : null}
          onCaptionLineClick={clickCaptionLine} onSelectCaptionRange={selectCaptionRange}
          onTrackDrop={dropOnTrack} belowRows={belowRows} onMovePart={movePart} onPlacePart={placePart} onPartToTrack={partToTrack} onShotToMain={shotToMain} maxMs={MAX_CLIP_MS}
          activePhotoId={activeOverlayId} onSelectPhoto={id => pickPhoto(id, doubleTap(`p${id}`))}
          onPhotoTimeChange={(id, t) => {
            if (blocked({ kind: 'photo', id })) return
            // A video's start trimmed (its end where it was): it plays on from further into it
            const o = overlays.find(x => x.id === id)
            const trimmedStart = o?.type === 'video' && t.start_ms != null && t.start_ms !== o.start_ms && (t.end_ms == null || t.end_ms === o.end_ms)
            updateOverlay(id, trimmedStart ? { ...t, source_offset_ms: Math.max(0, (o!.source_offset_ms ?? 0) + (t.start_ms! - o!.start_ms)) } : t)
          }}
          musicTracks={audioTracks.map(t => ({
            id: t.id, start_ms: t.start_ms,
            duration_ms: t.end_ms != null ? t.end_ms - t.start_ms
              : musicDurations[t.id] != null ? musicDurations[t.id] - (t.offset_ms ?? 0) : undefined,
            name: musicName(t), original: isMainAudio(t), muted: t.muted, locked: isLocked({ kind: 'music', id: t.id }), track: t.track,
            url: musicUrls[t.id], key: t.storage_path, offset_ms: t.offset_ms,
          }))}
          onMusicTrim={trimMusicEdge}
          onMusicMove={(id, startMs) => !blocked({ kind: 'music', id }) && setAudioTracks(prev => prev.map(t => {
            if (t.id !== id) return t
            // A trimmed track keeps its length when moved
            const len = t.end_ms != null ? t.end_ms - t.start_ms : null
            return { ...t, start_ms: startMs, ...(len != null ? { end_ms: startMs + len } : {}) }
          }))}
          // (a "+" on a join of the strip adds at that join; the lane column's + at the playhead)
          onAddKind={(kind, atMs) => addMediaAt(kind, Math.round(atMs ?? currentTimeMs))}
          cutJoins={trim.starts.slice(1)}
          zoom={timelineZoom} onZoomChange={setTimelineZoom} onScrubStart={pause}
          segments={segments} mainVideoId={mainVideoId} isStock={isStockShot} clipStartMs={clip.start_ms} clipEndMs={clip.end_ms}
          onDropFiles={dropFiles} onDropStock={dropStock} onDropMedia={dropMedia}
          mainMuted={mainAllMuted}
          transitions={transitions}
          focusCut={tool === 'transitions' ? transitionShown : null}
          onOpenTransition={(afterId, at) => { pause(); seekToMs(Math.max(0, at - 1)); setTransitionFocus({ id: afterId, n: Date.now() }); openSettings('transitions') }}
          onRemoveTransition={afterId => setTransitionAt(afterId, 'cut', 0)}
          onApplyTransitionToAll={applyTransitionToAll}
          onDropTransition={dropTransition}
          currentTimeMs={currentTimeMs} activeSegmentId={activeSegment?.id ?? null}
          videoUrl={videoUrl} safeDurationMs={clipDurationMs} onSeek={seekToMs}
          sourceAt={timelineToVideo ?? trim.toSource} sourceKey={`${trimsKey}|${insertsKey}`}
          onSelectSegment={id => setActiveSegmentId(id)}
          onBrollChange={(id, s, e, done) => retimeBroll(id, s, e, done !== false)}
          videoUrls={videoUrls} mediaLengths={videoLengths}
          // (parts can be cut: an edge trims the video itself, as in InShot)
          onEdgeTrim={cutOk ? trimByEdgeLive : undefined}
          pickedSegmentId={pickedSegId}
          groupSel={groupLive} onGroupSel={setGroupPick}
          groups={groups} onGroup={groupPicked} onUngroup={ungroupPicked} onGroupRows={moveGroupRows} onGroupParts={moveGroupParts} onGroupPartsToRow={liftParts}
          onPickSegment={id => (!id ? clearPicksRef.current() : shots.some(x => x.id === id) ? pickShot(id, doubleTap(`s${id}`)) : pickSection(id, doubleTap(`s${id}`)))}
          textOverlays={textOverlays.map(o => o.locked || !isLocked({ kind: 'text', id: o.id }) ? o : { ...o, locked: true })} activeTextOverlayId={activeTextOverlayId}
          onSelectTextOverlay={id => { if (id) pickText(id, doubleTap(`t${id}`)); else setActiveTextOverlayId(null) }}
          onTextOverlayUpdate={(id, u) => { if (!blocked({ kind: 'text', id })) updateTextOverlay(id, u) }}
          frameSeg={frameSeg}
          activeFrameItemId={activeFrameItemId}
          laneHighlight={laneHighlight}
          videoTitles={videoTitles}
          // What was touched last is what's ringed — a frame lane's block too: the main video in a slot
          // (Top · Main video) and captions on a band aren't targets of the toolbar (selTarget), so
          // without this the ring stayed on whatever was picked before
          selectedId={lastPick === 'frameItem' && activeFrameItemId ? activeFrameItemId : selTarget?.id ?? (activeFrameItemId?.startsWith('main:') ? activeFrameItemId : null)}
          onSelectFrameItem={id => selectFrameItem(id, undefined, !!id && doubleTap(`f${id}`))}
          onUpdateFrameItem={(id, patch) => { if (frameSeg && !frameItemBlocked(frameSeg.id, id)) updateFrameItem(frameSeg.id, id, patch) }}
          onJumpToFrameItem={(segId, itemId) => {
            const sg = segments.find(x => x.id === segId)
            const it = sg ? frameOf(sg).items?.find(x => x.id === itemId) : undefined
            if (sg && it) selectInFrame(segId, itemId, Math.max(it.start_ms, sg.start_ms))
          }}
          onAddFrameItem={(lane, anchor) => {
            if (!frameSeg) return
            pause()
            if (isTextLane(lane)) { addBandText(frameSeg.id, currentTimeMs, lane); return }
            // A slot that takes one thing only (Pic + Vid's Pic: a photo) goes straight to it
            const only = isFrameLayout(frameSeg.layout) && typeof lane === 'number'
              ? addChoices(slotOffers(frameSeg.layout, lane), !(frameOf(frameSeg).main_slots ?? [0]).includes(lane)) : []
            if (only.length === 1 && (only[0].id === 'photo' || only[0].id === 'video')) {
              if (!sectionBlocked(frameSeg.id)) setFramePicker({ segId: frameSeg.id, kind: only[0].id, lane, t: currentTimeMs })
              return
            }
            setAddMenu({ segId: frameSeg.id, lane, t: currentTimeMs, anchor })
          }}
          viewMarkers={timelineViewMarkers}
          selectedViewT={selectedView && viewBox && selectedView.boxId === viewBox.id ? selectedView.t : null}
          onSelectView={t => {
            if (!viewBox) return
            pause()
            setSelectedView({ boxId: viewBox.id, t })
            seekToMs(t)
          }}
          onMoveView={(from, to) => {
            if (!viewBox || !activeSegment || sectionBlocked(activeSegment.id)) return
            moveViewChange(viewBox.id, from, to, activeSegment.start_ms, activeSegment.end_ms)
            const moved = viewChanges(useEditorStore.getState().keyframes[viewBox.id] ?? [])
              .reduce((best, v) => Math.abs(v.t_ms - to) < Math.abs(best - to) ? v.t_ms : best, from)
            setSelectedView({ boxId: viewBox.id, t: moved })
            // The preview shows that moment, with this view: you see where the key is going
            pause()
            seekToMs(moved)
            return moved
          }}
          onRemoveView={t => {
            if (!viewBox || viewMarkers.length <= 1 || (activeSegment && sectionBlocked(activeSegment.id))) return
            removeViewChange(viewBox.id, t)
            setSelectedView(null)
          }}
          onDuplicateView={t => {
            if (!viewBox || !activeSegment || sectionBlocked(activeSegment.id)) return
            pause()
            const at = duplicateViewChange(viewBox.id, t, activeSegment.end_ms)
            if (at == null) { notifyLocked('No room for a copy right after this view — move the next one or pick another'); return }
            // The copy is picked, under the playhead: drag it wherever it should go
            setSelectedView({ boxId: viewBox.id, t: at })
            seekToMs(at)
          }}
        />
      </div>
      </div>
      </div>

      {confirmDialog}

      {/* Why an edit didn't happen: something is locked */}
      {dropUploading && (
        <div role="status" className="fixed left-1/2 bottom-16 -translate-x-1/2 flex items-center gap-2 px-3.5 h-9 rounded-full text-xs font-medium pointer-events-none"
          style={{ zIndex: 130, background: 'var(--ed-popover)', color: 'var(--ed-text)', boxShadow: '0 0 0 1px rgba(200,255,0,0.35), 0 12px 32px -8px rgba(0,0,0,0.7)' }}>
          {dropUpload.state.phase === 'finishing' ? 'Adding' : 'Uploading'} {dropUpload.state.fileName} · {dropUpload.state.progress}%
        </div>
      )}
      {lockNote && (
        <div role="status" className="fixed left-1/2 bottom-6 -translate-x-1/2 flex items-center gap-2 px-3.5 h-9 rounded-full text-xs font-medium pointer-events-none"
          style={{ zIndex: 130, background: 'var(--ed-popover)', color: 'var(--ed-text)', boxShadow: '0 0 0 1px rgba(200,255,0,0.35), 0 12px 32px -8px rgba(0,0,0,0.7)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c8ff00" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
          {lockNote}
        </div>
      )}

      {/* The timeline's "+" menu: photos / videos into a frame slot (Dual, Trio…), B-roll, music, text */}
      {addMenu && (() => {
        const seg = segments.find(x => x.id === addMenu.segId)
        if (!seg || !isFrameLayout(seg.layout)) return null
        const lane = frameLanes(seg.layout).find(l => l.lane === addMenu.lane)
        const main = frameOf(seg).main_slots ?? [0]
        return (
          <FrameAddMenu lane={addMenu.lane} laneLabel={lane?.label ?? ''} anchor={addMenu.anchor}
            offers={slotOffers(seg.layout, typeof addMenu.lane === 'number' ? addMenu.lane : 0)}
            canAddMain={typeof addMenu.lane === 'number' && !main.includes(addMenu.lane)}
            onChoose={handleAddChoice}
            onClose={() => setAddMenu(null)} />
        )
      })()}

      {framePicker && (
        <MediaPickerModal clipId={clip.id} atMs={currentTimeMs} initialTab={framePicker.kind === 'photo' ? 'image' : framePicker.replaceId ? 'videos' : 'upload'}
          only={framePicker.kind === 'photo' ? 'photo' : 'video'}
          onInsertVideo={handlePickedVideo} onInsertImage={handlePickedPhoto}
          onClose={() => setFramePicker(null)} />
      )}

      {pickerAtMs !== null && (
        <MediaPickerModal clipId={clip.id} atMs={pickerAtMs}
          only={pickerOnly ?? undefined}
          initialTab={pickerOnly === 'photo' ? 'image' : pickerOnly === 'video' ? 'videos' : undefined}
          onInsertVideo={handleInsertBroll} onInsertImage={handleInsertImage}
          onClose={() => { setPickerAtMs(null); setPickerOnly(null) }} />
      )}

      {/* "+" → Music: pick an audio file; it goes in at the start, or so it ends with the clip */}
      <input ref={musicInputRef} type="file" accept="audio/*,video/*" className="hidden" aria-hidden="true" tabIndex={-1}
        onChange={e => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          addMusicTrack(f, musicAtRef.current)
          setTool('music'); toggleOptions(true)
        }} />
    </div>
  )
}

// ── Hide / mute / lock ─────────────────────────────────────────────────────────

type CtlKey = 'hidden' | 'muted' | 'locked'
// 'section' = the main video in a section (its sound, its lock); 'broll' = a video added over the
// main video (shown or hidden, its own sound on or off — it IS its section, so its lock is the section's)
// 'frameItem' = a photo, video or text in a frame (segId: its frame)
type CtlTarget = { kind: 'section' | 'broll' | 'photo' | 'text' | 'music' | 'frameItem'; id: string; segId?: string }
/** A target's key for "is it picked": its id (a frame's own items: with the frame, as main:<slot> repeats) */
const ctlKey = (t: CtlTarget) => (t.kind === 'frameItem' ? `${t.segId}|${t.id}` : t.id)

/** Eye / speaker / lock toggles. Lit (red for hide and mute, lime for lock) when that state is on. */
function CtlButtons({ state, can, onToggle, size, what, inert }: {
  state: { hidden?: boolean; muted?: boolean; locked?: boolean } | undefined
  can: CtlKey[]
  onToggle: (k: CtlKey) => void
  size: 'sm' | 'md'
  what: string
  /** Switches that have no effect right now (e.g. the main video under a video on top): dimmed, with why */
  inert?: CtlKey[]
}) {
  const label = (k: CtlKey, on: boolean) => k === 'hidden' ? (on ? `Show ${what} again` : `Hide ${what} (not shown or exported)`)
    : k === 'muted' ? (on ? `Turn the sound of ${what} back on` : `Mute ${what}`)
      : on ? `Unlock ${what}` : `Lock ${what} (it can't be moved, trimmed or deleted)`
  const icon = (k: CtlKey, on: boolean) => k === 'hidden'
    ? (on ? <><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0112 5c5 0 9 5 9 7a11 11 0 01-2.2 3.2M6.6 6.6C4.4 8 3 10.4 3 12c0 2 4 7 9 7a9.6 9.6 0 004.4-1.1" /><path d="M9.9 9.9a3 3 0 004.2 4.2" /></>
      : <><path d="M3 12c0-2 4-7 9-7s9 5 9 7-4 7-9 7-9-5-9-7z" /><circle cx="12" cy="12" r="3" /></>)
    : k === 'muted'
      ? (on ? <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M22 9l-6 6M16 9l6 6" /></> : <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14" /></>)
      : (on ? <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></> : <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 017.6-1.7" /></>)
  const px = size === 'sm' ? 22 : 30, ic = size === 'sm' ? 12 : 16
  return (
    <span className={`shrink-0 flex items-center ${size === 'sm' ? 'gap-px' : 'gap-0.5'}`} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      {can.map(k => {
        const on = !!state?.[k]
        const tint = k === 'locked' ? 'var(--ed-accent-text)' : '#f87171'
        const why = inert?.includes(k)
          ? (k === 'hidden' ? ' — no change yet: the video on top covers the main video here (hide that video to see this)'
            : ' — no change yet: the video on top plays its own sound here (mute that video to hear this)')
          : ''
        return (
          <button key={k} type="button" onClick={() => onToggle(k)} aria-pressed={on} aria-label={label(k, on) + why} title={label(k, on) + why}
            className={size === 'md' ? 'ed-tl-btn' : 'flex items-center justify-center rounded-md transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]'}
            style={{ width: px, height: px, color: on ? tint : 'rgb(var(--ed-fg) / 0.45)', background: on ? (k === 'locked' ? 'rgba(200,255,0,0.12)' : 'rgba(239,68,68,0.12)') : undefined, opacity: why ? 0.4 : 1 }}>
            <svg width={ic} height={ic} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon(k, on)}</svg>
          </button>
        )
      })}
    </span>
  )
}

// A music track that is the main video's own sound, detached onto the Music lane
const MAIN_AUDIO_PREFIX = 'main-video:'
const isMainAudio = (t: { storage_path: string }) => t.storage_path.startsWith(MAIN_AUDIO_PREFIX)

/** Where a photo just put in sits until its picture loads (then it takes the photo's shape: fitPhotoBox) */
const PHOTO_FIRST_BOX = { x: 0.1, y: 0.3, w: 0.8, h: 0.4 }

/**
 * The bottom of the preview's full view: play / pause, the time, a seek bar along the clip and the
 * way out (Esc too). The time and the bar follow the playhead every frame.
 */
function FullViewBar({ playing, onTogglePlay, onSeek, lengthMs, onClose }: {
  playing: boolean; onTogglePlay: () => void; onSeek: (ms: number) => void; lengthMs: number; onClose: () => void
}) {
  const now = useLiveTimeMs()
  const len = Math.max(1, lengthMs)
  return (
    <div className="absolute left-0 right-0 bottom-0 flex items-center gap-3 px-5" style={{ height: 64, background: 'linear-gradient(0deg, rgba(0,0,0,0.85), rgba(0,0,0,0))' }}>
      <button type="button" onClick={onTogglePlay} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'}
        className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-transform active:scale-95" style={{ background: '#c8ff00', color: '#000' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          {playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path d="M8 5.5v13l11-6.5z" />}
        </svg>
      </button>
      <span className="shrink-0 text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.85)' }}>
        <span className="font-semibold">{msToHundredths(Math.min(now, len))}</span>
        <span style={{ color: 'rgba(255,255,255,0.45)' }}> / {msToHundredths(len)}</span>
      </span>
      <input type="range" min={0} max={len} step={10} value={Math.min(now, len)} aria-label="Move through the clip"
        onChange={e => onSeek(Number(e.target.value))}
        className="ed-zoom-range flex-1 min-w-0" style={{ '--p': `${(Math.min(now, len) / len) * 100}%` } as React.CSSProperties} />
      <button type="button" onClick={onClose} aria-label="Leave full view" title="Leave full view (Esc)"
        className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-white/15" style={{ color: '#fff' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
        </svg>
      </button>
    </div>
  )
}

/** The playhead's time on the play bar, every frame (the editor around it redraws less often) */
function LiveTime() {
  return <>{msToHundredths(useLiveTimeMs())}</>
}

/** The tracks of photos, text and music, saved beside the clip's rows (read back by savedLanes, tracks.ts) */
/** The caption parts saved beside the rows (clips.layers.captionParts: the export reads them too); none: left out */
function withCaptionParts<L extends object>(layers: L | null, parts: CaptionPart[]): L | { v: 1; rows: string[]; cut: never[]; parts: string[]; captionParts: CaptionPart[] } | null {
  if (!parts.length) return layers
  return { ...(layers ?? { v: 1 as const, rows: [], cut: [], parts: [] }), captionParts: parts } as L & { captionParts: CaptionPart[] }
}

/** The timeline's groups saved beside the rows (clips.layers.groups: groups.ts); none: left out */
function withGroupsSaved<L extends object>(layers: L | null, groups: Groups): L | { v: 1; rows: string[]; cut: never[]; parts: string[]; groups: Groups } | null {
  if (!groups.length) return layers
  return { ...(layers ?? { v: 1 as const, rows: [], cut: [], parts: [] }), groups } as L & { groups: Groups }
}

function withLanes<L extends object>(layers: L | null, items: Array<{ id: string; track?: number }>, below = 0): L | { v: 1; rows: string[]; cut: never[]; parts: string[]; lanes: Record<string, number>; below?: number } | null {
  const lanes: Record<string, number> = {}
  for (const x of items) if (x.track != null) lanes[x.id] = x.track
  if (!Object.keys(lanes).length) return layers
  // (`below`: how many of the rows sit under the main video on the timeline)
  return { ...(layers ?? { v: 1 as const, rows: [], cut: [], parts: [] }), lanes, ...(below > 0 ? { below } : {}) } as L & { lanes: Record<string, number>; below?: number }
}

// ── What's in a section (Format panel) ─────────────────────────────────────────

type SectionItemKind = 'video' | 'photo' | 'text' | 'music'
type SectionItem = { key: string; kind: SectionItemKind; name: string; start: number; end: number; thumb?: string | null; focus: () => void; ctl?: CtlTarget }
const SECTION_KINDS: { id: SectionItemKind; one: string; plural: string; color: string; icon: React.ReactNode }[] = [
  { id: 'video', one: 'Video', plural: 'Videos', color: '#f97316', icon: <><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" /></> },
  { id: 'photo', one: 'Photo', plural: 'Photos', color: '#60a5fa', icon: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></> },
  { id: 'text', one: 'Text', plural: 'Text', color: '#f472b6', icon: <path d="M4 7V4h16v3M9 20h6M12 4v16" /> },
  { id: 'music', one: 'Song', plural: 'Music', color: '#c084fc', icon: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></> },
]

// ── Small UI pieces ───────────────────────────────────────────────────────────

/**
 * The top of the Captions panel: what a style picked below changes — the caption lines selected
 * on the timeline's Captions row (as in CapCut), else every caption — with quick selections.
 */
function CaptionSelectBar({ lines, styles, onClear, onFromHere, onAll, onOneStyle }: {
  /** The lines selected (clip ms) */
  lines: { start: number; end: number }[]
  /** How many caption styles the clip has */
  styles: number
  onClear: () => void
  onFromHere: () => void
  onAll: () => void
  onOneStyle: () => void
}) {
  const n = lines.length
  // (user, 2026-10-29) no card: a row like Language above it — what's selected on the left, the quick
  // selections on the right; the how-to moved into the label's tooltip
  return (
    <div className="cap-row cap-apply-row">
      <span className="cap-label min-w-0 truncate"
        title={n === 0 ? 'Styles go on every caption. To style just some, click their lines on the Captions row of the timeline (Shift-click or drag for more).'
          : 'The style you pick below goes on these lines only.'}>
        {n === 0 ? 'Select' : `${n} line${n > 1 ? 's' : ''}`}
        {n > 0 && <span className="cap-apply-when"> · {msToLabel(lines[0].start)}–{msToLabel(lines[n - 1].end)}</span>}
      </span>
      <div className="flex flex-wrap justify-end gap-1.5">
        {n > 0 && <button type="button" className="cap-apply-chip" onClick={onClear} title="Style every caption again">Clear</button>}
        <button type="button" className="cap-apply-chip" onClick={onFromHere} title="Select every caption line from the playhead to the end">From playhead</button>
        <button type="button" className="cap-apply-chip" onClick={onAll} title="Select every caption line">All</button>
        {styles > 1 && <button type="button" className="cap-apply-chip" onClick={onOneStyle} title="Use the first line's style for every caption">One style ({styles})</button>}
      </div>
    </div>
  )
}

/** A length in words people read at a glance: "11s", "1m 05s" */
function lengthLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

/** A fold-away heading over the sections that share a layout */
function SectionGroupHead({ label, layout, count, lengthMs, open, playing, onToggle }: {
  label: string
  layout?: LayoutType
  count: number
  lengthMs: number
  open: boolean
  /** The playhead is inside this group (shown while it is folded shut) */
  playing: boolean
  onToggle: () => void
}) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} ${label} (${count})`}
      className="flex items-center gap-2 h-8 px-2 mt-1 rounded-lg text-left transition-colors hover:bg-[rgb(var(--ed-fg)/0.05)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(200,255,0,0.6)]">
      {layout && <LayoutGlyph layout={layout} color="#9ca3af" active={false} />}
      <span className="text-[12px] font-semibold truncate text-[var(--ed-text)]">{label}</span>
      <span className="shrink-0 px-1.5 rounded-full text-[10.5px] font-semibold tabular-nums" style={{ background: 'rgb(var(--ed-fg) / 0.08)', color: 'rgb(var(--ed-fg) / 0.7)' }}>{count}</span>
      {!open && playing && <span className="shrink-0 w-1.5 h-1.5 rounded-full" style={{ background: '#c8ff00' }} title="Under the playhead" />}
      <span className="ml-auto shrink-0 text-[11px] tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.42)' }}>{lengthLabel(lengthMs)}</span>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        className="shrink-0" style={{ color: 'rgb(var(--ed-fg) / 0.55)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><path d="M6 9l6 6 6-6" /></svg>
    </button>
  )
}


/** Circular arrow with a 5 inside: jump 5 seconds back or forward */
function SkipFiveIcon({ dir }: { dir: 'back' | 'forward' }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      style={dir === 'forward' ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M4.5 12a7.5 7.5 0 107.5-7.5H8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10.5 2L8 4.5 10.5 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <text x="12" y="15.6" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor"
        style={dir === 'forward' ? { transform: 'scaleX(-1)', transformOrigin: '12px 12px' } : undefined}>5</text>
    </svg>
  )
}

/** Tiny 9:16 frame showing how a format divides the reel */
/**
 * Layout switch for the section under the playhead: the four formats in one track, a knob sliding to the
 * picked one (measured from the options, so it fits any label length or language); each shows its phone
 * icon and name. Styles: .ed-fmt* in globals.css.
 */
function FormatSwitcher({ activeId, play, onPick }: {
  activeId: LayoutType | null
  play: { id: LayoutType; n: number } | null
  onPick: (id: LayoutType) => void
}) {
  const btns = useRef(new Map<LayoutType, HTMLButtonElement>())
  const [knob, setKnob] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = activeId ? btns.current.get(activeId) : null
      setKnob(el ? { left: el.offsetLeft, width: el.offsetWidth } : null)
    }
    measure()
    const ro = new ResizeObserver(measure)
    for (const el of btns.current.values()) ro.observe(el)
    return () => ro.disconnect()
  }, [activeId])
  return (
    <div role="radiogroup" aria-label="Layout" data-tour="formats" className="ed-fmt">
      {knob && <span className="ed-fmt-knob" style={{ left: knob.left, width: knob.width }} aria-hidden="true" />}
      {LAYOUTS.map(l => {
        const on = activeId === l.id
        return (
          <button key={l.id} role="radio" aria-checked={on} onClick={() => onPick(l.id)}
            ref={el => { if (el) btns.current.set(l.id, el); else btns.current.delete(l.id) }}
            title={`${l.label} layout`} className="ed-fmt-opt" data-on={on || undefined}>
            <LayoutGlyph key={play?.id === l.id ? play.n : 0} layout={l.id} color="currentColor" active={on} play={play?.id === l.id} />
            <span>{l.id === 'split' ? 'Split' : l.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Phone-shaped icon of a format. When `play` is set (just clicked) it acts out its format
 * (styles: .ed-glyph-* in globals.css): Vertical fills the screen top to bottom, Split screen
 * slides its two halves in from the top and bottom, Trio stacks its three panes one by one,
 * Horizontal widens into a landscape band.
 */
function LayoutGlyph({ layout, color, play = false }: { layout: LayoutType; color: string; active: boolean; play?: boolean }) {
  const fill = color
  return (
    <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true" className={`shrink-0 overflow-visible${play ? ` ed-glyph ed-glyph-${layout}` : ''}`}>
      <rect className="ed-glyph-frame" x="0.75" y="0.75" width="10.5" height="16.5" rx="2" fill="none" stroke={fill} strokeWidth="1.5" />
      {layout === 'vertical' && <rect className="ed-glyph-p1" x="2.5" y="2.5" width="7" height="13" rx="1" fill={fill} opacity="0.55" />}
      {layout === 'split' && <><rect className="ed-glyph-p1" x="2.5" y="2.5" width="7" height="5.6" rx="1" fill={fill} opacity="0.55" /><rect className="ed-glyph-p2" x="2.5" y="9.9" width="7" height="5.6" rx="1" fill={fill} opacity="0.55" /></>}
      {layout === 'trio' && <><rect className="ed-glyph-p1" x="2.5" y="2.5" width="7" height="3.7" rx="0.8" fill={fill} opacity="0.55" /><rect className="ed-glyph-p2" x="2.5" y="7.15" width="7" height="3.7" rx="0.8" fill={fill} opacity="0.55" /><rect className="ed-glyph-p3" x="2.5" y="11.8" width="7" height="3.7" rx="0.8" fill={fill} opacity="0.55" /></>}
      {layout === 'horizontal' && <rect className="ed-glyph-p1" x="2.5" y="6.5" width="7" height="5" rx="1" fill={fill} opacity="0.55" />}
    </svg>
  )
}

function BreadcrumbChevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="rgb(var(--ed-fg) / 0.3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Save status chip next to the breadcrumb */
/** The format a section counts as: frames are one vertical 9:16 reel, so they're Vertical */
function formatLayoutOf(layout: LayoutType): LayoutType {
  return isFrameLayout(layout) ? 'vertical' : layout
}

/** A field the user types text into (not a slider, colour picker, checkbox…) */
function isTextEntry(el: Element | null | undefined): boolean {
  if (!el) return false
  if ((el as HTMLElement).isContentEditable || el.tagName === 'TEXTAREA') return true
  if (el.tagName !== 'INPUT') return false
  return ['text', 'number', 'search', 'email', 'url', 'tel', 'password', ''].includes((el as HTMLInputElement).type)
}

// Undo / redo, in the play bar next to the zoom (shortcuts: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z)
function UndoRedo() {
  const { canUndo, canRedo } = useHistory()
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const mod = mac ? '⌘' : 'Ctrl+'
  const btn = 'ed-tl-btn'
  return (
    <div className="flex items-center gap-0.5 shrink-0" role="group" aria-label="Undo and redo">
      <button onClick={undo} disabled={!canUndo} aria-label="Undo" title={`Undo (${mod}Z)`} className={btn}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 010 11H11" /></svg>
      </button>
      <button onClick={redo} disabled={!canRedo} aria-label="Redo" title={`Redo (${mod}${mac ? '⇧Z' : 'Shift+Z'})`} className={btn}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 000 11H13" /></svg>
      </button>
    </div>
  )
}

function SaveIndicator({ state, leaving, onRetry }: { state: SaveState; leaving?: boolean; onRetry: () => void }) {
  const chip = 'flex items-center gap-1.5 shrink-0 h-6 px-2 rounded-full text-[11px] font-medium'
  if (state === 'error') {
    return (
      <span role="alert" className={chip} style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.12)' }}>
        Couldn&apos;t save · <button onClick={onRetry} className="underline hover:opacity-80">Retry</button>
      </span>
    )
  }
  if (state === 'retrying') {
    return (
      <span className={chip} style={{ color: '#fcd34d', background: 'rgba(245,158,11,0.12)' }} aria-live="polite"
        title="The connection dropped — your changes are kept here and will save as soon as it's back">
        Connection lost · retrying… <button onClick={onRetry} className="underline hover:opacity-80">Now</button>
      </span>
    )
  }
  if (state === 'saving') {
    return (
      <span className={chip} style={{ color: 'rgb(var(--ed-fg) / 0.55)', background: 'rgb(var(--ed-fg) / 0.05)' }} aria-live="polite">
        <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-t-transparent animate-spin" style={{ borderColor: 'rgb(var(--ed-fg) / 0.55)', borderTopColor: 'transparent' }} />
        {leaving ? 'Saving and leaving…' : 'Saving…'}
      </span>
    )
  }
  return (
    <span className={chip} style={{ color: 'rgb(var(--ed-fg) / 0.45)' }} aria-live="polite">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 6.5l2.2 2.2L9.5 3.8" stroke="#4ade80" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Saved
    </span>
  )
}

function SwitchRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--ed-text)]">{label}</p>
        {description && <p className="text-xs mt-0.5" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>{description}</p>}
      </div>
      <button role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
        className="relative shrink-0 rounded-full transition-colors"
        style={{ width: 40, height: 22, background: checked ? ACCENT : 'rgb(var(--ed-fg) / 0.15)' }}>
        <span className="absolute rounded-full bg-white transition-all"
          style={{ top: 3, left: checked ? 21 : 3, width: 16, height: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
      </button>
    </div>
  )
}

function StatusChip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  )
}

function DownloadIcon() {
  return <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true"><path d="M7.5 2v8M4 7l3.5 3.5L11 7M2 13h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

/** A clean up-right arrow (the reel going out); the Export press and the exporting loop animate it */
function ExportIcon() {
  return (
    <svg className="ed-export-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ overflow: 'visible' }}>
      <g className="ed-export-arrow"><path d="M4.5 11.5l7-7M6 4.5h5.5V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></g>
    </svg>
  )
}

function TrashIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 3h8M5 3V2h2v1M4.5 3v6M7.5 3v6M3 3l.5 7h5L9 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

/** 00:26.10 — minutes, seconds and hundredths, like a video editor's timecode */
function msToClock(ms: number) {
  const cs = Math.floor(Math.max(0, ms) / 10)
  const s = Math.floor(cs / 100)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

/** Timeline zoom as − 1x +: each press one step (1x → 1.25x → 1.5x → 2x → 3x → 4x); click the value for 1x */
/** How far the clip has played, as an arc round the play button (globals.css .ed-play-ring: the desktop editor shows it) */
function PlayRing({ lengthMs }: { lengthMs: number }) {
  const now = useLiveTimeMs()
  const p = lengthMs > 0 ? Math.min(1, Math.max(0, now / lengthMs)) : 0
  return <span className="ed-play-ring" aria-hidden="true" style={{ ['--p' as string]: `${(p * 360).toFixed(1)}deg` }} />
}

/** The playhead's time / the clip's length, over the timeline: 0:12.4 / 1:43 */
function ClipClock({ lengthMs }: { lengthMs: number }) {
  const now = useLiveTimeMs()
  const fmt = (ms: number, tenths: boolean) => {
    // (rounded first: 9.96 s is 0:10.0, not 0:010.0)
    const t = (tenths ? Math.round(Math.max(0, ms) / 100) / 10 : Math.floor(Math.max(0, ms) / 1000)), m = Math.floor(t / 60), s = t - m * 60
    return `${m}:${s < 10 ? '0' : ''}${tenths ? s.toFixed(1) : Math.floor(s)}`
  }
  return (
    <span className="ed-time shrink-0 tabular-nums text-[12px] font-semibold" aria-label="Playhead and clip length" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
      <span style={{ color: 'var(--ed-text)' }}>{fmt(now, true)}</span> / {fmt(lengthMs, false)}
    </span>
  )
}

function ZoomSlider({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const i = zoom > 1 ? 1 : 0   // zoomed in or not
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Timeline zoom"
      title="Pinch on the trackpad, or hold ⌘ / Ctrl and scroll, to zoom">
      <button onClick={() => onZoom(zoomStep(zoom, -1))} disabled={i === 0} aria-label="Zoom out" title="Zoom out" className="ed-tl-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M8 11h6M20 20l-4-4" /></svg>
      </button>
      <button onClick={() => onZoom(1)} disabled={i === 0} aria-live="polite" aria-label={`Zoom ${zoomLabel(zoom)}x${i ? ', back to 1x' : ''}`}
        title={i ? 'Back to the whole clip (1x)' : 'Whole clip'}
        className="h-7 min-w-[46px] px-2 rounded-md text-xs font-semibold tabular-nums transition-colors disabled:cursor-default"
        style={i ? { background: 'rgba(200,255,0,0.14)', color: 'var(--ed-accent-text)', boxShadow: 'inset 0 0 0 1px rgba(200,255,0,0.35)' }
          : { color: 'rgb(var(--ed-fg) / 0.7)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)' }}>
        {zoomLabel(zoom)}x
      </button>
      <button onClick={() => onZoom(zoomStep(zoom, 1))} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in" className="ed-tl-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M8 11h6M11 8v6M20 20l-4-4" /></svg>
      </button>
    </div>
  )
}

/** One frame at 30 fps: the arrow keys step the playhead by this */
const FRAME_MS = 1000 / 30

/** m:ss.hh — to the hundredth, so a one-frame step with the arrow keys shows */
function msToHundredths(ms: number) {
  const cs = Math.floor(Math.max(0, ms) / 10)
  const s = Math.floor(cs / 100)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

function formatElapsed(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

/**
 * The tools down the left. Each tool shares the rail's height (up to its full size); when the
 * screen is too short for them all, the rail scrolls: an arrow at the bottom shows there are more
 * below (click: scroll down), one at the top once scrolled down. The open tool is kept in view.
 */
/**
 * A soft glow of the video's own colours behind it (light mode's stage, user 2026-10-28 — "premium": as
 * YouTube's ambient mode): the playing frame drawn a few times a second into a tiny canvas, which CSS
 * blows up and blurs (globals.css .ed-ambient). Drawn only while it shows (dark mode hides it); nothing
 * is read back from the canvas, so a video from another site is fine too.
 */
function AmbientGlow({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let raf = 0, last = 0, drawnAt = -1
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (now - last < 150) return
      last = now
      const v = videoRef.current, c = ref.current
      // (hidden — dark mode, a closed panel — or nothing new to draw)
      if (!v || !c || !c.offsetParent || v.readyState < 2 || v.currentTime === drawnAt) return
      try { c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height); drawnAt = v.currentTime } catch { /* not ready */ }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [videoRef])
  return <canvas ref={ref} width={32} height={18} className="ed-ambient" aria-hidden="true" />
}

/** The tools down the rail — Brand kit back on it, last, under Post (user, 2026-10-31; it was only in the top
 *  bar's Brand menu from 2026-10-28, which still opens it too) */
// (Format isn't on the rail: user, 2026-10-29 — sections are picked and changed on the timeline and the video)
const RAIL_TOOLS = TOOLS.filter(t => t.id !== 'format')

function ToolRail({ tool, open, onPick }: { tool: Tool; open: boolean; onPick: (t: Tool) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ up: false, down: false })
  // The hovered tool's name, beside the rail (shown where the rail is icons only: light mode)
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const up = el.scrollTop > 2, down = el.scrollTop + el.clientHeight < el.scrollHeight - 2
      setMore(m => (m.up === up && m.down === down ? m : { up, down }))
    }
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', measure); ro.disconnect() }
  }, [])
  // The open tool stays in view
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-active]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [tool, open])
  const page = (dir: 1 | -1) => ref.current?.scrollBy({ top: dir * Math.max(60, ref.current.clientHeight * 0.7), behavior: 'smooth' })
  const arrow = (dir: 1 | -1) => (
    <button type="button" onClick={() => page(dir)} aria-label={dir > 0 ? 'More tools below' : 'More tools above'} title={dir > 0 ? 'More tools' : 'Back up'}
      className="absolute left-0 right-0 z-10 flex justify-center transition-colors hover:text-white"
      style={{
        [dir > 0 ? 'bottom' : 'top']: 0, height: 30, alignItems: dir > 0 ? 'flex-end' : 'flex-start', padding: '4px 0',
        color: 'rgb(var(--ed-fg) / 0.75)',
        background: `linear-gradient(${dir > 0 ? '0deg' : '180deg'}, var(--ed-panel) 45%, transparent)`,
      }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={dir > 0 ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'} />
      </svg>
    </button>
  )
  return (
    <nav aria-label="Editor tools" data-tour="tools" className="ed-card ed-rail relative shrink-0 flex flex-col mr-2" style={{ width: 72 }}
      onMouseLeave={() => setTip(null)}>
      {tip && <span className="ed-rail-tip" role="tooltip" style={{ top: tip.top }}>{tip.label}</span>}
      {more.up && arrow(-1)}
      <div ref={ref} className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col items-center py-2"
        style={{ containerType: 'size', gap: 'clamp(2px, 0.8cqh, 4px)' }}>
        {RAIL_TOOLS.map(t => {
          const active = tool === t.id && open
          return (
            <button key={t.id} type="button" onClick={() => { setTip(null); onPick(t.id) }}
              onMouseEnter={e => { const r = e.currentTarget.getBoundingClientRect(); setTip({ label: t.label, top: r.top + r.height / 2 }) }}
              onFocus={e => { const r = e.currentTarget.getBoundingClientRect(); setTip({ label: t.label, top: r.top + r.height / 2 }) }}
              onBlur={() => setTip(null)}
              aria-pressed={active}
              title={active ? `Hide ${t.label.toLowerCase()} options` : t.title}
              className="ed-tool shrink-0" data-active={active || undefined}
              // Each tool a share of the rail's height: full size when there's room, never smaller than 48 px
              style={{ width: 60, height: `clamp(48px, calc((100cqh - 16px) / ${RAIL_TOOLS.length} - 4px), 58px)`, gap: 'clamp(2px, 0.6cqh, 4px)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">{t.icon}</svg>
              <span className="text-[11px] font-medium">{t.label}</span>
            </button>
          )
        })}
      </div>
      {more.down && arrow(1)}
    </nav>
  )
}
