import crypto from 'node:crypto'
import sql from '@/lib/db'
import { hashPassword, validatePassword } from './password'
import { generateOtp, hashOtp, verifyOtpHash } from './otp'
import { sendOtpEmail } from './mailer'
import { allowCodeSend, clearLoginFailures } from './limits'

const OTP_TTL_MS = 10 * 60 * 1000   // 10 minutes
const MAX_ATTEMPTS = 5

// ── Signup ────────────────────────────────────────────────────────────────────

export async function signupUser(email: string, password: string, ip = 'unknown'): Promise<void> {
  const norm = email.toLowerCase().trim()

  const pwErr = validatePassword(password)
  if (pwErr) throw Object.assign(new Error(pwErr), { status: 400 })

  const [existing] = await sql`
    SELECT id, "emailVerified", password_hash FROM users WHERE email = ${norm}
  `

  if (existing?.emailVerified) {
    // (made with Google: no password)
    const msg = existing.password_hash ? 'An account with this email already exists' : 'This email already has an account — use Continue with Google'
    throw Object.assign(new Error(msg), { status: 409 })
  }

  // (a code is about to be sent: at most once a minute to an email, and a few a day: limits.ts)
  await allowCodeSend(norm, ip)
  const passwordHash = await hashPassword(password)

  if (existing) {
    // Unverified account — update password and resend OTP
    await sql`UPDATE users SET password_hash = ${passwordHash} WHERE email = ${norm}`
  } else {
    await sql`
      INSERT INTO users (id, email, password_hash)
      VALUES (${crypto.randomUUID()}, ${norm}, ${passwordHash})
    `
  }

  await issueOtp(norm, 'signup')
}

// ── One form for signing in and up ───────────────────────────────────────────

/**
 * What the sign-in form does with an email (user, 2026-10-31: one form, one way through):
 * 'password' — an account that signs in with a password; 'google' — one made with Google, no
 * password yet; 'none' — no account (or a signup whose code was never entered): the form turns
 * into "create your account". It says whether an email has an account — accepted by the user.
 */
export async function accountStatus(email: string): Promise<'password' | 'google' | 'none'> {
  const norm = email.toLowerCase().trim()
  const [u] = await sql`SELECT "emailVerified", password_hash FROM users WHERE email = ${norm}`
  if (!u?.emailVerified) return 'none'
  return u.password_hash ? 'password' : 'google'
}

// ── OTP issue / verify ────────────────────────────────────────────────────────

export async function issueOtp(
  email: string,
  purpose: 'signup' | 'password_reset',
): Promise<void> {
  await sql`DELETE FROM verification_otps WHERE email = ${email} AND purpose = ${purpose}`

  const otp = generateOtp()
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)

  await sql`
    INSERT INTO verification_otps (email, otp_hash, purpose, expires_at)
    VALUES (${email}, ${hashOtp(otp)}, ${purpose}, ${expiresAt})
  `

  await sendOtpEmail(email, otp, purpose)
}

export async function verifyOtp(
  email: string,
  otp: string,
  purpose: 'signup' | 'password_reset',
): Promise<void> {
  const norm = email.toLowerCase().trim()

  const [row] = await sql`
    SELECT id, otp_hash, attempts, expires_at
    FROM verification_otps
    WHERE email = ${norm} AND purpose = ${purpose}
    ORDER BY created_at DESC LIMIT 1
  `

  if (!row) {
    throw Object.assign(new Error('No code found. Please request a new one.'), { status: 400 })
  }
  if (new Date(row.expires_at) < new Date()) {
    throw Object.assign(new Error('Code expired. Please request a new one.'), { status: 400 })
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    throw Object.assign(new Error('Too many attempts. Please request a new code.'), { status: 429 })
  }

  // Increment attempt before checking — prevents brute-force timing attacks
  await sql`UPDATE verification_otps SET attempts = attempts + 1 WHERE id = ${row.id}`

  if (!verifyOtpHash(otp.trim(), row.otp_hash)) {
    const left = MAX_ATTEMPTS - (Number(row.attempts) + 1)
    const msg = left > 0
      ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} remaining.`
      : 'Too many incorrect attempts. Please request a new code.'
    throw Object.assign(new Error(msg), { status: 400 })
  }

  // Valid — consume it
  await sql`DELETE FROM verification_otps WHERE id = ${row.id}`

  if (purpose === 'signup') {
    await sql`UPDATE users SET "emailVerified" = NOW() WHERE email = ${norm}`
  }
}

// ── Password reset ────────────────────────────────────────────────────────────

export async function requestPasswordReset(email: string, ip = 'unknown'): Promise<void> {
  const norm = email.toLowerCase().trim()
  // Counted before looking the email up, so the answer is the same whether it has an account or not
  await allowCodeSend(norm, ip)
  // Don't reveal whether the email exists
  const [user] = await sql`
    SELECT id FROM users WHERE email = ${norm} AND "emailVerified" IS NOT NULL
  `
  if (!user) return
  await issueOtp(norm, 'password_reset')
}

export async function resetPassword(
  email: string,
  otp: string,
  newPassword: string,
): Promise<void> {
  const norm = email.toLowerCase().trim()

  const pwErr = validatePassword(newPassword)
  if (pwErr) throw Object.assign(new Error(pwErr), { status: 400 })

  await verifyOtp(norm, otp, 'password_reset')

  const passwordHash = await hashPassword(newPassword)
  await sql`UPDATE users SET password_hash = ${passwordHash} WHERE email = ${norm}`
  // (a new password: its owner is no longer locked out by the wrong tries before it)
  await clearLoginFailures(norm)
}

/**
 * "Send the code again": only to an email waiting for one — a signup whose code isn't entered yet, or
 * a password reset for an account. Anything else sends nothing and answers the same, so this can't
 * be used to email codes to anyone.
 */
export async function resendOtp(email: string, purpose: 'signup' | 'password_reset', ip = 'unknown'): Promise<void> {
  const norm = email.toLowerCase().trim()
  await allowCodeSend(norm, ip)
  const [u] = await sql`SELECT "emailVerified" FROM users WHERE email = ${norm}`
  if (!u) return
  if (purpose === 'signup' ? u.emailVerified : !u.emailVerified) return
  await issueOtp(norm, purpose)
}
