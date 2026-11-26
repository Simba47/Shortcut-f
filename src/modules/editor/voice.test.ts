// Record voice (2026-11-25): the rules the preview shares with the export (worker audio.py).
// Run: npx tsx --test src/modules/editor/voice.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AudioTrack } from '@chai-cut/shared'
import { encodeWav, inRanges, mainQuietRanges, makeRoomForTake, maxTakeSeconds, takeFrames, voiceName, voiceRanges } from './voice'
import { heardSpeech } from './musicGain'

const tr = (o: Partial<AudioTrack> & { id: string; start_ms: number }): AudioTrack =>
  ({ clip_id: 'c', storage_path: `audio/u/${o.id}.wav`, volume: 1, duck_under_speech: false, ...o })

test('voices: where they play and where they mute the original (muted bars do neither)', () => {
  const tracks = [
    tr({ id: 'a', start_ms: 1000, end_ms: 3000, voice: true, mutes_original: true }),
    tr({ id: 'b', start_ms: 5000, end_ms: 6000, voice: true }),
    tr({ id: 'c', start_ms: 7000, end_ms: 8000, voice: true, mutes_original: true, muted: true }),
    tr({ id: 'm', start_ms: 0, end_ms: 9000, duck_under_speech: true }),   // music: neither
    tr({ id: 'z', start_ms: 8500, end_ms: 9500, voice: true, mutes_original: true, volume: 0 }),
  ]
  assert.deepEqual(mainQuietRanges(tracks, {}, 9000), [[1000, 3000], [8500, 9000]])
  // (at 0% it is not heard, but still mutes the original: the switch says so)
  assert.deepEqual(voiceRanges(tracks, {}, 9000), [[1000, 3000], [5000, 6000]])
  // A recording shorter than its bar stops where it ends
  assert.deepEqual(mainQuietRanges([tr({ id: 'a', start_ms: 1000, end_ms: 5000, offset_ms: 500, voice: true, mutes_original: true })], { a: 2500 }, 9000), [[1000, 3000]])
  assert.ok(inRanges([[1000, 3000]], 1000) && !inRanges([[1000, 3000]], 3000))
})

test('music dips under a recorded voice; the original voice is not heard where a dub mutes it', () => {
  const heard = heardSpeech({
    speechInVideo: [[10_000, 14_000]], clipStartMs: 10_000, clipLenMs: 8000, originals: null,
    mainVolume: 1, mutedSections: [], quietSections: [], mainQuiet: [[1000, 2000]], voices: [[1000, 2000], [6000, 7000]],
  })
  assert.deepEqual(heard, [[0, 4000], [6000, 7000]])
  // The original at 0%: only the recorded voices count
  assert.deepEqual(heardSpeech({
    speechInVideo: [[10_000, 14_000]], clipStartMs: 10_000, clipLenMs: 8000, originals: null,
    mainVolume: 0, mutedSections: [], quietSections: [], voices: [[6000, 7000]],
  }), [[6000, 7000]])
})

test('a retake makes room: inside goes, reaching in is cut, spanning is split; music is left alone', () => {
  const tracks = [
    tr({ id: 'in', start_ms: 2000, end_ms: 3000, voice: true }),
    tr({ id: 'left', start_ms: 500, end_ms: 2500, voice: true }),
    tr({ id: 'right', start_ms: 3500, end_ms: 6000, offset_ms: 100, voice: true }),
    tr({ id: 'span', start_ms: 1000, end_ms: 9000, voice: true, track: 2 }),
    tr({ id: 'song', start_ms: 0, end_ms: 9000 }),
    tr({ id: 'locked', start_ms: 2000, end_ms: 3000, voice: true, locked: true }),
  ]
  const ids: string[] = []
  const out = makeRoomForTake(tracks, 2000, 4000, {}, 10_000, from => { ids.push(from); return `${from}-r` })
  const by = Object.fromEntries(out.map(t => [t.id, t]))
  assert.equal(by.in, undefined)
  assert.deepEqual([by.left.start_ms, by.left.end_ms], [500, 2000])
  assert.deepEqual([by.right.start_ms, by.right.end_ms, by.right.offset_ms], [4000, 6000, 600])
  assert.deepEqual([by.span.start_ms, by.span.end_ms], [1000, 2000])
  assert.deepEqual([by['span-r'].start_ms, by['span-r'].end_ms, by['span-r'].offset_ms, by['span-r'].track], [4000, 9000, 3000, 2])
  assert.deepEqual(ids, ['span'])
  assert.deepEqual([by.song.start_ms, by.song.end_ms], [0, 9000])
  assert.ok(by.locked)
})

test('voices are named Voice, numbered in the order they play when there are several', () => {
  const a = tr({ id: 'a', start_ms: 5000, voice: true }), b = tr({ id: 'b', start_ms: 1000, voice: true })
  assert.equal(voiceName(a, [a]), 'Voice')
  assert.equal(voiceName(a, [a, b]), 'Voice 2')
  assert.equal(voiceName(b, [a, b]), 'Voice 1')
})

test('the WAV: a 44-byte header and 16-bit samples, its length exact', async () => {
  const sr = 48000
  const samples = new Float32Array(sr).map((_, i) => Math.sin(i / 10) * 0.5)
  const blob = encodeWav(samples, sr)
  const buf = new DataView(await blob.arrayBuffer())
  assert.equal(blob.size, 44 + sr * 2)
  assert.equal(String.fromCharCode(buf.getUint8(0), buf.getUint8(1), buf.getUint8(2), buf.getUint8(3)), 'RIFF')
  assert.equal(buf.getUint32(24, true), sr)
  assert.equal(buf.getUint16(22, true), 1)
  assert.equal(buf.getUint32(40, true), sr * 2)
  // clipped, not wrapped
  const loud = new DataView(await encodeWav(new Float32Array([2, -2]), sr).arrayBuffer())
  assert.deepEqual([loud.getInt16(44, true), loud.getInt16(46, true)], [32767, -32768])
  // A take fits the 20 MB upload
  assert.ok(44 + maxTakeSeconds(sr) * sr * 2 <= 20 * 1024 * 1024)
})

test('the take is lined up with the clip: later by the mic and screen delays', () => {
  const f = takeFrames({ anchorClipMs: 2100, anchorCtxSec: 10, fromMs: 2000, toMs: 5000, sampleRate: 48000, inLatSec: 0.01, outLatSec: 0.02 })
  // clip 2000 ms is 0.1 s before the anchor (10 s on the audio clock), heard 0.03 s later
  assert.equal(f.first, Math.round((10 - 0.1 + 0.03) * 48000))
  assert.equal(f.end - f.first, 3 * 48000)
})
