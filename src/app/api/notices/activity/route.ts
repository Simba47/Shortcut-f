import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/server/auth'
import { apiError } from '@/lib/api-error'
import { activity } from '@/server/services/notices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The user's work (the site's watcher, components/notices/ActivityWatcher): how much is running, and what
 * finished after ?since= (the cursor the last answer gave). Without since: only the count and a cursor.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const raw = req.nextUrl.searchParams.get('since')
  const since = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : null
  try {
    return NextResponse.json(await activity(user.id, since))
  } catch (err) {
    return apiError(err)
  }
}
