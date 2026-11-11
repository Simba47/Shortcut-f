// The email check used by the sign-in form's first step and brand team invites (email.ts).
// Run: npm run test:email
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeEmail } from './email'

test('ordinary addresses pass, broken ones do not', () => {
  for (const ok of ['a@b.co', 'first.last@mail.example.in']) assert.equal(looksLikeEmail(ok), true, ok)
  for (const bad of ['', 'a@b', 'a b@c.d', 'a@@b.c', 'ab.c']) assert.equal(looksLikeEmail(bad), false, bad)
})

test('a huge crafted address is refused at once (the pattern alone took minutes on 1 MB)', () => {
  const t = Date.now()
  assert.equal(looksLikeEmail('a@' + '.'.repeat(1_000_000) + '@'), false)
  assert.ok(Date.now() - t < 50, `took ${Date.now() - t} ms`)
})

test('an address longer than email allows (254) is refused', () => {
  assert.equal(looksLikeEmail('a'.repeat(250) + '@b.co'), false)
})
