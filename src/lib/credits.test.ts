import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  creditsMode, captionCredits, exportCredits, extraReadingCredits, captionSpan, allocate, TOPUP_PACKS, FREE_SIGNUP_CREDITS, MAX_CLIP_MS,
  type SpendableGrant,
} from './credits'
import { PLANS } from './plans'

const MIN = 60_000

test('mode: off unless set; shadow and on are recognised; anything else is off', () => {
  assert.equal(creditsMode({}), 'off')
  assert.equal(creditsMode({ CREDITS_MODE: 'shadow' }), 'shadow')
  assert.equal(creditsMode({ CREDITS_MODE: 'on' }), 'on')
  assert.equal(creditsMode({ CREDITS_MODE: 'ON ' }), 'on')
  assert.equal(creditsMode({ CREDITS_MODE: 'yes' }), 'off')
})

test('clip captions cost 2 credits per started clip minute', () => {
  assert.equal(captionCredits(30_000), 2)
  assert.equal(captionCredits(90_000), 4)
  assert.equal(captionCredits(2 * MIN), 4)
  assert.equal(captionCredits(2 * MIN + 1), 6)
})

test('an export costs 1 credit per started clip minute, and is blocked past 5 minutes', () => {
  assert.equal(exportCredits(30_000), 1)
  assert.equal(exportCredits(60_000), 1)
  assert.equal(exportCredits(90_000), 2)
  assert.equal(exportCredits(5 * MIN), 5)
  assert.equal(MAX_CLIP_MS, 5 * MIN)
  assert.throws(() => exportCredits(5 * MIN + 1), (e: { status?: number; message?: string }) => e.status === 400 && /5 minutes/.test(e.message ?? ''))
})

test('plans carry their monthly credits; the free plan gets a one-time grant instead', () => {
  assert.equal(PLANS.free.monthlyCredits, 0)
  assert.equal(PLANS.starter.monthlyCredits, 120)
  assert.equal(PLANS.creator.monthlyCredits, 200)
  assert.equal(PLANS.agency.monthlyCredits, 500)
  assert.equal(FREE_SIGNUP_CREDITS, 10)
})

test('a credit is about ₹1: a pack never gives more than 3,000 credits for ₹2,799', () => {
  assert.deepEqual(TOPUP_PACKS.map(p => [p.credits, p.price]), [[200, 199], [500, 499], [1250, 1199], [3000, 2799]])
  for (const pack of TOPUP_PACKS) {
    const perCredit = pack.price / pack.credits
    assert.ok(perCredit >= 0.93 && perCredit <= 1, `${pack.key}: ₹${perCredit} a credit`)
  }
})

test('reading past the plan: 15 credits per started 10 minutes, nothing when none is over', () => {
  assert.equal(extraReadingCredits(0), 0)
  assert.equal(extraReadingCredits(-5), 0)
  assert.equal(extraReadingCredits(1), 15)
  assert.equal(extraReadingCredits(10 * MIN), 15)
  assert.equal(extraReadingCredits(10 * MIN + 1), 30)
  assert.equal(extraReadingCredits(60 * MIN), 90)
})

const said = (start_ms: number, end_ms: number) => ({ start_ms, end_ms })
test('captionSpan: no words means the whole clip is read', () => {
  assert.deepEqual(captionSpan(10_000, 70_000, []), { start_ms: 10_000, end_ms: 70_000 })
  assert.deepEqual(captionSpan(10_000, 70_000, [said(80_000, 81_000)]), { start_ms: 10_000, end_ms: 70_000 })
})
test('captionSpan: a clip with its captions needs nothing (a short pause at an edge is not a gap)', () => {
  assert.equal(captionSpan(0, 60_000, [said(1_000, 2_000), said(30_000, 58_000)]), null)
})
test('captionSpan: made longer at one end, only the new part is read', () => {
  assert.deepEqual(captionSpan(0, 60_000, [said(20_000, 21_000), said(40_000, 58_000)]), { start_ms: 0, end_ms: 20_000 })
  assert.deepEqual(captionSpan(0, 60_000, [said(1_000, 2_000), said(30_000, 40_000)]), { start_ms: 40_000, end_ms: 60_000 })
})
test('captionSpan: made longer at both ends, the whole clip is read', () => {
  assert.deepEqual(captionSpan(0, 60_000, [said(20_000, 40_000)]), { start_ms: 0, end_ms: 60_000 })
})

const at = (iso: string) => new Date(iso)
const g = (id: string, remaining: number, expiresAt: string | null, kind: SpendableGrant['kind'] = 'plan', createdAt = '2026-10-01T00:00:00Z'): SpendableGrant =>
  ({ id, remaining, expiresAt: expiresAt ? at(expiresAt) : null, kind, createdAt: at(createdAt) })
const NOW = at('2026-10-30T12:00:00Z')

test('allocate: takes from the grant that expires first, then the next', () => {
  const grants = [g('later', 100, '2026-12-01T00:00:00Z'), g('soon', 30, '2026-11-02T00:00:00Z')]
  assert.deepEqual(allocate(grants, 50, NOW), [{ grantId: 'soon', take: 30 }, { grantId: 'later', take: 20 }])
})

test('allocate: plan credits go before top-ups, and never-expiring credits go last', () => {
  const grants = [g('free', 10, null, 'free'), g('topup', 50, '2027-10-01T00:00:00Z', 'topup'), g('plan', 5, '2026-11-30T00:00:00Z', 'plan')]
  assert.deepEqual(allocate(grants, 12, NOW), [{ grantId: 'plan', take: 5 }, { grantId: 'topup', take: 7 }])
})

test('allocate: expired and empty grants are skipped', () => {
  const grants = [g('old', 40, '2026-10-01T00:00:00Z'), g('empty', 0, '2026-12-01T00:00:00Z'), g('ok', 8, '2026-12-01T00:00:00Z')]
  assert.deepEqual(allocate(grants, 8, NOW), [{ grantId: 'ok', take: 8 }])
  assert.equal(allocate(grants, 9, NOW), null)
})

test('allocate: an amount of zero or less takes nothing', () => {
  assert.deepEqual(allocate([g('a', 5, null)], 0, NOW), [])
})
