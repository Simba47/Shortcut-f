import { NextRequest, NextResponse } from 'next/server'
import { requestPasswordReset } from '@/modules/auth/services'
import { clientIp } from '@/modules/auth/limits'

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 })
    }
    await requestPasswordReset(email, clientIp(req.headers))
    // Always return 200 — don't reveal whether the email exists
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true })
  }
}
