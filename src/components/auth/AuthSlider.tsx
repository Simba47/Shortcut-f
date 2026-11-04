'use client'

import { useEffect, useRef, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { keepNextPath, takeNextPath } from '@/lib/nextPath'
import { AuthShell, NavSwitch } from './AuthShell'
import { CodeInput, EmailField, Field, PasswordInput, PasswordRules, SubmitButton, passwordOk } from './fields'
import { AUTH } from './strings'

type Mode = 'signin' | 'signup'
/** The box an error is about (shown under it); none → the form's own message line */
type ErrorAt = 'email' | 'password' | 'confirm' | 'code'
type FormError = { text: string; at?: ErrorAt }

/** Set by app/api/auth/signed-out for the sign-in form to say why */
const SIGNED_OUT_NOTE = 'signed_out'
/** Seconds before another code can be sent */
const RESEND_COOLDOWN = 60

/**
 * Sign in / sign up, in the auth card (AuthShell). /login and /signup both render this (their tab
 * picked).
 */
export function AuthSlider({ initialMode, google = false }: { initialMode: Mode; google?: boolean }) {
  // (the page that sent them here — a brand kit invite link — is where signing in or up ends)
  useEffect(() => { keepNextPath() }, [])
  // Which tab is up — here, so the nav's switch can show the other one and flip to it in place
  const [mode, setMode] = useState<Mode>(initialMode)
  const flip = useRef<(next: Mode) => void>(null)
  const other: Mode = mode === 'signin' ? 'signup' : 'signin'

  return (
    <AuthShell navAction={
      <NavSwitch
        prompt={other === 'signup' ? AUTH.nav.newHere : AUTH.nav.haveAccount}
        label={other === 'signup' ? AUTH.nav.toSignup : AUTH.nav.toSignin}
        onClick={() => flip.current?.(other)}
      />
    }>
      <AuthFlow mode={mode} setMode={setMode} flip={flip} google={google} />
    </AuthShell>
  )
}

/** Why a Google sign-in came back without signing in (NextAuth's ?error= on /login) */
function googleError(code: string | null): string | null {
  if (!code) return null
  if (code === 'AccessDenied') return AUTH.google.denied
  if (code === 'Configuration') return AUTH.google.unavailable
  return AUTH.google.failed
}

/**
 * Sign in · Create account tabs, and one way through either (user, 2026-10-31: "far better
 * understanding but maintain uni directional flow"). Sign in with an email that has no account
 * slides to Create account with what was typed kept — only the confirmation is asked. Create
 * account with an email that already has one signs straight in when the password is right, else
 * slides to Sign in and says so. A new account's emailed code, once right, signs them straight in
 * with the password they typed (kept only in this page's memory) — never back to a sign-in form.
 */
function AuthFlow({ mode, setMode, flip, google }: {
  mode: Mode
  setMode: (m: Mode) => void
  /** Filled in here: the nav's switch calls it (back to the form from the code step, then the tab) */
  flip: React.RefObject<((next: Mode) => void) | null>
  google: boolean
}) {
  const [step, setStep] = useState<'form' | 'code'>('form')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setFormError] = useState<FormError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const router = useRouter()
  const confirmRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  /** An error, under the box it's about (or the form's message line when it's about none) */
  const setError = (text: string | null, at?: ErrorAt) => setFormError(text ? { text, at } : null)
  /** The error under a box, if there's one there */
  const errorAt = (at: ErrorAt) => (error?.at === at ? error.text : null)
  /** Typing in a box clears its own error */
  const typed = (at: ErrorAt) => { if (error?.at === at) setFormError(null) }

  // Signed out here because the account signed in on another device (app/api/auth/signed-out)
  useEffect(() => {
    if (!document.cookie.split('; ').includes(`${SIGNED_OUT_NOTE}=elsewhere`)) return
    setNotice(AUTH.notes.signedOutElsewhere)
    document.cookie = `${SIGNED_OUT_NOTE}=; Max-Age=0; path=/`
  }, [])
  // Back from Google without signing in: say why; back from a password reset: say it's done (once
  // each — the address loses the ?error / ?reset)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const msg = googleError(params.get('error'))
    const reset = params.get('reset') === '1'
    if (!msg && !reset) return
    if (msg) setError(msg)
    if (reset) setNotice(AUTH.notes.passwordUpdated)
    params.delete('error'); params.delete('reset')
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`)
  }, [])
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])
  useEffect(() => { if (step === 'code') codeRef.current?.focus() }, [step])

  const norm = () => email.toLowerCase().trim()
  /** A tab picked (by the person, or by the flow): the address follows; what was typed stays */
  function switchTo(next: Mode, msg: { error?: FormError; notice?: string } = {}) {
    setMode(next)
    setFormError(msg.error ?? null)
    setNotice(msg.notice ?? null)
    window.history.replaceState(null, '', next === 'signin' ? '/login' : '/signup')
  }
  // (the nav's switch: from the code step too — back to the form, then the other tab)
  useEffect(() => { flip.current = next => { setStep('form'); switchTo(next) } })
  async function signInNow(): Promise<boolean> {
    const res = await signIn('credentials', { email: norm(), password, redirect: false })
    if (res?.error) return false
    router.push(takeNextPath())
    return true
  }
  async function status(): Promise<'password' | 'google' | 'none' | null> {
    const r = await fetch('/api/auth/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: norm() }) })
    const d = await r.json()
    if (!r.ok) { setError(d.error ?? AUTH.errors.generic); return null }
    return d.status
  }
  /** Run a step: loading on, messages cleared, a network failure said plainly */
  async function run(e: React.FormEvent, fn: () => Promise<void>) {
    e.preventDefault()
    setLoading(true); setError(null); setNotice(null)
    try { await fn() } catch { setError(AUTH.errors.network) } finally { setLoading(false) }
  }

  // Sign in: an account signs in; no account → Create account, the confirmation is all that's left
  const onSignIn = (e: React.FormEvent) => run(e, async () => {
    const s = await status()
    if (!s) return
    if (s === 'none') {
      setConfirm('')
      switchTo('signup', { notice: AUTH.notes.noAccount(norm()) })
      setTimeout(() => confirmRef.current?.focus(), 50)
      return
    }
    if (s === 'google') { setError(AUTH.errors.googleOnly, 'email'); return }
    if (await signInNow()) return
    setError(AUTH.errors.wrongPassword, 'password')
  })

  // Create account: already one → signed in with the right password, else Sign in says so; new → the code
  const onCreate = (e: React.FormEvent) => run(e, async () => {
    if (password !== confirm) { setError(AUTH.errors.mismatch, 'confirm'); return }
    const s = await status()
    if (!s) return
    if (s === 'google') { setError(AUTH.errors.googleOnly, 'email'); return }
    if (s === 'password') {
      if (await signInNow()) return
      switchTo('signin', { error: { text: AUTH.errors.exists(norm()), at: 'password' } })
      setPassword('')
      setTimeout(() => passwordRef.current?.focus(), 50)
      return
    }
    // (a new account: its password must meet the rules shown under it — the server checks them too)
    if (!passwordOk(password)) { setError(AUTH.errors.weakPassword, 'password'); return }
    const r = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: norm(), password }) })
    const d = await r.json()
    if (!r.ok) { setError(d.error ?? AUTH.errors.createFailed); return }
    setCode(''); setCooldown(RESEND_COOLDOWN); setStep('code')
  })

  // The emailed code: right, and they're in
  const onVerify = (e: React.FormEvent) => run(e, async () => {
    const r = await fetch('/api/auth/verify-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: norm(), otp: code, purpose: 'signup' }) })
    const d = await r.json()
    if (!r.ok) { setError(d.error ?? AUTH.errors.badCode, 'code'); return }
    if (await signInNow()) return
    // (verified, but signing in failed — rare: say so, the account is ready)
    setStep('form')
    switchTo('signin', { notice: AUTH.notes.verifiedSignIn })
  })

  async function resend() {
    setCooldown(RESEND_COOLDOWN); setError(null)
    const r = await fetch('/api/auth/verify-otp', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: norm(), purpose: 'signup' }) }).catch(() => null)
    setNotice(r?.ok ? AUTH.notes.newCodeSent(norm()) : null)
    if (!r?.ok) setError(AUTH.errors.resendFailed)
  }

  const signup = mode === 'signup'
  const copy = signup ? AUTH.signup : AUTH.signin
  // (an error about a box shows under that box; only the rest use the form's message line)
  const messages = (
    <>
      {notice && <p className="auth-note" role="status">{notice}</p>}
      {error && !error.at && <p className="auth-error" role="alert">{error.text}</p>}
    </>
  )

  if (step === 'code') {
    return (
      <form key="code" className="auth-form" onSubmit={onVerify}>
        <button type="button" className="auth-back" onClick={() => { setStep('form'); setError(null); setNotice(null) }}><ArrowLeft aria-hidden /> {AUTH.code.back}</button>
        <h1>{AUTH.code.title}</h1>
        <p className="auth-sub">{AUTH.code.sentTo} <strong>{norm()}</strong>. {AUTH.code.sentAfter}</p>
        <Field id="auth-code" label={AUTH.fields.code} error={errorAt('code')}>
          <CodeInput ref={codeRef} id="auth-code" value={code} invalid={!!errorAt('code')} onChange={v => { setCode(v); typed('code') }} />
        </Field>
        {messages}
        <SubmitButton busy={loading} disabled={code.length < 6} label={AUTH.code.submit} busyLabel={AUTH.code.busy} />
        <p className="auth-switch">
          {AUTH.code.didntGet}{' '}
          {cooldown > 0 ? <span>{AUTH.code.resendIn(cooldown)}</span> : <button type="button" onClick={resend}>{AUTH.code.resend}</button>}
          {' · '}<button type="button" onClick={() => { setStep('form'); switchTo('signup') }}>{AUTH.code.otherEmail}</button>
        </p>
      </form>
    )
  }

  return (
    <>
      <div className="auth-tabs" role="tablist" aria-label={AUTH.tabs.label}>
        <button type="button" role="tab" aria-selected={mode === 'signin'} onClick={() => switchTo('signin')}>{AUTH.tabs.signin}</button>
        <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => switchTo('signup')}>{AUTH.tabs.signup}</button>
        <span className="auth-tab-pill" data-at={mode} aria-hidden />
      </div>
      {/* One form for both tabs (user, 2026-10-31): switching to Create account, the password's
          rules and Confirm password come up from under the password; back to Sign in, they go back
          under. The words change with a short fade; what was typed stays. */}
      <form className="auth-form" onSubmit={signup ? onCreate : onSignIn}>
        <div key={mode} className="auth-heading">
          <h1>{copy.title}</h1>
          <p className="auth-sub">{copy.sub}</p>
        </div>
        {google && <GoogleButton />}
        <EmailField id="auth-email" value={email} error={errorAt('email')} onChange={v => { setEmail(v); typed('email') }} />
        <Field
          id="auth-password" label={AUTH.fields.password} error={errorAt('password')}
          aside={<Link href="/forgot-password" className="auth-link auth-forgot" data-off={signup || undefined} tabIndex={signup ? -1 : undefined}>{AUTH.fields.forgot}</Link>}
        >
          <PasswordInput
            ref={passwordRef} id="auth-password" value={password} invalid={!!errorAt('password')}
            onChange={e => { setPassword(e.target.value); typed('password') }}
            required placeholder={copy.passwordPlaceholder} autoComplete={signup ? 'new-password' : 'current-password'}
          />
        </Field>
        <div className="auth-reveal" data-open={signup || undefined} inert={!signup}>
          <div>
            <PasswordRules value={password} />
            <Field id="create-confirm" label={AUTH.fields.confirm} error={errorAt('confirm')}>
              <PasswordInput
                ref={confirmRef} id="create-confirm" value={confirm} invalid={!!errorAt('confirm')}
                onChange={e => { setConfirm(e.target.value); typed('confirm') }}
                required={signup} placeholder={AUTH.signup.confirmPlaceholder} autoComplete="new-password"
              />
            </Field>
          </div>
        </div>
        {messages}
        <SubmitButton busy={loading} label={copy.submit} busyLabel={copy.busy} />
        {signup ? (
          <p key="legal" className="auth-legal">
            {AUTH.legal.before} <Link href="/terms">{AUTH.legal.terms}</Link> {AUTH.legal.and} <Link href="/privacy">{AUTH.legal.privacy}</Link>{AUTH.legal.after}
          </p>
        ) : (
          <p key="secure" className="auth-legal auth-secure">
            <span><ShieldCheck aria-hidden />{AUTH.legal.secure}</span>
            <Link href="/terms">{AUTH.legal.terms}</Link>
            <Link href="/privacy">{AUTH.legal.privacy}</Link>
          </p>
        )}
      </form>
    </>
  )
}

/**
 * "Continue with Google" (Google's own button style: its G, dark theme), then "or" above the email
 * form. Signs in or up — a new Google account gets a Shortcut account straight away, no code (Google
 * confirmed the email); one with the same email as an existing account signs into that one (auth.ts).
 */
function GoogleButton() {
  const [going, setGoing] = useState(false)
  return (
    <>
      <button type="button" className="auth-google" disabled={going}
        onClick={() => { setGoing(true); void signIn('google', { redirectTo: takeNextPath() }) }}>
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        <span>{going ? AUTH.google.busy : AUTH.google.cta}</span>
      </button>
      <div className="auth-or" role="separator"><span>{AUTH.google.or}</span></div>
    </>
  )
}
