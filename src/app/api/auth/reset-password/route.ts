import { NextRequest, NextResponse } from 'next/server'
import { resetPassword } from '@/modules/auth/services'

export async function POST(req: NextRequest) {
  try {
    const { email, otp, password } = await req.json()
    if (!email || !otp || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    await resetPassword(email, otp, password)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const e = err as Error & { status?: number }
    const status = e.status ?? 500
    // (a server fault's own words can describe the database: they go to the log, the visitor gets a plain line)
    if (status >= 500) console.error('[auth]', err)
    return NextResponse.json({ error: status >= 500 ? 'Something went wrong. Please try again.' : e.message }, { status })
  }
}
