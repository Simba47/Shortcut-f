import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  creditsMode, readingCredits, captionCredits, exportCredits, allocate, TOPUP_PACKS, FREE_SIGNUP_CREDITS, MAX_CLIP_MS,
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

test('reading costs 1 credit per started video minute, at least 1', () => {
  assert.equal(readingCredits(40 * MIN), 40)
  assert.equal(readingCredits(40 * MIN + 1), 41)
  assert.equal(readingCredits(10_000), 1)
  assert.equal(readingCredits(null), 1)
})

test('clip captions cost 1 credit per started clip minute, at least 1', () => {
  assert.equal(captionCredits(30_000), 1)
  assert.equal(captionCredits(2 * MIN), 2)
  assert.equal(captionCredits(2 * MIN + 1), 3)
})

test('an export costs 2 credits up to 3 minutes, 3 up to 5 minutes, and is blocked beyond', () => {
  assert.equal(exportCredits(60_000), 2)
  assert.equal(exportCredits(3 * MIN), 2)
  assert.equal(exportCredits(3 * MIN + 1), 3)
  assert.equal(exportCredits(5 * MIN), 3)
  assert.equal(MAX_CLIP_MS, 5 * MIN)
  assert.throws(() => exportCredits(5 * MIN + 1), (e: { status?: number; message?: string }) => e.status === 400 && /5 minutes/.test(e.message ?? ''))
})

test('plans carry their monthly credits; the free plan gets a one-time grant instead', () => {
  assert.equal(PLANS.free.monthlyCredits, 0)
  assert.equal(PLANS.starter.monthlyCredits, 200)
  assert.equal(PLANS.creator.monthlyCredits, 400)
  assert.equal(PLANS.agency.monthlyCredits, 1000)
  assert.equal(FREE_SIGNUP_CREDITS, 30)
})

test('a top-up pack costs more per credit than the cheapest plan whose month covers it', () => {
  const perCredit = (price: number, credits: number) => price / credits
  const plans = (['starter', 'creator', 'agency'] as const).map(k => PLANS[k])
  for (const pack of TOPUP_PACKS) {
    const covering = plans.filter(p => p.monthlyCredits >= pack.credits).map(p => perCredit(p.price, p.monthlyCredits))
    assert.ok(covering.length > 0, `no plan covers the ${pack.key} pack`)
    assert.ok(perCredit(pack.price, pack.credits) > Math.min(...covering), `${pack.key} is cheaper than a plan`)
  }
  assert.deepEqual(TOPUP_PACKS.map(p => [p.credits, p.price]), [[50, 199], [150, 499], [400, 1199], [1000, 2799]])
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
