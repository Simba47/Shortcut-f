'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import type { Tone } from '@/lib/notices'
import { ConfirmDialog } from '@/components/editor/ConfirmDialog'
import { defaultMs, dismissToast, useNotices, type Toast } from './store'
import './notices.css'

/** A tone's mark (or the padlock / copy sign): tick, i, triangle, ! */
export function NoticeIcon({ tone, icon, size = 14 }: { tone: Tone; icon?: 'lock' | 'copy'; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  if (icon === 'lock') return <svg {...p}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
  if (icon === 'copy') return <svg {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" /></svg>
  if (tone === 'ok') return <svg {...p}><path d="M5 12.5l4.2 4.2L19 7" /></svg>
  if (tone === 'warn') return <svg {...p}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L2.4 17.6A2 2 0 004.1 20.6h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /></svg>
  if (tone === 'error') return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>
  return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 16v-4.5M12 8h.01" /></svg>
}

function CloseIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
}

// ── Toasts ───────────────────────────────────────────────────────────────────

function ToastItem({ t }: { t: Toast }) {
  // Its own timer: paused while pointed at or focused (user can read it), started over when shown again
  const ms = t.live ? null : t.ms === undefined ? defaultMs(t.tone) : t.ms
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const left = useRef(ms ?? 0)
  const since = useRef(0)
  const run = () => {
    if (ms == null) return
    since.current = Date.now()
    timer.current = setTimeout(() => dismissToast(t.id), left.current)
  }
  const hold = () => {
    if (!timer.current) return
    clearTimeout(timer.current); timer.current = null
    left.current = Math.max(1200, left.current - (Date.now() - since.current))
  }
  useEffect(() => {
    left.current = ms ?? 0
    run()
    return () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.n, ms])
  const a = t.action
  return (
    <div className="nt nt-toast" data-tone={t.tone} data-live={t.live ? '' : undefined}
      role={t.tone === 'error' ? 'alert' : 'status'}
      onPointerEnter={hold} onPointerLeave={run} onFocus={hold} onBlur={run}>
      <span className="nt-ico"><NoticeIcon tone={t.tone} icon={t.icon} size={14} /></span>
      <span className="nt-toast-text">{t.text}</span>
      {a && (a.href
        // (a file from the server — a download — is a plain link; a page of the site goes through the router)
        ? a.href.startsWith('/api/')
          ? <a href={a.href} download className="nt-act" onClick={() => { a.onClick?.(); dismissToast(t.id) }}>{a.label}</a>
          : <Link href={a.href} className="nt-act" onClick={() => { a.onClick?.(); dismissToast(t.id) }}>{a.label}</Link>
        : <button type="button" className="nt-act" onClick={() => { dismissToast(t.id); a.onClick?.() }}>{a.label}</button>)}
      {!t.live && (
        <button type="button" className="nt-x" aria-label="Close this message" onClick={() => dismissToast(t.id)}><CloseIcon /></button>
      )}
    </div>
  )
}

/** The stack of toasts, bottom centre of every page (in Providers) */
export function Toaster() {
  const toasts = useNotices(s => s.toasts)
  if (!toasts.length) return null
  return (
    <div className="nt-toasts" aria-live="polite">
      {toasts.map(t => <ToastItem key={t.id} t={t} />)}
    </div>
  )
}

// ── Alert card ───────────────────────────────────────────────────────────────

/**
 * Something the user pressed failed (or, amber, needs a look): what failed, why and what to do, Try again and
 * ×. `float`: the editor's, top right under Export; otherwise in its place in the page.
 */
export function AlertCard({ tone = 'error', title, detail, children, onRetry, retryLabel = 'Try again', retryDisabled, onClose, float, className, style }: {
  tone?: 'error' | 'warn' | 'info' | 'ok'
  title: React.ReactNode
  detail?: React.ReactNode
  /** Beside the detail (a Buy credits link) */
  children?: React.ReactNode
  onRetry?: () => void
  retryLabel?: string
  retryDisabled?: boolean
  onClose?: () => void
  float?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`nt nt-card${className ? ` ${className}` : ''}`} data-tone={tone} data-float={float ? '' : undefined} style={style}>
      <span className="nt-ico"><NoticeIcon tone={tone} /></span>
      <span className="flex-1 min-w-0">
        <span className="nt-card-title">{title}</span>
        {(detail || children) && <span className="nt-card-text">{detail}{children}</span>}
        {onRetry && (
          <span className="nt-card-acts">
            <button type="button" className="nt-btn" onClick={onRetry} disabled={retryDisabled}>{retryLabel}</button>
          </span>
        )}
      </span>
      {onClose && <button type="button" className="nt-x" aria-label="Dismiss this message" onClick={onClose}><CloseIcon /></button>}
    </div>
  )
}

// ── Field message ────────────────────────────────────────────────────────────

/** What to fix in the box above it: a wrong link, passwords that don't match */
export function FieldMessage({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <p role="alert" id={id} className={`nt nt-field${className ? ` ${className}` : ''}`}>
      <span className="nt-ico"><NoticeIcon tone="error" size={13} /></span>
      <span>{children}</span>
    </p>
  )
}

// ── Confirm, from anywhere ───────────────────────────────────────────────────

/** Shows askConfirm's question (in Providers) */
export function ConfirmHost() {
  const pending = useNotices(s => s.confirm)
  if (!pending) return null
  const { resolve, ...options } = pending
  const close = () => useNotices.setState(s => (s.confirm === pending ? { confirm: null } : s))
  return (
    <ConfirmDialog {...options}
      onConfirm={checked => resolve(true, checked)}
      onCancel={() => resolve(false, false)}
      // (the dialog closes before it says which button: an answer given right after wins, a promise
      // takes only its first; Esc or a click outside gives none, so it ends as false)
      onClose={() => { close(); queueMicrotask(() => resolve(false, false)) }} />
  )
}
