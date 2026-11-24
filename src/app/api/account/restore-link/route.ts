import { NextRequest, NextResponse } from 'next/server'
import { sendRestoreLink } from '@/server/services/accountDeletion'
import { sendMail, siteBase } from '@/modules/auth/mailer'
import { clientIp } from '@/modules/auth/limits'
import { looksLikeEmail } from '@/lib/shared/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// (a few asks a minute per visitor: the sign-in panel's button, not a way to send mail to a list of addresses)
const asks = new Map<string, number[]>()

/**
 * The sign-in page's "Email me the restore link" for an account Shortcut's admin deleted: { email }. Always says
 * ok (whether the email is a deleted account isn't told here); a new link goes only to a deleted account, at most
 * one every 2 minutes (accountDeletion.ts sendRestoreLink).
 */
export async function POST(req: NextRequest) {
  const who = clientIp(req.headers), now = Date.now()
  const recent = (asks.get(who) ?? []).filter(t => now - t < 60_000)
  if (recent.length >= 5) return NextResponse.json({ error: 'Too many tries. Wait a minute and try again.' }, { status: 429 })
  asks.set(who, [...recent, now])
  if (asks.size > 5000) asks.delete(asks.keys().next().value as string)
  const body = await req.json().catch(() => ({}))
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  if (!looksLikeEmail(email)) return NextResponse.json({ error: 'Enter a valid email' }, { status: 400 })
  try {
    await sendRestoreLink(email, { send: sendMail, base: siteBase() })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[account] restore link not sent:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Could not send the link. Try again in a minute.' }, { status: 500 })
  }
}
