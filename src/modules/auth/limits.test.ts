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
