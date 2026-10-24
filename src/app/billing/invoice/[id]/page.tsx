import { notFound } from 'next/navigation'
import { requireUser } from '@/server/auth'
import { getInvoice } from '@/server/services/invoices'
import { amountInRupees, stateName } from '@/lib/invoice'
import { PrintButton } from './PrintButton'

export const dynamic = 'force-dynamic'

/** One invoice, laid out on white paper to print or save as PDF. Only its owner can open it. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  const inv = await getInvoice(user.id, id)
  if (!inv) notFound()
  const s = inv.seller
  const taxed = !!s?.taxInvoice
  const date = inv.paidAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const money = (p: number) => `₹${amountInRupees(p)}`
  const cell = { padding: '8px 0', borderBottom: '1px solid #e5e5e5' } as const

  return (
    <div style={{ background: '#fff', color: '#111', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <style>{`@media print { .no-print { display: none !important } @page { margin: 16mm } }`}</style>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px 64px' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
          <a href="/billing" style={{ color: '#555', fontSize: 14 }}>← Payments</a>
          <PrintButton />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: '0.12em', color: '#888', fontWeight: 600 }}>SHORTCUT</div>
            <h1 style={{ margin: '6px 0 0', fontSize: 26 }}>{taxed ? 'Tax invoice' : 'Payment receipt'}</h1>
          </div>
          <div style={{ textAlign: 'right', fontSize: 14, lineHeight: 1.6 }}>
            <div><strong>{inv.invoiceNo ?? '—'}</strong></div>
            <div>Date: {date}</div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginTop: 28, fontSize: 14, lineHeight: 1.6 }}>
          <div>
            <div style={{ color: '#888', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>From</div>
            <strong>{s?.legalName}</strong><br />{s?.address}<br />
            {s?.gstin && <>GSTIN: {s.gstin}<br /></>}
            {s?.stateCode && <>State: {stateName(s.stateCode)} ({s.stateCode})<br /></>}
            {s?.email}
          </div>
          <div style={{ maxWidth: 300 }}>
            <div style={{ color: '#888', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Billed to</div>
            <strong>{inv.customer.name || inv.customer.email}</strong><br />
            {inv.customer.name && <>{inv.customer.email}<br /></>}
            {inv.customer.address && <>{inv.customer.address}<br /></>}
            {inv.customer.gstin && <>GSTIN: {inv.customer.gstin}<br /></>}
            {inv.placeOfSupply && <>Place of supply: {stateName(inv.placeOfSupply)} ({inv.placeOfSupply})</>}
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 32, fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <th style={{ ...cell, borderBottom: '2px solid #111' }}>Description</th>
              <th style={{ ...cell, borderBottom: '2px solid #111', textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={cell}>
                Shortcut {inv.planName} plan, one month
                {taxed && s?.sac && <div style={{ color: '#888', fontSize: 12 }}>SAC {s.sac}</div>}
              </td>
              <td style={{ ...cell, textAlign: 'right' }}>{money(taxed ? inv.taxablePaise : inv.amountPaise)}</td>
            </tr>
            {taxed && inv.cgstPaise > 0 && <>
              <tr><td style={cell}>CGST @ {inv.gstRate / 2}%</td><td style={{ ...cell, textAlign: 'right' }}>{money(inv.cgstPaise)}</td></tr>
              <tr><td style={cell}>SGST @ {inv.gstRate / 2}%</td><td style={{ ...cell, textAlign: 'right' }}>{money(inv.sgstPaise)}</td></tr>
            </>}
            {taxed && inv.igstPaise > 0 && <tr><td style={cell}>IGST @ {inv.gstRate}%</td><td style={{ ...cell, textAlign: 'right' }}>{money(inv.igstPaise)}</td></tr>}
            <tr>
              <td style={{ padding: '12px 0', fontWeight: 700 }}>Total paid</td>
              <td style={{ padding: '12px 0', fontWeight: 700, textAlign: 'right', fontSize: 16 }}>{money(inv.amountPaise)}</td>
            </tr>
          </tbody>
        </table>

        <p style={{ marginTop: 24, fontSize: 12, color: '#777', lineHeight: 1.6 }}>
          Paid online (payment {inv.razorpayPaymentId}). {taxed ? 'The price includes GST.' : ''} This is a computer-generated document and needs no signature.
        </p>
      </div>
    </div>
  )
}
