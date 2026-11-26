import type { AudioTrack } from '@chai-cut/shared'
import { mergeRanges, musicEndMs, type Range } from './musicGain'

/**
 * Record voice (user, 2026-11-25): the user talks over the clip while it plays; the take becomes a
 * bar on the audio lane ("Voice"). With "Mute the original" on (a dub) the main video's own sound is
 * silent under it — in the preview (EditorShell sectionMutedAt) and the export (worker audio.py
 * main_quiet_ranges, the same rules). Music dips under a recorded voice as under any speech.
 */

export const isVoiceTrack = (t: Pick<AudioTrack, 'voice'>) => t.voice === true

/** Where each recorded voice plays (clip ms): its bar, to the recording's end at most */
function spans(tracks: AudioTrack[], durations: Record<string, number>, clipLenMs: number, keep: (t: AudioTrack) => boolean): Range[] {
  return mergeRanges(tracks.filter(t => isVoiceTrack(t) && !t.muted && keep(t))
    .map(t => [Math.max(0, t.start_ms), musicEndMs(t, durations[t.id], clipLenMs)] as Range))
}

/** Where a recorded voice is heard (not muted, not at 0%): speech, the music dips there (audio.py voice_ranges) */
export function voiceRanges(tracks: AudioTrack[], durations: Record<string, number>, clipLenMs: number): Range[] {
  return spans(tracks, durations, clipLenMs, t => (t.volume ?? 1) > 0)
}

/** Where a recorded voice replaces the main video's own sound (audio.py main_quiet_ranges) */
export function mainQuietRanges(tracks: AudioTrack[], durations: Record<string, number>, clipLenMs: number): Range[] {
  return spans(tracks, durations, clipLenMs, t => t.mutes_original === true)
}

export const inRanges = (ranges: Range[], t: number) => ranges.some(([a, b]) => t >= a && t < b)

/**
 * A retake over [a, b): the recorded voices there make room for the new take — a voice wholly inside
 * goes, one reaching in is cut at the edge (its right part plays on from the same moment of its
 * recording), one spanning it is split around it. Music and other bars are left alone.
 * `newId` names the right part of a voice split around it (given the voice's own id).
 */
export function makeRoomForTake(tracks: AudioTrack[], a: number, b: number, durations: Record<string, number>, clipLenMs: number, newId: (fromId: string) => string): AudioTrack[] {
  return tracks.flatMap((t): AudioTrack[] => {
    if (!isVoiceTrack(t) || t.locked) return [t]
    const s = t.start_ms, e = musicEndMs(t, durations[t.id], clipLenMs)
    if (e <= a || s >= b) return [t]
    const right = (): AudioTrack => ({ ...t, start_ms: b, end_ms: e, offset_ms: (t.offset_ms ?? 0) + (b - s) })
    if (s >= a && e <= b) return []
    if (s < a && e > b) return [{ ...t, end_ms: a }, { ...right(), id: newId(t.id) }]
    if (s < a) return [{ ...t, end_ms: a }]
    return [right()]
  }).filter(t => !isVoiceTrack(t) || (t.end_ms ?? Infinity) - t.start_ms >= 50)
}

/** The bar's name: "Voice", numbered when there are several (in the order they play) */
export function voiceName(track: AudioTrack, tracks: AudioTrack[]): string {
  const voices = tracks.filter(isVoiceTrack).sort((x, y) => x.start_ms - y.start_ms)
  return voices.length > 1 ? `Voice ${voices.findIndex(v => v.id === track.id) + 1}` : 'Voice'
}

/** 16-bit mono WAV of the samples (−1…1): plays everywhere, its length is exact, the worker's FFmpeg reads it */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0, o = 44; i < samples.length; i++, o += 2) {
    const x = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

/** The longest take that fits the 20 MB upload as a WAV (a little room left), in seconds */
export const maxTakeSeconds = (sampleRate: number) => Math.floor((19.5 * 1024 * 1024 - 44) / (2 * sampleRate))

/**
 * Which recorded samples belong to the take. The mic's sample at context frame f was heard ~inLat
 * earlier; the user speaks to what they saw/heard ~outLat after the player showed it. `anchor` pairs a
 * clip time with the audio clock at that moment (the first frame of playback). Returns the first and
 * last frame (exclusive) of the take, for clip times [fromMs, toMs).
 */
export function takeFrames(o: { anchorClipMs: number; anchorCtxSec: number; fromMs: number; toMs: number; sampleRate: number; inLatSec: number; outLatSec: number }) {
  const at = (ms: number) => Math.round((o.anchorCtxSec + (ms - o.anchorClipMs) / 1000 + o.inLatSec + o.outLatSec) * o.sampleRate)
  return { first: at(o.fromMs), end: at(o.toMs) }
}
