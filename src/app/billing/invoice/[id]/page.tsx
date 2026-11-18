import { notFound } from 'next/navigation'
import { requireUser } from '@/server/auth'
import { getInvoice } from '@/server/services/invoices'
import { describePurchase } from '@/lib/purchase'
import { PrintButton } from './PrintButton'
import { INVOICE_CSS, InvoiceSheet } from './InvoiceSheet'

export const dynamic = 'force-dynamic'

/** One invoice / receipt, to print or save as PDF (InvoiceSheet). Only its owner can open it. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const inv = await getInvoice(user.id, id)
  if (!inv) notFound()

  return (
    <div className="iv-page">
      <style>{INVOICE_CSS}</style>
      <div className="iv-bar">
        <a href="/billing" className="iv-back">← Payments</a>
        <PrintButton />
      </div>
      <InvoiceSheet inv={inv} purchase={describePurchase(inv.plan, inv.paidAt)} />
    </div>
  )
}
