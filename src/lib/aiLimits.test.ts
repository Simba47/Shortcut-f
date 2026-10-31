import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLANS } from './plans'
import {
  aiLimitsFor, videoClipCap, extraSearchCredits, clipsAllowed, istDayStart, istMonthStart, rewriteCredits, extraClipCredits,
} from './aiLimits'

const MIN = 60_000

test('each plan has its AI limits; clips per run, searches per video and daily clips grow with the plan', () => {
  assert.deepEqual(aiLimitsFor('free'), { clipsPerRun: 3, clipsPerDay: 3, clipsPerMonth: 3, searchesPerVideo: 1, askAiPerMonth: 10, askAiPerDay: 5, rewritesPerMonth: 20 })
  assert.deepEqual(aiLimitsFor('starter'), { clipsPerRun: 10, clipsPerDay: 30, clipsPerMonth: 60, searchesPerVideo: 3, askAiPerMonth: 100, askAiPerDay: 30, rewritesPerMonth: 150 })
  assert.deepEqual(aiLimitsFor('creator'), { clipsPerRun: 15, clipsPerDay: 60, clipsPerMonth: 120, searchesPerVideo: 3, askAiPerMonth: 200, askAiPerDay: 50, rewritesPerMonth: 300 })
  assert.deepEqual(aiLimitsFor('agency'), { clipsPerRun: 20, clipsPerDay: 150, clipsPerMonth: 300, searchesPerVideo: 5, askAiPerMonth: 600, askAiPerDay: 150, rewritesPerMonth: 1000 })
  assert.equal(PLANS.creator.ai.clipsPerRun, 15)
  assert.deepEqual(aiLimitsFor('nonsense'), aiLimitsFor('free'))
})

test('a video can have at most 1 AI clip per minute of video (at least 1)', () => {
  assert.equal(videoClipCap(5 * MIN), 5)
  assert.equal(videoClipCap(5 * MIN + 59_000), 5)
  assert.equal(videoClipCap(20_000), 1)
  assert.equal(videoClipCap(null), 1)
})

test('a fresh search beyond the included ones costs 1 credit per started 10 minutes of video', () => {
  assert.equal(extraSearchCredits(5 * MIN), 1)
  assert.equal(extraSearchCredits(10 * MIN), 1)
  assert.equal(extraSearchCredits(10 * MIN + 1), 2)
  assert.equal(extraSearchCredits(60 * MIN), 6)
})

test('a run makes the lowest of: asked, the plan per run, what is left today, what is left for the video', () => {
  assert.deepEqual(clipsAllowed({ requested: 10, perRun: 15, dayLeft: 60, videoLeft: 45 }), { count: 10, limitedBy: null })
  assert.deepEqual(clipsAllowed({ requested: 20, perRun: 10, dayLeft: 30, videoLeft: 45 }), { count: 10, limitedBy: 'run' })
  assert.deepEqual(clipsAllowed({ requested: 10, perRun: 10, dayLeft: 2, videoLeft: 45 }), { count: 2, limitedBy: 'day' })
  assert.deepEqual(clipsAllowed({ requested: 10, perRun: 10, dayLeft: 30, videoLeft: 4 }), { count: 4, limitedBy: 'video' })
  assert.deepEqual(clipsAllowed({ requested: 5, perRun: 10, dayLeft: 0, videoLeft: 4 }), { count: 0, limitedBy: 'day' })
  assert.deepEqual(clipsAllowed({ requested: 5, perRun: 10, dayLeft: 9, videoLeft: 0 }), { count: 0, limitedBy: 'video' })
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

test('AI clips past the month\'s included ones cost 1 credit each; the included ones are used first', () => {
  assert.deepEqual(extraClipCredits(5, 60), { extra: 0, credits: 0 })
  assert.deepEqual(extraClipCredits(5, 2), { extra: 3, credits: 3 })
  assert.deepEqual(extraClipCredits(5, 0), { extra: 5, credits: 5 })
  assert.deepEqual(extraClipCredits(5, -4), { extra: 5, credits: 5 })
})

test('each plan includes fewer AI clips a month than its credits could pay to read (1 clip per video minute)', () => {
  for (const p of Object.values(PLANS)) if (p.monthlyCredits) assert.ok(p.ai.clipsPerMonth <= p.monthlyCredits / 3, p.key)
})
