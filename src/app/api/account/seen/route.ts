import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { markSeen } from '@/server/services/lastSeen'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** "This account has the site open right now" (components/LastSeenPing.tsx); nothing for a signed-out visitor */
export async function POST() {
  const session = await auth()
  if (session?.user?.id && !session.replaced) await markSeen(session.user.id)
  return new NextResponse(null, { status: 204 })
}
