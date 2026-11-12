import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

// Subjects costs credits once per clip: the worker's job for it, whichever button starts it. Real Postgres (the local rig):
//   DATABASE_URL=postgresql://postgres@localhost:5433/shortcut_local npx tsx --test src/server/services/subjectsCredits.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }
const MIN = 60_000

let sql: typeof import('@/lib/db').default
let credits: typeof import('./credits')
let subjects: typeof import('./subjects')
const users: string[] = []

const asksFirst = (price: number) => (e: { status?: number; code?: string; credits?: number }) => e.status === 402 && e.code === 'subjects_cost' && e.credits === price

async function setup(o: { credits: number; clipMs?: number; ai?: boolean }) {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan) VALUES (${`subj-test-${Math.random().toString(36).slice(2)}@example.test`}, 'starter') RETURNING id`
  users.push(u.id)
  if (o.credits > 0) await credits.grant(u.id, { kind: 'plan', amount: o.credits, expiresAt: new Date(Date.now() + 30 * 86_400_000), sourceRef: `subj:${u.id}` })
  const [v] = await sql<{ id: string }[]>`INSERT INTO videos (user_id, source_type, storage_path, duration_ms) VALUES (${u.id}, 'upload', 'raw/test.mp4', ${20 * MIN}) RETURNING id`
  const job = o.ai ? (await sql<{ id: string }[]>`INSERT INTO ai_edit_jobs (video_id, clip_count, status) VALUES (${v.id}, 1, 'done') RETURNING id`)[0].id : null
  const [c] = await sql<{ id: string }[]>`INSERT INTO clips (video_id, start_ms, end_ms, status, ai_edit_job_id) VALUES (${v.id}, 0, ${o.clipMs ?? 90_000}, 'draft', ${job}) RETURNING id`
  return { userId: u.id, clipId: c.id }
}
const mark = (userId: string, clipId: string, x = 0.5) => subjects.addSubject(userId, clipId, { mark_ms: 1000, x, y: 0.5 })
const jobsOf = (clipId: string) => sql<{ id: string; status: string }[]>`SELECT id, status FROM jobs WHERE type = 'track_subjects' AND payload->>'clip_id' = ${clipId} ORDER BY created_at`
const bal = async (userId: string) => (await credits.balance(userId)).balance
/** The worker finished the clip's jobs */
async function finish(clipId: string, status = 'done') {
  await sql`UPDATE jobs SET status = ${status} WHERE type = 'track_subjects' AND payload->>'clip_id' = ${clipId} AND status IN ('queued', 'processing')`
  await sql`UPDATE clip_subjects SET status = ${status === 'done' ? 'done' : 'failed'} WHERE clip_id = ${clipId} AND status = 'queued'`
  await sql`UPDATE clip_angles SET status = ${status === 'done' ? 'done' : 'failed'} WHERE clip_id = ${clipId} AND status = 'queued'`
}

before(async () => {
  if (!HAS_DB) return
  process.env.CREDITS_MODE = 'on'
  process.env.CREDITS_FREE_SIGNUP = '0'
  sql = (await import('@/lib/db')).default
  credits = await import('./credits')
  subjects = await import('./subjects')
  await credits.ensureCreditsSchema()
})
after(async () => {
  process.env.CREDITS_MODE = 'on'
  if (!HAS_DB) return
  if (users.length) {
    await sql`DELETE FROM jobs WHERE payload->>'user_id' = ANY(${users})`
    await sql`DELETE FROM users WHERE id = ANY(${users})`
  }
  await sql.end({ timeout: 2 })
})

test('following people asks the price first: nothing is taken or queued until the customer says yes', opts, async () => {
  const { userId, clipId } = await setup({ credits: 20 })
  await mark(userId, clipId)
  await assert.rejects(subjects.trackSubjects(userId, clipId, { all: true }), asksFirst(4))
  assert.equal(await bal(userId), 20)
  assert.equal((await jobsOf(clipId)).length, 0)
  assert.equal((await subjects.listSubjects(userId, clipId))[0].status, 'new')

  const list = await subjects.trackSubjects(userId, clipId, { all: true, pay: true })
  assert.equal(list[0].status, 'queued')
  assert.equal(await bal(userId), 16)
  assert.equal((await jobsOf(clipId)).length, 1)
})

test('the API answer carries the price, so the editor can ask instead of showing an error', opts, async () => {
  const { apiError } = await import('@/lib/api-error')
  const { userId, clipId } = await setup({ credits: 20 })
  const err = await subjects.scanAngles(userId, clipId, {}).catch(e => e)
  const res = apiError(err)
  assert.equal(res.status, 402)
  const body = await res.json()
  assert.equal(body.code, 'subjects_cost')
  assert.equal(body.credits, 4)
})

test('paid once per clip: more people, following again, a scan and a Sub-edit are all free', opts, async () => {
  const { userId, clipId } = await setup({ credits: 20 })
  await mark(userId, clipId)
  await subjects.trackSubjects(userId, clipId, { all: true, pay: true })
  await finish(clipId)
  await mark(userId, clipId, 0.1)
  await subjects.trackSubjects(userId, clipId, {})                 // + Add
  await finish(clipId)
  await subjects.trackSubjects(userId, clipId, { all: true })      // Mark in the whole clip again
  await finish(clipId)
  await subjects.scanAngles(userId, clipId, {})
  await finish(clipId)
  await subjects.startSubEdit(userId, clipId, {})
  assert.equal(await bal(userId), 16)
})

test('a scan or a Sub-edit that comes first is what asks and pays', opts, async () => {
  const a = await setup({ credits: 20 })
  await assert.rejects(subjects.scanAngles(a.userId, a.clipId, {}), asksFirst(4))
  await subjects.scanAngles(a.userId, a.clipId, { pay: true })
  assert.equal(await bal(a.userId), 16)
  await finish(a.clipId)
  await mark(a.userId, a.clipId)
  await subjects.trackSubjects(a.userId, a.clipId, { all: true })  // Auto format's following after its scan: covered
  assert.equal(await bal(a.userId), 16)

  const b = await setup({ credits: 20 })
  await assert.rejects(subjects.startSubEdit(b.userId, b.clipId, {}), asksFirst(4))
  await subjects.startSubEdit(b.userId, b.clipId, { pay: true })
  assert.equal(await bal(b.userId), 16)
})

test('a clip made longer pays for the new part only; trimmed back it pays nothing', opts, async () => {
  const { userId, clipId } = await setup({ credits: 20 })
  await mark(userId, clipId)
  await subjects.trackSubjects(userId, clipId, { all: true, pay: true, start_ms: 0, end_ms: 90_000 })
  await finish(clipId)
  await assert.rejects(subjects.trackSubjects(userId, clipId, { all: true, start_ms: 0, end_ms: 150_000 }), asksFirst(2))
  await subjects.trackSubjects(userId, clipId, { all: true, pay: true, start_ms: 0, end_ms: 150_000 })
  assert.equal(await bal(userId), 14)
  await finish(clipId)
  await subjects.trackSubjects(userId, clipId, { all: true, start_ms: 30_000, end_ms: 60_000 })
  assert.equal(await bal(userId), 14)
})

test('a job that fails or is stopped gives the credits back, and the clip has to pay again', opts, async () => {
  const { userId, clipId } = await setup({ credits: 20 })
  await mark(userId, clipId)
  await subjects.trackSubjects(userId, clipId, { all: true, pay: true })
  await finish(clipId, 'failed')
  await credits.sweep(userId)
  assert.equal(await bal(userId), 20)
  await assert.rejects(subjects.trackSubjects(userId, clipId, { all: true }), asksFirst(4))

  await subjects.trackSubjects(userId, clipId, { all: true, pay: true })
  assert.equal(await bal(userId), 16)
  await subjects.stopSubjects(userId, clipId)
  await credits.sweep(userId)
  assert.equal(await bal(userId), 20)
})

test('not enough credits: refused, and nothing is queued', opts, async () => {
  const { userId, clipId } = await setup({ credits: 2 })
  await mark(userId, clipId)
  await assert.rejects(subjects.trackSubjects(userId, clipId, { all: true, pay: true }), (e: { status?: number }) => e.status === 402)
  assert.equal(await bal(userId), 2)
  assert.equal((await jobsOf(clipId)).length, 0)
  assert.equal((await subjects.listSubjects(userId, clipId))[0].status, 'new')
})

test('a clip from Make my clips is free: the AI clip already covers it', opts, async () => {
  const { userId, clipId } = await setup({ credits: 20, ai: true })
  await mark(userId, clipId)
  await subjects.trackSubjects(userId, clipId, { all: true })
  await finish(clipId)
  await subjects.scanAngles(userId, clipId, {})
  assert.equal(await bal(userId), 20)
})

test('credits off: nothing asked or taken. Shadow: recorded, never asked or taken', opts, async () => {
  const a = await setup({ credits: 20 })
  await mark(a.userId, a.clipId)
  process.env.CREDITS_MODE = 'off'
  try {
    await subjects.trackSubjects(a.userId, a.clipId, { all: true })
    assert.equal((await jobsOf(a.clipId)).length, 1)
  } finally { process.env.CREDITS_MODE = 'on' }
  assert.equal(await bal(a.userId), 20)

  const b = await setup({ credits: 20 })
  await mark(b.userId, b.clipId)
  process.env.CREDITS_MODE = 'shadow'
  try {
    await subjects.trackSubjects(b.userId, b.clipId, { all: true })
    assert.equal(await bal(b.userId), 20)
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM credit_holds WHERE user_id = ${b.userId} AND ref_type = 'subjects' AND shadow`
    assert.equal(n, 1)
  } finally { process.env.CREDITS_MODE = 'on' }
})
