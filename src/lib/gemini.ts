/**
 * One way to ask Gemini, for every AI call outside speech-to-text (clip finding, hooks and titles,
 * B-roll ideas, caption emphasis, script conversion, visuals).
 *
 * With GOOGLE_CLOUD_PROJECT set the request goes to Vertex AI, billed to that Google Cloud
 * project; no Gemini API key is needed. Login: the service account key in GOOGLE_CREDENTIALS_JSON
 * (the key file's contents, as JSON or base64), else the Application Default Credentials file
 * (`gcloud auth application-default login` on a developer PC). Without GOOGLE_CLOUD_PROJECT the
 * request goes to the Gemini API with GEMINI_API_KEY, as before.
 *
 * GEMINI_FIRST=key (with GEMINI_API_KEY): every request goes to the Gemini API key first (a paid
 * AI Studio project with its own, higher limits: Tier 2), through the Interactions API with
 * GEMINI_KEY_MODEL (default gemini-3.6-flash: projects made since late 2026 cannot use 2.5), and to
 * Vertex when the key fails. A key that has no credit or is refused rests 10 minutes (Vertex only).
 *
 * Built for many users at once: a cap on requests in flight per process (AI_MAX_CONCURRENT) and
 * retries spread out at random (see "Many users at once" below).
 *
 * Only Node built-ins, so this file is copied as-is between the repos:
 * chai-cut-backend/src/lib/gemini.ts and chai-cut-frontend/src/lib/gemini.ts. Keep the two identical.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createSign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }

export interface AskOptions {
  /** Default gemini-2.5-flash */
  model?: string
  /** System instruction */
  system?: string
  /** Answer as JSON (responseMimeType application/json) */
  json?: boolean
  /** JSON shape the answer must follow (Gemini responseSchema) */
  schema?: unknown
  temperature?: number
  /** 0 switches thinking off (cheaper and faster for simple tasks) */
  thinkingBudget?: number
  /** Default 120 s */
  timeoutMs?: number
  /** Told what the answer used (tokens), to record what each call cost (never stops the answer) */
  onUsage?: (u: GeminiUsage) => void
}

/** Tokens one answer used: thinking is billed as output, so it is counted there */
export interface GeminiUsage { model: string; inputTokens: number; outputTokens: number }

const usageScope = new AsyncLocalStorage<(u: GeminiUsage) => void>()
/**
 * Every askGemini call made while `fn` runs reports its tokens to `onUsage` (unless the call has
 * its own): one wrapper around a job records all of its calls, helpers included (lib/aiUsage.ts).
 */
export function withGeminiUsage<T>(onUsage: (u: GeminiUsage) => void, fn: () => Promise<T>): Promise<T> {
  return usageScope.run(onUsage, fn)
}

export const GEMINI_MODEL = 'gemini-2.5-flash'
// (gemini-3.6-flash: on the 5 Nov six-language test its moments matched 21/24, against 16/24 for
// gemini-2.5-flash on Vertex and 8-12/24 for gemini-3.5-flash-lite; it costs ~2x 2.5 Flash, ~4x from 2027)
const KEY_MODEL = process.env.GEMINI_KEY_MODEL || 'gemini-3.6-flash'

/** Where AI requests go: 'vertex', 'gemini-api', or null when neither is configured */
export function aiProvider(): 'vertex' | 'gemini-api' | null {
  if (process.env.GOOGLE_CLOUD_PROJECT) return 'vertex'
  if (process.env.GEMINI_API_KEY) return 'gemini-api'
  return null
}

type Env = Record<string, string | undefined>
const keyFirst = (env: Env) => (env.GEMINI_FIRST ?? '').trim().toLowerCase() === 'key'

/**
 * The order requests try: 'key' (the Gemini API key, Interactions API), 'vertex', or 'gemini-api'
 * (the key's older generateContent path, used only when there is no Vertex and no GEMINI_FIRST)
 */
export function geminiOrder(env: Env = process.env): Array<'key' | 'vertex' | 'gemini-api'> {
  const vertex = !!env.GOOGLE_CLOUD_PROJECT, key = !!env.GEMINI_API_KEY
  if (key && keyFirst(env)) return vertex ? ['key', 'vertex'] : ['key']
  if (vertex) return ['vertex']
  return key ? ['gemini-api'] : []
}

/** Speech-to-text's sides, in order (transcribe.ts sttSides): the same rule for the captions' reading */
export function sttOrder(s: { vertex: boolean; key: boolean; keyFirst: boolean; resting: boolean; audioSec: number | null; shortSec: number }): Array<'vertex' | 'key'> {
  if (!s.vertex) return ['key']
  if (!s.key || s.resting) return ['vertex']
  if (s.keyFirst) return ['key', 'vertex']
  if (!s.shortSec) return ['vertex']
  return s.audioSec != null && s.audioSec <= s.shortSec ? ['vertex', 'key'] : ['key', 'vertex']
}
export const sttKeyFirst = (env: Env = process.env) => !!env.GEMINI_API_KEY && keyFirst(env)

/** An ask as the Interactions API's input (images at low resolution: ~260 tokens a frame, as on Vertex) */
export function toInteractionInput(input: string | GeminiPart[]): string | Array<Record<string, string>> {
  if (typeof input === 'string') return input
  return input.map((p): Record<string, string> => 'text' in p ? { type: 'text', text: p.text } : { type: 'image', data: p.inlineData.data, mime_type: p.inlineData.mimeType, resolution: 'low' })
}

/** Gemini's responseSchema (OpenAPI subset, types in capitals, `nullable`) as a JSON schema */
export function toJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toJsonSchema)
  if (!schema || typeof schema !== 'object') return schema
  const out: Record<string, unknown> = {}
  const src = schema as Record<string, unknown>
  for (const [k, v] of Object.entries(src)) {
    if (k === 'nullable') continue
    if (k === 'type' && typeof v === 'string') out.type = src.nullable ? [v.toLowerCase(), 'null'] : v.toLowerCase()
    else if (k === 'properties' && v && typeof v === 'object') out.properties = Object.fromEntries(Object.entries(v).map(([n, d]) => [n, toJsonSchema(d)]))
    else out[k] = toJsonSchema(v)
  }
  return out
}

/** A thinking budget (tokens) as the Interactions API's thinking level ('low' for none on a model without 'minimal') */
export function thinkingLevel(budget: number | undefined, minimalOk = true): 'minimal' | 'low' | 'medium' | undefined {
  if (budget === undefined) return undefined
  return budget <= 0 ? (minimalOk ? 'minimal' : 'low') : budget <= 1024 ? 'low' : 'medium'
}
/** Set once the key's model refuses thinking level 'minimal' (gemini-3.6-flash does): 'low' from then on */
let minimalRefused = false

/** The answer's text (its model_output steps) and tokens (thoughts counted as output) */
export function interactionAnswer(body: unknown): { text: string; inputTokens: number; outputTokens: number } {
  const b = (body ?? {}) as { steps?: { type?: string; content?: { type?: string; text?: string }[] }[]; usage?: Record<string, number | undefined> }
  const text = (b.steps ?? []).filter(st => st.type === 'model_output')
    .flatMap(st => st.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('')
  const u = b.usage ?? {}
  return { text, inputTokens: u.total_input_tokens ?? 0, outputTokens: (u.total_output_tokens ?? 0) + (u.total_thought_tokens ?? 0) }
}

/** The Gemini key rests (Vertex only) until then: it had no credit, was refused, or kept failing */
let keyRestUntil = 0
const KEY_REST_MS = 10 * 60_000

/** An error from Gemini that carries the HTTP status (429 / 5xx are worth retrying) */
export class GeminiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

/** Connection errors that mean the request never got an answer (the network, not Google, failed) */
const DROPS = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH',
  'EHOSTUNREACH', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_CLOSED'])
/** The code of a connection error (fetch hides it in `cause`), '' when there is none */
export function dropCode(e: unknown): string {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null
  return String(err?.cause?.code ?? err?.code ?? '')
}
/**
 * A request that never got an answer because the connection dropped or a name lookup missed a beat:
 * worth sending again, like a 5xx (one stopped a whole video's reading on 2026-10-22). A timeout or a
 * stop (AbortError, TimeoutError) is not: the caller chose how long to wait.
 */
export function isNetworkDrop(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name
  if (name === 'AbortError' || name === 'TimeoutError') return false
  return DROPS.has(dropCode(e))
}
const pause = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Sends one request and returns the answer's text (thinking parts left out) */
export async function askGemini(input: string | GeminiPart[], opts: AskOptions = {}): Promise<string> {
  const order = geminiOrder()
  if (!order.length) throw new Error('AI is not configured: set GOOGLE_CLOUD_PROJECT (Vertex AI) or GEMINI_API_KEY')
  if (order[0] === 'key' && order.length > 1) {
    if (Date.now() >= keyRestUntil) {
      try {
        return await askKey(input, opts)
      } catch (e) {
        // (the caller's own time limit or stop is not the key's fault: Vertex would not answer it either)
        const name = (e as { name?: unknown } | null)?.name
        if (name === 'AbortError') throw e
        const status = e instanceof GeminiError ? e.status : 0
        if ([401, 402, 403].includes(status) || status === 429 || status >= 500) keyRestUntil = Date.now() + KEY_REST_MS
        console.warn(`[gemini] the Gemini key failed (${e instanceof Error ? e.message.slice(0, 160) : e}): asking Vertex${keyRestUntil > Date.now() ? ' (key rests 10 min)' : ''}`)
      }
    }
    return askGenerate(input, opts, 'vertex')
  }
  if (order[0] === 'key') return askKey(input, opts)
  return askGenerate(input, opts, order[0])
}

/** The Gemini API key, Interactions API (GEMINI_FIRST=key) */
async function askKey(input: string | GeminiPart[], opts: AskOptions): Promise<string> {
  const generation_config: Record<string, unknown> = {}
  if (opts.temperature !== undefined) generation_config.temperature = opts.temperature
  const level = thinkingLevel(opts.thinkingBudget, !minimalRefused)
  if (level) generation_config.thinking_level = level
  const body = JSON.stringify({
    model: KEY_MODEL,
    input: toInteractionInput(input),
    ...(opts.system ? { system_instruction: opts.system } : {}),
    ...(Object.keys(generation_config).length ? { generation_config } : {}),
    ...(opts.json || opts.schema ? { response_format: { type: 'text', mime_type: 'application/json', ...(opts.schema ? { schema: toJsonSchema(opts.schema) } : {}) } } : {}),
  })
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! }
  // (fewer tries than Vertex: a busy key hands over to Vertex instead of waiting a minute)
  for (let attempt = 1; ; attempt++) {
    let res: Response
    try {
      res = await inTurn(() => fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST', headers, body, signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
      }))
    } catch (e) {
      if (!isNetworkDrop(e) || attempt >= KEY_TRIES) throw e
      await pause(retryDelayMs(attempt))
      continue
    }
    if (res.ok) {
      const answer = interactionAnswer(await res.json())
      const report = opts.onUsage ?? usageScope.getStore()
      if (report) {
        try { report({ model: KEY_MODEL, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens }) } catch { /* recording never fails the answer */ }
      }
      return answer.text
    }
    const text = await res.text()
    if ((res.status === 429 || res.status >= 500) && attempt < KEY_TRIES) {
      await pause(retryDelayMs(attempt, retryAfterMs(res.headers.get('retry-after'))))
      continue
    }
    // This model has no 'minimal' thinking: ask again at 'low', and use 'low' from now on
    if (res.status === 400 && level === 'minimal' && /thinking level/i.test(text)) {
      minimalRefused = true
      return askKey(input, opts)
    }
    throw new GeminiError(`Gemini ${res.status} (key): ${text.slice(0, 300)}`, res.status)
  }
}
const KEY_TRIES = 2

/** Vertex AI, or the Gemini API key's older generateContent path */
async function askGenerate(input: string | GeminiPart[], opts: AskOptions, provider: 'vertex' | 'gemini-api'): Promise<string> {
  const model = opts.model ?? GEMINI_MODEL

  const generationConfig: Record<string, unknown> = {}
  if (opts.json || opts.schema) generationConfig.responseMimeType = 'application/json'
  if (opts.schema) generationConfig.responseSchema = opts.schema
  if (opts.temperature !== undefined) generationConfig.temperature = opts.temperature
  if (opts.thinkingBudget !== undefined) generationConfig.thinkingConfig = { thinkingBudget: opts.thinkingBudget }
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: typeof input === 'string' ? [{ text: input }] : input }],
    ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
  })

  let url: string
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (provider === 'vertex') {
    const project = process.env.GOOGLE_CLOUD_PROJECT!
    const location = process.env.GOOGLE_CLOUD_LOCATION || 'global'
    const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`
    url = `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`
    headers.Authorization = `Bearer ${await vertexToken()}`
    headers['x-goog-user-project'] = project
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    headers['x-goog-api-key'] = process.env.GEMINI_API_KEY!
  }

  // Vertex answers 429 when shared capacity is briefly busy: wait and try again
  for (let attempt = 1; ; attempt++) {
    let res: Response
    try {
      res = await inTurn(() => fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000) }))
    } catch (e) {
      // The connection dropped before an answer came: send it again, like a 5xx
      if (!isNetworkDrop(e) || attempt >= TRIES) throw e
      await pause(retryDelayMs(attempt))
      continue
    }
    if (res.ok) {
      const data = await res.json() as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
      }
      const report = opts.onUsage ?? usageScope.getStore()
      if (report) {
        const u = data.usageMetadata ?? {}
        try { report({ model, inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) }) } catch { /* recording never fails the answer */ }
      }
      return (data.candidates?.[0]?.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join('')
    }
    const text = await res.text()
    if ((res.status === 429 || res.status >= 500) && attempt < TRIES) {
      await new Promise(r => setTimeout(r, retryDelayMs(attempt, retryAfterMs(res.headers.get('retry-after')))))
      continue
    }
    throw new GeminiError(`Gemini ${res.status} (${provider}): ${text.slice(0, 300)}`, res.status)
  }
}

// ── Many users at once ───────────────────────────────────────────────────────
// Every user's AI calls share one Google Cloud project's capacity. A burst from one process only
// earns "busy" (429) answers, and many workers retrying on the same schedule hit the same busy
// moment again. So each process sends at most AI_MAX_CONCURRENT requests at a time (the rest wait
// their turn), and retries wait a random part of a growing delay, or as long as Google asks.

/** Tries per request: about a minute of waiting in all before giving up */
const TRIES = 6
/** Requests one process has in flight at most (AI_MAX_CONCURRENT, default 8) */
const MAX_IN_FLIGHT = Math.max(1, Number(process.env.AI_MAX_CONCURRENT) || 8)
let inFlight = 0
const waiting: Array<() => void> = []

/** Runs `send` when fewer than MAX_IN_FLIGHT requests are out; a finished one hands its turn to the next in line */
async function inTurn<T>(send: () => Promise<T>): Promise<T> {
  if (inFlight < MAX_IN_FLIGHT) inFlight++
  else await new Promise<void>(r => waiting.push(r))
  try {
    return await send()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else inFlight--
  }
}

/**
 * How long to wait before try `attempt + 1`: half of a delay that doubles from 2 s (up to 30 s)
 * plus a random part of the other half, so workers that were refused together come back apart;
 * never less than Google's own hint
 */
export function retryDelayMs(attempt: number, hintMs = 0): number {
  const cap = Math.min(30_000, 2000 * 2 ** (attempt - 1))
  return Math.max(hintMs, cap / 2 + Math.random() * (cap / 2))
}

/** A Retry-After header (seconds, or an HTTP date) in ms; 0 when there is none, capped at 60 s */
export function retryAfterMs(header: string | null): number {
  if (!header) return 0
  const sec = Number(header)
  const ms = Number.isFinite(sec) ? sec * 1000 : Date.parse(header) - Date.now()
  return Number.isFinite(ms) && ms > 0 ? Math.min(60_000, ms) : 0
}

// ── Vertex AI login ──────────────────────────────────────────────────────────

type Credentials =
  | { type: 'service_account'; client_email: string; private_key: string; token_uri?: string }
  | { type: 'authorized_user'; client_id: string; client_secret: string; refresh_token: string }

let cached: { token: string; expires: number } | null = null

async function loadCredentials(): Promise<Credentials> {
  const raw = process.env.GOOGLE_CREDENTIALS_JSON?.trim()
  if (raw) {
    try { return JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')) }
    catch { throw new Error('GOOGLE_CREDENTIALS_JSON is set but is not a valid service account key (paste the whole JSON file)') }
  }
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS || join(homedir(), '.config', 'gcloud', 'application_default_credentials.json')
  try { return JSON.parse(await readFile(file, 'utf8')) }
  catch { throw new Error('No Google Cloud login: set GOOGLE_CREDENTIALS_JSON, or run `gcloud auth application-default login`') }
}

/** An access token for Vertex AI, kept until 5 minutes before it expires */
async function vertexToken(): Promise<string> {
  if (cached && Date.now() < cached.expires) return cached.token
  const creds = await loadCredentials()
  let form: URLSearchParams
  let tokenUrl = 'https://oauth2.googleapis.com/token'
  if (creds.type === 'service_account') {
    tokenUrl = creds.token_uri || tokenUrl
    const now = Math.floor(Date.now() / 1000)
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: creds.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: tokenUrl, iat: now, exp: now + 3600,
    })}`
    const signature = createSign('RSA-SHA256').update(unsigned).sign(creds.private_key, 'base64url')
    form = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` })
  } else if (creds.type === 'authorized_user') {
    form = new URLSearchParams({
      grant_type: 'refresh_token', client_id: creds.client_id, client_secret: creds.client_secret, refresh_token: creds.refresh_token,
    })
  } else {
    throw new Error(`Unsupported Google credentials type: ${(creds as { type?: string }).type}`)
  }
  // (a dropped connection is tried again: the token is asked for about once an hour)
  let res: Response
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(tokenUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) })
      break
    } catch (e) {
      if (!isNetworkDrop(e) || attempt >= 3) throw e
      await pause(retryDelayMs(attempt))
    }
  }
  const data = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string; error?: string }
  if (!res.ok || !data.access_token) throw new Error(`Google Cloud login failed (${res.status}): ${data.error_description ?? data.error ?? 'no token'}`)
  cached = { token: data.access_token, expires: Date.now() + ((data.expires_in ?? 3600) - 300) * 1000 }
  return cached.token
}
