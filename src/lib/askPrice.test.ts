// Ask AI's price in words (user, 2026-11-25: it must say the price follows the video's length).
// Run: npx tsx --test src/lib/askPrice.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { askPriceWords, lengthLabel } from './askPrice'
import { askAiCredits, askAiUnits } from './aiLimits'

const MIN = 60_000
const words = (ms: number) => askPriceWords(ms, askAiUnits(ms), askAiCredits(askAiUnits(ms)))

test('lengths as people say them; started minutes count', () => {
  assert.equal(lengthLabel(52 * MIN), '52 min')
  assert.equal(lengthLabel(60 * MIN), '1 h')
  assert.equal(lengthLabel(65 * MIN), '1 h 5 min')
  assert.equal(lengthLabel(60 * MIN + 20_000), '1 h 1 min')
  assert.equal(lengthLabel(20_000), '1 min')
})

test('an hour or less: one price, and why', () => {
  assert.equal(words(52 * MIN).line, 'This video is 52 min · 7 credits a search (7 for each started hour of video)')
  assert.equal(words(52 * MIN).popup, 'This video is 52 min. Ask AI costs 7 credits for each started hour of video, so this search costs 7 credits.')
  assert.equal(words(60 * MIN).line, 'This video is 1 h · 7 credits a search (7 for each started hour of video)')
})

test('past an hour: the hours it counts as and the sum, in the line and the popup', () => {
  const w = words(65 * MIN)
  assert.equal(w.line, 'This video is 1 h 5 min, counted as 2 hours · 2 × 7 = 14 credits a search')
  assert.equal(w.popup, 'This video is 1 h 5 min. Ask AI costs 7 credits for each started hour of video, so 2 × 7 = 14 credits for this search.')
  assert.match(words(60 * MIN + 20_000).line, /1 h 1 min, counted as 2 hours · 2 × 7 = 14/)
  assert.match(words(150 * MIN).line, /2 h 30 min, counted as 3 hours · 3 × 7 = 21/)
})
