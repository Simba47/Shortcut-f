'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { json, KitBadge, Switch, useBrandKits, type BrandKits } from '@/components/editor/BrandKit'
import { inviteLink, ROLE_NAMES, type KitInviteOut, type KitMember, type KitRole, type KitTeam as KitTeamState } from '@/lib/shared/brandTeam'
import { BRAND_KITS_CLOSED, openBrandKits } from './brandKitsEvents'

/**
 * A team's brand kits, from the profile menu on the top plan (user, 2026-11-10: out of the kit's steps):
 * pick one of your kits, then who it's shared with, as what, the invites out and its brand lock. Invites
 * from other people's kits are still answered in the Brand kits popup. Styles: .bkd-* in globals.css.
 */
export function BrandTeamDialog({ onClose }: { onClose: () => void }) {
  const brand = useBrandKits()
  // Esc closes it (not while typing), and the page behind doesn't scroll
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.stopPropagation(); onClose()
    }
    window.addEventListener('keydown', esc, true)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', esc, true); document.body.style.overflow = overflow }
  }, [onClose])
  // (a brand lock changed here: the editor's and clip board's views of the kits read them again)
  useEffect(() => () => { window.dispatchEvent(new Event(BRAND_KITS_CLOSED)) }, [])
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="bkd-overlay" role="dialog" aria-modal="true" aria-labelledby="team-title" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bk editor-theme bkd-box" style={{ maxWidth: 580, height: 'auto', maxHeight: 'min(680px, 100%)' }}>
        <header className="bkd-head">
          <h2 id="team-title" className="bkd-head-title">Team</h2>
          <span className="bkd-head-sub">Share your brand kits, so everyone&rsquo;s clips look the same</span>
          <span className="flex-1" />
          <button type="button" className="bkd-close" onClick={onClose} aria-label="Close team" title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col gap-4">
          <BrandTeamPanel brand={brand} onMakeKit={() => { onClose(); openBrandKits() }} />
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Which of your kits, and its team */
export function BrandTeamPanel({ brand, onMakeKit }: { brand: BrandKits; onMakeKit: () => void }) {
  const [pickedId, setPickedId] = useState<string | null>(null)
  // (a kit shared with you is its owner's to share)
  const own = brand.kits.filter(k => !k.shared_by)
  const kit = own.find(k => k.id === pickedId) ?? own.find(k => k.id === brand.current?.id) ?? own[0] ?? null
  if (brand.loading && !brand.kits.length) return <p className="text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Loading your brand kits…</p>
  if (brand.error) return <p role="alert" className="text-xs" style={{ color: '#fca5a5' }}>{brand.error}</p>
  if (!kit) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>Make a brand kit first, then share it with your team here.</p>
        <button type="button" className="bw-add" onClick={onMakeKit}>Make a brand kit</button>
      </div>
    )
  }
  return (
    <>
      <div className="flex items-center gap-3">
        <KitBadge kit={kit} />
        {own.length > 1
          ? (
            <div className="flex gap-1.5 flex-wrap flex-1 min-w-0" role="radiogroup" aria-label="Brand kit to share">
              {own.map(k => (
                <button key={k.id} type="button" role="radio" aria-checked={k.id === kit.id} className="bm-chip" data-on={k.id === kit.id || undefined} onClick={() => setPickedId(k.id)}>
                  <i className="bm-chip-dot" style={{ background: k.data.colors.main }} /><i className="bm-chip-dot" style={{ background: k.data.colors.accent }} />
                  {k.name}
                </button>
              ))}
            </div>
          )
          : <span className="text-[13px] font-semibold truncate text-[var(--ed-text)]">{kit.name}</span>}
      </div>
      <KitTeam key={kit.id} kitId={kit.id} lock={kit.data.lock} onLock={lock => brand.update(kit.id, { data: { ...kit.data, lock } })} />
    </>
  )
}

/** Who the kit is shared with (Agency) and as what, the invites out, and its brand lock (Phase 6) */
function KitTeam({ kitId, lock, onLock }: { kitId: string; lock: boolean; onLock: (on: boolean) => void }) {
  const [state, setState] = useState<KitTeamState | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<KitRole>('use')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const url = `/api/brand-kits/${kitId}/share`
  function send<T>(method: string, body: unknown): Promise<T> {
    return fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => json<T>(r))
  }
  useEffect(() => {
    let live = true
    setState(null); setNote(null); setDone(null)
    fetch(url).then(r => json<KitTeamState>(r))
      .then(s => { if (live) setState(s) }).catch(e => { if (live) setNote(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [url])
  const fail = (e: unknown) => setNote(e instanceof Error ? e.message : String(e))
  async function copyLink(id: string) {
    const link = inviteLink(window.location.origin, id)
    try {
      await navigator.clipboard.writeText(link)
      setCopied(id)
      setTimeout(() => setCopied(c => (c === id ? null : c)), 1600)
    } catch { setNote(`Copy is blocked by the browser — the link: ${link}`) }
  }
  async function invite(to = email.trim(), as: KitRole = role) {
    if (!to || busy) return
    setBusy(true); setNote(null); setDone(null)
    try {
      const r = await send<{ person?: KitMember; invite?: KitInviteOut }>('POST', { email: to, role: as })
      setState(s => s && {
        ...s,
        people: r.person ? s.people.map(p => (p.user_id === r.person!.user_id ? r.person! : p)) : s.people,
        invites: r.invite ? [...s.invites.filter(i => i.email !== r.invite!.email), r.invite] : s.invites,
      })
      setDone(r.person
        ? `${r.person.name || r.person.email} ${r.person.role === 'edit' ? 'can edit it' : 'can use it'} now.`
        : `Invite ready for ${to}. Its link is copied — send it to them.`)
      if (r.invite) await copyLink(r.invite.id)
      setEmail('')
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  async function changeRole(userId: string, r: KitRole) {
    setNote(null); setDone(null)
    try {
      await send('PATCH', { user_id: userId, role: r })
      setState(s => s && { ...s, people: s.people.map(p => (p.user_id === userId ? { ...p, role: r } : p)) })
    } catch (e) { fail(e) }
  }
  async function removePerson(userId: string) {
    setNote(null); setDone(null)
    try {
      await send('DELETE', { user_id: userId })
      setState(s => s && { ...s, people: s.people.filter(p => p.user_id !== userId) })
    } catch (e) { fail(e) }
  }
  async function takeBack(id: string) {
    setNote(null); setDone(null)
    try {
      await send('DELETE', { invite_id: id })
      setState(s => s && { ...s, invites: s.invites.filter(i => i.id !== id) })
    } catch (e) { fail(e) }
  }
  if (!state) return <p className="text-[11px]" style={{ color: note ? '#fca5a5' : 'rgb(var(--ed-fg) / 0.45)' }}>{note ?? 'Loading…'}</p>
  if (!state.can_share) {
    return (
      <p className="text-[11px] leading-relaxed" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
        Share this kit with your team so everyone&rsquo;s clips look the same — on the Agency plan.
        {state.people.length > 0 && ` The ${state.people.length === 1 ? 'person' : `${state.people.length} people`} you shared it with can use it again once your plan shares kits.`}{' '}
        <a href="/pricing" className="font-semibold hover:underline" style={{ color: 'var(--ed-accent-text)' }}>Upgrade</a>
      </p>
    )
  }
  const open = state.invites.filter(i => !i.expired).length
  const used = state.people.length + open
  const full = used >= state.seats
  const muted = { color: 'rgb(var(--ed-fg) / 0.45)' }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] -mt-1 leading-relaxed" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
        Invite people by email. They accept it in their Brand kits: copy the invite&rsquo;s link and send it to them. {used} of {state.seats} places used.
      </p>
      <div className="flex gap-2">
        <input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') invite() }} type="email" maxLength={200}
          placeholder="Their email" aria-label="Email to invite"
          className="flex-1 min-w-0 h-9 px-3 rounded-lg text-sm text-[var(--ed-text)] outline-none"
          style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }} />
        <RolePick value={role} onChange={setRole} label="What they can do" />
        <button type="button" onClick={() => invite()} disabled={busy || !email.trim() || full} className="bw-add">
          {busy ? 'Inviting…' : 'Invite'}
        </button>
      </div>
      <p className="text-[11px] leading-relaxed -mt-1" style={muted}>Can use: puts the kit on their clips. Can edit: changes the kit too — not its team or brand lock.</p>
      {full && <p className="text-[11px]" style={{ color: '#fbbf24' }}>All {state.seats} places are taken: remove someone or take back an invite first.</p>}
      {note && <p role="alert" className="text-[11px] break-words" style={{ color: '#fca5a5' }}>{note}</p>}
      {done && !note && <p role="status" className="text-[11px]" style={{ color: 'var(--ed-accent-text)' }}>{done}</p>}
      {state.people.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="cap-label">Team</span>
          <ul className="flex flex-col gap-1.5" aria-label="Shared with">
            {state.people.map(p => (
              <li key={p.user_id} className="flex items-center gap-2 text-xs">
                <span className="flex-1 min-w-0 truncate text-[var(--ed-text)]">{p.name || p.email}{p.name && p.email ? <span style={muted}> · {p.email}</span> : null}</span>
                <RolePick value={p.role} onChange={r => changeRole(p.user_id, r)} label={`What ${p.name || p.email} can do`} />
                <button type="button" onClick={() => removePerson(p.user_id)} aria-label={`Remove ${p.email ?? p.name}`}
                  className="text-[11px] shrink-0 hover:underline" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Remove</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.invites.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="cap-label">Invited</span>
          <ul className="flex flex-col gap-1.5" aria-label="Invited">
            {state.invites.map(i => (
              <li key={i.id} className="flex items-center gap-2 text-xs">
                <span className="flex-1 min-w-0 truncate text-[var(--ed-text)]">{i.email}<span style={muted}> · {ROLE_NAMES[i.role]} · {i.expired ? 'expired' : 'waiting'}</span></span>
                {i.expired
                  ? <button type="button" className="text-[11px] font-semibold shrink-0 hover:underline" style={{ color: 'var(--ed-accent-text)' }} onClick={() => invite(i.email, i.role)}>Invite again</button>
                  : <button type="button" className="text-[11px] font-semibold shrink-0 hover:underline" style={{ color: copied === i.id ? '#4ade80' : 'var(--ed-accent-text)' }} onClick={() => copyLink(i.id)}>{copied === i.id ? 'Link copied' : 'Copy link'}</button>}
                <button type="button" onClick={() => takeBack(i.id)} aria-label={`Take back the invite to ${i.email}`}
                  className="text-[11px] shrink-0 hover:underline" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Take back</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="cap-row cursor-pointer select-none">
        <span className="flex flex-col min-w-0">
          <span className="cap-label">Brand lock</span>
          <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
            {lock
              ? 'On clips with this kit, people who can use it keep to its colours and fonts, and can’t take it off'
              : 'Off: your team picks any colour and font'}
          </span>
        </span>
        <Switch on={lock} label="Brand lock" onChange={onLock} />
      </label>
    </div>
  )
}

/** "Can use" or "Can edit" */
function RolePick({ value, onChange, label }: { value: KitRole; onChange: (r: KitRole) => void; label: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value === 'edit' ? 'edit' : 'use')} aria-label={label}
      className="h-9 px-2 rounded-lg text-xs text-[var(--ed-text)] outline-none shrink-0"
      style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }}>
      <option value="use">{ROLE_NAMES.use}</option>
      <option value="edit">{ROLE_NAMES.edit}</option>
    </select>
  )
}
