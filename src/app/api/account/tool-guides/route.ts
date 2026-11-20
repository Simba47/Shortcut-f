import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { setToolGuides, toolGuides } from '@/server/services/toolGuides'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Whether the editor shows its tool guides (the little loops) for this account */
export async function GET() {
  const user = await requireUser()
  try { return NextResponse.json(await toolGuides(user.id)) }
  catch { return NextResponse.json({ error: 'Could not read the setting' }, { status: 500 }) }
}

/** The Guide page's switch: { on: boolean } */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  const body = await req.json().catch(() => ({}))
  if (typeof body?.on !== 'boolean') return NextResponse.json({ error: 'Say on or off' }, { status: 400 })
  try {
    await setToolGuides(user.id, body.on)
    return NextResponse.json(await toolGuides(user.id))
  } catch { return NextResponse.json({ error: 'Could not save the setting' }, { status: 500 }) }
}
