import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { stopClipCaptions } from '@/server/services/transcribe'

/** The editor's Stop on Regenerate captions: { job_id } → { stopped } (false: it had already finished) */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (typeof body?.job_id !== 'string') return NextResponse.json({ error: 'job_id required' }, { status: 400 })
  try {
    return NextResponse.json({ stopped: await stopClipCaptions(user.id, body.job_id) })
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    return NextResponse.json({ error: e.message ?? 'Failed' }, { status: e.status ?? 500 })
  }
}
