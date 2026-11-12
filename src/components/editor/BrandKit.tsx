'use client'

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useConfirm } from './ConfirmDialog'
import { CaptionStyler, FontPicker, loadVideoFonts, type TextCase } from './CaptionStyler'
import { PlatformOverlay, PLATFORM_SAFE, type Platform } from './PlatformOverlay'
import { ensureBrandFont, KitFontsContext } from './brandFonts'
import { KitColoursContext } from './brandPalette'
import { openBrandKits, BRAND_KITS_CLOSED } from '@/components/brand/brandKitsEvents'
import { InteractiveHoverButton } from '@/components/ui/interactive-hover-button'
import { BrandStart, BrandCard, type Found } from '@/components/brand/BrandMaker'
import type { KitInviteIn } from '@/lib/shared/brandTeam'
import * as kitHistory from '@/modules/brand/kitHistory'
import { templateOf, templateFontFamily } from '@/modules/captions/templates'
import {
  MAX_BRAND_FONTS,
  brandCaptionStyle, captionCaseOf, logoBox, showHandle, brandTextStyle, DEFAULT_BRAND_KIT, type LinkBrand,
  type BrandKit, type BrandKitData, type BrandCaptions,
} from '@/lib/shared/brandKit'

/**
 * The editor's Brand kit tool (user, 2026-10-17): the kits listed in the options panel (pick one,
 * make a new one, Apply it to the clip), and the kit edited in a workshop that takes the video's
 * place in the middle — more room to set it up. Kits are the account's (api/brand-kits), saved as
 * they're changed; how many there can be depends on the plan.
 */

type SaveState = 'saved' | 'saving' | 'error'
type KitPatch = { name?: string; data?: BrandKitData; logo_url?: string | null }
const CURRENT_KEY = 'shortcut:brandKit'
const SAVE_AFTER_MS = 600
/** A save that didn't land is sent again after this long, longer each time (up to RETRY_MAX_MS) */
const RETRY_FIRST_MS = 2000, RETRY_MAX_MS = 30000
/** Inputs that aren't typed in: Ctrl+Z there is the kit's Undo, not the box's own */
const NOT_TYPED = new Set(['range', 'color', 'checkbox', 'radio', 'button', 'file'])

export interface BrandKits {
  kits: BrandKit[]
  limit: number
  plan: string
  loading: boolean
  error: string | null
  current: BrandKit | null
  select: (id: string) => void
  /** A new kit (picked): it's given back */
  create: () => Promise<BrandKit>
  /** logo_url: the new logo's link, for showing it (not saved). `track` false: not a step Undo takes back */
  update: (id: string, patch: KitPatch, track?: boolean) => void
  /** Undo / Redo / Start over in the kit window (modules/brand/kitHistory): kept from `beginHistory` on */
  beginHistory: () => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  /** The kit as it was when the window opened (one step: Undo takes it back) */
  startOver: (id: string) => void
  canStartOver: (id: string) => boolean
  /** What's waiting for a kit sent now, and waited for: null once it's saved, else why it isn't */
  saveNow: (id: string) => Promise<string | null>
  remove: (id: string) => Promise<void>
  /** Stop using a kit someone shared with you */
  leave: (id: string) => Promise<void>
  /** Invites to other people's kits waiting for this account (Phase 6) */
  invites: KitInviteIn[]
  /** Accept an invite (the kit is added and picked) or decline it */
  answerInvite: (id: string, accept: boolean) => Promise<BrandKit | null>
  /** A logo for a kit, stored; `colors`: its own brand colours, read from it (null: they couldn't be) */
  uploadLogo: (file: File) => Promise<{ path: string; url: string | null; ratio: number; colors: { main: string; accent: string | null } | null }>
  /** A brand read from a website or profile link (server services/brandFromLink.ts) */
  fromLink: (url: string) => Promise<LinkBrand>
  saveState: SaveState
  /** Why the server turned a save down (it isn't tried again); null while saves can still land */
  saveError: string | null
  reload: () => void
}

export async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error((body as { error?: string }).error ?? 'Something went wrong. Please try again.'), { status: res.status })
  return body as T
}
/** A save the server turned down for good (the kit gone, not allowed…): sending it again won't help */
const refused = (e: unknown) => { const st = (e as { status?: number })?.status; return !!st && st >= 400 && st < 500 && st !== 408 && st !== 429 }

/** A picture's height ÷ width, read in the browser before it's uploaded */
function pictureRatio(file: File): Promise<number> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : 1) }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(1) }
    img.src = url
  })
}

/** What the kit's save line says */
export const saveLabel = (b: Pick<BrandKits, 'saveState' | 'saveError'>) =>
  b.saveState === 'saving' ? 'Saving…' : b.saveState === 'error' ? (b.saveError ? `Not saved — ${b.saveError}` : 'Not saved yet — trying again…') : 'Saved'

/** The account's brand kits: loaded once, changes saved shortly after they're made */
export function useBrandKits(): BrandKits {
  const [kits, setKits] = useState<BrandKit[]>([])
  const [limit, setLimit] = useState(1)
  const [plan, setPlan] = useState('free')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [invites, setInvites] = useState<KitInviteIn[]>([])
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [saveError, setSaveError] = useState<string | null>(null)
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const pending = useRef(new Map<string, { name?: string; data?: BrandKitData }>())
  /** Each kit's save on its way (the next one waits for it) */
  const sending = useRef(new Map<string, Promise<void>>())
  /** How many times in a row a kit's save hasn't landed (it waits longer before each try) */
  const tries = useRef(new Map<string, number>())
  /** Why the server turned a kit's last save down */
  const turnedDown = useRef(new Map<string, string>())
  const flushRef = useRef<(id: string, keepalive?: boolean) => void>(() => {})

  const load = useCallback(() => {
    setLoading(true); setError(null)
    fetch('/api/brand-kits').then(r => json<{ kits: BrandKit[]; limit: number; plan: string; invites?: KitInviteIn[] }>(r))
      .then(d => {
        setKits(d.kits); setLimit(d.limit); setPlan(d.plan); setInvites(d.invites ?? [])
        let saved: string | null = null
        try { saved = localStorage.getItem(CURRENT_KEY) } catch { /* private window */ }
        setCurrentId(d.kits.some(k => k.id === saved) ? saved : d.kits[0]?.id ?? null)
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])
  // Back to this tab (the kits may have changed in another one: the Brands page, another clip):
  // read again, quietly — only while nothing here is waiting to be saved, so nothing typed is lost
  useEffect(() => {
    const again = () => {
      if (document.visibilityState !== 'visible' || pending.current.size || timers.current.size || sending.current.size) return
      fetch('/api/brand-kits').then(r => json<{ kits: BrandKit[]; limit: number; plan: string; invites?: KitInviteIn[] }>(r))
        .then(d => {
          if (pending.current.size || timers.current.size) return
          setKits(d.kits); setLimit(d.limit); setPlan(d.plan); setInvites(d.invites ?? [])
          setCurrentId(cur => (d.kits.some(k => k.id === cur) ? cur : d.kits[0]?.id ?? null))
        })
        .catch(() => { /* kept as it is */ })
    }
    document.addEventListener('visibilitychange', again)
    window.addEventListener('focus', again)
    // (and when the Brand kits popup closes: the kits changed there)
    window.addEventListener(BRAND_KITS_CLOSED, again)
    return () => { document.removeEventListener('visibilitychange', again); window.removeEventListener('focus', again); window.removeEventListener(BRAND_KITS_CLOSED, again) }
  }, [])

  const flush = useCallback((id: string, keepalive = false) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    const patch = pending.current.get(id)
    pending.current.delete(id)
    // (nothing left to send — only a name being retyped: what's on screen is as saved)
    if (!patch || (patch.name === undefined && patch.data === undefined)) {
      if (!timers.current.size && !pending.current.size && !sending.current.size) setSaveState('saved')
      return
    }
    setSaveState('saving')
    const send = () => fetch(`/api/brand-kits/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch), keepalive })
      .then(r => json<{ kit: BrandKit }>(r))
      // (the saved kit's logo link; what's on screen stays as typed meanwhile)
      .then(d => {
        tries.current.delete(id)
        turnedDown.current.delete(id)
        setKits(ks => ks.map(k => (k.id !== id ? k : {
          ...k, logo_url: d.kit.logo_url ?? k.logo_url,
          // (someone who can edit a team's kit: the logo they uploaded is kept in the owner's folder now)
          ...(k.role === 'edit' && d.kit.data.logo.path !== k.data.logo.path && !pending.current.has(id)
            ? { data: { ...k.data, logo: { ...k.data.logo, path: d.kit.data.logo.path, ratio: d.kit.data.logo.ratio } } } : {}),
        })))
        if (!timers.current.size && !pending.current.size) { setSaveState('saved'); setSaveError(null) }
      })
      .catch(e => {
        // Turned down (the kit deleted elsewhere, not allowed): said why, not sent again
        if (refused(e)) {
          tries.current.delete(id)
          setSaveState('error'); setSaveError(e instanceof Error ? e.message : String(e))
          turnedDown.current.set(id, e instanceof Error ? e.message : String(e))
          return
        }
        // Not saved (no connection, the server busy): the change is kept — under anything changed
        // since — and sent again shortly, then again a little later each time, until it lands
        const newer = pending.current.get(id)
        pending.current.set(id, { ...patch, ...newer })
        setSaveState('error')
        if (keepalive || timers.current.has(id)) return
        const n = (tries.current.get(id) ?? 0) + 1
        tries.current.set(id, n)
        timers.current.set(id, setTimeout(() => flushRef.current(id), Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** (n - 1))))
      })
    // One save of a kit at a time, in order: a slow earlier save landing after a later one would
    // put back what it had (leaving the editor: sent at once)
    const before = keepalive ? undefined : sending.current.get(id)
    const run = before ? before.then(send) : send()
    sending.current.set(id, run)
    run.finally(() => { if (sending.current.get(id) === run) sending.current.delete(id) })
  }, [])
  flushRef.current = flush
  // Leaving the editor: what's still waiting is sent
  useEffect(() => () => { for (const id of [...pending.current.keys()]) flush(id, true) }, [flush])
  // Back online: what's waiting goes at once. Leaving the page: what's waiting is sent on the way
  // out, and if saves have been failing (it may not land), the browser asks first
  useEffect(() => {
    const online = () => { for (const id of [...pending.current.keys()]) flush(id) }
    const leaving = (e: BeforeUnloadEvent) => {
      if (!pending.current.size) return
      const failing = tries.current.size > 0
      for (const id of [...pending.current.keys()]) flush(id, true)
      if (failing) e.preventDefault()
    }
    window.addEventListener('online', online)
    window.addEventListener('beforeunload', leaving)
    return () => { window.removeEventListener('online', online); window.removeEventListener('beforeunload', leaving) }
  }, [flush])

  // Undo / Redo / Start over: the kits as they were before each step (kitHistory). `kitsRef`: the kits
  // as they are, read when a step is taken
  const history = useRef(kitHistory.emptyHistory())
  const [, setHistoryVersion] = useState(0)
  const kitsRef = useRef(kits)
  kitsRef.current = kits
  const stateOf = (id: string): kitHistory.KitState | undefined => {
    const k = kitsRef.current.find(x => x.id === id)
    return k ? { name: k.name, data: k.data, logo_url: k.logo_url ?? null } : undefined
  }
  const setHistory = (h: kitHistory.KitHistory) => { history.current = h; setHistoryVersion(v => v + 1) }

  /** A change on screen, then saved shortly (no step of its own) */
  const apply = useCallback((id: string, { logo_url, ...patch }: KitPatch) => {
    // (the kits as they'll be, for a step taken before the screen updates: Make default's two kits)
    kitsRef.current = kitsRef.current.map(k => (k.id === id ? {
      ...k, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.data ? { data: patch.data } : {}),
      ...(logo_url !== undefined ? { logo_url } : {}),
    } : k))
    setKits(ks => ks.map(k => (k.id === id ? {
      ...k, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.data ? { data: patch.data } : {}),
      ...(logo_url !== undefined ? { logo_url } : {}),
    } : k)))
    // (a name being retyped — empty for a moment — isn't saved: the box puts "Brand kit" back if left empty)
    const { name, ...rest } = patch
    const send = name !== undefined && !name.trim() ? rest : patch
    pending.current.set(id, { ...pending.current.get(id), ...send })
    turnedDown.current.delete(id)
    setSaveError(null)
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.set(id, setTimeout(() => flush(id), SAVE_AFTER_MS))
    setSaveState('saving')
  }, [flush])

  const update = useCallback((id: string, patch: KitPatch, track = true) => {
    const before = stateOf(id)
    if (track && before) setHistory(kitHistory.record(history.current, id, before, Date.now()))
    apply(id, patch)
  }, [apply]) // eslint-disable-line react-hooks/exhaustive-deps

  /** What a step puts back, on screen and saved; the kit it changed is shown */
  const putBack = (put: Record<string, kitHistory.KitState>) => {
    const ids = Object.keys(put)
    for (const id of ids) apply(id, { name: put[id].name, data: put[id].data, logo_url: put[id].logo_url })
    if (ids.length) setCurrentId(cur => (cur && ids.includes(cur) ? cur : ids[ids.length - 1]))
  }
  const beginHistory = useCallback(() => setHistory(kitHistory.emptyHistory()), [])
  const undo = useCallback(() => {
    const r = kitHistory.undo(history.current, stateOf)
    if (r) { setHistory(r.h); putBack(r.put) }
  }, [apply]) // eslint-disable-line react-hooks/exhaustive-deps
  const redo = useCallback(() => {
    const r = kitHistory.redo(history.current, stateOf)
    if (r) { setHistory(r.h); putBack(r.put) }
  }, [apply]) // eslint-disable-line react-hooks/exhaustive-deps
  const startOver = useCallback((id: string) => {
    const was = history.current.first[id]
    const now = stateOf(id)
    if (!was || !now || kitHistory.sameState(was, now)) return
    // (a step of its own: Undo takes the start over back)
    setHistory(kitHistory.record(history.current, id, now, Date.now(), true))
    putBack({ [id]: was })
  }, [apply]) // eslint-disable-line react-hooks/exhaustive-deps
  const canStartOver = (id: string) => kitHistory.changedSinceOpen(history.current, id, stateOf(id))

  const saveNow = useCallback(async (id: string) => {
    if (pending.current.has(id)) flush(id)
    await sending.current.get(id)
    return turnedDown.current.get(id) ?? (pending.current.has(id) ? 'Not saved yet: check your connection. It keeps trying by itself.' : null)
  }, [flush])

  const select = useCallback((id: string) => {
    setCurrentId(id)
    try { localStorage.setItem(CURRENT_KEY, id) } catch { /* private window */ }
  }, [])

  const create = useCallback(async () => {
    const { kit } = await fetch('/api/brand-kits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => json<{ kit: BrandKit }>(r))
    setKits(ks => [...ks, kit])
    select(kit.id)
    return kit
  }, [select])

  const remove = useCallback(async (id: string) => {
    timers.current.delete(id); pending.current.delete(id)
    await fetch(`/api/brand-kits/${id}`, { method: 'DELETE' }).then(r => json(r))
    setKits(ks => {
      const rest = ks.filter(k => k.id !== id)
      setCurrentId(cur => (cur === id ? rest[0]?.id ?? null : cur))
      return rest
    })
  }, [])

  const uploadLogo = useCallback(async (file: File) => {
    const ratio = await pictureRatio(file)
    const form = new FormData()
    form.append('file', file)
    const d = await fetch('/api/brand-kits/logo', { method: 'POST', body: form }).then(r => json<{ path: string; url: string | null; colors?: { main: string; accent: string | null } | null }>(r))
    return { ...d, colors: d.colors ?? null, ratio }
  }, [])

  const fromLink = useCallback((url: string) => fetch('/api/brand-kits/from-link', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
  }).then(r => json<LinkBrand>(r)), [])

  const leave = useCallback(async (id: string) => {
    await fetch(`/api/brand-kits/${id}/share`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => json(r))
    setKits(ks => {
      const rest = ks.filter(k => k.id !== id)
      setCurrentId(cur => (cur === id ? rest[0]?.id ?? null : cur))
      return rest
    })
  }, [])

  const answerInvite = useCallback(async (id: string, accept: boolean) => {
    const { kit } = await fetch(`/api/brand-kits/invites/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accept }) })
      .then(r => json<{ kit: BrandKit | null }>(r))
    setInvites(list => list.filter(i => i.id !== id))
    if (kit) { setKits(ks => [...ks.filter(k => k.id !== kit.id), kit]); select(kit.id) }
    return kit
  }, [select])

  const current = kits.find(k => k.id === currentId) ?? null
  return {
    kits, limit, plan, loading, error, current, select, create, update, saveNow, remove, leave, invites, answerInvite, uploadLogo, fromLink, saveState, saveError, reload: load,
    beginHistory, undo, redo, canUndo: history.current.undo.length > 0, canRedo: history.current.redo.length > 0, startOver, canStartOver,
  }
}

/**
 * The brand kit switch for this clip (user, 2026-10-19): on — the kit is on the clip and on every
 * frame or format picked; off — it all comes off again. `onKitId`: the kit on now (null: off).
 */
export interface BrandSwitchProps {
  onKitId: string | null
  onTurnOn: (kit: BrandKit) => void
  onTurnOff: () => void
}

function BrandOnSwitch({ kit, onKitId, onTurnOn, onTurnOff }: BrandSwitchProps & { kit: BrandKit }) {
  const on = onKitId === kit.id
  return (
    <label className="flex items-center gap-3 rounded-xl cursor-pointer select-none h-9 px-3"
      style={{ background: on ? 'rgba(200,255,0,0.05)' : 'rgb(var(--ed-fg) / 0.05)', boxShadow: `inset 0 0 0 1px ${on ? 'rgba(200,255,0,0.275)' : 'rgb(var(--ed-fg) / 0.12)'}` }}>
      <span className="flex-1 min-w-0 text-xs font-bold text-[var(--ed-text)]">{on ? 'On this clip' : 'Off on this clip'}</span>
      <Switch on={on} label={on ? 'Switch the brand kit off for this clip' : 'Switch this brand kit on for this clip'}
        onChange={v => (v ? onTurnOn(kit) : onTurnOff())} />
    </label>
  )
}

// ── Options panel: the kits, a new one, Apply ────────────────────────────────

export function BrandKitPanel({ brand, onEdit }: {
  brand: BrandKits
  /** Opens the kit's workshop (in the video's place) */
  onEdit?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  // (kits shared with this user don't count against their plan)
  const own = brand.kits.filter(k => !k.shared_by).length
  const full = own >= brand.limit
  const planName = brand.plan.charAt(0).toUpperCase() + brand.plan.slice(1)

  async function newKit() {
    setBusy(true); setNote(null)
    try { await brand.create() } catch (e) { setNote(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  if (brand.loading) return <p className="p-4 text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Loading your brand kits…</p>
  if (brand.error) {
    return (
      <div className="p-4 flex flex-col gap-2">
        <p className="text-xs" style={{ color: '#fca5a5' }}>{brand.error}</p>
        <button type="button" onClick={brand.reload} className="self-start text-xs font-semibold hover:underline" style={{ color: 'var(--ed-accent-text)' }}>Try again</button>
      </div>
    )
  }
  return (
    <div className="min-h-full p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="cap-heading">Your kits</h3>
        <span className="text-[11px] tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}
          title={`The ${planName} plan has room for ${brand.limit} brand kit${brand.limit === 1 ? '' : 's'}`}>
          {own} of {brand.limit} · {planName}
        </span>
      </div>

      <div className="flex flex-col gap-2" role="listbox" aria-label="Brand kits">
        {brand.kits.map(k => {
          const on = k.id === brand.current?.id
          return (
            <button key={k.id} type="button" role="option" aria-selected={on} onClick={() => { brand.select(k.id); onEdit?.() }}
              className="flex items-center gap-3 p-2.5 rounded-xl text-left transition-colors"
              style={{ background: on ? 'rgba(200,255,0,0.04)' : 'rgb(var(--ed-fg) / 0.04)', boxShadow: `inset 0 0 0 1px ${on ? 'rgba(200,255,0,0.275)' : 'rgb(var(--ed-fg) / 0.08)'}` }}>
              <KitBadge kit={k} />
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[13px] font-semibold truncate text-[var(--ed-text)]">{k.name}</span>
                  {k.data.is_default && (
                    <span className="shrink-0 px-1.5 py-px rounded text-[9.5px] font-bold uppercase tracking-wide" title="New clips get this kit by themselves"
                      style={{ background: 'rgba(200,255,0,0.07)', color: 'var(--ed-accent-text)' }}>Default</span>
                  )}
                </span>
                {(k.shared_by || k.data.handle) && <span className="text-[11px] truncate" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>{k.shared_by ? `Shared by ${k.shared_by}${k.role === 'edit' ? ' · can edit' : ''}${k.data.lock ? ' · brand lock' : ''}` : showHandle(k.data.handle)}</span>}
              </span>
              <span className="flex gap-1 shrink-0" aria-hidden="true">
                {[k.data.colors.main, k.data.colors.accent].map((c, i) => <span key={i} className="w-3.5 h-3.5 rounded-full" style={{ background: c, boxShadow: '0 0 0 1px rgb(var(--ed-fg) / 0.2)' }} />)}
              </span>
            </button>
          )
        })}
        {!brand.kits.length && (
          <p className="text-xs leading-relaxed" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
            Make a kit with your colours and logo, then put it on any clip in one click.
          </p>
        )}
      </div>

      {/* All of them, outside the editor (a new tab: this clip stays open) */}
      <button type="button" onClick={() => openBrandKits()} className="-mt-1 self-center text-[11px] font-semibold hover:underline" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
        All your brand kits</button>
      {/* At the bottom of the panel, however many kits there are (user, 2026-11-10) */}
      <div className="mt-auto flex flex-col gap-2">
        {full && <p className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>That&rsquo;s all your plan has room for. <a href="/pricing" className="font-semibold hover:underline" style={{ color: 'var(--ed-accent-text)' }}>Upgrade</a> for more.</p>}
        {note && <p role="alert" className="text-[11px]" style={{ color: '#fca5a5' }}>{note}</p>}
        <button type="button" onClick={newKit} disabled={busy || full}
          title={full ? `Your ${planName} plan has room for ${brand.limit} brand kit${brand.limit === 1 ? '' : 's'}. Upgrade for more.` : 'Make a new brand kit'}
          className="flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
          style={{ color: 'var(--ed-text)', background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)' }}>
          <span aria-hidden="true">+</span> {busy ? 'Making…' : 'New brand kit'}
        </button>
      </div>
    </div>
  )
}

/** A picture's height ÷ width from its link (null when it doesn't load) */
export function urlRatio(url: string): Promise<number | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth ? img.naturalHeight / img.naturalWidth : null)
    img.onerror = () => resolve(null)
    setTimeout(() => resolve(null), 8000)
    img.src = url
  })
}


/** A kit's settings with the ones added in Phases 4 and 5 filled in, should they be missing (the server fills them in as it reads a kit) */
const withNewFields = (d: BrandKitData): BrandKitData =>
  d.ends && d.words ? d
    : { ...d, ends: d.ends ?? DEFAULT_BRAND_KIT.ends, words: d.words ?? DEFAULT_BRAND_KIT.words }

export function KitBadge({ kit }: { kit: BrandKit }) {
  return (
    <span className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden" style={{ background: kit.data.colors.main, boxShadow: '0 0 0 1px rgb(var(--ed-fg) / 0.12)' }}>
      {kit.logo_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={kit.logo_url} alt="" className="max-w-[80%] max-h-[80%] object-contain" />
        : <span className="text-sm font-bold" style={{ color: kit.data.colors.accent }}>{kit.name.trim().charAt(0).toUpperCase() || 'B'}</span>}
    </span>
  )
}

// ── Workshop: the kit set up, in the video's place ─────────────────────────
// One step at a time (user, 2026-10-20: the long page was hard to follow), the preview always in view.
// Sound and AI voice / names & spellings were taken out (user, 2026-10-20). The intro / outro and end card
// taken out then came back in brand kit Phase 4 (2026-10-27), through the brand engine; the progress bar
// came back then too, and was taken out for good (user, 2026-11-05);
// names & spellings came back in Phase 5 (2026-10-28) as the kit's Words, with no paid AI behind them
// Words and Team left the steps (user, 2026-11-10): Words is off (BRAND_WORDS_ON), Team is in the profile menu on the top plan
// The Branded card step went too (user, 2026-11-10): its card, end card, intro and outro (BRAND_ENDS_ON)

type StepId = 'basics' | 'style'
const STEPS: Array<{ id: StepId; name: string }> = [
  { id: 'basics', name: 'Basics' },
  { id: 'style', name: 'Text & captions' },
]

/** The Brand kit's Next / Done: lime, a dark dot that fills it on hover, the label back in lime with an arrow */
const KIT_NEXT_BTN = 'w-auto h-9 px-5 py-0 rounded-lg border-0 bg-[#c8ff00] text-[#0a0a0a] text-xs font-bold [&_svg]:size-3.5'
// (the dot waits in the left padding, not over the label: these buttons are wider than the component's own)
const KIT_NEXT_FILL = 'left-[7px] top-[calc(50%-4px)] bg-[#0a0a0a] group-hover:bg-[#0a0a0a]'
// (pinned to the left edge: without it the layer started where the label ends, so the label and arrow
// were pushed right and the arrow cut off — user, 2026-10-31)
const KIT_NEXT_HOVER_TEXT = 'left-0 text-[#c8ff00]'

export function BrandKitStudio({ brand, onKitId = null, onTurnOn, onTurnOff, onClose, closeLabel = 'Back to the video', clipMock = true }: Partial<BrandSwitchProps> & {
  brand: BrandKits; onClose: () => void
  /** What closing it goes back to (the Brands page: "Back to your brands") */
  closeLabel?: string
  /** The "On your clip" phone mock-up on the right. Off in the editor (user, 2026-10-31: its own preview
   *  already shows the clip — "why again this card"); kept on the Brands page, which has no preview */
  clipMock?: boolean
}) {
  const kit = brand.current
  // What the last way in (a link, a logo) found: the card offers its colours
  const [found, setFound] = useState<Found | null>(null)
  // The app's buttons over the preview: where the logo is safe from them
  const [platform, setPlatform] = useState<Platform>('instagram')
  const latest = useRef<{ id: string; data: BrandKitData; pending: boolean } | null>(null)
  const [step, setStep] = useState<StepId>('basics')
  const [saving, setSaving] = useState(false)
  const [notSaved, setNotSaved] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const { confirm, dialog: confirmDialog } = useConfirm()
  useEffect(() => { loadVideoFonts() }, [])
  // Undo / Redo / Start over (user, 2026-11-12): from this opening of the window on; Ctrl/⌘+Z and
  // Ctrl/⌘+Shift+Z (or Ctrl+Y) — not while typing in a box (its own text undo), and never the clip's
  // edits behind it in the editor
  const { beginHistory, undo, redo } = brand
  useEffect(() => { beginHistory() }, [beginHistory])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable || (t.tagName === 'INPUT' && !NOT_TYPED.has((t as HTMLInputElement).type)))) return
      e.preventDefault(); e.stopPropagation()
      if (key === 'y' || e.shiftKey) redo(); else undo()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [undo, redo])

  if (!kit) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-semibold text-[var(--ed-text)]">{brand.loading ? 'Loading your brand kits…' : brand.error ? brand.error : 'No brand kit yet'}</p>
        {!brand.loading && !brand.error && (
          <p className="text-xs max-w-xs" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>Make one with &ldquo;New brand kit&rdquo; on the left: your colours, logo and title style, ready for every clip.</p>
        )}
        <button type="button" onClick={onClose} className="text-xs font-semibold hover:underline" style={{ color: 'var(--ed-accent-text)' }}>{closeLabel}</button>
      </div>
    )
  }
  const d = withNewFields(kit.data)
  // Each change builds on the one before it, even two in a row before the screen updates (picking a
  // caption style sets the style, then its capitals): the second would otherwise undo the first
  latest.current = latest.current && latest.current.id === kit.id && latest.current.pending ? latest.current : { id: kit.id, data: d, pending: false }
  const set = (data: BrandKitData, extra: { name?: string; logo_url?: string | null } = {}) => {
    latest.current = { id: kit.id, data, pending: true }
    queueMicrotask(() => { if (latest.current) latest.current.pending = false })
    brand.update(kit.id, { data, ...extra })
  }
  const now = () => (latest.current?.id === kit.id ? withNewFields(latest.current.data) : d)
  // A kit someone shared with this user: shown, not changed — unless they can edit it (Phase 6: then all
  // but its team, brand lock, default mark and intro / outro, which are the owner's)
  const shared = !!kit.shared_by
  const readOnly = shared && kit.role !== 'edit'

  const steps = STEPS
  const at = Math.max(0, steps.findIndex(x => x.id === step))
  const cur = steps[at]
  const go = (id: StepId) => { setNotSaved(null); setStep(id) }
  /** Save & next (user, 2026-11-10): what's changed is saved first, then `then`; not saved, it stays here and says why */
  async function saveThen(then: () => void) {
    if (saving) return
    setSaving(true); setNotSaved(null)
    const why = await brand.saveNow(kit!.id)
    setSaving(false)
    if (why) setNotSaved(why); else then()
  }
  const nextLabel = saving ? 'Saving…' : readOnly ? (at < steps.length - 1 ? 'Next' : 'Done') : at < steps.length - 1 ? 'Save & next' : 'Save & finish'
  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Its name, whether it's saved, the switch for this clip, back to the video */}
      <div className="shrink-0 flex items-center gap-3 px-5" style={{ minHeight: 60, borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
        <KitBadge kit={kit} />
        {/* Its name, as wide as it is, then rename and delete right beside it (user, 2026-11-10) */}
        <div className="flex-1 min-w-0 flex items-center gap-1">
          <span className="kit-name">
            <span className="kit-name-fit" aria-hidden="true">{kit.name || ' '}</span>
            <input ref={nameRef} value={kit.name} onChange={e => brand.update(kit.id, { name: e.target.value })} maxLength={40} size={1} aria-label="Brand kit name" readOnly={readOnly}
              onBlur={e => { if (!readOnly && !e.target.value.trim()) brand.update(kit.id, { name: 'Brand kit' }) }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
          </span>
          {!readOnly && (
            <button type="button" className="kit-name-btn" aria-label="Rename this kit" title="Rename"
              onClick={() => { nameRef.current?.focus(); nameRef.current?.select() }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>
            </button>
          )}
          {!shared && (
            <button type="button" className="kit-name-btn" data-danger aria-label="Delete this kit" title="Delete"
              onClick={() => confirm({
                title: `Delete “${kit.name}”?`,
                body: 'Are you sure you want to delete this brand kit? This can’t be undone.',
                confirmLabel: 'Delete',
              }, () => { brand.remove(kit.id).catch(e => setNotSaved(e instanceof Error ? e.message : String(e))) })}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4h6v3" /></svg>
            </button>
          )}
        </div>
        {readOnly
          ? <span className="text-[11px] shrink-0" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Shared by {kit.shared_by}{d.lock ? ' · brand lock' : ''}</span>
          : <span role="status" className="text-[11px] shrink-0" style={{ color: brand.saveState === 'error' ? '#fca5a5' : 'rgb(var(--ed-fg) / 0.45)' }}>
            {saveLabel(brand)}
          </span>}
        {!readOnly && (
          <div className="kit-hist shrink-0" role="group" aria-label="Undo changes">
            <button type="button" className="kit-name-btn" onClick={undo} disabled={!brand.canUndo} aria-label="Undo" title="Undo the last change (Ctrl+Z)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 010 11H11" /></svg>
            </button>
            <button type="button" className="kit-name-btn" onClick={redo} disabled={!brand.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 000 11H13" /></svg>
            </button>
            {brand.canStartOver(kit.id) && (
              <button type="button" className="kit-hist-over" title="Put this kit back as it was when you opened it"
                onClick={() => confirm({
                  title: 'Start over?',
                  body: `\u201c${kit.name}\u201d goes back to how it was when you opened it. You can still Undo this.`,
                  confirmLabel: 'Start over', tone: 'warning',
                }, () => brand.startOver(kit.id))}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8" /><path d="M3 3v5h5" /></svg>
                Start over
              </button>
            )}
          </div>
        )}
        {onTurnOn && onTurnOff && <div className="shrink-0"><BrandOnSwitch kit={kit} onKitId={onKitId} onTurnOn={onTurnOn} onTurnOff={onTurnOff} /></div>}
        {/* (a clear way out: "Done", and Esc in the editor — user, 2026-10-28) */}
        <button type="button" onClick={onClose} aria-label={closeLabel} title={`${closeLabel} (Esc)`}
          className="h-8 px-3.5 flex items-center gap-1.5 rounded-lg shrink-0 text-xs font-bold transition-colors hover:brightness-95"
          style={{ background: '#c8ff00', color: '#0a0a0a' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          Done
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* This step: the steps on top and the buttons below stay in view, only what's between scrolls */}
        <div className="bk-work flex-1 min-w-0 flex flex-col">
          <div className="shrink-0 w-full max-w-[960px] mx-auto px-5 pt-3 pb-2">
            {/* The steps, one page each: 1 → 2 → 3 (user, 2026-11-10: a row, not a column — more room) */}
          <nav aria-label="Brand kit steps">
            <ol className="bs-steps">
              {steps.map((x, i) => (
                <li key={x.id}>
                  {i > 0 && <span className="bs-step-line" data-on={i <= at || undefined} aria-hidden="true" />}
                  <button type="button" onClick={() => go(x.id)} className="bs-step" data-on={i === at || undefined} data-done={i < at || undefined} aria-current={i === at ? 'step' : undefined}>
                    <span className="bs-step-n">{i < at ? '✓' : i + 1}</span>{x.name}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-[960px] mx-auto px-5 flex flex-col gap-3">
            {shared && (
              <p className="text-xs leading-relaxed p-3 rounded-lg" style={{ background: 'rgb(var(--ed-fg) / 0.05)', color: 'rgb(var(--ed-fg) / 0.75)' }}>
                {readOnly
                  ? <>{kit.shared_by} shared this kit with you: {onTurnOn ? 'switch it on for your clips' : 'pick it for a clip in the editor'}. Only they can change it.
                    {d.lock && ' Brand lock is on: on clips with this kit, your colours and fonts are its own, and only they can take it off.'}</>
                  : <>{kit.shared_by} shared this kit with you, and you can edit it: changes reach everyone&rsquo;s clips with it. Its team and brand lock stay theirs.</>}
              </p>
            )}
            <div className="flex flex-col gap-5" inert={readOnly || undefined} style={readOnly ? { opacity: 0.6 } : undefined}>
            {cur.id === 'basics' && (
              <BrandCard kit={kit} brand={brand} now={now} set={set} found={found} readOnly={readOnly}
                start={readOnly ? undefined : <BrandStart kit={kit} brand={brand} now={now} set={set} onFound={setFound} />} />
            )}
            {cur.id === 'style' && <TextAndCaptions d={d} now={now} set={set} />}
            </div>
            {/* Back / Save & next: right under the boxes (user, 2026-11-10) */}
            <div className="kit-step-bar flex items-center justify-between gap-3">
              {at > 0 ? (
                <button type="button" onClick={() => go(steps[at - 1].id)} className="h-9 px-4 rounded-lg text-xs font-semibold shrink-0"
                  style={{ color: 'var(--ed-text)', background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }}>
                  ← {steps[at - 1].name}
                </button>
              ) : <span />}
              <div className="flex items-center gap-3 min-w-0">
                {notSaved && <span role="alert" className="text-[11px] min-w-0" style={{ color: '#fca5a5' }}>{notSaved}</span>}
                {/* (on hover the label slides away, a dot grows to fill the button dark, and it comes back in lime with an arrow) */}
                <InteractiveHoverButton type="button" disabled={saving} text={nextLabel}
                  onClick={() => saveThen(() => (at < steps.length - 1 ? go(steps[at + 1].id) : onClose()))}
                  className={`${KIT_NEXT_BTN} shrink-0 disabled:opacity-60`} fillClassName={KIT_NEXT_FILL} hoverTextClassName={KIT_NEXT_HOVER_TEXT} />
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* How it looks, for the step (the clip's look only where there's no preview of the clip itself) */}
        {clipMock && (
        <aside aria-label="How it looks" className="shrink-0 w-[244px] p-4 overflow-y-auto flex flex-col items-center gap-2 max-[860px]:hidden" style={{ borderLeft: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
            <>
              <Mock label="On your clip">
                <ClipMock kit={kit} platform={platform} onPlace={readOnly ? undefined : (x, y) => set({ ...now(), logo: { ...now().logo, x, y } })} />
              </Mock>
              <PlatformSwitch value={platform} onChange={setPlatform} />
              {platform !== 'off' && d.logo.path && logoCovered(d, platform) && (
                <p role="status" className="text-[11px] max-w-[200px]" style={{ color: '#fbbf24' }}>
                  {PLATFORM_SAFE[platform].name}&rsquo;s buttons or text cover part of the logo there — drag it into the clear area.
                </p>
              )}
            </>
          <p className="text-[10.5px] text-center max-w-[200px] mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>Changes save by themselves.</p>
        </aside>
        )}
      </div>
      {confirmDialog && createPortal(<div style={{ position: 'relative', zIndex: 400 }}>{confirmDialog}</div>, document.body)}
    </div>
  )
}

const MOCK_W = 200, MOCK_H = (MOCK_W * 16) / 9, K = MOCK_W / 1080

export function Mock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure className="flex flex-col gap-2 m-0">
      <figcaption className="cap-heading">{label}</figcaption>
      <div className="relative overflow-hidden rounded-xl" style={{ width: MOCK_W, height: MOCK_H, boxShadow: '0 0 0 1px rgb(var(--ed-fg) / 0.12), 0 8px 24px rgba(0,0,0,0.4)' }}>
        {children}
      </div>
    </figure>
  )
}

/**
 * The logo where Apply puts it, over a stand-in video, with a line of text in the title style and a
 * caption line in the kit's caption style. The logo can be dragged anywhere (onPlace: its new
 * top-left, shares of the frame); the app's buttons can be laid over it.
 */
export function ClipMock({ kit, platform = 'off', onPlace }: { kit: BrandKit; platform?: Platform; onPlace?: (x: number, y: number) => void }) {
  const d = withNewFields(kit.data), box = logoBox(d.logo)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const shown = drag ?? { x: box.x, y: box.y }
  function down(e: React.PointerEvent<HTMLImageElement>) {
    if (!onPlace || e.button !== 0) return
    e.preventDefault()
    const frame = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    const x0 = e.clientX, y0 = e.clientY, bx = box.x, by = box.y
    let last = { x: bx, y: by }
    const move = (ev: PointerEvent) => {
      last = {
        x: Math.round(Math.min(1 - box.w, Math.max(0, bx + (ev.clientX - x0) / frame.width)) * 1000) / 1000,
        y: Math.round(Math.min(1 - box.h, Math.max(0, by + (ev.clientY - y0) / frame.height)) * 1000) / 1000,
      }
      setDrag(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setDrag(null)
      if (last.x !== bx || last.y !== by) onPlace(last.x, last.y)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ containerType: 'inline-size' }}>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #3a4150 0%, #1d2129 55%, #2c2a24 100%)' }} />
      <div className="absolute rounded-full" style={{ left: '28%', top: '30%', width: '44%', height: '25%', background: 'rgba(255,255,255,0.08)' }} />
      <div className="absolute inset-x-0 text-center px-3" style={{ top: '18%', fontFamily: d.title.font ?? 'sans-serif', fontWeight: 700, fontSize: d.title.size * K, color: d.title.color, lineHeight: 1.15, textShadow: '0 1px 3px rgba(0,0,0,0.6)', overflowWrap: 'anywhere' }}>
        Your text here
      </div>
      {d.captions.on && <CaptionSample c={d.captions} />}
      {platform !== 'off' && <div className="absolute inset-0 pointer-events-none"><PlatformOverlay platform={platform} /></div>}
      {d.logo.path && kit.logo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={kit.logo_url} alt="Your logo — drag to place it" draggable={false} onPointerDown={down}
          title={onPlace ? 'Drag to place it anywhere' : undefined}
          className="absolute select-none"
          style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, opacity: d.logo.opacity, objectFit: 'fill', cursor: onPlace ? (drag ? 'grabbing' : 'grab') : undefined, touchAction: 'none', outline: drag ? '1.5px dashed #c8ff00' : undefined }} />
      )}
    </div>
  )
}

/** A caption line in the kit's caption style, where captions sit (the spoken word in the highlight colour) */
function CaptionSample({ c }: { c: BrandCaptions }) {
  const tpl = templateOf({ template: c.template })
  // (a font picked, else the caption style's own)
  const font = c.font ?? (tpl ? `"${templateFontFamily(tpl.font)}"` : 'sans-serif')
  const words = ['Your', 'captions', 'look', 'like', 'this']
  return (
    <div className="absolute inset-x-0 flex flex-wrap justify-center gap-x-[0.3em] px-3 text-center" style={{
      top: '66%', fontFamily: font, fontWeight: 800, fontSize: c.size * K * 1.1, lineHeight: 1.15, overflowWrap: 'anywhere',
      textTransform: c.uppercase ? 'uppercase' : c.lowercase ? 'lowercase' : undefined, textShadow: '0 1px 2px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.85)',
    }}>
      {words.map((w, i) => <span key={i} style={{ color: i === 1 && c.animation !== 'none' ? c.highlight_color : c.color }}>{w}</span>)}
    </div>
  )
}

/** Whether the app's buttons or text cover part of the logo where it is */
function logoCovered(d: BrandKitData, platform: Exclude<Platform, 'off'>): boolean {
  const z = PLATFORM_SAFE[platform], b = logoBox(d.logo)
  const hits = (x0: number, y0: number, x1: number, y1: number) => b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0
  return hits(0, 0, 1, z.top) || hits(0, 1 - z.bottom, 1, 1) || hits(1 - z.right, z.rightFrom, 1, 1 - z.bottom)
}

/** Which app's buttons to show over the clip preview */
function PlatformSwitch({ value, onChange }: { value: Platform; onChange: (p: Platform) => void }) {
  return (
    <div role="radiogroup" aria-label="Show an app's buttons over the preview" className="cap-seg self-start">
      {([['off', 'Off'], ['instagram', 'Instagram'], ['youtube', 'Shorts']] as const).map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className="cap-seg-btn" data-on={value === v || undefined}>{label}</button>
      ))}
    </div>
  )
}

/** A caption style change from the Captions panel, as the kit keeps it */
export function captionPatch(u: Partial<import('@/lib/shared/types').CaptionStyle>): Partial<BrandCaptions> {
  const out: Partial<BrandCaptions> = {}
  if ('template' in u) out.template = u.template ?? null
  if (u.animation) out.animation = u.animation
  if ('font' in u) out.font = u.font ?? null
  if (typeof u.size === 'number') out.size = u.size
  if (u.color) out.color = u.color.toLowerCase()
  if (u.highlight_color) out.highlight_color = u.highlight_color.toLowerCase()
  if (typeof u.uppercase === 'boolean') out.uppercase = u.uppercase
  if ('words_per_line' in u) out.words_per_line = u.words_per_line ?? null
  return out
}

export function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={e => { e.preventDefault(); onChange(!on) }}
      // (user, 2026-10-31: less of the palette colour, not none) on: a faint lime track with a fine lime edge
      // and a lime knob, instead of a solid lime track
      className="relative shrink-0 rounded-full transition-colors"
      style={{ width: 34, height: 19, background: on ? 'rgba(200,255,0,0.16)' : 'rgb(var(--ed-fg) / 0.18)', boxShadow: on ? 'inset 0 0 0 1px rgba(200,255,0,0.45)' : 'none' }}>
      <span className="absolute top-[2px] rounded-full transition-[left,background-color]" style={{ left: on ? 17 : 2, width: 15, height: 15, background: on ? 'var(--ed-accent-text)' : '#fff' }} />
    </button>
  )
}

/**
 * The kit's own fonts: upload a TTF or OTF (up to MAX_BRAND_FONTS), rename, remove. They show first
 * in every font choice (captions, text, the title style) and the export draws with them.
 */
function BrandFonts({ fonts, onChange }: { fonts: Array<{ family: string; name: string }>; onChange: (f: Array<{ family: string; name: string }>) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => { fonts.forEach(f => { ensureBrandFont(f.family) }) }, [fonts])
  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/brand-kits/font', { method: 'POST', body: form })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'The font could not be uploaded')
      await ensureBrandFont(body.family)
      onChange([...fonts, { family: body.family, name: body.name }])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {fonts.map((f, i) => (
        <div key={f.family} className="flex items-center gap-2">
          {/* One box: the font's name in the font itself, kept inside it (user, 2026-11-12: no separate "Aa"
              box, no letters past the edge) */}
          <input value={f.name} maxLength={40} aria-label={`Name of brand font ${i + 1}`}
            onChange={e => onChange(fonts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            className="flex-1 min-w-0 h-9 px-3 rounded-md text-sm leading-normal text-[var(--ed-text)] outline-none overflow-hidden text-ellipsis"
            style={{ fontFamily: f.family, background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }} />
          <button type="button" aria-label={`Remove brand font ${f.name}`} onClick={() => onChange(fonts.filter((_, j) => j !== i))}
            className="w-7 h-7 shrink-0 rounded-md text-sm" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>×</button>
        </div>
      ))}
      <input ref={fileRef} type="file" accept=".ttf,.otf,font/ttf,font/otf" className="hidden" aria-label="Upload a font file" onChange={e => upload(e.target.files?.[0])} />
      {fonts.length < MAX_BRAND_FONTS && (
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
          className="self-start h-8 px-3 rounded-lg text-xs font-semibold disabled:opacity-50"
          style={{ color: 'var(--ed-text)', background: 'rgb(var(--ed-fg) / 0.08)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)' }}>
          {busy ? 'Uploading…' : 'Upload a font'}
        </button>
      )}
      <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
        TTF or OTF, up to 10 MB · up to {MAX_BRAND_FONTS}. They show first in every font choice and in your exports. Use fonts you have the right to use.
      </span>
      {error && <p role="alert" className="text-[11px]" style={{ color: '#fca5a5' }}>{error}</p>}
    </div>
  )
}

/** A labelled one-line text field; `commitOnBlur`: typed freely, saved when left (a list typed as text) */
function TextRow({ label, placeholder, value, max, onChange, commitOnBlur = false }: {
  label: string; placeholder: string; value: string; max: number; onChange: (v: string) => void; commitOnBlur?: boolean
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return (
    <label className="flex flex-col gap-1">
      <span className="cap-label">{label}</span>
      <input value={commitOnBlur ? draft : value} maxLength={max} placeholder={placeholder} aria-label={label}
        onChange={e => (commitOnBlur ? setDraft(e.target.value) : onChange(e.target.value))}
        onBlur={() => { if (commitOnBlur && draft !== value) onChange(draft) }}
        onKeyDown={e => { if (commitOnBlur && e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="h-9 px-3 rounded-lg text-sm text-[var(--ed-text)] outline-none"
        style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }} />
    </label>
  )
}


export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 p-4 rounded-2xl" style={{ background: 'rgb(var(--ed-fg) / 0.03)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.08)' }}>
      <h3 className="cap-heading">{title}</h3>
      {children}
    </section>
  )
}

/** A kit's colour offered by name */
interface KitChip { name: string; hex: string }

// (only when the step is open: it brings the editor's drawing code with it)
const CaptionPreview = lazy(() => import('./CaptionPreview').then(m => ({ default: m.CaptionPreview })))

type KitTab = 'captions' | 'style' | 'look' | 'fonts'
const KIT_TABS: Array<{ id: KitTab; label: string; tip: string }> = [
  { id: 'captions', label: 'Captions', tip: 'Brand captions on or off' },
  { id: 'style', label: 'Style', tip: 'How the captions look and move' },
  { id: 'look', label: 'Look', tip: 'Caption colours' },
  // (user, 2026-11-12: no Text tab — its Title style is under Fonts, its Corners card gone)
  { id: 'fonts', label: 'Fonts', tip: 'Caption font, size and capitals, the title style, and your own font files' },
]

/**
 * Text and captions as one step (user, 2026-11-10), built like the editor's Captions panel: the look on
 * a sample pinned over a bar of tabs, one kind of setting at a time. The kit's Primary and Secondary are
 * the colours offered first.
 */
function TextAndCaptions({ d, now, set }: { d: BrandKitData; now: () => BrandKitData; set: (data: BrandKitData) => void }) {
  const [picked, setPicked] = useState<KitTab>('style')
  // Fonts: the sample on top shows the card last touched — the captions', or the title's (user, 2026-11-12)
  const [sampleOf, setSampleOf] = useState<'caption' | 'title'>('caption')
  useEffect(() => { d.fonts.forEach(f => { ensureBrandFont(f.family) }) }, [d.fonts])
  const setCaptions = (c: Partial<BrandCaptions>) => { const cur = now(); set({ ...cur, captions: { ...cur.captions, ...c } }) }
  // (captions off: their Style and Look wait, as in the Captions panel)
  const tab: KitTab = !d.captions.on && (picked === 'style' || picked === 'look') ? 'captions' : picked
  // (Fonts: the captions' font, size and capitals — user, 2026-11-12: moved from Look — so their sample,
  // while captions are on)
  const isText = tab === 'fonts' && (!d.captions.on || sampleOf === 'title')
  const style = brandCaptionStyle(d.captions)
  const textCase: TextCase = captionCaseOf(d.captions)
  const suggest: KitChip[] = [
    { name: 'Primary', hex: d.colors.main }, { name: 'Secondary', hex: d.colors.accent },
    ...d.colors.extra.map((hex, i) => ({ name: `Colour ${i + 3}`, hex })),
  ]
  const sample = brandTextStyle(d, 'title')
  const styler = (section: 'style' | 'colours' | 'font') => (
    // (the font part sits inside the Fonts tab's own panel)
    <div role={section === 'font' ? undefined : 'tabpanel'} aria-label={section === 'style' ? 'Style' : section === 'font' ? undefined : 'Look'} className="kit-cc -mx-4">
      <CaptionStyler section={section} style={style} textCase={textCase}
        onChange={u => setCaptions(captionPatch(u))}
        onTextCaseChange={(c: TextCase) => setCaptions({ uppercase: c === 'upper', lowercase: c === 'lower' })}
        onEditCaptions={() => {}} onRetranscribe={() => {}} retranscribing={false} hasWords={false} />
    </div>
  )
  return (
    <KitFontsContext.Provider value={d.fonts}>
    <KitColoursContext.Provider value={{ primary: d.colors.main, secondary: d.colors.accent, extra: d.colors.extra }}>
      {/* Pinned while the step scrolls, as in the Captions panel: the sample and the tabs */}
      <div className="kit-cc-top">
        <div className="kit-cc-preview">
          {isText ? (
            <div className="cap-preview kit-text-sample">
              <span style={{
                fontFamily: sample.font ? `"${sample.font}", sans-serif` : undefined, color: sample.color, background: sample.bg ?? 'transparent',
                textTransform: sample.uppercase ? 'uppercase' : undefined, fontSize: Math.max(14, Math.min(26, sample.size / 2.6)),
              }}>Your title here</span>
            </div>
          ) : (
            <Suspense fallback={<div className="cap-preview kit-text-sample" />}>
              <CaptionPreview style={style} textCase={textCase} dim={!d.captions.on} />
            </Suspense>
          )}
        </div>
        <div role="tablist" aria-label="Text and caption settings" className="kit-cc-tabs grid gap-0.5 p-0.5 rounded-lg"
          style={{ gridTemplateColumns: `repeat(${KIT_TABS.length}, minmax(0, 1fr))`, background: 'rgb(var(--ed-fg) / 0.06)', border: '1px solid rgb(var(--ed-fg) / 0.07)' }}>
          {KIT_TABS.map(t => {
            const on = tab === t.id
            const off = !d.captions.on && (t.id === 'style' || t.id === 'look')
            return (
              <button key={t.id} type="button" role="tab" aria-selected={on} disabled={off} onClick={() => { setPicked(t.id); setSampleOf('caption') }}
                title={off ? 'Turn on Brand captions first' : t.tip}
                className="h-8 px-1 rounded-md text-[12px] font-semibold whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={on ? { background: 'rgb(var(--ed-fg) / 0.12)', color: 'var(--ed-accent-text)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.08)' } : { color: 'rgb(var(--ed-fg) / 0.6)' }}>
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'captions' && (
        <div role="tabpanel" aria-label="Captions" className="flex flex-col gap-3">
          <div className="cap-card flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2.5">
              <span className="cap-card-icon" data-on={d.captions.on || undefined} aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10 10.5a2 2 0 100 3M16 10.5a2 2 0 100 3" /></svg>
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[var(--ed-text)]">Brand captions</p>
                <p className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                  {d.captions.on ? 'New clips and the brand kit switch use this caption style' : 'Off: clips keep the caption style they have'}
                </p>
              </div>
            </div>
            <Switch on={d.captions.on} label="Brand captions" onChange={on => setCaptions({ on })} />
          </div>
        </div>
      )}
      {tab === 'style' && styler('style')}
      {tab === 'look' && styler('colours')}
      {tab === 'fonts' && (
        <div role="tabpanel" aria-label="Fonts" className="flex flex-col gap-3">
          {/* The captions' font, size and capitals (user, 2026-11-12: here, not under Look), in a card named
              for them beside Title style — "Font" alone didn't say whose */}
          <div onPointerDownCapture={() => setSampleOf('caption')} onFocusCapture={() => setSampleOf('caption')}>
          <Section title="Caption font">
            <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>For the captions on your clips: the words as they're spoken.</p>
            {d.captions.on
              // (the styler's own padding taken back: the card has its own)
              ? <div className="-mt-2 -mb-5">{styler('font')}</div>
              : <p className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Turn on Brand captions (the Captions tab) to set their font, size and capitals.</p>}
          </Section>
          </div>
          <div onPointerDownCapture={() => setSampleOf('title')} onFocusCapture={() => setSampleOf('title')}>
          <Section title="Title style">
            <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>For text on the clip and frame titles: new text starts in it.</p>
            <FontPicker stayOpen value={d.title.font} onChange={font => set({ ...now(), title: { ...now().title, font: font === 'sans-serif' ? null : font } })} />
            <ColorRow label="Colour" value={d.title.color} onChange={color => set({ ...now(), title: { ...now().title, color } })} suggest={suggest} />
            <RangeRow label="Size" min={24} max={160} step={2} value={d.title.size} text={`${d.title.size}`}
              onChange={size => set({ ...now(), title: { ...now().title, size } })} />
          </Section>
          </div>
          <Section title="Your fonts">
            <BrandFonts fonts={d.fonts} onChange={fonts => set({ ...now(), fonts })} />
          </Section>
        </div>
      )}
    </KitColoursContext.Provider>
    </KitFontsContext.Provider>
  )
}

export function ColorRow({ label, hint, value, onChange, suggest }: { label: string; hint?: string; value: string; onChange: (v: string) => void; suggest?: KitChip[] }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return (
    <div className="flex flex-col gap-2">
      <div className="cap-row">
        <span className="flex flex-col min-w-0">
          <span className="cap-label">{label}</span>
          {hint && <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>{hint}</span>}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <input value={draft} onChange={e => { setDraft(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase()) }}
            onBlur={() => setDraft(value)} aria-label={`${label} (hex)`} maxLength={7}
            className="w-20 h-8 px-2 rounded-md text-xs font-mono text-[var(--ed-text)] outline-none" style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }} />
          <input type="color" value={value} onChange={e => onChange(e.target.value.toLowerCase())} aria-label={label}
            className="w-8 h-8 rounded-md cursor-pointer bg-transparent" style={{ border: 'none', padding: 0 }} />
        </span>
      </div>
      {suggest && suggest.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${label}: your brand colours`}>
          {suggest.map(c => (
            <button key={c.name} type="button" className="bm-chip" data-on={c.hex.toLowerCase() === value.toLowerCase() || undefined} onClick={() => onChange(c.hex.toLowerCase())} title={`${c.name} ${c.hex}`}>
              <i className="bm-chip-dot" style={{ background: c.hex }} />{c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function RangeRow({ label, min, max, step, value, text, onChange }: { label: string; min: number; max: number; step: number; value: number; text: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="cap-label w-16 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={e => onChange(Number(e.target.value))}
        className="ed-zoom-range flex-1 min-w-0" style={{ width: 'auto', '--p': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties} />
      <span className="cap-value shrink-0">{text}</span>
    </div>
  )
}

