import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

// Every payment has a tax invoice and a receipt (user, 2026-11-21: "Invoice" opened a receipt). Earlier payments get
// the paper they were missing. Real Postgres:
//   DATABASE_URL=… npx tsx --test src/server/services/invoicePapers.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }
const GSTIN = '36AABCS1234A1Z5'

let sql: typeof import('@/lib/db').default
let invoices: typeof import('./invoices')
const users: string[] = []
const fy = '2026-27'

async function user() {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, name, plan) VALUES (${`papers-${Math.random().toString(36).slice(2)}@example.test`}, 'Asha Rao', 'starter') RETURNING id`
  users.push(u.id)
  return u.id
}
/** A payment as an earlier version saved it: one paper, a receipt (no GSTIN then) or a tax invoice, numbered in the invoice series */
async function oldPayment(userId: string, invoiceNo: string, taxInvoice: boolean, paidAt = '2026-11-10T10:00:00+05:30') {
  const seller = { legalName: 'Shortcut Labs', gstin: taxInvoice ? GSTIN : null, stateCode: '36', address: 'Hyderabad', email: 'hi@x', sac: null, taxInvoice }
  const [r] = await sql<{ id: string }[]>`
    INSERT INTO payments (user_id, razorpay_payment_id, plan, amount_paise, paid_at, invoice_no, gst_rate, taxable_paise, cgst_paise, sgst_paise, igst_paise, place_of_supply, customer, seller)
    VALUES (${userId}, ${`pay_old_${Math.random().toString(36).slice(2)}`}, 'starter', 59900, ${paidAt}, ${invoiceNo}, 18, 50763, 4568, 4569, 0, '36',
      ${sql.json({ name: 'Asha Rao', email: 'a@x', gstin: null, stateCode: null, address: null } as never)}, ${sql.json(seller as never)}) RETURNING id`
  return r.id
}
const row = async (id: string) => (await sql<{ invoice_no: string | null; receipt_no: string | null; invoice_issued_at: Date | null; seller: { gstin: string | null; taxInvoice: boolean } }[]>`
  SELECT invoice_no, receipt_no, invoice_issued_at, seller FROM payments WHERE id = ${id}`)[0]

before(async () => {
  if (!HAS_DB) return
  Object.assign(process.env, { COMPANY_GSTIN: GSTIN })
  sql = (await import('@/lib/db')).default
  await sql`CREATE TABLE IF NOT EXISTS users (id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, name TEXT, email TEXT NOT NULL)`
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free'`
  await sql`CREATE TABLE IF NOT EXISTS subscriptions (id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id UUID, plan TEXT, status TEXT)`
  invoices = await import('./invoices')
  await (await import('./billingSchema')).ensureBillingSchema()
})
after(async () => {
  if (!HAS_DB) return
  if (users.length) {
    await sql`DELETE FROM payments WHERE user_id = ANY(${users})`
    await sql`DELETE FROM users WHERE id = ANY(${users})`
  }
  await sql.end({ timeout: 2 })
})

test('earlier payments get the paper they were missing: a receipt keeps its number and gets a tax invoice; a tax invoice gets a receipt', opts, async () => {
  await sql`DELETE FROM billing_counters WHERE fy IN (${fy}, ${`R${fy}`})`
  await sql`INSERT INTO billing_counters (fy, last) VALUES (${fy}, 2)`
  const u = await user()
  const wasReceipt = await oldPayment(u, `SC/${fy}/000001`, false, '2026-11-05T10:00:00+05:30')
  const wasInvoice = await oldPayment(u, `SC/${fy}/000002`, true, '2026-11-06T10:00:00+05:30')
  invoices.forgetDocuments()
  await invoices.ensureDocuments()
  const a = await row(wasReceipt), b = await row(wasInvoice)
  assert.equal(a.receipt_no, `SC/${fy}/000001`, 'the number printed on its receipt stays the receipt\'s')
  assert.equal(a.invoice_no, `SC/${fy}/000003`, 'a new invoice number, after the ones used')
  assert.ok(a.invoice_issued_at, 'made now: "Issued on"')
  assert.equal(a.seller.gstin, GSTIN); assert.equal(a.seller.taxInvoice, true)
  assert.equal(b.invoice_no, `SC/${fy}/000002`, 'its tax invoice is untouched')
  assert.equal(b.receipt_no, `SC-R/${fy}/000001`)
  assert.equal(b.invoice_issued_at, null)
  // again (another copy of the site, or a restart): nothing changes
  invoices.forgetDocuments()
  await invoices.ensureDocuments()
  assert.deepEqual(await row(wasReceipt), a); assert.deepEqual(await row(wasInvoice), b)
})

test('without a GSTIN (a test copy) only receipts are made; the invoice comes once one is set', opts, async () => {
  const u = await user()
  const id = await oldPayment(u, `SC/${fy}/900001`, false)
  delete process.env.COMPANY_GSTIN
  try {
    invoices.forgetDocuments()
    await invoices.ensureDocuments()
    const r = await row(id)
    assert.equal(r.receipt_no, `SC/${fy}/900001`); assert.equal(r.invoice_no, null)
    const [inv] = await invoices.listPayments(u)
    assert.deepEqual(invoices.papersOf(inv), ['receipt'])
  } finally { process.env.COMPANY_GSTIN = GSTIN }
  invoices.forgetDocuments()
  await invoices.ensureDocuments()
  assert.ok((await row(id)).invoice_no?.startsWith(`SC/${fy}/`))
})

test('a new payment gets both papers at once: a receipt number and a tax invoice number', opts, async () => {
  const u = await user()
  const id = await invoices.recordPayment(u, null, 'topup:medium', { id: `pay_new_${Math.random().toString(36).slice(2)}`, amountPaise: 48900, paidAt: new Date() } as never)
  assert.ok(id)
  const r = await row(id!)
  assert.match(r.receipt_no ?? '', /^SC-R\/\d{4}-\d{2}\/\d{6}$/)
  assert.match(r.invoice_no ?? '', /^SC\/\d{4}-\d{2}\/\d{6}$/)
  assert.equal(r.invoice_issued_at, null)
})

test('each paper reads as itself, points to the other, and makes its own PDF', opts, async () => {
  const u = await user()
  const id = await oldPayment(u, `SC/${fy}/800001`, false)
  invoices.forgetDocuments()
  const inv = (await invoices.getInvoice(u, id))!
  assert.deepEqual(invoices.papersOf(inv), ['invoice', 'receipt'])
  const invoice = invoices.asPaper(inv, 'invoice')!, receipt = invoices.asPaper(inv, 'receipt')!
  assert.equal(invoice.seller.taxInvoice, true); assert.equal(invoice.invoiceNo, inv.invoiceNo); assert.equal(invoice.seeAlso, `Receipt SC/${fy}/800001`)
  assert.equal(receipt.seller.taxInvoice, false); assert.equal(receipt.invoiceNo, `SC/${fy}/800001`); assert.equal(receipt.seeAlso, `Tax invoice ${inv.invoiceNo}`)
  assert.equal(receipt.invoiceIssuedAt, null)
  const { invoicePdf, invoiceFileName } = await import('./invoicePdf')
  const { describePurchase } = await import('@/lib/purchase')
  for (const p of [invoice, receipt]) {
    const bytes = await invoicePdf(p, describePurchase(inv.plan, inv.paidAt))
    assert.equal(Buffer.from(bytes.slice(0, 4)).toString(), '%PDF')
  }
  assert.match(invoiceFileName(invoice), /^Shortcut-invoice-SC-/)
  assert.match(invoiceFileName(receipt), /^Shortcut-receipt-SC-/)
  // someone else's payment: nothing
  assert.equal(await invoices.getInvoice(await user(), id), null)
})

test('the payment email names both numbers and says both PDFs are attached', async () => {
  const { receiptEmail } = await import('@/lib/receiptEmail')
  const { describePurchase } = await import('@/lib/purchase')
  const paidAt = new Date('2026-11-21T10:00:00+05:30')
  const m = receiptEmail({ base: 'https://x', name: 'Asha', purchase: describePurchase('starter', paidAt), amountPaise: 59900, paidAt,
    invoiceNo: 'SC/2026-27/000009', receiptNo: 'SC-R/2026-27/000004', paymentId: 'pay_1', invoiceId: 'id1', taxInvoice: true, attached: true })
  assert.match(m.text, /SC\/2026-27\/000009/); assert.match(m.text, /SC-R\/2026-27\/000004/)
  assert.match(m.text, /tax invoice and receipt are also attached to this email as PDFs/)
})
