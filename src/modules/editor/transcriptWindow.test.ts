import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_CLIP_MS } from '@/lib/credits'
import { transcriptWindow, transcriptWindowQuery, parseTranscriptWindow } from './transcriptWindow'

test('a clip loads its own stretch plus the most its ends can be dragged out', () => {
  const w = transcriptWindow({ start_ms: 30 * 60_000, end_ms: 30 * 60_000 + 30_000 })
  assert.equal(w.from, 30 * 60_000 - MAX_CLIP_MS)
  assert.equal(w.to, 30 * 60_000 + 30_000 + MAX_CLIP_MS)
})

test('the window never starts before the video', () => {
  assert.equal(transcriptWindow({ start_ms: 10_000, end_ms: 40_000 }).from, 0)
})

test('where the clip was first made is covered too (Reset puts it back)', () => {
  const w = transcriptWindow({ start_ms: 600_000, end_ms: 620_000, original_start_ms: 500_000, original_end_ms: 700_000 })
  assert.equal(w.from, 500_000 - MAX_CLIP_MS)
  assert.equal(w.to, 700_000 + MAX_CLIP_MS)
})

test('missing original ends are ignored', () => {
  const w = transcriptWindow({ start_ms: 600_000, end_ms: 620_000, original_start_ms: null, original_end_ms: undefined })
  assert.deepEqual(w, { from: 600_000 - MAX_CLIP_MS, to: 620_000 + MAX_CLIP_MS })
})

test('the query and its parse agree; a bad window means no window', () => {
  const q = transcriptWindowQuery({ start_ms: 600_000, end_ms: 620_000 })
  const p = new URLSearchParams(q.slice(1))
  assert.deepEqual(parseTranscriptWindow(p.get('from'), p.get('to')), transcriptWindow({ start_ms: 600_000, end_ms: 620_000 }))
  assert.equal(parseTranscriptWindow(null, '5'), null)
  assert.equal(parseTranscriptWindow('9', '5'), null)
  assert.equal(parseTranscriptWindow('x', '5'), null)
  assert.equal(parseTranscriptWindow('-1', '5'), null)
})
