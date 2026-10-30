import sql from '@/lib/db'

let ready: Promise<void> | null = null
/** The billing tables, made once per process (the same way the worker adds its own columns) */
export function ensureBillingSchema(): Promise<void> {
  ready ??= (async () => {
    await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT`
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_razorpay_sub_uq ON subscriptions (razorpay_subscription_id) WHERE razorpay_subscription_id IS NOT NULL`
    await sql`
      CREATE TABLE IF NOT EXISTS billing_plans (
        plan TEXT NOT NULL, amount_paise INTEGER NOT NULL, razorpay_plan_id TEXT NOT NULL,
        PRIMARY KEY (plan, amount_paise)
      )`
    // One row per webhook event handled: a delivery Razorpay repeats is recognised and skipped
    await sql`
      CREATE TABLE IF NOT EXISTS billing_events (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    // Every payment taken, with its invoice: the customer's details and the tax are kept as they
    // were when it was issued, so an invoice never changes afterwards
    await sql`
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        -- kept when the account is deleted (tax records): the link is cleared, the customer's details stay on the row
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        razorpay_payment_id TEXT NOT NULL UNIQUE,
        razorpay_subscription_id TEXT,
        plan TEXT NOT NULL,
        amount_paise INTEGER NOT NULL,
        paid_at TIMESTAMPTZ NOT NULL,
        invoice_no TEXT UNIQUE,
        gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
        taxable_paise INTEGER NOT NULL DEFAULT 0,
        cgst_paise INTEGER NOT NULL DEFAULT 0,
        sgst_paise INTEGER NOT NULL DEFAULT 0,
        igst_paise INTEGER NOT NULL DEFAULT 0,
        place_of_supply TEXT,
        customer JSONB NOT NULL DEFAULT '{}'::jsonb,
        seller JSONB NOT NULL DEFAULT '{}'::jsonb,
        emailed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`CREATE INDEX IF NOT EXISTS payments_user_idx ON payments (user_id, paid_at DESC)`
    // The last invoice number of each financial year (numbers run 1, 2, 3 … with no gaps)
    await sql`CREATE TABLE IF NOT EXISTS billing_counters (fy TEXT PRIMARY KEY, last INTEGER NOT NULL)`
    // What a customer wants on their invoices
    await sql`
      CREATE TABLE IF NOT EXISTS billing_profiles (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        name TEXT, gstin TEXT, state_code TEXT, address TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
  })().catch(e => { ready = null; throw e })
  return ready
}

