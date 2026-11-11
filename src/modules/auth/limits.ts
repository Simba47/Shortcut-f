import sql from '@/lib/db'

// Limits on guessing passwords and on sending login codes, kept in the database so every copy of
// the website counts the same. A wrong password locks that email for LOCK_MINUTES after
// FAILS_PER_EMAIL tries, and an address is stopped after FAILS_PER_IP (one address trying many
// emails). A code goes to an email at most once a minute and CODES_PER_EMAIL_DAY times a day,
// and one address sends at most CODES_PER_IP_HOUR an hour, so nobody can flood an inbox or use
// up the email service.

const LOCK_MINUTES = 15
const FAILS_PER_EMAIL = 10
const FAILS_PER_IP = 50
const CODE_GAP_SECONDS = 60
const CODES_PER_EMAIL_DAY = 10
const CODES_PER_IP_HOUR = 20

let ready: Promise<void> | null = null
export function ensureLimitsSchema(): Promise<void> {
  ready ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS auth_events (
        id BIGSERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        email TEXT NOT NULL,
        ip TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`CREATE INDEX IF NOT EXISTS auth_events_email_idx ON auth_events (kind, email, created_at DESC)`
    await sql`CREATE INDEX IF NOT EXISTS auth_events_ip_idx ON auth_events (kind, ip, created_at DESC)`
  })().catch(e => { ready = null; throw e })
  return ready
}

/** The visitor's address, as Railway's proxy passes it on */
export function clientIp(headers: Headers | null | undefined): string {
  return headers?.get('x-forwarded-for')?.split(',')[0]?.trim() || headers?.get('x-real-ip') || 'unknown'
}

const norm = (email: string) => email.toLowerCase().trim()

/** Too many wrong passwords lately, for this email or from this address */
export async function loginLocked(email: string, ip: string): Promise<boolean> {
  await ensureLimitsSchema()
  const [r] = await sql<{ e: number; i: number }[]>`
    SELECT
      count(*) FILTER (WHERE email = ${norm(email)})::int AS e,
      count(*) FILTER (WHERE ip = ${ip})::int AS i
    FROM auth_events WHERE kind = 'fail' AND created_at > now() - make_interval(mins => ${LOCK_MINUTES})
      AND (email = ${norm(email)} OR ip = ${ip})`
  return r.e >= FAILS_PER_EMAIL || r.i >= FAILS_PER_IP
}

export async function recordLoginFailure(email: string, ip: string): Promise<void> {
  await ensureLimitsSchema()
  await sql`INSERT INTO auth_events (kind, email, ip) VALUES ('fail', ${norm(email)}, ${ip})`
}

/** A right password: that email's wrong tries are forgotten */
export async function clearLoginFailures(email: string): Promise<void> {
  await ensureLimitsSchema()
  await sql`DELETE FROM auth_events WHERE kind = 'fail' AND email = ${norm(email)}`
}

const tooMany = (message: string) => Object.assign(new Error(message), { status: 429 })

/** May a code be sent to this email now? Counted when allowed; 429 when not */
export async function allowCodeSend(email: string, ip: string): Promise<void> {
  await ensureLimitsSchema()
  const e = norm(email)
  const [r] = await sql<{ gap: number; day: number; hour: number }[]>`
    SELECT
      count(*) FILTER (WHERE email = ${e} AND created_at > now() - make_interval(secs => ${CODE_GAP_SECONDS}))::int AS gap,
      count(*) FILTER (WHERE email = ${e} AND created_at > now() - interval '1 day')::int AS day,
      count(*) FILTER (WHERE ip = ${ip} AND created_at > now() - interval '1 hour')::int AS hour
    FROM auth_events WHERE kind = 'code' AND created_at > now() - interval '1 day' AND (email = ${e} OR ip = ${ip})`
  if (r.gap > 0) throw tooMany('A code was just sent. Wait a minute before asking for another.')
  if (r.day >= CODES_PER_EMAIL_DAY) throw tooMany('Too many codes were sent to this email today. Try again tomorrow.')
  if (r.hour >= CODES_PER_IP_HOUR) throw tooMany('Too many codes were asked for. Try again in an hour.')
  await sql`INSERT INTO auth_events (kind, email, ip) VALUES ('code', ${e}, ${ip})`
}
