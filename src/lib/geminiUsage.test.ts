import { test } from 'node:test'
import assert from 'node:assert/strict'
import { askGemini, withGeminiUsage, type GeminiUsage } from './gemini.js'

// A Gemini answer with usage numbers, without the network
function fakeGemini() {
  const real = globalThis.fetch
  process.env.GEMINI_API_KEY = 'test-key'
  delete process.env.GOOGLE_CLOUD_PROJECT
  globalThis.fetch = (async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'ok' }] } }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 10 },
  }), { status: 200 })) as typeof fetch
  return () => { globalThis.fetch = real }
}

test('a call reports its tokens (thinking counted as output) to its own onUsage', async () => {
  const restore = fakeGemini()
  try {
    const seen: GeminiUsage[] = []
    assert.equal(await askGemini('hi', { onUsage: u => seen.push(u) }), 'ok')
    assert.deepEqual(seen, [{ model: 'gemini-2.5-flash', inputTokens: 120, outputTokens: 40, audioTokens: 0, via: 'key' }])
  } finally { restore() }
})

test('every call inside withGeminiUsage reports, even from code that passes no options', async () => {
  const restore = fakeGemini()
  try {
    const seen: GeminiUsage[] = []
    await withGeminiUsage(u => seen.push(u), async () => {
      await askGemini('one')
      await Promise.all([askGemini('two'), askGemini('three')])
    })
    assert.equal(seen.length, 3)
    await askGemini('outside')
    assert.equal(seen.length, 3, 'calls outside the scope are not reported')
  } finally { restore() }
})

test('a reporter that throws never breaks the answer', async () => {
  const restore = fakeGemini()
  try {
    assert.equal(await withGeminiUsage(() => { throw new Error('db down') }, () => askGemini('hi')), 'ok')
  } finally { restore() }
})
