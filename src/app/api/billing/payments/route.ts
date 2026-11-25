import { NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { listPayments, getBillingDetails, sellerDetails } from '@/server/services/invoices'
import { getUserPlan } from '@/server/services/quota'
import { PLANS } from '@/lib/plans'
import { GST_STATES } from '@/lib/invoice'
import { testPackAllowed } from '@/lib/credits'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The payments page: your payments (newest first), your plan (which credit packs you can buy there),
 * and on Pro what goes on your invoices and the states to choose from (plans.ts gstInvoices)
 */
export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const [payments, plan] = await Promise.all([listPayments(user.id), getUserPlan(user.id)])
    const invoiceDetails = PLANS[plan].gstInvoices
    return NextResponse.json({
      // (each payment's two papers: its tax invoice's number — null until it has one — and its receipt's)
      payments: payments.map(p => ({ id: p.id, invoiceNo: p.invoiceNo, receiptNo: p.receiptNo, planName: p.planName, amountPaise: p.amountPaise, currency: p.currency, paidAt: p.paidAt })),
      plan,
      // the ₹1 test pack, for an email in TEST_PACK_EMAILS only
      testPack: testPackAllowed(user.email),
      invoiceDetails,
      details: invoiceDetails ? await getBillingDetails(user.id) : null,
      taxInvoices: sellerDetails().taxInvoice,
      states: invoiceDetails ? Object.entries(GST_STATES).map(([code, name]) => ({ code, name })) : [],
    })
  } catch (err) {
    return apiError(err)
  }
}
