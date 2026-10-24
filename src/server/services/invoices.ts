import sql from '@/lib/db'
import { PLANS } from '@/lib/plans'
import { COMPANY } from '@/lib/company'
import { type PaidPayment, fetchRazorpayPayment, paidPayment } from '@/lib/razorpay'
import { splitTax, fiscalYear, formatInvoiceNo, normalizeGstin, GST_STATES, stateName } from '@/lib/invoice'
import { ensureBillingSchema } from '@/server/services/billingSchema'
import { sendReceiptEmail } from '@/modules/auth/mailer'

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
    const [u] = await tx<{ name: string | null; email: string }[]>`SELECT name, email FROM users WHERE id = ${userId}`
    const [bp] = await tx<{ name: string | null; gstin: string | null; state_code: string | null; address: string | null }[]>`
      SELECT name, gstin, state_code, address FROM billing_profiles WHERE user_id = ${userId}`
    // Place of supply: the customer's state; when we do not know it, ours
    const placeOfSupply = bp?.state_code || seller.stateCode
    const tax = splitTax(p.amountPaise, seller.gstRate, placeOfSupply === seller.stateCode)
    const fy = fiscalYear(p.paidAt)
    const [counter] = await tx<{ last: number }[]>`
      INSERT INTO billing_counters (fy, last) VALUES (${fy}, 1)
      ON CONFLICT (fy) DO UPDATE SET last = billing_counters.last + 1 RETURNING last`
    const customer: Customer = { name: bp?.name || u?.name || null, email: u?.email ?? '', gstin: bp?.gstin ?? null, stateCode: bp?.state_code ?? null, address: bp?.address ?? null }
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO payments (user_id, razorpay_payment_id, razorpay_subscription_id, plan, amount_paise, paid_at, invoice_no,
        gst_rate, taxable_paise, cgst_paise, sgst_paise, igst_paise, place_of_supply, customer, seller)
      VALUES (${userId}, ${p.id}, ${subscriptionId}, ${plan}, ${p.amountPaise}, ${p.paidAt}, ${formatInvoiceNo(fy, counter.last)},
        ${seller.gstRate}, ${tax.taxablePaise}, ${tax.cgstPaise}, ${tax.sgstPaise}, ${tax.igstPaise}, ${placeOfSupply}, ${tx.json(customer as never)}, ${tx.json(sellerSnapshot(seller) as never)})
      RETURNING id`
    return row.id
  })
  if (paymentRowId) {
    await emailReceipt(paymentRowId).catch(e => console.error('[billing] receipt email failed:', e instanceof Error ? e.message : e))
  }
  return paymentRowId
}

/** After the checkout window: Razorpay's own record of the payment, so the invoice has the real amount */
export async function recordCheckoutPayment(userId: string, subscriptionId: string, plan: string, paymentId: string) {
  const remote = await fetchRazorpayPayment(paymentId)
  const paid = paidPayment({ ...remote, id: remote.id ?? paymentId })
  if (paid) await recordPayment(userId, subscriptionId, plan, paid)
}

export interface InvoiceRow {
  id: string; invoiceNo: string | null; plan: string; planName: string; amountPaise: number; paidAt: Date
  gstRate: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number
  placeOfSupply: string | null; customer: Customer; seller: SellerSnapshot; razorpayPaymentId: string
}

type DbRow = {
  id: string; invoice_no: string | null; plan: string; amount_paise: number; paid_at: Date; gst_rate: string
  taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; place_of_supply: string | null
  customer: Customer; seller: SellerSnapshot; razorpay_payment_id: string
}
const toInvoice = (r: DbRow): InvoiceRow => ({
  id: r.id, invoiceNo: r.invoice_no, plan: r.plan, planName: PLANS[r.plan as keyof typeof PLANS]?.name ?? r.plan,
  amountPaise: r.amount_paise, paidAt: r.paid_at, gstRate: Number(r.gst_rate), taxablePaise: r.taxable_paise,
  cgstPaise: r.cgst_paise, sgstPaise: r.sgst_paise, igstPaise: r.igst_paise, placeOfSupply: r.place_of_supply,
  customer: r.customer, seller: r.seller, razorpayPaymentId: r.razorpay_payment_id,
})

export async function listPayments(userId: string): Promise<InvoiceRow[]> {
  await ensureBillingSchema()
  const rows = await sql<DbRow[]>`SELECT * FROM payments WHERE user_id = ${userId} ORDER BY paid_at DESC LIMIT 200`
  return rows.map(toInvoice)
}

/** One invoice, only for the person it was issued to */
export async function getInvoice(userId: string, id: string): Promise<InvoiceRow | null> {
  await ensureBillingSchema()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const [r] = await sql<DbRow[]>`SELECT * FROM payments WHERE id = ${id} AND user_id = ${userId}`
  return r ? toInvoice(r) : null
}

async function emailReceipt(paymentRowId: string) {
  const [r] = await sql<(DbRow & { emailed_at: Date | null })[]>`SELECT * FROM payments WHERE id = ${paymentRowId}`
  if (!r || r.emailed_at || !r.customer?.email) return
  const inv = toInvoice(r)
  await sendReceiptEmail({
    to: inv.customer.email, name: inv.customer.name, planName: inv.planName, amountPaise: inv.amountPaise,
    invoiceNo: inv.invoiceNo, paidAt: inv.paidAt, invoiceId: inv.id, taxInvoice: !!inv.seller?.taxInvoice,
  })
  await sql`UPDATE payments SET emailed_at = now() WHERE id = ${paymentRowId}`
}
