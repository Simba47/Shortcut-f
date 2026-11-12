import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLANS } from './plans'
import {
  aiLimitsFor, videoClipCap, extraSearchCredits, clipsAllowed, istDayStart, istMonthStart, rewriteCredits, clipCredits, allowanceSince, readingQuote, askAiUnits, askAiCredits, rewriteNote } from './aiLimits'

const MIN = 60_000

test('each plan has its AI limits; clips per run and daily clips grow with the plan, and every plan has 1 free search per video', () => {
  assert.deepEqual(aiLimitsFor('free'), { clipsPerRun: 3, clipsPerDay: 3, clipsPerMonth: 3, searchesPerVideo: 1, askAiPerMonth: 3, askAiPerDay: 3, rewritesPerMonth: 20 })
  assert.deepEqual(aiLimitsFor('starter'), { clipsPerRun: 10, clipsPerDay: 30, clipsPerMonth: 20, searchesPerVideo: 1, askAiPerMonth: 10, askAiPerDay: 10, rewritesPerMonth: 30 })
  assert.deepEqual(aiLimitsFor('creator'), { clipsPerRun: 15, clipsPerDay: 60, clipsPerMonth: 40, searchesPerVideo: 1, askAiPerMonth: 20, askAiPerDay: 20, rewritesPerMonth: 60 })
  assert.deepEqual(aiLimitsFor('agency'), { clipsPerRun: 20, clipsPerDay: 150, clipsPerMonth: 90, searchesPerVideo: 1, askAiPerMonth: 40, askAiPerDay: 40, rewritesPerMonth: 130 })
  assert.equal(PLANS.creator.ai.clipsPerRun, 15)
  assert.deepEqual(aiLimitsFor('nonsense'), aiLimitsFor('free'))
})

test('a video can have at most 1 AI clip per minute of video (at least 1)', () => {
  assert.equal(videoClipCap(5 * MIN), 5)
  assert.equal(videoClipCap(5 * MIN + 59_000), 5)
  assert.equal(videoClipCap(20_000), 1)
  assert.equal(videoClipCap(null), 1)
})

test('a fresh search beyond the included ones costs 5 credits per started 10 minutes of video', () => {
  assert.equal(extraSearchCredits(5 * MIN), 5)
  assert.equal(extraSearchCredits(10 * MIN), 5)
  assert.equal(extraSearchCredits(10 * MIN + 1), 10)
  assert.equal(extraSearchCredits(60 * MIN), 30)
})

test('a run makes the lowest of: asked, the plan per run, what is left today, what is left for the video', () => {
  assert.deepEqual(clipsAllowed({ requested: 10, perRun: 15, dayLeft: 60, videoLeft: 45, monthLeft: 99 }), { count: 10, limitedBy: null })
  assert.deepEqual(clipsAllowed({ requested: 20, perRun: 10, dayLeft: 30, videoLeft: 45, monthLeft: 99 }), { count: 10, limitedBy: 'run' })
  assert.deepEqual(clipsAllowed({ requested: 10, perRun: 10, dayLeft: 2, videoLeft: 45, monthLeft: 99 }), { count: 2, limitedBy: 'day' })
  assert.deepEqual(clipsAllowed({ requested: 10, perRun: 10, dayLeft: 30, videoLeft: 4, monthLeft: 99 }), { count: 4, limitedBy: 'video' })
  assert.deepEqual(clipsAllowed({ requested: 5, perRun: 10, dayLeft: 0, videoLeft: 4, monthLeft: 99 }), { count: 0, limitedBy: 'day' })
  assert.deepEqual(clipsAllowed({ requested: 5, perRun: 10, dayLeft: 9, videoLeft: 0, monthLeft: 99 }), { count: 0, limitedBy: 'video' })
  assert.deepEqual(clipsAllowed({ requested: 5, perRun: 10, dayLeft: 9, videoLeft: 9, monthLeft: 2 }), { count: 2, limitedBy: 'month' })
  assert.deepEqual(clipsAllowed({ requested: 5, perRun: 10, dayLeft: 9, videoLeft: 9, monthLeft: 0 }), { count: 0, limitedBy: 'month' })
})

test('days and months start at midnight India time (UTC+5:30)', () => {
  // 31 Oct 2026, 02:00 IST = 30 Oct 20:30 UTC: the IST day started 30 Oct 18:30 UTC
  assert.equal(istDayStart(new Date('2026-10-30T20:30:00Z')).toISOString(), '2026-10-30T18:30:00.000Z')
  // 30 Oct 2026, 23:00 IST = 30 Oct 17:30 UTC: still 30 Oct in India
  assert.equal(istDayStart(new Date('2026-10-30T17:30:00Z')).toISOString(), '2026-10-29T18:30:00.000Z')
  assert.equal(istMonthStart(new Date('2026-10-30T20:30:00Z')).toISOString(), '2026-09-30T18:30:00.000Z')
  // 1 Nov 2026, 01:00 IST = 31 Oct 19:30 UTC: November already in India
  assert.equal(istMonthStart(new Date('2026-10-31T19:30:00Z')).toISOString(), '2026-10-31T18:30:00.000Z')
})

test('rewrites past the allowance cost 1 credit for every 5 (charged on the 1st, 6th, 11th…)', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 10].map(rewriteCredits), [1, 0, 0, 0, 0, 1, 0, 1])
})

test('AI clips past the month\'s included ones cost 6 credits each; the included ones are used first', () => {
  assert.equal(clipCredits(1), 6)
  assert.equal(clipCredits(5), 30)
})

test('each plan includes fewer AI clips a month than its credits could pay to read (1 clip per video minute)', () => {
  for (const p of Object.values(PLANS)) if (p.monthlyCredits) assert.ok(p.ai.clipsPerMonth <= p.monthlyCredits / 3, p.key)
})

test('a paid plan counts from the start of the India month, Free counts everything it ever used', () => {
  const now = new Date('2026-11-20T10:00:00Z')
  assert.equal(allowanceSince('starter', now).toISOString(), istMonthStart(now).toISOString())
  assert.equal(allowanceSince('free', now).getTime(), 0)
  assert.equal(allowanceSince('nonsense', now).getTime(), 0)
})

const HOUR = 60 * 60_000
test('readingQuote: every video costs credits, and says how much of it is past the hours', () => {
  const plan = { uploadsPerMonth: 10, readingMinutes: 180 }
  assert.deepEqual(readingQuote(plan, { uploads: 0, usedMs: 0 }, HOUR), { uploadsLeft: 10, msLeft: 3 * HOUR, overMs: 0, credits: 90 })
  // 2.5 hours used and a 1-hour video: 30 minutes are past it, 3 × 15 credits
  assert.deepEqual(readingQuote(plan, { uploads: 4, usedMs: 2.5 * HOUR }, HOUR), { uploadsLeft: 6, msLeft: 0.5 * HOUR, overMs: 0.5 * HOUR, credits: 90 })
  // already past it: all of the video
  assert.deepEqual(readingQuote(plan, { uploads: 9, usedMs: 3.2 * HOUR }, HOUR), { uploadsLeft: 1, msLeft: 0, overMs: HOUR, credits: 90 })
})
test('readingQuote: a video of unknown length is priced at nothing yet, and the uploads never go below 0', () => {
  const plan = { uploadsPerMonth: 10, readingMinutes: 180 }
  assert.deepEqual(readingQuote(plan, { uploads: 12, usedMs: 0 }, null), { uploadsLeft: 0, msLeft: 3 * HOUR, overMs: 0, credits: 0 })
})

test('Ask AI counts 1 per started hour of the video, and costs 7 credits for each', () => {
  assert.equal(askAiUnits(null), 1)
  assert.equal(askAiUnits(20 * 60_000), 1)
  assert.equal(askAiUnits(60 * 60_000), 1)
  assert.equal(askAiUnits(61 * 60_000), 2)
  assert.equal(askAiUnits(5 * 60 * 60_000), 5)
  assert.equal(askAiCredits(1), 7)
  assert.equal(askAiCredits(3), 21)
})

test('the rewrite note says what is left, and what the next one costs', () => {
  assert.equal(rewriteNote(0, 30), '30 of 30 rewrites left · next: 1 credit, and it covers 5')
  assert.equal(rewriteNote(1, 30), '29 of 30 rewrites left · 4 more covered by your last credit')
  assert.equal(rewriteNote(4, 30), '26 of 30 rewrites left · 1 more covered by your last credit')
  assert.equal(rewriteNote(5, 30), '25 of 30 rewrites left · next: 1 credit, and it covers 5')
  assert.equal(rewriteNote(30, 30), 'All 30 rewrites used. More next month, or upgrade.')
})
