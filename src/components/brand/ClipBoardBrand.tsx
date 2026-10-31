'use client'

import { openBrandKits, BRAND_KITS_CLOSED } from '@/components/brand/brandKitsEvents'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The brand on the clip board (brand kit rebuild, Phase 2, 2026-10-27): which kit each clip has (a
 * tag on its card), and "Put on all clips" — one kit on every clip of the video, or the brand off
 * them all (the server's brand engine: services/brandApply.ts). Kept apart from the clip board
 * itself (ClipPickerShell.tsx), which only places these.
 */

interface KitLite { id: string; name: string; isDefault: boolean; main: string; accent: string }

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

/** The user's kits and each clip's kit, read again when the clips change (Make my clips adds some) */
export function useClipBrands(videoId: string, clipIds: string[]): ClipBrands {
  const [kits, setKits] = useState<KitLite[]>([])
  const [of, setOf] = useState<Record<string, string | null>>({})
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const clipsKey = clipIds.join(',')

  const loadClips = useCallback(() => fetch(`/api/videos/${videoId}/brand`).then(r => json<{ clips: Record<string, string | null> }>(r))
    .then(d => setOf(d.clips ?? {})).catch(() => { /* tags left as they were */ }), [videoId])
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
        setPick(p => (ks.some(k => k.id === p) ? p : (ks.find(k => k.isDefault) ?? ks[0])?.id ?? ''))
      }).catch(() => { /* no kits shown */ })
  }, [kitsRead])
  useEffect(() => { loadClips() }, [loadClips, clipsKey])

  const kitOf = (clipId: string) => { const id = of[clipId]; return id ? kits.find(k => k.id === id) ?? null : null }
  const branded = clipIds.filter(id => !!of[id]).length

  async function applyAll(kitId: string | null) {
    setBusy('all'); setNote(null)
    try {
      const r = await fetch(`/api/videos/${videoId}/brand`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kit_id: kitId }) })
        .then(res => json<{ changed: number; skipped: number }>(res))
      await loadClips()
      const kit = kits.find(k => k.id === kitId)
      setNote({
        bad: false,
        text: `${kit ? `${kit.name} is on` : 'Brand taken off'} ${r.changed} clip${r.changed === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} being exported left as they are` : ''}`,
      })
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), bad: true })
    } finally { setBusy(null) }
  }
  /** The kit (or none) on the clips ticked with Select: one by one, as a clip's own tag does it */
  async function applyTo(clipIds: string[], kitId: string | null) {
    if (!clipIds.length) return
    setBusy('all'); setNote(null)
    let changed = 0, failed = 0
    for (const id of clipIds) {
      try {
        await fetch(`/api/clips/${id}/brand`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kit_id: kitId }) })
          .then(res => json<{ on: boolean }>(res))
        changed++
      } catch { failed++ }
    }
    await loadClips()
    const kit = kits.find(k => k.id === kitId)
    setNote({
      bad: failed > 0,
      text: `${kit ? `${kit.name} is on` : 'Brand taken off'} ${changed} clip${changed === 1 ? '' : 's'}${failed ? ` · ${failed} couldn’t be changed (being exported?)` : ''}`,
    })
    setBusy(null)
  }
  async function setClip(clipId: string, kitId: string | null) {
    setBusy(clipId); setNote(null)
    try {
      await fetch(`/api/clips/${clipId}/brand`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kit_id: kitId }) })
        .then(res => json<{ on: boolean }>(res))
      setOf(o => ({ ...o, [clipId]: kitId }))
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), bad: true })
    } finally { setBusy(null) }
  }
  return { kits, kitOf, pick, setPick, branded, busy, note, applyAll, applyTo, setClip }
}

/** Two dots in a kit's colours */
const Dots = ({ k }: { k: Pick<KitLite, 'main' | 'accent'> }) => (
  <span className="cbb-dots" aria-hidden="true"><i style={{ background: k.main }} /><i style={{ background: k.accent }} /></span>
)

/**
 * Which kit (user, 2026-10-28: a designed menu, not the browser's own list): the picked kit's colours and
 * name; open, each kit with its colours, Default marked, the picked one ticked. ↑ / ↓, Enter, Esc; a
 * click outside closes it.
 */
function KitPick({ kits, value, onChange, disabled }: { kits: KitLite[]; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const cur = kits.find(k => k.id === value) ?? kits[0]
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [open])
  const show = () => { setActive(Math.max(0, kits.findIndex(k => k.id === value))); setOpen(true) }
  const pick = (id: string) => { onChange(id); setOpen(false); btn.current?.focus() }
  return (
    <div ref={ref} className="cbb-pick"
      onKeyDown={e => {
        if (!open) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show() } return }
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % kits.length) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + kits.length) % kits.length) }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(kits[active].id) }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) }
        else if (e.key === 'Tab') setOpen(false)
      }}>
      <button ref={btn} type="button" className="cbb-pick-btn" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        aria-label={`The brand kit to put on the clips: ${cur?.name ?? 'none'}`} onClick={() => (open ? setOpen(false) : show())}>
        {cur && <Dots k={cur} />}
        <span className="cbb-pick-name">{cur?.name}</span>
        {cur?.isDefault && <span className="cbb-pick-def">Default</span>}
        <svg className="cbb-pick-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <ul className="cbb-pick-list" role="listbox" aria-label="Brand kits">
          {kits.map((k, i) => (
            <li key={k.id} role="option" aria-selected={k.id === value} className="cbb-pick-item" data-active={i === active || undefined}
              onMouseEnter={() => setActive(i)} onClick={() => pick(k.id)}>
              <Dots k={k} />
              <span className="cbb-pick-name">{k.name}</span>
              {k.isDefault && <span className="cbb-pick-def">Default</span>}
              {k.id === value && (
                <svg className="cbb-pick-check" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
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
  if (!b.kits.length) {
    return (
      <div className="cbb-bar">
        <span className="cbb-label">Brand</span>
        <span className="text-[11px] flex-1 min-w-0" style={{ color: 'rgb(var(--cb-fg) / 0.55)' }}>Put your logo, colours and caption look on every clip.</span>
        <button type="button" className="cbb-btn" onClick={() => openBrandKits()}>Make a brand kit</button>
      </div>
    )
  }
  const kit = b.kits.find(k => k.id === b.pick) ?? null
  const allOn = !!kit && b.branded === total
  // Which clips it goes on (user, 2026-10-31: "only which kit and for what videos"): the ones ticked with
  // Select, else all of them
  const some = selected.length > 0
  const brandedPicked = some ? selected.filter(id => !!b.kitOf(id)).length : b.branded
  return (
    <div className="flex flex-col gap-1.5">
      <div className="cbb-bar">
        <span className="cbb-label">Brand</span>
        <KitPick kits={b.kits} value={b.pick} onChange={b.setPick} disabled={!!b.busy} />
        {/* (no Edit here — editing is the top bar's Brand kits; this bar is which kit, on which clips) */}
        <button type="button" className="cbb-btn" data-primary disabled={!!b.busy || !kit} onClick={() => (some ? b.applyTo(selected, b.pick) : b.applyAll(b.pick))}
          title={some ? `Put ${kit?.name ?? 'this kit'} on the ${selected.length} clip${selected.length === 1 ? '' : 's'} you ticked`
            : allOn ? 'Put it on again: a clip whose kit changed gets the newest version' : `Put ${kit?.name ?? 'this kit'} on all ${total} clips`}>
          {b.busy === 'all' ? 'Working…' : some ? `Put on ${selected.length} selected` : `Put on all ${total}`}
        </button>
      </div>
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10.5px] tabular-nums" style={{ color: 'rgb(var(--cb-fg) / 0.5)' }}>
          {some ? `${brandedPicked} of ${selected.length} selected branded` : `${b.branded} of ${total} branded`}
        </span>
        {brandedPicked > 0 && (
          <button type="button" className="text-[10.5px] font-semibold hover:underline" disabled={!!b.busy} onClick={() => (some ? b.applyTo(selected, null) : b.applyAll(null))}
            style={{ color: 'rgb(var(--cb-fg) / 0.55)' }}>{some ? 'Take off selected' : 'Take off all'}</button>
        )}
        {b.note && <span role={b.note.bad ? 'alert' : 'status'} className="text-[10.5px] truncate" style={{ color: b.note.bad ? '#f87171' : '#c8ff00' }}>{b.note.text}</span>}
      </div>
    </div>
  )
}

/** On a clip's card: its kit (× takes it off), or "+ Brand" to put the picked kit on */
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
  if (!pick) return null
  return (
    <button type="button" className="cbb-tag" data-add disabled={!!b.busy} title={`Put ${pick.name} on this clip`}
      onClick={e => { e.stopPropagation(); b.setClip(clipId, pick.id) }}>
      {busy ? 'Adding…' : '+ Brand'}
    </button>
  )
}
