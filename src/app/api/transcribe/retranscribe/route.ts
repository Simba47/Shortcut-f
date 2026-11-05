import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { queueRetranscribe } from '@/server/services/transcribe'

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body?.clip_id || !body?.language_code) {
    return NextResponse.json({ error: 'clip_id and language_code required' }, { status: 400 })
  }
  try {
    const jobId = await queueRetranscribe(user.id, body.clip_id, body.language_code, undefined, { readAll: body.read_all === true })
    return NextResponse.json({ ok: true, job_id: jobId ?? null })
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    return NextResponse.json({ error: e.message ?? 'Failed' }, { status: e.status ?? 500 })
  }
}
