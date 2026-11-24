import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createVerify } from 'node:crypto'

// Workload Identity Federation login (no service account key): our JWT → STS → act as the service account → Vertex
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const AUD = '//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/railway-pool/providers/railway-oidc'
const SA = 'shortcut-vertex@test-project.iam.gserviceaccount.com'
process.env.GOOGLE_CLOUD_PROJECT = 'test-project'
process.env.GOOGLE_CREDENTIALS_JSON = Buffer.from(JSON.stringify({
  type: 'workload_identity_jwt', audience: AUD, issuer: 'https://wif.example', subject: 'railway-prod', key_id: 'k1',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), service_account: SA,
})).toString('base64')
delete process.env.GEMINI_API_KEY
delete process.env.GEMINI_FIRST
const { askGemini } = await import('./gemini.ts')

test('the worker logs in through STS and the service account, once per hour, and calls Vertex with that token', async () => {
  const calls: { url: string; auth?: string; body?: Record<string, unknown> }[] = []
  globalThis.fetch = (async (url: string, init: { headers?: Record<string, string>; body?: string }) => {
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ url: String(url), auth: init.headers?.Authorization, body })
    if (String(url).startsWith('https://sts.googleapis.com')) return new Response(JSON.stringify({ access_token: 'federated' }), { status: 200 })
    if (String(url).includes('iamcredentials')) return new Response(JSON.stringify({ accessToken: 'sa-token', expireTime: new Date(Date.now() + 3600_000).toISOString() }), { status: 200 })
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 })
  }) as typeof fetch

  assert.equal(await askGemini('q', { model: 'gemini-3.5-flash-lite' }), 'ok')
  assert.equal(await askGemini('q', { model: 'gemini-3.5-flash-lite' }), 'ok')
  assert.deepEqual(calls.map(c => new URL(c.url).host), ['sts.googleapis.com', 'iamcredentials.googleapis.com', 'aiplatform.googleapis.com', 'aiplatform.googleapis.com'])

  // the JWT: signed with our key, for our provider, with the subject the provider allows
  const sts = calls[0].body!
  assert.equal(sts.audience, AUD)
  assert.equal(sts.subjectTokenType, 'urn:ietf:params:oauth:token-type:jwt')
  const [h, p, sig] = String(sts.subjectToken).split('.')
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, sig, 'base64url'))
  const head = JSON.parse(Buffer.from(h, 'base64url').toString())
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
  assert.equal(head.kid, 'k1')
  assert.deepEqual([claims.iss, claims.sub, claims.aud], ['https://wif.example', 'railway-prod', `https:${AUD}`])
  assert.ok(claims.exp - claims.iat <= 600)

  assert.match(calls[1].url, new RegExp(`serviceAccounts/${encodeURIComponent(SA)}:generateAccessToken$`))
  assert.equal(calls[1].auth, 'Bearer federated')
  assert.equal(calls[2].auth, 'Bearer sa-token')
})
