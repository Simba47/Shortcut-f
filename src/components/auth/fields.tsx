'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowLeft, ArrowRight, ArrowUp, Check, Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { AUTH } from './strings'

/** The form parts every auth screen shares (styles: app/auth.css) */

/**
 * Label row (with an optional link on the right, e.g. "Forgot password?") above an input box, and
 * the box's own error under it — the box turns red and shakes once (user, 2026-11-03: errors on the
 * field they're about). The input inside points at the message with `aria-describedby={errorId(id)}`.
 */
export function Field({ id, label, aside, error, children }: { id: string; label: string; aside?: React.ReactNode; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="auth-field" data-invalid={error ? true : undefined}>
      <div className="auth-field-head">
        <label htmlFor={id}>{label}</label>
        {aside}
      </div>
      {children}
      {error && <p id={errorId(id)} className="auth-field-error" role="alert"><AlertCircle aria-hidden />{error}</p>}
    </div>
  )
}

export const errorId = (id: string) => `${id}-error`

/** What an input inside a Field with an error says about it */
const invalidProps = (id: string, invalid: boolean) =>
  invalid ? { 'aria-invalid': true, 'aria-describedby': errorId(id) } as const : {}

export function EmailField({ id, value, onChange, error }: { id: string; value: string; onChange: (v: string) => void; error?: string | null }) {
  return (
    <Field id={id} label={AUTH.fields.email} error={error}>
      <div className="auth-box">
        <Mail className="auth-box-icon" aria-hidden />
        <input
          id={id} type="email" value={value} onChange={e => onChange(e.target.value)}
          required placeholder={AUTH.fields.emailPlaceholder} autoComplete="email" spellCheck={false}
          {...invalidProps(id, !!error)}
        />
      </div>
    </Field>
  )
}

/**
 * Password box with a lock icon and an eye button that toggles the characters visible/hidden; a
 * quiet "Caps Lock is on" under it while it's on and the box is in use.
 */
export function PasswordInput({ ref, invalid = false, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { ref?: React.Ref<HTMLInputElement>; invalid?: boolean }) {
  const [visible, setVisible] = useState(false)
  const [caps, setCaps] = useState(false)
  const readCaps = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState('CapsLock'))
  return (
    <>
      <div className="auth-box auth-password">
        <Lock className="auth-box-icon" aria-hidden />
        <input
          ref={ref} {...props} type={visible ? 'text' : 'password'}
          {...(props.id ? invalidProps(props.id, invalid) : {})}
          onKeyDown={readCaps} onKeyUp={readCaps} onBlur={e => { setCaps(false); props.onBlur?.(e) }}
        />
        <button
          type="button"
          className="auth-eye"
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? AUTH.fields.hidePassword : AUTH.fields.showPassword}
          aria-pressed={visible}
        >
          {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </button>
      </div>
      {caps && <p className="auth-caps" role="status"><ArrowUp aria-hidden />{AUTH.fields.capsLock}</p>}
    </>
  )
}

/** What a new password needs — the same three rules the server checks (modules/auth/password.ts) */
export const PASSWORD_RULES = [
  { label: AUTH.fields.rules.length, ok: (p: string) => p.length >= 8 },
  { label: AUTH.fields.rules.upper, ok: (p: string) => /[A-Z]/.test(p) },
  { label: AUTH.fields.rules.number, ok: (p: string) => /[0-9]/.test(p) },
] as const

export const passwordOk = (p: string) => PASSWORD_RULES.every(r => r.ok(p))

/** The three rules under a new password, each ticking as it's met */
export function PasswordRules({ value }: { value: string }) {
  return (
    <ul className="auth-rules" aria-label={AUTH.fields.rules.label}>
      {PASSWORD_RULES.map(r => {
        const met = r.ok(value)
        return (
          <li key={r.label} data-met={met || undefined}>
            <span aria-hidden><Check /></span>{r.label}
            <span className="sr-only">{met ? AUTH.fields.rules.met : AUTH.fields.rules.unmet}</span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The emailed code as six boxes. One real input lies over them (so the phone's code autofill,
 * pasting a whole code and screen readers all just work); the boxes show its digits and where the
 * next one goes.
 */
export function CodeInput({ ref, id, value, onChange, invalid = false }: { ref?: React.Ref<HTMLInputElement>; id: string; value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const [focused, setFocused] = useState(false)
  return (
    <div className="auth-code" data-invalid={invalid || undefined}>
      <input
        ref={ref} id={id} type="text" inputMode="numeric" autoComplete="one-time-code"
        pattern="[0-9]{6}" maxLength={6} required aria-label={AUTH.fields.codeHint}
        value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        {...invalidProps(id, invalid)}
      />
      <div className="auth-code-cells" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} data-filled={i < value.length || undefined} data-active={(focused && i === Math.min(value.length, 5)) || undefined}>
            {value[i] ?? ''}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The form's main button: solid lime, its label and an arrow — a spinner and the busy words while the step runs */
export function SubmitButton({ busy, disabled, label, busyLabel }: { busy: boolean; disabled?: boolean; label: string; busyLabel: string }) {
  return (
    <button type="submit" disabled={busy || disabled} className="auth-submit" aria-busy={busy || undefined}>
      {busy && <span className="auth-spinner" aria-hidden />}
      <span>{busy ? busyLabel : label}</span>
      {!busy && <ArrowRight className="auth-submit-arrow" aria-hidden />}
    </button>
  )
}

/** "← Back to sign in" above a screen's title */
export function BackToSignIn() {
  return <Link href="/login" className="auth-back"><ArrowLeft aria-hidden /> {AUTH.recovery.backToSignIn}</Link>
}

/** A note from the flow (lime edge) and an error about no one box (red edge) */
export function Messages({ notice, error }: { notice?: string | null; error?: string | null }) {
  return (
    <>
      {notice && <p className="auth-note" role="status">{notice}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
    </>
  )
}

/** Seconds before another code can be sent, counting down to 0 */
export function useCooldown(start = 0) {
  const [left, setLeft] = useState(start)
  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [left])
  return [left, setLeft] as const
}

/** "Didn't get it? Send a new code" — or the seconds until one can be sent */
export function ResendLine({ cooldown, onResend, children }: { cooldown: number; onResend: () => void; children?: React.ReactNode }) {
  return (
    <p className="auth-switch">
      {AUTH.code.didntGet}{' '}
      {cooldown > 0 ? <span>{AUTH.code.resendIn(cooldown)}</span> : <button type="button" onClick={onResend}>{AUTH.code.resend}</button>}
      {children}
    </p>
  )
}
