import type { InvoiceRow } from '@/server/services/invoices'
import { type Purchase, renewalNote } from '@/lib/purchase'
import { COMPANY } from '@/lib/company'
import { amountInRupees, rupeesInWords, stateName } from '@/lib/invoice'

// The Shortcut mark (components/ui/brand-logo.tsx BRAND_TOP / BRAND_BOTTOM; copied: that file is a client module),
// lime on a black tile like the app icon (public/apple-icon.png) and the PDF (server/services/invoicePdf.ts)
const MARK_TOP = 'M36 2H92Q98 2 94 6L34 66A32 32 0 0 1 36 2Z'
const MARK_BOTTOM = 'M66 116H10Q4 116 8 112L68 52A32 32 0 0 1 66 116Z'

const day = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
const money = (p: number) => `₹${amountInRupees(p)}`

/**
 * One invoice / receipt as a sheet of paper (user, 2026-11-18: designed). The same on screen and on
 * paper (Print / Save as PDF, A4). Light on purpose: it is a document.
 */
export function InvoiceSheet({ inv, purchase }: { inv: InvoiceRow; purchase: Purchase }) {
  const s = inv.seller
  const taxed = !!s?.taxInvoice
  const title = taxed ? 'Tax invoice' : 'Receipt'
  const note = renewalNote(purchase)
  const linePrice = taxed ? inv.taxablePaise : inv.amountPaise
  const customer = inv.customer

  return (
    <article className="iv-sheet">
      <header className="iv-head">
        <div>
          <div className="iv-brand">
            <span className="iv-mark"><svg viewBox="0 0 102 118" aria-hidden><path d={MARK_TOP} /><path d={MARK_BOTTOM} /></svg></span>
            <span>Shortcut</span>
          </div>
          <div className="iv-seller-line">{s?.legalName ?? COMPANY.legalName}</div>
        </div>
        <div className="iv-title">
          <h1>{title}</h1>
          <div className="iv-no">{inv.invoiceNo ?? '—'}</div>
          <span className="iv-paid">Paid</span>
        </div>
      </header>

      <dl className="iv-meta">
        <div><dt>{taxed ? 'Invoice no.' : 'Receipt no.'}</dt><dd className="iv-mono">{inv.invoiceNo ?? '—'}</dd></div>
        <div><dt>Date paid</dt><dd>{day(inv.paidAt)}</dd></div>
        <div><dt>Paid by</dt><dd>Online · Razorpay</dd></div>
        <div><dt>Amount paid</dt><dd className="iv-strong">{money(inv.amountPaise)}</dd></div>
      </dl>

      <section className="iv-parties">
        <div>
          <h2>From</h2>
          <p className="iv-name">{s?.legalName ?? COMPANY.legalName}</p>
          <p>{s?.address ?? COMPANY.address.join(', ')}</p>
          {s?.gstin && <p>GSTIN <span className="iv-mono">{s.gstin}</span></p>}
          {s?.stateCode && <p>State: {stateName(s.stateCode)} ({s.stateCode})</p>}
          <p>{s?.email ?? COMPANY.email}</p>
        </div>
        <div>
          <h2>Billed to</h2>
          <p className="iv-name">{customer.name || customer.email}</p>
          {customer.name && <p>{customer.email}</p>}
          {customer.address && <p>{customer.address}</p>}
          {customer.gstin && <p>GSTIN <span className="iv-mono">{customer.gstin}</span></p>}
          {inv.placeOfSupply && <p>Place of supply: {stateName(inv.placeOfSupply)} ({inv.placeOfSupply})</p>}
        </div>
      </section>

      <table className="iv-items">
        <thead>
          <tr><th>Item</th><th className="iv-num">Qty</th><th className="iv-num">Price</th><th className="iv-num">Amount</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div className="iv-item">{purchase.name}</div>
              {purchase.detail && <div className="iv-sub">{purchase.detail}</div>}
              {purchase.kind === 'one-time' && purchase.validUntil && <div className="iv-sub">Credits valid until {day(purchase.validUntil)}</div>}
              {taxed && s?.sac && <div className="iv-sub">SAC {s.sac}</div>}
            </td>
            <td className="iv-num">1</td>
            <td className="iv-num">{money(linePrice)}</td>
            <td className="iv-num">{money(linePrice)}</td>
          </tr>
        </tbody>
      </table>

      <section className="iv-sum">
        <div className="iv-words">
          <h2>Amount in words</h2>
          <p>{rupeesInWords(inv.amountPaise)}</p>
        </div>
        <dl className="iv-totals">
          {taxed && <div><dt>Taxable value</dt><dd>{money(inv.taxablePaise)}</dd></div>}
          {taxed && inv.cgstPaise > 0 && <div><dt>CGST @ {inv.gstRate / 2}%</dt><dd>{money(inv.cgstPaise)}</dd></div>}
          {taxed && inv.sgstPaise > 0 && <div><dt>SGST @ {inv.gstRate / 2}%</dt><dd>{money(inv.sgstPaise)}</dd></div>}
          {taxed && inv.igstPaise > 0 && <div><dt>IGST @ {inv.gstRate}%</dt><dd>{money(inv.igstPaise)}</dd></div>}
          {!taxed && <div><dt>Subtotal</dt><dd>{money(inv.amountPaise)}</dd></div>}
          <div className="iv-total"><dt>Total paid</dt><dd>{money(inv.amountPaise)}</dd></div>
        </dl>
      </section>

      <section className="iv-notes">
        {note && <p>{note}</p>}
        <p>Payment ID <span className="iv-mono">{inv.razorpayPaymentId}</span>{taxed ? ' · The price includes GST.' : ''}</p>
        <p>This is a computer-generated {taxed ? 'invoice' : 'receipt'} and needs no signature.</p>
      </section>

      <footer className="iv-foot">
        <span>Thank you for choosing Shortcut.</span>
        <span>{COMPANY.email}</span>
      </footer>
    </article>
  )
}

/** The sheet's look (a plain style tag: the page has no other styles to share) */
export const INVOICE_CSS = `
.iv-page { min-height: 100vh; background: #f4f4f5; color: #18181b; padding: 28px 16px 64px; color-scheme: light;
  font-family: var(--font-display, 'Inter Tight'), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
.iv-bar { max-width: 794px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.iv-back { color: #52525b; font-size: 14px; text-decoration: none; }
.iv-back:hover { color: #18181b; }
.iv-print { background: #0a0a0a; color: #fff; border: 0; border-radius: 10px; padding: 10px 16px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.iv-print:hover { background: #27272a; }
.iv-sheet { max-width: 794px; margin: 0 auto; background: #fff; border-radius: 16px; position: relative; overflow: hidden;
  box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 12px 40px rgba(0,0,0,.08); padding: 52px 56px 36px; }
.iv-sheet::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 6px; background: #c8ff00; }
.iv-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
.iv-brand { display: flex; align-items: center; gap: 10px; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: #0a0a0a; }
.iv-mark { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; background: #0a0a0a; }
.iv-mark svg { width: 17px; height: 20px; fill: #c8ff00; }
.iv-seller-line { margin-top: 8px; font-size: 12px; color: #71717a; letter-spacing: .02em; }
.iv-title { text-align: right; }
.iv-title h1 { margin: 0; font-size: 30px; line-height: 1.1; font-weight: 700; letter-spacing: -0.02em; color: #0a0a0a; }
.iv-no { margin-top: 6px; font-size: 13px; color: #52525b; font-variant-numeric: tabular-nums; }
.iv-paid { display: inline-block; margin-top: 10px; background: #c8ff00; color: #0a0a0a; font-size: 11px; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase; padding: 4px 10px; border-radius: 999px; }
.iv-meta { display: grid; grid-template-columns: repeat(4, 1fr); margin: 36px 0 0; border: 1px solid #e4e4e7; border-radius: 12px; overflow: hidden; }
.iv-meta > div { padding: 12px 16px; border-left: 1px solid #e4e4e7; }
.iv-meta > div:first-child { border-left: 0; }
.iv-meta dt, .iv-parties h2, .iv-words h2 { margin: 0 0 4px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #a1a1aa; }
.iv-meta dd { margin: 0; font-size: 14px; color: #18181b; }
.iv-strong { font-weight: 700; }
.iv-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .92em; letter-spacing: 0; }
.iv-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 32px; }
.iv-parties p { margin: 0; font-size: 13.5px; line-height: 1.6; color: #3f3f46; overflow-wrap: anywhere; }
.iv-parties .iv-name { font-size: 15px; font-weight: 600; color: #0a0a0a; margin-bottom: 2px; }
.iv-items { width: 100%; border-collapse: collapse; margin-top: 36px; font-size: 14px; }
.iv-items th { text-align: left; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #71717a;
  padding: 10px 0; border-bottom: 1.5px solid #0a0a0a; }
.iv-items td { padding: 16px 0; border-bottom: 1px solid #e4e4e7; vertical-align: top; }
.iv-items .iv-num { text-align: right; white-space: nowrap; padding-left: 16px; font-variant-numeric: tabular-nums; }
.iv-item { font-weight: 600; color: #0a0a0a; }
.iv-sub { margin-top: 3px; font-size: 12.5px; color: #71717a; line-height: 1.5; }
.iv-sum { display: flex; justify-content: space-between; align-items: flex-start; gap: 32px; margin-top: 20px; }
.iv-words { max-width: 320px; }
.iv-words p { margin: 0; font-size: 13px; line-height: 1.5; color: #3f3f46; }
.iv-totals { margin: 0; min-width: 280px; }
.iv-totals > div { display: flex; justify-content: space-between; gap: 24px; padding: 6px 0; font-size: 14px; color: #3f3f46; }
.iv-totals dt, .iv-totals dd { margin: 0; }
.iv-totals dd { font-variant-numeric: tabular-nums; }
.iv-totals .iv-total { margin-top: 8px; padding: 14px 16px; background: #0a0a0a; color: #fff; border-radius: 10px; font-size: 16px; font-weight: 700; }
.iv-totals .iv-total dd { color: #c8ff00; }
.iv-notes { margin-top: 36px; padding-top: 20px; border-top: 1px dashed #e4e4e7; }
.iv-notes p { margin: 0 0 6px; font-size: 12.5px; line-height: 1.6; color: #71717a; }
.iv-foot { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-top: 28px; padding-top: 16px;
  border-top: 1px solid #e4e4e7; font-size: 12px; color: #a1a1aa; }
@media (max-width: 640px) {
  .iv-sheet { padding: 36px 20px 24px; border-radius: 12px; }
  .iv-head { flex-direction: column; }
  .iv-title { text-align: left; }
  .iv-title h1 { font-size: 24px; }
  .iv-meta { grid-template-columns: 1fr 1fr; }
  .iv-meta > div:nth-child(3) { border-left: 0; }
  .iv-meta > div:nth-child(n+3) { border-top: 1px solid #e4e4e7; }
  .iv-parties { grid-template-columns: 1fr; gap: 20px; }
  .iv-items th:nth-child(2), .iv-items td:nth-child(2), .iv-items th:nth-child(3), .iv-items td:nth-child(3) { display: none; }
  .iv-sum { flex-direction: column-reverse; }
  .iv-totals { min-width: 0; width: 100%; }
}
@media print {
  @page { size: A4; margin: 12mm; }
  html, body { background: #fff !important; }
  .iv-page { background: #fff; padding: 0; min-height: 0; }
  .iv-bar { display: none !important; }
  .iv-sheet { max-width: none; box-shadow: none; border-radius: 0; padding: 18px 0 0; }
  .iv-sheet, .iv-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`
