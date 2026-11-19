// The progress bar counts up one percent at a time (useSmoothPct.ts). Run: npx tsx --test src/lib/useSmoothPct.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { smoothTarget, smoothTick, type Smooth } from './useSmoothPct'

/** The whole percents shown every 100 ms between two checks */
function shownEvery100ms(s: Smooth, ms: number): number[] {
  const out: number[] = []
  for (let t = 0; t < ms; t += 100) { s = smoothTick(s, 100); out.push(Math.floor(s.shown)) }
  return out
}

test('the user\'s case: 5 then 15 three seconds later counts 6, 7, 8 … 15 — no jump', () => {
  let s = smoothTarget(null, 5, 0)
  assert.equal(s.shown, 5)                          // the first value is shown as it is
  s = smoothTarget(s, 15, 3000)
  const seen = shownEvery100ms(s, 3000)
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] - seen[i - 1] <= 1, `jumped ${seen[i - 1]} → ${seen[i]}`)
  assert.deepEqual([...new Set(seen)], [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  assert.equal(seen.at(-1), 15)                     // there by the time the next check is due
})

test('never shows more than the real value, however long it waits', () => {
  let s = smoothTarget(smoothTarget(null, 20, 0), 30, 3000)
  s = smoothTick(s, 60_000)
  assert.equal(s.shown, 30)
})

test('a slow check (8 s) is spread over 8 s; one after a hidden tab is spread over 8 s at most', () => {
  let s = smoothTarget(smoothTarget(null, 50, 0), 60, 8000)
  assert.ok(Math.abs(s.rate - 10 / 8000) < 1e-9)
  s = smoothTarget(smoothTarget(null, 50, 0), 90, 5 * 60_000)
  assert.ok(Math.abs(s.rate - 40 / 8000) < 1e-9)
})

test('a value that goes down (a new step, a retry) is shown at once', () => {
  const s = smoothTarget(smoothTarget(null, 80, 0), 10, 3000)
  assert.equal(s.shown, 10)
})

test('the same value again changes nothing; values stay within 0–100', () => {
  const a = smoothTarget(null, 40, 0)
  assert.equal(smoothTarget(a, 40, 3000), a)
  assert.equal(smoothTarget(null, 140, 0).shown, 100)
  assert.equal(smoothTarget(null, -3, 0).shown, 0)
})
