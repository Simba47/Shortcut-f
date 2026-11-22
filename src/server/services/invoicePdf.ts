import fs from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { InvoiceRow } from '@/server/services/invoices'
import { type Purchase, renewalNote } from '@/lib/purchase'
import { COMPANY } from '@/lib/company'
import { amountInWords, stateName } from '@/lib/invoice'
import { formatMoney } from '@/lib/currency'

// The invoice / receipt as an A4 PDF, attached to the "Payment received" email (user, 2026-11-18).
// Drawn to look like the page (app/billing/invoice/[id]/InvoiceSheet.tsx): keep the two in step.

/** "Shortcut-receipt-SC-2026-27-000012.pdf" */
export function invoiceFileName(inv: InvoiceRow): string {
  const kind = inv.seller?.taxInvoice ? 'invoice' : 'receipt'
  return `Shortcut-${kind}-${(inv.invoiceNo ?? inv.razorpayPaymentId ?? inv.id).replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`
}

// Inter Tight, the site's own font (app/layout.tsx; SIL Open Font License, server/fonts/OFL.txt): it has the ₹ sign, the PDF's built-in fonts don't.
// The files are already cut down to Latin + ₹ and punctuation, with no letter-swapping features (fontTools subset
// --layout-features=''), and are embedded whole: pdf-lib's own subsetting drops most of Inter's letters, and Inter's
// swaps turned "2026-27" and "(36)" into other shapes. ~24 KB each.
let fonts: Promise<[Uint8Array, Uint8Array, Uint8Array]> | null = null
const fontBytes = () => fonts ??= Promise.all(['InterTight-Regular.ttf', 'InterTight-SemiBold.ttf', 'InterTight-Bold.ttf'].map(f =>
  fs.readFile(path.join(process.cwd(), 'src/server/fonts', f)).then(b => new Uint8Array(b)))) as Promise<[Uint8Array, Uint8Array, Uint8Array]>

// The Shortcut mark (components/ui/brand-logo.tsx), 102 × 118, drawn lime on a black tile like the app icon (public/apple-icon.png)
const MARK_TOP = 'M36 2H92Q98 2 94 6L34 66A32 32 0 0 1 36 2Z'
const MARK_BOTTOM = 'M66 116H10Q4 116 8 112L68 52A32 32 0 0 1 66 116Z'

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)
const C = { ink: hex('#0a0a0a'), body: hex('#3f3f46'), muted: hex('#71717a'), faint: hex('#a1a1aa'), rule: hex('#e4e4e7'), lime: hex('#c8ff00'), white: hex('#ffffff') }
const day = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })

export async function invoicePdf(inv: InvoiceRow, purchase: Purchase): Promise<Uint8Array> {
  const s = inv.seller
  const taxed = !!s?.taxInvoice
  const title = taxed ? 'Tax invoice' : 'Receipt'
  const money = (p: number) => formatMoney(p, inv.currency, { cents: true })
  // A payment in dollars: an export of services under the LUT, no GST (2026-11-22)
  const exported = inv.currency !== 'INR'
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const [regBytes, semiBytes, heavyBytes] = await fontBytes()
  const reg = await pdf.embedFont(regBytes, { subset: false })
  const bold = await pdf.embedFont(semiBytes, { subset: false })
  const heavy = await pdf.embedFont(heavyBytes, { subset: false })
  pdf.setTitle(`${title} ${inv.invoiceNo ?? ''}`.trim())
  pdf.setAuthor(s?.legalName ?? COMPANY.legalName)
  pdf.setCreator('Shortcut'); pdf.setProducer('Shortcut')

  const PW = 595.28, PH = 841.89, M = 48, W = PW - 2 * M
  const page: PDFPage = pdf.addPage([PW, PH])
  const text = (t: string, x: number, y: number, size: number, font: PDFFont = reg, color = C.body) => page.drawText(t, { x, y, size, font, color })
  const right = (t: string, xr: number, y: number, size: number, font: PDFFont = reg, color = C.body) => text(t, xr - font.widthOfTextAtSize(t, size), y, size, font, color)
  const label = (t: string, x: number, y: number) => text(t.toUpperCase(), x, y, 7, bold, C.faint)
  const wrap = (t: string, size: number, width: number, font: PDFFont = reg) => {
    const out: string[] = []; let line = ''
    for (const word of t.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word
      if (line && font.widthOfTextAtSize(next, size) > width) { out.push(line); line = word } else line = next
    }
    if (line) out.push(line)
    return out
  }
  /** A rounded box; (x, y) its bottom-left */
  const box = (x: number, y: number, w: number, h: number, r: number, o: { fill?: RGB; border?: RGB }) => {
    const p = `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`
    page.drawSvgPath(p, { x, y: y + h, color: o.fill, borderColor: o.border, borderWidth: o.border ? 0.75 : 0 })
  }

  // Lime band at the top
  page.drawRectangle({ x: 0, y: PH - 6, width: PW, height: 6, color: C.lime })
  let y = PH - M - 4

  // Head: the logo (the app icon: a lime mark on a black tile) + Shortcut, the seller under it | the title, number, PAID
  const T = 24, sc = 15 / 118
  box(M, y - T + 2, T, T, 6, { fill: C.ink })
  const mx = M + (T - 102 * sc) / 2, my = y + 2 - (T - 118 * sc) / 2
  page.drawSvgPath(MARK_TOP, { x: mx, y: my, scale: sc, color: C.lime })
  page.drawSvgPath(MARK_BOTTOM, { x: mx, y: my, scale: sc, color: C.lime })
  text('Shortcut', M + T + 8, y - 16, 17, heavy, C.ink)
  text((s?.legalName ?? COMPANY.legalName).toUpperCase(), M, y - 34, 7.5, reg, C.muted)
  right(title, M + W, y - 18, 22, heavy, C.ink)
  right(inv.invoiceNo ?? '—', M + W, y - 34, 9, reg, C.muted)
  const pill = 'PAID', pw = bold.widthOfTextAtSize(pill, 7.5) + 16
  box(M + W - pw, y - 58, pw, 15, 7.5, { fill: C.lime })
  text(pill, M + W - pw + 8, y - 53.2, 7.5, bold, C.ink)
  y -= 84

  // Summary row: number | date | paid by | amount
  const meta: [string, string, boolean][] = [
    [taxed ? 'Invoice no.' : 'Receipt no.', inv.invoiceNo ?? '—', false],
    ['Date paid', day(inv.paidAt), false],
    ['Paid by', 'Online · Razorpay', false],
    ['Amount paid', money(inv.amountPaise), true],
  ]
  const mh = 44, cw = W / 4
  box(M, y - mh, W, mh, 8, { border: C.rule })
  meta.forEach(([k, v, strong], i) => {
    const x = M + i * cw
    if (i) page.drawLine({ start: { x, y }, end: { x, y: y - mh }, thickness: 0.75, color: C.rule })
    label(k, x + 12, y - 16)
    text(v, x + 12, y - 32, 9.5, strong ? bold : reg, C.ink)
  })
  y -= mh + 30

  // From | Billed to
  const colW = W / 2 - 16
  const party = (head: string, rows: string[], x: number) => {
    let yy = y
    label(head, x, yy); yy -= 16
    rows.forEach((r, i) => {
      for (const l of wrap(r, i === 0 ? 10.5 : 9.5, colW, i === 0 ? bold : reg)) { text(l, x, yy, i === 0 ? 10.5 : 9.5, i === 0 ? bold : reg, i === 0 ? C.ink : C.body); yy -= i === 0 ? 16 : 14 }
    })
    return yy
  }
  const c = inv.customer
  const from = [s?.legalName ?? COMPANY.legalName, s?.address ?? COMPANY.address.join(', '),
    ...(s?.gstin ? [`GSTIN ${s.gstin}`] : []), ...(s?.stateCode ? [`State: ${stateName(s.stateCode)} (${s.stateCode})`] : []), s?.email ?? COMPANY.email]
  const to = [c.name || c.email, ...(c.name ? [c.email] : []), ...(c.address ? [c.address] : []), ...(c.gstin ? [`GSTIN ${c.gstin}`] : []),
    ...(inv.placeOfSupply ? [`Place of supply: ${stateName(inv.placeOfSupply)} (${inv.placeOfSupply})`] : [])]
  y = Math.min(party('From', from, M), party('Billed to', to, M + W / 2 + 16)) - 20

  // The item
  const cQty = M + W - 170, cPrice = M + W - 85, cAmt = M + W
  label('Item', M, y); right('QTY', cQty, y, 7, bold, C.faint); right('PRICE', cPrice, y, 7, bold, C.faint); right('AMOUNT', cAmt, y, 7, bold, C.faint)
  y -= 8
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 1.2, color: C.ink })
  y -= 20
  const linePrice = money(taxed ? inv.taxablePaise : inv.amountPaise)
  text(purchase.name, M, y, 10.5, bold, C.ink)
  right('1', cQty, y, 10, reg, C.ink); right(linePrice, cPrice, y, 10, reg, C.ink); right(linePrice, cAmt, y, 10, reg, C.ink)
  const subs = [purchase.detail, ...(purchase.kind === 'one-time' && purchase.validUntil ? [`Credits valid until ${day(purchase.validUntil)}`] : []),
    ...(taxed && s?.sac ? [`SAC ${s.sac}`] : [])].filter(Boolean)
  for (const sub of subs) for (const l of wrap(sub, 8.5, W - 220)) { y -= 13; text(l, M, y, 8.5, reg, C.muted) }
  y -= 14
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.75, color: C.rule })
  y -= 22

  // Amount in words | the totals
  const top = y
  label('Amount in words', M, y)
  let wy = y - 14
  for (const l of wrap(amountInWords(inv.amountPaise, inv.currency), 9.5, W / 2 - 20)) { text(l, M, wy, 9.5, reg, C.body); wy -= 14 }
  const tx = M + W - 210
  const rows: [string, string][] = taxed
    ? [['Taxable value', money(inv.taxablePaise)],
      ...(inv.cgstPaise > 0 ? [[`CGST @ ${inv.gstRate / 2}%`, money(inv.cgstPaise)] as [string, string], [`SGST @ ${inv.gstRate / 2}%`, money(inv.sgstPaise)] as [string, string]] : []),
      ...(inv.igstPaise > 0 ? [[`IGST @ ${inv.gstRate}%`, money(inv.igstPaise)] as [string, string]] : [])]
    : [['Subtotal', money(inv.amountPaise)]]
  let ty = top + 2
  for (const [k, v] of rows) { text(k, tx, ty - 8, 9.5, reg, C.body); right(v, M + W, ty - 8, 9.5, reg, C.body); ty -= 19 }
  box(tx, ty - 34, 210, 32, 7, { fill: C.ink })
  text('Total paid', tx + 12, ty - 22, 11, heavy, C.white)
  right(money(inv.amountPaise), M + W - 12, ty - 22, 11, heavy, C.lime)
  y = Math.min(wy, ty - 34) - 26

  // Notes
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.75, color: C.rule, dashArray: [3, 3] })
  y -= 18
  const note = renewalNote(purchase)
  const notes = [...(note ? [note] : []), `Payment ID ${inv.razorpayPaymentId}${taxed && !exported ? ' · The price includes GST.' : ''}`,
    ...(exported && taxed ? [`Supply meant for export under LUT without payment of IGST${s?.lut ? ` (LUT ARN ${s.lut})` : ''}.`] : []),
    // (an invoice made after the payment, for one paid before we had a GSTIN: when it was made; and the other paper)
    ...(taxed && inv.invoiceIssuedAt ? [`Issued on ${day(new Date(inv.invoiceIssuedAt))}.`] : []),
    ...(inv.seeAlso ? [`For this payment there is also: ${inv.seeAlso}`] : []),
    `This is a computer-generated ${taxed ? 'invoice' : 'receipt'} and needs no signature.`]
  for (const n of notes) for (const l of wrap(n, 8.5, W)) { text(l, M, y, 8.5, reg, C.muted); y -= 13 }

  // Footer, at the foot of the page
  const fy = M - 6
  page.drawLine({ start: { x: M, y: fy + 14 }, end: { x: M + W, y: fy + 14 }, thickness: 0.75, color: C.rule })
  text('Thank you for choosing Shortcut.', M, fy, 8, reg, C.faint)
  right(COMPANY.email, M + W, fy, 8, reg, C.faint)

  return pdf.save()
}
