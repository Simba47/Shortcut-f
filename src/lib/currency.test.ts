import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  usdPaymentsOn, trialPriceText,
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
  assert.equal(chooseCurrency('INR', 'USD', true), 'INR', 'paid in rupees: no switching to dollars')
  assert.equal(chooseCurrency('USD', 'INR', true), 'USD', 'paid in dollars: no switching to the cheaper rupees')
  assert.equal(chooseCurrency(null, 'USD', true), 'USD')
  assert.equal(chooseCurrency(null, 'INR', true), 'INR')
  assert.equal(chooseCurrency(null, undefined, true), 'INR', 'an old page that sends nothing: rupees, as before')
  assert.equal(chooseCurrency(null, 'EUR', true), 'INR', 'a currency we do not sell in')
  assert.equal(chooseCurrency(null, { x: 1 }, true), 'INR')
})

test('dollars switched off (NEXT_PUBLIC_USD_PAYMENTS not 1): a page asking for dollars pays in rupees', () => {
  assert.equal(chooseCurrency(null, 'USD', false), 'INR')
  assert.equal(chooseCurrency(null, 'INR', false), 'INR')
  assert.equal(chooseCurrency('USD', 'USD', false), 'USD', 'an account already paying in dollars keeps them')
  const was = process.env.NEXT_PUBLIC_USD_PAYMENTS
  try {
    delete process.env.NEXT_PUBLIC_USD_PAYMENTS
    assert.equal(usdPaymentsOn(), false, 'off unless set')
    assert.equal(chooseCurrency(null, 'USD'), 'INR')
    process.env.NEXT_PUBLIC_USD_PAYMENTS = '1'
    assert.equal(usdPaymentsOn(), true)
    assert.equal(chooseCurrency(null, 'USD'), 'USD')
  } finally {
    if (was === undefined) delete process.env.NEXT_PUBLIC_USD_PAYMENTS; else process.env.NEXT_PUBLIC_USD_PAYMENTS = was
  }
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

test('the Trial\'s price in words: the visitor\'s own, or ₹49 for everyone (and ₹49 / $1.99 once dollars are on)', () => {
  assert.equal(trialPriceText('INR'), '₹49')
  assert.equal(trialPriceText('USD'), '$1.99')
  const was = process.env.NEXT_PUBLIC_USD_PAYMENTS
  try {
    delete process.env.NEXT_PUBLIC_USD_PAYMENTS
    assert.equal(trialPriceText(), '₹49', 'dollars off: exactly as before')
    process.env.NEXT_PUBLIC_USD_PAYMENTS = '1'
    assert.equal(trialPriceText(), '₹49 / $1.99')
  } finally {
    if (was === undefined) delete process.env.NEXT_PUBLIC_USD_PAYMENTS; else process.env.NEXT_PUBLIC_USD_PAYMENTS = was
  }
})

test('Pro\'s invoice row: GST in rupees, the company\'s details only in dollars', async () => {
  const { planCompareRows } = await import('./planFeatures.ts')
  const { PLANS } = await import('./plans.ts')
  const row = (c: 'INR' | 'USD') => planCompareRows(PLANS.creator, c).at(-1)
  assert.deepEqual(row('INR'), { label: 'GST invoice with your company', value: 'Yes', strong: true })
  assert.deepEqual(row('USD'), { label: 'Invoice with your company details', value: 'Yes', strong: true })
})
