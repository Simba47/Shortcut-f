import { test } from 'node:test'
import assert from 'node:assert/strict'
import { geminiOrder, toInteractionInput, toJsonSchema, thinkingLevel, interactionAnswer, sttOrder, sttAudioInput, STT_INLINE_MAX_BYTES } from './gemini.js'

test('GEMINI_FIRST=key: the Gemini key first, Vertex as the fallback; otherwise as before', () => {
  const both = { GOOGLE_CLOUD_PROJECT: 'p', GEMINI_API_KEY: 'k' }
  assert.deepEqual(geminiOrder({ ...both, GEMINI_FIRST: 'key' }), ['key', 'vertex'])
  assert.deepEqual(geminiOrder({ ...both, GEMINI_FIRST: ' KEY ' }), ['key', 'vertex'])
  // not set: Vertex only, as before (the key is the old API path only without Vertex)
  assert.deepEqual(geminiOrder(both), ['vertex'])
  assert.deepEqual(geminiOrder({ GEMINI_API_KEY: 'k' }), ['gemini-api'])
  assert.deepEqual(geminiOrder({ GEMINI_API_KEY: 'k', GEMINI_FIRST: 'key' }), ['key'])
  assert.deepEqual(geminiOrder({ GOOGLE_CLOUD_PROJECT: 'p', GEMINI_FIRST: 'key' }), ['vertex'])
  assert.deepEqual(geminiOrder({}), [])
})

test('captions: the key first when GEMINI_FIRST=key, unless it is resting; otherwise as before', () => {
  const base = { vertex: true, key: true, keyFirst: true, resting: false, audioSec: 30, shortSec: 120 }
  assert.deepEqual(sttOrder(base), ['key', 'vertex'])
  assert.deepEqual(sttOrder({ ...base, audioSec: 600 }), ['key', 'vertex'])
  assert.deepEqual(sttOrder({ ...base, resting: true }), ['vertex'])
  assert.deepEqual(sttOrder({ ...base, vertex: false }), ['key'])
  // today's rules without GEMINI_FIRST: short audio Vertex first, long the key first, no lane without STT_SHORT_SEC
  assert.deepEqual(sttOrder({ ...base, keyFirst: false }), ['vertex', 'key'])
  assert.deepEqual(sttOrder({ ...base, keyFirst: false, audioSec: 600 }), ['key', 'vertex'])
  assert.deepEqual(sttOrder({ ...base, keyFirst: false, shortSec: 0 }), ['vertex'])
  assert.deepEqual(sttOrder({ ...base, key: false }), ['vertex'])
})

test('an ask becomes the Interactions API input: text and images', () => {
  assert.equal(toInteractionInput('hello'), 'hello')
  assert.deepEqual(toInteractionInput([{ text: 'how many?' }, { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } }]), [
    { type: 'text', text: 'how many?' },
    // low: about 260 tokens a frame, as on Vertex (the default was 4x that, same answers: 5 Nov)
    { type: 'image', data: 'QUJD', mime_type: 'image/jpeg', resolution: 'low' },
  ])
})

test("Gemini's schema (OpenAPI types in capitals) becomes a JSON schema", () => {
  assert.deepEqual(toJsonSchema({ type: 'ARRAY', items: { type: 'STRING' } }), { type: 'array', items: { type: 'string' } })
  assert.deepEqual(
    toJsonSchema({ type: 'OBJECT', properties: { n: { type: 'INTEGER' }, s: { type: 'STRING', nullable: true, enum: ['a', 'b'] } }, required: ['n'] }),
    { type: 'object', properties: { n: { type: 'integer' }, s: { type: ['string', 'null'], enum: ['a', 'b'] } }, required: ['n'] })
})

test('a thinking budget becomes a thinking level', () => {
  assert.equal(thinkingLevel(undefined), undefined)
  assert.equal(thinkingLevel(0), 'minimal')
  assert.equal(thinkingLevel(256), 'low')
  assert.equal(thinkingLevel(1024), 'low')
  assert.equal(thinkingLevel(4096), 'medium')
  // a model without 'minimal' (gemini-3.6-flash): the lowest it has
  assert.equal(thinkingLevel(0, false), 'low')
  assert.equal(thinkingLevel(4096, false), 'medium')
})

test("the answer's text and tokens are read from the interaction's steps (thoughts left out)", () => {
  const body = {
    steps: [
      { type: 'thought', content: [{ type: 'text', text: 'hmm' }] },
      { type: 'model_output', content: [{ type: 'text', text: '["a",' }, { type: 'text', text: '"b"]' }] },
    ],
    usage: { total_input_tokens: 28, total_output_tokens: 14, total_thought_tokens: 5 },
  }
  assert.deepEqual(interactionAnswer(body), { text: '["a","b"]', inputTokens: 28, outputTokens: 19 })
  assert.deepEqual(interactionAnswer({}), { text: '', inputTokens: 0, outputTokens: 0 })
})

test('audio goes inside the request up to 5 minutes of it, and by upload only when larger', () => {
  const small = Buffer.from('abc')
  assert.deepEqual(sttAudioInput(small), { type: 'audio', data: 'YWJj', mime_type: 'audio/wav' })
  assert.equal(sttAudioInput(Buffer.alloc(STT_INLINE_MAX_BYTES + 1)), null)
  // a 5-minute chunk (16 kHz mono 16-bit wav: 9.6 MB) still fits
  assert.ok(STT_INLINE_MAX_BYTES >= 300 * 16000 * 2 + 1000)
})
