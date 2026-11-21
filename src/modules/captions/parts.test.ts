// Caption parts move with the timeline (user, 2026-11-21). Run: npx tsx --test src/modules/captions/parts.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { partsAfterCut, partsAfterInsert, type CaptionPart } from './parts'

const p = (id: string, start_ms: number): CaptionPart => ({ id, start_ms, style: { color: id } })
const at = (parts: CaptionPart[]) => parts.map(x => `${x.id}@${x.start_ms}`)

test('a cut before a part moves it up by as much', () => {
  assert.deepEqual(at(partsAfterCut([p('a', 5_000), p('b', 25_000)], 10_000, 20_000, 20_000)), ['a@5000', 'b@15000'])
})
test('a part starting inside the cut: the look playing at its end plays on from where the cut was', () => {
  assert.deepEqual(at(partsAfterCut([p('a', 12_000), p('b', 15_000)], 10_000, 20_000, 20_000)), ['b@10000'])
})
test('a part starting exactly at the cut\'s end moves to its start', () => {
  assert.deepEqual(at(partsAfterCut([p('a', 20_000)], 10_000, 20_000, 20_000)), ['a@10000'])
})
test('a cut at the end: parts past the new end go', () => {
  assert.deepEqual(at(partsAfterCut([p('a', 5_000), p('b', 25_000)], 20_000, 30_000, 20_000)), ['a@5000'])
})
test('time put in: parts from there on move later', () => {
  assert.deepEqual(at(partsAfterInsert([p('a', 5_000), p('b', 10_000)], 10_000, 4_000, 34_000)), ['a@5000', 'b@14000'])
})
test('nothing to move: the same list', () => {
  const parts: CaptionPart[] = []
  assert.equal(partsAfterCut(parts, 1, 2, 10), parts)
})
