import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  creditsMode, ledgerLabel, subjectsCredits, subjectsNewMs, captionCredits, exportCredits, readingCredits, captionSpan, allocate, TOPUP_PACKS, FREE_SIGNUP_CREDITS, MAX_CLIP_MS, testPackAllowed, findTopupPack,
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
  assert.equal(PLANS.starter.monthlyCredits, 599)
  assert.equal(PLANS.creator.monthlyCredits, 999)
  assert.equal(PLANS.agency.monthlyCredits, 2599)
  assert.equal(FREE_SIGNUP_CREDITS, 95)
})

test('a credit is about ₹1: a pack never gives more than 3,000 credits for ₹2,799', () => {
  assert.deepEqual(TOPUP_PACKS.map(p => [p.credits, p.price]), [[200, 199], [500, 489], [1250, 1199], [3000, 2799]])
  for (const pack of TOPUP_PACKS) {
    const perCredit = pack.price / pack.credits
    assert.ok(perCredit >= 0.93 && perCredit <= 1, `${pack.key}: ₹${perCredit} a credit`)
  }
})

test('reading past the plan: 15 credits per started 10 minutes, nothing when none is over', () => {
  assert.equal(readingCredits(0), 0)
  assert.equal(readingCredits(-5), 0)
  assert.equal(readingCredits(1), 15)
  assert.equal(readingCredits(10 * MIN), 15)
  assert.equal(readingCredits(10 * MIN + 1), 30)
  assert.equal(readingCredits(60 * MIN), 90)
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

test('Subjects: 2 credits per started minute of what no earlier payment covers', () => {
  assert.equal(subjectsCredits(0), 0)
  assert.equal(subjectsCredits(90_000), 4)
  assert.equal(subjectsCredits(5 * MIN), 10)
  assert.equal(subjectsNewMs(0, 90_000, []), 90_000)                                       // never paid: the whole clip
  assert.equal(subjectsNewMs(0, 90_000, [{ start_ms: 0, end_ms: 90_000 }]), 0)             // the same clip again
  assert.equal(subjectsNewMs(10_000, 50_000, [{ start_ms: 0, end_ms: 90_000 }]), 0)        // trimmed inside it
  assert.equal(subjectsNewMs(0, 150_000, [{ start_ms: 0, end_ms: 90_000 }]), 60_000)       // grown at one end: the new part
  assert.equal(subjectsNewMs(-30_000, 120_000, [{ start_ms: 0, end_ms: 90_000 }]), 60_000) // both ends: both new parts
  assert.equal(subjectsNewMs(0, 180_000, [{ start_ms: 0, end_ms: 60_000 }, { start_ms: 120_000, end_ms: 180_000 }]), 60_000) // the gap
  assert.equal(subjectsNewMs(0, 90_400, [{ start_ms: 0, end_ms: 90_000 }]), 0)             // under a second: the frames were read
})

test('each bigger top-up pack costs less per credit', () => {
  const each = TOPUP_PACKS.map(p => p.price / p.credits)
  for (let i = 1; i < each.length; i++) assert.ok(each[i] < each[i - 1], `pack ${i}: ${each[i]} is not under ${each[i - 1]}`)
})

test('credit history says in plain words what each row was', () => {
  assert.equal(ledgerLabel('spend', 'render'), 'Export')
  assert.equal(ledgerLabel('spend', 'caption'), 'Captions')
  assert.equal(ledgerLabel('spend', 'subjects'), 'Subjects')
  assert.equal(ledgerLabel('spend', 'ask_ai'), 'Ask AI')
  assert.equal(ledgerLabel('spend', 'rewrite'), 'Rewrites')
  assert.equal(ledgerLabel('spend', 'search'), 'New moment search')
  assert.equal(ledgerLabel('spend', 'ai_clips'), 'AI clips')
  assert.equal(ledgerLabel('spend', 'reading'), 'Reading past your plan')
  assert.equal(ledgerLabel('release', 'render'), 'Export: credits returned')
  assert.equal(ledgerLabel('grant:plan', null), 'Monthly plan credits')
  assert.equal(ledgerLabel('grant:topup', null), 'Top-up')
  assert.equal(ledgerLabel('grant:free', null), 'Free credits')
  assert.equal(ledgerLabel('spend', 'something_new'), 'Credits used')
  assert.equal(ledgerLabel('whatever', null), 'Credits changed')
})

test('a plan gives credits worth what it costs: 1 credit = ₹1', () => {
  for (const p of Object.values(PLANS)) if (p.price) assert.equal(p.monthlyCredits, p.price, p.key)
  assert.equal(FREE_SIGNUP_CREDITS, 95)   // what Free's limits use (30 min, 3 clips, 3 Ask AI, 20 rewrites: 88) and 7 to export
})

test('a video costs 15 credits per started 10 minutes', () => {
  assert.equal(readingCredits(0), 0)
  assert.equal(readingCredits(MIN), 15)
  assert.equal(readingCredits(10 * MIN), 15)
  assert.equal(readingCredits(11 * MIN), 30)
  assert.equal(readingCredits(60 * MIN), 90)
})

test('the ₹1 test pack is only for the emails listed in TEST_PACK_EMAILS (user, 2026-11-12)', () => {
  const env = { TEST_PACK_EMAILS: ' Owner@Shortcut.test ,second@x.test' }
  assert.equal(testPackAllowed('owner@shortcut.test', env), true)
  assert.equal(testPackAllowed('SECOND@x.test', env), true)
  assert.equal(testPackAllowed('other@x.test', env), false)
  assert.equal(testPackAllowed(null, env), false)
  assert.equal(testPackAllowed('owner@shortcut.test', {}), false)
  assert.equal(testPackAllowed('', { TEST_PACK_EMAILS: ',' }), false)
  assert.deepEqual(findTopupPack('test', { test: true }), { key: 'test', credits: 1, price: 1 })
  assert.equal(findTopupPack('test', { test: false }), undefined)
  assert.equal(findTopupPack('small', { test: false })?.price, 199)
  // never one of the packs everyone sees
  assert.ok(!TOPUP_PACKS.some(p => (p.key as string) === 'test'))
})
