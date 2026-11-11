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
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 })
  }
}
