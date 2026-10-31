'use client'

// The brand on the clip board: a tag per clip, "Put on all" (brand kit Phase 2: components/brand/ClipBoardBrand.tsx)
import { useClipBrands, BrandAllBar, BrandTag } from '@/components/brand/ClipBoardBrand'
import { preloadMascot } from '@/components/ui/mascot'
import { InfoTip } from '@/components/ui/info-tip'
import { inLineText } from '@/lib/inLine'
import { useFrameAt } from '@/modules/clips/thumbs'
import { ScrubPlayer } from '@/components/clips/ScrubPlayer'
import { useLocalVideo } from '@/modules/clips/localVideo'
import { usePolling } from '@/lib/usePolling'
import { useState, useRef, useEffect, useCallback, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { AccountMenu } from '@/components/ui/account-menu'
import ThemeSwitch from '@/components/ui/cinematic-theme-switcher'
import { openBrandKits } from '@/components/brand/brandKitsEvents'
import { BrandLoader, BrandLoaderScreen } from '@/components/ui/brand-loader'
import { ClipPlayer } from '@/components/clips/ClipPlayer'
import type { ClipPreviewData } from '@/server/services/clipPreview'
import type { SegmentLocal } from '@chai-cut/shared'
import { defaultCropForSlot, makeBox } from '@/modules/editor/utils'

interface VideoData {
  id: string
  title?: string | null
  status: string
  download_progress: number
  duration_ms: number | null
  created_at: string
}

interface SavedClip {
  id: string
  title: string | null
  start_ms: number
  end_ms: number
  status: string
  output_url: string | null
  layout: string | null
  created_at: string
  index: number
  origin: ClipOrigin
  /** The heart on its card */
  favorite?: boolean
  /** Why AI picked it (Make my clips), shown on its card */
  reason?: string | null
}

/** Where a clip came from, so the clip list can be split into sections */
export type ClipOrigin = 'yours' | 'ask' | 'auto' | 'best'
type ClipTab = 'all' | ClipOrigin | 'fav' | 'edited'
/** Typed one after another as the Ask AI hint */
const ASK_EXAMPLES = ['funny reactions', 'controversial takes', 'emotional moments', 'big announcements', 'best advice']
const CLIP_TABS: Array<{ id: ClipTab; label: string; empty: string }> = [
  { id: 'all', label: 'All clips', empty: '' },
  { id: 'yours', label: 'Your clips', empty: 'Clips you make yourself (New clip) show here.' },
  { id: 'ask', label: 'Ask AI', empty: 'Describe what you want in Ask AI, then press Use on a result.' },
  { id: 'auto', label: 'Make my clips', empty: 'Clips AI makes for you with Make my clips show here.' },
  { id: 'best', label: 'Best moments', empty: 'Find best moments, then press + on the ones you want.' },
  { id: 'edited', label: 'Edited clips', empty: 'Clips you open in the editor show here.' },
  { id: 'fav', label: 'Favorites', empty: 'Tap the heart on a clip to keep it here.' },
]
/** Ask AI: one-tap searches */
const ASK_CHIPS = ['emotional', 'funny', 'aesthetic', 'action']
const ORIGIN_BADGE: Record<ClipOrigin, { label: string; color: string }> = {
  yours: { label: 'Yours', color: 'rgb(var(--cb-fg) / 0.6)' },
  ask: { label: 'Ask AI', color: '#38bdf8' },
  auto: { label: 'Make my clips', color: '#c8ff00' },
  best: { label: 'Best moments', color: '#fbbf24' },
}

interface Suggestion {
  id: string
  subscores?: Record<string, number>
  title: string
  start_ms: number
  end_ms: number
  summary: string
  /** Viral score 0–99, missing on the plain fallback chunks */
  score?: number
  reason?: string
  /** Best moments: the draft clip it was saved as */
  clip_id?: string
}

// 'confirm': the run found fewer good moments (found_count) than clips asked for and waits for a yes
interface AutoJob { id: string; status: 'queued' | 'running' | 'done' | 'failed' | 'confirm'; progress: number; error: string | null; clip_count: number; found_count?: number }
interface AutoClip {
  id: string; title: string | null; start_ms: number; end_ms: number; status: string
  output_url: string | null; ai_score: number | null; ai_reason: string | null
  post_caption: string | null; hashtags: string[] | null
}
// Ask AI answers and the Best moments list are kept in this browser per video, so asking the
// same thing again shows them straight away instead of sending a new AI request
const SAVED_DAYS = 7
const MAX_SAVED_SEARCHES = 20
function readSaved<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { at, data } = JSON.parse(raw) as { at: number; data: T }
    if (Date.now() - at > SAVED_DAYS * 864e5) { localStorage.removeItem(key); return null }
    return data
  } catch { return null }   // storage blocked or bad data: just ask again
}
function writeSaved(key: string, data: unknown) {
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })) } catch { /* storage blocked or full */ }
}
const searchKey = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ')

// Make my clips: what AI adds to each clip (all on by default; remembered per browser)
type AutoOption = 'captions' | 'title' | 'motion' | 'layouts'
const AUTO_OPTIONS: Array<{ id: AutoOption; label: string; tip: string }> = [
  { id: 'captions', label: 'Captions', tip: 'Word-by-word captions at the bottom' },
  { id: 'title', label: 'Title', tip: 'A short hook as a title over the first 3 seconds' },
  { id: 'motion', label: 'Follow people', tip: 'The frame follows people as they move. Off: it holds still in each shot' },
  { id: 'layouts', label: 'Split screen', tip: 'Split and trio when 2 or more people are in the shot. Off: always vertical, on one person' },
]
// Each option's little picture (a 16 × 16 drawing): what it does, in one glance. The marked parts
// (mmc-i-*) move when the tile is hovered or just ticked (styles: .mmc-opt in globals.css).
const AUTO_ICONS: Record<AutoOption, React.ReactNode> = {
  // two lines of words, the one being spoken lit up
  captions: <><path d="M2 5.5h7M11 5.5h3M2 10.5h3" /><path className="mmc-i-word" d="M7 10.5h7" strokeWidth="2.8" /></>,
  // a headline letter over a line of text
  title: <><path className="mmc-i-head" d="M4 3.5h8M8 3.5v6.5" strokeWidth="2.2" /><path d="M4.5 13h7" opacity=".55" /></>,
  // a viewfinder keeping up with someone
  motion: <><path className="mmc-i-frame" d="M2 5V3.5A1.5 1.5 0 0 1 3.5 2H5M11 2h1.5A1.5 1.5 0 0 1 14 3.5V5M14 11v1.5a1.5 1.5 0 0 1-1.5 1.5H11M5 14H3.5A1.5 1.5 0 0 1 2 12.5V11" /><circle className="mmc-i-dot" cx="8" cy="8" r="2" fill="currentColor" stroke="none" /></>,
  // a vertical frame cut in two
  layouts: <><rect x="3.5" y="2" width="9" height="12" rx="2" /><path className="mmc-i-cut" d="M3.5 8h9" /></>,
}
const AUTO_OPTIONS_KEY = 'clipboard.makeOptions'
// What the captions and the title are written in (speech in an Indian language; English speech stays English)
type CaptionLanguage = 'native' | 'roman'
type TitleLanguage = 'roman' | 'english' | 'native'
// (each choice shows the same word written that way: an example says it faster than a name)
const CAPTION_LANGUAGES: Array<{ id: CaptionLanguage; label: string }> = [
  { id: 'native', label: 'Native letters · నమస్తే, नमस्ते' },
  { id: 'roman', label: 'English letters · Namaste' },
]
const TITLE_LANGUAGES: Array<{ id: TitleLanguage; label: string }> = [
  { id: 'roman', label: 'English letters · Namaste' },
  { id: 'english', label: 'English · Hello' },
  { id: 'native', label: 'Native letters · నమస్తే, नमस्ते' },
]
const AUTO_LANGUAGE_KEY = 'clipboard.makeLanguages'

// Make my clips: how many clips one run can make (the server allows 1 to 10)
const AUTO_MAX = 10

interface Props {
  video: VideoData
  videoUrl: string
  /** The file's storage path: the whole video is downloaded once and kept under it (modules/clips/localVideo.ts) */
  videoKey?: string | null
  /** The video has no editing copy yet: ask the worker for one (page.tsx) */
  needsProxy?: boolean
  /** Picked on the dashboard: AI edit or manual edit — that part of the clip board is pointed at on arrival */
  startWith?: 'ai' | 'manual'
  savedClips: SavedClip[]
}

const ACCENT = '#c8ff00'
// Card look shared by the AI tools and the new-clip bar
const CARD: React.CSSProperties = { background: 'rgb(var(--cb-fg) / 0.03)', border: '1px solid rgb(var(--cb-fg) / 0.08)' }
const PANEL_BG = '#000'
const PANEL_LINE = '1px solid rgb(var(--cb-fg) / 0.07)'

// Wide screens get three columns (AI tools · video · clips); narrower ones stack the AI tools under the video
const WIDE_QUERY = '(min-width: 1280px)'
function useWide() {
  return useSyncExternalStore(
    cb => { const mq = window.matchMedia(WIDE_QUERY); mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb) },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  )
}

// ── helpers ────────────────────────────────────────────────────────────────────

function parseTime(str: string): number | null {
  const parts = str.trim().split(':').map(Number)
  if (parts.some(isNaN) || parts.length === 0) return null
  if (parts.length === 1) return parts[0] * 1000
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000
  return null
}

function msToDisplay(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

function durLabel(startMs: number, endMs: number): string {
  const totalSec = Math.floor((endMs - startMs) / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m > 0 && s > 0) return `${m}m ${s}s`
  if (m > 0) return `${m}m`
  return `${s}s`
}

const stageLabel = (pct: number) =>
  pct < 5  ? 'Queued…' :
  pct < 30 ? `Downloading ${pct}%` :
  pct < 56 ? `Processing ${pct}%` :
  pct < 62 ? 'Extracting audio…' :
  pct < 99 ? `Transcribing ${pct}%` : 'Finishing…'

// ── main component ─────────────────────────────────────────────────────────────

export function ClipPickerShell({ video: initialVideo, videoUrl: signedUrl, videoKey, needsProxy, startWith, savedClips }: Props) {
  // (the loader shown when a clip is opened has the mascot: its picture is fetched now)
  preloadMascot()
  // The whole video is downloaded once (modules/clips/localVideo.ts), then the player and the clip
  // previews play it from the computer: no waiting on the network when playing from or dragging
  // to any moment. Until it is all here, the link streams as before. (The thumbnails keep the
  // link: their frames are already grabbed, and switching would grab them all again.)
  const playUrl = useLocalVideo(signedUrl, videoKey)
  const videoUrl = signedUrl
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)

  const [video, setVideo] = useState(initialVideo)
  const [nowMs, setNowMs] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formStart, setFormStart] = useState('')
  const [formEnd, setFormEnd] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [clipError, setClipError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [momentsNote, setMomentsNote] = useState<string | null>(null)
  const [momentsAdded, setMomentsAdded] = useState<string | null>(null)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null)
  const [aiCriteria, setAiCriteria] = useState('')
  // Click counters that replay the AI buttons' animations (styles: .ai-btn in globals.css)
  const [makePulse, setMakePulse] = useState(0)
  const [findPulse, setFindPulse] = useState(0)
  const [bestPulse, setBestPulse] = useState(0)
  // Typing hint in the Ask AI box: whenever it's empty, example searches are typed out letter by
  // letter (left → right), held for a moment, erased, and the next one typed — on a loop
  const [typedHint, setTypedHint] = useState('')
  useEffect(() => {
    if (aiCriteria) { setTypedHint(''); return }
    let i = 0, n = 0, erasing = false
    let t: ReturnType<typeof setTimeout>
    const tick = () => {
      const full = `e.g. ${ASK_EXAMPLES[i]}`
      if (!erasing) {
        n++
        setTypedHint(full.slice(0, n))
        if (n >= full.length) { erasing = true; t = setTimeout(tick, 1600); return }
        t = setTimeout(tick, 55)
      } else {
        n--
        setTypedHint(full.slice(0, n))
        if (n <= 0) { erasing = false; i = (i + 1) % ASK_EXAMPLES.length; t = setTimeout(tick, 350); return }
        t = setTimeout(tick, 22)
      }
    }
    t = setTimeout(tick, 250)
    return () => clearTimeout(t)
  }, [aiCriteria])
  const [aiSuggestions, setAiSuggestions] = useState<Suggestion[] | null>(null)
  // Earlier Ask AI answers by search (newest last), and which search the shown saved answer is for
  const [askSaved, setAskSaved] = useState<Record<string, Suggestion[]>>({})
  const [askFrom, setAskFrom] = useState<string | null>(null)
  const askKey = `clipboard.ask.${video.id}`, bestKey = `clipboard.best.${video.id}`
  useEffect(() => {
    setAskSaved(readSaved<Record<string, Suggestion[]>>(askKey) ?? {})
    const best = readSaved<Suggestion[]>(bestKey)
    if (best) setSuggestions(prev => prev ?? best)
  }, [askKey, bestKey])
  // The Best moments list is saved whenever it changes (found, View more, or a moment added)
  useEffect(() => { if (suggestions) writeSaved(bestKey, suggestions) }, [suggestions, bestKey])
  const [loadingAi, setLoadingAi] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  // "Make my clips": the AI Edit job for this video and the clips it made
  const [autoCount, setAutoCount] = useState<number>(5)
  // What's typed in the count box (may be empty or too big while typing; settles on blur)
  const [countText, setCountText] = useState('5')
  const [autoOpts, setAutoOpts] = useState<Record<AutoOption, boolean>>({ captions: true, title: true, motion: true, layouts: true })
  // What the captions and the title are written in (remembered per browser, like the checkboxes)
  // Make my clips: the brand kit its clips get ('default': the account's default kit; 'none'; or a kit's id)
  const [brandKits, setBrandKits] = useState<Array<{ id: string; name: string; isDefault: boolean }>>([])
  const [brandPick, setBrandPickState] = useState<string>('default')
  // (picked by the person: the list arriving later doesn't change it)
  const brandPicked = useRef(false)
  const setBrandPick = (v: string) => { brandPicked.current = true; setBrandPickState(v) }
  useEffect(() => {
    fetch('/api/brand-kits').then(r => (r.ok ? r.json() : null))
      .then((d: { kits?: Array<{ id: string; name: string; shared_by?: string | null; data?: { is_default?: boolean } }> } | null) => {
        if (!d?.kits) return
        setBrandKits(d.kits.map(k => ({ id: k.id, name: k.name, isDefault: !!k.data?.is_default })))
        // No kit marked as the default: start on the newest of the account's own kits, not on
        // "Default (none set)" — which puts no kit on (user, 2026-10-31: the kit didn't apply)
        const own = d.kits.filter(k => !k.shared_by)
        if (!brandPicked.current && !d.kits.some(k => k.data?.is_default) && own.length) setBrandPickState(own[own.length - 1].id)
      }).catch(() => { /* no kits shown */ })
  }, [])
  const [captionLang, setCaptionLang] = useState<CaptionLanguage>('native')
  const [titleLang, setTitleLang] = useState<TitleLanguage>('roman')
  function pickLanguage(next: { caption?: CaptionLanguage; title?: TitleLanguage }) {
    const caption = next.caption ?? captionLang, title = next.title ?? titleLang
    setCaptionLang(caption); setTitleLang(title)
    try { localStorage.setItem(AUTO_LANGUAGE_KEY, JSON.stringify({ caption, title })) } catch { /* storage blocked */ }
  }
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(AUTO_OPTIONS_KEY) ?? 'null') as Partial<Record<AutoOption, boolean>> | null
      if (saved) setAutoOpts(o => ({ ...o, ...saved }))
      const lang = JSON.parse(localStorage.getItem(AUTO_LANGUAGE_KEY) ?? 'null') as { caption?: string; title?: string } | null
      if (CAPTION_LANGUAGES.some(l => l.id === lang?.caption)) setCaptionLang(lang!.caption as CaptionLanguage)
      if (TITLE_LANGUAGES.some(l => l.id === lang?.title)) setTitleLang(lang!.title as TitleLanguage)
    } catch { /* storage blocked */ }
  }, [])
  function toggleAutoOpt(id: AutoOption) {
    setAutoOpts(o => {
      const next = { ...o, [id]: !o[id] }
      try { localStorage.setItem(AUTO_OPTIONS_KEY, JSON.stringify(next)) } catch { /* storage blocked */ }
      return next
    })
  }
  /** "Turn them on" under Brand: Captions and Title on (remembered, as a click on their boxes) */
  function captionsAndTitleOn() {
    setAutoOpts(o => {
      const next = { ...o, captions: true, title: true }
      try { localStorage.setItem(AUTO_OPTIONS_KEY, JSON.stringify(next)) } catch { /* storage blocked */ }
      return next
    })
  }
  const countOver = Number(countText) > AUTO_MAX
  function setCount(n: number) {
    const c = Math.min(AUTO_MAX, Math.max(1, Math.round(n) || 1))
    setAutoCount(c)
    setCountText(String(c))
  }
  // B-roll in Make my clips: its option was taken off the card, so clips are made without it
  const autoBroll = false
  const [autoJob, setAutoJob] = useState<AutoJob | null>(null)
  const [autoClips, setAutoClips] = useState<AutoClip[]>([])
  const [autoStarting, setAutoStarting] = useState(false)
  const [autoError, setAutoError] = useState<string | null>(null)
  const [autoStopping, setAutoStopping] = useState(false)
  // The clip list (kept locally so deleted clips disappear at once; a refresh brings the server's copy)
  const [clips, setClips] = useState(savedClips)
  useEffect(() => { setClips(savedClips) }, [savedClips])
  // Download from Preview: an exported clip saves straight away; one AI only edited (Make my clips
  // saves edits, not files) is exported first and saves by itself once ready
  const [dlState, setDlState] = useState<Record<string, 'exporting' | { error: string }>>({})
  function saveFile(id: string) {
    const a = document.createElement('a')
    a.href = `/api/clips/${id}/download`
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  async function downloadClip(id: string) {
    const c = clips.find(x => x.id === id)
    if (c?.status === 'done' && c.output_url) { saveFile(id); return }
    setDlState(d => ({ ...d, [id]: 'exporting' }))
    if (c?.status !== 'rendering') {
      const res = await fetch('/api/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clip_id: id, quality: '1080p' }),
      }).catch(() => null)
      // 409: it's already exporting — just wait for it
      if (!res || (!res.ok && res.status !== 409)) {
        const error = res ? (await res.json().catch(() => ({}))).error ?? 'Could not export' : 'Could not export'
        setDlState(d => ({ ...d, [id]: { error } }))
        return
      }
    }
    setClips(cs => cs.map(x => x.id === id ? { ...x, status: 'rendering', output_url: null } : x))
  }
  // While a download waits on its export, check (usePolling's rhythm); save it the moment it's done
  // (a hidden tab saves it the moment it is shown again)
  const waitingDl = Object.keys(dlState).filter(id => dlState[id] === 'exporting').join(',')
  usePolling(() => Promise.all(waitingDl.split(',').map(id =>
    fetch(`/api/clips/${id}/status`).then(r => (r.ok ? r.json() : null)).then((d: { status: string; output_url: string | null } | null) => {
      if (!d) return
      if (d.status === 'done' && d.output_url) {
        setClips(cs => cs.map(x => x.id === id ? { ...x, status: 'done', output_url: d.output_url } : x))
        setDlState(s => { const n = { ...s }; delete n[id]; return n })
        saveFile(id)
      } else if (d.status === 'failed') {
        setClips(cs => cs.map(x => x.id === id ? { ...x, status: 'failed' } : x))
        setDlState(s => ({ ...s, [id]: { error: 'The export failed' } }))
      }
    }).catch(() => {}))), !!waitingDl)
  // Which section of the clip list is showing
  // Manual edit (picked on the dashboard): no AI tools, and only "Your clips" and "Favorites" in the list
  const manualOnly = startWith === 'manual'
  // The editor remembers which board it was opened from, so its "Clip board" link comes back to this one
  const editorHref = (id: string) => `/editor/${id}${startWith ? `?from=${startWith}` : ''}`
  const [clipTab, setClipTab] = useState<ClipTab>(manualOnly ? 'yours' : 'all')
  // The clipboard badge: Manual edit counts only the user's own clips, as that board lists only those
  // Clips on this board: Start with AI never lists the clips cut by hand (they belong to Pick my moments)
  // Numbered in the order they were made (Clip 1 is the first one, and keeps its number), listed newest first
  // (created_at comes from the database as a Date, from a new clip as text: compared as times)
  const madeAt = (c: { created_at: string | Date }) => new Date(c.created_at).getTime() || 0
  const byTime = [...clips].sort((a, b) => madeAt(a) - madeAt(b))
    .map((c, i) => (c.index === i + 1 ? c : { ...c, index: i + 1 }))
    .reverse()
  const boardClips = manualOnly ? byTime : byTime.filter(c => c.origin !== 'yours')
  const badgeCount = manualOnly ? byTime.filter(c => c.origin === 'yours').length : boardClips.length
  // Edited = opened in the editor at least once (the editor creates a clip's formats on first open)
  // (Manual edit lists only the user's own clips, so an AI-made clip never counts, even though it has formats)
  const isEdited = (c: { layout: string | null; origin: ClipOrigin }) => c.layout != null && (!manualOnly || c.origin === 'yours')
  // (brand kit Phase 2) each clip's kit, for its tag, and "Put on all"
  const brands = useClipBrands(initialVideo.id, boardClips.map(c => c.id))
  const shownClips = clipTab === 'all' ? boardClips : clipTab === 'fav' ? boardClips.filter(c => c.favorite) : clipTab === 'edited' ? byTime.filter(isEdited) : byTime.filter(c => c.origin === clipTab)
  // Clip preview plays 9:16 clips as edited: in Manual edit only the edited ones
  const previewable = manualOnly ? byTime.filter(isEdited) : boardClips
  // A clip to bring into view and flash in the list (e.g. the clip a Best moment was saved as)
  const [focusClipId, setFocusClipId] = useState<string | null>(null)
  function focusClip(id: string, origin: ClipOrigin | 'all') {
    setClipTab(origin)
    setSelected(new Set())
    setFocusClipId(id)
  }
  // Above the video: the source video, or a clip played in 9:16 as edited (no export needed)
  const [viewMode, setViewMode] = useState<'video' | 'preview'>('video')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Record<string, ClipPreviewData | { error: string } | 'loading'>>({})
  // An Ask AI / Best moments result shown in Preview before it's a clip (framed as a new clip would be)
  type MomentSource = 'best_moments' | 'clip_search'
  const [momentPreview, setMomentPreview] = useState<{ s: Suggestion; source: MomentSource } | null>(null)
  function previewClip(id: string) {
    videoRef.current?.pause()
    setViewMode('preview')
    setMomentPreview(null)
    setPreviewId(id)
    if (previews[id] && previews[id] !== 'loading' && !('error' in (previews[id] as object))) return
    setPreviews(p => ({ ...p, [id]: 'loading' }))
    fetch(`/api/clips/${id}/preview`)
      .then(async r => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? 'Could not load the preview'))))
      .then((d: ClipPreviewData) => setPreviews(p => ({ ...p, [id]: d })))
      .catch((e: unknown) => setPreviews(p => ({ ...p, [id]: { error: e instanceof Error ? e.message : 'Could not load the preview' } })))
  }
  // Click a clip: an edited one plays in Clip preview; one not edited yet shows in the source Video at its start
  function openClip(clip: { id: string; start_ms: number; layout: string | null; origin: ClipOrigin }) {
    if (manualOnly && !isEdited(clip)) {
      setMomentPreview(null)
      setPreviewId(null)
      setViewMode('video')
      seek(clip.start_ms)
    } else previewClip(clip.id)
  }
  function showPreviewMode() {
    setMomentPreview(null)
    const id = previewId && previewable.some(c => c.id === previewId) ? previewId : (shownClips.find(c => previewable.includes(c)) ?? previewable[0])?.id
    if (id) previewClip(id)
    else setViewMode('preview')
  }
  // A previewed clip that gets deleted: fall back to the video
  useEffect(() => {
    if (previewId && !clips.some(c => c.id === previewId)) { setPreviewId(null); setViewMode('video') }
  }, [clips, previewId])

  useEffect(() => {
    if (!focusClipId) return
    document.getElementById(`clip-${focusClipId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const t = setTimeout(() => setFocusClipId(null), 2500)
    return () => clearTimeout(t)
  }, [focusClipId, clipTab])
  // Select mode: tick several clips, then delete them together
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function toggleSelected(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function stopSelecting() {
    setSelecting(false); setSelected(new Set()); setConfirmDelete(false); setDeleteError(null)
  }
  useEffect(() => {
    if (!selecting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || deleting) return
      if (confirmDelete) setConfirmDelete(false); else stopSelecting()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selecting, confirmDelete, deleting])

  /** The heart: saved with the clip (put back if it couldn't be saved) */
  async function toggleFavorite(id: string) {
    const was = !!clips.find(c => c.id === id)?.favorite
    setClips(prev => prev.map(c => c.id === id ? { ...c, favorite: !was } : c))
    try {
      const res = await fetch(`/api/clips/${id}/favorite`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: !was }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not save the favourite')
    } catch (e) {
      setClips(prev => prev.map(c => c.id === id ? { ...c, favorite: was } : c))
      setClipError(e instanceof Error ? e.message : 'Could not save the favourite')
    }
  }
  /** One clip's ⋮ menu → Delete */
  async function deleteOne(id: string) {
    try {
      const res = await fetch('/api/clips', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Delete failed')
      setClips(prev => prev.filter(c => c.id !== id))
      if (previewId === id) { setPreviewId(null); setViewMode('video') }
      router.refresh()
    } catch (e) {
      setClipError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function deleteSelected() {
    const ids = [...selected]
    if (!ids.length) return
    setDeleting(true); setDeleteError(null)
    try {
      const res = await fetch('/api/clips', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Delete failed')
      const gone = new Set(ids)
      setClips(prev => prev.filter(c => !gone.has(c.id)))
      stopSelecting()
      router.refresh()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const isReady = video.status === 'ready'
  const isProcessing = video.status === 'uploaded' || video.status === 'transcribing'
  const maxMs = video.duration_ms ?? 0
  // The time boxes show hours for a video an hour or longer (or one whose length isn't known yet)
  const withHours = maxMs === 0 || maxMs >= 3_600_000

  // ── AI edit: the whole video's words (server services/transcribe.ts) ──
  // Best moments, Ask AI and Make my clips read all of them. AI edit picked on the dashboard starts
  // that reading as the clip board opens; how far it is shows on the AI card, and a Best moments or
  // Ask AI asked for before it's done runs by itself once it is. Manual edit never reads the whole
  // video: each clip's captions are made in the editor, for that clip alone.
  // place: waiting its turn (many readings at once), its place in line (1 = next)
  type Reading = { status: 'none' | 'running' | 'ready' | 'failed'; progress: number | null; error: string | null; stopped?: boolean; place?: number | null }
  const [reading, setReading] = useState<Reading | null>(null)
  /** What was asked for while the video was being read (runs when it's done), and its name */
  const afterReading = useRef<(() => void) | null>(null)
  const [waitingFor, setWaitingFor] = useState<string | null>(null)
  const readingUrl = `/api/videos/${video.id}/transcript`
  const checkReading = useCallback(async (start = false) => {
    try {
      const res = await fetch(readingUrl, start ? { method: 'POST' } : undefined)
      if (res.ok) setReading(await res.json())
    } catch { /* checked again on the next round */ }
  }, [readingUrl])
  // (asked once per visit: the server also keeps it to one reading if two asks meet)
  const readingAsked = useRef(false)
  useEffect(() => {
    if (!isReady || readingAsked.current) return
    readingAsked.current = true
    checkReading(startWith === 'ai')
  }, [isReady]) // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(() => checkReading(), reading?.status === 'running')
  useEffect(() => {
    if (reading?.status !== 'ready') return
    const run = afterReading.current
    afterReading.current = null
    setWaitingFor(null)
    run?.()
  }, [reading?.status])
  /** Stop: the reading stops (the parts read are kept for the next Unlock); anything waiting for it is dropped */
  const [stopping, setStopping] = useState(false)
  async function stopReading() {
    setStopping(true)
    afterReading.current = null
    setWaitingFor(null)
    try {
      const res = await fetch(readingUrl, { method: 'DELETE' })
      if (res.ok) setReading(await res.json())
    } catch { /* the lock checks again */ } finally { setStopping(false) }
  }
  /** An AI tool was asked for before the video was read (the server answered 409): it waits, then runs */
  function waitForReading(name: string, run: () => void) {
    afterReading.current = run
    setWaitingFor(name)
    setReading(r => (r?.status === 'running' ? r : { status: 'running', progress: null, error: null }))
  }

  // Poll while processing (it stops by itself once the video is no longer processing)
  usePolling(async () => {
    try {
      const r = await fetch(`/api/videos/${video.id}`)
      if (!r.ok) return
      const { video: updated } = await r.json()
      setVideo(v => ({ ...v, ...updated }))
      if (updated.status === 'ready') router.refresh()
    } catch { /* ignore */ }
  }, isProcessing)

  function seek(ms: number, play = true) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = ms / 1000
    if (play) v.play().catch(() => {})
  }

  // Parsed form range, for the live duration readout
  const formStartMs = parseTime(formStart)
  const formEndMs = parseTime(formEnd)
  const formRangeValid = formStartMs !== null && formEndMs !== null && formEndMs > formStartMs

  /** `open`: open the new clip in the editor (Create & edit); otherwise just add it to the board */
  function submitForm(open = true) {
    if (formStartMs === null) { setFormError('Type a start time (hours : minutes : seconds)'); return }
    if (formEndMs === null) { setFormError('Type an end time (hours : minutes : seconds)'); return }
    if (formEndMs <= formStartMs) { setFormError('End must be after start'); return }
    if (maxMs > 0 && formEndMs > maxMs) { setFormError(`The video is only ${msToDisplay(maxMs)} long`); return }
    setFormError(null)
    createClip(formStartMs, formEndMs, open ? 'form' : 'board', formTitle.trim() || undefined, undefined, open)
  }

  // What the user does with an AI suggestion (logged for improving clip picking; fire and forget)
  function logSuggestion(event: 'previewed' | 'used', s: Suggestion, source: 'best_moments' | 'clip_search', clipId?: string) {
    fetch(`/api/videos/${video.id}/suggestion-events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({
        event, source, clip_id: clipId,
        suggestion: { start_ms: s.start_ms, end_ms: s.end_ms, title: s.title, score: s.score, subscores: s.subscores, reason: s.reason,
          model: 'gemini-2.5-flash' },   // one model picks clips everywhere (CLIP_MODEL in services/videos.ts)
      }),
    }).catch(() => {})
  }

  async function createClip(startMs: number, endMs: number, key: string, title?: string, from?: { s: Suggestion; source: 'best_moments' | 'clip_search' }, open = true) {
    setBusy(key)
    setClipError(null)
    try {
      const res = await fetch('/api/clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: video.id, start_ms: startMs, end_ms: endMs, layout: 'vertical', ...(title ? { title } : {}) }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to create clip')
      const { clip_id } = await res.json()
      if (from && typeof from.s.score === 'number') logSuggestion('used', from.s, from.source, clip_id)
      if (!open) {
        // Add to board: the clip joins "Your clips" here, highlighted; the editor isn't opened
        setClips(prev => prev.some(c => c.id === clip_id) ? prev : [...prev, {
          id: clip_id, title: title ?? null, start_ms: startMs, end_ms: endMs, status: 'draft', output_url: null,
          layout: null, created_at: new Date().toISOString(), index: prev.length + 1,
          origin: from?.source === 'best_moments' ? 'best' as const : from?.source === 'clip_search' ? 'ask' as const : 'yours' as const,
        }])
        setShowForm(false)
        setFormTitle('')
        setFormStart(msToDisplay(0))
        setFormEnd(msToDisplay(0))
        setBusy(null)
        focusClip(clip_id, from?.source === 'best_moments' ? 'best' : from?.source === 'clip_search' ? 'ask' : 'yours')
        router.refresh()
        return
      }
      // Every clip starts as one Vertical format over the whole clip
      router.push(editorHref(clip_id))
    } catch (e) {
      console.error(e)
      setBusy(null)
      setClipError(e instanceof Error ? e.message : 'Failed to create clip. Please try again.')
    }
  }

  async function loadAutoClips() {
    const res = await fetch(`/api/videos/${video.id}/auto-clips`)
    if (!res.ok) return
    const data = await res.json() as { job: AutoJob | null; clips: AutoClip[] }
    setAutoJob(data.job)
    setAutoClips(data.clips ?? [])
  }
  const autoRunning = autoJob?.status === 'queued' || autoJob?.status === 'running'
  // The run stopped to ask: fewer good moments were found than clips asked for
  const autoAsking = autoJob?.status === 'confirm' && !!autoJob.found_count
  // A run that finishes while this page is open goes straight to its clips
  const wasRunningRef = useRef(false)
  useEffect(() => {
    if (autoRunning) wasRunningRef.current = true
    else if (wasRunningRef.current && autoJob?.status === 'done') router.push(`/videos/${video.id}/clips`)
  }, [autoRunning, autoJob?.status, router, video.id])
  const autoRendering = autoClips.some(c => c.status === 'rendering')
  // Show an earlier run on load, then poll (usePolling's rhythm) while the job runs or its clips export
  useEffect(() => { if (video.status === 'ready') loadAutoClips().catch(() => {}) }, [video.id, video.status]) // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(() => loadAutoClips().catch(() => {}), autoRunning || autoRendering)
  // New clips also belong in the clip list on the right
  const autoDoneCount = autoClips.filter(c => c.status !== 'rendering').length
  useEffect(() => { if (autoDoneCount > 0) router.refresh() }, [autoDoneCount, router])

  async function makeClips() {
    // The number in the box, kept to 1–10 (it may not have settled yet if Enter wasn't pressed)
    const count = Math.min(AUTO_MAX, Math.max(1, Number(countText) || autoCount))
    setCount(count)
    setAutoStarting(true)
    setAutoError(null)
    try {
      const res = await fetch(`/api/videos/${video.id}/auto-clips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_count: count, add_broll: autoBroll, ...autoOpts, caption_language: captionLang, title_language: titleLang, brand_kit: brandPick }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not start making clips')
      await loadAutoClips()
    } catch (e) {
      setAutoError(e instanceof Error ? e.message : 'Could not start making clips')
    } finally {
      setAutoStarting(false)
    }
  }

  // "Make these N": yes to the run that found fewer good moments than clips asked for
  async function confirmFewerClips() {
    setAutoStarting(true)
    setAutoError(null)
    try {
      const res = await fetch(`/api/videos/${video.id}/auto-clips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not start making clips')
      await loadAutoClips()
    } catch (e) {
      setAutoError(e instanceof Error ? e.message : 'Could not start making clips')
    } finally {
      setAutoStarting(false)
    }
  }

  // "Stop": ends the run; the worker notices within a few seconds and keeps the clips made so far
  async function stopMakingClips() {
    setAutoStopping(true)
    setAutoError(null)
    try {
      const res = await fetch(`/api/videos/${video.id}/auto-clips`, { method: 'DELETE' })
      if (!res.ok && res.status !== 409) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not stop')
      await loadAutoClips()
    } catch (e) {
      setAutoError(e instanceof Error ? e.message : 'Could not stop')
    } finally {
      setAutoStopping(false)
    }
  }

  // On demand only — each call asks AI to read the transcript. Every moment it finds is
  // saved as a draft clip in the Best moments section; the next call finds new ones.
  // Cancel on a running Ask AI / Best moments search: the request is dropped and the list stays as it was
  const momentsAbort = useRef<AbortController | null>(null)
  const askAbort = useRef<AbortController | null>(null)
  const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

  async function findMoments() {
    momentsAbort.current?.abort()
    const ctl = new AbortController()
    momentsAbort.current = ctl
    setLoadingSuggestions(true)
    setSuggestionsError(null)
    setMomentsNote(null)
    setMomentsAdded(null)
    try {
      // A list to pick from: nothing is saved until "+"; moments already listed are skipped
      const exclude = (suggestions ?? []).map(s => [s.start_ms, s.end_ms])
      const res = await fetch(`/api/videos/${video.id}/best-moments?list=1`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exclude }), signal: ctl.signal,
      })
      // The video is still being read: Best moments runs by itself when it's done
      if (res.status === 409) { waitForReading('Best moments', () => findMoments()); return }
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load suggestions')
      const { moments, limitMessage } = await res.json() as { moments: Suggestion[]; limitMessage: string | null }
      const batch = Date.now()
      const found = (moments ?? []).map(m => ({ ...m, id: m.clip_id ?? `${batch}-${m.id}` }))
      // Earlier finds stay listed above the new ones
      setSuggestions(prev => [...(prev ?? []), ...found])
      setMomentsNote(limitMessage)
      const added = found.filter(m => m.clip_id)
      if (added.length) {
        setClips(prev => [...prev, ...added.filter(m => !prev.some(c => c.id === m.clip_id)).map((m, i) => ({
          id: m.clip_id!, title: m.title, start_ms: m.start_ms, end_ms: m.end_ms, status: 'draft', output_url: null,
          layout: null, created_at: new Date().toISOString(), index: prev.length + i + 1, origin: 'best' as const,
        }))])
        setMomentsAdded(`✓ Added ${added.length} moment${added.length === 1 ? '' : 's'} to Clips › Best moments`)
        focusClip(added[0].clip_id!, 'best')
        router.refresh()
      }
    } catch (e) {
      if (!isAbort(e)) setSuggestionsError(e instanceof Error ? e.message : 'Could not load suggestions')
    } finally {
      if (momentsAbort.current === ctl) { momentsAbort.current = null; setLoadingSuggestions(false) }
    }
  }

  /** The clip a result already became (same start and end), if any */
  function clipFor(s: Suggestion) {
    return clips.find(c => c.id === s.clip_id) ?? clips.find(c => c.start_ms === s.start_ms && c.end_ms === s.end_ms) ?? null
  }
  /** Clicking a result card: it plays in Preview, in 9:16, without being made a clip */
  function previewMoment(s: Suggestion, source: MomentSource) {
    videoRef.current?.pause()
    setPreviewId(null)
    setMomentPreview({ s, source })
    setViewMode('preview')
    if (typeof s.score === 'number') logSuggestion('previewed', s, source)
  }
  function closeMoment() { setMomentPreview(null); setViewMode('video') }
  /** Edit: opens it in the editor (made a clip first if it isn't one yet) */
  function editMoment(s: Suggestion, source: MomentSource) {
    const c = clipFor(s)
    if (c) { setBusy('open'); router.push(editorHref(c.id)); return }
    createClip(s.start_ms, s.end_ms, s.id, s.title, { s, source })
  }
  /** Add: it joins the clip board (the editor isn't opened); once added, this shows it there */
  function addMomentToBoard(s: Suggestion, source: MomentSource) {
    const c = clipFor(s)
    if (c) { focusClip(c.id, source === 'best_moments' ? 'best' : 'ask'); return }
    createClip(s.start_ms, s.end_ms, s.id, s.title, { s, source }, false)
  }

  // On demand — asks AI to find moments matching a specific, user-typed criteria
  async function findByCriteria(query?: string, fresh = false) {
    const q = (query ?? aiCriteria).trim()
    if (!q) return
    const key = searchKey(q)
    if (!fresh && askSaved[key]) {
      // Asked before: show that answer, no new request
      askAbort.current?.abort(); askAbort.current = null; setLoadingAi(false)
      setAiError(null)
      setAiSuggestions(askSaved[key])
      setAskFrom(q)
      return
    }
    askAbort.current?.abort()
    const ctl = new AbortController()
    askAbort.current = ctl
    setLoadingAi(true)
    setAiError(null)
    try {
      const res = await fetch(`/api/videos/${video.id}/ai-detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criteria: q }),
        signal: ctl.signal,
      })
      // The video is still being read: this search runs by itself when it's done
      if (res.status === 409) { waitForReading('Ask AI', () => findByCriteria(q, true)); return }
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not find clips')
      const { suggestions } = await res.json() as { suggestions?: Suggestion[] }
      const list = suggestions ?? []
      setAiSuggestions(list)
      setAskFrom(null)
      // Keep the newest searches only
      const next = Object.fromEntries([...Object.entries(askSaved).filter(([k]) => k !== key), [key, list]].slice(-MAX_SAVED_SEARCHES))
      setAskSaved(next)
      writeSaved(askKey, next)
    } catch (e) {
      if (!isAbort(e)) setAiError(e instanceof Error ? e.message : 'Could not find clips')
    } finally {
      if (askAbort.current === ctl) { askAbort.current = null; setLoadingAi(false) }
    }
  }
  function cancelAsk() { askAbort.current?.abort(); askAbort.current = null; setLoadingAi(false) }
  function cancelMoments() { momentsAbort.current?.abort(); momentsAbort.current = null; setLoadingSuggestions(false) }

  // The second AI card: Ask AI or Best moments (one at a time, switched at its top)
  const [aiPane, setAiPane] = useState<'ask' | 'best'>('ask')

  // A video from before editing copies were made: ask the worker for one, so dragging along it is
  // quick from the next visit (until then the original plays)
  useEffect(() => {
    if (needsProxy) fetch(`/api/videos/${initialVideo.id}/proxy`, { method: 'POST' }).catch(() => {})
  }, [needsProxy, initialVideo.id])

  // Arrived from the dashboard's "AI edit / Manual edit" choice: that part of the clip board (the
  // Make my clips card, or New clip under the video) is scrolled into view (no glow).
  // The choice then leaves the address, so a refresh doesn't point again.
  useEffect(() => {
    if (!startWith) return
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-start-target="${startWith}"]`)
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      // (Manual edit keeps its choice in the address, so a refresh stays on the manual board)
      if (startWith !== 'manual') window.history.replaceState(window.history.state, '', window.location.pathname)
    }, 350)
    return () => clearTimeout(t)
  }, [startWith])

  const wide = useWide()
  // Clip previews are 9:16; the video keeps its own shape
  // The frame takes the video's own proportions once it loads, so it fits exactly (no empty bars)
  const [ratio, setRatio] = useState(16 / 9)
  // The metadata can arrive before the page is interactive (the <video> is server-rendered),
  // so also read the size once on mount
  useEffect(() => {
    const v = videoRef.current
    if (v && v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight)
  }, [videoUrl])
  const frameRatio = viewMode === 'preview' ? 9 / 16 : ratio

  // The video's link stopped working (it expires; the network dropped): a fresh one is fetched
  // (the page reloads its data) and the video carries on from the same moment. At most once a
  // minute, so a video that is really gone doesn't reload forever.
  const resumeAt = useRef<number | null>(null)
  const lastRelink = useRef(0)
  function relink(v: HTMLVideoElement) {
    if (Date.now() - lastRelink.current < 60_000) return
    lastRelink.current = Date.now()
    resumeAt.current = v.currentTime
    router.refresh()
  }

  // ── The player (or its processing / failed state) ──
  const player = isReady && videoUrl ? (
    // Our own controls (components/clips/ScrubPlayer.tsx): dragging along the video shows each
    // moment at once and never piles up jumps, however heavy the file is
    <ScrubPlayer src={playUrl} videoRef={videoRef} durationMs={initialVideo.duration_ms}
      loadKey={videoKey || signedUrl}
      onTime={setNowMs}
      onMeta={v => {
        if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight)
        // (a fresh link after the old one stopped working: back to where the video was)
        if (resumeAt.current !== null) { v.currentTime = resumeAt.current; resumeAt.current = null }
      }}
      onError={relink} />
  ) : (
    <div className="flex flex-col items-center gap-4 px-10 text-center">
      {video.status === 'failed' ? (
        <>
          <p className="text-sm font-medium text-white">We couldn&apos;t process this video</p>
          <p className="text-xs" style={{ color: 'rgb(var(--cb-fg) / 0.45)' }}>Delete it from your videos and upload it again.</p>
        </>
      ) : (
        <>
          <BrandLoader size={40} />
          <p className="text-sm font-medium text-white">{isProcessing ? stageLabel(video.download_progress ?? 0) : 'Loading video…'}</p>
          {isProcessing && (
            <div className="w-48 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgb(var(--cb-fg) / 0.1)' }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(4, video.download_progress ?? 0)}%`, background: ACCENT }} />
            </div>
          )}
        </>
      )}
    </div>
  )

  // ── Clip preview (in place of the video): the clip played in 9:16 as edited ──
  const previewed = byTime.find(c => c.id === previewId) ?? null
  const previewData = previewId ? previews[previewId] : undefined
  const previewList = shownClips.some(c => c.id === previewId) ? shownClips.filter(c => previewable.includes(c)) : previewable
  const previewIdx = previewList.findIndex(c => c.id === previewId)
  const previewPane = (
    <div className="w-full h-full flex items-center justify-center">
      {momentPreview ? (
        <ClipPlayer key={`m-${momentPreview.s.id}`} videoUrl={playUrl} mainVideoId={video.id}
          startMs={momentPreview.s.start_ms} endMs={momentPreview.s.end_ms}
          segments={previewSegments([], momentPreview.s.end_ms - momentPreview.s.start_ms, ratio)}
          words={[]} captionStyle={null} textOverlays={[]} />
      ) : !previewed ? (
        <p className="text-sm px-6 text-center" style={{ color: 'rgb(var(--cb-fg) / 0.5)' }}>No clips yet. Make a clip, then preview it here.</p>
      ) : previewData === 'loading' || previewData === undefined ? (
        <BrandLoader size={36} label="Loading preview…" />
      ) : 'error' in previewData ? (
        <p className="text-sm px-6 text-center" style={{ color: '#f87171' }}>{previewData.error}</p>
      ) : (
        <ClipPlayer key={previewData.id} videoUrl={playUrl} mainVideoId={previewData.video_id} stockUrls={previewData.stockUrls}
          startMs={previewData.start_ms} endMs={previewData.end_ms}
          segments={previewSegments(previewData.segments, previewData.end_ms - previewData.start_ms, ratio)}
          words={previewData.words}
          // No saved style yet: captions off, as the editor opens a new clip
          captionStyle={previewData.captionStyle ?? null}
          textOverlays={previewData.textOverlays} />
      )}
    </div>
  )
  // Toggle between the video and clip previews, and (in preview) which clip and what to do with it
  const viewBar = isReady && (
    <div className="shrink-0 flex flex-col items-center gap-2">
      {/* A switch: two equal halves and a lime knob that slides (and stretches a little) to the
          picked side (styles: .view-switch in globals.css) */}
      <div role="tablist" aria-label="Show" className="view-switch" data-side={viewMode === 'preview' ? 'right' : 'left'}>
        <span className="view-switch-knob" aria-hidden="true" />
        {([['video', 'Video'], ['preview', 'Clip preview']] as const).map(([mode, label]) => (
          <button key={mode} type="button" role="tab" aria-selected={viewMode === mode}
            onClick={() => (mode === 'preview' ? showPreviewMode() : setViewMode('video'))}
            className="view-switch-opt" data-on={viewMode === mode || undefined}>
            {label}{mode === 'preview' && previewable.length > 0 ? ` (${previewable.length})` : ''}
          </button>
        ))}
      </div>
      {viewMode === 'preview' && momentPreview && (() => {
        const list = (momentPreview.source === 'clip_search' ? aiSuggestions : suggestions) ?? []
        const i = list.findIndex(x => x.id === momentPreview.s.id)
        return (
          <div className="w-full max-w-xl mx-auto flex items-center gap-2">
            <button type="button" aria-label="Previous result" disabled={i <= 0}
              onClick={() => previewMoment(list[i - 1], momentPreview.source)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-sm transition-colors hover:bg-white/10 disabled:opacity-30" style={{ color: 'var(--cb-text)' }}>‹</button>
            <p className="min-w-0 flex-1 text-sm font-medium text-white truncate text-center" title={momentPreview.s.title}>
              {momentPreview.s.title}
              <span className="ml-2 text-xs font-normal" style={{ color: 'rgb(var(--cb-fg) / 0.45)' }}>
                {momentPreview.source === 'clip_search' ? 'Ask AI' : 'Best moments'}{i >= 0 ? ` · ${i + 1} of ${list.length}` : ''}
              </span>
            </p>
            <button type="button" aria-label="Next result" disabled={i < 0 || i >= list.length - 1}
              onClick={() => previewMoment(list[i + 1], momentPreview.source)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-sm transition-colors hover:bg-white/10 disabled:opacity-30" style={{ color: 'var(--cb-text)' }}>›</button>
          </div>
        )
      })()}
      {viewMode === 'preview' && !momentPreview && previewed && (
        <div className="w-full max-w-xl mx-auto flex items-center gap-2">
          <button type="button" aria-label="Previous clip" disabled={previewIdx <= 0}
            onClick={() => previewClip(previewList[previewIdx - 1].id)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-sm transition-colors hover:bg-white/10 disabled:opacity-30" style={{ color: 'var(--cb-text)' }}>‹</button>
          <p className="min-w-0 flex-1 text-sm font-medium text-white truncate text-center" title={previewed.title ?? undefined}>
            {previewed.title ?? `Clip ${previewed.index}`}
            <span className="ml-2 text-xs font-normal" style={{ color: 'rgb(var(--cb-fg) / 0.45)' }}>{previewIdx + 1} of {previewList.length}</span>
          </p>
          <button type="button" aria-label="Next clip" disabled={previewIdx < 0 || previewIdx >= previewList.length - 1}
            onClick={() => previewClip(previewList[previewIdx + 1].id)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-sm transition-colors hover:bg-white/10 disabled:opacity-30" style={{ color: 'var(--cb-text)' }}>›</button>
        </div>
      )}
    </div>
  )

  // ── Under the video: New clip (which opens the start/end form in place) ──
  // While a clip or a moment is shown in Preview, a button beside it opens that one in the editor.
  // (There is no "Edit full video": this makes clips out of a long video, it doesn't edit the whole of it.)
  const editingPreviewed = viewMode === 'preview' && !!previewId && clips.some(c => c.id === previewId)
  const editingMoment = viewMode === 'preview' && momentPreview ? momentPreview : null
  // Manual edit: the form is always there, except while a clip is previewed (then only Edit this clip)
  const formOpen = manualOnly ? !(editingPreviewed || editingMoment) : showForm
  const newClipBar = formOpen ? (
    <form className="cb-form shrink-0 p-4 flex flex-col gap-3"
      onSubmit={e => { e.preventDefault(); submitForm(true) }}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 flex-1" style={{ minWidth: 200 }}>
          <label htmlFor="clip-title" className="cb-label">New clip <span style={{ color: 'rgb(var(--cb-fg) / 0.3)', letterSpacing: '0.04em', textTransform: 'none', fontWeight: 500 }}>· title (optional)</span></label>
          <input
            id="clip-title"
            type="text"
            placeholder="e.g. Best reaction"
            value={formTitle}
            onChange={e => setFormTitle(e.target.value)}
            autoFocus={!manualOnly}
            className="cb-input w-full h-[52px] px-3.5 rounded-xl text-sm text-white outline-none placeholder:text-white/30"
          />
        </div>
        {/* Start → how long → End */}
        <div className="flex items-center gap-2.5">
          <div style={{ width: withHours ? 140 : 100 }}>
            <TimeField id="clip-start" label="Start" value={formStart} onChange={setFormStart} showHours={withHours} nextId="clip-end" />
          </div>
          {(() => {
            const a = parseTime(formStart), z = parseTime(formEnd)
            const ok = a != null && z != null && z > a
            return (
              <button type="button" className="shrink-0 flex flex-col items-center gap-1 rounded-lg px-1 py-1 transition-colors hover:bg-white/5" title="Clip length · go to the end time"
                aria-label="Go to the end time"
                onClick={() => { const el = document.getElementById(`clip-end-${withHours ? 'h' : 'm'}`) as HTMLInputElement | null; el?.focus(); requestAnimationFrame(() => el?.select()) }}>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums"
                  style={ok ? { color: ACCENT, background: 'rgba(200,255,0,0.1)' } : { color: 'rgb(var(--cb-fg) / 0.35)', background: 'rgb(var(--cb-fg) / 0.05)' }}>
                  {ok ? msToDisplay(z! - a!) : '–'}
                </span>
                <svg width="34" height="6" viewBox="0 0 34 6" fill="none" aria-hidden="true">
                  <path d="M1 3h31M29 1l3 2-3 2" stroke={ok ? ACCENT : 'rgb(var(--cb-fg) / 0.3)'} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )
          })()}
          <div style={{ width: withHours ? 140 : 100 }}>
            <TimeField id="clip-end" label="End" value={formEnd} onChange={setFormEnd} showHours={withHours} prevId="clip-start" />
          </div>
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={!!busy}
            className="cb-cta h-[52px] flex items-center gap-2 px-5 rounded-xl text-sm font-bold disabled:opacity-50">
            {busy === 'form' && <Spinner />} Create &amp; edit
          </button>
          {/* Save it to the clip board only (edit it later) */}
          <button type="button" onClick={() => submitForm(false)} disabled={!!busy}
            title="Save this clip to your clip board without opening the editor"
            className="cb-ghost h-[52px] flex items-center gap-2 px-4 rounded-xl text-sm font-semibold disabled:opacity-50">
            {busy === 'board' ? <Spinner /> : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M12 9v6M9 12h6" />
              </svg>
            )}
            Add to board
          </button>
          {!manualOnly && <button type="button" onClick={() => setShowForm(false)}
            className="px-3.5 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-white/10" style={{ color: 'rgb(var(--cb-fg) / 0.6)' }}>
            Cancel
          </button>}
        </div>
      </div>
      <p className="text-xs" style={{ color: formError ? '#f87171' : 'rgb(var(--cb-fg) / 0.45)' }}>
        {formError ?? (formRangeValid ? `Length: ${durLabel(formStartMs!, formEndMs!)}` : 'Type hours, minutes and seconds: two digits move you on')}
      </p>
    </form>
  ) : (
    // Previewing a clip or a moment: two equal-width, equal-height buttons (same border, weight and
    // icon size, so they read as a pair). Otherwise New clip alone.
    <div className="shrink-0 flex flex-wrap justify-center gap-3 w-full mx-auto">
      {(editingPreviewed || editingMoment) && (
        <button onClick={editingMoment ? () => editMoment(editingMoment.s, editingMoment.source) : () => { setBusy('open'); router.push(editorHref(previewId!)) }} disabled={!!busy}
          title={editingMoment ? 'Open the moment you’re previewing in the editor' : 'Open the clip you’re previewing in the editor'}
          className="h-12 flex items-center justify-center gap-2 px-5 rounded-xl text-sm font-semibold transition-colors hover:bg-white/10 disabled:opacity-40"
          style={{ color: 'rgb(var(--cb-fg) / 0.9)', border: '1px solid rgb(var(--cb-fg) / 0.16)', background: 'rgb(var(--cb-fg) / 0.03)' }}>
          {busy === 'open' || busy === editingMoment?.s.id ? <Spinner /> : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
            </svg>
          )}
          {editingMoment ? 'Edit this moment' : 'Edit this clip'}
        </button>
      )}
    </div>
  )

  // ── AI tools: Ask AI + Best moments (left column on wide screens, under the video otherwise) ──
  const aiToolsOpen = (
    <>
      {/* (styles: .mmc-* in globals.css) */}
      <section className="mmc shrink-0 p-3.5 flex flex-col gap-3 rounded-2xl" data-start-target="ai">
        {/* Header: a spark badge (glass, the spark lime), the title and its ⓘ; on the right, the way to the clips already made */}
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="shrink-0 w-8 h-8 rounded-[10px] grid place-items-center"
            style={{ background: 'rgb(var(--cb-fg) / 0.06)', color: ACCENT, boxShadow: 'inset 0 0 0 1px rgb(var(--cb-fg) / 0.1)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9z" />
              <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" opacity=".7" />
            </svg>
          </span>
          <h2 className="flex-1 min-w-0 flex items-center gap-1.5 text-sm font-semibold text-white">
            Make my clips
            <InfoTip label="About Make my clips">AI picks the best moments of the video and frames each one vertically. Choose how many clips (up to {AUTO_MAX} at a time) and what each one gets. You can change everything in the editor afterwards.</InfoTip>
          </h2>
          {autoClips.length > 0 && !autoRunning && (
            <button type="button" onClick={() => router.push(`/videos/${video.id}/clips`)} className="mmc-link">
              View {autoClips.length} clip{autoClips.length === 1 ? '' : 's'}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
            </button>
          )}
        </div>

        {/* AI edit reads the whole video first: how far it is (manual clips never wait for it) */}
        {reading && (reading.status === 'running' || reading.status === 'failed') && (
          <div role="status" className="flex flex-col gap-1.5 rounded-xl px-3 py-2.5"
            style={{ background: 'rgba(200,255,0,0.06)', boxShadow: 'inset 0 0 0 1px rgba(200,255,0,0.18)' }}>
            {reading.status === 'running' ? (
              <>
                <span className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Spinner /> Reading your video for AI{reading.place ? ` · waiting its turn, ${inLineText(reading.place)}` : reading.progress ? ` · ${reading.progress}%` : '…'}
                </span>
                {reading.progress !== null && (
                  <span className="h-1 rounded-full overflow-hidden" style={{ background: 'rgb(var(--cb-fg) / 0.1)' }} aria-hidden="true">
                    <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(3, reading.progress)}%`, background: ACCENT }} />
                  </span>
                )}
                <span className="text-[11px]" style={{ color: 'rgb(var(--cb-fg) / 0.55)' }}>
                  {waitingFor ? `${waitingFor} runs by itself when it's done. ` : ''}Best moments, Ask AI and Make my clips need all its words. You can make clips by hand meanwhile.
                </span>
              </>
            ) : (
              <span className="flex items-center justify-between gap-2">
                <span className="text-xs" style={{ color: '#f87171' }}>{reading.error ?? 'Reading your video failed.'}</span>
                <button type="button" onClick={() => checkReading(true)} className="shrink-0 px-2.5 py-1 rounded-md text-[11px] font-semibold"
                  style={{ background: 'rgb(var(--cb-fg) / 0.08)', color: 'var(--cb-text)' }}>Try again</button>
              </span>
            )}
          </div>
        )}

        {/* How many clips: type a number or step it with − / + */}
        <div className="mmc-block flex items-center justify-between gap-3 pl-3 pr-1.5 py-1.5">
          <label htmlFor={`clip-count-${video.id}`} className="flex flex-col leading-tight">
            <span className="text-xs font-medium" style={{ color: 'rgb(var(--cb-fg) / 0.8)' }}>How many clips?</span>
            <span className="text-[10px]" style={{ color: countOver ? '#fbbf24' : 'rgb(var(--cb-fg) / 0.5)' }}>
              {countOver ? `Up to ${AUTO_MAX} at a time` : `1 to ${AUTO_MAX}`}
            </span>
          </label>
          <div className="mmc-count flex items-center rounded-lg" data-off={autoRunning || undefined}>
            <button type="button" className="mmc-step" aria-label="Fewer clips" onClick={() => setCount(autoCount - 1)}
              disabled={autoRunning || autoCount <= 1}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M5 12h14" /></svg>
            </button>
            <input id={`clip-count-${video.id}`} type="text" inputMode="numeric" autoComplete="off" maxLength={2}
              value={countText} disabled={autoRunning}
              onChange={e => {
                const t = e.target.value.replace(/\D/g, '').slice(0, 2)
                setCountText(t)
                const n = Number(t)
                // (more than a run makes: the most it can, so the button never says another number)
                if (t && n >= 1) setAutoCount(Math.min(AUTO_MAX, n))
              }}
              onBlur={() => setCount(Number(countText) || autoCount)}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
                else if (e.key === 'ArrowUp') { e.preventDefault(); setCount(autoCount + 1) }
                else if (e.key === 'ArrowDown') { e.preventDefault(); setCount(autoCount - 1) }
              }}
              className="mmc-input w-10 h-8 text-center bg-transparent text-sm font-bold tabular-nums text-white outline-none" />
            <button type="button" className="mmc-step" aria-label="More clips" onClick={() => setCount(autoCount + 1)}
              disabled={autoRunning || autoCount >= AUTO_MAX}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
        </div>

        {/* What AI adds: four tiles, each a checkbox — its little picture turns white and a lime tick
            shows on the right when it's on (styles: .mmc-opt in globals.css) */}
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="What AI adds to each clip">
          {AUTO_OPTIONS.map(o => (
            <label key={o.id} title={o.tip} className="mmc-opt" data-on={autoOpts[o.id] || undefined} data-off={autoRunning || undefined}>
              <input type="checkbox" className="sr-only" checked={autoOpts[o.id]} disabled={autoRunning}
                onChange={() => toggleAutoOpt(o.id)} />
              <span className="mmc-opt-icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{AUTO_ICONS[o.id]}</svg>
              </span>
              <span className="flex-1 min-w-0 truncate">{o.label}</span>
              <span className="mmc-opt-box" aria-hidden="true">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </span>
            </label>
          ))}
        </div>

        {/* What the captions and the title are written in. Both rows always show (one whose box is
            unticked is dimmed), so the button below never moves. */}
        <div className="flex flex-col gap-1.5">
          {([
            { name: 'Captions', what: 'captions are', on: autoOpts.captions, list: CAPTION_LANGUAGES, value: captionLang, pick: (id: string) => pickLanguage({ caption: id as CaptionLanguage }) },
            { name: 'Title', what: 'title is', on: autoOpts.title, list: TITLE_LANGUAGES, value: titleLang, pick: (id: string) => pickLanguage({ title: id as TitleLanguage }) },
          ]).map(row => {
            const off = autoRunning || !row.on
            return (
              <label key={row.name} className="mmc-row flex items-center gap-2 text-[11px]" data-off={off || undefined} style={{ color: 'rgb(var(--cb-fg) / 0.6)' }}>
                <span className="shrink-0 w-[52px]">{row.name}</span>
                <select value={row.value} disabled={off} onChange={e => row.pick(e.target.value)}
                  aria-label={`What the ${row.what} written in`}
                  className="mmc-select flex-1 min-w-0 px-2 py-1.5 rounded-md text-[11px] text-white outline-none">
                  {row.list.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </label>
            )
          })}
          {/* The brand kit the clips get (shown once the account has a kit) */}
          {brandKits.length > 0 && (() => {
            const def = brandKits.find(k => k.isDefault)
            // A kit goes on, but with Captions or Title off its caption / title look has nothing to
            // go on — only the logo would show (user, 2026-10-31): say so, with a way to turn them on
            const kitOn = brandPick !== 'none' && (brandPick !== 'default' || !!def)
            const missing = [!autoOpts.captions && 'Captions', !autoOpts.title && 'Title'].filter(Boolean) as string[]
            return (
              <>
                <label className="mmc-row flex items-center gap-2 text-[11px]" data-off={autoRunning || undefined} style={{ color: 'rgb(var(--cb-fg) / 0.6)' }}>
                  <span className="shrink-0 w-[52px]">Brand</span>
                  <select value={brandPick} disabled={autoRunning} onChange={e => setBrandPick(e.target.value)}
                    aria-label="The brand kit the clips get"
                    className="mmc-select flex-1 min-w-0 px-2 py-1.5 rounded-md text-[11px] text-white outline-none">
                    <option value="default">{def ? `Default · ${def.name}` : 'Default (none set)'}</option>
                    {brandKits.filter(k => !k.isDefault).map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                    <option value="none">No brand kit</option>
                  </select>
                </label>
                {kitOn && missing.length > 0 && !autoRunning && (
                  <p className="mmc-brand-note" role="status">
                    {missing.length > 1
                      ? 'Captions and Title are off, so only the kit’s logo goes on.'
                      : `${missing[0]} is off, so the kit’s ${missing[0] === 'Captions' ? 'caption' : 'title'} look won’t show.`}{' '}
                    <button type="button" onClick={captionsAndTitleOn}>Turn {missing.length > 1 ? 'them' : 'it'} on</button>
                  </p>
                )}
              </>
            )
          })()}
        </div>

        {autoError && <p className="text-xs" style={{ color: '#f87171' }}>{autoError}</p>}
        {/* Fewer good moments than clips asked for: nothing is made until the user says yes */}
        {autoAsking && autoJob && (
          <div role="alert" className="flex flex-col gap-2 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.3)' }}>
            <p className="text-xs font-semibold" style={{ color: '#fcd34d' }}>
              Only {autoJob.found_count} good clip{autoJob.found_count === 1 ? '' : 's'} can be made from this video
            </p>
            <p className="text-[11px]" style={{ color: 'rgb(var(--cb-fg) / 0.6)' }}>
              You asked for {autoJob.clip_count}. Nothing has been made yet.
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={confirmFewerClips} disabled={autoStarting}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold disabled:opacity-50"
                style={{ background: ACCENT, color: '#000' }}>
                {autoStarting && <Spinner />} Make {autoJob.found_count === 1 ? 'this 1 clip' : `these ${autoJob.found_count} clips`}
              </button>
              <button type="button" onClick={stopMakingClips} disabled={autoStopping || autoStarting}
                className="px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors hover:bg-white/10 disabled:opacity-50"
                style={{ color: 'rgb(var(--cb-fg) / 0.75)', border: '1px solid rgb(var(--cb-fg) / 0.2)' }}>
                {autoStopping ? 'Cancelling…' : 'Cancel'}
              </button>
            </div>
          </div>
        )}
        {autoRunning && autoJob && (
          <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(200,255,0,0.04)', border: '1px solid rgba(200,255,0,0.12)' }}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span style={{ color: 'rgb(var(--cb-fg) / 0.7)' }}>
                {autoJob.status === 'queued' ? 'Waiting to start…' : autoJob.progress < 20 ? 'Reading the video…' : autoJob.progress < 35 ? 'Finding the best moments…' : 'Framing clips…'}
              </span>
              <span className="font-semibold tabular-nums" style={{ color: ACCENT }}>{autoJob.progress}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgb(var(--cb-fg) / 0.08)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(3, autoJob.progress)}%`, background: ACCENT }} />
            </div>
            <div className="flex items-center gap-2">
              <p className="flex-1 text-[11px]" style={{ color: 'rgb(var(--cb-fg) / 0.4)' }}>
                {autoJob.clip_count ? `${autoJob.clip_count} clip${autoJob.clip_count === 1 ? '' : 's'}` : ''}
                {/* Reading comes first and is the slow part of a long video */}
                {autoJob.status === 'running' && autoJob.progress < 20 ? ' · a long video takes a while to read; you can leave this page, it carries on' : ''}
              </p>
              <button type="button" onClick={stopMakingClips} disabled={autoStopping}
                title="Stop making clips (clips already made are kept)"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors hover:bg-red-500/20 disabled:opacity-50"
                style={{ color: '#fca5a5', border: '1px solid rgba(239,68,68,0.35)' }}>
                {autoStopping ? <Spinner /> : <span aria-hidden="true" className="w-2 h-2 rounded-[2px]" style={{ background: 'currentColor' }} />}
                {autoStopping ? 'Stopping…' : 'Stop'}
              </button>
            </div>
          </div>
        )}
        {autoJob?.status === 'failed' && autoJob.error === 'Cancelled by you' && (
          <p className="text-xs" style={{ color: 'rgb(var(--cb-fg) / 0.55)' }}>
            Stopped.{autoClips.length ? ' Clips made before you stopped are kept.' : ''} Press Make my clips to start again.
          </p>
        )}
        {autoJob?.status === 'failed' && autoJob.error !== 'Cancelled by you' && (
          <p className="text-xs" style={{ color: '#f87171' }}>
            {/* (a video with no sound can't be tried again: its message says what to do) */}
            {/no sound/i.test(autoJob.error ?? '')
              ? <>{autoJob.error} You can still make clips by hand below.</>
              : <>Making clips failed{autoJob.error ? `: ${autoJob.error}` : ''}. Try again, or make clips by hand below.</>}
          </p>
        )}
        {/* Main action last: quiet — a lime tint and lime words, not a filled block (.mmc-go) */}
        <button type="button" onClick={() => { setMakePulse(n => n + 1); makeClips() }} disabled={autoRunning || autoStarting}
          data-busy={autoRunning || autoStarting || undefined}
          className="ai-btn ai-make mmc-go flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold disabled:opacity-40">
          <span key={makePulse} className={`ai-fire${makePulse ? ' is-on' : ''}`} aria-hidden="true" />
          {autoStarting || autoRunning ? <Spinner /> : (
            <span key={`s${makePulse}`} className={`ai-spark${makePulse ? ' is-on' : ''}`} aria-hidden="true">
              ✦<i /><i /><i />
            </span>
          )} {autoRunning ? 'Making clips…' : `Make ${autoCount} clip${autoCount === 1 ? '' : 's'}`}
        </button>
      </section>

      {/* Ask AI and Best moments share one card: a switch at the top picks which one shows */}
      <section className="flex-1 min-h-[260px] p-3.5 flex flex-col gap-2.5 rounded-2xl" style={CARD}>
        <div className="shrink-0 flex items-center gap-2">
          {/* Segmented switch: a tile of light glass slides under the picked side (styles: .ai-seg in globals.css) */}
          <div role="tablist" aria-label="Find clips with AI" className="ai-seg flex-1" data-side={aiPane === 'best' ? 'right' : 'left'}
            onKeyDown={e => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault()
                const next = e.key === 'ArrowLeft' ? 'ask' : 'best'
                setAiPane(next)
                e.currentTarget.querySelector<HTMLButtonElement>(`[data-pane="${next}"]`)?.focus()
              }
            }}>
            <span className="ai-seg-knob" aria-hidden="true" />
            {([['ask', 'Ask AI'], ['best', 'Best moments']] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={aiPane === id} tabIndex={aiPane === id ? 0 : -1}
                data-pane={id} onClick={() => setAiPane(id)} className="ai-seg-opt" data-on={aiPane === id || undefined}>
                {id === 'ask' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.8A8 8 0 1 1 21 12z" />
                    <path d="M12 8.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="currentColor" stroke="none" />
                  </svg>
                ) : suggestions?.length ? (
                  // (moments found: how many, in the star's place — both would not fit beside the words)
                  <span className="ai-seg-badge tabular-nums" aria-label={`${suggestions.length} found`}>{suggestions.length}</span>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden>
                    <path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
                  </svg>
                )}
                <span>{label}</span>
              </button>
            ))}
          </div>
          {aiPane === 'ask'
            ? <InfoTip label="About Ask AI">Describe a moment — an emotion, a topic, a hot take — and AI finds matching clips. Press Use on a result to add it.</InfoTip>
            : <InfoTip label="About Best moments">AI picks the moments most likely to work as reels. Press + on the ones you want to add them to your clip board.</InfoTip>}
        </div>
        {aiPane === 'ask' && (<>
        <form className="shrink-0 flex gap-2" onSubmit={e => { e.preventDefault(); setFindPulse(n => n + 1); findByCriteria() }}>
          {/* While the box is empty, example searches are typed out left → right with a blinking
              caret, on a loop; the newest letters stay in view (styles: .ai-hint in globals.css) */}
          <div className="ai-hint-wrap relative min-w-0 flex-1">
            <input
              type="text"
              aria-label="What should AI look for? For example: funny reactions, controversial takes"
              value={aiCriteria}
              onChange={e => setAiCriteria(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none focus:border-[#c8ff00]"
              style={{ background: 'rgb(var(--cb-fg) / 0.07)', border: '1px solid rgb(var(--cb-fg) / 0.12)' }}
            />
            {!aiCriteria && (
              <span className="ai-hint" aria-hidden="true">
                <span className="ai-hint-line"><span className="ai-hint-text">{typedHint}</span></span>
                <span className="ai-hint-caret" />
              </span>
            )}
          </div>
          <button type="submit" disabled={loadingAi || !aiCriteria.trim()} aria-label="Find" title="Find matching clips"
            data-busy={loadingAi || undefined}
            className="ai-btn ai-find shrink-0 w-10 flex items-center justify-center rounded-lg disabled:opacity-40"
            style={{ background: ACCENT, color: '#000' }}>
            <span key={findPulse} className={`ai-scan${findPulse ? ' is-on' : ''}`} aria-hidden="true" />
            {loadingAi ? <Spinner /> : (
              <svg key={`p${findPulse}`} className={`ai-ping${findPulse ? ' is-on' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            )}
          </button>
        </form>
        {/* One-tap searches */}
        <div className="shrink-0 flex flex-wrap gap-1.5">
          {ASK_CHIPS.map(q => (
            <button key={q} type="button" disabled={loadingAi}
              onClick={() => { setAiCriteria(q); setFindPulse(n => n + 1); findByCriteria(q) }}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors hover:bg-white/10 disabled:opacity-40"
              style={{ color: 'rgb(var(--cb-fg) / 0.7)', border: '1px solid rgb(var(--cb-fg) / 0.14)' }}>
              {q}
            </button>
          ))}
        </div>
        {/* Results scroll inside the card, so the card never grows */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 -mr-2 pr-2">
        {aiError && <p className="text-xs" style={{ color: '#f87171' }}>{aiError}</p>}
        {!loadingAi && askFrom && aiSuggestions && (
          <div className="shrink-0 flex items-center gap-2 text-[11px]" style={{ color: 'rgb(var(--cb-fg) / 0.45)' }}>
            <span className="flex-1 min-w-0 truncate">Saved results for “{askFrom}”</span>
            <button type="button" onClick={() => { setFindPulse(n => n + 1); findByCriteria(askFrom, true) }}
              title="Ask AI again for fresh results"
              className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold transition-colors hover:bg-white/10" style={{ color: ACCENT }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" /></svg>
              Search again
            </button>
          </div>
        )}
        {loadingAi && (
          <div className="flex items-center gap-2 py-1.5">
            <p className="flex-1 flex items-center gap-2 text-xs" style={{ color: ACCENT }}><Spinner /> Scanning the transcript…</p>
            <CancelButton onClick={cancelAsk} title="Stop this search" />
          </div>
        )}
        {!loadingAi && aiSuggestions && aiSuggestions.length === 0 && (
          <p className="text-xs" style={{ color: 'rgb(var(--cb-fg) / 0.45)' }}>Nothing matched that. Try a different description.</p>
        )}
        {!loadingAi && aiSuggestions?.map((s, i) => (
          <ResultCard key={s.id} s={s} rank={i + 1} videoUrl={videoUrl} busy={busy} inClips={!!clipFor(s)}
            open={viewMode === 'preview' && momentPreview?.s.id === s.id}
            onOpen={() => previewMoment(s, 'clip_search')} onClose={closeMoment}
            onEdit={() => editMoment(s, 'clip_search')} onAdd={() => addMomentToBoard(s, 'clip_search')} />
        ))}
        </div>
        </>)}

        {aiPane === 'best' && (<>
        {!suggestions && !loadingSuggestions && (
          <>
            {/* Spotlight: on hover the stars twinkle in turn and the edge warms to lime;
                on click a lime spotlight flashes out of the stars (styles: .ai-best in globals.css) */}
            <button onClick={() => { setBestPulse(n => n + 1); findMoments() }}
              className="ai-btn ai-best shrink-0 flex items-center justify-center gap-2 h-9 rounded-lg text-xs font-medium"
              style={{ color: 'rgb(var(--cb-fg) / 0.85)' }}>
              <span key={bestPulse} className={`ai-spot${bestPulse ? ' is-on' : ''}`} aria-hidden="true" />
              <svg className="ai-stars" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ overflow: 'visible' }}>
                <path className="ai-star-big" d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" fill="currentColor"/>
                <path className="ai-star-small" d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" fill="currentColor"/>
              </svg>
              Find best moments
            </button>
          </>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 -mr-2 pr-2">
        {loadingSuggestions && (
          <div className="flex items-center gap-2 py-1.5">
            <p className="flex-1 flex items-center gap-2 text-xs" style={{ color: ACCENT }}><Spinner /> Finding moments…</p>
            <CancelButton onClick={cancelMoments} title="Stop finding moments" />
          </div>
        )}
        {suggestionsError && <p className="text-xs" style={{ color: '#f87171' }}>{suggestionsError}</p>}
        {momentsAdded && <p className="text-xs font-semibold" style={{ color: ACCENT }}>{momentsAdded}</p>}
        {momentsNote && <p className="text-xs" style={{ color: '#fbbf24' }}>{momentsNote}</p>}
        {suggestions && !loadingSuggestions && suggestions.length === 0 && (
          <p className="text-xs" style={{ color: 'rgb(var(--cb-fg) / 0.45)' }}>
            {clips.length ? 'No new moments — the strongest ones are already in your clips.' : 'No suggestions for this video.'}
          </p>
        )}
        {suggestions && suggestions.map((s, i) => (
          <ResultCard key={s.id} s={s} rank={i + 1} videoUrl={videoUrl} busy={busy} inClips={!!clipFor(s)}
            open={viewMode === 'preview' && momentPreview?.s.id === s.id}
            onOpen={() => previewMoment(s, 'best_moments')} onClose={closeMoment}
            onEdit={() => editMoment(s, 'best_moments')} onAdd={() => addMomentToBoard(s, 'best_moments')} />
        ))}
        </div>
        {suggestions && !loadingSuggestions && (
          <button onClick={findMoments} title="Find more moments (ones already listed or in your clips are skipped)"
            className="shrink-0 self-center flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md transition-colors hover:bg-white/10" style={{ color: ACCENT }}>
            View more suggestions
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        )}
        </>)}
      </section>
    </>
  )

  // The edit tools (Make my clips, Best moments, Ask AI) need the whole video's transcript, so each
  // answers in seconds (user's choice, 2026-10-16/17). Until it's there they stay on screen, greyed
  // and locked: Manual edit unlocks them with Unlock edit tools (the transcript is read then — never
  // before, so a manual-only video costs nothing); AI edit starts the reading as the clip board opens.
  // While it reads, the lock shows how far it is and about how long is left, and lifts by itself.
  // Once read, the video stays unlocked. A Make my clips run already going keeps its card (it reads
  // the video itself). Manual clips never wait for any of this: each clip's captions are its own.
  const aiLocked = isReady && reading?.status !== 'ready' && !autoRunning && !autoAsking
  /** About how long reading the whole video takes: measured on QA (2026-10-17), 8–17 s a minute of video */
  const readTotalMs = 30_000 + READ_MS_PER_MIN * Math.max(1, (video.duration_ms ?? 60_000) / 60_000)
  const readLeftMs = reading?.status === 'running' && reading.progress ? readTotalMs * (1 - reading.progress / 100) : readTotalMs
  const aiToolsLocked = (
    <div className={`relative ${wide ? 'flex flex-col gap-3' : 'md:col-span-2 h-full'}`} data-start-target="ai">
      {/* The tools themselves, greyed and out of reach until the transcript is in */}
      <div inert aria-hidden="true" className={`select-none pointer-events-none ${wide ? 'flex flex-col gap-3' : 'grid grid-cols-1 md:grid-cols-2 gap-4 h-full'}`}
        style={{ opacity: 0.32, filter: 'grayscale(0.7)' }}>
        {aiToolsOpen}
      </div>
      {/* The lock */}
      <div className="absolute inset-0 flex items-start justify-center px-3 pt-16">
        <div role="status" aria-live="polite" className="w-full max-w-[320px] flex flex-col gap-3 rounded-2xl p-4"
          style={{ background: 'rgba(14,14,14,0.94)', boxShadow: '0 0 0 1px rgb(var(--cb-fg) / 0.1), 0 18px 40px -12px rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)' }}>
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-xl grid place-items-center"
              style={{ background: 'rgba(200,255,0,0.1)', color: ACCENT, boxShadow: 'inset 0 0 0 1px rgba(200,255,0,0.25)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" />
              </svg>
            </span>
            <span className="flex flex-col">
              <span className="text-[13.5px] font-semibold text-white">Edit tools are locked</span>
              <span className="text-[11px]" style={{ color: 'rgb(var(--cb-fg) / 0.5)' }}>Make my clips · Best moments · Ask AI</span>
            </span>
          </div>
          {!reading ? (
            <p className="flex items-center gap-2 text-xs" style={{ color: 'rgb(var(--cb-fg) / 0.6)' }}><Spinner /> Checking your video…</p>
          ) : reading.status === 'running' ? (
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-[12.5px] font-semibold text-white">
                <Spinner /> Getting the transcript{reading.place ? ` · waiting its turn, ${inLineText(reading.place)}` : reading.progress ? ` · ${reading.progress}%` : '…'}
              </span>
              <span className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgb(var(--cb-fg) / 0.1)' }} aria-hidden="true">
                <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(3, reading.progress ?? 3)}%`, background: ACCENT }} />
              </span>
              <span className="text-[11.5px] leading-relaxed" style={{ color: 'rgb(var(--cb-fg) / 0.6)' }}>
                {waitingFor ? `${waitingFor} runs by itself when it's done. ` : ''}{minutesLeft(readLeftMs)} — the tools unlock by themselves.
                You can keep making clips by hand, or leave this page: it carries on.
              </span>
              <button type="button" onClick={stopReading} disabled={stopping}
                className="self-start h-8 px-3 rounded-lg text-[12px] font-semibold flex items-center gap-1.5 transition-colors hover:bg-[rgba(239,68,68,0.18)] disabled:opacity-50"
                style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.3)' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5" /></svg>
                {stopping ? 'Stopping…' : 'Stop'}
              </button>
            </div>
          ) : reading.status === 'failed' ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs" style={{ color: '#f87171' }}>{reading.error ?? 'Getting the transcript failed.'}</span>
              <button type="button" onClick={() => checkReading(true)} className="mmc-go h-10 rounded-xl text-[13px] font-semibold">Try again</button>
            </div>
          ) : (
            // Never read (Manual edit, or an older video): unlocking reads it
            <div className="flex flex-col gap-2.5">
              <p className="text-[11.5px] leading-relaxed" style={{ color: 'rgb(var(--cb-fg) / 0.6)' }}>
                {reading.stopped
                  ? <>Stopped{reading.progress ? ` at ${reading.progress}%` : ''}. Unlocking carries on from there — {aboutMinutes(readTotalMs * (1 - (reading.progress ?? 0) / 100))} left.</>
                  : <>These tools need your video&apos;s transcript. Getting it takes {aboutMinutes(readTotalMs)} for this video, once — then each tool answers in seconds.</>}
                {' '}Clips you make by hand don&apos;t need it.
              </p>
              <button type="button" onClick={() => checkReading(true)} className="mmc-go h-10 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 017.5-2" />
                </svg>
                Unlock edit tools
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
  const aiTools = aiLocked ? aiToolsLocked : aiToolsOpen

  return (
    <div className="cb-page h-screen flex flex-col overflow-hidden">
      {/* Opening a clip: covers the page while the clip is created and the editor loads */}
      {busy && <BrandLoaderScreen mascot overlay label="Getting your clip ready, please wait…" />}
      {/* Nav */}
      <nav className="cb-nav app-nav relative z-10 flex items-center gap-3 px-4 shrink-0" style={{ height: 56 }}>
        {/* Where am I: Shortcut | Dashboard › Clip board */}
        <Breadcrumbs shine items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Clip board' }]} />
        <div className="flex-1" />
        {/* The account's brand kits, in the popup (as on the dashboard — user, 2026-10-31) */}
        <button type="button" onClick={() => openBrandKits()} className="cb-brand-link" title="Your logo, colours and caption look — on every clip">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="13.5" cy="6.5" r="2" /><circle cx="17.5" cy="10.5" r="2" /><circle cx="8.5" cy="7.5" r="2" /><circle cx="6.5" cy="12.5" r="2" /><path d="M12 22a10 10 0 110-20 9 9 0 019 9c0 3-2 4-4 4h-2a2 2 0 00-1 3.7A2 2 0 0112 22z" /></svg>
          <span>Brand kits</span>
        </button>
        <ThemeSwitch />
        <AccountMenu />
      </nav>

      <div className="flex-1 flex gap-4 p-4 min-h-0 overflow-hidden">

        {/* ── Left: AI tools (wide screens) ─────────────────────── */}
        {wide && isReady && !manualOnly && (
          <aside className="cb-panel shrink-0 flex flex-col gap-3 p-3 min-h-0 overflow-y-auto" style={{ width: 340 }}>
            {aiTools}
          </aside>
        )}

        {/* ── Centre: the video, as large as fits, with the new-clip bar right under it ──
            (data-keep-clip-open: a click here — playing the clip preview, its arrows, Edit this
            clip — doesn't count as "outside" the open clip, so the preview stays) */}
        <main data-keep-clip-open className="cb-panel flex-1 min-w-0 flex flex-col gap-4 p-4 overflow-y-auto">
          {viewBar}
          {wide ? (
            // Container-query box: the player takes the biggest size (in the video's own shape) that fits both ways
            <div className="flex-1 min-h-0 flex items-center justify-center" style={{ containerType: 'size' }}>
              <div className="cb-player rounded-2xl overflow-hidden flex items-center justify-center bg-black"
                style={{ width: `min(100cqw, calc(100cqh * ${frameRatio}))`, aspectRatio: `${frameRatio}` }}>
                {/* The video stays mounted (hidden) while a clip previews, so it keeps its place */}
                <div className="w-full h-full flex items-center justify-center" style={{ display: viewMode === 'video' ? 'flex' : 'none' }}>{player}</div>
                {viewMode === 'preview' && previewPane}
              </div>
            </div>
          ) : (
            <div className="cb-player w-full rounded-2xl overflow-hidden flex items-center justify-center bg-black shrink-0"
              style={{ aspectRatio: `${frameRatio}`, maxHeight: '70vh', margin: '0 auto', width: `min(100%, calc(70vh * ${frameRatio}))` }}>
              <div className="w-full h-full flex items-center justify-center" style={{ display: viewMode === 'video' ? 'flex' : 'none' }}>{player}</div>
              {viewMode === 'preview' && previewPane}
            </div>
          )}

          {isReady && (manualOnly || editingPreviewed || editingMoment) && <div className="shrink-0 rounded-2xl" data-start-target="manual">{newClipBar}</div>}

          {!wide && isReady && !manualOnly && <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ height: 420 }}>{aiTools}</div>}
        </main>

        {/* ── Right: your clips ─────────────────────────────────── */}
        <aside className="cb-panel shrink-0 flex flex-col min-h-0 overflow-hidden" style={{ width: manualOnly ? 420 : 340 }}>
          <div className="px-4 pt-4 pb-3 flex items-center gap-2 shrink-0">
            <svg className="cb-head-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h4" />
            </svg>
            <h2 className="text-[15px] font-semibold text-white tracking-tight">Clipboard</h2>
            {(
              <span className="cb-count text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ color: ACCENT, background: 'rgba(200,255,0,0.1)', border: '1px solid rgba(200,255,0,0.25)' }}>
                {badgeCount} clip{badgeCount === 1 ? '' : 's'}
              </span>
            )}
            <div className="flex-1" />
            {(selecting || shownClips.length > 0) && (() => {
              const all = shownClips.length > 0 && shownClips.every(c => selected.has(c.id))
              return (
                <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer select-none" style={{ color: 'rgb(var(--cb-fg) / 0.75)' }}>
                  <input type="checkbox" checked={all}
                    onChange={() => {
                      if (all) { stopSelecting(); return }
                      setSelecting(true); setSelected(new Set(shownClips.map(c => c.id)))
                    }}
                    className="cb-check w-3.5 h-3.5 rounded" style={{ accentColor: ACCENT }} />
                  Select all
                </label>
              )
            })()}
          </div>
          {/* Sections: every clip, or only those from one place */}
          {(
            <div role="tablist" aria-label="Clip sections" className="px-4 pb-3 flex flex-wrap gap-1.5 shrink-0">
              {CLIP_TABS.filter(t => manualOnly ? (t.id === 'yours' || t.id === 'edited' || t.id === 'fav') : (t.id !== 'edited' && t.id !== 'yours')).map(t => {
                const n = t.id === 'all' ? boardClips.length : t.id === 'fav' ? boardClips.filter(c => c.favorite).length : t.id === 'edited' ? clips.filter(isEdited).length : clips.filter(c => c.origin === t.id).length
                const on = clipTab === t.id
                const dot = t.id === 'all' || t.id === 'fav' || t.id === 'edited' ? null : ORIGIN_BADGE[t.id].color
                return (
                  <button key={t.id} type="button" role="tab" aria-selected={on}
                    onClick={() => { setClipTab(t.id); setSelected(new Set()) }}
                    className="cb-tab flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold"
                    style={on ? undefined : { color: n ? 'rgb(var(--cb-fg) / 0.7)' : 'rgb(var(--cb-fg) / 0.35)' }}>
                    {dot && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />}
                    {t.id === 'fav' && <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.2C1 8 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 6 3.5 4.5 7.3C19.5 16.4 12 21 12 21z" /></svg>}
                    {t.label}
                    <span className="tabular-nums" style={{ opacity: 0.6 }}>{n}</span>
                  </button>
                )
              })}
            </div>
          )}
          {/* (brand kit Phase 2) a kit on every clip at once */}
          {/* (shown while selecting too: the kit then goes on the ticked clips only) */}
          <div className="px-4 pb-3 shrink-0"><BrandAllBar b={brands} total={boardClips.length} selected={selecting ? [...selected] : []} /></div>
          {clipError && (
            <div role="alert" className="mx-4 mb-2 px-3 py-2 rounded-lg flex items-center justify-between gap-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <span className="text-xs" style={{ color: '#f87171' }}>{clipError}</span>
              <button onClick={() => setClipError(null)} aria-label="Dismiss" className="shrink-0 px-1 rounded hover:bg-white/10" style={{ color: 'rgba(239,68,68,0.7)' }}>✕</button>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-2">
            {boardClips.length === 0 && !isReady && (
              <p className="text-xs leading-relaxed" style={{ color: 'rgb(var(--cb-fg) / 0.45)' }}>
                You can start clipping once the video has finished processing.
              </p>
            )}
            {boardClips.length > 0 && shownClips.length === 0 && (
              <p className="text-xs leading-relaxed" style={{ color: 'rgb(var(--cb-fg) / 0.45)' }}>
                {CLIP_TABS.find(t => t.id === clipTab)?.empty}
              </p>
            )}
            {shownClips.map(clip => (
              <ClipCard
                key={clip.id}
                id={clip.id}
                focused={focusClipId === clip.id}
                number={clip.index}
                origin={clipTab === 'all' || clipTab === 'fav' || clipTab === 'edited' ? clip.origin : undefined}
                videoUrl={videoUrl}
                favorite={!!clip.favorite}
                reason={clip.reason ?? null}
                onFavorite={() => toggleFavorite(clip.id)}
                onDelete={() => deleteOne(clip.id)}
                onSubEdited={() => router.refresh()}
                title={clip.title ?? `Clip ${clip.index}`}
                startMs={clip.start_ms}
                endMs={clip.end_ms}
                status={clip.status}
                outputUrl={clip.output_url}
                playing={nowMs >= clip.start_ms && nowMs < clip.end_ms}
                onSeek={() => seek(clip.start_ms)}
                onEdit={() => { setBusy('open'); router.push(editorHref(clip.id)) }}
                onPreview={() => openClip(clip)}
                previewing={viewMode === 'preview' && previewId === clip.id}
                open={previewId === clip.id}
                onClose={() => { setPreviewId(null); setViewMode('video') }}
                onDownload={() => downloadClip(clip.id)}
                manual={manualOnly}
                edited={manualOnly && isEdited(clip)}
                download={dlState[clip.id] === 'exporting' || clip.status === 'rendering' ? 'preparing'
                  : typeof dlState[clip.id] === 'object' ? 'failed' : 'ready'}
                disabled={!!busy}
                selecting={selecting}
                selected={selected.has(clip.id)}
                onToggle={() => toggleSelected(clip.id)}
                brandTag={<BrandTag b={brands} clipId={clip.id} />}
              />
            ))}
            {boardClips.length > 0 && !selecting && !manualOnly && (
              <div className="mt-1 shrink-0 flex items-start gap-2.5 px-3 py-2.5 rounded-xl" style={{ border: '1px solid rgba(200,255,0,0.25)', background: 'rgba(200,255,0,0.04)' }}>
                <svg className="shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 24 24" fill={ACCENT} aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" /></svg>
                <span className="flex flex-col">
                  <span className="text-xs font-semibold" style={{ color: ACCENT }}>Tip</span>
                  <span className="text-[11px] leading-relaxed" style={{ color: 'rgb(var(--cb-fg) / 0.55)' }}>Tap a clip to open it. You can preview, edit or download your clips anytime.</span>
                </span>
              </div>
            )}
          </div>

          {/* Select mode: what's ticked, and what to do with it */}
          {selecting && (() => {
            const allOn = shownClips.length > 0 && shownClips.every(c => selected.has(c.id))
            return (
              <div className="shrink-0 px-4 py-3 flex flex-col gap-2" style={{ borderTop: PANEL_LINE, background: PANEL_BG }} role="toolbar" aria-label="Selected clips">
                {deleteError && !confirmDelete && <p role="alert" className="text-xs" style={{ color: '#f87171' }}>{deleteError}</p>}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white flex-1" aria-live="polite">
                    {selected.size === 0 ? 'Tap clips to select them' : `${selected.size} selected`}
                  </span>
                  <button type="button" onClick={() => setSelected(allOn ? new Set() : new Set(shownClips.map(c => c.id)))}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-white/10" style={{ color: 'rgb(var(--cb-fg) / 0.75)' }}>
                    {allOn ? 'Clear' : 'Select all'}
                  </button>
                  <button type="button" disabled={selected.size === 0} onClick={() => { setDeleteError(null); setConfirmDelete(true) }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 transition-opacity hover:opacity-90"
                    style={{ background: '#ef4444', color: '#fff' }}>
                    Delete{selected.size > 0 ? ` ${selected.size}` : ''}
                  </button>
                </div>
              </div>
            )
          })()}
        </aside>
      </div>

      {confirmDelete && (() => {
        const n = selected.size
        const exported = clips.filter(c => selected.has(c.id) && c.status === 'done').length
        return (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
            onClick={() => { if (!deleting) setConfirmDelete(false) }}>
            <div role="alertdialog" aria-modal="true" aria-labelledby="clip-delete-title" onClick={e => e.stopPropagation()}
              className="w-full max-w-[400px] rounded-2xl p-6" style={{ background: 'var(--cb-pop)', border: '1px solid rgb(var(--cb-fg) / 0.12)', boxShadow: '0 40px 100px -30px rgba(0,0,0,0.8)' }}>
              <h2 id="clip-delete-title" className="text-lg font-black text-white">Delete {n === 1 ? 'this clip' : `${n} clips`}?</h2>
              <p className="text-sm mt-2 leading-relaxed" style={{ color: 'rgb(var(--cb-fg) / 0.6)' }}>
                {n === 1 ? 'The clip and its edits are' : `The clips and their edits are`} removed permanently
                {exported > 0 ? `, including ${exported === 1 ? 'an exported video' : `${exported} exported videos`}` : ''}.
                The original video stays. This can&apos;t be undone.
              </p>
              {deleteError && <p role="alert" className="text-xs mt-3" style={{ color: '#f87171' }}>{deleteError}</p>}
              <div className="flex justify-end gap-2 mt-5">
                <button type="button" autoFocus disabled={deleting} onClick={() => setConfirmDelete(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-50" style={{ color: 'rgb(var(--cb-fg) / 0.8)' }}>
                  Cancel
                </button>
                <button type="button" disabled={deleting} onClick={deleteSelected}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-60 transition-opacity hover:opacity-90" style={{ background: '#ef4444', color: '#fff' }}>
                  {deleting ? <><Spinner /> Deleting</> : n === 1 ? 'Delete' : `Delete ${n} clips`}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────────

/**
 * A time box in three fixed parts — hours : minutes : seconds. The colons belong to the box: they
 * can't be typed or deleted. Two digits move on to the next part (hours → minutes → seconds), as
 * does ":" or "."; Backspace in an empty part goes back; ↑ / ↓ step a part; a pasted time
 * (1:42:08 or 4:05) fills all three. Empty parts count as 00.
 * Under an hour of video (`showHours` false) the hours part isn't shown: the box reads 4:05.
 * `nextId`: the time field to go on to once the seconds are typed (Start → End).
 */
function TimeField({ id, label, value, onChange, showHours = true, nextId, prevId }: { id: string; label: string; value: string; onChange: (v: string) => void; showHours?: boolean; nextId?: string; /** ← from the first part goes back to this field's seconds */ prevId?: string }) {
  type Parts = [string, string, string]
  const pad = (n: number) => String(n).padStart(2, '0')
  const split = (v: string): Parts => {
    const ms = v.trim() ? parseTime(v) : null
    if (ms == null) return ['', '', '']
    const t = Math.floor(ms / 1000)
    return [pad(Math.floor(t / 3600)), pad(Math.floor((t % 3600) / 60)), pad(t % 60)]
  }
  const join = (p: Parts) => (p.every(x => !x) ? '' : `${Number(p[0] || 0)}:${pad(Number(p[1] || 0))}:${pad(Number(p[2] || 0))}`)
  const [parts, setParts] = useState<Parts>(() => split(value))
  // The parts as they are right now. Every handler reads this, never `parts` from its render: a part
  // completed by a key moves the focus on at once, and the blur that follows (which pads a single
  // digit) ran with the parts from before that key — it turned a typed 23 back into 02.
  const live = useRef<Parts>(parts)
  // A new time from outside (Now, a picked moment): shown in the parts
  const sent = useRef(value)
  useEffect(() => {
    if (value === sent.current) return
    sent.current = value
    live.current = split(value)
    setParts(live.current)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const go = (i: number, at: 'all' | 'end' = 'all') => {
    const el = refs[i]?.current
    if (!el) return
    el.focus()
    requestAnimationFrame(() => (at === 'all' ? el.select() : el.setSelectionRange(el.value.length, el.value.length)))
  }
  /** The seconds are done: on to the next time field's first part (Start → End), or stay selected */
  const finish = (el: HTMLInputElement | null) => {
    const next = nextId ? document.getElementById(`${nextId}-${'hms'[first]}`) as HTMLInputElement | null : null
    if (next) { next.focus(); requestAnimationFrame(() => next.select()) }
    else requestAnimationFrame(() => el?.select())
  }
  const put = (next: Parts) => {
    live.current = next
    setParts(next)
    const out = join(next)
    sent.current = out
    onChange(out)
  }
  const max = (i: number) => (i === 0 ? 99 : 59)
  /** The first part shown (minutes when there are no hours) */
  const first = showHours ? 0 : 1
  // What's been typed into a part since it was entered: its first digit always starts it afresh
  // (whatever the part held, wherever a click put the cursor); the second completes it and moves on
  const typing = useRef<{ i: number; buf: string } | null>(null)
  function digit(i: number, d: string) {
    const buf = (typing.current?.i === i ? typing.current.buf : '') + d
    const next = [...live.current] as Parts
    let done = false
    if (buf.length === 1) {
      // Minutes and seconds: a first digit 6–9 can only be 06–09, so it's complete
      if (i > 0 && Number(d) > 5) { next[i] = pad(Number(d)); done = true }
      else { next[i] = buf; typing.current = { i, buf } }
    } else {
      next[i] = pad(Math.min(max(i), Number(buf)))
      done = true
    }
    put(next)
    if (done) {
      typing.current = null
      if (i < 2) go(i + 1)
      else finish(refs[i].current)
    }
  }

  function type(i: number, raw: string) {
    let d = raw.replace(/\D/g, '')
    if (d.length > 2) d = d.slice(-2)
    let done = d.length === 2
    // Minutes and seconds never go past 59: a first digit 6–9 is that many, and moves on
    if (i > 0 && d.length === 1 && Number(d) > 5) { d = `0${d}`; done = true }
    if (d.length === 2 && Number(d) > max(i)) d = pad(max(i))
    const next = [...live.current] as Parts
    next[i] = d
    put(next)
    if (done && i < 2) go(i + 1)
    else if (done) finish(refs[i].current)
  }
  function key(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    const el = e.currentTarget
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0
    // Digits are taken here (two make the part), not left to the browser's cursor
    if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); digit(i, e.key); return }
    if (e.key === 'Backspace' && typing.current?.i === i) {
      e.preventDefault()
      typing.current = null
      const next = [...live.current] as Parts
      next[i] = ''
      put(next)
      return
    }
    if (e.key === ':' || e.key === '.' || e.key === ' ') { e.preventDefault(); if (i < 2) go(i + 1); return }
    if (e.key === 'Backspace' && (!el.value || atStart) && i > first) { e.preventDefault(); go(i - 1, 'end'); return }
    // ← → step from part to part, wherever the cursor is (a part is only two digits) — and across:
    // → from Start's seconds goes on to End, ← from End's first part back to Start's seconds
    if (e.key === 'ArrowLeft' && !e.shiftKey) {
      e.preventDefault()
      if (i > first) go(i - 1)
      else {
        const prev = prevId ? document.getElementById(`${prevId}-s`) as HTMLInputElement | null : null
        if (prev) { prev.focus(); requestAnimationFrame(() => prev.select()) }
      }
      return
    }
    if (e.key === 'ArrowRight' && !e.shiftKey) {
      e.preventDefault()
      if (i < 2) go(i + 1); else finish(el)
      return
    }
    // Enter anywhere in Start goes on to the End time
    if (nextId && e.key === 'Enter') { e.preventDefault(); finish(el); return }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const n = (Number(live.current[i] || 0) + (e.key === 'ArrowUp' ? 1 : -1) + max(i) + 1) % (max(i) + 1)
      const next = [...live.current] as Parts
      next[i] = pad(n)
      put(next)
      requestAnimationFrame(() => el.select())
    }
  }
  function paste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text').trim()
    if (!text.includes(':') || parseTime(text) == null) return
    e.preventDefault()
    put(split(text))
  }
  const names = ['hours', 'minutes', 'seconds']
  return (
    <div className="cb-input flex items-center justify-center h-[52px] px-3 rounded-xl">
      <div className="min-w-0 flex flex-col items-center justify-center">
        <label htmlFor={`${id}-${'hms'[first]}`} className="text-[10px] font-semibold uppercase leading-none" style={{ color: 'rgb(var(--cb-fg) / 0.45)', letterSpacing: '0.08em' }}>{label}</label>
        <div className="flex items-center mt-[5px] text-[18px] font-semibold tabular-nums leading-none text-white">
          {parts.map((p, i) => {
            if (i < first) return null
            // Read as one time, as on a clock: the parts close in on the ":" (the first one only as wide
            // as its digits, so the time sits in the middle under the label)
            const shown = i === first && !showHours && p.startsWith('0') && p.length === 2 ? p.slice(1) : p
            const lone = i === first && !showHours
            return (
            <span key={i} className="flex items-center">
              {i > first && <span aria-hidden="true" className="select-none mx-[3px] -translate-y-px" style={{ color: 'rgb(var(--cb-fg) / 0.55)' }}>:</span>}
              <input ref={refs[i]} id={`${id}-${'hms'[i]}`} type="text" inputMode="numeric" autoComplete="off"
                aria-label={`${label} ${names[i]}`} placeholder={lone ? '0' : '00'} value={shown}
                onChange={e => type(i, e.target.value)} onKeyDown={e => key(i, e)} onPaste={paste}
                // (a phone keyboard's action key: "next" moves on, as Enter does here)
                enterKeyHint={nextId ? 'next' : 'done'}
                onFocus={e => { typing.current = null; e.currentTarget.select() }}
                // (the click that focused it would otherwise drop the selection and leave the cursor in the old digits)
                onMouseUp={e => e.preventDefault()}
                onBlur={() => { const cur = live.current; if (cur[i].length === 1) { const next = [...cur] as Parts; next[i] = pad(Number(cur[i])); put(next) } }}
                // The part being typed in: a plain light pill, instead of the browser's blue selection
                className="bg-transparent outline-none rounded-md py-0.5 placeholder:text-white/30 focus:bg-white/15 selection:bg-transparent selection:text-white transition-colors"
                style={{ width: lone ? `${Math.max(1, shown.length) + 0.4}ch` : '2.4ch', textAlign: i === first ? 'right' : i === 2 ? 'left' : 'center' }} />
            </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** A small "✕ Cancel" for a running AI search */
function CancelButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors hover:bg-white/10 hover:text-white"
      style={{ color: 'rgb(var(--cb-fg) / 0.7)', border: '1px solid rgb(var(--cb-fg) / 0.16)' }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
      Cancel
    </button>
  )
}

function Spinner() {
  return <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
}

/** A clip's picture: a frame from its start, with its number on it */
function ClipThumb({ videoUrl, atMs, number, w, h }: { videoUrl: string; atMs: number; number?: number; w: number; h: number }) {
  const src = useFrameAt(videoUrl, atMs)
  return (
    <span className="cb-thumb relative shrink-0 block rounded-[10px] overflow-hidden" style={{ width: w, height: h, background: 'rgb(var(--cb-fg) / 0.06)' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt="" className="w-full h-full object-cover" />}
      {number != null && (
        <span className="absolute left-1 top-1 min-w-5 h-5 px-1 rounded-md flex items-center justify-center text-[11px] font-bold tabular-nums"
          style={{ background: 'rgba(0,0,0,0.72)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)' }}>{number}</span>
      )}
    </span>
  )
}

const ClockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
)
function Heart({ on }: { on: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={on ? ACCENT : 'none'} stroke={on ? ACCENT : 'currentColor'} strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7.5-4.6-9.5-9.2C1 8 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 6 3.5 4.5 7.3C19.5 16.4 12 21 12 21z" />
    </svg>
  )
}

/**
 * An Ask AI / Best moments result, like a clip card: slim (picture, title, length, +) until clicked;
 * clicked, it opens and plays in Preview with Preview · Edit · Add. Clicking it again closes it.
 */
function ResultCard({ s, rank, videoUrl, busy, inClips, open, onOpen, onClose, onEdit, onAdd }: {
  s: Suggestion; rank: number; videoUrl: string; busy: string | null
  /** Already a clip on the board (Add then shows it there) */
  inClips: boolean
  open: boolean
  onOpen: () => void; onClose: () => void; onEdit: () => void; onAdd: () => void
}) {
  const working = busy === s.id
  const score = typeof s.score === 'number' && (
    <span title="Viral score (0–99)" className="shrink-0 px-1.5 py-px rounded-md text-[10px] font-bold tabular-nums"
      style={{ color: ACCENT, background: 'rgba(200,255,0,0.1)', border: '1px solid rgba(200,255,0,0.25)' }}>{s.score}</span>
  )
  const addIcon = inClips
    ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
  const click = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    if (open) onClose(); else onOpen()
  }
  const keys = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); if (open) onClose(); else onOpen() }
  }

  if (!open) {
    return (
      <div role="button" tabIndex={0} onClick={click} onKeyDown={keys} title={`${s.title} · click to preview`}
        className="shrink-0 flex items-center gap-3 rounded-xl p-2 min-h-[68px] cursor-pointer transition-colors hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2"
        style={{ background: 'rgb(var(--cb-fg) / 0.03)', border: '1px solid rgb(var(--cb-fg) / 0.07)', outlineColor: ACCENT }}>
        <ClipThumb videoUrl={videoUrl} atMs={s.start_ms} number={rank} w={84} h={48} />
        <span className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="text-sm font-semibold text-white leading-snug line-clamp-2 break-words">{s.title}</span>
          <span className="flex items-center gap-1.5 text-[11px] tabular-nums" style={{ color: 'rgb(var(--cb-fg) / 0.5)' }}>
            <ClockIcon />{durLabel(s.start_ms, s.end_ms)}
            {score}
          </span>
        </span>
        <button type="button" onClick={onAdd} disabled={!!busy} aria-label={inClips ? 'In your clips — show it' : 'Add to your clips'}
          title={inClips ? 'In your clips — show it' : 'Add to your clips'}
          className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-opacity hover:opacity-90 disabled:opacity-40"
          style={inClips ? { color: ACCENT, border: `1px solid ${ACCENT}` } : { background: ACCENT, color: '#000' }}>
          {working ? <Spinner /> : addIcon}
        </button>
      </div>
    )
  }

  return (
    <div role="button" tabIndex={0} onClick={click} onKeyDown={keys} title="Click to close"
      className="shrink-0 rounded-xl p-2.5 cursor-pointer transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2"
      style={{ background: 'rgba(200,255,0,0.03)', border: `1px solid ${ACCENT}`, outlineColor: ACCENT }}>
      <div className="flex items-start gap-3">
        <ClipThumb videoUrl={videoUrl} atMs={s.start_ms} number={rank} w={112} h={64} />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <p className="text-sm font-semibold text-white leading-snug line-clamp-2" title={s.title}>{s.title}</p>
          <span className="flex items-center gap-1.5 text-xs tabular-nums" style={{ color: 'rgb(var(--cb-fg) / 0.65)' }}>
            <ClockIcon />{msToDisplay(s.start_ms)} – {msToDisplay(s.end_ms)}
            <span style={{ color: 'rgb(var(--cb-fg) / 0.35)' }}>· {durLabel(s.start_ms, s.end_ms)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            {score}
            {inClips && <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: ACCENT }}>✓ In your clips</span>}
          </span>
        </div>
      </div>
      {(s.summary || s.reason) && (
        <p className="mt-2 text-[11px] leading-relaxed line-clamp-3" style={{ color: 'rgb(var(--cb-fg) / 0.5)' }}>{s.summary || s.reason}</p>
      )}
      {/* Preview (playing now) · Edit · Add */}
      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        <span className="h-8 flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold"
          style={{ color: ACCENT, border: '1px solid rgba(200,255,0,0.5)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
          Previewing
        </span>
        <button type="button" onClick={onEdit} disabled={!!busy} title={inClips ? 'Open this clip in the editor' : 'Make it a clip and open it in the editor'}
          className="h-8 flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-white/10 disabled:opacity-40"
          style={{ color: 'rgb(var(--cb-fg) / 0.85)', border: '1px solid rgb(var(--cb-fg) / 0.14)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
          Edit
        </button>
        <button type="button" onClick={onAdd} disabled={!!busy} title={inClips ? 'Show it in your clips' : 'Add it to your clip board'}
          className="h-8 flex items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
          style={inClips ? { color: ACCENT, border: `1px solid ${ACCENT}` } : { background: ACCENT, color: '#000' }}>
          {working ? <Spinner /> : addIcon}
          {inClips ? 'Added' : 'Add'}
        </button>
      </div>
    </div>
  )
}

/**
 * Sub-edit of one clip: start it, and follow it until the worker is done (every few seconds).
 * A Sub-edit already running when the board opens is picked up.
 */
function useSubEdit(clipId: string, onDone?: () => void) {
  const [state, setState] = useState<'none' | 'queued' | 'processing' | 'done' | 'failed' | 'stopped'>('none')
  const [error, setError] = useState<string | null>(null)
  // About how long the work takes, when the worker started on it (this browser's clock, from the
  // server's elapsed), and how many jobs are ahead while it waits for the worker
  const [estimate, setEstimate] = useState<number | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [ahead, setAhead] = useState<number | null>(null)
  const busy = state === 'queued' || state === 'processing'
  const url = `/api/clips/${clipId}/subjects/auto`
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  // The state as last seen (to notice it finishing outside a state update: the board's refresh
  // must never run while React is rendering)
  const stateRef = useRef(state)
  stateRef.current = state
  const check = useCallback(async () => {
    try {
      const res = await fetch(url)
      if (!res.ok) return
      const data = await res.json() as { status: typeof state; error: string | null; elapsed_ms: number | null; ahead: number | null; estimate_ms: number }
      const was = stateRef.current
      stateRef.current = data.status
      setState(data.status)
      if ((was === 'queued' || was === 'processing') && data.status === 'done') doneRef.current?.()
      setError(data.status === 'failed' ? data.error : null)
      setEstimate(data.estimate_ms)
      setAhead(data.ahead)
      setStartedAt(data.elapsed_ms !== null ? Date.now() - data.elapsed_ms : null)
    } catch { /* offline for a moment: the next check */ }
  }, [url])
  useEffect(() => { check() }, [check])
  usePolling(check, busy)
  async function start() {
    setError(null)
    setState('queued')
    setStartedAt(null)
    try {
      const res = await fetch(url, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setState('failed'); setError(data.error ?? 'Sub-edit could not start. Try again.'); return }
      setState(data.status ?? 'queued')
      if (data.estimate_ms) setEstimate(data.estimate_ms)
      setAhead(typeof data.ahead === 'number' ? data.ahead : null)
      setStartedAt(typeof data.elapsed_ms === 'number' ? Date.now() - data.elapsed_ms : null)
    } catch { setState('failed'); setError('Sub-edit could not start. Check the connection and try again.') }
  }
  /** Stop it: one waiting never starts, one running stops within a couple of seconds */
  async function stop() {
    const was = stateRef.current
    stateRef.current = 'stopped'
    setState('stopped')
    setError(null)
    try {
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) throw new Error()
    } catch {
      stateRef.current = was
      setState(was)
      setError('Sub-edit could not be stopped. Try again.')
    }
  }
  return { state, busy, error, start, stop, estimate, startedAt, ahead }
}

/** "about 45 s" / "about 1 min 20 s" */
/** Reading a video's whole transcript: about this long per minute of video (QA, 2026-10-17: 8–17 s) */
const READ_MS_PER_MIN = 15_000
/** "about 9 min" (a minute or more), "under a minute" */
function aboutMinutes(ms: number) {
  return ms < 60_000 ? 'under a minute' : `about ${Math.round(ms / 60_000)} min`
}
/** "About 4 min left", "Under a minute left" */
function minutesLeft(ms: number) {
  const t = aboutMinutes(ms)
  return `${t[0].toUpperCase()}${t.slice(1)} left`
}

function aboutLabel(ms: number) {
  const s = ms < 30_000 ? Math.max(1, Math.round(ms / 1000)) : Math.round(ms / 5000) * 5
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`
}

/** The slim card's line while Sub-edit runs: "Sub-editing · about 40 s left" */
function SubEditInline({ startedAt, estimate, ahead, onStop }: { startedAt: number | null; estimate: number | null; ahead: number | null; onStop: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const left = (estimate ?? 30_000) - (startedAt === null ? 0 : Math.max(0, now - startedAt))
  return (
    <span className="flex items-center gap-1" style={{ color: ACCENT }}>
      · <Spinner /> {startedAt === null
        ? `Waiting for the worker${ahead ? ` · ${ahead} ahead` : ''}`
        : `Sub-editing${left > 3000 ? ` · about ${aboutLabel(left)} left` : ' · almost done'}`}
      <button type="button" onClick={e => { e.stopPropagation(); onStop() }} title="Stop the Sub-edit"
        className="ml-1 px-1.5 rounded text-[10.5px] font-semibold hover:bg-white/10" style={{ color: '#f87171' }}>Stop</button>
    </span>
  )
}

/**
 * Over the clip card while Sub-edit runs: what it's doing, the time left (from the estimate) and a
 * bar that fills with it. Past the estimate it says it's nearly there.
 */
function SubEditOverlay({ startedAt, estimate, ahead, onStop }: { startedAt: number | null; estimate: number | null; ahead: number | null; onStop: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const total = estimate ?? 30_000
  // Waiting for the worker (other jobs ahead): no countdown until it starts on this one
  const waiting = startedAt === null
  const elapsed = waiting ? 0 : Math.max(0, now - startedAt)
  const share = waiting ? 0 : Math.min(0.97, elapsed / total)
  const left = total - elapsed
  const step = waiting ? `Waiting for the worker${ahead ? ` · ${ahead} job${ahead === 1 ? '' : 's'} ahead` : ''}`
    : share < 0.3 ? 'Reading the video' : share < 0.75 ? 'Finding the people and who talks when' : 'Framing the clip on whoever is talking'
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[inherit] px-4 text-center"
      style={{ background: 'rgba(10,10,10,0.86)', backdropFilter: 'blur(2px)' }} role="status" aria-live="polite"
      onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-2 text-sm font-bold" style={{ color: ACCENT }}>
        <Spinner /> Sub-editing
      </div>
      <p className="text-[11.5px]" style={{ color: 'rgb(var(--cb-fg) / 0.75)' }}>{step}…</p>
      <div className="w-full max-w-[220px] h-1.5 rounded-full overflow-hidden" style={{ background: 'rgb(var(--cb-fg) / 0.12)' }}>
        <div className="h-full rounded-full transition-[width] duration-1000 ease-linear" style={{ width: `${Math.round(share * 100)}%`, background: ACCENT }} />
      </div>
      <p className="text-[11px] tabular-nums" style={{ color: 'rgb(var(--cb-fg) / 0.55)' }}>
        {waiting ? `Then about ${aboutLabel(total)}` : left > 3000 ? `About ${aboutLabel(left)} left` : 'Almost done…'} · you can keep working
      </p>
      <button type="button" onClick={e => { e.stopPropagation(); onStop() }}
        className="mt-1 h-7 px-3 rounded-lg text-[11.5px] font-semibold transition-colors hover:bg-[rgba(239,68,68,0.15)]"
        style={{ color: '#f87171', border: '1px solid rgba(239,68,68,0.45)' }}>
        Stop
      </button>
    </div>
  )
}

function ClipCard({ id, focused, number, origin, title, startMs, endMs, status, outputUrl, playing, onSeek, onEdit, onPreview, previewing, open, onClose, disabled, selecting, selected, onToggle, videoUrl, favorite, reason, onFavorite, onDelete, onDownload, download, onSubEdited, manual, edited, brandTag }: {
  id: string
  /** (brand kit Phase 2) its brand kit's tag, in the row of labels */
  brandTag?: React.ReactNode
  /** Manual edit board: the slim card shows its start–end and Edit / Download on hover */
  manual?: boolean
  /** Manual edit board: opened in the editor already (a small green label) */
  edited?: boolean
  /** Sub-edit finished: the clip's framing changed (the board reloads it) */
  onSubEdited?: () => void
  /** Download: saves the file, exporting it first if it isn't exported yet (e.g. AI's clips) */
  onDownload: () => void
  /** preparing: exporting, saves by itself when ready · failed: the last try didn't work */
  download: 'ready' | 'preparing' | 'failed'
  videoUrl: string
  favorite: boolean
  /** Why AI picked it (Make my clips), when we have it */
  reason: string | null
  onFavorite: () => void
  onDelete: () => void
  /** Clicking the opened card again: it closes back to the slim card (and the preview closes) */
  onClose?: () => void
  /** The opened card (the one being previewed): everything shows. The others are slim */
  open?: boolean
  onPreview: () => void
  previewing?: boolean
  /** Just jumped to (e.g. from Best moments): shown open, outlined for a moment */
  focused?: boolean
  number: number
  /** Shown in "All clips" / "Favorites": which section the clip belongs to */
  origin?: ClipOrigin
  title: string
  startMs: number
  endMs: number
  status: string
  outputUrl: string | null
  playing: boolean
  onSeek: () => void
  onEdit: () => void
  disabled?: boolean
  /** Select mode: the whole card toggles its tick */
  selecting?: boolean
  selected?: boolean
  onToggle?: () => void
}) {
  // The delete button's "Delete this clip?" (no ⋯ menu: Edit and the time line cover the rest)
  const [menu, setMenu] = useState<false | 'confirm'>(false)
  const sub = useSubEdit(id, onSubEdited)
  // Opened: a click anywhere outside the card closes it again (not while picking clips, nor in its
  // own pop-ups, nor on the centre panel where it is being previewed: data-keep-clip-open)
  useEffect(() => {
    if (!open || selecting) return
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (!t || t.closest(`#clip-${CSS.escape(id)}`) || t.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [data-keep-clip-open]')) return
      onClose?.()
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open, selecting, id, onClose])
  const chip =
    status === 'rendering' ? { label: 'Rendering', color: ACCENT } :
    status === 'done' ? { label: 'Exported', color: '#4ade80' } :
    status === 'failed' ? { label: 'Render failed', color: '#f87171' } :
    { label: 'Draft', color: 'rgb(var(--cb-fg) / 0.45)' }
  const heart = (
    <button type="button" onClick={e => { e.stopPropagation(); onFavorite() }} aria-pressed={favorite}
      aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'} title={favorite ? 'Remove from favorites' : 'Add to favorites'}
      className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-white/10" style={{ color: 'rgb(var(--cb-fg) / 0.6)' }}>
      <Heart on={favorite} />
    </button>
  )

  // Slim: picture, title, length and the heart; clicking it opens it (and its preview). Pointed at
  // (or tabbed into), Edit · Download · Delete slide open under it, in CSS: the card itself stays
  // as it is (it used to be swapped for the full card, which rebuilt its picture and jumped)
  if (!open && !focused && !selecting) {
    return (
      <div id={`clip-${id}`} role="button" tabIndex={0}
        onClick={e => { if (!disabled && !(e.target as HTMLElement).closest('button')) onPreview() }}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !disabled && e.target === e.currentTarget) { e.preventDefault(); onPreview() } }}
        title={`${title} · click to open and preview`}
        data-playing={playing || undefined}
        className="cb-card cb-sheen group shrink-0 flex items-center gap-3 p-2.5 min-h-[72px] cursor-pointer focus-visible:outline focus-visible:outline-2"
        style={{ outlineColor: ACCENT }}>
        <ClipThumb videoUrl={videoUrl} atMs={startMs} number={number} w={84} h={48} />
        <span className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="flex items-start gap-2">
            <span className="flex-1 min-w-0 text-sm font-semibold text-white leading-snug line-clamp-2 break-words">{title}</span>
            {/* ♡ and 🗑, a pair at the top right; the bin slides in beside the heart while the card is pointed at */}
            <span className="cb-tools -mt-1 -mr-1">
              <button type="button" onClick={e => { e.stopPropagation(); setMenu(m => (m ? false : 'confirm')) }} aria-expanded={!!menu}
                className="cb-tool cb-tool-hide cb-tool-bin" data-tone="danger" data-on={menu ? '' : undefined} aria-label="Delete clip" title="Delete clip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path className="cb-bin-lid" d="M3 6h18M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></svg>
              </button>
              <button type="button" onClick={e => { e.stopPropagation(); onFavorite() }} aria-pressed={favorite} className="cb-tool cb-tool-heart" data-on={favorite ? '' : undefined}
                aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'} title={favorite ? 'Remove from favorites' : 'Add to favorites'}>
                <Heart on={favorite} />
              </button>
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] tabular-nums" style={{ color: 'rgb(var(--cb-fg) / 0.5)' }}>
            <ClockIcon />{manual ? <><span className="cb-range" style={{ color: ACCENT }}>{msToDisplay(startMs)} – {msToDisplay(endMs)}</span> · {durLabel(startMs, endMs)}</> : durLabel(startMs, endMs)}
            {edited && (
              <span className="cb-edited px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide" style={{ color: ACCENT, background: 'rgba(200,255,0,0.12)' }}>Edited</span>
            )}
            {status === 'rendering' && <span className="flex items-center gap-1" style={{ color: ACCENT }}>· <Spinner /> Exporting</span>}
            {sub.busy && <SubEditInline startedAt={sub.startedAt} estimate={sub.estimate} ahead={sub.ahead} onStop={sub.stop} />}
          </span>
          <span className="cb-reveal" data-open={menu ? '' : undefined}>
            <span className="cb-reveal-in">
              {menu ? (
                <span className="flex items-center gap-1.5 pt-2" onClick={e => e.stopPropagation()}>
                  <span className="text-[11px] text-white mr-auto">Delete this clip?</span>
                  <button type="button" onClick={() => setMenu(false)} autoFocus className="cb-act">Cancel</button>
                  <button type="button" onClick={() => { setMenu(false); onDelete() }} className="cb-act" data-tone="danger">Delete</button>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 pt-2">
                  <button type="button" onClick={e => { e.stopPropagation(); onEdit() }} disabled={disabled} className="cb-act" title="Open in the editor">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
                    Edit
                  </button>
                  <button type="button" onClick={e => { e.stopPropagation(); onDownload() }} disabled={download === 'preparing'} className="cb-act"
                    data-tone={download === 'failed' ? 'danger' : undefined}
                    title={download === 'preparing' ? 'Exporting — it downloads by itself when ready' : download === 'failed' ? 'The export failed — try again' : 'Download this clip'}>
                    {download === 'preparing' ? <Spinner /> : (
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 2v7M4 7l3 3 3-3M2 11.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    )}
                    {download === 'preparing' ? 'Preparing' : download === 'failed' ? 'Retry' : 'Download'}
                  </button>
                </span>
              )}
            </span>
          </span>
        </span>
      </div>
    )
  }

  return (
    <div id={`clip-${id}`} data-playing={playing || undefined} data-on={selected || focused || previewing || undefined}
      className={`cb-card relative p-2.5 ${focused ? 'shadow-[0_0_0_3px_rgba(200,255,0,0.25)]' : ''} ${selecting ? 'cursor-pointer select-none focus-visible:outline focus-visible:outline-2' : 'cursor-pointer'}`}
      style={{ ...(selected ? { background: 'rgba(200,255,0,0.06)' } : {}), outlineColor: ACCENT }}
      {...(selecting ? {
        role: 'checkbox',
        'aria-checked': !!selected,
        'aria-label': `Select ${title}`,
        tabIndex: 0,
        onClick: onToggle,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle?.() } },
      } : {
        // Clicking the card (not one of its buttons): opened → closes back to the slim card; else previews it
        onClick: (e: React.MouseEvent) => {
          if (disabled || (e.target as HTMLElement).closest('button, a, input, label')) return
          if (open && onClose) onClose(); else onPreview()
        },
        title: open ? 'Click to close' : 'Click to preview this clip',
      })}>
      {sub.busy && !selecting && <SubEditOverlay startedAt={sub.startedAt} estimate={sub.estimate} ahead={sub.ahead} onStop={sub.stop} />}
      <div className="flex items-start gap-3">
        {selecting ? (
          <span aria-hidden="true" className="shrink-0 mt-1 w-6 h-6 rounded-full flex items-center justify-center transition-colors"
            style={selected
              ? { background: ACCENT, border: `2px solid ${ACCENT}`, color: '#000' }
              : { background: 'transparent', border: '2px solid rgb(var(--cb-fg) / 0.45)' }}>
            {selected && <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </span>
        ) : null}
        <ClipThumb videoUrl={videoUrl} atMs={startMs} number={number} w={112} h={64} />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-start gap-1">
            <p className="flex-1 min-w-0 text-sm font-semibold text-white leading-snug line-clamp-2" title={title}>{title}</p>
            {!selecting && heart}
            {!selecting && (
              <span className="relative shrink-0">
                <button type="button" onClick={e => { e.stopPropagation(); setMenu(m => m ? false : 'confirm') }} aria-label="Delete clip" title="Delete clip"
                  aria-expanded={!!menu}
                  className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-red-500/15 hover:text-red-400" style={{ color: menu ? '#f87171' : 'rgb(var(--cb-fg) / 0.6)' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></svg>
                </button>
                {menu && (
                  <span className="absolute right-0 top-8 z-20 flex flex-col p-1 rounded-lg min-w-[150px]" onClick={e => e.stopPropagation()}
                    style={{ background: 'var(--cb-pop)', border: '1px solid rgb(var(--cb-fg) / 0.12)', boxShadow: '0 12px 30px -8px rgba(0,0,0,0.8)' }}>
                    <span className="px-2.5 py-1.5 text-xs text-white">Delete this clip?</span>
                    <span className="flex gap-1 px-1 pb-1">
                      <button type="button" onClick={() => setMenu(false)} autoFocus className="flex-1 px-2 py-1 rounded-md text-xs hover:bg-white/10" style={{ color: 'rgb(var(--cb-fg) / 0.7)' }}>Cancel</button>
                      <button type="button" onClick={() => { setMenu(false); onDelete() }} className="flex-1 px-2 py-1 rounded-md text-xs font-semibold" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>Delete</button>
                    </span>
                  </span>
                )}
              </span>
            )}
          </div>
          <button type="button" onClick={e => { e.stopPropagation(); onSeek() }} title="Play this clip in the video"
            className="self-start flex items-center gap-1.5 text-xs tabular-nums transition-colors hover:text-white" style={{ color: 'rgb(var(--cb-fg) / 0.65)' }}>
            <ClockIcon />{msToDisplay(startMs)} – {msToDisplay(endMs)}
            <span style={{ color: 'rgb(var(--cb-fg) / 0.35)' }}>· {durLabel(startMs, endMs)}</span>
          </button>
          <div className="flex items-center gap-1.5 flex-wrap">
            {origin && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
                style={{ color: ORIGIN_BADGE[origin].color, background: 'rgb(var(--cb-fg) / 0.05)', border: '1px solid rgb(var(--cb-fg) / 0.08)' }}>
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ background: ORIGIN_BADGE[origin].color }} />
                {ORIGIN_BADGE[origin].label}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: chip.color }}>
              {status === 'rendering' ? <Spinner /> : <span className="w-1.5 h-1.5 rounded-full" style={{ background: chip.color }} />}
              {chip.label}
            </span>
            {!selecting && brandTag}
          </div>
        </div>
      </div>
      {reason && !selecting && <p className="mt-2 text-[11px] leading-relaxed line-clamp-2" style={{ color: 'rgb(var(--cb-fg) / 0.5)' }}>{reason}</p>}
      {/* Edit · Download (a click on the card itself previews it); a Sub-edit already running still shows its overlay */}
      {!selecting && sub.error && <p role="alert" className="mt-2 text-[11px]" style={{ color: '#f87171' }}>{sub.error}</p>}
      {!selecting && (
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          <button onClick={e => { e.stopPropagation(); onEdit() }} disabled={disabled} title="Open in the editor"
            className="h-8 flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-white/10 disabled:opacity-40"
            style={{ color: 'rgb(var(--cb-fg) / 0.85)', border: '1px solid rgb(var(--cb-fg) / 0.14)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
            Edit
          </button>
          <button onClick={e => { e.stopPropagation(); onDownload() }} disabled={download === 'preparing'}
            title={download === 'preparing' ? 'Exporting — it downloads by itself when ready'
              : download === 'failed' ? 'The export failed — try again'
              : outputUrl && status === 'done' ? 'Download the exported reel' : 'Export this clip as it is, then download it'}
            className="h-8 flex items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-70"
            style={download === 'failed' ? { color: '#f87171', border: '1px solid rgba(239,68,68,0.45)' } : { background: ACCENT, color: '#000' }}>
            {download === 'preparing' ? <Spinner /> : (
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 2v7M4 7l3 3 3-3M2 11.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
            {download === 'preparing' ? 'Preparing' : download === 'failed' ? 'Retry' : 'Download'}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The clip's formats as the editor would open them: a clip never opened has none (one centred
 * Vertical), and a crop box never framed has no keyframes (the layout's default framing).
 */
function previewSegments(segments: SegmentLocal[], lengthMs: number, videoAR: number): SegmentLocal[] {
  if (!segments.length) {
    return [{
      id: 'preview', start_ms: 0, end_ms: lengthMs, layout: 'vertical', sort_order: 0, frame: null,
      crop_boxes: [makeBox(0, 'vertical', 0, [{ t_ms: 0, ...defaultCropForSlot('vertical', 0, videoAR) }])],
    } as SegmentLocal]
  }
  return segments.map(seg => ({
    ...seg,
    crop_boxes: seg.crop_boxes.map((b, i) => (b.keyframes.length ? b : {
      ...b, keyframes: [{ t_ms: seg.start_ms, ...defaultCropForSlot(seg.layout, b.slot_index ?? i, videoAR) }],
    })),
  }))
}
