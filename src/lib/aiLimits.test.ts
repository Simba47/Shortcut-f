import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLANS } from './plans'
import {
  aiLimitsFor, videoClipCap, extraSearchCredits, clipsAllowed, istDayStart, istMonthStart, rewriteCredits, clipCredits, allowanceSince, readingQuote, askAiUnits, askAiCredits, rewriteNote, SAFETY_PER_DAY } from './aiLimits'

const MIN = 60_000

test('each plan has only a run size and 1 free search per video (no monthly limits since 2026-11-21: credits are the limit)', () => {
  // No plan (no free plan since 2026-11-16): no AI at all until the Trial pack or a plan
  assert.deepEqual(aiLimitsFor('free'), { clipsPerRun: 0, searchesPerVideo: 0 })
  assert.deepEqual(aiLimitsFor('trial'), { clipsPerRun: 3, searchesPerVideo: 1 })
  assert.deepEqual(aiLimitsFor('starter'), { clipsPerRun: 10, searchesPerVideo: 1 })
  assert.deepEqual(aiLimitsFor('creator'), { clipsPerRun: 15, searchesPerVideo: 1 })
  assert.deepEqual(aiLimitsFor('agency'), { clipsPerRun: 20, searchesPerVideo: 1 })
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

test('a run makes the lowest of: asked, the plan per run, what is left today (safety), what is left for the video', () => {
  assert.deepEqual(clipsAllowed({ requested: 10, perRun: 15, dayLeft: 300, videoLeft: 45 }), { count: 10, limitedBy: null })
  assert.deepEqual(clipsAllowed({ requested: 20, perRun: 10, dayLeft: 300, videoLeft: 45 }), { count: 10, limitedBy: 'run' })
  assert.deepEqual(clipsAllowed({ requested: 10, perRun: 10, dayLeft: 2, videoLeft: 45 }), { count: 2, limitedBy: 'day' })
  assert.deepEqual(clipsAllowed({ requested: 10, perRun: 10, dayLeft: 300, videoLeft: 4 }), { count: 4, limitedBy: 'video' })
  assert.deepEqual(clipsAllowed({ requested: 5, perRun: 10, dayLeft: 0, videoLeft: 4 }), { count: 0, limitedBy: 'day' })
  assert.deepEqual(clipsAllowed({ requested: 5, perRun: 10, dayLeft: 9, videoLeft: 0 }), { count: 0, limitedBy: 'video' })
})

test('the daily safety limits are far past real use: 300 AI clips is more credits than two months of Pro', () => {
  assert.deepEqual(SAFETY_PER_DAY, { aiClips: 300, askAi: 100, rewrites: 300, readingMinutes: 1200 })
  assert.ok(clipCredits(SAFETY_PER_DAY.aiClips) > 2 * PLANS.creator.monthlyCredits)
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

test('AI clips cost 7 credits each (export included, 2026-11-21)', () => {
  assert.equal(clipCredits(1), 7)
  assert.equal(clipCredits(5), 35)
})

test('a paid plan counts from the start of the India month, Free counts everything it ever used', () => {
  const now = new Date('2026-11-20T10:00:00Z')
  assert.equal(allowanceSince('starter', now).toISOString(), istMonthStart(now).toISOString())
  assert.equal(allowanceSince('free', now).getTime(), 0)
  assert.equal(allowanceSince('nonsense', now).getTime(), 0)
})

const HOUR = 60 * 60_000
test('readingQuote: every video costs credits; no uploads limit on a paid plan; past today\'s 20 hours is refused', () => {
  // (a plan with more hours than a day: only the day's safety limit matters here)
  const paid = { uploadsLimit: null, readingMinutes: 100 * 60 }
  assert.deepEqual(readingQuote(paid, { uploads: 500, usedMs: 0, todayMs: 0 }, HOUR), { uploadsLeft: null, msLeft: 20 * HOUR, overMs: 0, credits: 90, limitedBy: 'day' })
  // 19.5 hours read today and a 1-hour video: 30 minutes are past the day's safety limit
  assert.deepEqual(readingQuote(paid, { uploads: 4, usedMs: 19.5 * HOUR, todayMs: 19.5 * HOUR }, HOUR), { uploadsLeft: null, msLeft: 0.5 * HOUR, overMs: 0.5 * HOUR, credits: 90, limitedBy: 'day' })
  // the Trial: 2 uploads in total
  assert.deepEqual(readingQuote(PLANS.trial, { uploads: 1, usedMs: 0, todayMs: 0 }, 10 * MIN).uploadsLeft, 1)
})
test('readingQuote: a video of unknown length is priced at nothing yet, and the Trial\'s uploads never go below 0', () => {
  assert.deepEqual(readingQuote({ uploadsLimit: 2, readingMinutes: 100 * 60 }, { uploads: 3, usedMs: 0, todayMs: 0 }, null), { uploadsLeft: 0, msLeft: 20 * HOUR, overMs: 0, credits: 0, limitedBy: 'day' })
})
test('the plan\'s hours are back (2026-11-22): Trial 30 min in total, Starter 3 h, Pro 5 h, Agency 14 h a month', () => {
  assert.deepEqual([PLANS.free, PLANS.trial, PLANS.starter, PLANS.creator, PLANS.agency].map(p => p.readingMinutes), [0, 30, 180, 300, 840])
  // Starter with 2.5 hours read this month and a 1-hour video: 30 minutes are past the plan's hours
  assert.deepEqual(readingQuote(PLANS.starter, { uploads: 6, usedMs: 2.5 * HOUR, todayMs: 0 }, HOUR),
    { uploadsLeft: null, msLeft: 0.5 * HOUR, overMs: 0.5 * HOUR, credits: 90, limitedBy: 'plan' })
  // all 3 hours used: nothing left, and it says the plan (it lasts longer than a day)
  const used = readingQuote(PLANS.starter, { uploads: 9, usedMs: 3 * HOUR, todayMs: 3 * HOUR }, 5 * MIN)
  assert.equal(used.msLeft, 0); assert.equal(used.limitedBy, 'plan')
  // the Trial's 30 minutes: a 20-minute video after a 15-minute one is 5 minutes over
  assert.deepEqual(readingQuote(PLANS.trial, { uploads: 1, usedMs: 15 * MIN, todayMs: 15 * MIN }, 20 * MIN).overMs, 5 * MIN)
  // a video that fits is let through
  assert.equal(readingQuote(PLANS.creator, { uploads: 0, usedMs: 4 * HOUR, todayMs: 0 }, 59 * MIN).overMs, 0)
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

test('the rewrite note says what the next one costs (no monthly limit)', () => {
  assert.equal(rewriteNote(0), 'Next rewrite: 1 credit, and it covers 5')
  assert.equal(rewriteNote(1), '4 more covered by your last credit')
  assert.equal(rewriteNote(4), '1 more covered by your last credit')
  assert.equal(rewriteNote(5), 'Next rewrite: 1 credit, and it covers 5')
  assert.equal(rewriteNote(300), 'Next rewrite: 1 credit, and it covers 5')
})
