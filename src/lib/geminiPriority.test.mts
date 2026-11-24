import { test } from 'node:test'
import assert from 'node:assert/strict'

// A fake Vertex AI (no network): a busy answer (429) is tried again at once as Priority PayGo
process.env.GOOGLE_CLOUD_PROJECT = 'test-project'
process.env.GOOGLE_CREDENTIALS_JSON = JSON.stringify({ type: 'authorized_user', client_id: 'c', client_secret: 's', refresh_token: 'r' })
delete process.env.GEMINI_API_KEY
delete process.env.GEMINI_FIRST
const { askGemini, vertexPriorityOn } = await import('./gemini.ts')
const { costMicroUsd } = await import('../server/services/aiUsage.ts')

type Sent = { url: string; priority: boolean }
const isPriority = (h: Record<string, string> | undefined) => h?.['X-Vertex-AI-LLM-Shared-Request-Type'] === 'priority'
const answer = (text: string, trafficType = 'ON_DEMAND') => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text }] } }],
  usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, trafficType },
}), { status: 200 })

/** Fakes Google: the login, then each Vertex request through `reply` */
function fake(reply: (s: Sent, n: number) => Response): Sent[] {
  const sent: Sent[] = []
  globalThis.fetch = (async (url: string, init: { headers?: Record<string, string> }) => {
    if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
    const s = { url: String(url), priority: isPriority(init.headers) }
    sent.push(s)
    return reply(s, sent.length)
  }) as typeof fetch
  return sent
}

test('a normal request goes without the priority headers', async () => {
  const sent = fake(() => answer('ok'))
  assert.equal(await askGemini('q', { model: 'gemini-2.5-flash' }), 'ok')
  assert.deepEqual(sent.map(s => s.priority), [false])
})

test('busy (429) on Vertex: the next try goes as priority, at once, and its usage is recorded as priority', async () => {
  const sent = fake((s) => s.priority ? answer('fast', 'ON_DEMAND_PRIORITY') : new Response('busy', { status: 429 }))
  const used: string[] = []
  const t = Date.now()
  assert.equal(await askGemini('q', { model: 'gemini-2.5-flash', onUsage: u => used.push(u.model) }), 'fast')
  assert.deepEqual(sent.map(s => s.priority), [false, true])
  assert.ok(Date.now() - t < 1500, 'no long wait before the priority try')
  assert.deepEqual(used, ['gemini-2.5-flash:priority'])
})

test('served as normal anyway (no priority room, or a trial account): recorded at the normal price', async () => {
  fake((s, n) => n === 1 ? new Response('busy', { status: 429 }) : answer('ok', 'ON_DEMAND'))
  const used: string[] = []
  await askGemini('q', { model: 'gemini-2.5-flash', onUsage: u => used.push(u.model) })
  assert.deepEqual(used, ['gemini-2.5-flash'])
})

test('a model that refuses priority (400) is asked normally from then on', async () => {
  const sent = fake((s, n) => n === 1 ? new Response('busy', { status: 429 }) : s.priority ? new Response('bad', { status: 400 }) : answer('ok'))
  assert.equal(await askGemini('q', { model: 'gemini-x-test' }), 'ok')
  assert.deepEqual(sent.map(s => s.priority), [false, true, false])
  // (next time it is busy, it waits as before: no priority ask)
  const again = fake((s, n) => n === 1 ? new Response('busy', { status: 429 }) : answer('ok'))
  assert.equal(await askGemini('q', { model: 'gemini-x-test' }), 'ok')
  assert.deepEqual(again.map(s => s.priority), [false, false])
})

test('VERTEX_PRIORITY=off keeps the old way (wait and try again)', () => {
  assert.equal(vertexPriorityOn({}), true)
  assert.equal(vertexPriorityOn({ VERTEX_PRIORITY: 'off' }), false)
})

test('a priority answer is priced higher; an unknown model has no price', () => {
  const normal = costMicroUsd('gemini-2.5-flash', 1000, 100)!
  assert.equal(normal, 550)
  assert.equal(costMicroUsd('gemini-2.5-flash:priority', 1000, 100), Math.round(550 * 1.8))
  assert.equal(costMicroUsd('gemini-x-test:priority', 1000, 100), null)
})
