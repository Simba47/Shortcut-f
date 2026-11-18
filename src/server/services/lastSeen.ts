import sql from '@/lib/db'

// When each account last had the site open in a visible tab (users.last_seen_at): the admin's Users
// page shows a green dot for anyone seen in the last 2 minutes. The page pings once a minute while
// it's visible (components/LastSeenPing.tsx, app/api/account/seen); written at most once a minute per
// account per copy of the website, so a few open tabs cost one small UPDATE a minute.

let ready: Promise<void> | null = null
function ensureColumn(): Promise<void> {
  ready ??= sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ`.then(() => {})
    .catch(e => { ready = null; throw e })
  return ready
}

const WRITE_EVERY_MS = 50_000
const written = new Map<string, number>()

/** Marks the account as here now (skipped when it was marked less than 50 s ago). Never throws. */
export async function markSeen(userId: string): Promise<void> {
  const now = Date.now()
  if (now - (written.get(userId) ?? 0) < WRITE_EVERY_MS) return
  written.set(userId, now)
  if (written.size > 50_000) for (const [id, at] of written) if (now - at > WRITE_EVERY_MS) written.delete(id)
  try {
    await ensureColumn()
    await sql`UPDATE users SET last_seen_at = now() WHERE id = ${userId}`
  } catch (e) {
    written.delete(userId)
    console.warn('[last-seen] not recorded:', e instanceof Error ? e.message : e)
  }
}
