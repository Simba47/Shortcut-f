import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

// A clip's key words (clipEmphasis): picked by AI and saved on its caption style, and whether they
// were saved (the editor then takes them in without counting them as the user's edit). A throwaway
// Postgres with the tables it reads, and a fake Gemini (never the real one):
//   DATABASE_URL=postgres://postgres:pw@127.0.0.1:55462/postgres DB_SSL=off npx tsx --test src/server/services/emphasis.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }

let sql: typeof import('@/lib/db').default
let clipEmphasis: typeof import('./emphasis').clipEmphasis
let asked = 0
const realFetch = globalThis.fetch

before(async () => {
  if (!HAS_DB) return
  process.env.GEMINI_API_KEY = 'fake-key'
  delete process.env.GOOGLE_CLOUD_PROJECT
  // Fake Gemini: picks "Hyderabad" (as numbered in the prompt) as the key word, "biryani" as a line word
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url)
    if (!u.includes('googleapis.com')) return realFetch(url, init)
    asked++
    const body = String(init?.body ?? '')
    const num = (w: string) => Number(new RegExp(`(\\d+)=${w}`).exec(body)?.[1])
    const text = JSON.stringify({ keys: [{ i: num('Hyderabad'), text: 'Hyderabad' }], line: [{ i: num('biryani'), text: 'biryani' }] })
    return new Response(JSON.stringify({
      steps: [{ type: 'model_output', content: [{ type: 'text', text }] }],
      candidates: [{ content: { parts: [{ text }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  sql = (await import('@/lib/db')).default
  clipEmphasis = (await import('./emphasis')).clipEmphasis
})
after(async () => {
  globalThis.fetch = realFetch
  if (HAS_DB) await sql.end({ timeout: 2 })
})

const SAID = ['today', 'I', 'went', 'to', 'Hyderabad', 'and', 'ate', 'biryani', 'with', 'my', 'friends']
async function clip(withStyle: boolean, emphasis: Record<string, true> | null = null) {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES (${`kw-${Math.random().toString(36).slice(2)}@example.test`}) RETURNING id`
  const [v] = await sql<{ id: string }[]>`INSERT INTO videos (user_id, title) VALUES (${u.id}, 'Food trip') RETURNING id`
  const [t] = await sql<{ id: string }[]>`INSERT INTO transcripts (video_id) VALUES (${v.id}) RETURNING id`
  for (const [i, w] of SAID.entries()) await sql`INSERT INTO transcript_words (transcript_id, word, start_ms, end_ms) VALUES (${t.id}, ${w}, ${1000 + i * 400}, ${1000 + i * 400 + 350})`
  const [c] = await sql<{ id: string }[]>`INSERT INTO clips (video_id, start_ms, end_ms) VALUES (${v.id}, 0, 10000) RETURNING id`
  if (withStyle) await sql`INSERT INTO caption_styles (clip_id, color, emphasis) VALUES (${c.id}, '#fff', ${emphasis ? sql.json(emphasis) : null})`
  return { userId: u.id, clipId: c.id }
}
const HYD = String(1000 + 4 * 400), BIR = String(1000 + 7 * 400)
const saved = async (clipId: string) => (await sql<{ emphasis: Record<string, true> | null; line_keys: Record<string, true> | null }[]>`SELECT emphasis, line_keys FROM caption_styles WHERE clip_id = ${clipId}`)[0]

test('a clip with a caption style: AI picks its key words, they are saved on it, and it says so', opts, async () => {
  const { userId, clipId } = await clip(true)
  const n = asked
  const r = await clipEmphasis(userId, clipId)
  assert.equal(asked, n + 1)
  assert.deepEqual(r.emphasis, { [HYD]: true })
  assert.deepEqual(r.line_keys, { [BIR]: true })
  assert.equal(r.saved, true)
  assert.deepEqual((await saved(clipId)).emphasis, { [HYD]: true })
})

test('a clip with no caption style saved yet: picked, not saved — the editor saves them as a change', opts, async () => {
  const { userId, clipId } = await clip(false)
  const r = await clipEmphasis(userId, clipId)
  assert.deepEqual(r.emphasis, { [HYD]: true })
  assert.equal(r.saved, false)
})

test('key words already on the clip: kept, no AI asked', opts, async () => {
  const mine = { '2200': true } as Record<string, true>
  const { userId, clipId } = await clip(true, mine)
  const n = asked
  const r = await clipEmphasis(userId, clipId)
  assert.equal(asked, n)
  assert.deepEqual(r.emphasis, mine)
  assert.equal(r.saved, true)
})

test('Pick again with AI (fresh): replaces them', opts, async () => {
  const { userId, clipId } = await clip(true, { '2200': true })
  const r = await clipEmphasis(userId, clipId, { fresh: true })
  assert.equal(r.saved, true)
  assert.deepEqual((await saved(clipId)).emphasis, { [HYD]: true })
})

test('someone else\'s clip: refused', opts, async () => {
  const { clipId } = await clip(true)
  const other = await clip(true)
  await assert.rejects(clipEmphasis(other.userId, clipId), /Forbidden/)
})
