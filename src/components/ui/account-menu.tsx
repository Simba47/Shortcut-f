'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CreditHistory } from '@/components/billing/BillingCards'
import { useSession, signOut } from 'next-auth/react'
import { SHORTCUT_GROUPS } from '@/lib/shortcuts'
import { privacyCards, PRIVACY_DOC } from '@/components/legal/privacyDoc'
import { termsCards, TERMS_DOC } from '@/components/legal/termsDoc'
import { COMPANY } from '@/lib/company'
import { BrandTeamDialog } from '@/components/brand/BrandTeamDialog'
import { formatStorage } from '@/lib/storage'
import { isTopPlan } from '@/lib/plans'

/**
 * Profile button and menu. The button: a small profile photo and the name on a black rounded rectangle. The menu:
 * who you are, plan usage with Upgrade, account links, help
 * (keyboard shortcuts, support) and Sign out, then Privacy and Terms (each read in a popup over the page). Used in the dashboard, clip board, AI
 * edits and editor headers. (styles: .acct-* / .am-* / .dash-popover in app/globals.css)
 *
 * Pass `planInfo` when the page already has it; otherwise it's fetched here.
 * The editor passes `onNavigate` / `onSignOut` so it can save pending edits before leaving.
 *
 * Frontend only for now — rows marked "Soon" (invoices, brand kit) are
 * waiting for the backend. TODO(backend): wire them up.
 */

type PlanSummary = { plan?: string; planName: string; storageGb: number; storageBytes: number; usage: { videos: number; storageBytes: number } }

export type Tier = 'none' | 'trial' | 'starter' | 'creator' | 'agency'
/**
 * A plan's tier from its key (lib/plans.ts: free = "No plan" since 2026-11-16, trial, starter, creator, agency),
 * else its name; an unknown paid one counts as the top
 */
function tierOf(key: string | undefined, name: string): Tier {
  const n = (key ?? name).toLowerCase()
  if (n === 'free' || n === 'no plan') return 'none'
  return n === 'trial' || n === 'starter' || n === 'creator' ? n : 'agency'
}
/**
 * Each plan's own symbol beside its name (user, 2026-11-16: "a special symbol for every plan"):
 * No plan an empty dashed ring, Trial a sprout (trying it out), Starter a bolt (getting going), Creator
 * sparkles (making things), Agency a crown (the top). Grey with no plan, lime on the paid ones (.am-plan-sym).
 * The landing page's pricing cards show the same symbols (components/ui/pricing.tsx).
 */
export function PlanSymbol({ tier, size = 12, className = 'am-plan-sym' }: { tier: Tier; size?: number; className?: string }) {
  const d = {
    none: <circle cx="12" cy="12" r="7.5" strokeDasharray="3.2 3" />,
    trial: <><path d="M12 21v-8" /><path d="M12 13c0-4 2.6-6.5 7-6.5 0 4.2-2.7 6.5-7 6.5z" fill="currentColor" fillOpacity=".25" /><path d="M12 15.5c0-3.2-2-5.2-5.6-5.2 0 3.3 2.1 5.2 5.6 5.2z" fill="currentColor" fillOpacity=".25" /></>,
    starter: <path d="M13.2 2.5 5 13.6h6.1l-1.1 7.9 8.2-11.1h-6.1z" fill="currentColor" stroke="none" />,
    creator: <><path d="M10 3.5c.7 3.9 2.6 5.8 6.5 6.5-3.9.7-5.8 2.6-6.5 6.5-.7-3.9-2.6-5.8-6.5-6.5 3.9-.7 5.8-2.6 6.5-6.5z" fill="currentColor" stroke="none" /><path d="M18 14.5c.35 1.9 1.25 2.8 3.1 3.1-1.85.35-2.75 1.25-3.1 3.1-.35-1.85-1.25-2.75-3.1-3.1 1.85-.3 2.75-1.2 3.1-3.1z" fill="currentColor" stroke="none" /></>,
    agency: <><path d="M3.5 8.5 8 12l4-6.5 4 6.5 4.5-3.5-1.8 9.5H5.3z" fill="currentColor" stroke="none" /><path d="M5.6 20.5h12.8" /></>,
  }[tier]
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
  )
}

const SUPPORT_WHATSAPP = 'https://wa.me/917702404917'

/** Opens the keyboard shortcuts from anywhere (the editor's ⌨ button): the account menu shows them */
const OPEN_SHORTCUTS = 'shortcut:open-shortcuts'
export function openShortcuts() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_SHORTCUTS))
}

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
  // The plan's storage used (plans v2, 2026-11-21: GB, not a count of videos)
  const used = plan ? Math.min(1, (plan.usage.storageBytes ?? 0) / Math.max(1, plan.storageBytes ?? 0)) : 0
  // The top plan: Pro since 2026-11-21 (key 'creator'; Agency, no longer sold, too): no upgrade to offer, and its brand kits can be shared (Team)
  const topPlan = isTopPlan(plan?.plan)

  const [open, setOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [teamOpen, setTeamOpen] = useState(false)
  // Privacy or Terms, read in a popup over the page (user, 2026-11-05: not a jump to their pages)
  const [legal, setLegal] = useState<LegalDoc | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  // "?" anywhere (outside a text box) opens the keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault(); setOpen(false); setShortcutsOpen(true)
    }
    // (and the editor's ⌨ button: openShortcuts())
    const onOpen = () => { setOpen(false); setShortcutsOpen(true) }
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_SHORTCUTS, onOpen)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_SHORTCUTS, onOpen) }
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
                {/* Which plan (user, 2026-11-16: "the user should know which plan they're on"): its name as a
                    badge with the plan's own symbol (PlanSymbol), richer the higher the plan */}
                <span className="am-usage-plan">
                  <span className="am-plan-chip" data-tier={tierOf(plan.plan, plan.planName)}><PlanSymbol tier={tierOf(plan.plan, plan.planName)} />{plan.planName}</span>
                  {/* ("No plan" is already the whole name) */}
                  {tierOf(plan.plan, plan.planName) !== 'none' && <span className="am-plan-word">plan</span>}
                </span>
                <span className="am-usage-count"><b>{formatStorage(plan.usage.storageBytes ?? 0)}</b> / {plan.storageGb} GB</span>
              </div>
              <div className="am-bar" aria-hidden="true"><span style={{ width: `${Math.max(3, used * 100)}%` }} data-high={used >= 0.85 || undefined} /></div>
              <a href="/pricing" onClick={go('/pricing')} className={topPlan ? 'am-cta am-cta-ghost' : 'am-cta'} role="menuitem">
                {topPlan ? 'Manage plan' : (<><Icon d={<path d="M13 2L4 14h7l-1 8 9-12h-7z" />} />Upgrade for more space</>)}
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
            {/* (user, 2026-11-19) the credit history, in a popup over the page (no page change, the editor too) */}
            <button className="am-item" role="menuitem" onClick={() => { setOpen(false); setHistoryOpen(true) }}>
              <Icon d={<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>} /><span className="flex-1">Credit history</span>
            </button>
            {/* (the top plan: its brand kits shared with a team — user, 2026-11-10) */}
            {topPlan && (
              <button className="am-item" role="menuitem" onClick={() => { setOpen(false); setTeamOpen(true) }}>
                <Icon d={<><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0114 0M16 4a4 4 0 010 8M18 15a6 6 0 014 6" /></>} /><span className="flex-1">Team</span>
              </button>
            )}
          </div>

          {/* Help */}
          <div className="am-group">
            <a href="/guide" onClick={go('/guide')} className="am-item" role="menuitem">
              <Icon d={<><path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5v14z" /><path d="M4 19.5A2.5 2.5 0 006.5 22H20v-5" /></>} /><span className="flex-1">Guide</span>
            </a>
            <button className="am-item" role="menuitem" onClick={() => { setOpen(false); setShortcutsOpen(true) }}>
              <Icon d={<><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 15h10" /></>} />
              <span className="flex-1">Keyboard shortcuts</span><kbd className="am-kbd">?</kbd>
            </button>
            <a href={SUPPORT_WHATSAPP} target="_blank" rel="noopener noreferrer" className="am-item" role="menuitem">
              <Icon d={<><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01" /></>} />
              <span className="flex-1">Help &amp; support</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.5 }}><path d="M7 17L17 7M8 7h9v9" /></svg>
            </a>
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
            <button type="button" onClick={() => { setOpen(false); setLegal('privacy') }}>Privacy</button><span aria-hidden="true">·</span>
            <button type="button" onClick={() => { setOpen(false); setLegal('terms') }}>Terms</button><span aria-hidden="true">·</span><span>Shortcut</span>
          </p>
        </div>
      )}

      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {historyOpen && <CreditHistoryDialog onClose={() => setHistoryOpen(false)} />}
      {teamOpen && <BrandTeamDialog onClose={() => setTeamOpen(false)} />}
      {legal && <LegalDialog doc={legal} onDoc={setLegal} onClose={() => setLegal(null)} />}
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
  const mac = /Mac|iPhone|iPad/.test(navigator.platform)
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
        {/* In the editing board, grouped as they're used; Ctrl is ⌘ on a Mac */}
        <div className="am-sc-groups">
          {SHORTCUT_GROUPS.map(g => (
            <section key={g.title}>
              <p className="am-sc-sub">{g.title}</p>
              <ul className="am-sc-list">
                {g.items.map(sc => (
                  <li key={sc.what}>
                    <span>{sc.what}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {sc.keys.map(k => <kbd key={k} className="am-kbd">{mac && k === 'Ctrl' ? '⌘' : k}</kbd>)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * The credit history in a popup over the page (user, 2026-11-19: from the account menu), the frame as Keyboard
 * shortcuts' (.cfm-*, .am-sc-*), the list inside from components/billing (CreditHistory). Esc, ✕ or a click
 * outside closes it.
 */
function CreditHistoryDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="cfm-backdrop fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 300 }}
      onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="ch-title" className="cfm-card am-sc-card am-ch-card" data-tone="warning">
        <div className="w-full flex items-center justify-between mb-3">
          <p id="ch-title" className="cfm-title" style={{ margin: 0 }}>Credit history</p>
          <button onClick={onClose} aria-label="Close" className="am-sc-close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <CreditHistory />
      </div>
    </div>,
    document.body,
  )
}

type LegalDoc = 'privacy' | 'terms'
/**
 * Privacy Policy or Terms, in a popup over the page (styles: .cfm-* for the frame, .am-lg-* inside):
 * the same words as their pages (components/legal), numbered, scrolling inside the popup. Terms'
 * link to the Privacy Policy switches the popup to it. Esc, ✕ or a click outside closes it.
 */
function LegalDialog({ doc, onDoc, onClose }: { doc: LegalDoc; onDoc: (d: LegalDoc) => void; onClose: () => void }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  // (switched from Terms to Privacy: from its top)
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [doc])
  if (typeof document === 'undefined') return null
  const info = doc === 'privacy' ? PRIVACY_DOC : TERMS_DOC
  const cards = doc === 'privacy' ? privacyCards
    : termsCards(<button type="button" className="am-lg-link" onClick={() => onDoc('privacy')}>Privacy Policy</button>)
  return createPortal(
    <div className="cfm-backdrop fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 300 }}
      onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="lg-title" className="cfm-card am-lg-card" data-tone="warning">
        <div className="am-lg-head">
          <div className="min-w-0">
            <p id="lg-title" className="cfm-title" style={{ margin: 0 }}>{info.title}</p>
            <p className="am-lg-date">Last updated {info.updated}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="am-sc-close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div ref={bodyRef} className="am-lg-body">
          {cards.map(({ icon: CardIcon, title, body }, i) => (
            <section key={title} className="am-lg-row">
              <span className="am-lg-icon"><CardIcon aria-hidden /></span>
              <div className="min-w-0">
                <h3>{i + 1}. {title}</h3>
                <p>{body}</p>
              </div>
            </section>
          ))}
          <p className="am-lg-copy">© {new Date().getFullYear()} {COMPANY.legalName}</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
