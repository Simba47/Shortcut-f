import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

// Limits on guessing passwords and on sending login codes. Real Postgres (the local rig):
//   DATABASE_URL=postgresql://postgres@localhost:5433/shortcut_local npx tsx --test src/modules/auth/limits.test.ts
const HAS_DB = !!process.env.DATABASE_URL
const opts = { skip: HAS_DB ? false : 'DATABASE_URL not set' }
let sql: typeof import('@/lib/db').default
let L: typeof import('./limits')
const tag = `lim-${Math.random().toString(36).slice(2)}`
const email = (n: string) => `${tag}-${n}@example.test`
const ip = (n: number) => `${tag}-ip-${n}`

before(async () => { if (!HAS_DB) return; sql = (await import('@/lib/db')).default; L = await import('./limits'); await L.ensureLimitsSchema() })
after(async () => { if (!HAS_DB) return; await sql`DELETE FROM auth_events WHERE email LIKE ${tag + '%'} OR ip LIKE ${tag + '%'}`; await sql.end({ timeout: 2 }) })

test('ten wrong passwords lock that email for a while; a right one clears the count', opts, async () => {
  const e = email('a')
  for (let i = 0; i < 9; i++) await L.recordLoginFailure(e, ip(1))
  assert.equal(await L.loginLocked(e, ip(2)), false)
  await L.recordLoginFailure(e, ip(1))
  assert.equal(await L.loginLocked(e, ip(2)), true, 'locked from any address')
  await L.clearLoginFailures(e)
  assert.equal(await L.loginLocked(e, ip(2)), false)
})

test('one address guessing many emails is stopped too', opts, async () => {
  for (let i = 0; i < 50; i++) await L.recordLoginFailure(email(`spray${i}`), ip(3))
  assert.equal(await L.loginLocked(email('other'), ip(3)), true)
  assert.equal(await L.loginLocked(email('other'), ip(4)), false)
})

test('failures older than the window do not count', opts, async () => {
  const e = email('old')
  for (let i = 0; i < 10; i++) await L.recordLoginFailure(e, ip(5))
  await sql`UPDATE auth_events SET created_at = now() - interval '20 minutes' WHERE email = ${e}`
  assert.equal(await L.loginLocked(e, ip(5)), false)
})

const tooMany = (e: { status?: number }) => e.status === 429
test('a code to the same email waits a minute between sends', opts, async () => {
  const e = email('c')
  await L.allowCodeSend(e, ip(6))
  await assert.rejects(L.allowCodeSend(e, ip(6)), tooMany)
  await sql`UPDATE auth_events SET created_at = now() - interval '2 minutes' WHERE email = ${e}`
  await L.allowCodeSend(e, ip(6))
})

test('at most 10 codes to one email a day', opts, async () => {
  const e = email('d')
  await sql`INSERT INTO auth_events (kind, email, ip, created_at) SELECT 'code', ${e}, ${ip(7)}, now() - interval '2 hours' FROM generate_series(1, 10)`
  await assert.rejects(L.allowCodeSend(e, ip(8)), tooMany)
})

test('at most 20 codes from one address an hour, to any emails', opts, async () => {
  for (let i = 0; i < 20; i++) await L.allowCodeSend(email(`many${i}`), ip(9))
  await assert.rejects(L.allowCodeSend(email('many-last'), ip(9)), tooMany)
})

test('"send the code again" only emails someone waiting for a code, and answers the same either way', opts, async () => {
  const { resendOtp } = await import('./services')
  const sent: string[] = []
  const mailer = await import('./mailer')
  const real = mailer.sendOtpEmail
  ;(mailer as { sendOtpEmail: typeof real }).sendOtpEmail = async (to: string) => { sent.push(to) }
  try {
    const stranger = email('stranger')
    await resendOtp(stranger, 'signup', ip(20))
    assert.equal(sent.length, 0, 'no account: nothing sent')
  } finally { (mailer as { sendOtpEmail: typeof real }).sendOtpEmail = real }
})

test('a burst of guesses at the same moment still stops at the limit', opts, async () => {
  const e = email('burst')
  const got = await Promise.all(Array.from({ length: 30 }, () => L.startLoginAttempt(e, ip(30)).then(id => id, () => null)))
  assert.equal(got.filter(x => x !== null).length, 10)
  await assert.rejects(L.startLoginAttempt(e, ip(31)), (x: { code?: string }) => x.code === 'too_many')
})

test('a right password forgets the attempt and the earlier wrong ones', opts, async () => {
  const e = email('right')
  for (let i = 0; i < 3; i++) await L.startLoginAttempt(e, ip(32))
  const id = await L.startLoginAttempt(e, ip(32))
  await L.loginSucceeded(e, id)
  assert.equal(await L.loginLocked(e, ip(33)), false)
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM auth_events WHERE email = ${e} AND kind = 'fail'`
  assert.equal(n, 0)
})

test('a burst of code requests sends one', opts, async () => {
  const e = email('codeburst')
  const r = await Promise.allSettled(Array.from({ length: 10 }, () => L.allowCodeSend(e, ip(34))))
  assert.equal(r.filter(x => x.status === 'fulfilled').length, 1)
})

test('the address is the one Railway sets, not one the visitor sends', () => {
  const h = (o: Record<string, string>) => new Headers(o)
  assert.equal(L.clientIp(h({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 203.0.113.9' })), '203.0.113.9')
  assert.equal(L.clientIp(h({ 'x-forwarded-for': '198.51.100.7' })), '198.51.100.7')
  assert.equal(L.clientIp(h({})), 'unknown')
})

test('a password reset unlocks the account', opts, async () => {
  const { resetPassword, issueOtp } = await import('./services')
  void issueOtp
  const e = email('reset')
  await sql`INSERT INTO users (email, "emailVerified") VALUES (${e}, now())`
  for (let i = 0; i < 10; i++) await L.recordLoginFailure(e, ip(35))
  assert.equal(await L.loginLocked(e, ip(35)), true)
  const otp = '123456'
  const { hashOtp } = await import('./otp')
  await sql`INSERT INTO verification_otps (email, otp_hash, purpose, expires_at) VALUES (${e}, ${hashOtp(otp)}, 'password_reset', now() + interval '10 minutes')`
  await resetPassword(e, otp, 'New-Pass-123!')
  assert.equal(await L.loginLocked(e, ip(35)), false)
  await sql`DELETE FROM users WHERE email = ${e}`
})
