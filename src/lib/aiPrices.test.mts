import { test } from 'node:test'
import assert from 'node:assert/strict'
const { costMicroUsd } = await import('../server/services/aiUsage.ts')

// Google's Gemini API prices (Standard, paid tier; read 2026-11-24): the clip end check (3.6 Flash) and
// captions (3.5 Transcribe) were recorded with no price, so the admin's cost pages left them out

test('3.6 Flash: the introductory price in 2026 (the ~₹0.33 a clip end check), double from 1 Jan 2027', () => {
  assert.equal(costMicroUsd('gemini-3.6-flash', 2505, 393, new Date('2026-11-24T12:00:00Z')), 3353)
  assert.equal(costMicroUsd('gemini-3.6-flash', 2505, 393, new Date('2026-12-31T23:59:59Z')), 3353)
  assert.equal(costMicroUsd('gemini-3.6-flash', 2505, 393, new Date('2027-01-01T00:00:00Z')), 6705)
  assert.equal(costMicroUsd('gemini-3.6-flash:priority', 2505, 393, new Date('2027-02-01T00:00:00Z')), Math.round(6705 * 1.8))
})

test("3.5 Transcribe: a minute of audio (1,500 tokens in, 175 out) is ~$0.005, as on Google's page", () => {
  assert.equal(costMicroUsd('gemini-3.5-transcribe', 1500, 175), 5100)
})

test('models without a 2027 price keep theirs; an unknown model has none', () => {
  assert.equal(costMicroUsd('gemini-3.5-flash-lite', 1000, 100, new Date('2027-06-01T00:00:00Z')), 550)
  assert.equal(costMicroUsd('gemini-9-test', 1000, 100), null)
})
