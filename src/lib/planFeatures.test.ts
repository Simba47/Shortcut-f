import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLANS } from './plans'
import { planFeatureRows, creditUses } from './planFeatures'

const labels = (key: keyof typeof PLANS) => planFeatureRows(PLANS[key]).map(r => (r.included ? '' : 'x ') + r.label)

test('a paid plan lists every limit the server applies, with the numbers from plans.ts', () => {
  assert.deepEqual(labels('starter'), [
    '5 videos at a time',
    'Up to 5 GB per video',
    'Unlimited clips you cut yourself',
    'Up to 30 AI clips a day',
    'Up to 10 clips per Make my clips',
    '3 AI moment searches per video',
    '100 Ask AI searches a month',
    '150 hook and title rewrites a month',
    '30 days history',
    'Auto captions',
    'No watermark',
    'x Priority exports',
  ])
})

test('the free plan says its clips are 3 in total, not per day', () => {
  const rows = labels('free')
  assert.ok(rows.includes('3 clips in total'))
  assert.ok(!rows.some(r => /Unlimited|a day/.test(r)))
  assert.ok(rows.includes('1 AI moment search per video'))
  assert.ok(rows.includes('x Auto captions'))
  assert.ok(rows.includes('x No watermark'))
})

test('no plan claims unlimited AI clips, and only Agency gets priority exports', () => {
  for (const key of Object.keys(PLANS) as (keyof typeof PLANS)[]) {
    const rows = planFeatureRows(PLANS[key])
    assert.ok(!rows.some(r => r.label === 'Unlimited clips'), key)
    assert.equal(rows.find(r => r.label === 'Priority exports')?.included, key === 'agency', key)
  }
  assert.ok(labels('agency').includes('Up to 150 AI clips a day'))
  assert.ok(labels('creator').includes('200 Ask AI searches a month'))
})

test('what a credit buys does not call AI features free without limits', () => {
  const text = creditUses().map(u => `${u.name} ${u.price} ${u.note}`).join(' ')
  assert.ok(!/are then free/.test(text))
  assert.match(text, /1 credit per 10 minutes/)       // a search past the plan's
  assert.match(text, /1 credit per Ask AI search/)
  assert.match(text, /1 credit per 5 rewrites/)
  assert.match(text, /2 credits \(3 for 3 to 5 min\)/)
})
