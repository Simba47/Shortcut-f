import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/server/auth'
import { apiError } from '@/lib/api-error'
import { exportRefund } from '@/server/services/notices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The credits a clip's last export gave back when it failed (?clip=): the editor's "Your 2 credits came back" */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const clip = req.nextUrl.searchParams.get('clip') ?? ''
  if (!UUID.test(clip)) return NextResponse.json({ error: 'clip required' }, { status: 400 })
  try {
    return NextResponse.json({ credits: await exportRefund(user.id, clip) })
  } catch (err) {
    return apiError(err)
  }
}
