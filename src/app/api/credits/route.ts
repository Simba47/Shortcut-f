import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/server/auth'
import { apiError } from '@/lib/api-error'
import { creditsMode, TOPUP_PACKS } from '@/lib/credits'
import { balance, ensureFreeGrant, grantsSummary, recentLedger, sweep } from '@/server/services/credits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The credit balance for the header and the usage page: what can be spent now, what is held for
 * running jobs, when the next credits expire, and the latest ledger rows. With credits off it says
 * so and nothing else (the page then shows no balance).
 */
export async function GET(req: NextRequest) {
  // (?brief=1: the header's pill — the balance only, without the history the billing page lists)
  const brief = req.nextUrl.searchParams.get('brief') === '1'
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const mode = creditsMode()
  if (mode === 'off') return NextResponse.json({ mode })
  try {
    await ensureFreeGrant(user.id)
    // Jobs that finished since the last look settle or give their credits back first
    await sweep(user.id)
    const [b, ledger, grants] = await Promise.all([balance(user.id), brief ? null : recentLedger(user.id, 30), brief ? null : grantsSummary(user.id)])
    if (brief) return NextResponse.json({ mode, balance: b.balance, held: b.held, nextExpiry: b.nextExpiry })
    return NextResponse.json({
      mode, balance: b.balance, held: b.held, nextExpiry: b.nextExpiry, ledger,
      // "450 / 599 credits" and when they run out (the Buy credits page)
      total: grants?.total ?? null, expiries: grants?.expiries ?? [],
      topupPacks: TOPUP_PACKS,
    })
  } catch (err) {
    return apiError(err)
  }
}
