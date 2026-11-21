import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { saveBillingDetails } from '@/server/services/invoices'
import { getUserPlanConfig } from '@/server/services/quota'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Name, GSTIN, state and address for your next invoices (invoices already issued never change). Pro only (plans.ts gstInvoices; Agency's until 2026-11-21) */
export async function PUT(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => null)
  try {
    if (!(await getUserPlanConfig(user.id)).gstInvoices) {
      return NextResponse.json({ error: 'Company details on invoices come with the Pro plan.' }, { status: 403 })
    }
    return NextResponse.json({ details: await saveBillingDetails(user.id, b ?? {}) })
  } catch (err) {
    return apiError(err)
  }
}
