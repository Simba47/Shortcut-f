'use client'

import { useEffect, useRef, useState } from 'react'
import type { StockResult } from './BrollPanel'

// ── Media ▸ Memes ─────────────────────────────────────────────────────────────
// Meme GIFs, still memes and clips — Indian ones too (Brahmanandam, Vadivelu, Hera Pheri…), which
// the stock libraries don't carry. One search, every kind at once (user, 2026-10-31: no GIFs ·
// Memes · Clips switch, one section of the three), from every library (user, 2026-10-30: KLIPY,
// GIPHY and Imgflip side by side to see which gives the best results):
//   KLIPY: GIFs, memes and clips, interleaved, each tile marked GIF / Meme / Clip
//   GIPHY: GIFs · Imgflip: meme templates (shown only when it finds some)
// Each library's results are a section of their own, under its name, and each tile says where it
// is from: KLIPY's and GIPHY's terms forbid mixing their items with another library's in one grid.
// A GIF or clip goes in as B-roll (its mp4), a still like a photo; either is saved to the user's
// media first — which KLIPY and GIPHY only allow with their written approval (asked of KLIPY,
// 2026-10-30).
// Their terms also shape the rest: KLIPY and GIPHY are called from the browser (keys from
// /api/memes), results in the order given, "Search KLIPY" in the search box, "Powered by GIPHY"
// on its section, and each KLIPY item added is reported to KLIPY (share trigger). Imgflip goes
// through our server (its key is our account's); without its paid API Premium only its top 100
// templates can be searched, by name.

type Kind = 'gifs' | 'memes' | 'clips'
type Source = 'klipy' | 'giphy' | 'imgflip'
const KINDS: Kind[] = ['gifs', 'memes', 'clips']
/** A tile's kind badge */
const KIND_NAMES: Record<Kind, string> = { gifs: 'GIF', memes: 'Meme', clips: 'Clip' }
const SOURCES: Source[] = ['klipy', 'giphy', 'imgflip']
const SOURCE_NAMES: Record<Source, string> = { klipy: 'KLIPY', giphy: 'GIPHY', imgflip: 'Imgflip' }
/** What each library has, under its name */
const SOURCE_HAS: Record<Source, string> = { klipy: 'GIFs, memes and clips', giphy: 'GIFs', imgflip: 'Meme templates' }
const KLIPY_API = 'https://api.klipy.com/api/v1'
const KLIPY_KIND: Record<Kind, string> = { gifs: 'gifs', memes: 'static-memes', clips: 'clips' }
/** Searched on opening, before anything is typed (KLIPY's own trending is mostly American) */
const OPENING_WORDS = 'telugu'

interface MemeItem {
  ref: string          // what our server saves it as: "klipy:gif:<slug>", "giphy:gif:<id>", "imgflip:<id>"…
  source: Source
  kind: Kind
  title: string
  thumb: string        // small, moving for GIFs and clips
  url: string          // what is added: the mp4 (GIFs, clips) or the picture (stills)
  video: boolean
  width: number; height: number
  /** KLIPY's id for its share trigger */
  slug?: string
}
interface Section { source: Source; items: MemeItem[] | null; error?: string; note?: string }
type Keys = { klipy: string | null; giphy: string | null; customer_id: string | null }

type KlipyFile = { url?: string; width?: number; height?: number }
type KlipyRaw = {
  slug?: string; title?: string
  file?: Record<string, Record<string, KlipyFile> | string | undefined>
  file_meta?: Record<string, { width?: number; height?: number }>
}
function fromKlipy(kind: Kind, r: KlipyRaw): MemeItem | null {
  if (!r.slug || !r.file) return null
  const size = (s: string) => (typeof r.file?.[s] === 'object' ? r.file[s] as Record<string, KlipyFile> : undefined)
  if (kind === 'clips') {
    const url = typeof r.file.mp4 === 'string' ? r.file.mp4 : null
    const thumb = typeof r.file.webp === 'string' ? r.file.webp : typeof r.file.gif === 'string' ? r.file.gif : null
    if (!url || !thumb) return null
    return { ref: `klipy:clip:${r.slug}`, source: 'klipy', kind, slug: r.slug, title: r.title ?? 'Clip', thumb, url, video: true, width: r.file_meta?.mp4?.width ?? 854, height: r.file_meta?.mp4?.height ?? 480 }
  }
  const small = size('sm') ?? size('md')
  const big = kind === 'gifs' ? size('hd')?.mp4 ?? size('md')?.mp4 : size('hd')?.png ?? size('md')?.png ?? size('hd')?.webp
  const thumb = small?.webp?.url ?? small?.gif?.url ?? small?.png?.url
  if (!big?.url || !thumb) return null
  return {
    ref: `klipy:${kind === 'gifs' ? 'gif' : 'meme'}:${r.slug}`, source: 'klipy', kind, slug: r.slug, title: r.title ?? (kind === 'gifs' ? 'GIF' : 'Meme'),
    thumb, url: big.url, video: kind === 'gifs', width: big.width ?? 0, height: big.height ?? 0,
  }
}

type GiphyImage = { url?: string; mp4?: string; webp?: string; width?: string; height?: string }
type GiphyRaw = { id?: string; title?: string; images?: Record<string, GiphyImage | undefined> }
function fromGiphy(r: GiphyRaw): MemeItem | null {
  const big = r.images?.original
  const small = r.images?.fixed_width_small ?? r.images?.fixed_width
  const thumb = small?.webp ?? small?.url
  if (!r.id || !big?.mp4 || !thumb) return null
  return { ref: `giphy:gif:${r.id}`, source: 'giphy', kind: 'gifs', title: r.title?.trim() || 'GIF', thumb, url: big.mp4, video: true, width: Number(big.width) || 0, height: Number(big.height) || 0 }
}

/** A video's length in seconds, read in the browser (the libraries give none for GIFs) */
function videoSeconds(url: string): Promise<number> {
  return new Promise(resolve => {
    const v = document.createElement('video')
    const done = (s: number) => { clearTimeout(timer); v.removeAttribute('src'); v.load(); resolve(s) }
    const timer = setTimeout(() => done(0), 8000)
    v.preload = 'metadata'; v.muted = true
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : 0)
    v.onerror = () => done(0)
    v.src = url
  })
}

const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 100) / 10); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` }
const muted = (a: number) => `rgb(var(--ed-fg) / ${a})`

export function MemesPanel({ currentTimeMs, onAddVideo, onAddPhoto }: {
  currentTimeMs: number
  /** A GIF's or clip's mp4: put in as B-roll at the playhead */
  onAddVideo: (item: StockResult, lengthMs: number) => Promise<void>
  /** A still, saved to the user's photos: put in at the playhead */
  onAddPhoto: (photo: { storage_path: string; preview_url: string }) => void
}) {
  const [query, setQuery] = useState('')
  const [sections, setSections] = useState<Section[]>([])
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<MemeItem | null>(null)
  const [adding, setAdding] = useState(false)
  const keys = useRef<Promise<Keys> | null>(null)
  /** The words the results shown are for ('' = the ones shown on opening) */
  const asked = useRef('')

  const getKeys = () => (keys.current ??= fetch('/api/memes').then(r => r.ok ? r.json() : null).then(k => k ?? { klipy: null, giphy: null, customer_id: null }).catch(() => {
    keys.current = null
    return { klipy: null, giphy: null, customer_id: null }
  }))

  /** One KLIPY kind's results, in KLIPY's order (throws a message) */
  async function fetchKlipy(key: Keys, k: Kind, words: string): Promise<MemeItem[]> {
    const params = new URLSearchParams({ q: words, per_page: '30', page: '1', locale: 'in', content_filter: 'medium', customer_id: key.customer_id ?? '' })
    const res = await fetch(`${KLIPY_API}/${key.klipy}/${KLIPY_KIND[k]}/search?${params}`)
    if (res.status === 429) throw new Error('KLIPY’s search limit is used up for now.')
    const data = await res.json().catch(() => null) as { result?: boolean; data?: { data?: KlipyRaw[] } } | null
    if (!res.ok || !data?.result) throw new Error('KLIPY isn’t answering right now.')
    return (data.data?.data ?? []).flatMap(r => fromKlipy(k, r) ?? [])
  }

  /** One library's results (throws a message to show in its section) */
  async function fetchFrom(source: Source, term: string): Promise<{ items: MemeItem[]; note?: string }> {
    const words = term || OPENING_WORDS
    if (source === 'imgflip') {
      const res = await fetch(`/api/memes/imgflip?q=${encodeURIComponent(term)}`)
      const data = await res.json().catch(() => null) as { items?: { id: string; name: string; url: string; width: number; height: number }[]; premium?: boolean; error?: string } | null
      if (!res.ok || !data) throw new Error(data?.error ?? 'Imgflip isn’t answering right now.')
      return {
        items: (data.items ?? []).map(m => ({ ref: `imgflip:${m.id}`, source: 'imgflip', kind: 'memes', title: m.name, thumb: m.url, url: m.url, video: false, width: m.width, height: m.height })),
        note: data.premium ? undefined : term ? 'Free plan: only its top 100 templates are searched, by name' : 'Its top 100 templates (the free plan can’t search all of Imgflip)',
      }
    }
    const key = await getKeys()
    if (source === 'giphy') {
      if (!key.giphy) throw new Error('Not set up yet.')
      const params = new URLSearchParams({ api_key: key.giphy, q: words, limit: '30', rating: 'pg-13', country_code: 'IN' })
      const res = await fetch(`https://api.giphy.com/v1/gifs/search?${params}`)
      if (res.status === 429) throw new Error('GIPHY’s search limit is used up for now.')
      const data = await res.json().catch(() => null) as { data?: GiphyRaw[] } | null
      if (!res.ok || !data) throw new Error('GIPHY isn’t answering right now.')
      return { items: (data.data ?? []).flatMap(r => fromGiphy(r) ?? []) }
    }
    if (!key.klipy) throw new Error('Not set up yet.')
    // GIFs, memes and clips side by side; a kind that fails leaves the others (and is named)
    const got = await Promise.allSettled(KINDS.map(k => fetchKlipy(key, k, words)))
    const lists = got.map(g => (g.status === 'fulfilled' ? g.value : []))
    const failed = KINDS.filter((_, i) => got[i].status === 'rejected')
    if (failed.length === KINDS.length) throw (got[0] as PromiseRejectedResult).reason
    // interleaved — a GIF, a meme, a clip, … — each kind still in KLIPY's own order
    const items: MemeItem[] = []
    for (let i = 0; i < Math.max(...lists.map(l => l.length)); i++) for (const l of lists) if (l[i]) items.push(l[i])
    return { items, note: failed.length ? `Its ${failed.map(k => KIND_NAMES[k].toLowerCase() + 's').join(' and ')} didn’t load this time` : undefined }
  }

  function search(q: string) {
    const term = q.trim()
    asked.current = term
    setError(null); setPicked(null)
    setSections(SOURCES.map(source => ({ source, items: null })))
    // each library fills its own section as soon as it answers
    for (const source of SOURCES) {
      const ask = term
      fetchFrom(source, term).then(
        r => { if (asked.current === ask) setSections(s => s.map(x => x.source === source ? { source, items: r.items, note: r.note } : x)) },
        e => { if (asked.current === ask) setSections(s => s.map(x => x.source === source ? { source, items: [], error: e instanceof Error ? e.message : 'Search failed' } : x)) },
      )
    }
  }

  // Something to pick from on opening, before anything is typed
  useEffect(() => { search('') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (!picked) return
    setAdding(true); setError(null)
    try {
      if (!picked.video) {
        const res = await fetch('/api/stock/photos/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: picked.ref, url: picked.url, title: picked.title }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? 'Could not add the meme')
        onAddPhoto(data)
      } else {
        const seconds = await videoSeconds(picked.url)
        const item: StockResult = {
          ref: picked.ref, provider: picked.source, title: picked.title,
          thumb: picked.thumb, preview: picked.url, url: picked.url, width: picked.width, height: picked.height, duration: Math.round(seconds),
        }
        await onAddVideo(item, seconds > 0 ? Math.round(seconds * 1000) : 3000)
      }
      // KLIPY's share trigger: this item was used (their ranking and counts)
      if (picked.source === 'klipy' && picked.slug) {
        const key = await getKeys()
        if (key.klipy) {
          fetch(`${KLIPY_API}/${key.klipy}/${KLIPY_KIND[picked.kind]}/share/${encodeURIComponent(picked.slug)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customer_id: key.customer_id, q: asked.current || OPENING_WORDS }),
          }).catch(() => {})
        }
      }
      setPicked(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add it')
    } finally {
      setAdding(false)
    }
  }

  const words = asked.current
  const searching = sections.some(s => s.items === null)
  // (Imgflip's section only when it found something: its free plan matches few words)
  const shown = sections.filter(s => !(s.source === 'imgflip' && s.items && !s.error && s.items.length === 0))

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 min-h-0">
      <form onSubmit={e => { e.preventDefault(); if (query.trim()) search(query) }} className="flex gap-1.5">
        {/* "Search KLIPY": KLIPY's terms ask for these words in the box */}
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search KLIPY"
          aria-label="Search memes"
          className="min-w-0 flex-1 px-3 py-2 rounded-lg text-sm outline-none"
          style={{ background: muted(0.06), border: `1px solid ${muted(0.1)}`, color: 'var(--ed-text)' }} />
        <button type="submit" disabled={searching || !query.trim()}
          className="shrink-0 px-3 rounded-lg text-xs font-bold disabled:opacity-40" style={{ background: '#c8ff00', color: '#000' }}>
          {searching ? '…' : 'Search'}
        </button>
      </form>

      {error && <p role="alert" className="text-xs" style={{ color: '#f87171' }}>{error}</p>}

      {/* One section per library, in its own order (down to the panel's bottom, like B-roll) */}
      <div className="flex-1 min-h-[240px] flex flex-col gap-4 overflow-y-auto -mr-2 pr-2">
        {shown.map(sec => (
          <section key={sec.source} aria-label={SOURCE_NAMES[sec.source]} className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <h3 className="text-[11.5px] font-bold" style={{ color: 'var(--ed-text)' }}>{SOURCE_NAMES[sec.source]}</h3>
              <span className="text-[10.5px] tabular-nums" style={{ color: muted(0.45) }}>
                {SOURCE_HAS[sec.source]} · {sec.items === null ? 'searching…' : sec.error ? '' : `${sec.items.length} result${sec.items.length === 1 ? '' : 's'}`}
              </span>
              {sec.source === 'giphy' && <span className="ml-auto text-[10px]" style={{ color: muted(0.45) }}>Powered by GIPHY</span>}
            </div>
            {sec.note && <p className="text-[10.5px] -mt-0.5" style={{ color: muted(0.45) }}>{sec.note}</p>}
            {sec.error && <p className="text-[11px]" style={{ color: '#f87171' }}>{sec.error}</p>}
            {sec.items === null && (
              <div className="grid grid-cols-2 gap-1.5">
                {Array.from({ length: 4 }, (_, i) => <div key={i} className="rounded-md animate-pulse" style={{ aspectRatio: '4 / 3', background: muted(0.06) }} />)}
              </div>
            )}
            {sec.items && !sec.error && sec.items.length === 0 && (
              <p className="text-[11px]" style={{ color: muted(0.5) }}>Nothing for “{words || OPENING_WORDS}”.</p>
            )}
            {sec.items && sec.items.length > 0 && (
              <div className="grid grid-cols-2 auto-rows-max gap-1.5">
                {sec.items.map(r => (
                  <button key={r.ref} type="button" onClick={() => setPicked(p => (p?.ref === r.ref ? null : r))}
                    title={`${r.title} · ${KIND_NAMES[r.kind]} · ${SOURCE_NAMES[r.source]} · click to pick it`} aria-pressed={picked?.ref === r.ref}
                    className="relative rounded-md overflow-hidden bg-black" style={{ aspectRatio: '4 / 3', outline: picked?.ref === r.ref ? '2px solid #c8ff00' : 'none', outlineOffset: -2 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.thumb} alt={r.title} loading="lazy" className="w-full h-full object-cover" />
                    {/* which library it is from (user, 2026-10-30: to compare them) */}
                    <span className="absolute left-1 top-1 px-1 rounded text-[9px] font-semibold text-white" style={{ background: 'rgba(0,0,0,0.6)' }}>
                      {SOURCE_NAMES[r.source]}
                    </span>
                    {/* what it is: one section holds all three kinds (a clip has sound; a meme is a still) */}
                    <span className="absolute right-1 top-1 px-1 rounded text-[9px] font-bold" data-kind={r.kind}
                      style={{ background: r.kind === 'clips' ? '#c8ff00' : r.kind === 'memes' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.6)', color: r.kind === 'gifs' ? '#fff' : '#000' }}>
                      {KIND_NAMES[r.kind]}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      {/* Add the picked one at the playhead */}
      {picked && (
        <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: muted(0.05), border: `1px solid ${muted(0.1)}` }}>
          <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: muted(0.55) }} title={picked.title}>{picked.title}</span>
          <button type="button" onClick={add} disabled={adding}
            className="shrink-0 px-3 py-1.5 rounded-md text-xs font-bold disabled:opacity-50" style={{ background: '#c8ff00', color: '#000' }}>
            {adding ? 'Adding…' : `Add at ${fmt(currentTimeMs)}`}
          </button>
        </div>
      )}
    </div>
  )
}
