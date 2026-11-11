'use client'

import { useRef, useState } from 'react'
import { urlRatio, type BrandKits } from '@/components/editor/BrandKit'
import { foundFromLink, foundList, withFoundBrand, MAX_EXTRA_COLORS, type BrandKit, type BrandKitData, type FoundBrand } from '@/lib/shared/brandKit'

/**
 * Making a brand in a minute (brand kit rebuild, Phase 1, 2026-10-27), in the kit's workshop
 * (BrandKitStudio):
 *
 *  - BrandStart, "Where's your brand?": two ways in — a website or profile link (logo, name, @handle,
 *    colours, font: services/brandFromLink.ts) or a logo (its colours read from it). Both run on our
 *    own server or in the browser: no paid service.
 *  - BrandCard, "Here's your brand": the logo and colours, each changed
 *    right there; the logo's own colours a tap away.
 */

/** How a kit is read and changed here: `now` its latest settings, `set` a change (saved shortly after) */
export interface KitEdit {
  now: () => BrandKitData
  set: (data: BrandKitData, extra?: { name?: string; logo_url?: string | null }) => void
}

/** What the last way in found, for the card: the colours it saw (to pick from) */
export interface Found {
  via: 'link' | 'logo'
  /** "Found your logo, colours, font" (or why nothing was) */
  note: string
  /** The brand's own colours as found: the card offers them a tap away */
  colours: string[]
}

const isDefaultName = (name: string) => /^Brand kit( \d+)?$/.test(name.trim())

// ── "Where's your brand?" ─────────────────────────────────────────────────────

export function BrandStart({ kit, brand, now, set, onFound }: KitEdit & {
  kit: BrandKit
  brand: BrandKits
  /** A way in found something (the kit has it now) */
  onFound: (f: Found) => void
}) {
  const [way, setWay] = useState<'link' | 'logo'>('link')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /** What a way in found, put on the kit (the name too while it's still "Brand kit") */
  function put(found: FoundBrand, extra: { logo_url?: string | null; name?: string | null } = {}) {
    const data = withFoundBrand(now(), found)
    const rename = extra.name && isDefaultName(kit.name) ? { name: extra.name.slice(0, 40) } : {}
    set(data, { ...rename, ...(extra.logo_url !== undefined ? { logo_url: extra.logo_url } : {}) })
  }

  async function fromLink() {
    if (!url.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const b = await brand.fromLink(url.trim())
      const found = foundFromLink(b)
      if (found.logo && found.logo.ratio === null && b.logo?.url) found.logo.ratio = await urlRatio(b.logo.url)
      put(found, { logo_url: b.logo?.url ?? undefined, name: b.name })
      const got = foundList(found)
      onFound({
        via: 'link',
        note: got.length ? `From ${b.source}: your ${got.join(', ')}` : `Nothing to use was found on ${b.source}. Try uploading your logo.`,
        colours: b.colors ? [b.colors.main, b.colors.accent, ...b.colors.extra].filter((c): c is string => !!c) : [],
      })
    } catch (e) {
      setError(`${e instanceof Error ? e.message : String(e)} You can also start from your logo.`)
    } finally { setBusy(false) }
  }

  async function fromLogo(file: File | undefined) {
    if (!file || busy) return
    setBusy(true); setError(null)
    try {
      const up = await brand.uploadLogo(file)
      const colours = up.colors ? [up.colors.main, up.colors.accent].filter((c): c is string => !!c) : []
      // (a logo's colours become the kit's main and accent; the extra ones stay as they were)
      put({ logo: { path: up.path, ratio: up.ratio }, colors: up.colors ? { main: up.colors.main, accent: up.colors.accent, extra: [] } : null }, { logo_url: up.url })
      onFound({ via: 'logo', colours, note: up.colors ? 'Your logo, and its colours' : 'Your logo (its colours couldn’t be read: pick them below)' })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const WAYS = [
    { id: 'link' as const, name: 'Paste a link', about: 'Website, Instagram or YouTube' },
    { id: 'logo' as const, name: 'Upload your logo', about: 'We take its colours' },
  ]
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Start from" className="bm-ways">
        {WAYS.map(w => (
          <button key={w.id} type="button" role="tab" aria-selected={way === w.id} className="bm-way" data-on={way === w.id || undefined}
            onClick={() => { setWay(w.id); setError(null) }}>
            <span className="bm-way-name">{w.name}</span>
            <span className="bm-way-about">{w.about}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex flex-col gap-2">
        {way === 'link' && (
          <div className="flex flex-wrap gap-2">
            <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') fromLink() }} maxLength={500}
              placeholder="yourbrand.com or instagram.com/yourbrand" aria-label="Website or profile link" className="bm-input flex-1 min-w-[180px]" />
            <button type="button" onClick={fromLink} disabled={busy || !url.trim()} className="bs-primary bm-go h-11 px-5 disabled:opacity-50">
              {busy ? 'Reading…' : 'Make my brand'}
            </button>
          </div>
        )}
        {way === 'logo' && (
          <>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => fromLogo(e.target.files?.[0])} />
            <button type="button" className="bm-drop" disabled={busy} onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
              onDrop={e => { e.preventDefault(); fromLogo(e.dataTransfer.files?.[0]) }}>
              <span className="text-[13px] font-semibold text-[var(--ed-text)]">{busy ? 'Reading your logo…' : 'Choose your logo, or drop it here'}</span>
              <span className="text-[11.5px]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>PNG with a see-through background works best · up to 5 MB</span>
            </button>
          </>
        )}
        {error && <p role="alert" className="text-[12px]" style={{ color: '#fca5a5' }}>{error}</p>}
      </div>
    </div>
  )
}

// ── "Here's your brand" ───────────────────────────────────────────────────────

/** The kit's colours as slots: main, accent, then the extra ones */
type Slot = 'main' | 'accent' | number

export function BrandCard({ kit, brand, now, set, found, readOnly = false, start }: KitEdit & {
  /** The ways in (BrandStart), in the first tile, beside the logo */
  start?: React.ReactNode
  kit: BrandKit
  brand: BrandKits
  /** What the last way in found (its colours a tap away); null: none yet */
  found: Found | null
  readOnly?: boolean
}) {
  const d = kit.data
  const [slot, setSlot] = useState<Slot>('main')
  const [uploading, setUploading] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [logoColours, setLogoColours] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const colourOf = (s: Slot) => (s === 'main' ? d.colors.main : s === 'accent' ? d.colors.accent : d.colors.extra[s] ?? '#ffffff')
  function setColour(s: Slot, c: string) {
    const cur = now(), v = c.toLowerCase()
    const colors = s === 'main' ? { ...cur.colors, main: v } : s === 'accent' ? { ...cur.colors, accent: v }
      : { ...cur.colors, extra: cur.colors.extra.map((x, i) => (i === s ? v : x)) }
    set({ ...cur, colors })
  }
  function addColour(c = '#ffffff') {
    const cur = now()
    if (cur.colors.extra.length >= MAX_EXTRA_COLORS) return
    set({ ...cur, colors: { ...cur.colors, extra: [...cur.colors.extra, c] } })
    setSlot(cur.colors.extra.length)
  }
  function removeColour(i: number) {
    const cur = now()
    set({ ...cur, colors: { ...cur.colors, extra: cur.colors.extra.filter((_, j) => j !== i) } })
    setSlot('main')
  }
  async function pickLogo(file: File | undefined) {
    if (!file) return
    setUploading(true); setLogoError(null)
    try {
      const up = await brand.uploadLogo(file)
      const cur = now()
      set({ ...cur, logo: { ...cur.logo, path: up.path, ratio: up.ratio } }, { logo_url: up.url })
      setLogoColours(up.colors ? [up.colors.main, up.colors.accent].filter((c): c is string => !!c) : [])
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // The colours to pick from: the logo's (just uploaded) and what the way in found, none twice, none the kit has
  const have = new Set([d.colors.main, d.colors.accent, ...d.colors.extra])
  const offers = [...new Set([...logoColours, ...(found?.colours ?? [])])].filter(c => !have.has(c)).slice(0, 6)
  const slots: Slot[] = ['main', 'accent', ...d.colors.extra.map((_, i) => i)]
  const slotName = (s: Slot) => (s === 'main' ? 'Primary' : s === 'accent' ? 'Secondary' : `Colour ${s + 3}`)
  const current = colourOf(slot)

  return (
    <div className="bm-card" inert={readOnly || undefined} style={readOnly ? { opacity: 0.6 } : undefined}>
      {found && <p role="status" className="bm-found">{found.note}</p>}

      {/* The ways in across the whole width; under them the logo and the colours, side by side (user, 2026-11-10) */}
      {start && (
        <div className="bm-tile bm-tile-all">
          <span className="bm-tile-label">Start from</span>
          {start}
        </div>
      )}

      {/* Logo */}
      <div className="bm-tile">
        <span className="bm-tile-label">Logo</span>
        {/* (a narrow tile: its buttons go under the logo instead of out past its edge) */}
        <div className="flex-1 flex items-center gap-4 flex-wrap min-w-0">
          <div className="bm-logo">
            {d.logo.path && kit.logo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={kit.logo_url} alt="Your logo" className="max-w-[85%] max-h-[85%] object-contain" />
              : <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>No logo</span>}
          </div>
          {/* (one pair, as tall together as the logo: user, 2026-11-10) */}
          <div className="bm-logo-actions">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => pickLogo(e.target.files?.[0])} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="bm-btn">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>
              {uploading ? 'Uploading…' : d.logo.path ? 'Change' : 'Upload'}
            </button>
            {d.logo.path && (
              <button type="button" className="bm-btn" data-danger onClick={() => set({ ...now(), logo: { ...now().logo, path: null, ratio: null } })}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4h6v3" /></svg>
                Remove
              </button>
            )}
          </div>
        </div>
        {logoError && <p role="alert" className="text-[11px]" style={{ color: '#fca5a5' }}>{logoError}</p>}
      </div>

      {/* Colours: a tap picks a slot; then the picker, its hex, or one of the found colours */}
      <div className="bm-tile">
        <span className="bm-tile-label">Colours</span>
        <div className="flex items-start gap-2 flex-wrap" role="radiogroup" aria-label="Brand colours">
          {slots.map(s => (
            <span key={String(s)} className="bm-slot" data-on={slot === s || undefined}>
              <span className="relative group">
                <button type="button" role="radio" aria-checked={slot === s} aria-label={`${slotName(s)} colour ${colourOf(s)}`}
                  className="bm-swatch" data-on={slot === s || undefined} style={{ background: colourOf(s) }} onClick={() => setSlot(s)} />
                {typeof s === 'number' && (
                  <button type="button" aria-label={`Remove ${slotName(s).toLowerCase()}`} className="bm-swatch-x" onClick={() => removeColour(s)}>×</button>
                )}
              </span>
              <span className="bm-slot-name">{slotName(s)}</span>
            </span>
          ))}
          {d.colors.extra.length < MAX_EXTRA_COLORS && (
            <button type="button" className="bm-swatch bm-swatch-add" aria-label="Add a colour" onClick={() => addColour()}>+</button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11.5px] font-semibold text-[var(--ed-text)] w-[68px]">{slotName(slot)}</span>
          <input type="color" value={current} onChange={e => setColour(slot, e.target.value)} aria-label={`${slotName(slot)} colour`} className="bm-picker" />
          <HexInput value={current} onChange={c => setColour(slot, c)} label={`${slotName(slot)} colour (hex)`} />
          {offers.length > 0 && (
            <span className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>{logoColours.length ? 'From your logo:' : 'Found:'}</span>
              {offers.map(c => (
                <button key={c} type="button" className="bm-offer" style={{ background: c }} aria-label={`Use ${c} as the ${slotName(slot).toLowerCase()} colour`}
                  title={`Use ${c}`} onClick={() => setColour(slot, c)} />
              ))}
            </span>
          )}
        </div>
        <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
          Primary fills frame title bands. All of them are offered first for your text and captions.
        </span>
      </div>
    </div>
  )
}

/** A colour typed as hex: taken once it's a full #rrggbb */
function HexInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input value={draft ?? value} maxLength={7} aria-label={label} className="bm-input bm-hex"
      onChange={e => { setDraft(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase()) }}
      onBlur={() => setDraft(null)} />
  )
}
