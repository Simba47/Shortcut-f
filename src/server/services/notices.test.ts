import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

// Runs against a throwaway Postgres (D:\shortcut\e2e-pg-notices\pg.mjs), never QA or production:
//   DATABASE_URL=postgres://postgres:pw@127.0.0.1:55471/postgres DB_SSL=off npx tsx --test src/server/services/notices.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }

type Svc = typeof import('./notices')
let svc: Svc
let sql: typeof import('@/lib/db').default
let credits: typeof import('./credits')

before(async () => {
  if (!HAS_DB) return
  process.env.CREDITS_MODE = 'on'
  sql = (await import('@/lib/db')).default
  svc = await import('./notices')
  credits = await import('./credits')
  await credits.ensureCreditsSchema()
  await (await import('./billingSchema')).ensureBillingSchema()
})
after(async () => { if (HAS_DB) await sql.end({ timeout: 2 }) })

async function user(plan = 'starter'): Promise<string> {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan) VALUES (${`n-${Math.random().toString(36).slice(2)}@example.test`}, ${plan}) RETURNING id`
  return u.id
}
async function video(userId: string, title = 'Podcast ep 12', status = 'ready'): Promise<string> {
  const [v] = await sql<{ id: string }[]>`INSERT INTO videos (user_id, source_type, title, status, duration_ms) VALUES (${userId}, 'upload', ${title}, ${status}, 600000) RETURNING id`
  return v.id
}
async function job(type: string, payload: Record<string, unknown>, status: string, error: string | null = null, updatedAgoMs = 0): Promise<string> {
  const [j] = await sql<{ id: string }[]>`
    INSERT INTO jobs (type, payload, status, error, updated_at) VALUES (${type}, ${sql.json(payload as never)}, ${status}, ${error}, ${new Date(Date.now() - updatedAgoMs)}) RETURNING id`
  return j.id
}
const since = (msAgo: number) => new Date(Date.now() - msAgo)

test('a page just opened is told only how much is running, not what finished before', opts, async () => {
  const u = await user()
  const v = await video(u)
  await job('transcribe', { video_id: v }, 'done', null, 5_000)
  await job('ai_edit', { video_id: v }, 'processing')
  const r = await svc.activity(u, null)
  assert.equal(r.running, 1)
  assert.deepEqual(r.finished, [])
  assert.ok(Date.parse(r.cursor) > 0)
})

test('a reading, a Make my clips run and an export that finished are told; others users’ are not', opts, async () => {
  const u = await user(), other = await user()
  const v = await video(u, 'My talk')
  const read = await job('transcribe', { video_id: v }, 'done')
  const [run] = await sql<{ id: string }[]>`INSERT INTO ai_edit_jobs (video_id, clip_count, status) VALUES (${v}, 3, 'done') RETURNING id`
  await sql`INSERT INTO clips (video_id, start_ms, end_ms, ai_edit_job_id) VALUES (${v}, 0, 1000, ${run.id}), (${v}, 0, 1000, ${run.id})`
  const mmc = await job('ai_edit', { video_id: v, ai_edit_job_id: run.id }, 'done')
  const [clip] = await sql<{ id: string }[]>`INSERT INTO clips (video_id, start_ms, end_ms, title) VALUES (${v}, 0, 30000, 'Why I quit') RETURNING id`
  const ex = await job('render', { clip_id: clip.id }, 'done')
  // a clip's own captions (a transcribe job with a clip) is not a reading
  await job('transcribe', { video_id: v, clip_id: clip.id }, 'done')
  // someone else's
  await job('transcribe', { video_id: await video(other) }, 'done')
  const r = await svc.activity(u, since(60_000))
  const byId = Object.fromEntries(r.finished.map(f => [f.id, f]))
  assert.equal(r.finished.length, 3)
  assert.deepEqual([byId[read].kind, byId[read].ok, byId[read].videoTitle], ['reading', true, 'My talk'])
  assert.deepEqual([byId[mmc].kind, byId[mmc].ok, byId[mmc].made], ['clips', true, 2])
  assert.deepEqual([byId[ex].kind, byId[ex].ok, byId[ex].clipId, byId[ex].clipTitle, byId[ex].videoId], ['export', true, clip.id, 'Why I quit', v])
})

test('only what finished after the cursor, and never older than an hour', opts, async () => {
  const u = await user()
  const v = await video(u)
  await job('transcribe', { video_id: v }, 'done', null, 10 * 60_000)
  const recent = await job('transcribe', { video_id: await video(u) }, 'done', null, 1_000)
  const r = await svc.activity(u, since(5 * 60_000))
  assert.deepEqual(r.finished.map(f => f.id), [recent])
  const old = await job('transcribe', { video_id: await video(u) }, 'done', null, 2 * 60 * 60_000)
  const r2 = await svc.activity(u, since(24 * 60 * 60_000))
  assert.ok(!r2.finished.some(f => f.id === old))
})

test('stopped, cancelled and waiting ones are left out', opts, async () => {
  const u = await user()
  const v = await video(u)
  await job('transcribe', { video_id: v }, 'failed', 'Stopped by the user')
  const [clip] = await sql<{ id: string }[]>`INSERT INTO clips (video_id, start_ms, end_ms) VALUES (${v}, 0, 1000) RETURNING id`
  await job('render', { clip_id: clip.id }, 'failed', 'Cancelled by the user')
  const [run] = await sql<{ id: string }[]>`INSERT INTO ai_edit_jobs (video_id, clip_count, status, error) VALUES (${v}, 3, 'failed', 'Cancelled by you') RETURNING id`
  await job('ai_edit', { video_id: v, ai_edit_job_id: run.id }, 'done')
  // a run waiting on "found fewer: make these?" (its job done, the run not)
  const [waiting] = await sql<{ id: string }[]>`INSERT INTO ai_edit_jobs (video_id, clip_count, status) VALUES (${v}, 3, 'confirm') RETURNING id`
  await job('ai_edit', { video_id: v, ai_edit_job_id: waiting.id }, 'done')
  // a Drive import read and waiting on the credits OK (job done, video not ready)
  await job('transcribe', { video_id: await video(u, 'Drive file', 'awaiting_ok') }, 'done')
  const r = await svc.activity(u, since(60_000))
  assert.deepEqual(r.finished, [])
})

test('a failed export says the credits it gave back; one stopped by its person gives none', opts, async () => {
  const u = await user()
  await sql`INSERT INTO credit_grants (user_id, kind, amount, remaining, expires_at, source_ref) VALUES (${u}, 'plan', 50, 50, ${new Date(Date.now() + 30 * 86_400_000)}, ${`test:${u}`})`
  const v = await video(u)
  const [clip] = await sql<{ id: string }[]>`INSERT INTO clips (video_id, start_ms, end_ms, title) VALUES (${v}, 0, 90000, 'Clip A') RETURNING id`
  const j = await job('render', { clip_id: clip.id }, 'processing')
  await credits.reserve(u, { amount: 2, refType: 'render', refId: clip.id, jobId: j })
  await sql`UPDATE jobs SET status = 'failed', error = 'Python render failed', updated_at = now() WHERE id = ${j}`
  const r = await svc.activity(u, since(60_000))
  assert.equal(r.finished.length, 1)
  assert.deepEqual([r.finished[0].ok, r.finished[0].refunded], [false, 2])
  assert.equal(await svc.exportRefund(u, clip.id), 2)
  // stopped: paid for, nothing back (credits.ts sweep)
  const [clip2] = await sql<{ id: string }[]>`INSERT INTO clips (video_id, start_ms, end_ms) VALUES (${v}, 0, 30000) RETURNING id`
  const j2 = await job('render', { clip_id: clip2.id }, 'processing')
  await credits.reserve(u, { amount: 1, refType: 'render', refId: clip2.id, jobId: j2 })
  await sql`UPDATE jobs SET status = 'failed', error = 'Cancelled by the user', updated_at = now() WHERE id = ${j2}`
  assert.equal(await svc.exportRefund(u, clip2.id), 0)
  // someone else's clip: nothing
  assert.equal(await svc.exportRefund(await user(), clip.id), 0)
})

test('a Make my clips run that made fewer clips than paid for says what came back', opts, async () => {
  const u = await user()
  await sql`INSERT INTO credit_grants (user_id, kind, amount, remaining, expires_at, source_ref) VALUES (${u}, 'plan', 100, 100, ${new Date(Date.now() + 30 * 86_400_000)}, ${`test:${u}`})`
  const v = await video(u)
  const [run] = await sql<{ id: string }[]>`INSERT INTO ai_edit_jobs (video_id, clip_count, status, export_included) VALUES (${v}, 3, 'running', true) RETURNING id`
    .catch(async () => {
      await sql`ALTER TABLE ai_edit_jobs ADD COLUMN IF NOT EXISTS export_included BOOLEAN`
      return sql<{ id: string }[]>`INSERT INTO ai_edit_jobs (video_id, clip_count, status, export_included) VALUES (${v}, 3, 'running', true) RETURNING id`
    })
  const j = await job('ai_edit', { video_id: v, ai_edit_job_id: run.id }, 'processing')
  await credits.reserve(u, { amount: 21, refType: 'ai_clips', refId: v, jobId: j })
  await sql`INSERT INTO clips (video_id, start_ms, end_ms, ai_edit_job_id) VALUES (${v}, 0, 1000, ${run.id})`
  await sql`UPDATE ai_edit_jobs SET status = 'done' WHERE id = ${run.id}`
  await sql`UPDATE jobs SET status = 'done', updated_at = now() WHERE id = ${j}`
  const r = await svc.activity(u, since(60_000))
  assert.equal(r.finished.length, 1)
  assert.deepEqual([r.finished[0].kind, r.finished[0].made, r.finished[0].refunded], ['clips', 1, 14])
})

test('the account facts: a failed renewal (not a cancel, not a deleted account), credits, storage', opts, async () => {
  const u = await user('free')
  await sql`INSERT INTO subscriptions (user_id, plan, status, expires_at, razorpay_subscription_id) VALUES (${u}, 'creator', 'active', ${new Date(Date.now() + 86_400_000)}, ${`sub_${u}`})`
  const billing = await import('./billing')
  // Razorpay halts it: access ends now and the reason is kept
  await billing.endSubscription({ kind: 'ended', subscriptionId: `sub_${u}`, userId: u, plan: 'creator', expiresAt: null }, { id: `evt_${u}`, type: 'subscription.halted' })
  const [row] = await sql<{ status: string; ended_reason: string | null }[]>`SELECT status, ended_reason FROM subscriptions WHERE user_id = ${u}`
  assert.deepEqual([row.status, row.ended_reason], ['ended', 'renewal_failed'])
  const f = await svc.accountFacts(u)
  assert.equal(f.plan, 'free')
  assert.equal(f.renewalFailed?.planName, 'Pro')
  // a cancel (its paid time kept) is no failed renewal
  const c = await user('free')
  await sql`INSERT INTO subscriptions (user_id, plan, status, expires_at, razorpay_subscription_id) VALUES (${c}, 'starter', 'active', ${new Date(Date.now() + 86_400_000)}, ${`sub_${c}`})`
  await billing.endSubscription({ kind: 'ended', subscriptionId: `sub_${c}`, userId: c, plan: 'starter', expiresAt: new Date(Date.now() + 86_400_000) }, { id: `evt_${c}`, type: 'subscription.cancelled' })
  assert.equal((await svc.accountFacts(c)).renewalFailed, null)
  // an account deletion's 'ended' (no reason) is none either
  const d = await user('free')
  await sql`INSERT INTO subscriptions (user_id, plan, status, expires_at, razorpay_subscription_id) VALUES (${d}, 'starter', 'ended', now(), ${`sub_${d}`})`
  assert.equal((await svc.accountFacts(d)).renewalFailed, null)
  // credits: balance and the soonest expiry
  const s = await user('starter')
  await sql`INSERT INTO credit_grants (user_id, kind, amount, remaining, expires_at, source_ref) VALUES (${s}, 'plan', 12, 12, ${new Date(Date.now() + 3 * 86_400_000)}, ${`test:${s}`})`
  const fs = await svc.accountFacts(s)
  assert.equal(fs.credits?.balance, 12)
  assert.equal(fs.credits?.expiring?.amount, 12)
  assert.equal(fs.storage?.totalBytes, 15 * 1024 ** 3)
})
