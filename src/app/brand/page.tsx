import { redirect } from 'next/navigation'

/**
 * The Brand kits page is gone (user, 2026-10-31): brand kits are a popup now (components/brand/BrandKitDialog).
 * This address only forwards — at once, no page and no loading screen — to the dashboard with the popup
 * open, keeping what the link asked for: a team invite in an email (?invite=<id>, lib/shared/brandTeam
 * inviteLink) or a kit (?kit=<id>).
 */
export default async function BrandPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams
  const q = new URLSearchParams({ brand: 'open' })
  for (const k of ['invite', 'kit']) {
    const v = p[k]
    if (typeof v === 'string' && v) q.set(k, v)
  }
  redirect(`/dashboard?${q}`)
}
