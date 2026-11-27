'use client'

import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { BrandLoader } from '@/components/ui/brand-loader'
import { AuthShell, RECOVERY_BRAND } from '@/components/auth/AuthShell'
import { ErrorNotice } from '@/components/errors/ErrorNotice'
import {
  BackToSignIn, CodeInput, Field, Messages, PasswordInput, PasswordRules, ResendLine, SubmitButton,
  passwordOk, useCooldown,
} from '@/components/auth/fields'
import { AUTH } from '@/components/auth/strings'

/** Seconds before another code can be sent (one was sent just before this page) */
const RESEND_COOLDOWN = 60

type ErrorAt = 'code' | 'password' | 'confirm'

/**
 * The emailed reset code and a new password, in the auth card. (From /forgot-password with
 * ?email=…; from the old code page with the code too, ?otp=…, so no code is asked.) Done → /login,
 * which says the password is updated.
 */
function ResetPasswordForm() {
  const params = useSearchParams()
  const email = params.get('email') ?? ''
  const prefillOtp = params.get('otp') ?? ''
  const router = useRouter()
  const t = AUTH.recovery.reset

  const [otp, setOtp] = useState(prefillOtp)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setFormError] = useState<{ text: string; at?: ErrorAt } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cooldown, setCooldown] = useCooldown(RESEND_COOLDOWN)
  const codeRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  useEffect(() => { (prefillOtp ? passwordRef : codeRef).current?.focus() }, [prefillOtp])

  const setError = (text: string | null, at?: ErrorAt) => setFormError(text ? { text, at } : null)
  const errorAt = (at: ErrorAt) => (error?.at === at ? error.text : null)
  const typed = (at: ErrorAt) => { if (error?.at === at) setFormError(null) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!passwordOk(password)) { setError(AUTH.errors.weakPassword, 'password'); return }
    if (password !== confirm) { setError(AUTH.errors.mismatch, 'confirm'); return }
    setLoading(true); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg: string = data.error ?? AUTH.errors.resetFailed
        // (the server's code errors all name the code: they go under the code boxes, when shown)
        setError(msg, !prefillOtp && /code/i.test(msg) ? 'code' : undefined)
        setLoading(false)
        return
      }
      router.push('/login?reset=1')
    } catch {
      setError(AUTH.errors.network)
      setLoading(false)
    }
  }

  async function resend() {
    setCooldown(RESEND_COOLDOWN); setError(null)
    const r = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => null)
    setNotice(r?.ok ? AUTH.notes.newCodeSent(email) : null)
    if (!r?.ok) setError(AUTH.errors.resendFailed)
  }

  // Opened without its email (an old bookmark, a copied link): the simple notice — the error pages' look,
  // no panda here (user, 2026-11-28): centred, a small lock icon — not the sign-in card
  if (!email) {
    return (
      <ErrorNotice
        title={t.missingTitle} lines={t.missingLines} action={{ href: '/forgot-password', label: t.startAgain }}
        icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="10.5" width="16" height="10.5" rx="3" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /><path d="M12 14.5v2.5" /></svg>}
      />
    )
  }

  return (
    <AuthShell brand={RECOVERY_BRAND}>
    <form className="auth-form" onSubmit={handleSubmit}>
      <BackToSignIn />
      <h1>{t.title}</h1>
      <p className="auth-sub">{prefillOtp ? t.subNoCode : t.sub} <strong>{email}</strong>.</p>
      {!prefillOtp && (
        <Field id="reset-code" label={t.code} error={errorAt('code')}>
          <CodeInput ref={codeRef} id="reset-code" value={otp} invalid={!!errorAt('code')} onChange={v => { setOtp(v); typed('code') }} />
        </Field>
      )}
      <Field id="reset-password" label={t.password} error={errorAt('password')}>
        <PasswordInput
          ref={passwordRef} id="reset-password" value={password} invalid={!!errorAt('password')}
          onChange={e => { setPassword(e.target.value); typed('password') }}
          required placeholder={t.passwordPlaceholder} autoComplete="new-password"
        />
      </Field>
      <PasswordRules value={password} />
      <Field id="reset-confirm" label={AUTH.fields.confirm} error={errorAt('confirm')}>
        <PasswordInput
          id="reset-confirm" value={confirm} invalid={!!errorAt('confirm')}
          onChange={e => { setConfirm(e.target.value); typed('confirm') }}
          required placeholder={AUTH.signup.confirmPlaceholder} autoComplete="new-password"
        />
      </Field>
      <Messages notice={notice} error={error && !error.at ? error.text : null} />
      <SubmitButton busy={loading} disabled={!prefillOtp && otp.length < 6} label={t.submit} busyLabel={t.busy} />
      {!prefillOtp && <ResendLine cooldown={cooldown} onResend={resend} />}
      {!prefillOtp && (
        <p className="auth-switch">
          <Link href={`/forgot-password?email=${encodeURIComponent(email)}`}>{t.otherEmail}</Link>
        </p>
      )}
    </form>
    </AuthShell>
  )
}

/** (the form needs the address's ?email=: until it's read, a quiet loader on the dark page — not the card, which
    would flash before the notice when there's no email) */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="auth-wait"><BrandLoader size={36} /></div>}>
      <ResetPasswordForm />
    </Suspense>
  )
}
