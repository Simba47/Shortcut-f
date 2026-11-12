import { NextRequest, NextResponse } from 'next/server'
import { accountStatus } from '@/modules/auth/services'
import { clientIp } from '@/modules/auth/limits'
import { looksLikeEmail } from '@/lib/shared/email'

// A few looks a minute per visitor is plenty for a person at the form, and slows anyone trying a
// list of emails (each copy of the website counts its own)
const looks = new Map<string, number[]>()
const MAX_PER_MIN = 20

/** The sign-in form's first step: is there an account for this email, and how does it sign in */
export async function POST(req: NextRequest) {
  // (Railway's own address header first: a visitor can write any x-forwarded-for)
  const who = clientIp(req.headers)
  const now = Date.now()
  const recent = (looks.get(who) ?? []).filter(t => now - t < 60_000)
  if (recent.length >= MAX_PER_MIN) {
    return NextResponse.json({ error: 'Too many tries. Wait a minute and try again.' }, { status: 429 })
  }
  recent.push(now)
  looks.set(who, recent)
  if (looks.size > 5000) looks.delete(looks.keys().next().value as string)
  try {
    const { email } = await req.json()
    if (typeof email !== 'string' || !looksLikeEmail(email.trim())) {
      return NextResponse.json({ error: 'Enter a valid email' }, { status: 400 })
    }
    return NextResponse.json({ status: await accountStatus(email) })
  } catch {
    return NextResponse.json({ error: 'Could not check that email. Try again.' }, { status: 500 })
  }
}
