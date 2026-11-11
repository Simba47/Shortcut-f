import { NextRequest, NextResponse } from 'next/server'
import { verifyOtp, resendOtp } from '@/modules/auth/services'
import { clientIp } from '@/modules/auth/limits'

export async function POST(req: NextRequest) {
  try {
    const { email, otp, purpose } = await req.json()
    if (!email || !otp || !purpose) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    await verifyOtp(email, otp, purpose)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const e = err as Error & { status?: number }
    const status = e.status ?? 500
    // (a server fault's own words can describe the database: they go to the log, the visitor gets a plain line)
    if (status >= 500) console.error('[auth]', err)
    return NextResponse.json({ error: status >= 500 ? 'Something went wrong. Please try again.' : e.message }, { status })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { email, purpose } = await req.json()
    if (!email || !purpose) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (purpose !== 'signup' && purpose !== 'password_reset') return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    await resendOtp(email, purpose, clientIp(req.headers))
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const e = err as Error & { status?: number }
    const status = e.status ?? 500
    // (a server fault's own words can describe the database: they go to the log, the visitor gets a plain line)
    if (status >= 500) console.error('[auth]', err)
    return NextResponse.json({ error: status >= 500 ? 'Something went wrong. Please try again.' : e.message }, { status })
  }
}
