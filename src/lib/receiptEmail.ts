// The "Payment received" email (user, 2026-11-18: designed, and a one-time pack never reads like a
// monthly plan). Pure: builds the subject, HTML and plain text; mailer.ts sends them.
import { COMPANY } from './company'
import { amountInRupees } from './invoice'
import { type Purchase, renewalNote } from './purchase'

export interface ReceiptEmailInput {
  name: string | null
  purchase: Purchase
  amountPaise: number
  paidAt: Date
  invoiceNo: string | null
  /** The receipt's number, when the main paper is the tax invoice (both are sent: user, 2026-11-21) */
  receiptNo?: string | null
  paymentId: string
  invoiceId: string
  taxInvoice: boolean
  /** The site's address, no trailing slash (https://shortcutapp.in) */
  base: string
  /** The invoice / receipt goes with the email as a PDF (server/services/invoicePdf.ts) */
  attached?: boolean
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const day = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })

/** One line under "Payment received": what they have now */
function leadLine(p: Purchase): string {
  if (p.kind === 'subscription') return `Your ${p.name} is active.`
  if (p.kind === 'one-time' && p.validUntil) {
    return p.name === 'Trial pack'
      ? `Your Trial pack is ready: ${p.credits} credits to try everything until ${day(p.validUntil)}.`
      : `${p.credits?.toLocaleString('en-IN')} credits were added to your account. Use them until ${day(p.validUntil)}.`
  }
  return 'Your payment went through.'
}

export function receiptEmail(r: ReceiptEmailInput): { subject: string; html: string; text: string } {
  const p = r.purchase
  const amount = `₹${amountInRupees(r.amountPaise)}`
  const doc = r.taxInvoice ? (r.receiptNo ? 'tax invoice and receipt' : 'tax invoice') : 'receipt'
  const link = `${r.base}/billing/invoice/${r.invoiceId}`
  const hello = r.name ? `Hi ${r.name.split(/\s+/)[0]},` : 'Hi,'
  const lead = leadLine(p)
  const note = renewalNote(p)
  const rows: [string, string][] = [
    ['Paid on', day(r.paidAt)],
    ...(p.kind === 'subscription' ? [['Billing', 'Every month, until you cancel'] as [string, string]] : []),
    ...(p.kind === 'one-time' && p.validUntil ? [['Credits valid until', day(p.validUntil)] as [string, string]] : []),
    ...(r.invoiceNo ? [[r.taxInvoice ? 'Invoice no.' : 'Receipt no.', r.invoiceNo] as [string, string]] : []),
    ...(r.receiptNo ? [['Receipt no.', r.receiptNo] as [string, string]] : []),
    ['Payment ID', r.paymentId],
  ]
  const subject = `Payment received: ${p.name}, ${amount}`

  const row = ([k, v]: [string, string]) => `
              <tr>
                <td style="padding:7px 0;font-size:13px;color:#71717a;">${esc(k)}</td>
                <td align="right" style="padding:7px 0;font-size:13px;color:#18181b;font-weight:500;">${esc(v)}</td>
              </tr>`

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;">${esc(`${amount} paid for ${p.name}. ${lead}`)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;overflow:hidden;">
        <tr><td style="background:#0a0a0a;padding:20px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">
              <img src="${esc(r.base)}/apple-icon.png" width="28" height="28" alt="" style="display:inline-block;vertical-align:middle;border-radius:7px;border:0;">
              <span style="display:inline-block;vertical-align:middle;margin-left:8px;font-size:17px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">Shortcut</span>
            </td>
            <td align="right" style="vertical-align:middle;">
              <span style="display:inline-block;background:#c8ff00;color:#0a0a0a;font-size:11px;font-weight:700;letter-spacing:.08em;padding:5px 10px;border-radius:999px;">PAID</span>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:32px 28px 8px;">
          <p style="margin:0 0 6px;font-size:13px;color:#71717a;">${esc(hello)} thanks for your payment.</p>
          <h1 style="margin:0 0 10px;font-size:24px;line-height:1.25;font-weight:700;color:#0a0a0a;letter-spacing:-0.02em;">Payment received</h1>
          <p style="margin:0;font-size:15px;line-height:1.55;color:#3f3f46;">${esc(lead)}</p>
        </td></tr>
        <tr><td style="padding:20px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;">
            <tr><td style="padding:18px 20px 14px;border-bottom:1px solid #e4e4e7;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                <td style="vertical-align:top;">
                  <div style="font-size:15px;font-weight:600;color:#0a0a0a;">${esc(p.name)}</div>
                  ${p.detail ? `<div style="margin-top:3px;font-size:12.5px;color:#71717a;line-height:1.45;">${esc(p.detail)}</div>` : ''}
                </td>
                <td align="right" style="vertical-align:top;white-space:nowrap;padding-left:12px;font-size:20px;font-weight:700;color:#0a0a0a;">${esc(amount)}</td>
              </tr></table>
            </td></tr>
            <tr><td style="padding:8px 20px 10px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map(row).join('')}
              </table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px 28px 8px;">
          <a href="${esc(link)}" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;">View ${doc}</a>
          <span style="display:inline-block;margin-left:10px;font-size:12.5px;color:#71717a;">${r.attached ? (r.receiptNo ? `Your ${doc} are also attached as PDFs.` : `Your ${doc} is also attached as a PDF.`) : 'Print it or save it as a PDF from there.'}</span>
        </td></tr>
        <tr><td style="padding:16px 28px 28px;">
          ${note ? `<p style="margin:0 0 10px;font-size:13px;line-height:1.55;color:#52525b;">${esc(note)}</p>` : ''}
          <p style="margin:0;font-size:13px;line-height:1.55;color:#52525b;">Questions about this payment? Reply to this email or write to <a href="mailto:${esc(COMPANY.email)}" style="color:#0a0a0a;">${esc(COMPANY.email)}</a>.</p>
        </td></tr>
        <tr><td style="padding:16px 28px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:11.5px;line-height:1.6;color:#a1a1aa;">
          Shortcut is run by ${esc(COMPANY.legalName)}, ${esc(COMPANY.address.join(', '))}.<br>
          You got this email because you made a payment on Shortcut.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    `${hello} thanks for your payment.`,
    '',
    `Payment received: ${amount}`,
    lead,
    '',
    `${p.name}${p.detail ? ` (${p.detail})` : ''}`,
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `View your ${doc}: ${link}`,
    ...(r.attached ? [r.receiptNo ? `Your ${doc} are also attached to this email as PDFs.` : `Your ${doc} is also attached to this email as a PDF.`] : []),
    '',
    ...(note ? [note] : []),
    `Questions? Reply to this email or write to ${COMPANY.email}.`,
    '',
    `${COMPANY.legalName}, ${COMPANY.address.join(', ')}`,
  ].join('\n')

  return { subject, html, text }
}
