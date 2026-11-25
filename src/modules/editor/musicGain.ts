import type { AudioTrack } from '@chai-cut/shared'

/**
 * How loud a music track plays at a moment of the clip — the same rules as the export's mix
 * (chai-cut-backend/src/python/audio.py), so the preview sounds like the exported video:
 * its volume, the fade-in / fade-out buttons (0.5 s), and the dip to 15% while someone speaks.
 */

export const FADE_MS = 500
export const DUCK_LEVEL = 0.15
export type Range = [number, number]

/** Where someone speaks, in VIDEO time: words less than 0.5 s apart count as one stretch (as the export) */
export function speechRangesInVideo(words: Array<{ start_ms: number; end_ms: number }>, clipStartMs: number, clipEndMs: number): Range[] {
  const sorted = words.filter(w => w.end_ms >= clipStartMs && w.start_ms <= clipEndMs).sort((a, b) => a.start_ms - b.start_ms)
  const out: Range[] = []
  for (const w of sorted) {
    const last = out[out.length - 1]
    if (last && w.start_ms - last[1] < 500) last[1] = Math.max(last[1], w.end_ms)
    else out.push([w.start_ms, w.end_ms])
  }
  return out
}

/** Where someone speaks, in clip time */
export function speechRanges(words: Array<{ start_ms: number; end_ms: number }>, clipStartMs: number, clipEndMs: number): Range[] {
  return speechRangesInVideo(words, clipStartMs, clipEndMs)
    .map(([a, b]) => [Math.max(0, a - clipStartMs), b - clipStartMs] as Range).filter(([a, b]) => b > a)
}

/** `ranges` with every part inside `cuts` removed */
function subtract(ranges: Range[], cuts: Range[]): Range[] {
  let out = ranges
  for (const [c, d] of cuts) {
    out = out.flatMap(([x, y]): Range[] => d <= x || c >= y ? [[x, y]] : [...(c > x ? [[x, c] as Range] : []), ...(d < y ? [[d, y] as Range] : [])])
  }
  return out.filter(([a, b]) => b > a)
}

/**
 * Where the voice is actually HEARD (clip time) — music dips only there, as in the export
 * (audio.py heard_speech_ranges). Not heard: the original sound muted or at 0%, muted sections,
 * sections where something else's sound plays instead (`quietSections`). With the original sound
 * detached, it's heard where its bars play (shifted when a bar was moved, not at all at 0%).
 */
export function heardSpeech(o: {
  speechInVideo: Range[]
  /**
   * Where someone speaks in CLIP time, when that isn't just the video's time minus the clip's
   * start (parts of the clip removed: lib/trims.ts). Used while the sound isn't detached.
   */
  speechInClip?: Range[]
  clipStartMs: number
  clipLenMs: number
  /** Detached original-sound bars, or null when the sound isn't detached */
  originals: Array<{ start_ms: number; end_ms?: number | null; offset_ms?: number | null; volume?: number | null; muted?: boolean }> | null
  mainVolume: number
  mutedSections: Range[]
  quietSections: Range[]
  /** Recorded voices that mute the original there (voice.ts mainQuietRanges): no original voice heard */
  mainQuiet?: Range[]
  /** Recorded voices (voice.ts voiceRanges): speech too — the music dips under them */
  voices?: Range[]
}): Range[] {
  let heard: Range[]
  if (o.originals) {
    heard = o.originals.filter(t => !t.muted && (t.volume ?? 1) > 0).flatMap(t => {
      const start = Math.max(0, t.start_ms), end = t.end_ms ?? o.clipLenMs
      const off = t.offset_ms ?? o.clipStartMs + start
      return o.speechInVideo.map(([a, b]) => [Math.max(start, start + a - off), Math.min(end, start + b - off)] as Range)
    })
  } else {
    // (the original at 0%: none of its voice is heard — a recorded voice still is, below)
    const inClip = o.mainVolume <= 0 ? [] : o.speechInClip ?? o.speechInVideo.map(([a, b]) => [a - o.clipStartMs, b - o.clipStartMs] as Range)
    heard = subtract(inClip.map(([a, b]) => [Math.max(0, a), Math.min(o.clipLenMs, b)] as Range), o.quietSections)
  }
  heard = subtract(subtract(heard, o.mutedSections), o.mainQuiet ?? [])
  return mergeRanges([...heard, ...(o.voices ?? [])])
}

/** Sorted, overlapping or touching stretches joined (as audio.py heard_speech_ranges returns them) */
export function mergeRanges(ranges: Range[]): Range[] {
  const out: Range[] = []
  for (const [a, b] of [...ranges].filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** Where a track stops: its bar end, the song's end, or the clip's end — whichever comes first */
export function musicEndMs(track: AudioTrack, songLenMs: number | undefined, clipLenMs: number): number {
  const songEnd = songLenMs != null ? track.start_ms + songLenMs - (track.offset_ms ?? 0) : Infinity
  return Math.min(track.end_ms ?? Infinity, songEnd, clipLenMs)
}

/** Volume (0–1) of a music track at clip time `t` (ms); 0 outside its bar */
export function musicGainAt(track: AudioTrack, t: number, songLenMs: number | undefined, speech: Range[], clipLenMs: number): number {
  if (track.muted) return 0
  const end = musicEndMs(track, songLenMs, clipLenMs)
  if (t < track.start_ms || t >= end) return 0
  let g = Math.max(0, Math.min(1, track.volume ?? 0.5))
  const fade = Math.min(FADE_MS, (end - track.start_ms) / 2)
  if (track.fade_in && t - track.start_ms < fade) g *= (t - track.start_ms) / fade
  if (track.fade_out && end - t < fade) g *= (end - t) / fade
  if (track.duck_under_speech && speech.some(([a, b]) => t >= a && t < b)) g *= DUCK_LEVEL
  return g
}
