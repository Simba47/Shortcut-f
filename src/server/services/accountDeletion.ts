import crypto from 'node:crypto'
import sql from '@/lib/db'
import { COMPANY } from '@/lib/company'
import { accountDeletedEmail, accountRestoredAdminEmail } from '@/lib/accountEmails'

// ── Accounts deleted by Shortcut's admin (user, 2026-11-24) ─────────────────
// The admin's Delete account (Shortcut-Admin-f actions.ts) turns the account off at once: it can't sign in (auth.ts),
// it is signed out everywhere, and the person is emailed a link to restore it. Everything is kept for RESTORE_DAYS:
// they restore it themselves on /restore-account, telling us what went wrong (required), and are back in at once;
// Shortcut's admins are emailed what they wrote. Meanwhile the sweep below cancels the account's subscription (no more
// charges) and, once the days are over, deletes the account for good (account.ts purgeAccount). Its videos don't
// expire while it is deleted (expiry.ts), and get a fresh GRACE_DAYS when it comes back.
// KEEP IN STEP with the admin app: Shortcut-Admin-f server/admin/schema.ts (the same columns and table) and
// server/admin/actions.ts deleteAccount / restoreAccount (the same restore rule as restoreAccountRows here).

/** How long a deleted account can be restored before it is deleted for good (user's choice: 30 days) */
export const RESTORE_DAYS = 30
/** Feedback asked for on restore: at least this many letters (user's choice: required) */
export const MIN_FEEDBACK = 10
export const MAX_FEEDBACK = 2000
/** A new restore link no sooner than this after the last (the sign-in page's "Send me the link") */
const RESEND_GAP_MS = 2 * 60_000

let ready: Promise<void> | null = null
/** The columns and the feedback table, once per copy of the site (the admin makes the same) */
export function ensureDeletionSchema(): Promise<void> {
  ready ??= (async () => {
    // (blocked_at: the admin's Block — made by the admin app too; read here at sign-in)
    await sql`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by TEXT, ADD COLUMN IF NOT EXISTS deleted_reason TEXT,
        ADD COLUMN IF NOT EXISTS purge_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS restore_token_hash TEXT, ADD COLUMN IF NOT EXISTS restore_sent_at TIMESTAMPTZ`
    // What people wrote when they restored their account. No link to users: kept after an account is gone for good.
    await sql`
      CREATE TABLE IF NOT EXISTS account_feedback (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID,
        email TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'restore',
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`CREATE INDEX IF NOT EXISTS account_feedback_user_idx ON account_feedback (user_id, created_at DESC)`
    await sql`CREATE INDEX IF NOT EXISTS users_purge_idx ON users (purge_at) WHERE deleted_at IS NOT NULL`
  })().catch(e => { ready = null; throw e })
  return ready
}

export type AccountLock = { state: 'ok' } | { state: 'blocked' } | { state: 'deleted'; restoreBy: Date | null }

/** Whether an account may sign in: blocked by the admin, or deleted (and until when it can be restored) */
export async function accountLock(by: { email: string } | { id: string }): Promise<AccountLock> {
  await ensureDeletionSchema()
  const [u] = 'email' in by
    ? await sql<{ blocked_at: Date | null; deleted_at: Date | null; purge_at: Date | null }[]>`SELECT blocked_at, deleted_at, purge_at FROM users WHERE email = ${by.email.toLowerCase().trim()}`
    : await sql<{ blocked_at: Date | null; deleted_at: Date | null; purge_at: Date | null }[]>`SELECT blocked_at, deleted_at, purge_at FROM users WHERE id = ${by.id}`
  if (!u) return { state: 'ok' }
  if (u.deleted_at) return { state: 'deleted', restoreBy: u.purge_at }
  if (u.blocked_at) return { state: 'blocked' }
  return { state: 'ok' }
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex')
/** A new one-time restore link's secret (only its hash is kept) */
export function newRestoreToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}
export const restoreUrl = (base: string, token: string) => `${base}/restore-account?token=${encodeURIComponent(token)}`

/**
 * The sign-in page's "Send me the restore link": a new link to a deleted account's email (the old one stops
 * working). Quietly nothing for an email that isn't a deleted account, or a second ask within RESEND_GAP_MS.
 */
export async function sendRestoreLink(email: string, deps: { send: (to: string, m: { subject: string; html: string; text: string }) => Promise<void>; base: string }): Promise<void> {
  await ensureDeletionSchema()
  const { token, hash } = newRestoreToken()
  const [u] = await sql<{ email: string; name: string | null; purge_at: Date }[]>`
    UPDATE users SET restore_token_hash = ${hash}, restore_sent_at = now()
    WHERE email = ${email.toLowerCase().trim()} AND deleted_at IS NOT NULL AND purge_at > now()
      AND (restore_sent_at IS NULL OR restore_sent_at < now() - make_interval(secs => ${RESEND_GAP_MS / 1000}))
    RETURNING email, name, purge_at`
  if (!u) return
  await deps.send(u.email, accountDeletedEmail({ name: u.name, purgeAt: u.purge_at, restoreUrl: restoreUrl(deps.base, token), base: deps.base }))
}

/** What the restore page shows for a link: whose account, and until when (null: the link isn't good, or is used) */
export async function restoreLinkInfo(token: string): Promise<{ email: string; restoreBy: Date } | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null
  await ensureDeletionSchema()
  const [u] = await sql<{ email: string; purge_at: Date }[]>`
    SELECT email, purge_at FROM users WHERE restore_token_hash = ${hashToken(token)} AND deleted_at IS NOT NULL AND purge_at > now()`
  return u ? { email: u.email, restoreBy: u.purge_at } : null
}

/**
 * The account back as it was: no longer deleted, the link used up. Its videos get a fresh GRACE_DAYS (7) before any
 * expires — its subscription was cancelled when it was deleted, so this is the time to choose a plan again.
 * (videos_grace_from / keep_released_at: the expiry rules' own grace, expiry.ts.) Run in a transaction.
 * KEEP IN STEP with the admin's Restore (Shortcut-Admin-f actions.ts restoreAccount).
 */
export async function restoreAccountRows(tx: typeof sql, userId: string): Promise<void> {
  await tx`
    UPDATE users SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL, purge_at = NULL, restore_token_hash = NULL, restore_sent_at = NULL
    WHERE id = ${userId}`
  const cols = new Set((await tx<{ c: string }[]>`
    SELECT table_name || '.' || column_name AS c FROM information_schema.columns
    WHERE table_schema = 'public' AND ((table_name = 'users' AND column_name = 'videos_grace_from') OR (table_name = 'videos' AND column_name IN ('keep_released_at', 'expires_at', 'expiry_warned_at')))`).map(r => r.c))
  if (cols.has('users.videos_grace_from')) await tx`UPDATE users SET videos_grace_from = now() WHERE id = ${userId}`
  if (cols.has('videos.keep_released_at')) await tx`UPDATE videos SET keep_released_at = now() WHERE user_id = ${userId} AND NOT COALESCE(kept, false)`
  if (cols.has('videos.expires_at')) {
    await tx`UPDATE videos SET expires_at = GREATEST(expires_at, now() + interval '7 days') WHERE user_id = ${userId} AND expires_at IS NOT NULL`
  }
  if (cols.has('videos.expiry_warned_at')) await tx`UPDATE videos SET expiry_warned_at = NULL WHERE user_id = ${userId}`
}

/**
 * Restore with the emailed link: the feedback is required (MIN_FEEDBACK letters), kept, and emailed to Shortcut's
 * admins. Throws a message for the page when the link is no good or the feedback too short.
 */
export async function restoreAccount(token: unknown, feedback: unknown, deps: {
  send: (to: string | string[], m: { subject: string; html: string; text: string }) => Promise<void>; base: string
}): Promise<{ email: string }> {
  const fail = (m: string, status = 400) => Object.assign(new Error(m), { status, expose: true })
  const text = typeof feedback === 'string' ? feedback.trim().slice(0, MAX_FEEDBACK) : ''
  if (text.replace(/\s+/g, '').length < MIN_FEEDBACK) throw fail('Tell us in a few words what went wrong or what we could do better — that’s all we ask to restore it.')
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw fail('This restore link isn’t right. Use the button in the email, or ask for a new link on the sign-in page.')
  await ensureDeletionSchema()
  const done = await sql.begin(async tx => {
    const [u] = await tx<{ id: string; email: string; deleted_at: Date }[]>`
      SELECT id, email, deleted_at FROM users WHERE restore_token_hash = ${hashToken(token)} AND deleted_at IS NOT NULL AND purge_at > now() FOR UPDATE`
    if (!u) return null
    await restoreAccountRows(tx as unknown as typeof sql, u.id)
    await tx`INSERT INTO account_feedback (user_id, email, kind, body) VALUES (${u.id}, ${u.email}, 'restore', ${text})`
    return u
  })
  if (!done) throw fail('This restore link has expired or was already used. Ask for a new one on the sign-in page.', 410)
  // Shortcut's admins hear about it (a failed email never undoes the restore: the admin shows the feedback too)
  const admins = (process.env.ADMIN_ALERT_TO || process.env.ADMIN_EMAILS || COMPANY.email).split(',').map(s => s.trim()).filter(Boolean)
  await deps.send(admins, accountRestoredAdminEmail({ email: done.email, feedback: text, deletedAt: done.deleted_at, base: deps.base }))
    .catch(e => console.warn('[account] restore email to the admins not sent:', e instanceof Error ? e.message : e))
  return { email: done.email }
}

/**
 * Every few minutes (one copy of the site at a time: a lease in app_flags): a deleted account's subscription is
 * cancelled at once (no more charges), and an account whose days to restore are over is deleted for good.
 */
export async function sweepDeletedAccounts(deps: {
  cancel: (subscriptionId: string) => Promise<unknown>
  purge: (userId: string) => Promise<void>
  force?: boolean
}): Promise<{ cancelled: number; purged: number } | null> {
  await ensureDeletionSchema()
  if (!deps.force) {
    await sql`CREATE TABLE IF NOT EXISTS app_flags (key TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now())`
    await sql`INSERT INTO app_flags (key, at) VALUES ('account_deletion_sweep', now() - interval '1 day') ON CONFLICT (key) DO NOTHING`
    const [lease] = await sql`UPDATE app_flags SET at = now() WHERE key = 'account_deletion_sweep' AND at < now() - interval '4 minutes' RETURNING key`
    if (!lease) return null
  }
  let cancelled = 0, purged = 0
  const [subs] = await sql<{ ok: boolean }[]>`SELECT to_regclass('public.subscriptions') IS NOT NULL AS ok`
  if (subs.ok) {
    const live = await sql<{ razorpay_subscription_id: string }[]>`
      SELECT s.razorpay_subscription_id FROM subscriptions s JOIN users u ON u.id = s.user_id
      WHERE u.deleted_at IS NOT NULL AND s.razorpay_subscription_id IS NOT NULL AND s.status IN ('active', 'created', 'authenticated', 'pending')`
    for (const s of live) {
      try {
        // (Razorpay says it was already cancelled or never started: ended here all the same)
        await deps.cancel(s.razorpay_subscription_id).catch(e => { if (!/cancel|not.*(active|allowed)|completed|expired/i.test(String((e as Error)?.message))) throw e })
        await sql`UPDATE subscriptions SET status = 'ended', expires_at = now() WHERE razorpay_subscription_id = ${s.razorpay_subscription_id}`
        cancelled++
      } catch (e) {
        console.warn('[account] could not cancel the subscription of a deleted account:', e instanceof Error ? e.message : e)
      }
    }
  }
  const due = await sql<{ id: string }[]>`SELECT id FROM users WHERE deleted_at IS NOT NULL AND purge_at <= now() ORDER BY purge_at LIMIT 20`
  for (const u of due) {
    try { await deps.purge(u.id); purged++ } catch (e) { console.warn('[account] could not delete an account for good:', e instanceof Error ? e.message : e) }
  }
  if (cancelled || purged) console.log(`[account] deleted accounts: ${cancelled} subscription(s) cancelled, ${purged} deleted for good`)
  return { cancelled, purged }
}

/** Started once per copy of the site (instrumentation.ts): every 5 minutes, the first a minute after start */
export function startDeletionSweep(deps: Parameters<typeof sweepDeletedAccounts>[0]): void {
  const run = () => { sweepDeletedAccounts(deps).catch(e => console.warn('[account] deleted-accounts sweep failed:', e instanceof Error ? e.message : e)) }
  setTimeout(run, 60_000).unref?.()
  setInterval(run, 5 * 60_000).unref?.()
}
