import type { AudioTrack, FrameItem, Overlay, SegmentLocal, TextOverlay } from '@chai-cut/shared'
import type { KeyframeMap } from './store'
import type { CopiedPart } from './duplicate'

// ── Copy / cut / paste (Ctrl+C / Ctrl+X / Ctrl+V; user, 2026-11-12) ───────────────────────────────
// What's copied is kept in the browser (localStorage), so it pastes into any clip — of this video or
// another — in any tab, until something else is copied. It holds the things as they were when
// copied. Only the account that copied it pastes it (a shared computer).

const KEY = 'shortcut.clipboard.v1'

/** Something on the rows, as copied */
export type CopiedRow =
  | { kind: 'shot'; seg: SegmentLocal; keyframes: KeyframeMap }
  | { kind: 'photo'; item: Overlay }
  | { kind: 'text'; item: TextOverlay }
  /** `url`: where the song plays from (the preview's player); `ms`: its length, when known */
  | { kind: 'music'; item: AudioTrack; url?: string; ms?: number }

export interface Clipboard {
  v: 1
  /** Whose it is: only they paste it */
  owner: string
  /** Where it was copied: the clip, its main video and where the clip starts in that video */
  clipId: string
  videoId: string
  clipStart: number
  rows: CopiedRow[]
  /** Groups among the rows (indexes into `rows`): pasted, they're groups again */
  groups: number[][]
  /** Parts of the main row (CopiedPart, duplicate.ts) */
  parts: CopiedPart[]
  /** An item in a frame */
  frame: FrameItem | null
}

/** Where a row's thing sits on the timeline (to keep the pasted ones in their places to each other) */
export function rowSpan(r: CopiedRow): { start_ms: number; end_ms: number; track: number } {
  if (r.kind === 'shot') return { start_ms: r.seg.start_ms, end_ms: r.seg.end_ms, track: r.seg.track ?? 0 }
  const end = r.kind === 'music' ? r.item.end_ms ?? (r.ms != null ? r.item.start_ms + r.ms - (r.item.offset_ms ?? 0) : r.item.start_ms + 5000) : r.item.end_ms
  return { start_ms: r.item.start_ms, end_ms: end, track: r.item.track ?? 0 }
}

// (when the browser keeps nothing — a private window, storage off — this tab still remembers it)
let inTab: Clipboard | null = null

export function writeClipboard(c: Clipboard) {
  inTab = c
  try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* too big or storage off: this tab keeps it */ }
}

/** What's copied, if `owner` copied it */
export function readClipboard(owner: string): Clipboard | null {
  let c: Clipboard | null = null
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) c = JSON.parse(raw) as Clipboard
  } catch { /* unreadable: what this tab has */ }
  c = c ?? inTab
  if (!c || c.v !== 1 || c.owner !== owner || !Array.isArray(c.rows) || !Array.isArray(c.parts)) return null
  return c
}
