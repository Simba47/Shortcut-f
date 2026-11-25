import { test } from 'node:test'
import assert from 'node:assert/strict'

// VERTEX_MODEL: a new Google Cloud project cannot use gemini-2.5-flash, so Vertex is asked for another model
process.env.GOOGLE_CLOUD_PROJECT = 'test-project'
process.env.GOOGLE_CREDENTIALS_JSON = JSON.stringify({ type: 'authorized_user', client_id: 'c', client_secret: 's', refresh_token: 'r' })
process.env.VERTEX_MODEL = ' gemini-3.5-flash-lite '
delete process.env.GEMINI_API_KEY
delete process.env.GEMINI_FIRST
const { askGemini, GEMINI_MODEL } = await import('./gemini.ts')
const { costMicroUsd } = await import('../server/services/aiUsage.ts')

test('VERTEX_MODEL is the model Vertex is asked for when a call names none, and its usage is priced', async () => {
  const urls: string[] = []
  const used: string[] = []
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
    urls.push(String(url))
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 } }), { status: 200 })
  }) as typeof fetch
  assert.equal(GEMINI_MODEL, 'gemini-3.5-flash-lite')
  assert.equal(await askGemini('q', { onUsage: u => used.push(u.model) }), 'ok')
  assert.match(urls[0], /\/projects\/test-project\/locations\/global\/publishers\/google\/models\/gemini-3\.5-flash-lite:generateContent$/)
  assert.deepEqual(used, ['gemini-3.5-flash-lite'])
  assert.notEqual(costMicroUsd('gemini-3.5-flash-lite', 1000, 100), null)
  // (a call that names its model keeps it)
  await askGemini('q', { model: 'gemini-3.6-flash' })
  assert.match(urls[1], /models\/gemini-3\.6-flash:generateContent$/)
})
