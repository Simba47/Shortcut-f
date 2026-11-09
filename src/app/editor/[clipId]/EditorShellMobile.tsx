'use client'

import React, { useState, useEffect, useRef, useMemo } from 'react'
import type {
  Clip, Segment, CropBox, BoxKeyframe, CaptionStyle, TextOverlay,
  AudioTrack, Transition, TranscriptWord, LayoutType, TransitionType, Overlay,
} from '@chai-cut/shared'
import { VideoPreview, OutputCanvas } from '@/components/editor/VideoPreview'
import { computeCutRanges, reactionRanges, removedMs } from '@/lib/cuts'
import { SegmentTimeline } from '@/components/editor/SegmentTimeline'
import { CaptionStyler } from '@/components/editor/CaptionStyler'
import { TextOverlayPanel } from '@/components/editor/TextOverlayPanel'
import { AudioMixerPanel } from '@/components/editor/AudioMixerPanel'
import { FilterPanel } from '@/components/editor/FilterPanel'
import { TranscriptPanel } from '@/components/editor/TranscriptPanel'
import { useConfirm } from '@/components/editor/ConfirmDialog'
import { useEditorStore, type KeyframeMap } from '@/modules/editor/store'
import { editableSnapshot, sameEditable, type EditableSnapshot } from '@/modules/editor/history'
import { usePlayerStore, liveTime } from '@/modules/player/store'
import { useFreeWatermark } from '@/components/editor/watermark'
import { useVideoSync } from '@/modules/player/useSync'
import { useCaptionStore } from '@/modules/captions/store'
import { useMediaStore } from '@/modules/media/store'
import { rowsToLocal, normalizeCoverage, msToLabel, uncoveredRanges } from '@/modules/editor/utils'
import { fillUncovered } from '@/modules/editor/place'
import { insertsOf, insertedMs, piecesOf } from '@/modules/editor/inserts'
import { isShot } from '@/modules/editor/shots'
import { pictureOrWhole } from '@/modules/editor/pictureBox'
import { setFramePicture } from '@/modules/editor/framePicture'

// ── Types ────────────────────────────────────────────────────────────────────

type MobileTab = 'timeline' | 'crop' | 'captions' | 'text' | 'audio' | 'filters' | 'export'
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
  initialTransitions: Transition[]
  initialOverlays: Overlay[]
}

// ── Constants ────────────────────────────────────────────────────────────────

const LAYOUTS: { id: LayoutType; label: string }[] = [
  { id: 'vertical', label: 'V' },
  { id: 'split', label: 'S' },
  { id: 'trio', label: 'T' },
  { id: 'horizontal', label: 'H' },
]

const TABS: { id: MobileTab; icon: string; label: string }[] = [
  { id: 'timeline', icon: '≡', label: 'Timeline' },
  { id: 'crop', icon: '⊡', label: 'Crop' },
  { id: 'captions', icon: 'CC', label: 'Captions' },
  { id: 'text', icon: 'T', label: 'Text' },
  { id: 'audio', icon: '♪', label: 'Audio' },
  { id: 'filters', icon: '✦', label: 'Filters' },
  { id: 'export', icon: '↓', label: 'Export' },
]

const SEG_COLORS = ['#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16']

// ── Component ────────────────────────────────────────────────────────────────

export function EditorShellMobile({
  clip, videoUrl, words: initialWords, initialSegments,
  initialCaptionStyles, initialTextOverlays, initialAudioTracks, initialTransitions, initialOverlays,
}: Props) {
  // The picture inside the video's black bars (none: the whole frame): the views the editor makes keep inside it
  setFramePicture(pictureOrWhole((clip as { picture_box?: Parameters<typeof pictureOrWhole>[0] }).picture_box))
  // Music: stored when picked (any audio, or a video's sound; up to 20 MB) so it's in the export
  const [musicUploads, setMusicUploads] = useState<Record<string, 'uploading' | 'failed'>>({})
  const [musicNotice, setMusicNotice] = useState<string | null>(null)
  /** Adds a song (or, with `replaceId`, gives an old name-only song its file: "Re-add this song") */
  function addMusic(f: File, replaceId?: string) {
    if (f.size > 20 * 1024 * 1024) { setMusicNotice('Music files can be up to 20 MB. Pick a smaller file or a shorter song.'); return }
    setMusicNotice(null)
    const id = replaceId ?? crypto.randomUUID()
    if (!replaceId) {
      setAudioTracks(prev => [...prev, { id, clip_id: clip.id, storage_path: f.name, start_ms: 0, volume: 0.5, duck_under_speech: true, fade_in: true, fade_out: true }])
    }
    setMusicUploads(u => ({ ...u, [id]: 'uploading' }))
    const form = new FormData()
    form.append('file', f)
    fetch('/api/audio/upload', { method: 'POST', body: form })
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error ?? 'The song could not be uploaded'); return d as { storage_path: string } })
      .then(({ storage_path }) => {
        setAudioTracks(prev => prev.map(t => t.id === id ? { ...t, storage_path } : t))
        setMusicUploads(u => { const n = { ...u }; delete n[id]; return n })
      })
      .catch((e: unknown) => {
        setMusicUploads(u => ({ ...u, [id]: 'failed' }))
        setMusicNotice(e instanceof Error ? e.message : 'The song could not be uploaded')
      })
  }

  // ── Video player ─────────────────────────────────────────────────────────────
  // Videos put in between (inserts.ts): the main video waits while one plays, the clip is longer
  // The Free plan's watermark shows on the preview, where the export will put it
  const showWatermark = useFreeWatermark()
  const mobileSegments = useEditorStore(s => s.segments)
  const mobileInserts = useMemo(() => {
    const vid = (clip as unknown as { video_id: string }).video_id
    const all = piecesOf(mobileSegments, vid, s => isShot(s, vid))
    // (pieces only once the parts don't simply follow the video: a video put in between, or a part cut)
    return insertsOf(mobileSegments, vid).length || all.some(p => (p.from != null && Math.abs(p.from - p.at) > 1) || (p.speed ?? 1) !== 1) ? all : []
  }, [mobileSegments, clip])
  const { videoRef, seekToMs, togglePlay, pause } = useVideoSync(clip.start_ms, clip.end_ms, mobileInserts)
  const { currentTimeMs, durationMs, playing } = usePlayerStore()
  const clipVideoUrl = videoUrl && clip.start_ms > 0
    ? `${videoUrl}#t=${clip.start_ms / 1000}`
    : videoUrl

  // ── Domain stores ─────────────────────────────────────────────────────────────
  const {
    segments, keyframes, activeSegmentId, activeBoxId,
    hydrate: hydrateEditor, updateSegment, removeSegment,
    splitAtMs, getPositionAt, addFormat, applyLayout, neighbourFraming, joinSameLayoutNeighbours, setViewAt,
    setActiveSegmentId, setActiveBoxId,
  } = useEditorStore()

  const {
    words, captionStyle, captionTextCase, showCaptions, romanize,
    retranscribing, retranscribeElapsed, retranscribeError, retranscribePlace,
    hydrate: hydrateCaptions, setWords, updateWord, updateCaptionStyle,
    setCaptionTextCase, setShowCaptions, setRomanize,
    setRetranscribing, setRetranscribeElapsed, setRetranscribeError, setRetranscribePlace,
  } = useCaptionStore()

  const {
    overlays, textOverlays, audioTracks, transitions, filters, activeOverlayId,
    hydrate: hydrateMedia, setOverlays, setTextOverlays, setAudioTracks,
    setTransitions, setFilters, setActiveOverlayId, updateOverlay, deleteOverlay,
    updateTextOverlay, deleteTextOverlay,
  } = useMediaStore()

  // Loading the clip changes the stores but isn't an edit: remember the loaded state, and only
  // start auto-saving once the state differs from it (opening a clip must not write anything)
  const loadedStateRef = useRef<EditableSnapshot | null>(null)
  const editedSinceLoadRef = useRef(false)

  // ── Hydrate stores from server props ─────────────────────────────────────────
  useEffect(() => {
    // (videos put in between make the clip longer than its stretch of the video: nothing after them is cut off)
    const rows = rowsToLocal(initialSegments)
    const vid = (clip as unknown as { video_id: string }).video_id
    const lenMs = clip.end_ms - clip.start_ms + insertedMs(insertsOf(rows, vid))
    // (time no part covers gets a Vertical part of its own: no "default framing" anywhere)
    const localSegments = fillUncovered(normalizeCoverage(rows, lenMs), lenMs, vid)
    const initialKeyframeMap: KeyframeMap = {}
    for (const seg of initialSegments) {
      for (const box of seg.crop_boxes) {
        initialKeyframeMap[box.id] = box.box_keyframes
      }
    }
    hydrateEditor(localSegments, initialKeyframeMap)
    // Captions on/off: the saved choice when the clip has a caption style; a clip without one yet
    // starts with captions on if it has words (a style saved before the on/off field counts as on)
    const savedStyle = initialCaptionStyles[0]
    const hasCaptions = savedStyle ? savedStyle.enabled !== false : initialWords.length > 0
    hydrateCaptions(initialWords, savedStyle ?? { color: '#FFE700' }, savedStyle ? hasCaptions : false)
    hydrateMedia({
      overlays: initialOverlays,
      textOverlays: initialTextOverlays,
      audioTracks: initialAudioTracks,
      transitions: initialTransitions,
    })
    // The clip as loaded: the auto-save stays quiet until the state differs from this
    loadedStateRef.current = editableSnapshot()
    return () => useEditorStore.getState().reset()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Local UI state ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<MobileTab>('timeline')
  const [activeTextOverlayId, setActiveTextOverlayId] = useState<string | null>(null)
  // Captions are on their way while a caption job for this video is waiting/running and this
  // clip doesn't have its words yet (same rule as the desktop editor)
  const videoStatus = (clip as unknown as { video_status?: string }).video_status
  const captionsPending = !!(clip as unknown as { captions_pending?: boolean }).captions_pending
  const clipHasWords = (list: { start_ms: number }[]) => list.some(w => w.start_ms >= clip.start_ms && w.start_ms < clip.end_ms)
  const [transcribing, setTranscribing] = useState(
    !clipHasWords(initialWords) && (captionsPending || (videoStatus !== 'ready' && videoStatus !== 'failed'))
  )
  const [isFreePlan, setIsFreePlan] = useState(false)
  const [clipStatus, setClipStatus] = useState<string>(clip.status)
  const [outputUrl, setOutputUrl] = useState<string | null>(clip.output_url)
  const [exporting, setExporting] = useState(false)
  // Remove pauses and filler words (the cut is made by the export; see src/lib/cuts.ts)
  const [removeFillers, setRemoveFillersState] = useState(!!(clip as typeof clip & { remove_fillers?: boolean }).remove_fillers)
  const removeFillersRef = useRef(removeFillers)
  const [exportError, setExportError] = useState<string | null>(null)
  // What exports have always been rendered at (the worker ignored the 2160p asked for here)
  const renderQuality = '1080p' as const
  const [renderStuckSince, setRenderStuckSince] = useState<number | null>(clip.status === 'rendering' ? Date.now() : null)
  const [renderElapsed, setRenderElapsed] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestHandleSaveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  const retranscribeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const skipCanvasTransitionRef = useRef(false)
  const previewInnerRef = useRef<HTMLDivElement>(null)
  const cropDragRef = useRef<{ startFx: number; startFy: number; startX: number; startY: number } | null>(null)

  // If user is on free plan, captions are locked — stop the transcribing spinner immediately
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

  // ── Auto-rotate to landscape on mount (Android only — iOS ignores this) ──────
  useEffect(() => {
    const lo = (screen as { orientation?: { lock?: (o: string) => Promise<void>; unlock?: () => void } }).orientation
    if (lo?.lock) {
      lo.lock('landscape').catch(() => {})
      return () => { try { lo.unlock?.() } catch { /* ignore */ } }
    }
  }, [])

  // ── Derived values ────────────────────────────────────────────────────────────
  const activeSegment = segments.find(s => s.id === activeSegmentId)
    ?? segments.find(s => currentTimeMs >= s.start_ms && currentTimeMs < s.end_ms)
    ?? segments[0]

  const playingSegment = segments.find(s => currentTimeMs >= s.start_ms && currentTimeMs < s.end_ms)
    ?? segments[0] ?? null

  const activeBox = activeSegment?.crop_boxes.find(b => b.id === activeBoxId)
    ?? activeSegment?.crop_boxes[0]

  const cropPos = activeBox
    ? getPositionAt(activeBox.id, currentTimeMs)
    : { x: 0, y: 0, w: 1, h: 1 }

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
        setWords(newWords); setShowCaptions(true); setTranscribing(false); clearInterval(interval)
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
      if (data.status === 'failed') setExportError('Render failed — try again')
      if (data.status !== 'rendering') clearInterval(poll)
    }, 3000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [clip.id, clipStatus])

  // ── Auto-save ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editedSinceLoadRef.current) {
      const loaded = loadedStateRef.current
      if (!loaded || sameEditable(editableSnapshot(), loaded)) return
      editedSinceLoadRef.current = true
    }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => latestHandleSaveRef.current(), 2500)
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, keyframes, captionStyle, textOverlays, audioTracks, transitions, filters, overlays])

  // ── Save / export ─────────────────────────────────────────────────────────────
  // Saves run one at a time, in order, so the latest state is always written last.
  // Resolves true when that save succeeded.
  const saveChainRef = useRef<Promise<boolean>>(Promise.resolve(true))
  // A dropped connection (or a DB hiccup) retries on its own: 2s, 4s, 8s … up to 30s
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelayRef = useRef(2000)
  function handleSave(): Promise<boolean> {
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null }
    const run = saveChainRef.current.then(saveOnce, saveOnce)
    saveChainRef.current = run
    return run
  }

  async function saveOnce(): Promise<boolean> {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaveState('saving')
    const { segments, keyframes } = useEditorStore.getState()
    const { captionStyle } = useCaptionStore.getState()
    const { overlays, textOverlays, audioTracks, transitions, filters } = useMediaStore.getState()
    try {
      const res = await fetch(`/api/clips/${clip.id}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments: segments.map(s => ({
            ...s,
            crop_boxes: s.crop_boxes.map(b => ({ ...b, keyframes: keyframes[b.id] ?? b.keyframes })),
          })),
          captionStyle, textOverlays, audioTracks, transitions, filters, overlays,
          removeFillers: removeFillersRef.current,
        }),
      })
      if (!res.ok) {
        const msg = await res.json().then(j => j.error, () => null)
        throw Object.assign(new Error(msg ?? 'Save failed'), { status: res.status })
      }
      retryDelayRef.current = 2000
      setSaveState('saved')
      saveTimerRef.current = setTimeout(() => setSaveState('idle'), 2500)
      return true
    } catch (err) {
      console.error('[save]', err)
      // Offline / server-side failure: keep the edit and try again. A 4xx was refused — say so.
      const status = (err as { status?: number }).status
      if (status === undefined || status >= 500 || status === 429) {
        setSaveState('retrying')
        const delay = retryDelayRef.current
        retryDelayRef.current = Math.min(delay * 2, 30000)
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
        retryTimerRef.current = setTimeout(() => { retryTimerRef.current = null; latestHandleSaveRef.current() }, delay)
      } else {
        setSaveState('error')
      }
      return false
    }
  }
  latestHandleSaveRef.current = handleSave
  const fillerCutMs = useMemo(
    () => removedMs(computeCutRanges(words, clip.start_ms, clip.end_ms, reactionRanges(segments, clip.start_ms))),
    [words, clip.start_ms, clip.end_ms, segments],
  )

  // Back online: don't wait out the backoff
  useEffect(() => {
    const onOnline = () => { if (retryTimerRef.current) { retryDelayRef.current = 2000; latestHandleSaveRef.current() } }
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [])

  // retranscribe: Re-render also regenerates captions (Gemini) before rendering
  async function handleExport(retranscribe = false) {
    setExporting(true); setExportError(null)
    try {
      // Save the latest edits first (a pending auto-save would otherwise miss the export),
      // and don't render a version without them if that save fails
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      if (!(await handleSave())) throw new Error("Couldn't save your latest edits, so nothing was exported. Check your connection and try again.")
      const res = await fetch('/api/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_id: clip.id, quality: renderQuality, retranscribe, remove_fillers: removeFillersRef.current }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Export failed')
      refreshWordsOnDoneRef.current = retranscribe
      setClipStatus('rendering')
      setActiveTab('export')
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  /**
   * A caption word corrected in the Captions panel: shown at once and saved on the transcript, so it
   * is there when the clip opens again and the export writes it (before 2026-11-04 it stayed in this
   * editor only: gone on reload, never exported)
   */
  function changeWord(id: string, text: string) {
    const field = romanize ? 'word_roman' : 'word'
    updateWord(id, text, field)
    fetch('/api/transcribe/words', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, text }) })
      .then(r => { if (!r.ok) throw new Error(String(r.status)) })
      .catch(() => setExportError('That caption correction wasn’t saved. Type it again.'))
  }

  async function handleReEdit() {
    await fetch(`/api/clips/${clip.id}/reedit`, { method: 'POST' })
    setClipStatus('draft'); setOutputUrl(null)
  }

  /** Cancel while exporting: the export stops and the clip is as it was before (as the desktop editor's Cancel) */
  const [cancelling, setCancelling] = useState(false)
  async function cancelExport() {
    if (cancelling) return
    setCancelling(true); setExportError(null)
    try {
      const res = await fetch(`/api/clips/${clip.id}/cancel-export`, { method: 'POST' })
      const d = await res.json().catch(() => null) as { status?: string; output_url?: string | null; error?: string } | null
      if (!res.ok || !d?.status) throw new Error(d?.error ?? 'Couldn’t cancel the export. Try again.')
      setClipStatus(d.status); setOutputUrl(d.output_url ?? null)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Couldn’t cancel the export. Try again.')
    } finally {
      setCancelling(false)
    }
  }

  /** Captions on: made now for this clip if it has none yet (nothing is captioned until asked) */
  function turnCaptions(on: boolean) {
    setShowCaptions(on)
    const has = words.some(w => w.start_ms >= clip.start_ms && w.start_ms < clip.end_ms)
    if (on && !has && !transcribing && !retranscribing && !isFreePlan) handleRetranscribe('unknown')
  }

  // (`fresh`: Regenerate — read the clip again even where it has words; else only parts with none.
  // Try again repeats what failed)
  const lastFreshRef = useRef(false)
  // The caption job being waited for, and which wait is current: Stop ends the wait and stops the job
  // (user, 2026-11-06) — the worker writes nothing, the clip keeps its words
  const retranscribeJobRef = useRef<string | null>(null)
  const retranscribeRunRef = useRef(0)
  const stopCaptionJob = (jobId: string) => {
    fetch('/api/transcribe/retranscribe/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }) }).catch(() => {})
  }
  function stopRegenerate() {
    const jobId = retranscribeJobRef.current
    retranscribeRunRef.current++
    retranscribeJobRef.current = null
    if (retranscribeTimerRef.current) { clearInterval(retranscribeTimerRef.current); retranscribeTimerRef.current = null }
    setRetranscribePlace(null); setRetranscribing(false); setRetranscribeError(null)
    if (jobId) stopCaptionJob(jobId)
  }
  async function handleRetranscribe(languageCode: string, fresh = false) {
    lastFreshRef.current = fresh
    const run = ++retranscribeRunRef.current
    retranscribeJobRef.current = null
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
        body: JSON.stringify({ clip_id: clip.id, language_code: languageCode, ...(fresh ? { fresh: true } : {}) }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Retranscription failed')
      const videoId = (clip as unknown as { video_id: string }).video_id
      const queuedAt = new Date().toISOString()
      const { job_id: jobId } = await res.json().catch(() => ({})) as { job_id?: string | null }
      // (stopped before the job was made: it's stopped now)
      if (retranscribeRunRef.current !== run) { if (jobId) stopCaptionJob(jobId); return }
      retranscribeJobRef.current = jobId ?? null
      const poll = async () => {
        const deadline = Date.now() + 5 * 60 * 1000
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 3000))
          if (retranscribeRunRef.current !== run) return
          const r = await fetch(`/api/transcribe/words?video_id=${videoId}&since=${encodeURIComponent(queuedAt)}${jobId ? `&job=${jobId}` : ''}`)
          if (r.ok) {
            const { words: newWords, place } = await r.json()
            // Waiting its turn (many people making captions at once): say where it is in line
            setRetranscribePlace(typeof place === 'number' ? place : null)
            if (newWords?.length > 0) { setWords(newWords); stopTimer(); setRetranscribing(false); return }
          }
        }
        stopTimer(); setRetranscribing(false)
      }
      poll()
    } catch (err) {
      if (retranscribeRunRef.current !== run) return
      stopTimer(); setRetranscribing(false)
      setRetranscribeError(err instanceof Error ? err.message : 'Retranscription failed')
    }
  }

  // ── Every delete asks first ─────────────────────────────────────────────────
  const { confirm, dialog: confirmDialog } = useConfirm()
  /** The refresh icon on Show captions: this clip's speech read again (its word edits go), once confirmed */
  function askRegenerate() {
    confirm({
      title: 'Regenerate this clip’s captions?', body: 'Its speech is read again. Your word edits in this clip will be replaced.',
      confirmLabel: 'Regenerate', tone: 'warning',
    }, () => handleRetranscribe('unknown', true))
  }
  function askResetPositions() {
    confirm({ title: 'Remove all crop positions except the first?', body: 'The first one will cover the whole clip.', confirmLabel: 'Remove' }, () => {
      const f = segments[0]; if (!f) return
      segments.slice(1).forEach(s => removeSegment(s.id))
      updateSegment(f.id, { start_ms: 0, end_ms: clip.end_ms - clip.start_ms })
      setActiveSegmentId(f.id)
    })
  }
  function askDeleteSegment(id: string) {
    const i = segments.findIndex(s => s.id === id)
    // (its time goes to the part next to it: never left with no part, "default framing")
    confirm({ title: `Delete crop position ${i + 1}?` }, () => {
      const seg = segments[i]
      const next = seg && (segments.find(s => Math.abs(s.end_ms - seg.start_ms) <= 1) ?? segments.find(s => Math.abs(s.start_ms - seg.end_ms) <= 1))
      if (next) useEditorStore.getState().absorbSection(id, next.id)
      else if (seg) useEditorStore.getState().applyLayout(id, 'vertical')
    })
  }
  function askDeleteTextOverlay(id: string) {
    confirm({ title: 'Delete this text?' }, () => deleteTextOverlay(id))
  }
  function askDeleteOverlay(id: string) {
    confirm({ title: 'Delete this image?' }, () => deleteOverlay(id))
  }
  function askRemoveTrack(id: string) {
    confirm({ title: 'Remove this music track?', confirmLabel: 'Remove' }, () => setAudioTracks(prev => prev.filter(t => t.id !== id)))
  }

  // Same rule as the desktop editor: a layout changes the WHOLE format under the playhead (or the
  // whole uncovered stretch there), starts from the nearest view with that layout, and joins
  // touching neighbours with the same layout. "Cut" is how a format is split in two.
  function handleLayoutChange(layout: LayoutType) {
    const t = currentTimeMs
    const v = videoRef.current
    const ar = v?.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : undefined
    const transitionAfter = new Set(transitions.map(tr => tr.after_segment_id))
    // Only the format actually under the playhead: in time no format covers, playingSegment
    // falls back to the first format, and changing that one would edit the wrong part of the clip
    const seg = segments.find(s => t >= s.start_ms && t < s.end_ms)
    if (!seg) {
      const gap = uncoveredRanges(segments, clip.end_ms - clip.start_ms).find(g => t >= g.start_ms && t <= g.end_ms)
      if (!gap || gap.end_ms - gap.start_ms < 300) return
      pause()
      const id = addFormat(gap.start_ms, gap.end_ms, layout, ar, neighbourFraming(layout, gap.start_ms, gap.end_ms))
      setActiveSegmentId(joinSameLayoutNeighbours(id, transitionAfter))
      return
    }
    if (seg.layout === layout) return
    pause()
    applyLayout(seg.id, layout, ar, neighbourFraming(layout, seg.start_ms, seg.end_ms, seg.id))
    setActiveSegmentId(joinSameLayoutNeighbours(seg.id, transitionAfter))
  }

  function handleCut() {
    if (!activeSegment) return
    const newId = splitAtMs(activeSegment.id, currentTimeMs, getPositionAt)
    if (newId) setActiveSegmentId(newId)
  }

  // Moving the view = a view change from the playhead on (same rule as the desktop editor, views.ts)
  function moveView(boxId: string, pos: { x: number; y: number; w: number; h: number }) {
    const seg = segments.find(s => s.crop_boxes.some(b => b.id === boxId))
    if (!seg) return
    if (playing) pause()
    setViewAt(boxId, Math.max(seg.start_ms, Math.min(seg.end_ms - 1, currentTimeMs)), pos, seg.start_ms)
  }

  function handleCropChange(field: 'x' | 'y' | 'w' | 'h', value: number) {
    if (!activeBox) return
    moveView(activeBox.id, { ...cropPos, [field]: value })
  }

  function handleInsertBrollAfterSeg(_afterSegId: string) {}

  // ── Touch-drag crop (translates finger movement to crop position) ─────────────

  function getVideoFrame() {
    const video = videoRef.current
    const container = previewInnerRef.current
    if (!video || !container || !video.videoWidth) return null
    const cW = container.clientWidth
    const cH = container.clientHeight
    const vA = video.videoWidth / video.videoHeight
    const cA = cW / cH
    if (vA > cA) {
      const fW = cW, fH = cW / vA
      return { left: 0, top: (cH - fH) / 2, width: fW, height: fH }
    } else {
      const fH = cH, fW = cH * vA
      return { left: (cW - fW) / 2, top: 0, width: fW, height: fH }
    }
  }

  function touchToFraction(touch: React.Touch) {
    const frame = getVideoFrame()
    const container = previewInnerRef.current
    if (!frame || !container) return null
    const rect = container.getBoundingClientRect()
    const tx = touch.clientX - rect.left - frame.left
    const ty = touch.clientY - rect.top - frame.top
    return { fx: tx / frame.width, fy: ty / frame.height }
  }

  function onCropTouchStart(e: React.TouchEvent) {
    e.preventDefault()
    const pos = touchToFraction(e.touches[0])
    if (!pos) return
    const { fx, fy } = pos
    if (fx >= cropPos.x && fx <= cropPos.x + cropPos.w &&
        fy >= cropPos.y && fy <= cropPos.y + cropPos.h) {
      cropDragRef.current = { startFx: fx, startFy: fy, startX: cropPos.x, startY: cropPos.y }
    }
  }

  function onCropTouchMove(e: React.TouchEvent) {
    e.preventDefault()
    if (!cropDragRef.current || !activeBox) return
    const pos = touchToFraction(e.touches[0])
    if (!pos) return
    const dx = pos.fx - cropDragRef.current.startFx
    const dy = pos.fy - cropDragRef.current.startFy
    moveView(activeBox.id, {
      ...cropPos,
      x: Math.max(0, Math.min(1 - cropPos.w, cropDragRef.current.startX + dx)),
      y: Math.max(0, Math.min(1 - cropPos.h, cropDragRef.current.startY + dy)),
    })
  }

  function onCropTouchEnd() { cropDragRef.current = null }

  // ── Render ────────────────────────────────────────────────────────────────────

  // Shared header JSX reused in both orientations
  const headerJSX = (
    <header style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 12, background: '#111', borderBottom: '1px solid rgba(255,255,255,0.07)', zIndex: 20 }}>
      <a href="/dashboard" style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.06)', borderRadius: 10, flexShrink: 0 }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 2.5L4.5 7 9 11.5" stroke="rgba(255,255,255,0.7)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </a>
      <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.4)', borderRadius: 10, padding: 3, flexShrink: 0 }}>
        {LAYOUTS.map(l => (
          <button key={l.id} onClick={() => handleLayoutChange(l.id)}
            style={{ padding: '4px 8px', borderRadius: 7, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: activeSegment?.layout === l.id ? '#c8ff00' : 'transparent', color: activeSegment?.layout === l.id ? '#000' : 'rgba(255,255,255,0.4)' }}>
            {l.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 11, flexShrink: 0, color: saveState === 'saved' ? '#22c55e' : saveState === 'saving' ? 'rgba(255,255,255,0.4)' : saveState === 'error' ? '#f87171' : saveState === 'retrying' ? '#fcd34d' : 'transparent' }}>
        {saveState === 'saving' ? '●' : saveState === 'saved' ? '✓ Saved' : saveState === 'error' ? '! Not saved' : saveState === 'retrying' ? 'Offline · retrying' : '·'}
      </span>
      {exportError && <span style={{ fontSize: 10, color: '#f87171', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exportError}</span>}
    </header>
  )

  // Shared playback bar JSX
  const playbackJSX = (compact = false) => (
    <div style={{ flexShrink: 0, height: compact ? 40 : 44, display: 'flex', alignItems: 'center', gap: compact ? 6 : 8, paddingLeft: compact ? 8 : 12, paddingRight: compact ? 8 : 12, background: '#111', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <button onClick={() => seekToMs(Math.max(0, currentTimeMs - 5000))} style={{ width: compact ? 30 : 36, height: compact ? 30 : 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: 8, border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9.5 3L5 7l4.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><line x1="3" y1="2.5" x2="3" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      </button>
      <button onClick={togglePlay} style={{ width: compact ? 36 : 44, height: compact ? 36 : 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#c8ff00', borderRadius: compact ? 18 : 22, border: 'none', cursor: 'pointer', flexShrink: 0 }}>
        {playing
          ? <svg width="12" height="12" viewBox="0 0 12 12" fill="black"><rect x="2" y="1.5" width="3" height="9" rx="1"/><rect x="7" y="1.5" width="3" height="9" rx="1"/></svg>
          : <svg width="12" height="12" viewBox="0 0 12 12" fill="black"><path d="M3 1.5l7.5 4.5L3 10.5V1.5z"/></svg>
        }
      </button>
      <button onClick={() => seekToMs(Math.min(clipDurationMs, currentTimeMs + 5000))} style={{ width: compact ? 30 : 36, height: compact ? 30 : 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: 8, border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4.5 3L9 7l-4.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><line x1="11" y1="2.5" x2="11" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      </button>
      {compact && <button onClick={handleCut} style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(200,255,0,0.12)', color: '#c8ff00', fontSize: 11, fontWeight: 700, border: '1px solid rgba(200,255,0,0.2)', cursor: 'pointer' }}>✂</button>}
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontVariantNumeric: 'tabular-nums' }}>
        {msToLabel(currentTimeMs)} / {msToLabel(clipDurationMs)}
      </span>
    </div>
  )

  // Shared right sidebar content (9:16 preview + controls) — used in landscape
  const sidebarJSX = (
    <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#111', borderLeft: '1px solid rgba(255,255,255,0.07)', overflowY: 'auto', overflowX: 'hidden' }}>

      {/* 9:16 Output preview */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ padding: '8px 12px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: 0.5, textTransform: 'uppercase' as const }}>Preview 9:16</span>
          {clipStatus === 'done' && <span style={{ fontSize: 10, fontWeight: 700, color: '#22c55e' }}>Ready</span>}
          {(clipStatus === 'rendering' || exporting) && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Processing…</span>}
        </div>
        {/* Fixed 160px wide so height=284px (9:16) — visible + leaves room for buttons */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0 10px 4px' }}>
          <div style={{ width: 160, flexShrink: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
            {(clipStatus === 'rendering' || exporting) ? (
              <div style={{ width: '100%', height: '100%', background: '#0d0d0d', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ width: 28, height: 28, borderRadius: 14, border: '2px solid #c8ff00', borderTopColor: 'transparent', display: 'block', animation: 'spin 1s linear infinite' }} />
                <p style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>Processing…</p>
                {renderElapsed > 0 && <p style={{ fontSize: 10, color: 'rgba(200,255,0,0.7)', fontVariantNumeric: 'tabular-nums' }}>{Math.floor(renderElapsed / 60)}m {renderElapsed % 60}s</p>}
              </div>
            ) : (
              <OutputCanvas watermark={showWatermark}
                videoRef={videoRef} currentTimeMs={currentTimeMs} clipStartMs={clip.start_ms} clock={mobileInserts.length ? liveTime.get : undefined}
                activeSegment={playingSegment} getPositionAt={getPositionAt}
                skipTransitionRef={skipCanvasTransitionRef}
                words={displayWords} captionStyle={captionStyle} captionTextCase={captionTextCase} showCaptions={showCaptions}
                overlays={overlays} activeOverlayId={activeOverlayId}
                onOverlayChange={updateOverlay} onSelectOverlay={setActiveOverlayId} onDeleteOverlay={askDeleteOverlay}
                textOverlays={textOverlays} activeTextOverlayId={activeTextOverlayId}
                onTextOverlayChange={updateTextOverlay} onSelectTextOverlay={setActiveTextOverlayId} onDeleteTextOverlay={askDeleteTextOverlay}
                onCaptionPositionChange={(y, x) => updateCaptionStyle({ position_y: y, position_x: x })}
                onCaptionTap={() => setActiveTab('captions')}
                style={{ width: '100%', height: '100%', display: 'block' }}
              />
            )}
          </div>
        </div>
        <div style={{ padding: '8px 10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {words.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }}>
              <input type="checkbox" checked={removeFillers} style={{ accentColor: '#c8ff00', marginTop: 2 }}
                onChange={e => { setRemoveFillersState(e.target.checked); removeFillersRef.current = e.target.checked; latestHandleSaveRef.current() }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>Remove pauses &amp; filler words</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
                  {fillerCutMs >= 500 ? `Removes about ${Math.round(fillerCutMs / 1000)} s. ` : 'Nothing much to remove. '}Applied when you export.
                </span>
              </span>
            </label>
          )}
          {outputUrl && clipStatus === 'done' ? (
            <>
              <a href={`/api/clips/${clip.id}/download`} download style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 0', borderRadius: 10, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
                <svg width="13" height="13" viewBox="0 0 15 15" fill="none"><path d="M7.5 2v8M4 7l3.5 3.5L11 7M2 13h11" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Download
              </a>
              <button onClick={() => handleExport(false)} disabled={exporting} style={{ padding: '8px 0', borderRadius: 8, background: 'rgba(200,255,0,0.1)', color: '#c8ff00', fontSize: 11, fontWeight: 600, border: '1px solid rgba(200,255,0,0.2)', cursor: 'pointer', opacity: exporting ? 0.5 : 1 }}>{exporting ? 'Queuing…' : 'Re-render'}</button>
              <button onClick={handleReEdit} style={{ padding: '8px 0', borderRadius: 8, background: 'rgba(124,58,237,0.1)', color: '#a78bfa', fontSize: 11, fontWeight: 600, border: '1px solid rgba(124,58,237,0.2)', cursor: 'pointer' }}>Re-edit</button>
            </>
          ) : clipStatus !== 'rendering' && !exporting ? (
            <button onClick={() => handleExport()} style={{ padding: '11px 0', borderRadius: 10, background: '#c8ff00', color: '#000', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer' }}>Process video</button>
          ) : clipStatus === 'rendering' ? (
            <button onClick={cancelExport} disabled={cancelling} style={{ fontSize: 11, padding: '8px 0', borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}>{cancelling ? 'Stopping…' : 'Cancel export'}</button>
          ) : null}
        </div>
      </div>

      {/* Crop positions */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.5, textTransform: 'uppercase' as const }}>Crop Positions</span>
          {segments.length > 1 && (
            <button onClick={askResetPositions}
              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 5, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}>Reset</button>
          )}
        </div>
        {segments.filter(s => s.end_ms - s.start_ms > 50).map((seg, i) => {
          const col = SEG_COLORS[i % SEG_COLORS.length]
          const isActive = seg.id === activeSegment?.id
          return (
            <div key={seg.id} onClick={() => { setActiveSegmentId(seg.id); seekToMs(seg.start_ms) }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', marginBottom: 2, background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent' }}>
              <div style={{ width: 6, height: 6, borderRadius: 3, background: col, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums', flex: 1 }}>{msToLabel(seg.start_ms)}–{msToLabel(seg.end_ms)}</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'capitalize' as const }}>{seg.layout}</span>
              {segments.length > 1 && <button onClick={e => { e.stopPropagation(); askDeleteSegment(seg.id) }} style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(239,68,68,0.1)', borderRadius: 4, border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 12 }}>×</button>}
            </div>
          )
        })}
      </div>

      {/* Auto-captions */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {isFreePlan ? (
          <div style={{ margin: '10px 12px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '14px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)', textAlign: 'center' }}>
            <span style={{ fontSize: 20 }}>🔒</span>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>Auto-captions</p>
            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Available on Starter and above</p>
            <a href="/pricing" style={{ marginTop: 4, padding: '7px 16px', borderRadius: 8, background: '#c8ff00', color: '#000', fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>Upgrade Plan →</a>
          </div>
        ) : (
          <>
            <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: showCaptions ? '#fff' : 'rgba(255,255,255,0.45)' }}>Auto-captions</span>
              {/* Regenerate captions (was a link in the panel below until 2026-11-06, user) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* (while it runs: Stop in its place — the request stops, the words stay as they were) */}
              {retranscribing ? (
                <button type="button" onClick={stopRegenerate} aria-label="Stop making captions" title="Stop"
                  style={{ width: 25, height: 25, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171' }}>
                  <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="2" fill="currentColor" /></svg>
                </button>
              ) : words.length > 0 && (
                <button type="button" onClick={askRegenerate} disabled={transcribing} aria-label="Regenerate captions" title="Regenerate captions"
                  style={{ width: 25, height: 25, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'transparent', border: 0, color: 'rgba(255,255,255,0.7)', opacity: transcribing ? 0.5 : 1 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" /></svg>
                </button>
              )}
              <div onClick={() => turnCaptions(!showCaptions)} style={{ width: 36, height: 20, borderRadius: 10, display: 'flex', alignItems: 'center', paddingLeft: 2, cursor: 'pointer', background: showCaptions ? '#c8ff00' : 'rgba(255,255,255,0.1)', transition: 'background 0.2s' }}>
                <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', transition: 'transform 0.2s', transform: showCaptions ? 'translateX(16px)' : 'translateX(0)' }} />
              </div>
              </div>
            </div>
            {(transcribing || retranscribing) && (
              <div style={{ margin: '0 12px 10px', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'rgba(200,255,0,0.08)', borderRadius: 8, border: '1px solid rgba(200,255,0,0.2)' }}>
                <span style={{ width: 12, height: 12, borderRadius: 6, border: '2px solid #c8ff00', borderTopColor: 'transparent', display: 'block', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                <p style={{ fontSize: 11, color: '#c8ff00', fontWeight: 600 }}>Generating captions…</p>
              </div>
            )}
            {showCaptions && (
              <div style={{ padding: '0 12px 10px' }}>
                <CaptionStyler
                  style={captionStyle} textCase={captionTextCase}
                  onChange={updateCaptionStyle} onTextCaseChange={setCaptionTextCase}
                  onEditCaptions={() => {}} onRetranscribe={l => handleRetranscribe(l, lastFreshRef.current)}
                  retranscribing={retranscribing} retranscribeElapsed={retranscribeElapsed} retranscribePlace={retranscribePlace} retranscribeError={retranscribeError}
                  hasWords={words.length > 0} hasRoman={hasRoman} romanize={romanize} romanizeLabel={scriptLabel} onRomanizeChange={setRomanize}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Filters */}
      <div style={{ padding: '10px 12px 12px' }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: 0.5, textTransform: 'uppercase' as const, marginBottom: 8 }}>Filters</p>
        <FilterPanel values={filters} onChange={setFilters} />
      </div>
    </div>
  )

  // Captions being made: a scan over the video (CaptionScan)
  const captionScan = transcribing || retranscribing ? (retranscribePlace ? 'Waiting its turn…' : 'Making captions…') : null

  // Video preview without touch overlay — used in landscape so the column can scroll
  const videoPreviewNoTouch = (
    <div ref={previewInnerRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <VideoPreview
        videoRef={videoRef} videoUrl={clipVideoUrl} currentTimeMs={currentTimeMs}
        activeSegment={activeSegment ?? null} getPositionAt={getPositionAt}
        activeBoxId={activeBoxId ?? null}
        onSelectBox={(segId, boxId) => { setActiveSegmentId(segId); setActiveBoxId(boxId) }}
        onBoxChange={moveView}
        captionScan={captionScan}
      />
      {activeSegment?.crop_boxes[0]?.source_video_id && (
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 20, background: 'rgba(249,115,22,0.85)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, pointerEvents: 'none' }}>B-roll</div>
      )}
    </div>
  )

  // Video preview with touch crop overlay — used in portrait
  const videoPreviewWithTouch = (
    <div ref={previewInnerRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <VideoPreview
        videoRef={videoRef} videoUrl={clipVideoUrl} currentTimeMs={currentTimeMs}
        activeSegment={activeSegment ?? null} getPositionAt={getPositionAt}
        activeBoxId={activeBoxId ?? null}
        onSelectBox={(segId, boxId) => { setActiveSegmentId(segId); setActiveBoxId(boxId) }}
        onBoxChange={moveView}
        captionScan={captionScan}
      />
      <div style={{ position: 'absolute', inset: 0, zIndex: 10, touchAction: 'none' }}
        onTouchStart={onCropTouchStart} onTouchMove={onCropTouchMove} onTouchEnd={onCropTouchEnd}
      />
      {activeSegment?.crop_boxes[0]?.source_video_id && (
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 20, background: 'rgba(249,115,22,0.85)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, pointerEvents: 'none' }}>B-roll</div>
      )}
    </div>
  )

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#0d0d0d', overflow: 'hidden' }}>
      {confirmDialog}
      {headerJSX}

      {/* ══ LANDSCAPE: exactly like the desktop — video left, sidebar right ══ */}
      <div className="chai-landscape" style={{ flex: 1, minHeight: 0, flexDirection: 'row', overflow: 'hidden' }}>

          {/* Left — scrollable column, video fills viewport height (desktop pattern) */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#0d0d0d', overflowY: 'auto', overflowX: 'hidden' }}>
            {/* Video — fixed height = full viewport minus header, exactly like desktop calc(100vh - 44px) */}
            <div style={{ flexShrink: 0, height: 'calc(100dvh - 44px)', position: 'relative', overflow: 'hidden', background: '#1a1a2e' }}>
              <div style={{ position: 'absolute', inset: 6, borderRadius: 16, border: '1.5px solid rgba(255,255,255,0.15)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {videoPreviewNoTouch}
              </div>
            </div>
            {/* Playback + timeline below the fold, scroll down to reach (same as desktop) */}
            {playbackJSX(true)}
            <div style={{ flexShrink: 0, background: '#0d0d0d', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '4px 8px' }}>
              <SegmentTimeline
                segments={segments} clipStartMs={clip.start_ms} clipEndMs={clip.end_ms}
                currentTimeMs={currentTimeMs} activeSegmentId={activeSegmentId ?? null}
                onSeek={seekToMs} onSelectSegment={setActiveSegmentId}
                onUpdateSegment={(id, u) => updateSegment(id, u)}
                onInsertBrollAfter={handleInsertBrollAfterSeg}
              />
            </div>
          </div>

          {/* Right — desktop-style sidebar */}
          {sidebarJSX}
        </div>

      {/* ══ PORTRAIT: source video top, tab-based controls below ══ */}
      <div className="chai-portrait" style={{ flex: 1, minHeight: 0, flexDirection: 'column', overflow: 'hidden' }}>

          {/* Source video — touch crop overlay active in portrait */}
          <div style={{ flexShrink: 0, height: 'calc(40dvh)', background: '#1a1a2e', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 6, borderRadius: 14, border: '1.5px solid rgba(255,255,255,0.15)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {videoPreviewWithTouch}
            </div>
          </div>

          {playbackJSX(false)}

          {/* Tab bar */}
          <div style={{ flexShrink: 0, height: 52, display: 'flex', alignItems: 'stretch', overflowX: 'auto', overflowY: 'hidden', background: '#0d0d0d', borderBottom: '1px solid rgba(255,255,255,0.07)', scrollbarWidth: 'none' }}>
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{ flexShrink: 0, minWidth: 68, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', borderBottom: activeTab === tab.id ? '2px solid #c8ff00' : '2px solid transparent', paddingTop: 2 }}>
                <span style={{ fontSize: 15, lineHeight: 1, color: activeTab === tab.id ? '#c8ff00' : 'rgba(255,255,255,0.4)' }}>{tab.icon}</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: activeTab === tab.id ? '#fff' : 'rgba(255,255,255,0.35)', letterSpacing: 0.2 }}>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Active tab panels */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>

            {activeTab === 'timeline' && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '10px 12px', display: 'flex', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <button onClick={handleCut} style={{ flex: 1, padding: '10px 0', borderRadius: 10, background: 'rgba(200,255,0,0.12)', color: '#c8ff00', fontSize: 13, fontWeight: 600, border: '1px solid rgba(200,255,0,0.25)', cursor: 'pointer' }}>✂ Cut here</button>
                  {segments.length > 1 && (
                    <button onClick={askResetPositions}
                      style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: 13, fontWeight: 600, border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}>Reset</button>
                  )}
                </div>
                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {segments.filter(s => s.end_ms - s.start_ms > 50).map((seg, i) => {
                    const col = SEG_COLORS[i % SEG_COLORS.length]
                    const isActive = seg.id === activeSegment?.id
                    return (
                      <div key={seg.id} onClick={() => { setActiveSegmentId(seg.id); seekToMs(seg.start_ms) }}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', background: isActive ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.02)', border: isActive ? `1px solid ${col}33` : '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ width: 8, height: 8, borderRadius: 4, background: col, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums' }}>{msToLabel(seg.start_ms)} — {msToLabel(seg.end_ms)}</span>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textTransform: 'capitalize' }}>{seg.layout}</span>
                        <div style={{ flex: 1 }} />
                        {segments.length > 1 && <button onClick={e => { e.stopPropagation(); askDeleteSegment(seg.id) }} style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(239,68,68,0.1)', borderRadius: 7, border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 14 }}>×</button>}
                      </div>
                    )
                  })}
                </div>
                <div style={{ padding: '0 12px 12px', overflowX: 'auto' }}>
                  <SegmentTimeline
                    segments={segments} clipStartMs={clip.start_ms} clipEndMs={clip.end_ms}
                    currentTimeMs={currentTimeMs} activeSegmentId={activeSegmentId ?? null}
                    onSeek={seekToMs} onSelectSegment={setActiveSegmentId}
                    onUpdateSegment={(id, u) => updateSegment(id, u)}
                    onInsertBrollAfter={handleInsertBrollAfterSeg}
                  />
                </div>
              </div>
            )}

            {activeTab === 'crop' && (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>Drag the crop box in the video above, or use sliders:</p>
                {!activeBox ? (
                  <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>Tap a segment to edit its crop</p>
                ) : (
                  <>
                    {[
                      { key: 'x' as const, label: 'Left (X)' },
                      { key: 'w' as const, label: 'Width (W)' },
                      { key: 'y' as const, label: 'Top (Y)' },
                      { key: 'h' as const, label: 'Height (H)' },
                    ].map(({ key, label }) => (
                      <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{label}</span>
                          <span style={{ fontSize: 12, color: '#c8ff00', fontVariantNumeric: 'tabular-nums' }}>{Math.round(cropPos[key] * 100)}%</span>
                        </div>
                        <input type="range" min={0} max={100} value={Math.round(cropPos[key] * 100)}
                          onChange={e => handleCropChange(key, +e.target.value / 100)}
                          style={{ width: '100%', accentColor: '#c8ff00' }} />
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {activeTab === 'captions' && (
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {isFreePlan ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '32px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', textAlign: 'center' }}>
                    <span style={{ fontSize: 36 }}>🔒</span>
                    <p style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Auto-captions</p>
                    <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', maxWidth: 220 }}>Auto-captions are available on Starter and above.</p>
                    <a href="/pricing" style={{ padding: '11px 24px', borderRadius: 12, background: '#c8ff00', color: '#000', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>Upgrade Plan →</a>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: showCaptions ? '#fff' : 'rgba(255,255,255,0.45)' }}>Auto-captions</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {/* (while it runs: Stop in its place — the request stops, the words stay as they were) */}
                      {retranscribing ? (
                <button type="button" onClick={stopRegenerate} aria-label="Stop making captions" title="Stop"
                  style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171' }}>
                  <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="2" fill="currentColor" /></svg>
                </button>
                      ) : words.length > 0 && (
                <button type="button" onClick={askRegenerate} disabled={transcribing} aria-label="Regenerate captions" title="Regenerate captions"
                  style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'transparent', border: 0, color: 'rgba(255,255,255,0.7)', opacity: transcribing ? 0.5 : 1 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" /></svg>
                </button>
              )}
                      <div onClick={() => turnCaptions(!showCaptions)} style={{ width: 44, height: 24, borderRadius: 12, display: 'flex', alignItems: 'center', paddingLeft: 2, cursor: 'pointer', background: showCaptions ? '#c8ff00' : 'rgba(255,255,255,0.12)', transition: 'background 0.2s' }}>
                        <div style={{ width: 20, height: 20, borderRadius: 10, background: '#fff', transition: 'transform 0.2s', transform: showCaptions ? 'translateX(20px)' : 'translateX(0)' }} />
                      </div>
                      </div>
                    </div>
                    {(transcribing || retranscribing) ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(200,255,0,0.08)', borderRadius: 10, border: '1px solid rgba(200,255,0,0.2)' }}>
                        <span style={{ width: 16, height: 16, borderRadius: 8, border: '2px solid #c8ff00', borderTopColor: 'transparent', display: 'block', animation: 'spin 0.8s linear infinite' }} />
                        <p style={{ fontSize: 12, color: '#c8ff00', fontWeight: 600 }}>Generating captions…</p>
                      </div>
                    ) : words.length > 0 ? (
                      <div style={{ padding: '8px 14px', background: 'rgba(34,197,94,0.07)', borderRadius: 10, border: '1px solid rgba(34,197,94,0.15)' }}>
                        <p style={{ fontSize: 12, color: '#4ade80', fontWeight: 600 }}>✓ Captions ready · {words.length} words</p>
                      </div>
                    ) : null}
                    {showCaptions && (
                      <CaptionStyler
                        style={captionStyle} textCase={captionTextCase}
                        onChange={updateCaptionStyle} onTextCaseChange={setCaptionTextCase}
                        onEditCaptions={() => {}} onRetranscribe={l => handleRetranscribe(l, lastFreshRef.current)}
                        retranscribing={retranscribing} retranscribeElapsed={retranscribeElapsed} retranscribePlace={retranscribePlace} retranscribeError={retranscribeError}
                        hasWords={words.length > 0} hasRoman={hasRoman} romanize={romanize} romanizeLabel={scriptLabel} onRomanizeChange={setRomanize}
                      />
                    )}
                    {showCaptions && words.length > 0 && (
                      <TranscriptPanel words={displayWords} clipStartMs={clip.start_ms} clipEndMs={clip.end_ms}
                        currentTimeMs={currentTimeMs} onSeek={seekToMs}
                        onWordChange={changeWord} />
                    )}
                  </>
                )}
              </div>
            )}

            {activeTab === 'text' && (
              <div style={{ padding: 12 }}>
                <TextOverlayPanel overlays={textOverlays} currentTimeMs={currentTimeMs} clipDurationMs={clip.end_ms - clip.start_ms}
                  onAdd={o => setTextOverlays(prev => [...prev, { ...o, id: crypto.randomUUID(), clip_id: clip.id }])}
                  onUpdate={updateTextOverlay} onRemove={askDeleteTextOverlay} />
              </div>
            )}

            {activeTab === 'audio' && (
              <div style={{ padding: 12 }}>
                <AudioMixerPanel tracks={audioTracks}
                  onAddTrack={addMusic} uploads={musicUploads} notice={musicNotice}
                  missing={t => !t.storage_path.startsWith('audio/') && !t.storage_path.startsWith('main-video:') && !musicUploads[t.id]}
                  onReadd={(id, f) => addMusic(f, id)}
                  onRemoveTrack={askRemoveTrack}
                  onUpdateTrack={(id, u) => setAudioTracks(prev => prev.map(t => t.id === id ? { ...t, ...u } : t))} />
              </div>
            )}

            {activeTab === 'filters' && (
              <div style={{ padding: 12 }}>
                <FilterPanel values={filters} onChange={setFilters} />
              </div>
            )}

            {activeTab === 'export' && (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {(clipStatus === 'rendering' || exporting) ? (
                    <div style={{ aspectRatio: '9/16', background: '#0d0d0d', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                      <span style={{ width: 40, height: 40, borderRadius: 20, border: '2px solid #c8ff00', borderTopColor: 'transparent', display: 'block', animation: 'spin 1s linear infinite' }} />
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Processing video…</p>
                      {renderElapsed > 0 && <p style={{ fontSize: 12, color: 'rgba(200,255,0,0.7)', fontVariantNumeric: 'tabular-nums' }}>{Math.floor(renderElapsed / 60)}m {renderElapsed % 60}s</p>}
                      {clipStatus === 'rendering' && <button onClick={cancelExport} disabled={cancelling} style={{ fontSize: 12, padding: '8px 16px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', cursor: 'pointer' }}>{cancelling ? 'Stopping…' : 'Cancel export'}</button>}
                    </div>
                  ) : (
                    <OutputCanvas watermark={showWatermark}
                      videoRef={videoRef} currentTimeMs={currentTimeMs} clipStartMs={clip.start_ms} clock={mobileInserts.length ? liveTime.get : undefined}
                      activeSegment={playingSegment} getPositionAt={getPositionAt}
                      skipTransitionRef={skipCanvasTransitionRef}
                      words={displayWords} captionStyle={captionStyle} captionTextCase={captionTextCase} showCaptions={showCaptions}
                      overlays={overlays} activeOverlayId={activeOverlayId}
                      onOverlayChange={updateOverlay} onSelectOverlay={setActiveOverlayId} onDeleteOverlay={askDeleteOverlay}
                      textOverlays={textOverlays} activeTextOverlayId={activeTextOverlayId}
                      onTextOverlayChange={updateTextOverlay} onSelectTextOverlay={setActiveTextOverlayId} onDeleteTextOverlay={askDeleteTextOverlay}
                      onCaptionPositionChange={(y, x) => updateCaptionStyle({ position_y: y, position_x: x })}
                      onCaptionTap={() => setActiveTab('captions')}
                      style={{ width: '100%', height: 'auto', display: 'block' }}
                    />
                  )}
                </div>
                {outputUrl && clipStatus === 'done' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <a href={`/api/clips/${clip.id}/download`} download style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px 0', borderRadius: 12, background: '#c8ff00', color: '#000', fontSize: 15, fontWeight: 700, textDecoration: 'none' }}>
                      <svg width="16" height="16" viewBox="0 0 15 15" fill="none"><path d="M7.5 2v8M4 7l3.5 3.5L11 7M2 13h11" stroke="black" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Download
                    </a>
                    <button onClick={() => handleExport(false)} disabled={exporting} style={{ padding: '12px 0', borderRadius: 10, background: 'rgba(200,255,0,0.1)', color: '#c8ff00', fontSize: 13, fontWeight: 600, border: '1px solid rgba(200,255,0,0.2)', cursor: 'pointer', opacity: exporting ? 0.5 : 1 }}>{exporting ? 'Queuing…' : 'Re-render'}</button>
                    <button onClick={handleReEdit} style={{ padding: '12px 0', borderRadius: 10, background: 'rgba(124,58,237,0.1)', color: '#a78bfa', fontSize: 13, fontWeight: 600, border: '1px solid rgba(124,58,237,0.2)', cursor: 'pointer' }}>Re-edit</button>
                  </div>
                ) : clipStatus !== 'rendering' && !exporting ? (
                  <button onClick={() => handleExport()} style={{ padding: '16px 0', borderRadius: 12, background: '#c8ff00', color: '#000', fontSize: 15, fontWeight: 700, border: 'none', cursor: 'pointer' }}>Process video</button>
                ) : null}
              </div>
            )}

          </div>
        </div>

      <style>{`
        .chai-landscape { display: none; }
        .chai-portrait  { display: flex; }
        @media (orientation: landscape) {
          .chai-landscape { display: flex; }
          .chai-portrait  { display: none; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
