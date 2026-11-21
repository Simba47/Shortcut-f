import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canKeep, daysLeft, expiresLabel, expiresSoon, warnDays } from './expiry'
import { expiryEmail } from './expiryEmail'

const DAY = 86_400_000
const now = Date.UTC(2026, 10, 21, 6)

test('who keeps, and when a video is flagged: Pro keeps; the Trial is told 2 days before, the plans 3', () => {
  assert.deepEqual(['free', 'trial', 'starter', 'creator', 'agency'].map(canKeep), [false, false, false, true, true])
  assert.equal(warnDays('trial'), 2); assert.equal(warnDays('starter'), 3)
  assert.equal(expiresSoon(new Date(now + 2.5 * DAY), 'starter', now), true)
  assert.equal(expiresSoon(new Date(now + 2.5 * DAY), 'trial', now), false)
  assert.equal(expiresSoon(null, 'starter', now), false)
})

test('days left in words', () => {
  assert.equal(daysLeft(null, now), null)
  assert.equal(expiresLabel(new Date(now + 2.2 * DAY), now), 'Expires in 3 days')
  assert.equal(expiresLabel(new Date(now + 0.5 * DAY), now), 'Expires tomorrow')
  assert.equal(expiresLabel(new Date(now - DAY), now), 'Expires today')
})

test('the email lists each video, its clips and its day, and offers Keep only on Pro', () => {
  const at = new Date(Date.UTC(2026, 10, 24, 6))
  const one = expiryEmail({ base: 'https://shortcutapp.in', name: 'Asha Rao', canKeep: false, videos: [{ title: 'Episode <12>', expiresAt: at, clips: 3 }] })
  assert.equal(one.subject, '“Episode <12>” is deleted on 24 Nov')
  assert.match(one.html, /Episode &lt;12&gt;/)
  assert.match(one.text, /Hi Asha,/); assert.match(one.text, /3 clips\): 24 Nov/)
  assert.match(one.text, /Pro keeps videos for good/)
  assert.match(one.html, /https:\/\/shortcutapp\.in\/dashboard/)
  const two = expiryEmail({ base: 'x', name: null, canKeep: true, videos: [{ title: null, expiresAt: at, clips: 0 }, { title: 'B', expiresAt: at, clips: 1 }] })
  assert.equal(two.subject, '2 of your videos are deleted soon')
  assert.match(two.text, /press ★ Keep/); assert.match(two.text, /Untitled video \(no clips\)/)
})
