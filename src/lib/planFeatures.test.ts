import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLANS } from './plans'
import { planFeatureRows, creditUses } from './planFeatures'

const labels = (key: keyof typeof PLANS) => planFeatureRows(PLANS[key]).map(r => (r.included ? '' : 'x ') + r.label)

test('a paid plan lists every limit the server applies, with the numbers from plans.ts (its hours a month: back 2026-11-22)', () => {
  assert.deepEqual(labels('starter'), [
    '3 hours of video a month',
    'Spend your credits on anything',
    '15 GB of storage',
    'Up to 5 GB per video',
    '2 devices signed in at a time',
    'Unlimited clips you cut yourself',
    'Up to 10 clips per Make my clips',
    'First AI moment search included with every video',
    '2 brand kits',
    'x Share your brand kits with your team',
    'Videos kept 30 days',
    'x Keep chosen videos for good',
    'Captions on AI clips included',
    'No watermark',
    'x Priority exports',
    'x GST invoices with your company details',
  ])
})

test('the Trial lists its 2 uploads in total, and how long it lasts', () => {
  assert.deepEqual(labels('trial'), [
    '30 minutes of video in total',
    'Spend your credits on anything',
    '2 uploads in total',
    '5 GB of storage',
    'Up to 2 GB per video',
    '1 device signed in at a time',
    'Unlimited clips you cut yourself',
    'Up to 3 clips per Make my clips',
    'First AI moment search included with every video',
    '1 brand kit',
    'x Share your brand kits with your team',
    'Lasts 7 days',
    'x Keep chosen videos for good',
    'Captions on AI clips included',
    'No watermark',
    'x Priority exports',
    'x GST invoices with your company details',
  ])
})

test('Pro (and Agency, not sold) get priority exports, GST invoice details and team sharing; Pro has 4 brand kits', () => {
  // (and Unlimited, Shortcut's own test accounts: never sold)
  const top = (key: string) => key === 'creator' || key === 'agency' || key === 'unlimited'
  for (const key of Object.keys(PLANS) as (keyof typeof PLANS)[]) {
    const rows = planFeatureRows(PLANS[key])
    assert.ok(!rows.some(r => r.label === 'Unlimited clips'), key)
    // the hours of video are the only monthly limit listed (back 2026-11-22)
    assert.deepEqual(rows.filter(r => /a month/.test(r.label)).map(r => r.label), PLANS[key].allowancesOnce ? [] : [`${PLANS[key].readingMinutes / 60} hours of video a month`], key)
    assert.equal(rows.find(r => r.label === 'Priority exports')?.included, top(key), key)
    assert.equal(rows.find(r => r.label === 'GST invoices with your company details')?.included, top(key), key)
    assert.equal(rows.find(r => r.label === 'Share your brand kits with your team')?.included, top(key), key)
  }
  assert.equal(PLANS.creator.name, 'Pro')
  assert.ok(labels('creator').includes('4 brand kits'))
  assert.ok(labels('creator').includes('30 GB of storage'))
  assert.ok(labels('creator').includes('3 devices signed in at a time'))
  assert.ok(labels('creator').includes('Keep chosen videos for good'))
  assert.ok(labels('creator').includes('Videos kept 30 days'))
  assert.deepEqual(Object.values(PLANS).filter(p => p.sold).map(p => p.key), ['trial', 'starter', 'creator'])
})

test('what a credit buys does not call AI features free without limits', () => {
  const text = creditUses().map(u => `${u.name} ${u.price} ${u.note}`).join(' ')
  assert.ok(!/are then free/.test(text))
  assert.ok(!/₹/.test(text), 'credits are shown without rupees')
  assert.match(text, /5 credits per 10 minutes/)       // a search past the free one
  assert.match(text, /15 credits per 10 minutes/)      // reading
  assert.match(text, /7 credits per Ask AI search/)
  assert.match(text, /7 credits per AI clip/)
  assert.match(text, /2 credits per clip minute/)
  assert.match(text, /Subjects/)                       // charged like captions
  assert.match(text, /per started hour/)               // Ask AI on a long video
  assert.match(text, /1 credit per clip minute/)       // an export
  assert.match(text, /1 credit per 5 rewrites/)
  assert.match(text, /Reading your video 15 credits per 10 minutes/)
})

test('the pricing cards show only what differs, the same rows in the same order on every plan', async () => {
  const { planCompareRows, everyPlanIncludes, creditPrices } = await import('./planFeatures')
  const rows = (key: keyof typeof PLANS) => planCompareRows(PLANS[key]).map(r => `${r.label}: ${r.value === false ? '—' : r.value}${r.strong ? ' *' : ''}`)
  assert.deepEqual(rows('trial'), ['Video: 30 minutes in total', 'Uploads: 2 in total', 'Storage: 5 GB', 'One video up to: 2 GB', 'Videos kept: 7 days', 'Signed in on: 1 device',
    'Brand kits: 1', 'Clips per Make my clips: Up to 3', 'Priority exports: —', 'GST invoice with your company: —'])
  assert.deepEqual(rows('starter'), ['Video: 3 hours a month', 'Uploads: No limit', 'Storage: 15 GB', 'One video up to: 5 GB', 'Videos kept: 30 days', 'Signed in on: 2 devices',
    'Brand kits: 2', 'Clips per Make my clips: Up to 10', 'Priority exports: —', 'GST invoice with your company: —'])
  assert.deepEqual(rows('creator'), ['Video: 5 hours a month', 'Uploads: No limit', 'Storage: 30 GB', 'One video up to: 8 GB', 'Videos kept: 30 days, or ★ Keep for good *', 'Signed in on: 3 devices',
    'Brand kits: 4, shared with your team *', 'Clips per Make my clips: Up to 15', 'Priority exports: Yes *', 'GST invoice with your company: Yes *'])
  const labels = (key: keyof typeof PLANS) => planCompareRows(PLANS[key]).map(r => r.label)
  assert.deepEqual(labels('trial'), labels('creator'))
  assert.ok(everyPlanIncludes().some(t => /up to your plan's hours of video/i.test(t)))
  assert.ok(creditPrices().some(p => p.price === '7 credits'))
})

test('each plan card says what its credits make, as the credit packs do', async () => {
  const { packUses } = await import('./credits')
  const { CLIP_CREDITS } = await import('./aiLimits')
  assert.deepEqual(packUses(99, CLIP_CREDITS), { aiClips: 14, captionedMinutes: 33 })
  assert.deepEqual(packUses(PLANS.starter.monthlyCredits, CLIP_CREDITS), { aiClips: 85, captionedMinutes: 199 })
  assert.deepEqual(packUses(PLANS.creator.monthlyCredits, CLIP_CREDITS), { aiClips: 142, captionedMinutes: 333 })
})
