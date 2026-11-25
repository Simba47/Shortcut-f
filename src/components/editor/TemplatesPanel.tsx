'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  TEMPLATE_GROUPS, TEMPLATE_KINDS, buildTemplate, defaultAnchor, kindDef, newTemplate, wholeClip,
  type KitFill, type Measure, type TemplateData, type TemplateKind, type TemplatePic,
} from '@/lib/shared/templates'
import { BG_PAD, TEXT_LINE_EM, withAlpha } from '@/modules/editor/textStyle'

/**
 * The Templates tool (user, 2026-11-22; cards 2026-11-23; mini sidebar 2026-11-23): a narrow column down the left
 * lists the templates as small cards of just the piece (drawn from their real parts, lib/shared/templates.ts),
 * the ones on this clip at its top. The one picked there is edited beside it: its card, style, words, colours,
 * photo and entrance; Apply puts it on the clip (at the playhead, or over the whole clip for the kinds that go
 * there). One on the clip (picked in the column, or on the preview or timeline) opens the same way: Apply changes
 * makes it again in its place.
 */

export interface TemplateOnClip { id: string; data: TemplateData; start_ms: number; end_ms: number }

const ANIMS: { id: TemplateData['anim']; label: string }[] = [{ id: 'slide', label: 'Slide' }, { id: 'pop', label: 'Pop' }, { id: 'fade', label: 'Fade' }]
const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
const KINDS = Object.keys(TEMPLATE_KINDS) as TemplateKind[]
/** The mini sidebar's cards: this wide (px) */
const MINI_W = 84
const FONT = '"CC Roboto", Roboto, Arial, sans-serif'
const chip = (on: boolean): React.CSSProperties => (on ? { background: '#c8ff00', color: '#0a0a0a' } : { background: 'rgb(var(--ed-fg) / 0.08)', color: 'var(--ed-text)' })

/**
 * A template as a card: only its piece, cut out of the frame (its parts' outline, a little room round it) and
 * scaled to fit `maxW` × `maxH`, on a soft video-like backdrop so white and dark pieces both show
 */
function Card({ d, measure, maxW = 280, maxH = 120, frame = false }: { d: TemplateData; measure: Measure; maxW?: number; maxH?: number; frame?: boolean }) {
  const view = useMemo(() => {
    const { texts, photos } = buildTemplate({ ...d, anim: 'fade' }, 'card', defaultAnchor(d), 0, 4000, measure)
    const shown = texts.filter(t => t.opacity !== 0)
    type B = { x: number; y: number; w: number; h: number }
    const boxOf = (t: (typeof texts)[number]): B => {
      const size = t.size ?? 48, bg = !!t.bg_color
      const w = t.w ? t.w * 1080 : measure(t.text, size, t.weight ?? 700) + (bg ? size * BG_PAD.x * 2 : 0)
      const h = Math.max(t.h ? t.h * 1920 : 0, size * TEXT_LINE_EM + (bg ? size * BG_PAD.y * 2 : 0))
      return { x: (t.x ?? 0) * 1080, y: (t.y ?? 0) * 1920, w, h }
    }
    const boxes: B[] = [...shown.map(boxOf), ...photos.map(p => ({ x: p.x * 1080, y: p.y * 1920, w: p.w * 1080, h: p.h * 1920 }))]
    // (an invisible box round the rest marks where it sits, not what shows)
    const pad = 28
    const x0 = Math.min(...boxes.map(b => b.x)) - pad, y0 = Math.min(...boxes.map(b => b.y)) - pad
    const x1 = Math.max(...boxes.map(b => b.x + b.w)) + pad, y1 = Math.max(...boxes.map(b => b.y + b.h)) + pad
    const k = Math.min(maxW / (x1 - x0), maxH / (y1 - y0), 0.5)
    return { texts: shown, photos, x0, y0, w: (x1 - x0) * k, h: (y1 - y0) * k, k }
  }, [d, measure, maxW, maxH])
  const { k } = view
  const piece = (
    <div className={`relative overflow-hidden rounded-md mx-auto ${frame ? 'shrink-0' : ''}`} style={{ width: view.w, height: view.h, background: frame ? undefined : 'linear-gradient(160deg,#3a5a8a,#6c8fbf)' }} aria-hidden="true">
      {view.texts.map(t => {
        const size = (t.size ?? 48) * k, bg = !!t.bg_color
        return (
          <div key={t.id} className="absolute" style={{
            left: ((t.x ?? 0) * 1080 - view.x0) * k, top: ((t.y ?? 0) * 1920 - view.y0) * k,
            fontFamily: FONT, fontSize: size, lineHeight: TEXT_LINE_EM, fontWeight: t.weight ?? 700,
            color: t.text === '.' ? 'transparent' : t.color ?? '#fff', background: bg ? withAlpha(t.bg_color!, t.bg_opacity ?? 1) : undefined,
            borderRadius: bg ? Math.min((t.bg_radius ?? 12) * k, 999) : undefined, padding: bg ? `${size * BG_PAD.y}px ${size * BG_PAD.x}px` : undefined,
            width: t.w ? t.w * 1080 * k : undefined, minHeight: t.h ? t.h * 1920 * k : undefined, whiteSpace: t.w ? 'normal' : 'pre',
            textShadow: !bg && t.shadow !== 'none' ? '0 1px 3px rgba(0,0,0,0.7)' : undefined, boxSizing: 'border-box',
          }}>{t.text}</div>
        )
      })}
      {view.photos.map(p => (
        p.preview_url
          ? <img key={p.id} src={p.preview_url} alt="" className="absolute" style={{ left: (p.x * 1080 - view.x0) * k, top: (p.y * 1920 - view.y0) * k, width: p.w * 1080 * k, height: p.h * 1920 * k }} />
          : <div key={p.id} className="absolute rounded-full" style={{ left: (p.x * 1080 - view.x0) * k, top: (p.y * 1920 - view.y0) * k, width: p.w * 1080 * k, height: p.h * 1920 * k, background: '#f1c27d', boxShadow: '0 0 0 1.5px #fff' }} />
      ))}
    </div>
  )
  // (`frame`: every card the same size, the piece in its middle: the mini sidebar's)
  return frame
    ? <div className="flex items-center justify-center rounded-md overflow-hidden" style={{ width: maxW, height: maxH, background: 'linear-gradient(160deg,#3a5a8a,#6c8fbf)' }} aria-hidden="true">{piece}</div>
    : piece
}

function Field({ label, hint, value, onChange, placeholder, max }: { label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string; max: number }) {
  const style = { background: 'rgb(var(--ed-fg) / 0.05)', color: 'var(--ed-text)', border: '1px solid rgb(var(--ed-fg) / 0.1)' }
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>{label}{hint ? <span style={{ color: 'rgb(var(--ed-fg) / 0.35)' }}> · {hint}</span> : null}</span>
      {max > 60
        ? <textarea value={value} maxLength={max} placeholder={placeholder} rows={3} onChange={e => onChange(e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-1 resize-none" style={style} />
        : <input value={value} maxLength={max} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="h-8 px-2.5 rounded-lg text-xs outline-none focus:ring-1" style={style} />}
    </label>
  )
}

/** What's being edited: a new one of a kind (Apply puts it on), or one on the clip (Apply changes) */
type Editing = { mode: 'new'; kind: TemplateKind } | { mode: 'clip'; id: string }

export function TemplatesPanel({ onClip, selectedId, onSelect, onAdd, onChange, onRemove, kit, adding, measure }: {
  onClip: TemplateOnClip[]
  /** The template picked on the preview or timeline: it opens here */
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Put a new one on. `kitLogo`: its photo is the kit's logo (made round when it's put on) */
  onAdd: (data: TemplateData, kitLogo: boolean) => void
  /** New settings for one on the clip (made again in its place) */
  onChange: (id: string, data: TemplateData) => void
  onRemove: (id: string) => void
  /** The clip's brand kit: what fills new templates, its logo a tap away */
  kit: { name: string; handle: string; main: string; accent: string; logoPath: string | null } | null
  /** A template being put on (its pictures are being made) */
  adding: boolean
  measure: Measure
}) {
  const fill: KitFill | null = kit ? { name: kit.name, handle: kit.handle, main: kit.main, accent: kit.accent } : null
  const [editing, setEditing] = useState<Editing | null>(null)
  const [draft, setDraft] = useState<TemplateData | null>(null)
  /** A new one's photo: the kit's logo (put on with it), one they picked, or none */
  const [kitLogo, setKitLogo] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  /** The edit column's inner width: its card fills it */
  const editRef = useRef<HTMLDivElement>(null)
  const [editW, setEditW] = useState(240)
  useEffect(() => {
    const el = editRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setEditW(Math.floor(el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Something is always open beside the column: the one picked, else the first template
  useEffect(() => {
    if (editing || selectedId) return
    setEditing({ mode: 'new', kind: KINDS[0] }); setDraft(newTemplate(KINDS[0], undefined, fill)); setKitLogo(!!kit?.logoPath)
  }, [editing, selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // One picked on the preview or the timeline opens here
  useEffect(() => {
    if (!selectedId) return
    const t = onClip.find(x => x.id === selectedId)
    if (t && !(editing?.mode === 'clip' && editing.id === selectedId)) { setEditing({ mode: 'clip', id: selectedId }); setDraft(t.data); setError(null) }
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const onClipNow = editing?.mode === 'clip' ? onClip.find(x => x.id === editing.id) ?? null : null
  // (taken off meanwhile: nothing to edit)
  useEffect(() => { if (editing?.mode === 'clip' && !onClipNow) { setEditing(null); setDraft(null) } }, [editing, onClipNow])

  function openNew(kind: TemplateKind) {
    if (editing?.mode === 'new' && editing.kind === kind) return
    onSelect(null)
    setEditing({ mode: 'new', kind }); setDraft(newTemplate(kind, undefined, fill)); setKitLogo(!!kit?.logoPath); setError(null)
  }
  function openOnClip(t: TemplateOnClip) {
    if (editing?.mode === 'clip' && editing.id === t.id) return
    setEditing({ mode: 'clip', id: t.id }); setDraft(t.data); setError(null); onSelect(t.id)
  }
  // (its size and its photos' ids are the clip's: the preview's corner sets the size — not a change here)
  const own = (d: TemplateData) => JSON.stringify({ ...d, scale: undefined, images: undefined })
  const changed = !!draft && !!onClipNow && own(draft) !== own(onClipNow.data)

  async function makePhoto(body: FormData | { from: string; fit: 'cover' | 'contain' }, label: string): Promise<TemplatePic | null> {
    setBusy(label); setError(null)
    try {
      const res = await fetch('/api/templates/assets', body instanceof FormData
        ? { method: 'POST', body }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json().catch(() => ({})) as { storage_path?: string; preview_url?: string; error?: string }
      if (!res.ok || !d.storage_path) throw new Error(d.error || 'Could not make the photo')
      return { path: d.storage_path, url: d.preview_url ?? null }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make the photo')
      return null
    } finally { setBusy(null) }
  }

  /** The settings under an open card (a plain function, not a component: a component made here would be new on
   *  every render and its fields would lose the cursor at each key) */
  function editorView() {
    if (!draft || !editing) return null
    const d = draft, def = kindDef(d.kind)
    const set = (next: TemplateData) => setDraft(next)
    const isNew = editing.mode === 'new'
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--ed-text)' }}>{def.name}</span>
          {!isNew && onClipNow && <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>On the clip · {fmt(onClipNow.start_ms)}–{fmt(onClipNow.end_ms)}</span>}
        </div>
        <Card d={isNew && kitLogo && kit?.logoPath && def.photo && !d.photo ? { ...d, photo: { path: 'kit', url: null } } : d} measure={measure} maxW={Math.max(120, editW)} maxH={150} />
        {Object.keys(def.variants).length > 1 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Style</span>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(def.variants).map(([v, name]) => (
                <button key={v} type="button" onClick={() => {
                  // (another style: its own starting words where the old style's were untouched)
                  const was = newTemplate(d.kind, d.variant, fill), now = newTemplate(d.kind, v, fill)
                  const fields = Object.fromEntries(Object.entries(d.fields).map(([k, val]) => [k, val === was.fields[k] ? now.fields[k] : val]))
                  set({ ...d, variant: v, fields })
                }} className="h-7 px-2.5 rounded-lg text-[11px] font-semibold" style={chip(v === d.variant)}>{name}</button>
              ))}
            </div>
          </div>
        )}
        {def.fields.map(fd => (
          <Field key={fd.key} label={fd.label} hint={fd.hint} max={fd.max} placeholder={fd.placeholder}
            value={d.fields[fd.key] ?? ''} onChange={v => set({ ...d, fields: { ...d.fields, [fd.key]: v } })} />
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>
            <input type="color" value={d.colors.main} onChange={e => set({ ...d, colors: { ...d.colors, main: e.target.value } })} className="w-7 h-7 rounded cursor-pointer bg-transparent" />
            {def.colors.mainLabel}
          </label>
          {def.colors.accentLabel && (
            <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>
              <input type="color" value={d.colors.accent} onChange={e => set({ ...d, colors: { ...d.colors, accent: e.target.value } })} className="w-7 h-7 rounded cursor-pointer bg-transparent" />
              {def.colors.accentLabel}
            </label>
          )}
          {kit && (
            <button type="button" className="text-[11px] underline" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}
              onClick={() => set({ ...d, colors: newTemplate(d.kind, d.variant, fill).colors })}>Kit colours</button>
          )}
        </div>
        {def.photo && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Photo</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {d.photo?.url && <img src={d.photo.url} alt="" className="w-8 h-8 rounded-full object-cover" />}
              <button type="button" disabled={!!busy} onClick={() => fileRef.current?.click()} className="h-7 px-2.5 rounded-lg text-[11px] font-semibold disabled:opacity-50" style={chip(!!d.photo)}>
                {busy === 'file' ? 'Making it round…' : d.photo ? 'Change photo' : 'Your photo'}
              </button>
              {kit?.logoPath && (
                <button type="button" disabled={!!busy} onClick={async () => {
                  if (isNew) { setKitLogo(true); set({ ...d, photo: null }); return }
                  const p = await makePhoto({ from: kit.logoPath!, fit: 'contain' }, 'logo')
                  if (p) set({ ...d, photo: p })
                }} className="h-7 px-2.5 rounded-lg text-[11px] font-semibold disabled:opacity-50" style={chip(isNew && kitLogo && !d.photo)}>
                  {busy === 'logo' ? 'Making it round…' : 'Kit logo'}
                </button>
              )}
              <button type="button" onClick={() => { setKitLogo(false); set({ ...d, photo: null }) }} className="h-7 px-2.5 rounded-lg text-[11px] font-semibold" style={chip(!d.photo && !(isNew && kitLogo && kit?.logoPath))}>None</button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async e => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                const form = new FormData()
                form.append('file', file); form.append('fit', 'cover')
                const p = await makePhoto(form, 'file')
                if (p) { setKitLogo(false); set({ ...d, photo: p }) }
              }} />
            </div>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Comes in</span>
          <div className="flex gap-1.5">
            {ANIMS.map(a => (
              <button key={a.id} type="button" onClick={() => set({ ...d, anim: a.id })} className="h-7 px-2.5 rounded-lg text-[11px] font-semibold" style={chip(a.id === d.anim)}>{a.label}</button>
            ))}
          </div>
        </div>
        {error && <p className="text-[11px]" style={{ color: '#fca5a5' }}>{error}</p>}
        {isNew ? (
          <div className="flex items-center gap-2">
            <button type="button" disabled={adding || !!busy} onClick={() => onAdd(d, kitLogo && !!kit?.logoPath && !d.photo && !!def.photo)}
              className="h-8 px-4 rounded-lg text-xs font-bold disabled:opacity-50" style={{ background: '#c8ff00', color: '#0a0a0a' }}>
              {adding ? 'Applying…' : 'Apply'}
            </button>
            <span className="text-[10.5px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>{wholeClip(d) ? 'Over the whole clip' : 'At the playhead, for 4 s'}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button type="button" disabled={!changed || !!busy} onClick={() => onChange(editing.id, { ...d, scale: onClipNow?.data.scale, images: onClipNow?.data.images ?? d.images })}
              className="h-8 px-4 rounded-lg text-xs font-bold disabled:opacity-40" style={{ background: '#c8ff00', color: '#0a0a0a' }}>
              Apply changes
            </button>
            <button type="button" onClick={() => onRemove(editing.id)} className="h-8 px-3 rounded-lg text-[11px] font-semibold" style={{ color: '#fca5a5', border: '1px solid rgba(239,68,68,0.35)' }}>
              Remove
            </button>
          </div>
        )}
      </div>
    )
  }

  /** A small card in the column */
  const mini = (key: string, on: boolean, label: string, onClick: () => void, d: TemplateData, sub?: string) => (
    <button key={key} type="button" onClick={onClick} aria-pressed={on} title={label}
      className="flex flex-col items-stretch gap-1 p-1.5 rounded-lg transition-colors hover:bg-[rgb(var(--ed-fg)/0.06)]"
      style={{ border: `1px solid ${on ? 'rgb(200 255 0 / 0.75)' : 'rgb(var(--ed-fg) / 0.08)'}`, background: on ? 'rgb(200 255 0 / 0.08)' : undefined }}>
      <Card d={d} measure={measure} maxW={MINI_W - 14} maxH={48} frame />
      <span className="text-[10px] font-semibold leading-tight text-center line-clamp-2" style={{ color: on ? 'var(--ed-text)' : 'rgb(var(--ed-fg) / 0.6)' }}>{label}</span>
      {sub && <span className="text-[9.5px] tabular-nums text-center -mt-0.5" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>{sub}</span>}
    </button>
  )
  const heading = (text: string) => (
    <span className="text-[9.5px] font-semibold uppercase tracking-wide leading-tight px-0.5 pt-1" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>{text}</span>
  )

  return (
    <div className="h-full flex min-h-0">
      {/* The column: what's on this clip, then every template by group */}
      <nav aria-label="Templates" className="shrink-0 h-full overflow-y-auto flex flex-col gap-1.5 p-2" style={{ width: MINI_W + 16, borderRight: '1px solid rgb(var(--ed-fg) / 0.07)' }}>
        {onClip.length > 0 && (
          <>
            {heading('On this clip')}
            {onClip.map(t => mini(`c-${t.id}`, editing?.mode === 'clip' && editing.id === t.id, kindDef(t.data.kind).name, () => openOnClip(t), t.data, `${fmt(t.start_ms)}–${fmt(t.end_ms)}`))}
          </>
        )}
        {TEMPLATE_GROUPS.map(g => (
          <div key={g.id} className="flex flex-col gap-1.5">
            {heading(g.name)}
            {KINDS.filter(k => TEMPLATE_KINDS[k].group === g.id).map(k =>
              // (the kit's logo goes on the kinds with a photo: a stand-in for it here)
              mini(k, editing?.mode === 'new' && editing.kind === k, TEMPLATE_KINDS[k].name, () => openNew(k),
                { ...newTemplate(k, undefined, fill), ...(kindDef(k).photo && kit?.logoPath ? { photo: { path: 'kit', url: null } } : {}) }))}
          </div>
        ))}
      </nav>
      {/* The one picked, to edit */}
      <div className="flex-1 min-w-0 h-full overflow-y-auto p-3">
        <div ref={editRef} className="flex flex-col gap-3">
          {editorView() ?? <p className="text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Pick a template on the left.</p>}
          <p className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>
            {kit ? `Filled from ${kit.name}. ` : ''}After Apply, drag it on the preview and trim it on the timeline.
          </p>
        </div>
      </div>
    </div>
  )
}
