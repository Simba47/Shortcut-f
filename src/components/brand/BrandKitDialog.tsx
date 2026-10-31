'use client'

import { useEffect, useState } from 'react'
import { useBrandKits, BrandKitStudio } from '@/components/editor/BrandKit'
import type { BrandKit } from '@/lib/shared/brandKit'
import { ROLE_NAMES, type KitInviteIn } from '@/lib/shared/brandTeam'
import { BRAND_KITS_OPEN, BRAND_KITS_CLOSED, type BrandKitsStart } from './brandKitsEvents'

export { openBrandKits, BRAND_KITS_CLOSED } from './brandKitsEvents'

/**
 * Brand kits as a popup over the page (user, 2026-10-31: "remove the Brand kits page and its loading page —
 * from the dashboard and the clip board a popup with the editing panel"). Your kits on the left (pick one,
 * a new one, make default, delete; invites from other people's kits), the kit's editing panel beside them
 * (BrandKitStudio: the steps, the settings and the "On your clip" look). It opens at once: while the kits
 * load, a small line inside it. Done, ✕, Esc or a click outside closes it.
 *
 * Opened from anywhere with openBrandKits() (the host sits in the app's providers); the /brand address only
 * forwards to /dashboard?brand=open (a team invite link in an email: &invite=<id>). Styles: .bkd-* in globals.css.
 */

type Start = BrandKitsStart

/** In the app's providers: shows the popup when asked (openBrandKits, or ?brand=open in the address) */
export function BrandKitDialogHost() {
  const [start, setStart] = useState<Start | null>(null)
  useEffect(() => {
    const onOpen = (e: Event) => setStart((e as CustomEvent<Start>).detail ?? {})
    window.addEventListener(BRAND_KITS_OPEN, onOpen)
    // ?brand=open (the /brand address forwards here: a team invite link, an old link to the page)
    const p = new URLSearchParams(window.location.search)
    if (p.get('brand') === 'open') {
      setStart({ kitId: p.get('kit') ?? undefined, invite: p.get('invite') ?? undefined })
      for (const k of ['brand', 'kit', 'invite', 'view']) p.delete(k)
      window.history.replaceState(null, '', window.location.pathname + (p.size ? `?${p}` : ''))
    }
    return () => window.removeEventListener(BRAND_KITS_OPEN, onOpen)
  }, [])
  if (!start) return null
  return <BrandKitDialog start={start} onClose={() => { setStart(null); window.dispatchEvent(new Event(BRAND_KITS_CLOSED)) }} />
}

function BrandKitDialog({ start, onClose }: { start: Start; onClose: () => void }) {
  const brand = useBrandKits()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [answering, setAnswering] = useState<string | null>(null)
  const [linked, setLinked] = useState<string | null>(start.invite ?? null)

  // The kit asked for (a link to one), once the kits are in
  useEffect(() => {
    if (!brand.loading && start.kitId && brand.kits.some(k => k.id === start.kitId)) brand.select(start.kitId)
  }, [brand.loading]) // eslint-disable-line react-hooks/exhaustive-deps
  // Esc closes it (not while typing), and the page behind doesn't scroll
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (confirm) { setConfirm(null); return }
      onClose()
    }
    window.addEventListener('keydown', esc)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = overflow }
  }, [onClose, confirm])

  const own = brand.kits.filter(k => !k.shared_by)
  const shared = brand.kits.filter(k => k.shared_by)
  const atLimit = own.length >= brand.limit

  async function newKit() {
    if (busy || atLimit) return
    setBusy(true); setError(null)
    try {
      const kit = await brand.create()
      // (the first brand is the one new clips get)
      if (!own.some(k => k.data.is_default)) brand.update(kit.id, { data: { ...kit.data, is_default: true } })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  /** One kit the default: the others aren't any more (the server keeps just one too) */
  function makeDefault(kit: BrandKit) {
    for (const k of own) if (k.id !== kit.id && k.data.is_default) brand.update(k.id, { data: { ...k.data, is_default: false } })
    brand.update(kit.id, { data: { ...kit.data, is_default: true } })
  }
  async function remove(kit: BrandKit) {
    setConfirm(null); setError(null)
    try { await (kit.shared_by ? brand.leave(kit.id) : brand.remove(kit.id)) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  async function answer(inv: KitInviteIn, accept: boolean) {
    setAnswering(inv.id); setError(null)
    try { await brand.answerInvite(inv.id, accept); if (linked === inv.id) setLinked(null) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setAnswering(null) }
  }

  const row = (k: BrandKit) => {
    const d = k.data
    const isOn = brand.current?.id === k.id
    const isDefault = d.is_default && !k.shared_by
    const handle = d.handle ? `@${d.handle.replace(/^@+/, '')}` : null
    return (
      <li key={k.id} className="bkd-kit" data-on={isOn || undefined}>
        <button type="button" className="bkd-kit-face" onClick={() => brand.select(k.id)} aria-current={isOn || undefined}>
          <span className="bkd-kit-logo" style={{ background: d.colors.main }}>
            {d.logo.path && k.logo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={k.logo_url} alt="" />
              : <b>{k.name.trim().charAt(0).toUpperCase() || 'B'}</b>}
          </span>
          <span className="flex-1 min-w-0 flex flex-col">
            <span className="bkd-kit-name">{k.name}</span>
            <span className="bkd-kit-meta">{k.shared_by ? `By ${k.shared_by} · ${ROLE_NAMES[k.role ?? 'use']}` : handle ?? 'No @handle yet'}</span>
          </span>
          <span className="bkd-dots" aria-hidden="true"><i style={{ background: d.colors.main }} /><i style={{ background: d.colors.accent }} /></span>
        </button>
        {confirm === k.id ? (
          <div className="bkd-kit-foot" role="alert">
            <span className="flex-1">{k.shared_by ? 'Stop using it?' : 'Delete this kit?'}</span>
            <button type="button" className="bkd-link" onClick={() => setConfirm(null)}>No</button>
            <button type="button" className="bkd-link bkd-danger" onClick={() => remove(k)}>{k.shared_by ? 'Stop' : 'Delete'}</button>
          </div>
        ) : (isOn || isDefault) && (
          <div className="bkd-kit-foot">
            {isDefault
              ? <span className="bkd-tag" title="New clips — and Make my clips — get this brand by themselves">Default</span>
              : !k.shared_by && <button type="button" className="bkd-link" onClick={() => makeDefault(k)} title="New clips — and Make my clips — get this brand by themselves">Make default</button>}
            <span className="flex-1" />
            {isOn && (
              <button type="button" className="bkd-icon" onClick={() => setConfirm(k.id)} title={k.shared_by ? 'Stop using this kit' : 'Delete this kit'} aria-label={k.shared_by ? `Leave ${k.name}` : `Delete ${k.name}`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {k.shared_by ? <path d="M15 4h4v16h-4M10 17l-5-5 5-5M5 12h11" /> : <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4h6v3" />}
                </svg>
              </button>
            )}
          </div>
        )}
      </li>
    )
  }

  const loading = brand.loading && !brand.kits.length
  return (
    <div className="bkd-overlay" role="dialog" aria-modal="true" aria-labelledby="bkd-title" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bk editor-theme bkd-box">
        {/* Its own title bar, so it reads as a window over the page (user, 2026-10-31): Brand kits · ✕ */}
        <header className="bkd-head">
          <span className="bkd-head-ico" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r="2" /><circle cx="17.5" cy="10.5" r="2" /><circle cx="8.5" cy="7.5" r="2" /><circle cx="6.5" cy="12.5" r="2" /><path d="M12 22a10 10 0 110-20 9 9 0 019 9c0 3-2 4-4 4h-2a2 2 0 00-1 3.7A2 2 0 0112 22z" /></svg>
          </span>
          <h2 id="bkd-title" className="bkd-head-title">Brand kits</h2>
          <span className="bkd-head-sub">Your logo, colours and caption look — on every clip</span>
          <span className="flex-1" />
          <button type="button" className="bkd-close" onClick={onClose} aria-label="Close brand kits" title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        {loading ? (
          // (in the middle of the whole window, not beside an empty kits column)
          <div className="bkd-loading" role="status">
            <span className="bkd-spin" aria-hidden="true" />
            <span>Loading your brand kits…</span>
          </div>
        ) : (
          <div className="bkd-body">
          {/* Your kits */}
          <aside className="bkd-side" aria-label="Your brand kits">
            <div className="bkd-side-head">
              <span>Your kits</span>
              {!brand.loading && <span className="tabular-nums">{own.length} of {brand.limit}</span>}
            </div>
            {brand.invites.length > 0 && (
              <ul className="bkd-invites" aria-label="Invites">
                {brand.invites.map(inv => (
                  <li key={inv.id} className="bkd-invite" data-linked={linked === inv.id || undefined}>
                    <strong>{inv.kit_name}</strong>
                    <span>{inv.by} invited you · {ROLE_NAMES[inv.role]}</span>
                    <span className="flex gap-2 mt-1">
                      <button type="button" className="bkd-btn" disabled={answering === inv.id} onClick={() => answer(inv, true)}>{answering === inv.id ? 'Joining…' : 'Accept'}</button>
                      <button type="button" className="bkd-link" disabled={answering === inv.id} onClick={() => answer(inv, false)}>Decline</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {linked && !brand.loading && !brand.invites.some(i => i.id === linked) && (
              <p className="bkd-note">That invite isn&rsquo;t waiting for this account (another email, taken back, expired or already accepted). <button type="button" className="bkd-link" onClick={() => setLinked(null)}>OK</button></p>
            )}
            <ul className="bkd-kits">{own.map(row)}</ul>
            {!brand.loading && (
              <button type="button" className="bkd-new" onClick={newKit} disabled={busy || atLimit} title={atLimit ? 'Your plan has room for no more kits' : undefined}>
                {busy ? 'Making it…' : '+ New brand kit'}
              </button>
            )}
            {atLimit && own.length > 0 && <p className="bkd-note">Your plan has room for {brand.limit}. <a href="/pricing">Upgrade</a> for more.</p>}
            {shared.length > 0 && (
              <>
                <div className="bkd-side-head mt-2"><span>Shared with you</span></div>
                <ul className="bkd-kits">{shared.map(row)}</ul>
              </>
            )}
            {(error || brand.error) && <p className="bkd-error" role="alert">{error ?? brand.error}</p>}
          </aside>

            {/* The kit's editing panel */}
            <div className="bkd-main">
              {!brand.current ? (
                <div className="bkd-center flex-col text-center gap-3">
                  <h2 className="text-lg font-bold text-[var(--ed-text)]">Set up your brand in a minute</h2>
                  <p className="text-sm max-w-sm" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>Paste your website or Instagram link — we bring in your logo and colours. Pick a caption look, and every new clip comes out on-brand.</p>
                  <button type="button" className="bkd-btn bkd-btn-lg" onClick={newKit} disabled={busy}>{busy ? 'Getting it ready…' : 'Set up my brand'}</button>
                </div>
              ) : (
                <BrandKitStudio brand={brand} onClose={onClose} closeLabel="Close" />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
