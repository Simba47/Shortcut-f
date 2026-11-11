'use client'

import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { ArrowRight } from 'lucide-react'
import { BrandLoader } from '@/components/ui/brand-loader'
import { AuthShell } from '@/components/auth/AuthShell'
import { BackToSignIn, CodeInput, Field, Messages, ResendLine, SubmitButton, useCooldown } from '@/components/auth/fields'
import { AUTH } from '@/components/auth/strings'
import { takeNextPath } from '@/lib/nextPath'

const RESEND_COOLDOWN = 60

/**
 * The older code page, in the auth card (sign up now asks for its code in the card itself; nothing
 * links here, but the address still works): ?email=…&purpose=signup | password_reset.
 */
function VerifyOtpForm() {
  const params = useSearchParams()
  const email = params.get('email') ?? ''
  const purpose = (params.get('purpose') ?? 'signup') as 'signup' | 'password_reset'
  const router = useRouter()
  const t = AUTH.recovery.verify

  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [cooldown, setCooldown] = useCooldown()
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => { codeRef.current?.focus() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, purpose }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? AUTH.errors.badCode); setLoading(false); return }

      if (purpose === 'signup') {
        const signInRes = await signIn('credentials', {
          email,
          password: params.get('__p') ?? '',
          redirect: false,
        })
        if (signInRes?.ok) { router.push(takeNextPath()); return }
        // Password not in URL (security) — ask user to login
        setSuccess(true)
        setLoading(false)
      } else {
        router.push(`/reset-password?email=${encodeURIComponent(email)}&otp=${encodeURIComponent(otp)}`)
      }
    } catch {
      setError(AUTH.errors.network)
      setLoading(false)
    }
  }

  async function handleResend() {
    setCooldown(RESEND_COOLDOWN); setError(null)
    const r = await fetch('/api/auth/verify-otp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, purpose }),
    }).catch(() => null)
    setNotice(r?.ok ? AUTH.notes.newCodeSent(email) : null)
    if (!r?.ok) { const d = r ? await r.json().catch(() => ({})) : {}; setError(r?.status === 429 && d.error ? d.error : AUTH.errors.resendFailed) }
  }

  if (success) {
    return (
      <div className="auth-form">
        <h1>{t.doneTitle}</h1>
        <p className="auth-sub">{t.doneBody}</p>
        <Link href="/login" className="auth-submit">
          <span>{t.doneCta}</span>
          <ArrowRight className="auth-submit-arrow" aria-hidden />
        </Link>
      </div>
    )
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <BackToSignIn />
      <h1>{t.title}</h1>
      <p className="auth-sub">{AUTH.code.sentTo} <strong>{email}</strong>.</p>
      <Field id="verify-code" label={AUTH.fields.code} error={error}>
        <CodeInput ref={codeRef} id="verify-code" value={otp} invalid={!!error} onChange={v => { setOtp(v); setError(null) }} />
      </Field>
      <Messages notice={notice} />
      <SubmitButton busy={loading} disabled={otp.length < 6} label={t.submit} busyLabel={t.busy} />
      <ResendLine cooldown={cooldown} onResend={handleResend} />
    </form>
  )
}

export default function VerifyOtpPage() {
  return (
    <AuthShell>
      <Suspense fallback={<BrandLoader size={36} />}>
        <VerifyOtpForm />
      </Suspense>
    </AuthShell>
  )
}

