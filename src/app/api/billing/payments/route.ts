import { NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { listPayments, getBillingDetails, sellerDetails } from '@/server/services/invoices'
import { GST_STATES } from '@/lib/invoice'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The payments page: your payments (newest first), what goes on your invoices, and the states to choose from */
export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const [payments, details] = await Promise.all([listPayments(user.id), getBillingDetails(user.id)])
    return NextResponse.json({
      payments: payments.map(p => ({ id: p.id, invoiceNo: p.invoiceNo, planName: p.planName, amountPaise: p.amountPaise, paidAt: p.paidAt })),
      details,
      taxInvoices: sellerDetails().taxInvoice,
      states: Object.entries(GST_STATES).map(([code, name]) => ({ code, name })),
    })
  } catch (err) {
    return apiError(err)
  }
}
