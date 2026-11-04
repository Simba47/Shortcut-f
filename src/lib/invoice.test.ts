import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitTax, fiscalYear, formatInvoiceNo, stateName, normalizeGstin, amountInRupees } from './invoice.ts'

test('GST inside the price: ₹599 at 18% is ₹507.63 + ₹91.37, split half and half within the state', () => {
  const t = splitTax(59900, 18, true)
  assert.deepEqual(t, { taxablePaise: 50763, cgstPaise: 4568, sgstPaise: 4569, igstPaise: 0, totalPaise: 59900 })
})

test('between states the whole tax is IGST', () => {
  const t = splitTax(59900, 18, false)
  assert.deepEqual(t, { taxablePaise: 50763, cgstPaise: 0, sgstPaise: 0, igstPaise: 9137, totalPaise: 59900 })
})

test('the parts always add up to what was paid, for any amount', () => {
  for (const amount of [1, 99, 19900, 99900, 259900, 279900, 123457]) {
    for (const intra of [true, false]) {
      const t = splitTax(amount, 18, intra)
      assert.equal(t.taxablePaise + t.cgstPaise + t.sgstPaise + t.igstPaise, amount, `${amount} ${intra}`)
    }
  }
})

test('no GST rate means nothing is split off', () => {
  assert.deepEqual(splitTax(59900, 0, true), { taxablePaise: 59900, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 59900 })
})

test('the financial year runs April to March, by Indian time', () => {
  assert.equal(fiscalYear(new Date('2026-10-24T10:00:00+05:30')), '2026-27')
  assert.equal(fiscalYear(new Date('2027-03-31T23:00:00+05:30')), '2026-27')
  assert.equal(fiscalYear(new Date('2027-04-01T00:30:00+05:30')), '2027-28')
  // 31 March 20:00 UTC is already 1 April in India
  assert.equal(fiscalYear(new Date('2027-03-31T20:00:00Z')), '2027-28')
  assert.equal(fiscalYear(new Date('2099-12-01T00:00:00+05:30')), '2099-00')
})

test('invoice numbers run in order within a year, padded', () => {
  assert.equal(formatInvoiceNo('2026-27', 1), 'SC/2026-27/000001')
  assert.equal(formatInvoiceNo('2026-27', 1234), 'SC/2026-27/001234')
})

test('state codes become names; unknown ones are shown as given', () => {
  assert.equal(stateName('36'), 'Telangana')
  assert.equal(stateName('27'), 'Maharashtra')
  assert.equal(stateName(null), '')
  assert.equal(stateName('99'), '99')
})

test('a GSTIN is 15 letters and digits in capitals; anything else is rejected', () => {
  assert.equal(normalizeGstin(' 36aabcs1234a1z5 '), '36AABCS1234A1Z5')
  assert.equal(normalizeGstin('36AABCS1234A1Z'), null)
  assert.equal(normalizeGstin('not a gstin at all'), null)
  assert.equal(normalizeGstin(''), null)
})

test('paise shown as rupees with two decimals', () => {
  assert.equal(amountInRupees(50763), '507.63')
  assert.equal(amountInRupees(259900), '2,599.00')
  assert.equal(amountInRupees(100000000), '10,00,000.00')
})
