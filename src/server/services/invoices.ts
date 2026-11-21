import type postgres from 'postgres'
import sql from '@/lib/db'
import { PLANS } from '@/lib/plans'
import { findTopupPack } from '@/lib/credits'
import { COMPANY } from '@/lib/company'
import { type PaidPayment, fetchRazorpayPayment, paidPayment } from '@/lib/razorpay'
import { splitTax, fiscalYear, formatInvoiceNo, formatReceiptNo, receiptCounterKey, normalizeGstin, GST_STATES, stateName } from '@/lib/invoice'
import { ensureBillingSchema } from '@/server/services/billingSchema'
import { sendReceiptEmail } from '@/modules/auth/mailer'
import { describePurchase } from '@/lib/purchase'
import { invoiceFileName, invoicePdf } from '@/server/services/invoicePdf'
import { queuePurchase } from '@/server/analytics'

/**
 * Who we invoice as. Set these for real GST invoices; without a GSTIN the paper says "Payment
 * receipt", not "Tax invoice" (a tax invoice must carry the seller's GSTIN).
 *   COMPANY_GSTIN, COMPANY_STATE_CODE (default: the first two digits of the GSTIN, else 36 Telangana),
 *   GST_RATE (default 18), INVOICE_SAC (the service's accounting code), COMPANY_ADDRESS (one line)
 */
export function sellerDetails() {
  const gstin = normalizeGstin(process.env.COMPANY_GSTIN)
  const stateCode = process.env.COMPANY_STATE_CODE || gstin?.slice(0, 2) || '36'
  const rate = process.env.GST_RATE !== undefined && process.env.GST_RATE !== '' ? Number(process.env.GST_RATE) : 18
  return {
    legalName: COMPANY.legalName,
    gstin,
    stateCode,
    state: stateName(stateCode),
    address: process.env.COMPANY_ADDRESS || COMPANY.address.join(', '),
    email: COMPANY.email,
    sac: process.env.INVOICE_SAC || null,
    gstRate: Number.isFinite(rate) && rate >= 0 ? rate : 18,
    taxInvoice: !!gstin,
  }
}

/** The seller as printed on an invoice, fixed when it is issued */
export interface SellerSnapshot { legalName: string; gstin: string | null; stateCode: string; address: string; email: string; sac: string | null; taxInvoice: boolean }
const sellerSnapshot = (s: ReturnType<typeof sellerDetails>): SellerSnapshot => ({
  legalName: s.legalName, gstin: s.gstin, stateCode: s.stateCode, address: s.address, email: s.email, sac: s.sac, taxInvoice: s.taxInvoice,
})

export type Customer = { name: string | null; email: string; gstin: string | null; stateCode: string | null; address: string | null }

export interface BillingDetails { name: string | null; gstin: string | null; stateCode: string | null; address: string | null }

export async function getBillingDetails(userId: string): Promise<BillingDetails> {
  await ensureBillingSchema()
  const [r] = await sql<{ name: string | null; gstin: string | null; state_code: string | null; address: string | null }[]>`
    SELECT name, gstin, state_code, address FROM billing_profiles WHERE user_id = ${userId}`
  return { name: r?.name ?? null, gstin: r?.gstin ?? null, stateCode: r?.state_code ?? null, address: r?.address ?? null }
}

/** What the customer wants on their next invoices (past invoices never change) */
export async function saveBillingDetails(userId: string, d: { name?: unknown; gstin?: unknown; stateCode?: unknown; address?: unknown }): Promise<BillingDetails> {
  await ensureBillingSchema()
  const clean = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const gstinRaw = clean(d.gstin, 40)
  const gstin = gstinRaw ? normalizeGstin(gstinRaw) : null
  if (gstinRaw && !gstin) throw Object.assign(new Error('That GSTIN is not valid: it is 15 letters and digits, like 36AABCS1234A1Z5.'), { status: 400, expose: true })
  const stateCode = clean(d.stateCode, 2)
  if (stateCode && !(stateCode in GST_STATES)) throw Object.assign(new Error('Choose a state from the list.'), { status: 400, expose: true })
  // A GSTIN's first two digits are its state: they must agree with the state chosen
  if (gstin && stateCode && gstin.slice(0, 2) !== stateCode) throw Object.assign(new Error('The GSTIN belongs to a different state than the one chosen.'), { status: 400, expose: true })
  const row = { name: clean(d.name, 120), gstin, stateCode: stateCode ?? gstin?.slice(0, 2) ?? null, address: clean(d.address, 300) }
  await sql`
    INSERT INTO billing_profiles (user_id, name, gstin, state_code, address) VALUES (${userId}, ${row.name}, ${row.gstin}, ${row.stateCode}, ${row.address})
    ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, gstin = EXCLUDED.gstin, state_code = EXCLUDED.state_code, address = EXCLUDED.address, updated_at = now()`
  return row
}

/**
 * Records a payment and issues its invoice (once: a payment id already recorded is left alone).
 * The invoice number, the customer's details and the tax are fixed here. Then the receipt is
 * emailed; a failed email never undoes the payment, and the invoice is on the billing page anyway.
 */
export async function recordPayment(userId: string, subscriptionId: string | null, plan: string, p: PaidPayment): Promise<string | null> {
  await ensureBillingSchema()
  const seller = sellerDetails()
  const paymentRowId = await sql.begin(async tx => {
    // Only for a subscription we started for this user
    if (subscriptionId) {
      const [own] = await tx`SELECT 1 FROM subscriptions WHERE razorpay_subscription_id = ${subscriptionId} AND user_id = ${userId}`
      if (!own) return null
    }
    const [dup] = await tx`SELECT id FROM payments WHERE razorpay_payment_id = ${p.id}`
    if (dup) return null
    const [u] = await tx<{ name: string | null; email: string; plan: string | null }[]>`SELECT name, email, plan FROM users WHERE id = ${userId}`
    // The saved company details go on the invoice only on Pro (and Agency, no longer sold) (plans.ts gstInvoices;
    // Agency only until 2026-11-21): a payment for that plan, or anything such an account buys (a top-up). Kept
    // details of an account that left it stay saved but unused.
    const details = !!(PLANS[plan as keyof typeof PLANS]?.gstInvoices || PLANS[u?.plan as keyof typeof PLANS]?.gstInvoices)
    const [bp] = details ? await tx<{ name: string | null; gstin: string | null; state_code: string | null; address: string | null }[]>`
      SELECT name, gstin, state_code, address FROM billing_profiles WHERE user_id = ${userId}` : []
    // Place of supply: the customer's state; when we do not know it, ours
    const placeOfSupply = bp?.state_code || seller.stateCode
    const tax = splitTax(p.amountPaise, seller.gstRate, placeOfSupply === seller.stateCode)
    const fy = fiscalYear(p.paidAt)
    // Its two papers (user, 2026-11-21): a receipt always (its own numbers), and a tax invoice when we have a GSTIN
    const receiptNo = formatReceiptNo(fy, await nextNumber(tx, receiptCounterKey(fy)))
    const invoiceNo = seller.taxInvoice ? formatInvoiceNo(fy, await nextNumber(tx, fy)) : null
    const customer: Customer = { name: bp?.name || u?.name || null, email: u?.email ?? '', gstin: bp?.gstin ?? null, stateCode: bp?.state_code ?? null, address: bp?.address ?? null }
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO payments (user_id, razorpay_payment_id, razorpay_subscription_id, plan, amount_paise, paid_at, invoice_no, receipt_no,
        gst_rate, taxable_paise, cgst_paise, sgst_paise, igst_paise, place_of_supply, customer, seller)
      VALUES (${userId}, ${p.id}, ${subscriptionId}, ${plan}, ${p.amountPaise}, ${p.paidAt}, ${invoiceNo}, ${receiptNo},
        ${seller.gstRate}, ${tax.taxablePaise}, ${tax.cgstPaise}, ${tax.sgstPaise}, ${tax.igstPaise}, ${placeOfSupply}, ${tx.json(customer as never)}, ${tx.json(sellerSnapshot(seller) as never)})
      RETURNING id`
    return row.id
  })
  if (paymentRowId) {
    await emailReceipt(paymentRowId).catch(e => console.error('[billing] receipt email failed:', e instanceof Error ? e.message : e))
    // Google Analytics: the purchase, once per payment like the invoice (server/analytics.ts; never throws)
    queuePurchase(userId, { transactionId: p.id, plan, itemName: PLANS[plan as keyof typeof PLANS]?.name ?? topupLabel(plan) ?? plan, amountPaise: p.amountPaise })
  }
  return paymentRowId
}

/** The next number of a series (billing_counters: an invoice's per financial year, a receipt's "R<fy>"): 1, 2, 3 … no gaps */
async function nextNumber(tx: postgres.TransactionSql, key: string): Promise<number> {
  const [c] = await tx<{ last: number }[]>`
    INSERT INTO billing_counters (fy, last) VALUES (${key}, 1)
    ON CONFLICT (fy) DO UPDATE SET last = billing_counters.last + 1 RETURNING last`
  return c.last
}

/**
 * Both papers for every payment (user, 2026-11-21: people opened "Invoice" and got a receipt). Once per copy of the
 * site, and safe to run on several at once (each payment is locked while it is given its numbers):
 *   - a payment paid before the GSTIN was set had one paper, a receipt, numbered in the invoice series: that number
 *     stays its receipt's, and it gets a tax invoice now (a new invoice number, dated the day it was paid, with
 *     the day it was made as "Issued on"), from the tax worked out when it was paid
 *   - one that already had a tax invoice gets a receipt number
 * Without a GSTIN (a test copy) only receipts are made; their invoices come once one is set.
 */
let docsReady: Promise<void> | null = null
/** For the tests: run the catch-up again */
export function forgetDocuments(): void { docsReady = null }
export function ensureDocuments(): Promise<void> {
  docsReady ??= (async () => {
    await ensureBillingSchema()
    // A paper that was a receipt: its number is the receipt's (no invoice yet)
    await sql`
      UPDATE payments SET receipt_no = invoice_no, invoice_no = NULL
      WHERE receipt_no IS NULL AND invoice_no IS NOT NULL AND COALESCE((seller->>'taxInvoice')::boolean, false) = false`
    const seller = sellerDetails()
    const missing = await sql<{ id: string }[]>`
      SELECT id FROM payments WHERE receipt_no IS NULL OR (invoice_no IS NULL AND ${seller.taxInvoice}) ORDER BY paid_at, id`
    for (const { id } of missing) {
      await sql.begin(async tx => {
        const [r] = await tx<{ paid_at: Date; receipt_no: string | null; invoice_no: string | null; seller: SellerSnapshot }[]>`
          SELECT paid_at, receipt_no, invoice_no, seller FROM payments WHERE id = ${id} FOR UPDATE`
        if (!r) return
        const fy = fiscalYear(r.paid_at)
        if (!r.receipt_no) {
          await tx`UPDATE payments SET receipt_no = ${formatReceiptNo(fy, await nextNumber(tx, receiptCounterKey(fy)))} WHERE id = ${id}`
        }
        if (!r.invoice_no && seller.taxInvoice) {
          // (the seller as we are now, with the GSTIN; the customer and the tax stay as they were when it was paid)
          const snap = { ...(r.seller ?? {}), ...sellerSnapshot(seller) }
          await tx`
            UPDATE payments SET invoice_no = ${formatInvoiceNo(fy, await nextNumber(tx, fy))}, invoice_issued_at = now(), seller = ${tx.json(snap as never)}
            WHERE id = ${id}`
        }
      })
    }
    if (missing.length) console.log(`[billing] papers made for ${missing.length} earlier payment(s)`)
  })().catch(e => { docsReady = null; throw e })
  return docsReady
}

/** After the checkout window: Razorpay's own record of the payment, so the invoice has the real amount */
export async function recordCheckoutPayment(userId: string, subscriptionId: string, plan: string, paymentId: string) {
  const remote = await fetchRazorpayPayment(paymentId)
  const paid = paidPayment({ ...remote, id: remote.id ?? paymentId })
  if (paid) await recordPayment(userId, subscriptionId, plan, paid)
}

/** "topup:medium" is stored as the plan of a credit top-up's payment; shown as "150 credits top-up" */
function topupLabel(plan: string): string | null {
  const pack = plan.startsWith('topup:') ? findTopupPack(plan.slice(6), { test: true }) : null
  if (pack?.key === 'trial') return `Trial pack, ${pack.credits} credits`
  return pack ? `${pack.credits} credits top-up` : null
}

export interface InvoiceRow {
  id: string; invoiceNo: string | null; plan: string; planName: string; amountPaise: number; paidAt: Date
  /** The receipt's number (every payment has one); invoiceNo is its tax invoice's (null: none yet, no GSTIN) */
  receiptNo: string | null
  /** When its invoice was made, if after the payment (see ensureDocuments) */
  invoiceIssuedAt: Date | null
  /** On one paper: the other one's name and number, to find it ("Tax invoice SC/…") */
  seeAlso?: string | null
  gstRate: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number
  placeOfSupply: string | null; customer: Customer; seller: SellerSnapshot; razorpayPaymentId: string
}

type DbRow = {
  id: string; invoice_no: string | null; plan: string; amount_paise: number; paid_at: Date; gst_rate: string
  taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; place_of_supply: string | null
  customer: Customer; seller: SellerSnapshot; razorpay_payment_id: string
  receipt_no: string | null; invoice_issued_at: Date | null
}
const toInvoice = (r: DbRow): InvoiceRow => ({
  id: r.id, invoiceNo: r.invoice_no, plan: r.plan, planName: PLANS[r.plan as keyof typeof PLANS]?.name ?? topupLabel(r.plan) ?? r.plan,
  amountPaise: r.amount_paise, paidAt: r.paid_at, gstRate: Number(r.gst_rate), taxablePaise: r.taxable_paise,
  cgstPaise: r.cgst_paise, sgstPaise: r.sgst_paise, igstPaise: r.igst_paise, placeOfSupply: r.place_of_supply,
  customer: r.customer, seller: r.seller, razorpayPaymentId: r.razorpay_payment_id,
  receiptNo: r.receipt_no ?? null, invoiceIssuedAt: r.invoice_issued_at ?? null,
})

export type PaperKind = 'receipt' | 'invoice'
/** The papers a payment has: its tax invoice once it has one, and its receipt */
export const papersOf = (inv: InvoiceRow): PaperKind[] => (inv.invoiceNo ? ['invoice', 'receipt'] : ['receipt'])

/**
 * One paper of a payment, as the sheet and the PDF draw it: a tax invoice (the GST lines, its invoice number) or a
 * receipt (what was paid, its receipt number). Null when it has no such paper.
 */
export function asPaper(inv: InvoiceRow, kind: PaperKind): InvoiceRow | null {
  if (kind === 'invoice') {
    if (!inv.invoiceNo) return null
    return { ...inv, seller: { ...inv.seller, taxInvoice: true }, seeAlso: inv.receiptNo ? `Receipt ${inv.receiptNo}` : null }
  }
  return { ...inv, invoiceNo: inv.receiptNo ?? inv.invoiceNo, invoiceIssuedAt: null, seller: { ...inv.seller, taxInvoice: false },
    seeAlso: inv.invoiceNo ? `Tax invoice ${inv.invoiceNo}` : null }
}

export async function listPayments(userId: string): Promise<InvoiceRow[]> {
  await ensureDocuments()
  const rows = await sql<DbRow[]>`SELECT * FROM payments WHERE user_id = ${userId} ORDER BY paid_at DESC LIMIT 200`
  return rows.map(toInvoice)
}

/** One invoice, only for the person it was issued to */
export async function getInvoice(userId: string, id: string): Promise<InvoiceRow | null> {
  await ensureDocuments()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const [r] = await sql<DbRow[]>`SELECT * FROM payments WHERE id = ${id} AND user_id = ${userId}`
  return r ? toInvoice(r) : null
}

async function emailReceipt(paymentRowId: string) {
  const [r] = await sql<(DbRow & { emailed_at: Date | null })[]>`SELECT * FROM payments WHERE id = ${paymentRowId}`
  if (!r || r.emailed_at || !r.customer?.email) return
  const inv = toInvoice(r)
  const purchase = describePurchase(inv.plan, inv.paidAt)
  // Its papers go with the email as PDFs, the tax invoice and the receipt; one that can't be made is left out (the
  // email links to the page)
  const pdfs = (await Promise.all(papersOf(inv).map(async kind => {
    const paper = asPaper(inv, kind)!
    return invoicePdf(paper, purchase)
      .then(content => ({ filename: invoiceFileName(paper), content }))
      .catch(e => { console.error(`[billing] ${kind} PDF failed:`, e instanceof Error ? e.message : e); return null })
  }))).filter((x): x is { filename: string; content: Uint8Array } => !!x)
  const main = asPaper(inv, papersOf(inv)[0])!
  await sendReceiptEmail({
    to: inv.customer.email, name: inv.customer.name, purchase, amountPaise: inv.amountPaise, pdfs,
    invoiceNo: main.invoiceNo, receiptNo: inv.invoiceNo ? inv.receiptNo : null, paidAt: inv.paidAt, paymentId: inv.razorpayPaymentId, invoiceId: inv.id, taxInvoice: !!main.seller?.taxInvoice,
  })
  await sql`UPDATE payments SET emailed_at = now() WHERE id = ${paymentRowId}`
}
