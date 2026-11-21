import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

// The plan's storage in GB (plans v2, 2026-11-21: Trial 5, Starter 15, Pro 30), replacing the count of videos.
// Real Postgres; storage (R2) is a stand-in that answers what each test sets.
//   DATABASE_URL=… npx tsx --test src/server/services/storage.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }
const GB = 1024 ** 3, MB = 1024 ** 2

let sql: typeof import('@/lib/db').default
let storage: typeof import('./storage')
let ingest: typeof import('./ingest')
let r2: typeof import('@/lib/r2').r2
const users: string[] = []
/** What the stand-in storage holds (key → bytes), and every command sent to it */
const files = new Map<string, number>()
const sent: Array<{ name: string; key: string }> = []

async function user(plan: string) {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan) VALUES (${`storage-${Math.random().toString(36).slice(2)}@example.test`}, ${plan}) RETURNING id`
  users.push(u.id)
  if (plan === 'trial') await sql`INSERT INTO topup_orders (order_id, user_id, pack, credits, amount_paise, status, paid_at) VALUES (${`order_s_${u.id}`}, ${u.id}, 'trial', 99, 4900, 'paid', now())`
  return u.id
}
async function video(userId: string, v: { size?: number | null; download?: number | null; role?: string; status?: string; path?: string | null } = {}) {
  const path = v.path === undefined ? `raw/${userId}/${Math.random().toString(36).slice(2)}.mp4` : v.path
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO videos (user_id, source_type, storage_path, status, role, file_size, download_total)
    VALUES (${userId}, 'upload', ${path}, ${v.status ?? 'ready'}, ${v.role ?? 'project'}, ${v.size ?? null}, ${v.download ?? null}) RETURNING id`
  return row.id
}

before(async () => {
  if (!HAS_DB) return
  Object.assign(process.env, { CREDITS_MODE: 'on', CREDITS_FREE_SIGNUP: '0' })
  sql = (await import('@/lib/db')).default
  storage = await import('./storage')
  ingest = await import('./ingest')
  r2 = (await import('@/lib/r2')).r2
  const credits = await import('./credits')
  await credits.ensureCreditsSchema()
  await storage.ensureStorageSchema()
  // The stand-in storage: HEAD answers the size it holds (404 when not there); DELETE removes
  r2.send = (async (cmd: { constructor: { name: string }; input: { Key: string } }) => {
    sent.push({ name: cmd.constructor.name, key: cmd.input.Key })
    if (cmd.constructor.name === 'HeadObjectCommand') {
      if (!files.has(cmd.input.Key)) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } })
      return { ContentLength: files.get(cmd.input.Key) }
    }
    if (cmd.constructor.name === 'DeleteObjectCommand') { files.delete(cmd.input.Key); return {} }
    return {}
  }) as never
})
after(async () => {
  if (!HAS_DB) return
  if (users.length) {
    await sql`DELETE FROM jobs WHERE payload->>'video_id' IN (SELECT id::text FROM videos WHERE user_id = ANY(${users}))`
    await sql`DELETE FROM users WHERE id = ANY(${users})`
  }
  await sql.end({ timeout: 2 })
})

test('used storage: each video\'s file, a link\'s download; B-roll assets, failed links with no file, and the video itself when asked are left out', opts, async () => {
  const u = await user('starter')
  await video(u, { size: 2 * GB })
  await video(u, { size: null, download: 1 * GB })                 // a link import
  await video(u, { size: 300 * MB, role: 'asset' })                 // B-roll added in the editor: not counted
  await video(u, { size: null, download: 400 * MB, status: 'failed', path: null })   // a link that failed: no file
  const mid = await video(u, { size: null, download: 500 * MB, status: 'downloading', path: null })   // still coming: counted
  assert.equal(await storage.storageUsed(u), 3 * GB + 500 * MB)
  assert.equal(await storage.storageUsed(u, mid), 3 * GB)
})

test('a video made before sizes were kept: its size is taken from storage once, and kept', opts, async () => {
  const u = await user('starter')
  const v = await video(u, { size: null })
  const [{ storage_path }] = await sql<{ storage_path: string }[]>`SELECT storage_path FROM videos WHERE id = ${v}`
  files.set(storage_path, 3 * GB)
  const gone = await video(u, { size: null })                      // not in storage any more: 0
  sent.length = 0
  assert.equal(await storage.storageUsed(u), 3 * GB)
  assert.equal(sent.filter(s => s.name === 'HeadObjectCommand').length, 2)
  const rows = await sql<{ id: string; file_size: string }[]>`SELECT id, file_size FROM videos WHERE id IN (${v}, ${gone})`
  assert.deepEqual(Object.fromEntries(rows.map(r => [r.id, Number(r.file_size)])), { [v]: 3 * GB, [gone]: 0 })
  sent.length = 0
  await storage.storageUsed(u)
  assert.equal(sent.length, 0, 'asked once only')
})

test('the plan\'s storage: Trial 5 GB, Starter 15, Pro 30; a file that doesn\'t fit is refused, saying what is free', opts, async () => {
  const { PLANS } = await import('@/lib/plans')
  assert.deepEqual([PLANS.trial.storageGb, PLANS.starter.storageGb, PLANS.creator.storageGb], [5, 15, 30])
  const t = await user('trial')
  await video(t, { size: 4.5 * GB })
  assert.equal(await storage.checkStorage(t, 400 * MB), 112 * MB)
  await assert.rejects(storage.checkStorage(t, 1 * GB), (e: { status?: number; message?: string }) =>
    e.status === 403 && /This video is 1 GB, and 512 MB of your 5 GB is free/.test(e.message ?? '') && /upgrade/.test(e.message ?? ''))
  await video(t, { size: 512 * MB })
  await assert.rejects(storage.checkStorage(t, 0), (e: { status?: number; message?: string }) => e.status === 403 && /Your 5 GB of storage is full/.test(e.message ?? ''))
  // Pro, the top plan: no "upgrade"
  const p = await user('creator')
  await video(p, { size: 30 * GB })
  await assert.rejects(storage.checkStorage(p, MB), (e: { message?: string }) => /Your 30 GB of storage is full/.test(e.message ?? '') && !/upgrade/.test(e.message ?? ''))
  // no plan: told to start the Trial
  await assert.rejects(storage.checkStorage(await user('free'), MB), (e: { status?: number; message?: string }) => e.status === 403 && /Trial pack/.test(e.message ?? ''))
})

test('no count of videos any more: a Starter with 40 small videos still uploads', opts, async () => {
  const u = await user('starter')
  for (let i = 0; i < 40; i++) await video(u, { size: 100 * MB })
  assert.ok(await storage.checkStorage(u, 1 * GB) > 0)
})

test('an upload that arrives too big for what is free is refused at the end, and its file deleted; one that fits keeps its size', opts, async () => {
  const u = await user('starter')
  await video(u, { size: 14 * GB })
  const big = `raw/${u}/big.mp4`
  files.set(big, 2 * GB)
  await assert.rejects(ingest.completeUpload(u, big, 60_000, 'Big'), (e: { status?: number; message?: string }) => e.status === 403 && /1 GB of your 15 GB is free/.test(e.message ?? ''))
  assert.ok(!files.has(big), 'the refused file is removed from storage')
  assert.equal((await sql`SELECT 1 FROM videos WHERE storage_path = ${big}`).length, 0)
  const small = `raw/${u}/small.mp4`
  files.set(small, 600 * MB)
  const credits = await import('./credits')
  await credits.grant(u, { kind: 'plan', amount: 100, expiresAt: new Date(Date.now() + 30 * 86_400_000), sourceRef: `storage-test:${u}` })
  const { video_id } = await ingest.completeUpload(u, small, 60_000, 'Small')
  const [row] = await sql<{ file_size: string }[]>`SELECT file_size FROM videos WHERE id = ${video_id}`
  assert.equal(Number(row.file_size), 600 * MB)
  assert.equal(await storage.storageUsed(u), 14 * GB + 600 * MB)
})

test('a link import: refused when the storage is full; else the download stops at what is free, and says so', opts, async () => {
  const u = await user('starter')
  const credits = await import('./credits')
  await credits.grant(u, { kind: 'plan', amount: 100, expiresAt: new Date(Date.now() + 30 * 86_400_000), sourceRef: `storage-link:${u}` })
  const first = await video(u, { size: 12 * GB })
  const { video_id } = await ingest.ingestLink(u, 'https://drive.google.com/file/d/abc/view')
  const [job] = await sql<{ payload: { max_bytes: number; too_big_message: string } }[]>`SELECT payload FROM jobs WHERE payload->>'video_id' = ${video_id}`
  assert.equal(job.payload.max_bytes, 3 * GB)                       // 3 GB free, less than Starter's 5 GB file limit
  assert.match(job.payload.too_big_message, /bigger than the 3 GB free of your 15 GB/)
  // lots free: the plan's one-file limit
  await sql`UPDATE videos SET file_size = ${1 * GB} WHERE id = ${first}`
  await sql`DELETE FROM videos WHERE id = ${video_id}`
  const second = await ingest.ingestLink(u, 'https://drive.google.com/file/d/def/view')
  const [job2] = await sql<{ payload: { max_bytes: number; too_big_message: string } }[]>`SELECT payload FROM jobs WHERE payload->>'video_id' = ${second.video_id}`
  assert.equal(job2.payload.max_bytes, 5 * GB)
  assert.match(job2.payload.too_big_message, /plan's 5 GB limit for one video/)
  // full: refused before anything is made
  await sql`DELETE FROM videos WHERE id = ${second.video_id}`
  await sql`UPDATE videos SET file_size = ${15 * GB} WHERE id = ${first}`
  await assert.rejects(ingest.ingestLink(u, 'https://drive.google.com/file/d/ghi/view'), (e: { status?: number; message?: string }) => e.status === 403 && /storage is full/.test(e.message ?? ''))
})

test('a link import waiting for the OK is checked with its real size beside the rest, itself left out', opts, async () => {
  const u = await user('starter')
  await video(u, { size: 13 * GB })
  const [v] = await sql<{ id: string }[]>`
    INSERT INTO videos (user_id, source_type, storage_path, status, role, download_total, duration_ms, ask_ok)
    VALUES (${u}, 'link', ${`raw/${u}/link.mp4`}, 'awaiting_ok', 'project', ${3 * GB}, 60000, true) RETURNING id`
  await assert.rejects(ingest.continueLinkImport(u, v.id), (e: { status?: number; message?: string }) =>
    e.status === 403 && /This video is 3 GB, and 2 GB of your 15 GB is free/.test(e.message ?? ''))
  const [still] = await sql<{ status: string }[]>`SELECT status FROM videos WHERE id = ${v.id}`
  assert.equal(still.status, 'awaiting_ok', 'still waiting: the user can delete something, or cancel it')
})
