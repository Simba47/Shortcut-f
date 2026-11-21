// What a payment bought, for its invoice and email (purchase.ts), and the amount in words (invoice.ts).
// Run: npx tsx --test src/lib/purchase.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describePurchase, renewalNote } from './purchase'
import { rupeesInWords } from './invoice'

const paid = new Date('2026-11-18T10:00:00+05:30')

test('a plan is a monthly subscription that renews', () => {
  const p = describePurchase('creator', paid)
  assert.equal(p.name, 'Pro plan')  // the 'creator' key, named Pro since 2026-11-21
  assert.equal(p.kind, 'subscription')
  assert.equal(p.credits, 999)
  assert.equal(p.validUntil, null)
  assert.match(renewalNote(p)!, /renews every month/)
})

test('the Trial pack is one-time: 99 credits for 7 days, never "renews"', () => {
  const p = describePurchase('topup:trial', paid)
  assert.equal(p.name, 'Trial pack')
  assert.equal(p.kind, 'one-time')
  assert.equal(p.credits, 99)
  assert.equal(p.validUntil!.toISOString(), new Date(paid.getTime() + 7 * 86_400_000).toISOString())
  assert.doesNotMatch(`${p.name} ${p.detail} ${renewalNote(p)}`, /renews every|plan is active|one month/)
  assert.match(renewalNote(p)!, /one-time payment/)
})

test('a credit top-up is one-time, credits for a year', () => {
  const p = describePurchase('topup:medium', paid)
  assert.equal(p.name, '500 credits top-up')
  assert.equal(p.kind, 'one-time')
  assert.match(p.detail, /365 days/)
})

test('the ₹1 test pack reads as a top-up; an unknown plan says nothing about renewing', () => {
  assert.equal(describePurchase('topup:test', paid).name, '1 credit top-up')
  const u = describePurchase('something-old', paid)
  assert.equal(u.kind, 'other')
  assert.equal(renewalNote(u), null)
})

test('amounts in words, Indian style', () => {
  assert.equal(rupeesInWords(5000), 'Rupees Fifty Only')
  assert.equal(rupeesInWords(259900), 'Rupees Two Thousand Five Hundred Ninety-Nine Only')
  assert.equal(rupeesInWords(50763), 'Rupees Five Hundred Seven and Sixty-Three Paise Only')
  assert.equal(rupeesInWords(12345678900), 'Rupees Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine Only')
  assert.equal(rupeesInWords(100), 'Rupees One Only')
})
