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
        kind TEXT NOT NULL CHECK (kind IN ('free', 'trial', 'plan', 'topup', 'bonus', 'refund')),
        amount INTEGER NOT NULL CHECK (amount > 0),
        remaining INTEGER NOT NULL CHECK (remaining >= 0),
        expires_at TIMESTAMPTZ,
        source_ref TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`CREATE INDEX IF NOT EXISTS credit_grants_user_idx ON credit_grants (user_id, expires_at)`
    // 'trial' (the Trial pack, 2026-11-16) on a table made before it: the kind check is made again once
    await sql`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_grants_kind_check'
                   AND pg_get_constraintdef(oid) NOT LIKE '%trial%') THEN
          ALTER TABLE credit_grants DROP CONSTRAINT credit_grants_kind_check;
          ALTER TABLE credit_grants ADD CONSTRAINT credit_grants_kind_check CHECK (kind IN ('free', 'trial', 'plan', 'topup', 'bonus', 'refund'));
        END IF;
      END $$`
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
    // A Make my clips run paid at the price with its clips' first export in it (user, 2026-11-21: 7 credits a
    // clip, no export credits asked again): export.ts freeExports. Runs before it stay false (paid 6, export paid)
    await sql`ALTER TABLE ai_edit_jobs ADD COLUMN IF NOT EXISTS export_included BOOLEAN NOT NULL DEFAULT false`
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
    // (2026-11-22) An order in dollars: amount_paise is then cents. Rows from before are rupees.
    await sql`ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR'`
  })().catch(e => { ready = null; throw e })
  return ready
}
