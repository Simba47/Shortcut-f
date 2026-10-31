'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CaptionStyler, FontPicker, loadVideoFonts, type TextCase } from './CaptionStyler'
import { PlatformOverlay, PLATFORM_SAFE, type Platform } from './PlatformOverlay'
import { ensureBrandFont } from './brandFonts'
import { openBrandKits, BRAND_KITS_CLOSED } from '@/components/brand/brandKitsEvents'
import { InteractiveHoverButton } from '@/components/ui/interactive-hover-button'
import { BrandStart, BrandCard, type Found } from '@/components/brand/BrandMaker'
import { KitWords, WordsPreview } from '@/components/brand/BrandWordsEditor'
import { inviteLink, ROLE_NAMES, type KitInviteIn, type KitInviteOut, type KitMember, type KitRole, type KitTeam as KitTeamState } from '@/lib/shared/brandTeam'
import { cardAreas, cardBackgroundPixels, CARD_PATTERNS, CARD_PATTERN_SCALE, CARD_VIDEO_WIDTH, type CardPattern } from '@/lib/shared/brandCard'
import { templateOf, templateFontFamily } from '@/modules/captions/templates'
import {
  LOGO_SIZE, LOGO_SECONDS, MAX_BRAND_FONTS, PROGRESS_HEIGHT, CARD_TEXT_SIZE, type BrandCardSettings,
  brandCaptionStyle, logoBox, showHandle, WATERMARK, isWatermark, brandProgressBar, END_CARD_SECONDS, MAX_END_VIDEO_MS, type BrandProgress, brandTextStyle, MAX_MORE_CAPTIONS, DEFAULT_BRAND_KIT, type LinkBrand, type BrandTextStyle, type BrandCaptionLook,
  type BrandKit, type BrandKitData, type BrandCaptions, type LogoCorner, type LogoShow, type ProgressBar,
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
  /** logo_url: the new logo's link, for showing it (not saved) */
  update: (id: string, patch: KitPatch) => void
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

async function json<T>(res: Response): Promise<T> {
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

  const update = useCallback((id: string, { logo_url, ...patch }: KitPatch) => {
    setKits(ks => ks.map(k => (k.id === id ? {
      ...k, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.data ? { data: patch.data } : {}),
      ...(logo_url !== undefined ? { logo_url } : {}),
    } : k)))
    // (a name being retyped — empty for a moment — isn't saved: the box puts "Brand kit" back if left empty)
    const { name, ...rest } = patch
    const send = name !== undefined && !name.trim() ? rest : patch
    pending.current.set(id, { ...pending.current.get(id), ...send })
    setSaveError(null)
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.set(id, setTimeout(() => flush(id), SAVE_AFTER_MS))
    setSaveState('saving')
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
  return { kits, limit, plan, loading, error, current, select, create, update, remove, leave, invites, answerInvite, uploadLogo, fromLink, saveState, saveError, reload: load }
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

function BrandOnSwitch({ kit, onKitId, onTurnOn, onTurnOff, compact = false }: BrandSwitchProps & { kit: BrandKit; compact?: boolean }) {
  const on = onKitId === kit.id
  const other = onKitId !== null && !on
  return (
    <label className={`flex items-center gap-3 rounded-xl cursor-pointer select-none ${compact ? 'h-9 px-3' : 'p-3'}`}
      style={{ background: on ? 'rgba(200,255,0,0.05)' : 'rgb(var(--ed-fg) / 0.05)', boxShadow: `inset 0 0 0 1px ${on ? 'rgba(200,255,0,0.275)' : 'rgb(var(--ed-fg) / 0.12)'}` }}>
      <span className="flex-1 min-w-0 flex flex-col">
        <span className={`${compact ? 'text-xs' : 'text-[13px]'} font-bold text-[var(--ed-text)]`}>{compact ? (on ? 'On this clip' : 'Off on this clip') : on ? 'Brand kit on' : 'Brand kit off'}</span>
        {!compact && (
          <span className="text-[11px] leading-snug" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
            {on ? 'On this clip and every frame you pick. Changed the kit? Switch off and on.'
              : other ? 'Another kit is on: switching this one on swaps it.'
                : 'Puts your logo, colours and style on this clip.'}
          </span>
        )}
      </span>
      <Switch on={on} label={on ? 'Switch the brand kit off for this clip' : 'Switch this brand kit on for this clip'}
        onChange={v => (v ? onTurnOn(kit) : onTurnOff())} />
    </label>
  )
}

// ── Options panel: the kits, a new one, Apply ────────────────────────────────

export function BrandKitPanel({ brand, onKitId, onTurnOn, onTurnOff, onDelete, progressBar, onProgressBarChange, editing, onEdit }: BrandSwitchProps & {
  brand: BrandKits
  /** Asks first, then deletes */
  onDelete: (kit: BrandKit) => void
  /** This clip's progress bar (null = none) and its change: shown when given */
  progressBar?: ProgressBar | null
  onProgressBarChange?: (bar: ProgressBar | null) => void
  /** The kit's workshop is open (in the video's place); Edit kit opens it */
  editing?: boolean
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
    <div className="p-4 flex flex-col gap-4">
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
            <button key={k.id} type="button" role="option" aria-selected={on} onClick={() => brand.select(k.id)}
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
                <span className="text-[11px] truncate" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                  {k.shared_by ? `Shared by ${k.shared_by}${k.role === 'edit' ? ' · can edit' : ''}${k.data.lock ? ' · brand lock' : ''}` : showHandle(k.data.handle) || 'No @handle yet'}
                </span>
              </span>
              <span className="flex gap-1 shrink-0" aria-hidden="true">
                {[k.data.colors.main, k.data.colors.accent].map((c, i) => <span key={i} className="w-3.5 h-3.5 rounded-full" style={{ background: c, boxShadow: '0 0 0 1px rgb(var(--ed-fg) / 0.2)' }} />)}
              </span>
            </button>
          )
        })}
        {!brand.kits.length && (
          <p className="text-xs leading-relaxed" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
            Make a kit with your colours, logo and @handle, then put it on any clip in one click.
          </p>
        )}
      </div>

      <button type="button" onClick={newKit} disabled={busy || full}
        title={full ? `Your ${planName} plan has room for ${brand.limit} brand kit${brand.limit === 1 ? '' : 's'}. Upgrade for more.` : 'Make a new brand kit'}
        className="flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
        style={{ color: 'var(--ed-text)', background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)' }}>
        <span aria-hidden="true">+</span> {busy ? 'Making…' : 'New brand kit'}
      </button>
      {full && <p className="-mt-2 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>That&rsquo;s all your plan has room for. <a href="/pricing" className="font-semibold hover:underline" style={{ color: 'var(--ed-accent-text)' }}>Upgrade</a> for more.</p>}
      {/* All of them, outside the editor (a new tab: this clip stays open) */}
      <button type="button" onClick={() => openBrandKits()} className="-mt-1 self-center text-[11px] font-semibold hover:underline" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
        All your brand kits</button>
      {note && <p role="alert" className="-mt-2 text-[11px]" style={{ color: '#fca5a5' }}>{note}</p>}

      {brand.current && (
        <div className="flex flex-col gap-3 pt-3" style={{ borderTop: '1px solid rgb(var(--ed-fg) / 0.08)' }}>
          <BrandOnSwitch kit={brand.current} onKitId={onKitId} onTurnOn={onTurnOn} onTurnOff={onTurnOff} />
          {onEdit && (
            <button type="button" onClick={onEdit} aria-pressed={!!editing}
              className="h-9 flex items-center justify-center gap-2 rounded-lg text-xs font-semibold transition-colors"
              style={editing
                ? { color: 'rgb(var(--ed-fg) / 0.55)', background: 'transparent', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }
                : { color: '#0a0a0a', background: '#c8ff00' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
              {editing ? 'Editing it on the right' : brand.current.shared_by && brand.current.role !== 'edit' ? 'See the kit' : 'Edit kit'}
            </button>
          )}
          {onProgressBarChange && (
            <details className="group rounded-lg" style={{ background: 'rgb(var(--ed-fg) / 0.03)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.07)' }}>
              <summary className="flex items-center justify-between px-3 h-9 cursor-pointer select-none text-xs font-semibold text-[var(--ed-text)] list-none">
                This clip <span className="text-[11px] font-normal" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>{progressBar ? 'Progress bar on' : 'Progress bar off'}</span>
              </summary>
              <div className="px-3 pb-3">
                <ClipProgressBar value={progressBar ?? null} onChange={onProgressBarChange}
                  // Switched on: in the kit's accent colour, along the bottom
                  start={{ color: brand.current.data.colors.accent, height: 12, position: 'bottom' }} />
              </div>
            </details>
          )}
          <details className="rounded-lg">
            <summary className="px-1 cursor-pointer select-none text-[11px] font-medium list-none" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>More…</summary>
            <div className="flex flex-col gap-1.5 pt-2 px-1">
              {brand.current.shared_by ? (
                <button type="button" onClick={() => { brand.leave(brand.current!.id).catch(e => setNote(e instanceof Error ? e.message : String(e))) }}
                  className="self-start text-[11px] font-medium hover:underline" style={{ color: '#fca5a5' }}>
                  Stop using this shared kit
                </button>
              ) : (
                <button type="button" onClick={() => onDelete(brand.current!)}
                  className="self-start text-[11px] font-medium hover:underline" style={{ color: '#fca5a5' }}>
                  Delete this kit
                </button>
              )}
            </div>
          </details>
        </div>
      )}
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
        Invite people by email. They accept it on their Brand kits page: copy the invite&rsquo;s link and send it to them. {used} of {state.seats} places used.
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

/** This clip's progress bar: on or off, its colour, thickness and edge */
function ClipProgressBar({ value, start, onChange }: { value: ProgressBar | null; start: ProgressBar; onChange: (bar: ProgressBar | null) => void }) {
  return (
    <div className="flex flex-col gap-2 pt-3" style={{ borderTop: '1px solid rgb(var(--ed-fg) / 0.08)' }}>
      <label className="cap-row cursor-pointer select-none">
        <span className="flex flex-col min-w-0">
          <span className="cap-label">Progress bar</span>
          <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>Fills up as this clip plays</span>
        </span>
        <Switch on={!!value} label="Progress bar on this clip" onChange={on => onChange(on ? (value ?? start) : null)} />
      </label>
      {value && <ProgressBarFields value={value} onChange={onChange} />}
    </div>
  )
}

/** A kit's progress bar (Phase 4): on its clips or not, its colour — the accent colour, or its own — thickness and edge */
function KitProgressBar({ d, onChange }: { d: BrandKitData; onChange: (p: BrandProgress) => void }) {
  const p = d.progress_bar, shown = brandProgressBar({ ...d, progress_bar: { ...p, on: true } })!
  return (
    <>
      <label className="cap-row cursor-pointer select-none">
        <span className="flex flex-col min-w-0">
          <span className="cap-label">On its clips</span>
          <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>A bar that fills up as the clip plays</span>
        </span>
        <Switch on={p.on} label="Progress bar on its clips" onChange={on => onChange({ ...p, on })} />
      </label>
      {p.on && (
        <>
          <label className="cap-row cursor-pointer select-none">
            <span className="cap-label">Your accent colour</span>
            <Switch on={p.color === 'accent'} label="Progress bar in your accent colour" onChange={on => onChange({ ...p, color: on ? 'accent' : d.colors.accent })} />
          </label>
          <ProgressBarFields value={shown} onChange={bar => onChange({ ...p, ...bar, color: bar.color === shown.color ? p.color : bar.color })} />
        </>
      )}
    </>
  )
}

/** A kit's settings with the ones added in Phases 4 and 5 filled in, should they be missing (the server fills them in as it reads a kit) */
const withNewFields = (d: BrandKitData): BrandKitData =>
  d.progress_bar && d.ends && d.words ? d
    : { ...d, progress_bar: d.progress_bar ?? DEFAULT_BRAND_KIT.progress_bar, ends: d.ends ?? DEFAULT_BRAND_KIT.ends, words: d.words ?? DEFAULT_BRAND_KIT.words }

/** A video of the library that can open or close clips: one of the user's own, short enough */
type EndVideoChoice = { id: string; title: string; ms: number }

/**
 * A kit's intro and outro (Phase 4): a short video of the user's library put in before their clips,
 * and one after them (the brand engine: modules/brand/bookends.ts)
 */
function KitBookends({ d, onChange }: { d: BrandKitData; onChange: (ends: Partial<BrandKitData['ends']>) => void }) {
  const [list, setList] = useState<EndVideoChoice[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    fetch('/api/videos?assets=1')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((j: { videos: Array<{ id: string; title?: string | null; duration_ms?: number | null; status?: string; index?: number; is_asset?: boolean; is_upload_asset?: boolean }> }) => {
        if (!live) return
        // (the user's own videos, ready, short enough — not stock footage saved for B-roll)
        setList(j.videos
          .filter(v => (!v.is_asset || v.is_upload_asset) && (v.status ?? 'done') === 'done' && v.duration_ms && v.duration_ms >= 300 && v.duration_ms <= MAX_END_VIDEO_MS)
          .map(v => ({ id: v.id, title: v.title?.trim() || `Video ${v.index ?? ''}`.trim(), ms: v.duration_ms! })))
      })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [])
  const row = (which: 'intro' | 'outro', label: string, hint: string) => {
    const cur = d.ends[which]
    // (the one picked stays listed even when the list can't show it: renamed, or the list not read yet)
    const options = [...(list ?? []), ...(cur && !list?.some(v => v.id === cur.id) ? [{ id: cur.id, title: cur.title || 'Your video', ms: cur.ms }] : [])]
    return (
      <div className="cap-row">
        <span className="flex flex-col min-w-0">
          <span className="cap-label">{label}</span>
          <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>{hint}</span>
        </span>
        <select value={cur?.id ?? ''} aria-label={label}
          onChange={e => {
            const v = options.find(x => x.id === e.target.value)
            onChange({ [which]: v ? { id: v.id, ms: Math.min(MAX_END_VIDEO_MS, v.ms), title: v.title.slice(0, 80) } : null })
          }}
          className="h-9 px-2 rounded-lg text-xs text-[var(--ed-text)] outline-none max-w-[55%]"
          style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }}>
          <option value="">None</option>
          {options.map(v => <option key={v.id} value={v.id}>{v.title} · {Math.round(v.ms / 100) / 10} s</option>)}
        </select>
      </div>
    )
  }
  return (
    <>
      {row('intro', 'Intro', 'Plays before each clip')}
      {row('outro', 'Outro', 'Plays after each clip, after the end card')}
      <p className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
        {failed ? 'Your videos couldn’t be listed — try again in a moment.'
          : list && !list.length ? `Upload a short video (up to ${MAX_END_VIDEO_MS / 1000} s) to use it here.`
          : `Your own videos up to ${MAX_END_VIDEO_MS / 1000} s. Clips with videos on top get them when opened in the editor.`}
      </p>
    </>
  )
}

/** A progress bar's colour, thickness and edge (the clip's, or a kit's) */
function ProgressBarFields({ value, onChange }: { value: ProgressBar; onChange: (bar: ProgressBar) => void }) {
  return (
    <>
      <ColorRow label="Colour" value={value.color} onChange={color => onChange({ ...value, color })} />
      <RangeRow label="Thickness" min={PROGRESS_HEIGHT[0]} max={PROGRESS_HEIGHT[1]} step={1} value={value.height} text={`${value.height} px`}
        onChange={height => onChange({ ...value, height })} />
      <div className="cap-row">
        <span className="cap-label">Edge</span>
        <div role="radiogroup" aria-label="Which edge the progress bar is on" className="cap-seg">
          {([['top', 'Top'], ['bottom', 'Bottom']] as const).map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={value.position === v} onClick={() => onChange({ ...value, position: v })}
              className="cap-seg-btn" data-on={value.position === v || undefined}>{label}</button>
          ))}
        </div>
      </div>
    </>
  )
}

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
// Sound and AI voice / names & spellings were taken out (user, 2026-10-20). The intro / outro, end card
// and kit progress bar taken out then came back in brand kit Phase 4 (2026-10-27), through the brand engine;
// names & spellings came back in Phase 5 (2026-10-28) as the kit's Words, with no paid AI behind them

type StepId = 'basics' | 'text' | 'captions' | 'words' | 'card' | 'team'
const STEPS: Array<{ id: StepId; name: string; short: string; about: string }> = [
  { id: 'basics', name: 'Basics', short: 'Logo, colours, @handle', about: 'What everything else uses: your logo, your colours and your @handle. Start from a link, your logo or a few words, then change anything.' },
  { id: 'text', name: 'Text & fonts', short: 'Titles, fonts, corners', about: 'How text on your clips looks, your own fonts, and how round your videos are in frames.' },
  { id: 'captions', name: 'Captions', short: 'Caption style', about: 'The caption look your clips get with the brand kit on.' },
  { id: 'words', name: 'Words', short: 'Spellings, lines, hashtags', about: 'How your brand writes: names spelled your way in captions, words you never show, your tone, your lines and hashtags. On clips with this kit on (your default kit’s: on clips with none).' },
  { id: 'card', name: 'Branded card', short: 'Card, end card, intro', about: 'Your own frame — its background, where the video sits, your title and @handle — and how your clips start and end.' },
  { id: 'team', name: 'Team', short: 'Share with your team', about: 'Share this kit with your team, and lock its colours and fonts for them.' },
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
  // What the last way in (a link, a logo, a few words) found: the card offers its colours and styles
  const [found, setFound] = useState<Found | null>(null)
  // The app's buttons over the preview: where the logo is safe from them
  const [platform, setPlatform] = useState<Platform>('instagram')
  const latest = useRef<{ id: string; data: BrandKitData; pending: boolean } | null>(null)
  const [step, setStep] = useState<StepId>('basics')
  useEffect(() => { loadVideoFonts() }, [])

  if (!kit) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-semibold text-[var(--ed-text)]">{brand.loading ? 'Loading your brand kits…' : brand.error ? brand.error : 'No brand kit yet'}</p>
        {!brand.loading && !brand.error && (
          <p className="text-xs max-w-xs" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>Make one with &ldquo;New brand kit&rdquo; on the left: your colours, logo, @handle and title style, ready for every clip.</p>
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
  const setCaptions = (c: Partial<BrandCaptions>) => { const cur = now(); set({ ...cur, captions: { ...cur.captions, ...c } }) }
  // A kit someone shared with this user: shown, not changed — unless they can edit it (Phase 6: then all
  // but its team, brand lock, default mark and intro / outro, which are the owner's)
  const shared = !!kit.shared_by
  const readOnly = shared && kit.role !== 'edit'

  const steps = STEPS.filter(x => x.id !== 'team' || !shared)
  const at = Math.max(0, steps.findIndex(x => x.id === step))
  const cur = steps[at]
  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Its name, whether it's saved, the switch for this clip, back to the video */}
      <div className="shrink-0 flex items-center gap-3 px-5" style={{ minHeight: 60, borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
        <KitBadge kit={kit} />
        <input value={kit.name} onChange={e => brand.update(kit.id, { name: e.target.value })} maxLength={40} aria-label="Brand kit name" readOnly={readOnly}
          onBlur={e => { if (!readOnly && !e.target.value.trim()) brand.update(kit.id, { name: 'Brand kit' }) }}
          className="flex-1 min-w-0 bg-transparent text-base font-bold text-[var(--ed-text)] outline-none rounded-md px-1.5 py-1 focus:bg-[rgb(var(--ed-fg)/0.06)]" />
        {readOnly
          ? <span className="text-[11px] shrink-0" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Shared by {kit.shared_by}{d.lock ? ' · brand lock' : ''}</span>
          : <span role="status" className="text-[11px] shrink-0" style={{ color: brand.saveState === 'error' ? '#fca5a5' : 'rgb(var(--ed-fg) / 0.45)' }}>
            {saveLabel(brand)}
          </span>}
        {onTurnOn && onTurnOff && <div className="shrink-0"><BrandOnSwitch kit={kit} onKitId={onKitId} onTurnOn={onTurnOn} onTurnOff={onTurnOff} compact /></div>}
        {/* (a clear way out: "Done", and Esc in the editor — user, 2026-10-28) */}
        <button type="button" onClick={onClose} aria-label={closeLabel} title={`${closeLabel} (Esc)`}
          className="h-8 px-3.5 flex items-center gap-1.5 rounded-lg shrink-0 text-xs font-bold transition-colors hover:brightness-95"
          style={{ background: '#c8ff00', color: '#0a0a0a' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          Done
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* The steps: one page each */}
        <nav aria-label="Brand kit steps" className="shrink-0 w-[184px] p-3 flex flex-col gap-1 overflow-y-auto" style={{ borderRight: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
          {steps.map((x, i) => {
            const on = x.id === cur.id
            return (
              <button key={x.id} type="button" onClick={() => setStep(x.id)} aria-current={on ? 'step' : undefined}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors hover:bg-[rgb(var(--ed-fg)/0.05)]"
                // (the step you're on: a lime edge, no lime fill — user, 2026-10-29)
                style={on ? { background: 'rgb(var(--ed-fg) / 0.05)', boxShadow: 'inset 0 0 0 1.5px rgba(200,255,0,0.325)' } : undefined}>
                <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold tabular-nums"
                  style={on ? { background: 'rgb(var(--ed-fg) / 0.06)', color: 'var(--ed-text)', boxShadow: 'inset 0 0 0 1.5px rgba(200,255,0,0.375)' } : { background: 'rgb(var(--ed-fg) / 0.08)', color: 'rgb(var(--ed-fg) / 0.7)' }}>{i + 1}</span>
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="text-[12.5px] font-semibold leading-snug" style={{ color: on ? 'var(--ed-text)' : 'rgb(var(--ed-fg) / 0.8)' }}>{x.name}</span>
                  <span className="text-[10.5px] leading-snug" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>{x.short}</span>
                </span>
              </button>
            )
          })}
        </nav>

        {/* This step's settings */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-[540px] mx-auto px-6 py-5 flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>Step {at + 1} of {steps.length}</span>
              <h2 className="text-lg font-bold text-[var(--ed-text)]">{cur.name}</h2>
              <p className="text-xs leading-relaxed" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>{cur.about}</p>
            </div>
            {shared && (
              <p className="text-xs leading-relaxed p-3 rounded-lg" style={{ background: 'rgb(var(--ed-fg) / 0.05)', color: 'rgb(var(--ed-fg) / 0.75)' }}>
                {readOnly
                  ? <>{kit.shared_by} shared this kit with you: {onTurnOn ? 'switch it on for your clips' : 'pick it for a clip in the editor'}. Only they can change it.
                    {d.lock && ' Brand lock is on: on clips with this kit, your colours and fonts are its own, and only they can take it off.'}</>
                  : <>{kit.shared_by} shared this kit with you, and you can edit it: changes reach everyone&rsquo;s clips with it. Its team, brand lock and intro / outro stay theirs.</>}
              </p>
            )}
            <div className="flex flex-col gap-5" inert={readOnly || undefined} style={readOnly ? { opacity: 0.6 } : undefined}>
            {cur.id === 'basics' && (
              <>
                {!readOnly && (
                  <Section title="Start from">
                    <BrandStart compact kit={kit} brand={brand} now={now} set={set} onFound={setFound} />
                  </Section>
                )}
                <BrandCard kit={kit} brand={brand} now={now} set={set} found={found} readOnly={readOnly} />
                <Section title="Logo on the clip">
                  <div className="cap-row">
                    <span className="flex flex-col min-w-0">
                      <span className="cap-label">Place</span>
                      <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                        {d.logo.x !== null ? 'Placed by hand — pick a corner to snap it back' : 'A corner, or drag it anywhere on the preview'}
                      </span>
                    </span>
                    <CornerSwitch value={d.logo.x !== null ? null : d.logo.corner} onChange={corner => set({ ...now(), logo: { ...now().logo, corner, x: null, y: null } })} />
                  </div>
                  <label className="cap-row cursor-pointer select-none">
                    <span className="flex flex-col min-w-0">
                      <span className="cap-label">Keep clear of app buttons</span>
                      <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>Away from the header, likes and caption Reels and Shorts put on top</span>
                    </span>
                    <Switch on={d.logo.safe} label="Keep clear of app buttons" onChange={safe => set({ ...now(), logo: { ...now().logo, safe } })} />
                  </label>
                  <label className="cap-row cursor-pointer select-none">
                    <span className="flex flex-col min-w-0">
                      <span className="cap-label">Move off faces and captions</span>
                      <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                        {d.logo.x !== null ? 'Placed by hand: it stays where you put it' : 'On each clip, the clearest corner — yours first'}
                      </span>
                    </span>
                    <Switch on={d.logo.smart} label="Move off faces and captions" onChange={smart => set({ ...now(), logo: { ...now().logo, smart } })} />
                  </label>
                  <div className="cap-row">
                    <span className="cap-label">Shows</span>
                    <div role="radiogroup" aria-label="When the logo shows" className="cap-seg">
                      {([['all', 'Whole clip'], ['start', 'At the start'], ['end', 'At the end']] as const).map(([v, label]) => (
                        <button key={v} type="button" role="radio" aria-checked={d.logo.show === v} onClick={() => set({ ...now(), logo: { ...now().logo, show: v as LogoShow } })}
                          className="cap-seg-btn" data-on={d.logo.show === v || undefined}>{label}</button>
                      ))}
                    </div>
                  </div>
                  {d.logo.show !== 'all' && (
                    <RangeRow label="For" min={LOGO_SECONDS[0]} max={LOGO_SECONDS[1]} step={1} value={d.logo.seconds} text={`${d.logo.seconds} s`}
                      onChange={seconds => set({ ...now(), logo: { ...now().logo, seconds } })} />
                  )}
                  <RangeRow label="Size" min={LOGO_SIZE[0]} max={LOGO_SIZE[1]} step={0.01} value={d.logo.size} text={`${Math.round(d.logo.size * 100)}%`}
                    onChange={size => set({ ...now(), logo: { ...now().logo, size } })} />
                  <RangeRow label="Opacity" min={0.1} max={1} step={0.05} value={d.logo.opacity} text={`${Math.round(d.logo.opacity * 100)}%`}
                    onChange={opacity => set({ ...now(), logo: { ...now().logo, opacity } })} />
                  <div className="cap-row">
                    <span className="flex flex-col min-w-0">
                      <span className="cap-label">Watermark</span>
                      <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>Small and faint, on the whole clip</span>
                    </span>
                    {isWatermark(d.logo)
                      ? <span className="text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>It’s a watermark</span>
                      : <button type="button" className="text-xs font-semibold hover:underline" style={{ color: 'var(--ed-accent-text)' }}
                          onClick={() => set({ ...now(), logo: { ...now().logo, ...WATERMARK } })}>Make it a watermark</button>}
                  </div>
                </Section>
                <Section title="Progress bar">
                  <KitProgressBar d={d} onChange={progress_bar => set({ ...now(), progress_bar })} />
                </Section>
                {!shared && (
                  <Section title="New clips">
                    <DefaultSwitch kit={kit} onChange={on => set({ ...now(), is_default: on })} />
                  </Section>
                )}
              </>
            )}
            {cur.id === 'text' && (
              <>
                <Section title="Title style">
                  <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                    For text on the clip, frame titles and the Branded card: new text starts in it.
                  </p>
                  <FontPicker value={d.title.font} onChange={font => set({ ...now(), title: { ...now().title, font: font === 'sans-serif' ? null : font } })} />
                  <ColorRow label="Colour" value={d.title.color} onChange={color => set({ ...now(), title: { ...now().title, color } })} />
                  <RangeRow label="Size" min={24} max={160} step={2} value={d.title.size} text={`${d.title.size}`}
                    onChange={size => set({ ...now(), title: { ...now().title, size } })} />
                </Section>
                {/* (brand kit Phase 3) the other ready styles: "+ Subtitle" and "+ Call to action" in the editor's Text tool */}
                <Section title="Subtitle style">
                  <TextStyleEditor kind="subtitle" d={d} value={d.styles?.subtitle ?? DEFAULT_BRAND_KIT.styles.subtitle}
                    onChange={v => set({ ...now(), styles: { ...DEFAULT_BRAND_KIT.styles, ...now().styles, subtitle: v } })} />
                </Section>
                <Section title="Call to action style">
                  <TextStyleEditor kind="cta" d={d} value={d.styles?.cta ?? DEFAULT_BRAND_KIT.styles.cta}
                    onChange={v => set({ ...now(), styles: { ...DEFAULT_BRAND_KIT.styles, ...now().styles, cta: v } })} />
                </Section>
                <Section title="Fonts">
                  <BrandFonts fonts={d.fonts} onChange={fonts => set({ ...now(), fonts })} />
                </Section>
                <Section title="Corners">
                  <label className="cap-row cursor-pointer select-none">
                    <span className="flex flex-col min-w-0">
                      <span className="cap-label">Brand corners</span>
                      <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                        {d.frames.corners !== null ? 'While the brand kit is on, every frame’s video is rounded like this' : 'Off: frames keep their own corners'}
                      </span>
                    </span>
                    <Switch on={d.frames.corners !== null} label="Brand corners" onChange={on => set({ ...now(), frames: { ...now().frames, corners: on ? 80 : null } })} />
                  </label>
                  {d.frames.corners !== null && (
                    <RangeRow label="Rounding" min={0} max={100} step={5} value={d.frames.corners} text={`${d.frames.corners}%`}
                      onChange={corners => set({ ...now(), frames: { ...now().frames, corners } })} />
                  )}
                </Section>
              </>
            )}
            {cur.id === 'captions' && (
              <>
                <Section title="Captions">
                  <label className="cap-row cursor-pointer select-none">
                    <span className="flex flex-col min-w-0">
                      <span className="cap-label">Brand captions</span>
                      <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                        {d.captions.on ? 'New clips and the brand kit switch use this caption style' : 'Off: clips keep the caption style they have'}
                      </span>
                    </span>
                    <Switch on={d.captions.on} label="Brand captions" onChange={on => setCaptions({ on })} />
                  </label>
                  {d.captions.on && (
                    <div className="-mx-4 -mb-4">
                      <CaptionStyler
                        style={brandCaptionStyle(d.captions)} textCase={d.captions.uppercase ? 'upper' : 'title'}
                        onChange={u => setCaptions(captionPatch(u))}
                        onTextCaseChange={(c: TextCase) => setCaptions({ uppercase: c === 'upper' })}
                        onEditCaptions={() => {}} onRetranscribe={() => {}} retranscribing={false} hasWords={false} />
                    </div>
                  )}
                </Section>
                {/* (brand kit Phase 3) more looks, switched to in one tap in the editor's Captions tool */}
                <Section title="More caption looks">
                  <MoreCaptionLooks d={d} onChange={more_captions => set({ ...now(), more_captions })} />
                </Section>
              </>
            )}
            {cur.id === 'words' && (
              <KitWords w={d.words} onChange={words => set({ ...now(), words })} />
            )}
            {cur.id === 'card' && (
              <>
                <Section title="Branded card">
                  <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                    Your own frame: pick &ldquo;Branded card&rdquo; in Frames, or use it as the end card, and it looks like this.
                  </p>
                  <input value={d.card_title} onChange={e => set({ ...now(), card_title: e.target.value })} maxLength={80} disabled={readOnly}
                    placeholder="Card title — e.g. your show's name" aria-label="Branded card title"
                    className="h-9 px-3 rounded-lg text-sm text-[var(--ed-text)] outline-none"
                    style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }} />
                  <CardFields value={d.card} onChange={card => set({ ...now(), card })} />
                </Section>
                <Section title="End card">
                  <label className="cap-row cursor-pointer select-none">
                    <span className="flex flex-col min-w-0">
                      <span className="cap-label">End clips on this card</span>
                      <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>The last seconds become this card, the video still playing in it</span>
                    </span>
                    <Switch on={d.ends.card} label="End clips on the Branded card" onChange={card => set({ ...now(), ends: { ...now().ends, card } })} />
                  </label>
                  {d.ends.card && (
                    <RangeRow label="For" min={END_CARD_SECONDS[0]} max={END_CARD_SECONDS[1]} step={1} value={d.ends.seconds} text={`${d.ends.seconds} s`}
                      onChange={seconds => set({ ...now(), ends: { ...now().ends, seconds } })} />
                  )}
                </Section>
                {!shared && (
                  <Section title="Intro and outro">
                    <KitBookends d={d} onChange={ends => set({ ...now(), ends: { ...now().ends, ...ends } })} />
                  </Section>
                )}
              </>
            )}
            {cur.id === 'team' && !shared && (
              <>
                  <Section title="Team">
                    <KitTeam kitId={kit.id} lock={d.lock} onLock={lock => set({ ...now(), lock })} />
                  </Section>
              </>
            )}
            </div>
            {/* Back / Next */}
            <div className="flex items-center justify-between pt-1 pb-6">
              {at > 0 ? (
                <button type="button" onClick={() => setStep(steps[at - 1].id)} className="h-9 px-4 rounded-lg text-xs font-semibold"
                  style={{ color: 'var(--ed-text)', background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }}>
                  ← {steps[at - 1].name}
                </button>
              ) : <span />}
              {/* Next / Done (user, 2026-10-31): on hover the label slides away, a dot grows to fill the button dark,
                  and the label comes back in lime with an arrow (components/ui/interactive-hover-button) */}
              {at < steps.length - 1 ? (
                <InteractiveHoverButton type="button" onClick={() => setStep(steps[at + 1].id)} text={`Next: ${steps[at + 1].name}`}
                  className={KIT_NEXT_BTN} fillClassName={KIT_NEXT_FILL} hoverTextClassName={KIT_NEXT_HOVER_TEXT} />
              ) : (
                <InteractiveHoverButton type="button" onClick={onClose} text="Done"
                  className={KIT_NEXT_BTN} fillClassName={KIT_NEXT_FILL} hoverTextClassName={KIT_NEXT_HOVER_TEXT} />
              )}
            </div>
          </div>
        </div>

        {/* How it looks, for the step (the clip's look only where there's no preview of the clip itself) */}
        {(clipMock || cur.id === 'card' || cur.id === 'words') && (
        <aside aria-label="How it looks" className="shrink-0 w-[244px] p-4 overflow-y-auto flex flex-col items-center gap-2" style={{ borderLeft: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
          {cur.id === 'card' ? (
            <Mock label="Branded card">
              <CardMock kit={kit} />
            </Mock>
          ) : cur.id === 'words' ? (
            <WordsPreview w={d.words} />
          ) : (
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
          )}
          <p className="text-[10.5px] text-center max-w-[200px] mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>Changes save by themselves.</p>
        </aside>
        )}
      </div>
    </div>
  )
}

const MOCK_W = 200, MOCK_H = (MOCK_W * 16) / 9, K = MOCK_W / 1080
/** Frame text is drawn in Montserrat Bold (render.py _frame_text_font) */
const FRAME_FONT = 'Montserrat, sans-serif'

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
    <div className="absolute inset-0" style={{ containerType: 'inline-size' }}>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #3a4150 0%, #1d2129 55%, #2c2a24 100%)' }} />
      <div className="absolute rounded-full" style={{ left: '28%', top: '30%', width: '44%', height: '25%', background: 'rgba(255,255,255,0.08)' }} />
      <div className="absolute inset-x-0 text-center px-3" style={{ top: '18%', fontFamily: d.title.font ?? 'sans-serif', fontWeight: 700, fontSize: d.title.size * K, color: d.title.color, lineHeight: 1.15, textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>
        Your text here
      </div>
      {d.captions.on && <CaptionSample c={d.captions} />}
      {d.progress_bar.on && <KitBarSample d={d} />}
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

/** The kit's progress bar on the preview, part filled, at its thickness on a 1080 × 1920 frame */
function KitBarSample({ d }: { d: BrandKitData }) {
  const bar = brandProgressBar(d)!
  return (
    <div className="absolute inset-x-0 pointer-events-none" style={{ [bar.position]: 0, height: `${(bar.height / 1920) * 100}%`, minHeight: 2 }}>
      <div style={{ width: '60%', height: '100%', background: bar.color }} />
    </div>
  )
}

/** A caption line in the kit's caption style, where captions sit (the spoken word in the highlight colour) */
function CaptionSample({ c }: { c: BrandCaptions }) {
  const tpl = templateOf({ template: c.template })
  const font = c.font ?? (tpl ? templateFontFamily(tpl.font) : 'sans-serif')
  const words = ['Your', 'captions', 'look', 'like', 'this']
  return (
    <div className="absolute inset-x-0 flex flex-wrap justify-center gap-x-[0.3em] px-3 text-center" style={{
      top: '66%', fontFamily: font, fontWeight: 800, fontSize: c.size * K * 1.1, lineHeight: 1.15,
      textTransform: c.uppercase ? 'uppercase' : undefined, textShadow: '0 1px 2px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.85)',
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

/** "Use for new clips": the account's default kit (at most one) */
function DefaultSwitch({ kit, compact = false, onChange }: { kit: BrandKit; compact?: boolean; onChange: (on: boolean) => void }) {
  const on = kit.data.is_default
  return (
    <label className={`flex items-center gap-2 cursor-pointer select-none ${compact ? 'shrink-0' : ''}`}
      title="New clips — made by hand, from Best moments or Ask AI, and by Make my clips — get this kit by themselves">
      <Switch on={on} label="Use for new clips" onChange={onChange} />
      <span className="text-[11.5px] font-semibold" style={{ color: on ? 'var(--ed-accent-text)' : 'rgb(var(--ed-fg) / 0.6)' }}>
        {compact ? 'Default' : 'Use for every new clip'}
      </span>
    </label>
  )
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
          <span className="w-10 text-center text-lg shrink-0" style={{ fontFamily: f.family, color: 'var(--ed-text)' }} aria-hidden="true">Aa</span>
          <input value={f.name} maxLength={40} aria-label={`Name of brand font ${i + 1}`}
            onChange={e => onChange(fonts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            className="flex-1 min-w-0 h-8 px-2 rounded-md text-sm text-[var(--ed-text)] outline-none"
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


/** The Branded card as it starts: the video as a rounded card on the main colour, the title above, the @handle below */
/** The Branded card as the editor and the export draw it (lib/shared/brandCard.ts): its background, video, title and @handle */
function CardMock({ kit }: { kit: BrandKit }) {
  const d = kit.data, c = d.card
  const places = cardAreas(c)
  const bgRef = useRef<HTMLCanvasElement>(null)
  const bgKey = JSON.stringify(c.bg)
  useEffect(() => {
    const el = bgRef.current
    if (!el) return
    const W = Math.round(MOCK_W), H = Math.round(MOCK_H)
    el.width = W; el.height = H
    el.getContext('2d')?.putImageData(new ImageData(cardBackgroundPixels(c, W, H), W, H), 0, 0)
  }, [bgKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const box = (a: { x: number; y: number; w: number; h: number }) => ({ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%` })
  return (
    <div className="absolute inset-0">
      <canvas ref={bgRef} className="absolute inset-0 w-full h-full" />
      <div className="absolute" style={{ ...box(places.video), borderRadius: (places.video.radius ?? 0) * K, background: 'linear-gradient(160deg, #3a4150 0%, #1d2129 60%, #2c2a24 100%)' }} />
      {c.title.show && (
        <div className="absolute flex items-center justify-center text-center px-2" style={{ ...box(places.title), fontFamily: d.title.font ? `"${d.title.font}", ${FRAME_FONT}` : FRAME_FONT, fontWeight: 700, fontSize: c.title.size * K, color: c.title.color, lineHeight: 1.1 }}>
          {d.card_title || kit.name}
        </div>
      )}
      {c.handle.show && (
        <div className="absolute flex items-center justify-center" style={{ ...box(places.handle), fontFamily: d.title.font ? `"${d.title.font}", ${FRAME_FONT}` : FRAME_FONT, fontWeight: 700, fontSize: c.handle.size * K, color: c.handle.color }}>
          {showHandle(d.handle) || '@yourchannel'}
        </div>
      )}
    </div>
  )
}

const PATTERN_NAMES: Record<CardPattern, string> = { dots: 'Dots', grid: 'Grid', stripes: 'Stripes', checker: 'Checks', waves: 'Waves' }

/** Everything about the Branded card: background, video, title and @handle */
function CardFields({ value: c, onChange }: { value: BrandCardSettings; onChange: (c: BrandCardSettings) => void }) {
  const seg = <T extends string>(label: string, options: Array<[T, string]>, v: T, pick: (v: T) => void) => (
    <div className="cap-row">
      <span className="cap-label">{label}</span>
      <div className="cap-seg" role="radiogroup" aria-label={label}>
        {options.map(([id, name]) => (
          <button key={id} type="button" role="radio" aria-checked={v === id} data-on={v === id || undefined} className="cap-seg-btn" onClick={() => pick(id)}>{name}</button>
        ))}
      </div>
    </div>
  )
  const sub = (t: string) => <span className="text-[11px] font-semibold uppercase tracking-wide pt-1" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>{t}</span>
  const text = (key: 'title' | 'handle', name: string, at: 'title_at' | 'handle_at') => (
    <>
      <div className="cap-row">
        {sub(name)}
        <Switch on={c[key].show} label={`Show the ${name.toLowerCase()}`} onChange={show => onChange({ ...c, [key]: { ...c[key], show } })} />
      </div>
      {c[key].show && (
        <>
          {seg('Position', [['top', 'Above the video'], ['bottom', 'Below']], c[at], v => onChange({ ...c, [at]: v }))}
          <ColorRow label="Colour" value={c[key].color} onChange={color => onChange({ ...c, [key]: { ...c[key], color } })} />
          <RangeRow label="Size" min={CARD_TEXT_SIZE[0]} max={CARD_TEXT_SIZE[1]} step={2} value={c[key].size} text={`${c[key].size}`}
            onChange={size => onChange({ ...c, [key]: { ...c[key], size } })} />
        </>
      )}
    </>
  )
  return (
    <>
      {sub('Background')}
      {seg('Style', [['solid', 'Colour'], ['gradient', 'Gradient'], ['pattern', 'Pattern']], c.bg.style, style => onChange({ ...c, bg: { ...c.bg, style } }))}
      <ColorRow label={c.bg.style === 'solid' ? 'Colour' : c.bg.style === 'gradient' ? 'From' : 'Ground'} value={c.bg.color}
        onChange={color => onChange({ ...c, bg: { ...c.bg, color } })} />
      {c.bg.style !== 'solid' && (
        <ColorRow label={c.bg.style === 'gradient' ? 'To' : 'Pattern colour'} value={c.bg.color2} onChange={color2 => onChange({ ...c, bg: { ...c.bg, color2 } })} />
      )}
      {c.bg.style === 'gradient' && seg('Direction', [['down', 'Top to bottom'], ['diagonal', 'Diagonal']], c.bg.direction, direction => onChange({ ...c, bg: { ...c.bg, direction } }))}
      {c.bg.style === 'pattern' && (
        <>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Pattern">
            {CARD_PATTERNS.map(pt => (
              <button key={pt} type="button" role="radio" aria-checked={c.bg.pattern === pt} onClick={() => onChange({ ...c, bg: { ...c.bg, pattern: pt } })}
                className="h-8 px-3 rounded-lg text-xs font-semibold transition-colors"
                style={{ color: 'var(--ed-text)', background: c.bg.pattern === pt ? 'rgba(200,255,0,0.06)' : 'rgb(var(--ed-fg) / 0.06)', boxShadow: `inset 0 0 0 1px ${c.bg.pattern === pt ? 'rgba(200,255,0,0.5)' : 'rgb(var(--ed-fg) / 0.1)'}` }}>
                {PATTERN_NAMES[pt]}
              </button>
            ))}
          </div>
          <RangeRow label="Pattern size" min={CARD_PATTERN_SCALE[0]} max={CARD_PATTERN_SCALE[1]} step={4} value={c.bg.scale} text={`${c.bg.scale}`}
            onChange={scale => onChange({ ...c, bg: { ...c.bg, scale } })} />
        </>
      )}
      {sub('Video')}
      <RangeRow label="Width" min={CARD_VIDEO_WIDTH[0] * 100} max={CARD_VIDEO_WIDTH[1] * 100} step={1} value={Math.round(c.video.width * 100)} text={`${Math.round(c.video.width * 100)}%`}
        onChange={w => onChange({ ...c, video: { ...c.video, width: w / 100 } })} />
      <RangeRow label="Up / down" min={0} max={100} step={1} value={Math.round(c.video.y * 100)} text={`${Math.round(c.video.y * 100)}%`}
        onChange={y => onChange({ ...c, video: { ...c.video, y: y / 100 } })} />
      <RangeRow label="Corners" min={0} max={100} step={5} value={c.video.corners} text={`${c.video.corners}`}
        onChange={corners => onChange({ ...c, video: { ...c.video, corners } })} />
      {text('title', 'Title', 'title_at')}
      {text('handle', '@handle', 'handle_at')}
    </>
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

/**
 * A kit's subtitle or call-to-action style (brand kit Phase 3): its font ("Same as title" when it has
 * none of its own), colour, size, a background box (a call to action's is the accent colour until
 * one is picked), capitals — and how it looks
 */
function TextStyleEditor({ kind, d, value, onChange }: { kind: 'subtitle' | 'cta'; d: BrandKitData; value: BrandTextStyle; onChange: (v: BrandTextStyle) => void }) {
  const shown = brandTextStyle(d, kind)
  const boxOn = value.bg !== null
  return (
    <div className="flex flex-col gap-3">
      <div className="bts-sample" style={{
        fontFamily: shown.font ? `"${shown.font}", sans-serif` : undefined, color: shown.color, background: shown.bg ?? 'transparent',
        textTransform: shown.uppercase ? 'uppercase' : undefined, fontSize: Math.max(14, Math.min(26, shown.size / 2.6)),
      }}>{kind === 'cta' ? 'Follow for more' : 'Your subtitle here'}</div>
      <label className="cap-row cursor-pointer select-none">
        <span className="cap-label">Same font as the title</span>
        <Switch on={value.font === null} label="Same font as the title" onChange={on => onChange({ ...value, font: on ? null : d.title.font ?? 'Inter' })} />
      </label>
      {value.font !== null && <FontPicker value={value.font} onChange={font => onChange({ ...value, font: font === 'sans-serif' ? 'Inter' : font })} />}
      <ColorRow label="Colour" value={value.color} onChange={color => onChange({ ...value, color })} />
      <RangeRow label="Size" min={20} max={120} step={2} value={value.size} text={`${value.size}`} onChange={size => onChange({ ...value, size })} />
      <label className="cap-row cursor-pointer select-none">
        <span className="flex flex-col min-w-0">
          <span className="cap-label">Box behind it</span>
          {value.bg === 'accent' && <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>Your accent colour</span>}
        </span>
        <Switch on={boxOn} label="Box behind it" onChange={on => onChange({ ...value, bg: on ? 'accent' : null })} />
      </label>
      {boxOn && <ColorRow label="Box colour" value={shown.bg ?? d.colors.accent} onChange={bg => onChange({ ...value, bg })} />}
      <label className="cap-row cursor-pointer select-none">
        <span className="cap-label">Capitals</span>
        <Switch on={value.uppercase} label="Capitals" onChange={uppercase => onChange({ ...value, uppercase })} />
      </label>
    </div>
  )
}

/**
 * A kit's caption looks besides its main one (brand kit Phase 3, up to MAX_MORE_CAPTIONS): each named
 * ("Bold for hooks"), changed with the editor's own caption choices, or removed; a new one starts as
 * a copy of the main look
 */
function MoreCaptionLooks({ d, onChange }: { d: BrandKitData; onChange: (v: BrandCaptionLook[]) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const looks = d.more_captions ?? []
  const put = (id: string, patch: Partial<BrandCaptionLook>) => onChange(looks.map(l => (l.id === id ? { ...l, ...patch } : l)))
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
        Keep a few looks (one for hooks, one for talking) and switch any clip&rsquo;s captions in one tap in the editor.
      </p>
      {looks.map(l => (
        <div key={l.id} className="mcl-row">
          <div className="flex items-center gap-2">
            <i className="mcl-dot" style={{ background: l.captions.color }} /><i className="mcl-dot" style={{ background: l.captions.highlight_color }} />
            <input value={l.name} maxLength={30} onChange={e => put(l.id, { name: e.target.value })} aria-label="Look name"
              onBlur={e => { if (!e.target.value.trim()) put(l.id, { name: 'Look' }) }}
              className="flex-1 min-w-0 h-8 px-2 rounded-md text-xs text-[var(--ed-text)] outline-none" style={{ background: 'rgb(var(--ed-fg) / 0.06)' }} />
            <button type="button" className="mcl-btn" onClick={() => setOpen(o => (o === l.id ? null : l.id))} aria-expanded={open === l.id}>{open === l.id ? 'Done' : 'Edit'}</button>
            <button type="button" className="mcl-btn" onClick={() => onChange(looks.filter(x => x.id !== l.id))} aria-label={`Remove ${l.name}`}>Remove</button>
          </div>
          {open === l.id && (
            <div className="-mx-3 -mb-3 mt-2">
              <CaptionStyler
                style={brandCaptionStyle(l.captions)} textCase={l.captions.uppercase ? 'upper' : 'title'}
                onChange={u => put(l.id, { captions: { ...l.captions, ...captionPatch(u), on: true } })}
                onTextCaseChange={(c: TextCase) => put(l.id, { captions: { ...l.captions, uppercase: c === 'upper' } })}
                onEditCaptions={() => {}} onRetranscribe={() => {}} retranscribing={false} hasWords={false} />
            </div>
          )}
        </div>
      ))}
      {looks.length < MAX_MORE_CAPTIONS && (
        <button type="button" className="mcl-add" onClick={() => {
          const id = `look-${Date.now().toString(36)}`
          onChange([...looks, { id, name: `Look ${looks.length + 2}`, captions: { ...d.captions, on: true } }])
          setOpen(id)
        }}>+ Add a look</button>
      )}
    </div>
  )
}

export function ColorRow({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return (
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

const CORNERS: { id: LogoCorner; label: string }[] = [
  { id: 'tl', label: 'Top left' }, { id: 'tr', label: 'Top right' }, { id: 'bl', label: 'Bottom left' }, { id: 'br', label: 'Bottom right' },
]

/** Which corner the logo goes in: a little frame with a spot in each corner */
function CornerSwitch({ value, onChange }: { value: LogoCorner | null; onChange: (v: LogoCorner) => void }) {
  return (
    <div role="radiogroup" aria-label="Logo corner" className="relative rounded-md" style={{ width: 44, height: 70, boxShadow: 'inset 0 0 0 1.5px rgb(var(--ed-fg) / 0.25)' }}>
      {CORNERS.map(c => {
        const on = c.id === value
        return (
          <button key={c.id} type="button" role="radio" aria-checked={on} aria-label={c.label} title={c.label} onClick={() => onChange(c.id)}
            className="absolute rounded-[3px] transition-colors"
            style={{
              width: 14, height: 10, [c.id.startsWith('t') ? 'top' : 'bottom']: 5, [c.id.endsWith('l') ? 'left' : 'right']: 5,
              background: on ? '#c8ff00' : 'rgb(var(--ed-fg) / 0.18)',
            }} />
        )
      })}
    </div>
  )
}
