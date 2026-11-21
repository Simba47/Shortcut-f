import { notFound } from 'next/navigation'
import { requireUser } from '@/server/auth'
import { asPaper, getInvoice, papersOf, type PaperKind } from '@/server/services/invoices'
import { describePurchase } from '@/lib/purchase'
import { PrintButton } from './PrintButton'
import { INVOICE_CSS, InvoiceSheet } from './InvoiceSheet'

export const dynamic = 'force-dynamic'

const PAPER_NAME: Record<PaperKind, string> = { invoice: 'Tax invoice', receipt: 'Receipt' }

/**
 * One payment's paper, to print or save as PDF (InvoiceSheet): its tax invoice (?paper=invoice, the default when it
 * has one) or its receipt (?paper=receipt) — every payment has both since 2026-11-21 (user), with a switch between
 * them. Only its owner can open it.
 */
export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ paper?: string }> }) {
  const [{ id }, { paper }] = await Promise.all([params, searchParams])
  const user = await requireUser()
  const inv = await getInvoice(user.id, id)
  if (!inv) notFound()
  const papers = papersOf(inv)
  const kind: PaperKind = paper === 'receipt' || paper === 'invoice' ? (papers.includes(paper) ? paper : papers[0]) : papers[0]
  const sheet = asPaper(inv, kind)!

  return (
    <div className="iv-page">
      <style>{INVOICE_CSS}</style>
      <div className="iv-bar">
        <a href="/pricing#billing" className="iv-back">← Payments &amp; invoices</a>
        {papers.length > 1 && (
          <nav className="iv-papers" aria-label="This payment's papers">
            {papers.map(k => (
              <a key={k} href={`/billing/invoice/${inv.id}?paper=${k}`} aria-current={k === kind ? 'page' : undefined}>{PAPER_NAME[k]}</a>
            ))}
          </nav>
        )}
        <PrintButton />
      </div>
      <InvoiceSheet inv={sheet} purchase={describePurchase(inv.plan, inv.paidAt)} />
    </div>
  )
}
