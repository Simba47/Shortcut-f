import { restoreLinkInfo } from '@/server/services/accountDeletion'
import { RestoreForm } from './RestoreForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Restore your account — Shortcut', robots: { index: false } }

/**
 * Restore an account Shortcut's admin deleted (user, 2026-11-24): the link from the "Your account was deleted" email
 * (?token=…). A few words about what went wrong (required), and it's back at once (server/services/accountDeletion.ts).
 */
export default async function RestoreAccountPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams
  const info = await restoreLinkInfo(token).catch(() => null)
  return <RestoreForm token={token} email={info?.email ?? null} restoreBy={info ? info.restoreBy.toISOString() : null} />
}
