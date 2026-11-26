import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

// The credit history says when and what (user, 2026-11-25): each spend keeps the action in words and the name of
// its video or clip. Real Postgres:
//   DATABASE_URL=… npx tsx --test src/server/services/ledgerNotes.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }

let sql: typeof import('@/lib/db').default
let credits: typeof import('./credits')
const users: string[] = []

async function setup() {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan) VALUES (${`ledger-${Math.random().toString(36).slice(2)}@example.test`}, 'starter') RETURNING id`
  users.push(u.id)
  await credits.grant(u.id, { kind: 'plan', amount: 200, expiresAt: new Date(Date.now() + 30 * 86_400_000), sourceRef: `ledger:${u.id}` })
  const [v] = await sql<{ id: string }[]>`INSERT INTO videos (user_id, source_type, storage_path, status, title) VALUES (${u.id}, 'upload', 'raw/x.mp4', 'ready', 'Podcast ep 12') RETURNING id`
  const [c] = await sql<{ id: string }[]>`INSERT INTO clips (video_id, start_ms, end_ms, status, title) VALUES (${v.id}, 0, 60000, 'draft', 'Why I quit') RETURNING id`
  const [c2] = await sql<{ id: string }[]>`INSERT INTO clips (video_id, start_ms, end_ms, status) VALUES (${v.id}, 0, 60000, 'draft') RETURNING id`
  return { userId: u.id, videoId: v.id, clipId: c.id, untitledClip: c2.id }
}

before(async () => {
  if (!HAS_DB) return
  Object.assign(process.env, { CREDITS_MODE: 'on', CREDITS_FREE_SIGNUP: '0' })
  sql = (await import('@/lib/db')).default
  credits = await import('./credits')
  await credits.ensureCreditsSchema()
})
after(async () => {
  if (!HAS_DB) return
  if (users.length) await sql`DELETE FROM users WHERE id = ANY(${users})`
  await sql.end({ timeout: 2 })
})

test('a spend keeps its action and its video\'s or clip\'s name; credits given back say the same', opts, async () => {
  const { userId, videoId, clipId, untitledClip } = await setup()
  const ask = await credits.charge(userId, { amount: 7, refType: 'ask_ai', refId: videoId, note: 'Searched “funny moments”' })
  await credits.settle(ask!.id)
  const exp = await credits.charge(userId, { amount: 2, refType: 'render', refId: clipId, note: '2 min' })
  await credits.release(exp!.id)
  await credits.charge(userId, { amount: 1, refType: 'render', refId: untitledClip, note: '45 s' })
  const rows = await credits.recentLedger(userId, 10)
  const [untitled, released, spent, ai] = rows
  assert.deepEqual([ai.refType, ai.note, ai.refName], ['ask_ai', 'Searched “funny moments”', 'Podcast ep 12'])
  assert.deepEqual([spent.note, spent.refName, spent.delta], ['2 min', 'Why I quit', -2])
  assert.deepEqual([released.reason, released.note, released.refName, released.delta], ['release', '2 min', 'Why I quit', 2])
  assert.equal(untitled.refName, 'Podcast ep 12', 'a clip with no title of its own: its video\'s')
})

test('the name stays when the video is deleted; a row from before names were kept gets its video\'s name now', opts, async () => {
  const { userId, videoId } = await setup()
  await credits.charge(userId, { amount: 15, refType: 'reading', refId: videoId, note: '10 min of video' })
  // an older row: no note, no name kept
  await sql`INSERT INTO credit_ledger (user_id, delta, reason, ref_type, ref_id) VALUES (${userId}, -7, 'spend', 'ai_clips', ${videoId})`
  let rows = await credits.recentLedger(userId, 10)
  assert.equal(rows[0].note, null); assert.equal(rows[0].refName, 'Podcast ep 12')
  await sql`DELETE FROM videos WHERE id = ${videoId}`
  rows = await credits.recentLedger(userId, 10)
  const reading = rows.find(r => r.refType === 'reading')!
  assert.deepEqual([reading.note, reading.refName], ['10 min of video', 'Podcast ep 12'], 'kept after the video is gone')
  assert.equal(rows.find(r => r.refType === 'ai_clips')!.refName, null, 'an older row of a deleted video: no name left')
})

test('a note is tidied: one line, at most 140 letters', opts, async () => {
  const { userId, videoId } = await setup()
  await credits.charge(userId, { amount: 7, refType: 'ask_ai', refId: videoId, note: `Searched “${'a\n'.repeat(200)}”` })
  const [r] = await credits.recentLedger(userId, 1)
  assert.ok(r.note!.length <= 140 && !r.note!.includes('\n'))
})

test('Ask AI keeps what was searched for (the real path: a long video, paid, the AI not reached here so it is given back)', opts, async () => {
  const { userId, videoId } = await setup()
  await sql`UPDATE videos SET duration_ms = ${150 * 60_000} WHERE id = ${videoId}`
  const [t] = await sql<{ id: string }[]>`INSERT INTO transcripts (video_id, language, whole_video) VALUES (${videoId}, 'te', true) RETURNING id`
  await sql`INSERT INTO transcript_words (transcript_id, word, start_ms, end_ms) VALUES (${t.id}, 'hello', 0, 500)`
  const videos = await import('./videos')
  await videos.getVideoSuggestionsByCriteria(userId, videoId, '  funny   moments ', { pay: true }).catch(() => null)
  const rows = (await credits.recentLedger(userId, 10)).filter(r => r.refType === 'ask_ai')
  assert.ok(rows.length >= 1, 'charged')
  for (const r of rows) assert.deepEqual([r.note, r.refName], ['Searched “funny moments”', 'Podcast ep 12'])
})
