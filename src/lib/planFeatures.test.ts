import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLANS } from './plans'
import { planFeatureRows, creditUses } from './planFeatures'

const labels = (key: keyof typeof PLANS) => planFeatureRows(PLANS[key]).map(r => (r.included ? '' : 'x ') + r.label)

test('a paid plan lists every limit the server applies, with the numbers from plans.ts', () => {
  assert.deepEqual(labels('starter'), [
    '3 hours of video read a month',
    '10 uploads a month',
    '10 videos at a time',
    'Up to 5 GB per video',
    'Unlimited clips you cut yourself',
    '20 AI clips a month, then 5 credits each',
    'Up to 10 clips per Make my clips',
    '1 AI moment search per video',
    '10 Ask AI searches a month',
    '30 hook and title rewrites a month',
    '30 days history',
    'Captions on AI clips included',
    'No watermark',
    'x Priority exports',
  ])
})

test('the free plan says its clips are 3 in total, not per day', () => {
  const rows = labels('free')
  assert.ok(rows.includes('3 clips in total'))
  assert.ok(!rows.some(r => /Unlimited|a day/.test(r)))
  assert.ok(rows.includes('1 AI moment search per video'))
  assert.ok(rows.includes('30 minutes of video read in total'))
  assert.ok(rows.includes('3 uploads in total'))
  assert.ok(rows.includes('3 Ask AI searches in total'))
  assert.ok(rows.includes('20 hook and title rewrites in total'))
  assert.ok(rows.includes('x Captions on AI clips included'))
  assert.ok(rows.includes('x No watermark'))
})

test('no plan claims unlimited AI clips, and only Agency gets priority exports', () => {
  for (const key of Object.keys(PLANS) as (keyof typeof PLANS)[]) {
    const rows = planFeatureRows(PLANS[key])
    assert.ok(!rows.some(r => r.label === 'Unlimited clips'), key)
    assert.equal(rows.find(r => r.label === 'Priority exports')?.included, key === 'agency', key)
  }
  assert.ok(labels('agency').includes('90 AI clips a month, then 5 credits each'))
  assert.ok(labels('agency').includes('14 hours of video read a month'))
  assert.ok(labels('creator').includes('20 Ask AI searches a month'))
})

test('what a credit buys does not call AI features free without limits', () => {
  const text = creditUses().map(u => `${u.name} ${u.price} ${u.note}`).join(' ')
  assert.ok(!/are then free/.test(text))
  assert.match(text, /1 credit = ₹1/)
  assert.match(text, /5 credits per 10 minutes/)       // a search past the plan's
  assert.match(text, /15 credits per 10 minutes/)      // reading past the plan's hours
  assert.match(text, /7 credits per Ask AI search/)
  assert.match(text, /5 credits per AI clip past/)
  assert.match(text, /2 credits per clip minute/)
  assert.match(text, /Subjects/)                       // charged like captions
  assert.match(text, /per started hour/)               // Ask AI on a long video
  assert.match(text, /1 credit per clip minute/)       // an export
  assert.match(text, /1 credit per 5 rewrites/)
  assert.match(text, /Reading your video In your plan/)
})
