'use client'

import { BrandTagIcon } from '@/components/brand/BrandTagIcon'
import { openBrandKits, BRAND_KITS_CLOSED } from '@/components/brand/brandKitsEvents'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The brand on the clip board (brand kit rebuild, Phase 2, 2026-10-27): which kit each clip has (a
 * tag on its card), and "Put on all clips" — one kit on every clip of the video, or the brand off
 * them all (the server's brand engine: services/brandApply.ts). Kept apart from the clip board
 * itself (ClipPickerShell.tsx), which only places these.
 */

interface KitLite { id: string; name: string; isDefault: boolean; main: string; accent: string }
/** "Off" in the kit picker (user, 2026-11-10; "None" until 2026-11-12, and picked first since then): the bar's button then takes the brand off */
const NO_KIT = 'none'

export interface ClipBrands {
  kits: KitLite[]
  /** The kit on a clip (null: none) */
  kitOf: (clipId: string) => KitLite | null
  /** The kit "Put on all" and "+ Brand" use: the one picked, else the default, else the first */
  pick: string
  setPick: (id: string) => void
  branded: number
  /** What's being changed: 'all', or one clip's id */
  busy: string | null
  /** While several clips are changed: how many are done, of how many, and whether the brand goes on or off */
  progress: { done: number; total: number; on: boolean } | null
  /** The kits have been read (until then the bar shows a placeholder, not "Make a brand kit") */
  loaded: boolean
  note: { text: string; bad: boolean } | null
  applyAll: (kitId: string | null) => Promise<void>
  /** The kit (or none) on just these clips — the ones ticked with Select */
  applyTo: (clipIds: string[], kitId: string | null) => Promise<void>
  setClip: (clipId: string, kitId: string | null) => Promise<void>
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Something went wrong. Please try again.')
  return body as T
}

/**
 * The user's kits and each clip's kit, read again when the clips change (Make my clips adds some).
 * `onChanged`: the clips whose brand was just put on, swapped or taken off (their previews are out of date)
 */
export function useClipBrands(videoId: string, clipIds: string[], onChanged?: (clipIds: string[]) => void): ClipBrands {
  const [kits, setKits] = useState<KitLite[]>([])
  const [kitsLoaded, setKitsLoaded] = useState(false)
  const [of, setOf] = useState<Record<string, string | null>>({})
  const [clipsLoaded, setClipsLoaded] = useState(false)
  const [pick, setPickState] = useState('')
  // (a kit chosen in the picker stays chosen — and is kept for this video in this browser, so a reload keeps it
  // on, user 2026-11-19; until one is chosen the picker follows the clips — below)
  const pickKey = `shortcut.brandPick.${videoId}`
  const picked = useRef(false)
  const setPick = useCallback((id: string) => {
    picked.current = true; setPickState(id)
    try { localStorage.setItem(pickKey, id) } catch { /* storage blocked: kept for this visit only */ }
  }, [pickKey])
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; on: boolean } | null>(null)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const clipsKey = clipIds.join(',')

  const loadClips = useCallback(() => fetch(`/api/videos/${videoId}/brand`).then(r => json<{ clips: Record<string, string | null> }>(r))
    .then(d => { setOf(d.clips ?? {}); setClipsLoaded(true) }).catch(() => { /* tags left as they were */ }), [videoId])
  // (read again when the Brand kits popup closes: a kit made, renamed or recoloured there shows here)
  const [kitsRead, setKitsRead] = useState(0)
  useEffect(() => {
    const again = () => setKitsRead(n => n + 1)
    window.addEventListener(BRAND_KITS_CLOSED, again)
    return () => window.removeEventListener(BRAND_KITS_CLOSED, again)
  }, [])
  useEffect(() => {
    fetch('/api/brand-kits').then(r => json<{ kits: Array<{ id: string; name: string; data: { is_default?: boolean; colors: { main: string; accent: string } } }> }>(r))
      .then(d => {
        const ks = d.kits.map(k => ({ id: k.id, name: k.name, isDefault: !!k.data.is_default, main: k.data.colors.main, accent: k.data.colors.accent }))
        setKits(ks)
        // (user, 2026-11-12) Off until a kit is picked — not the default kit by itself; a kit picked stays picked
        setPickState(p => (p === NO_KIT || ks.some(k => k.id === p) ? p : NO_KIT))
      }).catch(() => { /* no kits shown */ })
      .finally(() => setKitsLoaded(true))
  }, [kitsRead])
  useEffect(() => { loadClips() }, [loadClips, clipsKey])
  // After a reload the picker shows: what was last chosen for this video (a kit since deleted aside), else the
  // kit that is on the clips (the one on most of them), else Off (user, 2026-11-19: it went back to Off — once
  // with "Turn off on all 2" while both clips had the kit on, once with a kit chosen but not yet put on)
  const followed = useRef(false)
  useEffect(() => {
    if (followed.current || picked.current || !kitsLoaded) return
    let saved: string | null = null
    try { saved = localStorage.getItem(pickKey) } catch { /* storage blocked */ }
    if (saved && (saved === NO_KIT || kits.some(k => k.id === saved))) {
      followed.current = true; picked.current = true; setPickState(saved); return
    }
    if (!clipsLoaded) return
    followed.current = true
    const count = new Map<string, number>()
    for (const id of clipIds) { const k = of[id]; if (k && kits.some(x => x.id === k)) count.set(k, (count.get(k) ?? 0) + 1) }
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (top) setPickState(top)
  }, [kitsLoaded, clipsLoaded, kits, of, clipsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const kitOf = (clipId: string) => { const id = of[clipId]; return id ? kits.find(k => k.id === id) ?? null : null }
  const branded = clipIds.filter(id => !!of[id]).length

  /**
   * A kit (or none) on these clips (user, 2026-11-19: "Working…" for ~12 s with nothing to see): their tags
   * change at once; they go 4 at a time, the button counting them; then the tags are read back, so a clip
   * that couldn't be changed (being exported) shows as it really is.
   */
  async function applyMany(ids: string[], kitId: string | null) {
    if (!ids.length) return
    setBusy('all'); setNote(null)
    setOf(o => { const n = { ...o }; for (const id of ids) n[id] = kitId; return n })
    setProgress({ done: 0, total: ids.length, on: !!kitId })
    let changed = 0, skipped = 0, failed = 0, next = 0
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++]
        try {
          const r = await fetch(`/api/videos/${videoId}/brand`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kit_id: kitId, clip_ids: [id] }) })
            .then(res => json<{ changed: number; skipped: number }>(res))
          changed += r.changed; skipped += r.skipped
        } catch { failed++ }
        setProgress(p => (p ? { ...p, done: p.done + 1 } : p))
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker))
      await loadClips()
      onChanged?.(ids)
      const kit = kits.find(k => k.id === kitId)
      setNote({
        bad: failed > 0,
        text: `${kit ? `${kit.name} is on` : 'Brand taken off'} ${changed} clip${changed === 1 ? '' : 's'}`
          + `${skipped ? ` · ${skipped} being exported left as ${skipped === 1 ? 'it is' : 'they are'}` : ''}`
          + `${failed ? ` · ${failed} couldn’t be changed, please try again` : ''}`,
      })
    } finally { setBusy(null); setProgress(null) }
  }
  const applyAll = (kitId: string | null) => applyMany(clipIds, kitId)
  /** The kit (or none) on the clips ticked with Select */
  const applyTo = (ids: string[], kitId: string | null) => applyMany(ids, kitId)
  async function setClip(clipId: string, kitId: string | null) {
    setBusy(clipId); setNote(null)
    try {
      await fetch(`/api/clips/${clipId}/brand`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kit_id: kitId }) })
        .then(res => json<{ on: boolean }>(res))
      setOf(o => ({ ...o, [clipId]: kitId }))
      onChanged?.([clipId])
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), bad: true })
    } finally { setBusy(null) }
  }
  // (user, 2026-11-18: "Mythri Movie Makers is on 1 clip" stayed after the clip was changed) a result shows for a
  // few seconds; a problem until the next action. Both go when the board's clips change
  useEffect(() => {
    if (!note || note.bad) return
    const t = setTimeout(() => setNote(null), 4500)
    return () => clearTimeout(t)
  }, [note])
  useEffect(() => { setNote(null) }, [clipsKey])
  return { kits, kitOf, pick, setPick, branded, busy, progress, loaded: kitsLoaded, note, applyAll, applyTo, setClip }
}

/** The brand tag in a kit's colours (BrandTagIcon) */
const Dots = ({ k }: { k: Pick<KitLite, 'main' | 'accent'> }) => <BrandTagIcon size={13} kit={k} />

/**
 * Which kit (user, 2026-10-28: a designed menu, not the browser's own list): the picked kit's colours and
 * name; open, Off first, then each kit with its colours, Default marked, the picked one ticked. ↑ / ↓,
 * Enter, Esc; a click outside closes it.
 */
function KitPick({ kits, value, onChange, disabled }: { kits: KitLite[]; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const cur = value === NO_KIT ? null : kits.find(k => k.id === value) ?? kits[0]
  const ids = [NO_KIT, ...kits.map(k => k.id)]
  const tick = <svg className="cbb-pick-check" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [open])
  const show = () => { setActive(Math.max(0, ids.indexOf(value))); setOpen(true) }
  const pick = (id: string) => { onChange(id); setOpen(false); btn.current?.focus() }
  return (
    <div ref={ref} className="cbb-pick"
      onKeyDown={e => {
        if (!open) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show() } return }
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % ids.length) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + ids.length) % ids.length) }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(ids[active]) }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) }
        else if (e.key === 'Tab') setOpen(false)
      }}>
      <button ref={btn} type="button" className="cbb-pick-btn" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        aria-label={`The brand kit to put on the clips: ${cur?.name ?? 'off'}`} onClick={() => (open ? setOpen(false) : show())}>
        {cur ? <Dots k={cur} /> : <BrandTagIcon size={13} off />}
        <span className="cbb-pick-name">{cur?.name ?? 'Off'}</span>
        {cur?.isDefault && <span className="cbb-pick-def">Default</span>}
        <svg className="cbb-pick-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <ul className="cbb-pick-list" role="listbox" aria-label="Brand kits">
          <li role="option" aria-selected={value === NO_KIT} className="cbb-pick-item" data-active={active === 0 || undefined}
            onMouseEnter={() => setActive(0)} onClick={() => pick(NO_KIT)}>
            <BrandTagIcon size={13} off />
            <span className="cbb-pick-name">Off</span>
            {value === NO_KIT && tick}
          </li>
          {kits.map((k, i) => (
            <li key={k.id} role="option" aria-selected={k.id === value} className="cbb-pick-item" data-active={i + 1 === active || undefined}
              onMouseEnter={() => setActive(i + 1)} onClick={() => pick(k.id)}>
              <Dots k={k} />
              <span className="cbb-pick-name">{k.name}</span>
              {k.isDefault && <span className="cbb-pick-def">Default</span>}
              {k.id === value && tick}
            </li>
          ))}
          <li role="presentation" className="cbb-pick-foot"><button type="button" onClick={() => { setOpen(false); openBrandKits() }}>Manage brand kits →</button></li>
        </ul>
      )}
    </div>
  )
}

/** Above the clips: the kit, "Put on all N clips", how many have one, and "Take off all" */
export function BrandAllBar({ b, total, selected = [] }: { b: ClipBrands; total: number; selected?: string[] }) {
  if (!total) return null
  // (still reading the kits: the bar's own shape, quiet — not "Make a brand kit", user 2026-11-19)
  if (!b.loaded) {
    return (
      <div className="cbb-card" aria-busy="true" aria-label="Loading your brand kits">
        <div className="cbb-meta"><span className="cbb-label">Brand</span></div>
        <div className="cbb-bar">
          <span className="h-[30px] flex-1 min-w-[120px] rounded-lg animate-pulse" style={{ background: 'rgb(var(--cb-fg) / 0.07)' }} />
          <span className="h-[30px] w-[92px] rounded-lg animate-pulse" style={{ background: 'rgb(var(--cb-fg) / 0.07)' }} />
        </div>
      </div>
    )
  }
  if (!b.kits.length) {
    return (
      <div className="cbb-card">
        <div className="cbb-bar">
          <span className="cbb-label">Brand</span>
          <span className="text-[11px] flex-1 min-w-0" style={{ color: 'rgb(var(--cb-fg) / 0.55)' }}>Put your logo, colours and caption look on every clip.</span>
          <button type="button" className="cbb-btn" onClick={() => openBrandKits()}>Make a brand kit</button>
        </div>
      </div>
    )
  }
  const kit = b.kits.find(k => k.id === b.pick) ?? null
  const allOn = !!kit && b.branded === total
  // Which clips it goes on (user, 2026-10-31: "only which kit and for what videos"): the ones ticked with
  // Select, else all of them
  const some = selected.length > 0
  const brandedPicked = some ? selected.filter(id => !!b.kitOf(id)).length : b.branded
  const none = b.pick === NO_KIT
  // One card (user, 2026-11-09: the count floated on its own): "Brand" and how many have it on a small
  // line at the top, the kit and its button under it with the whole width
  return (
    <div className="cbb-card">
      <div className="cbb-meta">
        <span className="cbb-label">Brand</span>
        <span className="cbb-meta-end">
          <span className="text-[10.5px] tabular-nums" style={{ color: 'rgb(var(--cb-fg) / 0.5)' }}>
            {some ? `${brandedPicked} of ${selected.length} selected branded` : `${b.branded} of ${total} branded`}
          </span>
          {brandedPicked > 0 && (
            <button type="button" className="text-[10.5px] font-semibold hover:underline" disabled={!!b.busy} onClick={() => (some ? b.applyTo(selected, null) : b.applyAll(null))}
              style={{ color: 'rgb(var(--cb-fg) / 0.55)' }}>{some ? 'Take off selected' : 'Take off all'}</button>
          )}
        </span>
      </div>
      <div className="cbb-bar">
        <KitPick kits={b.kits} value={b.pick} onChange={b.setPick} disabled={!!b.busy} />
        {/* (no Edit here — editing is the top bar's Brand kits; this bar is which kit, on which clips) */}
        <button type="button" className="cbb-btn" data-primary disabled={!!b.busy || (none ? brandedPicked === 0 : !kit)}
          onClick={() => { const to = none ? null : b.pick; return some ? b.applyTo(selected, to) : b.applyAll(to) }}
          title={none ? 'Take the brand off, putting back what it changed'
            : some ? `Put ${kit?.name ?? 'this kit'} on the ${selected.length} clip${selected.length === 1 ? '' : 's'} you ticked`
            : allOn ? 'Put it on again: a clip whose kit changed gets the newest version' : `Put ${kit?.name ?? 'this kit'} on all ${total} clips`}>
          {b.busy === 'all'
            ? (b.progress && b.progress.total > 1 ? `${b.progress.on ? 'Putting on' : 'Taking off'}… ${b.progress.done} of ${b.progress.total}` : b.progress?.on === false ? 'Taking off…' : 'Putting on…')
            : `${none ? 'Turn off on' : 'Put on'} ${some ? `${selected.length} selected` : `all ${total}`}`}
        </button>
      </div>
      {b.note && <span role={b.note.bad ? 'alert' : 'status'} className="cbb-note text-[10.5px]" style={{ color: b.note.bad ? '#f87171' : '#c8ff00' }}>{b.note.text}</span>}
    </div>
  )
}

/** On a clip's card: its kit (× takes it off), or "+ Brand" to put the picked kit on; "No brand" when none is picked */
export function BrandTag({ b, clipId }: { b: ClipBrands; clipId: string }) {
  const kit = b.kitOf(clipId)
  const busy = b.busy === clipId
  if (kit) {
    return (
      <span className="cbb-tag" title={`${kit.name} is on this clip`} onClick={e => e.stopPropagation()}>
        <Dots k={kit} />{busy ? 'Taking off…' : kit.name}
        <button type="button" aria-label={`Take ${kit.name} off this clip`} disabled={!!b.busy} onClick={() => b.setClip(clipId, null)}>×</button>
      </span>
    )
  }
  const pick = b.kits.find(k => k.id === b.pick)
  if (!pick) return b.kits.length ? <span className="cbb-tag" data-none>No brand</span> : null
  return (
    <button type="button" className="cbb-tag" data-add disabled={!!b.busy} title={`Put ${pick.name} on this clip`}
      onClick={e => { e.stopPropagation(); b.setClip(clipId, pick.id) }}>
      {busy ? 'Adding…' : '+ Brand'}
    </button>
  )
}
