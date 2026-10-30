import sql from '@/lib/db'

let ready: Promise<void> | null = null
/** The credit tables, made once per process (the same way billingSchema.ts makes the billing tables) */
export function ensureCreditsSchema(): Promise<void> {
  ready ??= (async () => {
    // Every batch of credits given. `remaining` goes down as they are spent; `source_ref` is unique,
    // so a payment or a monthly grant that is delivered twice gives credits once.
    await sql`
      CREATE TABLE IF NOT EXISTS credit_grants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('free', 'plan', 'topup', 'bonus', 'refund')),
        amount INTEGER NOT NULL CHECK (amount > 0),
        remaining INTEGER NOT NULL CHECK (remaining >= 0),
        expires_at TIMESTAMPTZ,
        source_ref TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`CREATE INDEX IF NOT EXISTS credit_grants_user_idx ON credit_grants (user_id, expires_at)`
    // Credits set aside while a job runs: held, then settled (kept) or released (given back)
    await sql`
      CREATE TABLE IF NOT EXISTS credit_holds (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL CHECK (amount > 0),
        ref_type TEXT NOT NULL,
        ref_id TEXT,
        job_id UUID,
        status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'settled', 'released')),
        allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
        shadow BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        settled_at TIMESTAMPTZ
      )`
    await sql`CREATE INDEX IF NOT EXISTS credit_holds_open_idx ON credit_holds (status, created_at) WHERE status = 'held'`
    await sql`CREATE INDEX IF NOT EXISTS credit_holds_user_idx ON credit_holds (user_id, created_at DESC)`
    // Everything that happened, in order. Rows are added, never edited or deleted.
    await sql`
      CREATE TABLE IF NOT EXISTS credit_ledger (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        ref_type TEXT,
        ref_id TEXT,
        hold_id UUID,
        grant_id UUID,
        shadow BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger (user_id, id DESC)`
    // Top-up orders we made at Razorpay: a payment is credited only for an order that is ours, for this user and pack
    await sql`
      CREATE TABLE IF NOT EXISTS topup_orders (
        order_id TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pack TEXT NOT NULL,
        credits INTEGER NOT NULL,
        amount_paise INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid')),
        payment_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        paid_at TIMESTAMPTZ
      )`
  })().catch(e => { ready = null; throw e })
  return ready
}
