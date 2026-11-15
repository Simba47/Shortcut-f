import { MAX_CLIP_MS } from '@/lib/credits'

// The stretch of the video's transcript the editor loads for a clip (F2 bug 8). Before, it loaded
// every word of the video, so a 30-second clip from an hour-long video fetched the whole hour.
//
// What the editor can reach: the clip itself, where it was first made (Reset puts that back), and
// its ends dragged out further, which the editor allows until the clip is MAX_CLIP_MS long. So the
// clip's stretch plus MAX_CLIP_MS either side covers every word it could ever show. Words outside
// that can never be on this clip's timeline.

interface ClipRangeFields {
  start_ms: number
  end_ms: number
  original_start_ms?: number | null
  original_end_ms?: number | null
}

export function transcriptWindow(clip: ClipRangeFields): { from: number; to: number } {
  const starts = [clip.start_ms, clip.original_start_ms].filter((n): n is number => n != null && Number.isFinite(Number(n))).map(Number)
  const ends = [clip.end_ms, clip.original_end_ms].filter((n): n is number => n != null && Number.isFinite(Number(n))).map(Number)
  return {
    from: Math.max(0, Math.min(...starts) - MAX_CLIP_MS),
    to: Math.max(...ends) + MAX_CLIP_MS,
  }
}

/** The window as the words API takes it: `&from=…&to=…` */
export function transcriptWindowQuery(clip: ClipRangeFields): string {
  const { from, to } = transcriptWindow(clip)
  return `&from=${Math.floor(from)}&to=${Math.ceil(to)}`
}

/** Reads `from` / `to` from the words API's query (both, whole and in order, or no window) */
export function parseTranscriptWindow(from: string | null, to: string | null): { from: number; to: number } | null {
  if (from == null || to == null) return null
  const a = Number(from), b = Number(to)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a) return null
  return { from: a, to: b }
}
