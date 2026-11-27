import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountBanners, pickBanner, finishedNote, shownAlready, readyTitle, plainTitle, quoted, type AccountFacts, type FinishedJob } from './notices'

const NOW = Date.parse('2026-11-26T06:00:00Z')
const DAY = 86_400_000
const GB = 1024 ** 3
const at = (days: number) => new Date(NOW + days * DAY).toISOString()

const base: AccountFacts = {
  plan: 'starter', topPlan: false,
  credits: { balance: 400, expiring: null },
  trial: { active: false, endsAt: null },
  renewalFailed: null,
  storage: { usedBytes: 2 * GB, totalBytes: 15 * GB },
}
const kinds = (f: Partial<AccountFacts>) => accountBanners({ ...base, ...f }, NOW).map(b => b.kind)

test('a healthy account has no banner', () => {
  assert.deepEqual(kinds({}), [])
  assert.equal(pickBanner({ ...base }, {}, { now: NOW }), null)
  assert.equal(pickBanner(null, {}), null)
})

test('a failed renewal shows only while the account has no plan', () => {
  const failed = { planName: 'Pro', at: at(-2) }
  assert.deepEqual(kinds({ plan: 'free', renewalFailed: failed, credits: { balance: 0, expiring: null } }), ['renewal_failed'])
  const b = accountBanners({ ...base, plan: 'free', renewalFailed: failed }, NOW)[0]
  assert.equal(b.tone, 'error')
  assert.match(b.title, /couldn’t renew your Pro plan/)
  assert.equal(b.action?.href, '/pricing')
  // a plan bought since (on a plan again): nothing to tell
  assert.deepEqual(kinds({ renewalFailed: failed }), [])
})

test('out of credits: red, on a plan only (an account with no plan is told elsewhere)', () => {
  assert.deepEqual(kinds({ credits: { balance: 0, expiring: null } }), ['out_of_credits'])
  assert.deepEqual(kinds({ plan: 'free', credits: { balance: 0, expiring: null } }), [])
  // credits off on this site: nothing about credits
  assert.deepEqual(kinds({ credits: null }), [])
})

test('credits low: under 15, comes back when it gets to 5 or fewer', () => {
  assert.deepEqual(kinds({ credits: { balance: 15, expiring: null } }), [])
  assert.deepEqual(kinds({ credits: { balance: 14, expiring: null } }), ['credits_low'])
  const at12 = accountBanners({ ...base, credits: { balance: 12, expiring: null } }, NOW)[0]
  assert.equal(at12.title, '12 credits left.')
  const hidden = { credits_low: at12.level }
  assert.equal(pickBanner({ ...base, credits: { balance: 9, expiring: null } }, hidden, { now: NOW }), null)
  assert.equal(pickBanner({ ...base, credits: { balance: 5, expiring: null } }, hidden, { now: NOW })?.kind, 'credits_low')
  assert.equal(accountBanners({ ...base, credits: { balance: 1, expiring: null } }, NOW)[0].title, '1 credit left.')
})

test('credits expiring within 7 days', () => {
  assert.deepEqual(kinds({ credits: { balance: 400, expiring: { amount: 120, at: at(8) } } }), [])
  const b = accountBanners({ ...base, credits: { balance: 400, expiring: { amount: 120, at: at(5) } } }, NOW)[0]
  assert.equal(b.kind, 'credits_expiring')
  assert.match(b.title, /^120 credits expire on \d+ December\.$/)
  assert.match(accountBanners({ ...base, credits: { balance: 400, expiring: { amount: 1, at: at(0.5) } } }, NOW)[0].title, /^1 credit expires today\.$/)
  // already gone, or nothing left to spend: no banner
  assert.deepEqual(kinds({ credits: { balance: 400, expiring: { amount: 120, at: at(-1) } } }), [])
})

test('the Trial: warned in its last 2 days; its credits ending with it are not warned twice', () => {
  const trial = (days: number): Partial<AccountFacts> => ({ plan: 'trial', trial: { active: true, endsAt: at(days) }, credits: { balance: 60, expiring: { amount: 60, at: at(days) } } })
  assert.deepEqual(kinds(trial(3)), [])
  assert.deepEqual(kinds(trial(1.5)), ['trial_ending'])
  assert.equal(accountBanners({ ...base, ...trial(1.5) }, NOW)[0].title, 'Your Trial ends tomorrow.')
  assert.equal(accountBanners({ ...base, ...trial(1.9) }, NOW)[0].title, 'Your Trial ends in 2 days.')
  assert.equal(accountBanners({ ...base, ...trial(0.5) }, NOW)[0].title, 'Your Trial ends today.')
})

test('storage: from 85%, full at 100%; no See plans on the top plan', () => {
  assert.deepEqual(kinds({ storage: { usedBytes: 12 * GB, totalBytes: 15 * GB } }), [])
  const low = accountBanners({ ...base, storage: { usedBytes: 13.1 * GB, totalBytes: 15 * GB } }, NOW)[0]
  assert.equal(low.kind, 'storage_low')
  assert.equal(low.title, 'You’ve used 13 GB of your 15 GB.')
  assert.equal(low.action?.label, 'See plans')
  assert.equal(accountBanners({ ...base, topPlan: true, storage: { usedBytes: 13.1 * GB, totalBytes: 15 * GB } }, NOW)[0].action, null)
  assert.deepEqual(kinds({ storage: { usedBytes: 15 * GB, totalBytes: 15 * GB } }), ['storage_full'])
  // hidden at 86%: back at 90%
  const hidden = { storage_low: accountBanners({ ...base, storage: { usedBytes: 0.86 * 15 * GB, totalBytes: 15 * GB } }, NOW)[0].level }
  assert.equal(pickBanner({ ...base, storage: { usedBytes: 0.88 * 15 * GB, totalBytes: 15 * GB } }, hidden, { now: NOW }), null)
  assert.equal(pickBanner({ ...base, storage: { usedBytes: 0.91 * 15 * GB, totalBytes: 15 * GB } }, hidden, { now: NOW })?.kind, 'storage_low')
})

test('the most urgent shows first; the editor shows only the red ones', () => {
  const f: AccountFacts = { ...base, credits: { balance: 10, expiring: { amount: 10, at: at(3) } }, storage: { usedBytes: 14 * GB, totalBytes: 15 * GB } }
  assert.deepEqual(accountBanners(f, NOW).map(b => b.kind), ['credits_low', 'credits_expiring', 'storage_low'])
  assert.equal(pickBanner(f, {}, { now: NOW })?.kind, 'credits_low')
  assert.equal(pickBanner(f, { credits_low: 'low' }, { now: NOW })?.kind, 'credits_expiring')
  assert.equal(pickBanner(f, {}, { now: NOW, onlyRed: true }), null)
  assert.equal(pickBanner({ ...f, credits: { balance: 0, expiring: null } }, {}, { now: NOW, onlyRed: true })?.kind, 'out_of_credits')
})

const job = (j: Partial<FinishedJob>): FinishedJob => ({
  id: 'j1', kind: 'reading', ok: true, videoId: 'v1', videoTitle: 'Podcast ep 12', clipId: null, clipTitle: null, made: null, refunded: 0, ...j,
})

test('what a finished job says', () => {
  assert.deepEqual(finishedNote(job({})), { tone: 'ok', text: '“Podcast ep 12” is read', action: { label: 'Make clips', href: '/videos/v1' }, title: 'Your video is read', body: '“Podcast ep 12” is ready for clips.' })
  assert.equal(finishedNote(job({ ok: false, refunded: 15 })).text, 'Couldn’t read “Podcast ep 12” · 15 credits came back')
  assert.equal(finishedNote(job({ ok: false })).tone, 'error')
  assert.equal(finishedNote(job({ kind: 'clips', made: 10 })).text, '10 clips are ready')
  assert.equal(finishedNote(job({ kind: 'clips', made: 1 })).text, '1 clip is ready')
  assert.equal(finishedNote(job({ kind: 'clips', made: 3, refunded: 14 })).text, '3 clips are ready · 14 credits came back')
  assert.equal(finishedNote(job({ kind: 'clips', made: 0 })).tone, 'info')
  assert.equal(finishedNote(job({ kind: 'clips', ok: false, refunded: 7 })).text, 'Make my clips didn’t finish · 7 credits came back')
  const ex = finishedNote(job({ kind: 'export', clipId: 'c1', clipTitle: 'Why I quit' }))
  assert.equal(ex.text, '“Why I quit” is exported')
  assert.equal(ex.action?.href, '/api/clips/c1/download')
  const bad = finishedNote(job({ kind: 'export', ok: false, clipId: 'c1', clipTitle: null, refunded: 1 }))
  assert.equal(bad.text, 'Your reel didn’t export · 1 credit came back')
  assert.equal(bad.action?.href, '/editor/c1')
  // a long or missing name
  assert.equal(quoted('A very long podcast episode title that goes on'), '“A very long podcast episode tit…”')
  assert.equal(finishedNote(job({ videoTitle: null })).text, 'Your video is read')
})

test('a page that shows it already is not toasted on top', () => {
  const ex = job({ kind: 'export', clipId: 'c1' })
  assert.equal(shownAlready(ex, { videoIds: [], clipIds: ['c1'] }), true)
  assert.equal(shownAlready(ex, { videoIds: ['v1'], clipIds: [] }), true)
  assert.equal(shownAlready(ex, { videoIds: ['v2'], clipIds: ['c2'] }), false)
})

test('the tab name gets “✓ Ready” once, and loses it', () => {
  const t = readyTitle(readyTitle('Dashboard — Shortcut'))
  assert.equal(t, '✓ Ready · Dashboard — Shortcut')
  assert.equal(plainTitle(t), 'Dashboard — Shortcut')
  assert.equal(plainTitle('Dashboard'), 'Dashboard')
})
