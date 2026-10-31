'use client'

import { useEffect, useRef, useState } from 'react'
import type { BrandKit } from '@/lib/shared/brandKit'

/**
 * The brand in the editor's top bar (brand kit rebuild, Phase 2, 2026-10-27): which kit is on this
 * clip — or Off — one click away while editing (as Opus Clip's brand template and Canva's brand menu
 * are), to switch kits, take it off, or edit it. Putting one on says what it added, with Undo.
 */
export function EditorBrandMenu({ kits, loading, onKitId, onTurnOn, onTurnOff, onEdit, onUndo }: {
  kits: BrandKit[]
  loading: boolean
  /** The kit on this clip (null: off) */
  onKitId: string | null
  onTurnOn: (kit: BrandKit) => void
  onTurnOff: () => void
  /** Opens the Brand kit tool (the kit's settings) */
  onEdit: () => void
  onUndo: () => void
}) {
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  useEffect(() => () => { if (addedTimer.current) clearTimeout(addedTimer.current) }, [])

  const on = kits.find(k => k.id === onKitId) ?? null
  function say(text: string | null) {
    setAdded(text)
    if (addedTimer.current) clearTimeout(addedTimer.current)
    if (text) addedTimer.current = setTimeout(() => setAdded(null), 6000)
  }
  function pick(kit: BrandKit | null) {
    setOpen(false)
    // (taken off: no note — user, 2026-10-29)
    if (!kit) { if (on) { onTurnOff(); say(null) } return }
    if (kit.id === onKitId) return
    onTurnOn(kit)
    const d = kit.data
    const what = [d.logo.path && 'logo', d.captions.on && 'caption look', 'colours', d.title.font && 'title font'].filter(Boolean).join(', ')
    say(`Added: ${what}`)
  }

  if (loading && !kits.length) return null
  return (
    <div ref={ref} className="relative">
      <button type="button" className="ebm-pill" data-on={!!on || undefined} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(o => !o)} title={on ? `${on.name} is on this clip` : 'No brand kit on this clip'}>
        {on ? <span className="ebm-dots" aria-hidden="true"><i style={{ background: on.data.colors.main }} /><i style={{ background: on.data.colors.accent }} /></span>
          : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 000 18" fill="currentColor" stroke="none" opacity=".35" /></svg>}
        <span className="ebm-name">Brand: {on ? on.name : 'Off'}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="menu" aria-label="Brand kit for this clip" className="ebm-menu">
          <span className="ebm-head">Brand kit for this clip</span>
          {kits.map(k => (
            <button key={k.id} type="button" role="menuitemradio" aria-checked={k.id === onKitId} className="ebm-item" data-on={k.id === onKitId || undefined} onClick={() => pick(k)}>
              <span className="ebm-dots" aria-hidden="true"><i style={{ background: k.data.colors.main }} /><i style={{ background: k.data.colors.accent }} /></span>
              <span className="flex-1 min-w-0 truncate">{k.name}</span>
              {k.data.is_default && <span className="ebm-tag">Default</span>}
              {k.id === onKitId && <span aria-hidden="true">✓</span>}
            </button>
          ))}
          <button type="button" role="menuitemradio" aria-checked={!onKitId} className="ebm-item" data-on={!onKitId || undefined} onClick={() => pick(null)}>
            <span className="ebm-dots" aria-hidden="true"><i style={{ background: 'transparent' }} /></span>
            <span className="flex-1">Off</span>
            {!onKitId && <span aria-hidden="true">✓</span>}
          </button>
          <span className="ebm-line" />
          {/* Both open the kit's workshop here in the editor (user, 2026-10-31: "it should not go to another page,
              it should pop up there itself" — Make a brand kit opened the Brand kits page in a new tab) */}
          <button type="button" role="menuitem" className="ebm-item" onClick={() => { setOpen(false); onEdit() }}>
            {kits.length ? 'Edit brand kit…' : 'Make a brand kit…'}
          </button>
        </div>
      )}
      {added && !open && (
        <div role="status" className="ebm-added">
          <span className="truncate">{added}</span>
          <button type="button" onClick={() => { onUndo(); say(null) }}>Undo</button>
        </div>
      )}
    </div>
  )
}
