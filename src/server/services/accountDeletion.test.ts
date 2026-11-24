import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

// Accounts deleted by Shortcut's admin (user, 2026-11-24): no sign-in, the restore link (emailed again on ask), the
// restore with required feedback (the admins emailed), a fresh grace for the videos, the sweep that cancels the
// subscription and deletes for good after 30 days, and expiry leaving a deleted account alone. Real Postgres:
//   DATABASE_URL=… npx tsx --test src/server/services/accountDeletion.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }
const DAY = 86_400_000

let sql: typeof import('@/lib/db').default
let del: typeof import('./accountDeletion')
const users: string[] = []
type Mail = { to: string | string[]; m: { subject: string; html: string; text: string } }
const mails: Mail[] = []
const send = async (to: string | string[], m: Mail['m']) => { mails.push({ to, m }) }
const BASE = 'https://shortcut.test'

async function user(o: { plan?: string; deletedDaysAgo?: number; purgeInDays?: number; blocked?: boolean } = {}) {
  const email = `del-${Math.random().toString(36).slice(2)}@example.test`
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, plan, name, "emailVerified") VALUES (${email}, ${o.plan ?? 'free'}, 'Asha Rao', now()) RETURNING id`
  users.push(u.id)
  let token: string | null = null
  if (o.deletedDaysAgo !== undefined) {
    // (as the admin's Delete account leaves it: Shortcut-Admin-f actions.ts deleteAccount)
    const t = del.newRestoreToken(); token = t.token
    await sql`
      UPDATE users SET deleted_at = now() - ${`${o.deletedDaysAgo} days`}::interval, deleted_by = 'admin@test', deleted_reason = 'spam',
        purge_at = now() + ${`${o.purgeInDays ?? 30 - o.deletedDaysAgo} days`}::interval, restore_token_hash = ${t.hash}
      WHERE id = ${u.id}`
  }
  if (o.blocked) await sql`UPDATE users SET blocked_at = now() WHERE id = ${u.id}`
  return { id: u.id, email, token }
}
async function video(userId: string, expiresInDays: number | null) {
  const [v] = await sql<{ id: string }[]>`
    INSERT INTO videos (user_id, source_type, storage_path, status, role, title, expires_at)
    VALUES (${userId}, 'upload', ${`raw/${userId}/${Math.random()}.mp4`}, 'ready', 'project', 'A talk',
      ${expiresInDays === null ? null : new Date(Date.now() + expiresInDays * DAY)}) RETURNING id`
  return v.id
}

before(async () => {
  if (!HAS_DB) return
  Object.assign(process.env, { CREDITS_MODE: 'on', VIDEO_EXPIRY: 'on', ADMIN_ALERT_TO: 'admins@shortcut.test' })
  sql = (await import('@/lib/db')).default
  del = await import('./accountDeletion')
  await (await import('./credits')).ensureCreditsSchema()
  await (await import('./billingSchema')).ensureBillingSchema()
  await (await import('./expiry')).ensureExpirySchema()
  await del.ensureDeletionSchema()
})
after(async () => {
  if (!HAS_DB) return
  if (users.length) await sql`DELETE FROM users WHERE id = ANY(${users})`
  await sql.end({ timeout: 2 })
})

test('sign-in: a deleted account says so (and until when), a blocked one too; others as before', opts, async () => {
  const { accountStatus } = await import('@/modules/auth/services')
  const gone = await user({ deletedDaysAgo: 2 })
  const blocked = await user({ blocked: true })
  const fine = await user()
  const lock = await del.accountLock({ email: gone.email.toUpperCase() })
  assert.equal(lock.state, 'deleted')
  assert.ok(lock.state === 'deleted' && lock.restoreBy && Math.abs(lock.restoreBy.getTime() - Date.now() - 28 * DAY) < 60_000)
  assert.equal((await del.accountLock({ id: blocked.id })).state, 'blocked')
  assert.equal((await del.accountLock({ id: fine.id })).state, 'ok')
  assert.equal((await del.accountLock({ email: 'nobody@example.test' })).state, 'ok')
  assert.equal(await accountStatus(gone.email), 'deleted')
  assert.equal(await accountStatus(blocked.email), 'blocked')
})

test('restore link: emailed again on ask (the old one stops working), not twice in 2 minutes, never for a live account', opts, async () => {
  const u = await user({ deletedDaysAgo: 1 })
  const live = await user()
  mails.length = 0
  assert.equal((await del.restoreLinkInfo(u.token!))?.email, u.email)
  await del.sendRestoreLink(u.email, { send, base: BASE })
  assert.equal(mails.length, 1)
  assert.equal(mails[0].to, u.email)
  assert.equal(mails[0].m.subject, 'Your Shortcut account was deleted')
  const link = mails[0].m.text.match(/https:\/\/shortcut\.test\/restore-account\?token=(\S+)/)
  assert.ok(link, 'the email carries the restore link')
  const fresh = decodeURIComponent(link![1])
  assert.equal(await del.restoreLinkInfo(u.token!), null)
  assert.equal((await del.restoreLinkInfo(fresh))?.email, u.email)
  assert.doesNotMatch(mails[0].m.html + mails[0].m.text, /spam/)   // the admin's reason is never in it
  await del.sendRestoreLink(u.email, { send, base: BASE })
  await del.sendRestoreLink(live.email, { send, base: BASE })
  await del.sendRestoreLink('nobody@example.test', { send, base: BASE })
  assert.equal(mails.length, 1)
  assert.equal(await del.restoreLinkInfo('short'), null)
})

test('restore: feedback required; back at once with a fresh 7 days for its videos; feedback kept and emailed to the admins; the link works once', opts, async () => {
  const u = await user({ deletedDaysAgo: 25 })
  const soon = await video(u.id, -3)        // would have expired while it was deleted
  const later = await video(u.id, 20)
  const kept = await video(u.id, null)
  mails.length = 0
  await assert.rejects(del.restoreAccount(u.token, 'too short', { send, base: BASE }), /what went wrong/)
  await assert.rejects(del.restoreAccount('x'.repeat(43), 'The exports kept failing on long videos', { send, base: BASE }), (e: Error & { status?: number }) => e.status === 410)
  const r = await del.restoreAccount(u.token, '  The exports kept failing on long videos, so I left.  ', { send, base: BASE })
  assert.equal(r.email, u.email)
  const [row] = await sql<{ deleted_at: Date | null; purge_at: Date | null; restore_token_hash: string | null; videos_grace_from: Date | null }[]>`
    SELECT deleted_at, purge_at, restore_token_hash, videos_grace_from FROM users WHERE id = ${u.id}`
  assert.deepEqual([row.deleted_at, row.purge_at, row.restore_token_hash], [null, null, null])
  assert.ok(row.videos_grace_from && Date.now() - row.videos_grace_from.getTime() < 60_000)
  assert.equal((await del.accountLock({ id: u.id })).state, 'ok')
  const exp = async (id: string) => (await sql<{ e: Date | null }[]>`SELECT expires_at AS e FROM videos WHERE id = ${id}`)[0].e
  assert.ok(Math.abs((await exp(soon))!.getTime() - Date.now() - 7 * DAY) < 60_000, 'a past date moves to 7 days from now')
  assert.ok(Math.abs((await exp(later))!.getTime() - Date.now() - 20 * DAY) < 60_000, 'a later date stays')
  assert.equal(await exp(kept), null)
  const fb = await sql<{ body: string; kind: string }[]>`SELECT body, kind FROM account_feedback WHERE user_id = ${u.id}`
  assert.deepEqual(fb.map(f => [f.kind, f.body]), [['restore', 'The exports kept failing on long videos, so I left.']])
  assert.equal(mails.length, 1)
  assert.deepEqual(mails[0].to, ['admins@shortcut.test'])
  assert.equal(mails[0].m.subject, `Account restored: ${u.email}`)
  assert.match(mails[0].m.text, /exports kept failing/)
  await assert.rejects(del.restoreAccount(u.token, 'Trying the same link again here', { send, base: BASE }), (e: Error & { status?: number }) => e.status === 410)
  // past its 30 days: the link no longer restores
  const late = await user({ deletedDaysAgo: 31, purgeInDays: -1 })
  assert.equal(await del.restoreLinkInfo(late.token!), null)
  await assert.rejects(del.restoreAccount(late.token, 'Please bring it back for me', { send, base: BASE }), (e: Error & { status?: number }) => e.status === 410)
})

test('sweep: a deleted account’s subscription cancelled at once; deleted for good after its 30 days; live accounts untouched', opts, async () => {
  const paying = await user({ plan: 'creator', deletedDaysAgo: 0 })
  const due = await user({ deletedDaysAgo: 30, purgeInDays: -0.01 })
  const live = await user({ plan: 'creator' })
  const subId = (n: string) => `sub_${n}_${crypto.randomBytes(4).toString('hex')}`
  const [s1, s2] = [subId('del'), subId('live')]
  await sql`INSERT INTO subscriptions (user_id, razorpay_subscription_id, plan, status, expires_at) VALUES
    (${paying.id}, ${s1}, 'creator', 'active', now() + interval '20 days'), (${live.id}, ${s2}, 'creator', 'active', now() + interval '20 days')`
  const cancelled: string[] = [], purged: string[] = []
  const r = await del.sweepDeletedAccounts({ cancel: async id => { cancelled.push(id) }, purge: async id => { purged.push(id) }, force: true })
  assert.ok(r)
  assert.ok(cancelled.includes(s1) && !cancelled.includes(s2))
  const st = async (id: string) => (await sql<{ status: string }[]>`SELECT status FROM subscriptions WHERE razorpay_subscription_id = ${id}`)[0].status
  assert.equal(await st(s1), 'ended')
  assert.equal(await st(s2), 'active')
  assert.ok(purged.includes(due.id) && !purged.includes(paying.id) && !purged.includes(live.id))
  // already cancelled at Razorpay: ended here all the same
  const s3 = subId('again')
  await sql`INSERT INTO subscriptions (user_id, razorpay_subscription_id, plan, status) VALUES (${paying.id}, ${s3}, 'creator', 'active')`
  await del.sweepDeletedAccounts({ cancel: async () => { throw new Error('Subscription is not cancellable in cancelled status.') }, purge: async () => {}, force: true })
  assert.equal(await st(s3), 'ended')
  // the lease: a second copy within minutes does nothing
  await sql`DELETE FROM app_flags WHERE key = 'account_deletion_sweep'`
  assert.ok(await del.sweepDeletedAccounts({ cancel: async () => {}, purge: async () => {} }))
  assert.equal(await del.sweepDeletedAccounts({ cancel: async () => {}, purge: async () => {} }), null)
})

test('expiry leaves a deleted account alone: no warning email, nothing deleted', opts, async () => {
  const { sweepExpiry } = await import('./expiry')
  const gone = await user({ deletedDaysAgo: 3 })
  const v = await video(gone.id, -1)
  // (the control: a live Starter account's video past its date does go)
  const live = await user({ plan: 'starter' })
  await sql`INSERT INTO subscriptions (user_id, razorpay_subscription_id, plan, status, expires_at) VALUES (${live.id}, ${`sub_ctl_${live.id}`}, 'starter', 'active', now() + interval '20 days')`
  const old = await video(live.id, -1)
  await sql`UPDATE videos SET created_at = now() - interval '40 days' WHERE id = ${old}`
  const removed: string[] = [], warned: string[] = []
  await sweepExpiry({ force: true, notify: async to => { warned.push(to.email) }, remove: async (_u, ids) => { removed.push(...ids) } })
  assert.ok(removed.includes(old), 'a live account’s expired video is deleted')
  assert.ok(!removed.includes(v))
  assert.ok(!warned.includes(gone.email))
  assert.equal((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM videos WHERE id = ${v}`)[0].n, 1)
})

test('the emails: the user’s has the restore button and the date, never the reason; the admins’ has the feedback', async () => {
  const { accountDeletedEmail, accountRestoredAdminEmail } = await import('@/lib/accountEmails')
  const m = accountDeletedEmail({ name: 'Asha Rao', purgeAt: new Date('2026-12-24T06:00:00Z'), restoreUrl: 'https://s.test/restore-account?token=abc', base: 'https://s.test' })
  assert.match(m.html, /Restore my account/)
  assert.match(m.html, /href="https:\/\/s\.test\/restore-account\?token=abc"/)
  assert.match(m.text, /24 December 2026/)
  assert.match(m.text, /^Hi Asha,/)
  const a = accountRestoredAdminEmail({ email: 'a@b.test', feedback: 'Too <slow>', deletedAt: null, base: 'https://s.test' })
  assert.match(a.html, /Too &lt;slow&gt;/)
})
