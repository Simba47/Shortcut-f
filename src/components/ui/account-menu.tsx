'use client'

import { openBrandKits } from '@/components/brand/brandKitsEvents'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSession, signOut } from 'next-auth/react'

/**
 * Profile button and menu. The button: a small profile photo and the name on a black rounded rectangle. The menu:
 * who you are, plan usage with Upgrade, account links, help
 * (keyboard shortcuts, support, what's new) and Sign out. Used in the dashboard, clip board, AI
 * edits and editor headers. (styles: .acct-* / .am-* / .dash-popover in app/globals.css)
 *
 * Pass `planInfo` when the page already has it; otherwise it's fetched here.
 * The editor passes `onNavigate` / `onSignOut` so it can save pending edits before leaving.
 *
 * Frontend only for now — rows marked "Soon" (invoices, brand kit) are
 * waiting for the backend. TODO(backend): wire them up.
 */

type PlanSummary = { planName: string; maxVideos: number; usage: { videos: number } }

const SUPPORT_WHATSAPP = 'https://wa.me/917702404917'

/** Keys the editor understands (see EditorShell's keydown handler) */
const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ['Space'], what: 'Play or pause' },
  { keys: ['←', '→'], what: 'Move 1 second back or forward' },
  { keys: ['Shift', '← / →'], what: 'Move 5 seconds back or forward' },
  { keys: ['S'], what: 'Trim: cut the section in two at the playhead' },
  { keys: ['['], what: 'Trim the selected section’s start to the playhead' },
  { keys: [']'], what: 'Trim the selected section’s end to the playhead' },
  { keys: ['Delete'], what: 'Delete what’s selected' },
  { keys: ['Ctrl', 'Z'], what: 'Undo' },
  { keys: ['Ctrl', 'Shift', 'Z'], what: 'Redo' },
  { keys: ['Esc'], what: 'Close a menu or dialog' },
]

/** The saved photo is checked against the session once per page load, not once per menu */
let photoChecked = false

const Icon = ({ d }: { d: React.ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)

export function AccountMenu({ planInfo, onNavigate, onSignOut }: {
  planInfo?: PlanSummary | null
  onNavigate?: (href: string) => void
  onSignOut?: () => void
}) {
  const { data: session, status, update } = useSession()
  const email = session?.user?.email ?? ''
  const fullName = session?.user?.name ?? ''
  // No name on the account: "narasimham.m@x.com" → "Narasimham"
  const first = email.split('@')[0].split(/[._+-]/)[0]
  const name = fullName || (first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Account')
  // Profile photo: the account's picture when it has one, otherwise the first letter of the name
  // (added in Account settings; a photo that won't load — removed on another device — falls back to the letter)
  const photo = session?.user?.image
  const [brokenPhoto, setBrokenPhoto] = useState<string | null>(null)
  // The session can be behind (a photo added or removed on another device, or before this sign-in
  // knew about photos): ask what's saved, and bring the session in line when it differs
  useEffect(() => {
    if (status !== 'authenticated' || photoChecked) return
    photoChecked = true
    fetch('/api/account/photo?info')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && (d.image ?? null) !== (photo ?? null)) update({ image: d.image ?? null }) })
      .catch(() => { photoChecked = false })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])
  const avatar = (
    <span className="acct-avatar" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photo && photo !== brokenPhoto ? <img src={photo} alt="" onError={() => setBrokenPhoto(photo)} /> : name.charAt(0).toUpperCase()}
    </span>
  )

  const [fetched, setFetched] = useState<PlanSummary | null>(null)
  useEffect(() => {
    if (planInfo !== undefined) return
    fetch('/api/billing/plan').then(r => (r.ok ? r.json() : null)).then(setFetched).catch(() => {})
  }, [planInfo])
  const plan = planInfo ?? fetched
  const used = plan ? Math.min(1, plan.usage.videos / Math.max(1, plan.maxVideos)) : 0
  const topPlan = plan?.planName?.toLowerCase() === 'agency' || plan?.planName?.toLowerCase() === 'business'

  const [open, setOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // "?" anywhere (outside a text box) opens the keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault(); setOpen(false); setShortcutsOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  // Keep the menu mounted briefly after closing so it can animate out
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (open) { setShown(true); return }
    if (!shown) return
    const t = setTimeout(() => setShown(false), 160)
    return () => clearTimeout(t)
  }, [open, shown])

  const go = (href: string) => (e: React.MouseEvent) => {
    if (!onNavigate) return
    e.preventDefault(); setOpen(false); onNavigate(href)
  }
  const soon = (label: string, icon: React.ReactNode) => (
    <div className="am-item" role="menuitem" aria-disabled="true" title={`${label} — coming soon`}>
      <Icon d={icon} /><span className="flex-1">{label}</span><span className="am-soon">Soon</span>
    </div>
  )

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* The button: a black rounded rectangle with the profile photo and the name */}
      <button className="acct-btn" aria-label={`Account menu for ${name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {avatar}
        <span className="acct-name">{name}</span>
      </button>

      {shown && (
        <div className={`dash-popover dash-account-menu am-menu${open ? '' : ' is-closing'}`} role="menu">
          {/* Who you are */}
          <div className="am-head">
            {avatar}
            <div className="min-w-0 flex-1">
              <p className="am-name">{name}</p>
              <p className="am-email" title={email}>{email}</p>
            </div>
          </div>

          {/* Plan and usage */}
          {plan && (
            <div className="am-usage">
              <div className="flex items-center justify-between">
                <span className="am-usage-plan">Plan</span>
                <span className="am-usage-count"><b>{plan.usage.videos}</b> / {plan.maxVideos} videos</span>
              </div>
              <div className="am-bar" aria-hidden="true"><span style={{ width: `${Math.max(3, used * 100)}%` }} data-high={used >= 0.85 || undefined} /></div>
              <a href="/pricing" onClick={go('/pricing')} className={topPlan ? 'am-cta am-cta-ghost' : 'am-cta'} role="menuitem">
                {topPlan ? 'Manage plan' : (<><Icon d={<path d="M13 2L4 14h7l-1 8 9-12h-7z" />} />Upgrade for more videos</>)}
              </a>
            </div>
          )}

          {/* Account */}
          <div className="am-group">
            <a href="/settings" onClick={go('/settings')} className="am-item" role="menuitem">
              <Icon d={<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></>} /><span className="flex-1">Account settings</span>
            </a>
            <a href="/pricing" onClick={go('/pricing')} className="am-item" role="menuitem">
              <Icon d={<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>} /><span className="flex-1">Plans &amp; billing</span>
            </a>
            {soon('Invoices', <><path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></>)}
            <button type="button" onClick={() => { setOpen(false); openBrandKits() }} className="am-item" role="menuitem">
              <Icon d={<><circle cx="13.5" cy="6.5" r="2" /><circle cx="17.5" cy="10.5" r="2" /><circle cx="8.5" cy="7.5" r="2" /><circle cx="6.5" cy="12.5" r="2" /><path d="M12 22a10 10 0 110-20 9 9 0 019 9c0 3-2 4-4 4h-2a2 2 0 00-1 3.7A2 2 0 0112 22z" /></>} /><span className="flex-1">Brand kits</span>
            </button>
          </div>

          {/* Help */}
          <div className="am-group">
            <button className="am-item" role="menuitem" onClick={() => { setOpen(false); setShortcutsOpen(true) }}>
              <Icon d={<><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 15h10" /></>} />
              <span className="flex-1">Keyboard shortcuts</span><kbd className="am-kbd">?</kbd>
            </button>
            <a href={SUPPORT_WHATSAPP} target="_blank" rel="noopener noreferrer" className="am-item" role="menuitem">
              <Icon d={<><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01" /></>} />
              <span className="flex-1">Help &amp; support</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.5 }}><path d="M7 17L17 7M8 7h9v9" /></svg>
            </a>
            <div className="am-item" role="menuitem" aria-disabled="true" title="What’s new — coming soon">
              <Icon d={<><path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7z" /></>} />
              <span className="flex-1">What’s new</span><span className="am-dot" aria-label="New" />
            </div>
          </div>

          {/* Sign out, then the legal links */}
          <div className="am-group">
            <button className="am-item am-signout" role="menuitem"
              onClick={() => { setOpen(false); if (onSignOut) onSignOut(); else signOut({ callbackUrl: '/login' }) }}>
              <Icon d={<><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>} />
              <span className="flex-1">Sign out</span>
            </button>
          </div>
          <p className="am-legal">
            <a href="/#faq">Privacy</a><span aria-hidden="true">·</span><a href="/#faq">Terms</a><span aria-hidden="true">·</span><span>Shortcut</span>
          </p>
        </div>
      )}

      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  )
}

/** Every keyboard shortcut, in a dialog (styles: .cfm-* for the frame, .am-sc-* for the list) */
function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="cfm-backdrop fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 300 }}
      onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="sc-title" className="cfm-card am-sc-card" data-tone="warning">
        <div className="w-full flex items-center justify-between mb-4">
          <p id="sc-title" className="cfm-title" style={{ margin: 0 }}>Keyboard shortcuts</p>
          <button onClick={onClose} aria-label="Close" className="am-sc-close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <p className="am-sc-sub">In the editing board</p>
        <ul className="am-sc-list">
          {SHORTCUTS.map(sc => (
            <li key={sc.what}>
              <span>{sc.what}</span>
              <span className="flex items-center gap-1 shrink-0">
                {sc.keys.map(k => <kbd key={k} className="am-kbd">{k}</kbd>)}
              </span>
            </li>
          ))}
        </ul>
        <p className="am-sc-sub" style={{ marginTop: 14 }}>On a Mac, use ⌘ instead of Ctrl.</p>
      </div>
    </div>,
    document.body,
  )
}
