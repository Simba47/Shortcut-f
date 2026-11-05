'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { AuthShell, RECOVERY_BRAND } from '@/components/auth/AuthShell'
import { BackToSignIn, EmailField, Messages, SubmitButton } from '@/components/auth/fields'
import { AUTH } from '@/components/auth/strings'

/** Forgot password, in the auth card: the email → a reset code is sent → on to /reset-password */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = AUTH.recovery.forgot

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setSent(true)
    } catch {
      setError(AUTH.errors.network)
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <AuthShell brand={RECOVERY_BRAND}>
        <div key="sent" className="auth-form">
          <BackToSignIn />
          <h1>{t.sentTitle}</h1>
          <p className="auth-sub">{t.sentBody} <strong>{email}</strong>, {t.sentAfter}</p>
          <Link href={`/reset-password?email=${encodeURIComponent(email)}`} className="auth-submit">
            <span>{t.next}</span>
            <ArrowRight className="auth-submit-arrow" aria-hidden />
          </Link>
          <p className="auth-switch">
            <button type="button" onClick={() => setSent(false)}>{t.otherEmail}</button>
          </p>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell brand={RECOVERY_BRAND}>
      <form key="ask" className="auth-form" onSubmit={handleSubmit}>
        <BackToSignIn />
        <h1>{t.title}</h1>
        <p className="auth-sub">{t.sub}</p>
        <EmailField id="forgot-email" value={email} onChange={setEmail} />
        <Messages error={error} />
        <SubmitButton busy={loading} label={t.submit} busyLabel={t.busy} />
      </form>
    </AuthShell>
  )
}
