'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { AccountMenu } from '@/components/ui/account-menu'
import { BrandLoaderScreen } from '@/components/ui/brand-loader'

type Account = { email: string; name: string | null; image: string | null; emailVerified: string | null; planName: string; hasPassword: boolean }

/** Profile photos are sent as a square this many pixels wide */
const PHOTO_SIZE = 256

/**
 * Account settings: your profile photo, name, email and plan; change your password; delete your account.
 * Talks to /api/account (GET, PATCH, DELETE), /api/account/photo and /api/account/password. (styles: .st-* in globals.css)
 */
export default function SettingsPage() {
  const { update } = useSession()
  const [account, setAccount] = useState<Account | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/account')
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not load your account'); return d })
      .then(setAccount)
      .catch(e => setLoadError(e instanceof Error ? e.message : 'Could not load your account'))
  }, [])

  if (!account && !loadError) return <BrandLoaderScreen label="Opening your account…" />

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0b0b0c' }}>
      <nav className="flex items-center gap-3 px-4 shrink-0 sticky top-0 z-10"
        style={{ height: 56, background: 'rgba(14,14,15,0.85)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <Breadcrumbs shine items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Account settings' }]} />
        <div className="flex-1" />
        <AccountMenu />
      </nav>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">
        <header>
          <h1 className="st-title">Account settings</h1>
          <p className="st-sub">Your photo, name, password and account. Changes save straight away.</p>
        </header>

        {loadError && <div className="st-alert st-alert-red" role="alert">{loadError}</div>}

        {account && (
          <>
            <ProfileCard account={account} onSaved={async name => { setAccount(a => a && { ...a, name }); await update({ name }) }}
              onPhoto={async image => { setAccount(a => a && { ...a, image }); await update({ image }) }} />
            {account.hasPassword && <PasswordCard />}
            <DangerCard hasPassword={account.hasPassword} />
          </>
        )}
      </main>
    </div>
  )
}

/** A picked picture, cut to a centred square and shrunk to 256 px: small to send, sharp at any size we show it */
async function squarePhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('That file could not be opened as a picture'))
      img.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    if (!side) throw new Error('That file could not be opened as a picture')
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = PHOTO_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Your browser could not prepare the photo')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) throw new Error('Your browser could not prepare the photo')
    return blob
  } finally { URL.revokeObjectURL(url) }
}

/** Profile photo: the picture (or the first letter), with Upload / Change and Remove */
function PhotoRow({ account, onPhoto }: { account: Account; onPhoto: (image: string | null) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'saving' | 'removing' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const letter = (account.name || account.email).charAt(0).toUpperCase()

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''   // so choosing the same file again still fires
    if (!file || busy) return
    setBusy('saving'); setError(null)
    try {
      const form = new FormData()
      form.append('file', await squarePhoto(file), 'photo.jpg')
      const r = await fetch('/api/account/photo', { method: 'POST', body: form })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? 'Could not save your photo')
      await onPhoto(d.image)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your photo')
    } finally { setBusy(null) }
  }

  async function remove() {
    if (busy) return
    setBusy('removing'); setError(null)
    try {
      const r = await fetch('/api/account/photo', { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? 'Could not remove your photo')
      await onPhoto(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove your photo')
    } finally { setBusy(null) }
  }

  const camera = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" /><circle cx="12" cy="13" r="3.5" />
    </svg>
  )
  return (
    <div className="st-hero">
      {/* The photo is a button too: click it to choose one */}
      <button type="button" className="st-ava" data-busy={busy ? '' : undefined} disabled={!!busy} onClick={() => input.current?.click()}
        aria-label={account.image ? 'Change your profile photo' : 'Upload a profile photo'}>
        <span className="st-ava-pic">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {account.image ? <img src={account.image} alt="" /> : letter}
        </span>
        <span className="st-ava-badge">{camera}</span>
      </button>

      <div className="st-hero-id">
        <p className="st-hero-name">{account.name || account.email.split('@')[0]}</p>
        <p className="st-hero-mail" title={account.email}>{account.email}</p>
        <div className="st-hero-chips">
          <span className="st-chip st-chip-lime">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>
            {account.planName} plan
          </span>
          {account.emailVerified && <span className="st-chip st-chip-green">✓ Verified</span>}
        </div>
      </div>

      <div className="st-hero-actions">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="st-pill st-pill-lime" disabled={!!busy} onClick={() => input.current?.click()}>
            {camera}{busy === 'saving' ? 'Saving…' : account.image ? 'Change photo' : 'Upload photo'}
          </button>
          {account.image && (
            <button type="button" className="st-pill st-pill-red" disabled={!!busy} onClick={remove}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
              </svg>
              {busy === 'removing' ? 'Removing…' : 'Remove'}
            </button>
          )}
        </div>
        <span className="st-hint">JPG, PNG or WebP</span>
        {error && <p className="st-err" role="alert">{error}</p>}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pick} aria-label="Choose a profile photo" />
    </div>
  )
}

/** Name (editable), email and plan */
function ProfileCard({ account, onSaved, onPhoto }: { account: Account; onSaved: (name: string | null) => Promise<void>; onPhoto: (image: string | null) => Promise<void> }) {
  const [name, setName] = useState(account.name ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const changed = name.trim() !== (account.name ?? '')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!changed || state === 'saving') return
    setState('saving'); setError(null)
    try {
      const r = await fetch('/api/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Could not save your name')
      await onSaved(d.name)
      setName(d.name ?? '')
      setState('saved')
      setTimeout(() => setState(s => (s === 'saved' ? 'idle' : s)), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your name'); setState('error')
    }
  }

  return (
    <section className="st-card st-profile">
      <h2 className="sr-only">Profile</h2>
      <PhotoRow account={account} onPhoto={onPhoto} />
      <form onSubmit={save} className="st-profile-body">
        <label className="st-field">
          <span className="st-label">Name</span>
          {/* Save sits inside the box, at its right end */}
          <div className="st-inset">
            <input value={name} maxLength={60} placeholder="Your name"
              onChange={e => { setName(e.target.value); if (state !== 'saving') setState('idle') }} autoComplete="name" />
            <button type="submit" className="st-btn st-btn-lime" disabled={!changed || state === 'saving'}>
              {state === 'saving' ? 'Saving…' : state === 'saved' ? '✓ Saved' : 'Save'}
            </button>
          </div>
          <span className="st-hint">Shown on your profile button.</span>
        </label>
        {error && <p className="st-err" role="alert">{error}</p>}

        <div className="st-tiles">
          <div className="st-tile">
            <span className="st-tile-ico" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
            </span>
            <div className="min-w-0 flex-1">
              <span className="st-tile-label">Email</span>
              <span className="st-tile-value" title={account.email}>{account.email}</span>
            </div>
          </div>
          <div className="st-tile">
            <span className="st-tile-ico" data-lime="" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>
            </span>
            <div className="min-w-0 flex-1">
              <span className="st-tile-label">Plan</span>
              <span className="st-tile-value">{account.planName}</span>
            </div>
            <a href="/pricing" className="st-link">Plans &amp; billing →</a>
            <a href="/billing" className="st-link">Credits, payments &amp; invoices →</a>
          </div>
        </div>
      </form>
    </section>
  )
}

/** Change password: current, new, confirm */
function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const rules = [
    { ok: next.length >= 8, text: '8 or more characters' },
    { ok: /[A-Z]/.test(next), text: 'An uppercase letter' },
    { ok: /[0-9]/.test(next), text: 'A number' },
  ]
  const matches = !!next && next === confirm
  const ready = !!current && rules.every(r => r.ok) && matches

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true); setError(null); setDone(false)
    try {
      const r = await fetch('/api/account/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current, next }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Could not change your password')
      setCurrent(''); setNext(''); setConfirm(''); setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change your password')
    } finally { setBusy(false) }
  }

  const type = show ? 'text' : 'password'
  return (
    <section className="st-card">
      <div className="flex items-center justify-between">
        <h2 className="st-card-title">Password</h2>
        <button type="button" onClick={() => setShow(s => !s)} className="st-link">{show ? 'Hide' : 'Show'} passwords</button>
      </div>
      <form onSubmit={save} className="flex flex-col gap-4">
        <label className="st-field">
          <span className="st-label">Current password</span>
          <input className="st-input" type={type} value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" />
        </label>
        <label className="st-field">
          <span className="st-label">New password</span>
          <input className="st-input" type={type} value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" />
          <ul className="st-rules">
            {rules.map(r => <li key={r.text} data-ok={r.ok || undefined}>{r.ok ? '✓' : '•'} {r.text}</li>)}
          </ul>
        </label>
        <label className="st-field">
          <span className="st-label">Confirm new password</span>
          <input className="st-input" type={type} value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
          {confirm && !matches && <span className="st-err">The passwords don’t match</span>}
        </label>
        {done && <p className="st-ok">✓ Password changed</p>}
        {error && <p className="st-err" role="alert">{error}</p>}
        <div>
          <button type="submit" className="st-btn st-btn-lime" disabled={!ready || busy}>{busy ? 'Changing…' : 'Change password'}</button>
        </div>
      </form>
    </section>
  )
}

/** Delete the account: password + typing DELETE */
function DangerCard({ hasPassword }: { hasPassword: boolean }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = typed.trim().toUpperCase() === 'DELETE' && (!hasPassword || !!password)

  async function remove() {
    if (!ready || busy) return
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/account', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Could not delete your account')
      await signOut({ callbackUrl: '/' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete your account'); setBusy(false)
    }
  }

  return (
    <section className="st-card st-card-danger">
      <h2 className="st-card-title">Delete account</h2>
      <p className="st-sub" style={{ marginTop: 0 }}>
        This deletes your account, all your videos and clips, and your exports — for good. It can’t be undone.
      </p>
      {!open ? (
        <div><button type="button" className="st-btn st-btn-danger" onClick={() => setOpen(true)}>Delete my account…</button></div>
      ) : (
        <div className="flex flex-col gap-4">
          {hasPassword && (
            <label className="st-field">
              <span className="st-label">Your password</span>
              <input className="st-input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
            </label>
          )}
          <label className="st-field">
            <span className="st-label">Type <b style={{ color: '#fff' }}>DELETE</b> to confirm</span>
            <input className="st-input" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          {error && <p className="st-err" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="st-btn st-btn-ghost" onClick={() => { setOpen(false); setPassword(''); setTyped(''); setError(null) }} disabled={busy}>Cancel</button>
            <button type="button" className="st-btn st-btn-danger-solid" onClick={remove} disabled={!ready || busy}>
              {busy ? 'Deleting…' : 'Delete my account for good'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
