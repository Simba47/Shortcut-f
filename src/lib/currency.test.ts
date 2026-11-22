import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  planPriceMinor, packPriceMinor, formatMoney, currencyFromTimeZone, chooseCurrency, packSavingIn, USD_PLAN_CENTS, USD_PACK_CENTS,
} from './currency.ts'
import { PLANS } from './plans.ts'
import { TOPUP_PACKS, packSaving } from './credits.ts'

// Rupees or dollars (user, 2026-11-22: international payments, "Global prices", "Auto, locked at first payment")

test('the user\'s dollar prices: Trial $1.99, Starter $9, Pro $15; packs $3 / $7 / $17 / $39', () => {
  assert.equal(planPriceMinor('trial', 'USD'), 199)
  assert.equal(planPriceMinor('starter', 'USD'), 900)
  assert.equal(planPriceMinor('creator', 'USD'), 1500)
  assert.deepEqual(TOPUP_PACKS.map(p => packPriceMinor(p.key, 'USD')), [300, 700, 1700, 3900])
  assert.equal(packPriceMinor('trial', 'USD'), 199, 'the Trial pack is the Trial plan\'s price')
})

test('rupee prices are the plans\' and packs\' own, in paise', () => {
  assert.equal(planPriceMinor('starter', 'INR'), PLANS.starter.price * 100)
  assert.equal(planPriceMinor('trial', 'INR'), PLANS.trial.price * 100)
  for (const p of TOPUP_PACKS) assert.equal(packPriceMinor(p.key, 'INR'), p.price * 100)
  assert.equal(packPriceMinor('trial', 'INR'), PLANS.trial.price * 100)
  assert.equal(packPriceMinor('test', 'INR'), 100)
})

test('every plan and pack on sale has a dollar price; Agency (not sold) and unknown ones have none', () => {
  for (const [key, plan] of Object.entries(PLANS)) {
    if (plan.sold) assert.ok(USD_PLAN_CENTS[key as keyof typeof PLANS], `${key} has a dollar price`)
  }
  for (const p of TOPUP_PACKS) assert.ok(USD_PACK_CENTS[p.key], `${p.key} has a dollar price`)
  assert.equal(planPriceMinor('agency', 'USD'), null)
  assert.equal(planPriceMinor('nope', 'INR'), null)
  assert.equal(packPriceMinor('huge', 'USD'), null)
})

test('money shows as people read it: no .00 on whole amounts unless asked, Indian grouping for rupees', () => {
  assert.equal(formatMoney(59900, 'INR'), '₹599')
  assert.equal(formatMoney(259900, 'INR'), '₹2,599')
  assert.equal(formatMoney(10000000, 'INR'), '₹1,00,000')
  assert.equal(formatMoney(900, 'USD'), '$9')
  assert.equal(formatMoney(199, 'USD'), '$1.99')
  assert.equal(formatMoney(59900, 'INR', { cents: true }), '₹599.00')
  assert.equal(formatMoney(900, 'USD', { cents: true }), '$9.00')
  assert.equal(formatMoney(10000000, 'USD'), '$100,000')
})

test('India\'s time zone pays in rupees, anywhere else in dollars; no time zone is rupees', () => {
  assert.equal(currencyFromTimeZone('Asia/Kolkata'), 'INR')
  assert.equal(currencyFromTimeZone('Asia/Calcutta'), 'INR')
  assert.equal(currencyFromTimeZone('America/New_York'), 'USD')
  assert.equal(currencyFromTimeZone('Asia/Dubai'), 'USD')
  assert.equal(currencyFromTimeZone('Europe/London'), 'USD')
  assert.equal(currencyFromTimeZone(undefined), 'INR')
  assert.equal(currencyFromTimeZone(''), 'INR')
})

test('an account that has paid keeps its currency whatever the page asks; before that the page decides', () => {
  assert.equal(chooseCurrency('INR', 'USD'), 'INR', 'paid in rupees: no switching to dollars')
  assert.equal(chooseCurrency('USD', 'INR'), 'USD', 'paid in dollars: no switching to the cheaper rupees')
  assert.equal(chooseCurrency(null, 'USD'), 'USD')
  assert.equal(chooseCurrency(null, 'INR'), 'INR')
  assert.equal(chooseCurrency(null, undefined), 'INR', 'an old page that sends nothing: rupees, as before')
  assert.equal(chooseCurrency(null, 'EUR'), 'INR', 'a currency we do not sell in')
  assert.equal(chooseCurrency(null, { x: 1 }), 'INR')
})

test('the struck pack price in rupees is unchanged; in dollars it is the same credits at Starter\'s rate', () => {
  for (const p of TOPUP_PACKS) {
    const before = packSaving(p)
    const now = packSavingIn(p, 'INR')
    assert.deepEqual(now && { was: now.was / 100, saved: now.saved / 100, percent: now.percent }, before, p.key)
  }
  assert.equal(packSavingIn({ key: 'small', credits: 200 }, 'USD'), null, '$3 for 200 saves only a cent')
  assert.deepEqual(packSavingIn({ key: 'medium', credits: 500 }, 'USD'), { was: 751, saved: 51, percent: 7 })
  assert.deepEqual(packSavingIn({ key: 'bulk', credits: 3000 }, 'USD'), { was: 4508, saved: 608, percent: 13 })
})
