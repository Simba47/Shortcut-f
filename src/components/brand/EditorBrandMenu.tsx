'use client'

import { useEffect, useRef, useState } from 'react'
import type { BrandKit } from '@/lib/shared/brandKit'

/**
 * The brand in the editor's top bar (brand kit rebuild, Phase 2, 2026-10-27): which kit is on this
 * clip — or Off — one click away while editing (as Opus Clip's brand template and Canva's brand menu
 * are), to switch kits, take it off, or edit it. (No "Added: … · Undo" note when one goes on — user,
 * 2026-10-31: removed; the editor's Undo still takes it back.)
 */
export function EditorBrandMenu({ kits, loading, onKitId, onTurnOn, onTurnOff, onEdit }: {
  kits: BrandKit[]
  loading: boolean
  /** The kit on this clip (null: off) */
  onKitId: string | null
  onTurnOn: (kit: BrandKit) => void
  onTurnOff: () => void
  /** Opens the Brand kit tool (the kit's settings): on the kit given (its row's Edit), else the current one */
  onEdit: (kitId?: string) => void
}) {
  const [open, setOpen] = useState(false)
  // The row just picked (a kit's id, or 'off'): its ✓ and colours pop, then the menu closes (user, 2026-10-31)
  const [picked, setPicked] = useState<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  const on = kits.find(k => k.id === onKitId) ?? null
  function pick(kit: BrandKit | null) {
    if (kit ? kit.id === onKitId : !onKitId) { setOpen(false); return }
    if (kit) onTurnOn(kit); else onTurnOff()
    // (the switch shows — the ✓ moves and pops — before the menu goes)
    setPicked(kit ? kit.id : 'off')
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => { setOpen(false); setPicked(null) }, 380)
  }
  const pencil = <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>

  if (loading && !kits.length) return null
  return (
    <div ref={ref} className="relative">
      <button type="button" className="ebm-pill" data-on={!!on || undefined} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(o => !o)} title={on ? `${on.name} is on this clip` : 'No brand kit on this clip'}>
        {/* (keyed on the kit: switching slides the new name and colours in) */}
        <span key={on?.id ?? 'off'} className="ebm-swap">
          {on ? <span className="ebm-dots" aria-hidden="true"><i style={{ background: on.data.colors.main }} /><i style={{ background: on.data.colors.accent }} /></span>
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 000 18" fill="currentColor" stroke="none" opacity=".35" /></svg>}
          <span className="ebm-name">Brand: {on ? on.name : 'Off'}</span>
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="menu" aria-label="Brand kit for this clip" className="ebm-menu">
          <span className="ebm-head">Brand kit for this clip</span>
          {/* The kit that's on: a lime bar and tint and its ✓; every kit's own Edit on its row (not a line at the bottom) */}
          {kits.map(k => {
            const isOn = k.id === onKitId
            return (
              <div key={k.id} className="ebm-row" data-on={isOn || undefined} data-picked={picked === k.id || undefined}>
                <button type="button" role="menuitemradio" aria-checked={isOn} className="ebm-item flex-1 min-w-0" onClick={() => pick(k)}>
                  <span className="ebm-dots" aria-hidden="true"><i style={{ background: k.data.colors.main }} /><i style={{ background: k.data.colors.accent }} /></span>
                  <span className="flex-1 min-w-0 truncate">{k.name}</span>
                  {k.data.is_default && <span className="ebm-tag">Default</span>}
                  {isOn && <span className="ebm-check" aria-hidden="true">✓</span>}
                </button>
                {/* Every kit's Edit shows when it's pointed at (user, 2026-10-31: no need to pick it first); a click on
                    the kit itself only picks it */}
                <button type="button" role="menuitem" className="ebm-edit" title={`Edit ${k.name}`} aria-label={`Edit ${k.name}`}
                  onClick={() => { setOpen(false); onEdit(k.id) }}>
                  {pencil}Edit
                </button>
              </div>
            )
          })}
          <div className="ebm-row" data-on={!onKitId || undefined} data-picked={picked === 'off' || undefined}>
            <button type="button" role="menuitemradio" aria-checked={!onKitId} className="ebm-item flex-1" onClick={() => pick(null)}>
              <span className="ebm-dots" aria-hidden="true"><i style={{ background: 'transparent' }} /></span>
              <span className="flex-1">Off</span>
              {!onKitId && <span className="ebm-check" aria-hidden="true">✓</span>}
            </button>
          </div>
          {/* No kit yet: make one, here in the editor (2026-10-31: not on another page) */}
          {!kits.length && (
            <>
              <span className="ebm-line" />
              <button type="button" role="menuitem" className="ebm-item" onClick={() => { setOpen(false); onEdit() }}>Make a brand kit…</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
