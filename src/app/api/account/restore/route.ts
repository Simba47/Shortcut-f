import { NextRequest, NextResponse } from 'next/server'
import { restoreAccount } from '@/server/services/accountDeletion'
import { sendMail, siteBase } from '@/modules/auth/mailer'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The restore page: { token, feedback } — the account comes back at once (accountDeletion.ts restoreAccount) */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const r = await restoreAccount(body?.token, body?.feedback, { send: sendMail, base: siteBase() })
    return NextResponse.json({ ok: true, email: r.email })
  } catch (err) {
    return apiError(err)
  }
}
