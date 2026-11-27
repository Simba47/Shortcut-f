'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { AuthShell, RECOVERY_BRAND } from '@/components/auth/AuthShell'
import { ErrorNotice } from '@/components/errors/ErrorNotice'
import { BackToSignIn, Field, Messages, SubmitButton } from '@/components/auth/fields'

/** Shown with the restore form: at least this many letters (accountDeletion.ts MIN_FEEDBACK) */
const MIN = 10
const MAX = 2000
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })

/** The restore page's card: the feedback box and Restore my account; then "It's back" and Sign in */
export function RestoreForm({ token, email, restoreBy }: { token: string; email: string | null; restoreBy: string | null }) {
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const letters = feedback.replace(/\s+/g, '').length

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (letters < MIN) { setError('Tell us in a few words what went wrong or what we could do better — that’s all we ask to restore it.'); return }
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/account/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, feedback }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setError(d.error ?? 'Could not restore your account. Try again.'); return }
      setDone(d.email ?? email ?? '')
    } catch {
      setError('Something went wrong. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done !== null) {
    return (
      <AuthShell brand={RECOVERY_BRAND}>
        <div key="done" className="auth-form">
          <h1>Your account is back</h1>
          <p className="auth-sub">{done ? <><strong>{done}</strong> is restored, with</> : 'It’s restored with'} its videos, clips and credits. Thank you for telling us what went wrong — we read every one.</p>
          <p className="auth-sub">Your plan was cancelled when the account was deleted: choose one again within 7 days to keep your videos.</p>
          <Link href="/login" className="auth-submit"><span>Sign in</span><ArrowRight className="auth-submit-arrow" aria-hidden /></Link>
        </div>
      </AuthShell>
    )
  }

  // The link has expired, was used, or a newer one replaced it (user, 2026-11-28: simple, not the sign-in card):
  // the error pages' layout — the calm panda, the title, two short lines and one way on (ExpiredLink below)
  if (!email || !restoreBy) return <ExpiredLink />

  return (
    <AuthShell brand={RECOVERY_BRAND}>
      <form key="ask" className="auth-form" onSubmit={submit}>
        <BackToSignIn />
        <h1>Restore your account</h1>
        <p className="auth-sub"><strong>{email}</strong> was deleted. Everything in it is kept until {day(restoreBy)}.</p>
        <Field id="restore-feedback" label="What went wrong, or what could we do better?" error={null}>
          <div className="auth-box auth-box-area">
            <textarea id="restore-feedback" value={feedback} maxLength={MAX} rows={5} required
              placeholder="A line or two is enough" onChange={e => { setFeedback(e.target.value); if (error) setError(null) }} />
          </div>
        </Field>
        <Messages error={error} />
        <SubmitButton busy={busy} disabled={letters < MIN} label="Restore my account" busyLabel="Restoring…" />
      </form>
    </AuthShell>
  )
}

/** The expired restore link: the error pages' simple layout (components/errors/ErrorNotice), not the sign-in card */
function ExpiredLink() {
  return (
    <ErrorNotice
      title="This link has expired"
      lines={['Restore links work once, for a limited time.', 'Get a new one from the sign-in page.']}
      action={{ href: '/login', label: 'Go to sign in' }}
    />
  )
}
