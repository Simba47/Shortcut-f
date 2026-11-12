import { NextRequest, NextResponse } from 'next/server'
import { signupUser } from '@/modules/auth/services'
import { clientIp } from '@/modules/auth/limits'

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
    }
    await signupUser(email, password, clientIp(req.headers))
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const e = err as Error & { status?: number }
    const status = e.status ?? 500
    // (a server fault's own words can describe the database: they go to the log, the visitor gets a plain line)
    if (status >= 500) console.error('[auth]', err)
    return NextResponse.json({ error: status >= 500 ? 'Something went wrong. Please try again.' : e.message }, { status })
  }
}
