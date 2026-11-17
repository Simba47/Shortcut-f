import { createHash } from 'node:crypto'
import { aiProvider, askGemini } from '@/lib/gemini'
import { GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import sql from '@/lib/db'
import { r2, R2_BUCKET } from '@/lib/r2'
import { safeName } from './media'

/**
 * Stock video for B-roll in the editor: search, AI ideas for a clip, and adding a shot to the
 * user's assets. Three libraries, each on when its key is set: Pixabay (PIXABAY_API_KEY), Pexels
 * (PEXELS_API_KEY) and Coverr (COVERR_API_KEY); the editor's B-roll tab searches all of them at
 * once and mixes the results (2026-10-30: Pixabay + Coverr; Pexels isn't issuing new keys, so it
 * stays off until a key is set). The same video is saved once per user
 * (videos.stock_ref, shared with the worker's auto B-roll).
 */

export type StockSource = 'pixabay' | 'pexels' | 'coverr'

export interface StockItem {
  ref: string            // "pixabay:<id>" / "pexels:<id>" / "coverr:<id>"
  provider: StockSource
  title: string
  thumb: string          // still image
  preview: string        // small video for hover previews
  url: string            // the file added to the clip (smallest of at least 720p)
  width: number; height: number
  duration: number       // seconds
}

export function stockProvider(): 'pexels' | 'pixabay' | null {
  if (process.env.PEXELS_API_KEY) return 'pexels'
  if (process.env.PIXABAY_API_KEY) return 'pixabay'
  return null
}

/** The video libraries that can be searched (their keys are set), in the order they're offered */
export function stockSources(): StockSource[] {
  return [
    ...(process.env.PIXABAY_API_KEY ? ['pixabay' as const] : []),
    ...(process.env.PEXELS_API_KEY ? ['pexels' as const] : []),
    ...(process.env.COVERR_API_KEY ? ['coverr' as const] : []),
  ]
}

// Search results are kept 24 h (Pixabay's API terms ask for it; it also saves quota)
const cache = new Map<string, { at: number; items: StockItem[] }>()

/**
 * Stock videos for `query`: from every library with a key at once (user, 2026-10-30: "we will
 * retrieve all the b-rolls"), mixed evenly — the 1st of each, then the 2nd of each… — so no library
 * crowds out the others; a library that fails or is slow just adds nothing. With `source`, that
 * library only. `providers`: the libraries the results came from (each item also says its own:
 * the editor shows it, as the libraries' terms ask). `sources`: every library that can be searched.
 * `browse` with no words: the libraries' own picks (shown when the B-roll tab opens and the clip has
 * no AI idea to search for).
 */
export async function searchStock(query: string, page = 1, source?: string | null, browse = false): Promise<{ provider: string | null; providers: StockSource[]; items: StockItem[]; sources: StockSource[] }> {
  const q = query.trim().slice(0, 100)
  const sources = stockSources()
  const asked = sources.includes(source as StockSource) ? [source as StockSource] : sources
  if ((!q && !browse) || !asked.length) return { provider: asked[0] ?? null, providers: [], items: [], sources }
  const lists = await Promise.all(asked.map(async from => {
    try { return await searchOne(from, q, page) } catch (e) {
      console.warn(`[stock] ${from} search failed:`, e instanceof Error ? e.message : e)
      return [] as StockItem[]
    }
  }))
  const items: StockItem[] = []
  const seen = new Set<string>()
  for (let i = 0; i < Math.max(0, ...lists.map(l => l.length)); i++) {
    for (const list of lists) {
      const it = list[i]
      if (it && !seen.has(it.ref)) { seen.add(it.ref); items.push(it) }
    }
  }
  const providers = asked.filter((_, k) => lists[k].length > 0)
  return { provider: providers[0] ?? null, providers, items, sources }
}

/** One library's results for `q` (kept 24 h: Pixabay's API terms ask for it; it also saves quota) */
async function searchOne(from: StockSource, q: string, page: number): Promise<StockItem[]> {
  const key = `${from}|${q.toLowerCase()}|${page}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.items
  const items = from === 'pexels' ? await searchPexels(q, page) : from === 'coverr' ? await searchCoverr(q, page) : await searchPixabay(q, page)
  cache.set(key, { at: Date.now(), items })
  return items
}

// Coverr (api.coverr.co): key as a Bearer token; its file links are signed for that key. Every
// download of a video must be reported to Coverr (their API terms: they check partners for it).
const COVERR_API = 'https://api.coverr.co'
const coverrAuth = () => ({ Authorization: `Bearer ${process.env.COVERR_API_KEY}` })
let coverrStatsWarned = false

async function searchCoverr(q: string, page: number): Promise<StockItem[]> {
  // (no words: Coverr's latest videos)
  const params = new URLSearchParams({ ...(q ? { query: q } : {}), page: String(Math.max(0, page - 1)), page_size: '24', urls: 'true' })
  const res = await fetch(`${COVERR_API}/videos?${params}`, { headers: coverrAuth() })
  if (!res.ok) {
    // The demo key allows 50 searches an hour (for every user together)
    if (res.status === 429) throw Object.assign(new Error('Coverr\u2019s search limit is used up for now. Try again later, or use another library.'), { status: 429 })
    throw Object.assign(new Error('Stock search is not available right now'), { status: 502 })
  }
  const data = await res.json() as { hits?: Array<{ id: string; title?: string; poster?: string; thumbnail?: string; duration?: number | string; max_width?: number; max_height?: number; is_vertical?: boolean; urls?: { mp4?: string; mp4_preview?: string; mp4_download?: string } }> }
  return (data.hits ?? []).flatMap(v => {
    const url = v.urls?.mp4_download ?? v.urls?.mp4
    if (!v.id || !url) return []
    return [{
      ref: `coverr:${v.id}`, provider: 'coverr' as const, title: v.title?.trim() || 'Stock video',
      thumb: v.thumbnail ?? v.poster ?? '', preview: v.urls?.mp4_preview ?? v.urls?.mp4 ?? url, url,
      // The file is 1080p (max_width / max_height give the original, up to 4K): its shape at 1080p
      ...(() => { const w = v.max_width ?? (v.is_vertical ? 1080 : 1920), h = v.max_height ?? (v.is_vertical ? 1920 : 1080), k = Math.min(1, 1920 / Math.max(w, h)); return { width: Math.round(w * k), height: Math.round(h * k) } })(),
      duration: Math.round(Number(v.duration) || 0),
    }]
  })
}

type PixabayFile = { url: string; width: number; height: number; thumbnail?: string }
async function searchPixabay(q: string, page: number): Promise<StockItem[]> {
  // (no words: Pixabay's editor's choice; its plain newest list is mostly AI-made, which is left out)
  const params = new URLSearchParams({ key: process.env.PIXABAY_API_KEY!, ...(q ? { q } : { editors_choice: 'true' }), safesearch: 'true', per_page: '24', page: String(page) })
  const res = await fetch(`https://pixabay.com/api/videos/?${params}`)
  if (!res.ok) throw Object.assign(new Error('Stock search is not available right now'), { status: 502 })
  const data = await res.json() as { hits?: Array<{ id: number; tags: string; duration: number; isAiGenerated?: boolean; isLowQuality?: boolean; videos: Record<string, PixabayFile> }> }
  return (data.hits ?? []).flatMap(h => {
    if (h.isAiGenerated || h.isLowQuality) return []
    const files = Object.values(h.videos ?? {}).filter(f => f?.url)
    const big = files.filter(f => Math.min(f.width, f.height) >= 720).sort((a, b) => a.width * a.height - b.width * b.height)[0]
    const small = [...files].sort((a, b) => a.width * a.height - b.width * b.height)[0]
    if (!big || !small) return []
    return [{
      ref: `pixabay:${h.id}`, provider: 'pixabay' as const, title: h.tags.split(',').slice(0, 3).join(', '),
      thumb: small.thumbnail ?? big.thumbnail ?? '', preview: small.url, url: big.url,
      width: big.width, height: big.height, duration: h.duration,
    }]
  })
}

type PexelsFile = { link: string; width: number; height: number; file_type?: string }
async function searchPexels(q: string, page: number): Promise<StockItem[]> {
  const res = await fetch(q
    ? `https://api.pexels.com/videos/search?${new URLSearchParams({ query: q, per_page: '24', page: String(page) })}`
    : `https://api.pexels.com/videos/popular?${new URLSearchParams({ per_page: '24', page: String(page) })}`, {
    headers: { Authorization: process.env.PEXELS_API_KEY! },
  })
  if (!res.ok) throw Object.assign(new Error('Stock search is not available right now'), { status: 502 })
  const data = await res.json() as { videos?: Array<{ id: number; url: string; image: string; duration: number; video_files: PexelsFile[] }> }
  return (data.videos ?? []).flatMap(v => {
    const files = (v.video_files ?? []).filter(f => (f.file_type ?? 'video/mp4') === 'video/mp4')
    const big = files.filter(f => Math.min(f.width, f.height) >= 720).sort((a, b) => a.width * a.height - b.width * b.height)[0]
    const small = [...files].sort((a, b) => a.width * a.height - b.width * b.height)[0]
    if (!big || !small) return []
    const title = v.url.split('/').filter(Boolean).pop()?.replace(/-\d+$/, '').replace(/-/g, ' ') ?? 'Stock video'
    return [{ ref: `pexels:${v.id}`, provider: 'pexels' as const, title, thumb: v.image, preview: small.link, url: big.link, width: big.width, height: big.height, duration: v.duration }]
  })
}

/**
 * The user's copy of a stock video (an 'asset' video the clip can show and the export can use),
 * made on first use. Only files from the stock libraries' own hosts are fetched.
 */
export async function importStock(userId: string, item: { ref: string; url: string; title?: string }) {
  // (Media ▸ Memes: a KLIPY GIF's or clip's mp4 — "klipy:gif:<slug>" / "klipy:clip:<slug>" — or a GIPHY GIF's — "giphy:gif:<id>")
  if (!/^((pixabay|pexels):\d+|coverr:[A-Za-z0-9_-]{1,64}|klipy:(gif|clip):[A-Za-z0-9_-]{1,160}|giphy:gif:[A-Za-z0-9]{1,64})$/.test(item.ref)) throw Object.assign(new Error('Unknown stock video'), { status: 400 })
  let host = ''
  try { host = new URL(item.url).hostname } catch { /* invalid */ }
  const hosts = item.ref.startsWith('klipy:') ? /^static\.klipy\.com$/ : item.ref.startsWith('giphy:') ? /^(media\d*|i)\.giphy\.com$/ : /(^|\.)(pixabay\.com|pexels\.com|coverr\.co)$/
  if (!hosts.test(host)) throw Object.assign(new Error('Unknown stock video'), { status: 400 })

  const sign = (key: string) => getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 43200 })
  const [existing] = await sql`SELECT id, title, storage_path FROM videos WHERE user_id = ${userId} AND stock_ref = ${item.ref} AND storage_path IS NOT NULL LIMIT 1`
  if (existing) return { video_id: existing.id as string, title: existing.title as string, url: await sign(existing.storage_path) }

  const res = await fetch(item.url)
  if (!res.ok) throw Object.assign(new Error('Could not download that video'), { status: 502 })
  const body = Buffer.from(await res.arrayBuffer())
  if (body.length > 80 * 1024 * 1024) throw Object.assign(new Error('That video is too large'), { status: 400 })
  const storagePath = `raw/${userId}/stock-${item.ref.replace(/:/g, '-')}-${createHash('sha1').update(item.url).digest('hex').slice(0, 8)}.mp4`
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: storagePath, Body: body, ContentType: 'video/mp4' }))
  // Coverr counts a download when its mp4_download link is fetched (the file above came from it:
  // their API terms make that a must). Their stats call is sent too; it answered 404 for the demo
  // key (2026-10-13), so a failure is only noted once.
  if (item.ref.startsWith('coverr:')) {
    await fetch(`${COVERR_API}/videos/${encodeURIComponent(item.ref.slice(7))}/stats/downloads`, { method: 'PATCH', headers: coverrAuth() })
      .then(r => { if (!r.ok && !coverrStatsWarned) { coverrStatsWarned = true; console.warn('[stock] Coverr stats call answered', r.status, '(the download itself is counted by Coverr)') } })
      .catch(() => {})
  }
  const provider = item.ref.startsWith('pixabay') ? 'Pixabay' : item.ref.startsWith('coverr') ? 'Coverr' : item.ref.startsWith('klipy') ? 'KLIPY' : item.ref.startsWith('giphy') ? 'GIPHY' : 'Pexels'
  const title = `${provider}: ${(item.title ?? 'stock video').slice(0, 100)}`
  const [row] = await sql`
    INSERT INTO videos (user_id, source_type, storage_path, status, title, role, stock_ref)
    VALUES (${userId}, 'upload', ${storagePath}, 'ready', ${title}, 'asset', ${item.ref})
    RETURNING id
  `
  return { video_id: row.id as string, title, url: await sign(storagePath) }
}

// ── Stock photos (Media ▸ Search photos) ──────────────────────────────────────
// The same libraries and keys as the videos: Pexels when PEXELS_API_KEY is set, otherwise Pixabay.
// Free to use in the user's videos (their licences); never a web image search, whose results come
// with no right to use them.
// Wikimedia Commons is the other library (no key): famous people, places, history — what stock
// libraries don't carry. Every file there is free to use, commercially too, but most ask for a
// credit (the author and the licence), so each of its photos carries its credit line.

export type PhotoSource = 'pixabay' | 'pexels' | 'wikimedia'

export interface StockPhoto {
  ref: string            // "pixabay:<id>" / "pexels:<id>" / "wikimedia:<page id>"
  provider: PhotoSource
  title: string
  thumb: string          // small, for the grid
  url: string            // the picture added to the clip (about 1280 px on its long side)
  width: number; height: number
  /** Wikimedia: "Author · CC BY-SA 4.0 · Wikimedia Commons", whether the licence asks for it, and the file's page */
  credit?: string
  credit_required?: boolean
  page?: string
}

const photoCache = new Map<string, { at: number; items: StockPhoto[] }>()

/** The photo libraries that can be searched, in the order they're offered: the stock one whose key is set, then Wikimedia Commons */
export function photoSources(): PhotoSource[] {
  const stock = stockProvider()
  return stock ? [stock, 'wikimedia'] : ['wikimedia']
}

/** `browse` with no words: the stock library's own picks (Wikimedia has none: it needs words) */
/**
 * Stock photos for `query` from every library at once (user, 2026-10-30: Pixabay and Wikimedia
 * together, no switch), mixed evenly like the B-roll videos; a library that fails just adds
 * nothing. With `source`, that library only. `providers`: the libraries the results came from.
 */
export async function searchPhotos(query: string, page = 1, source?: string, browse = false): Promise<{ provider: PhotoSource; providers: PhotoSource[]; items: StockPhoto[]; sources: PhotoSource[] }> {
  const q = query.trim().slice(0, 100)
  const sources = photoSources()
  // (Wikimedia needs words: it has no picks of its own)
  const asked = (sources.includes(source as PhotoSource) ? [source as PhotoSource] : sources).filter(s => q || (browse && s !== 'wikimedia'))
  if (!asked.length) return { provider: sources[0], providers: [], items: [], sources }
  const lists = await Promise.all(asked.map(async from => {
    try { return await searchPhotosIn(from, q, page) } catch (e) {
      console.warn(`[stock] ${from} photo search failed:`, e instanceof Error ? e.message : e)
      return [] as StockPhoto[]
    }
  }))
  const items: StockPhoto[] = []
  const seen = new Set<string>()
  for (let i = 0; i < Math.max(0, ...lists.map(l => l.length)); i++) {
    for (const list of lists) {
      const it = list[i]
      if (it && !seen.has(it.ref)) { seen.add(it.ref); items.push(it) }
    }
  }
  const providers = asked.filter((_, k) => lists[k].length > 0)
  return { provider: providers[0] ?? asked[0], providers, items, sources }
}

/** One library's photos for `q` (kept 24 h) */
async function searchPhotosIn(from: PhotoSource, q: string, page: number): Promise<StockPhoto[]> {
  const key = `${from}|${q.toLowerCase()}|${page}`
  const hit = photoCache.get(key)
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.items
  const items = from === 'wikimedia' ? await searchWikimediaPhotos(q, page)
    : from === 'pexels' ? await searchPexelsPhotos(q, page) : await searchPixabayPhotos(q, page)
  photoCache.set(key, { at: Date.now(), items })
  return items
}

// ── Wikimedia Commons ──
// Its API needs no key, but every request has to say who is asking (a request without a
// User-Agent is refused), and pictures are only served in its standard widths (500, 1280 … px).

const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php'
const WIKIMEDIA_HEADERS = { 'User-Agent': `Shortcut/1.0 (reel editor photo search${process.env.NEXTAUTH_URL ? `; ${process.env.NEXTAUTH_URL}` : ''})` }
/** The picture added to a clip is this wide at most; the grid shows this width */
const WIKIMEDIA_W = 1280, WIKIMEDIA_THUMB_W = 500
/** A picture smaller than this on its long side is too small to put in a video */
const WIKIMEDIA_MIN_PX = 480
const WIKIMEDIA_INFO = {
  prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(WIKIMEDIA_W),
  iiextmetadatafilter: 'LicenseShortName|Artist|AttributionRequired', format: 'json', formatversion: '2',
}
interface WikimediaPage {
  pageid: number; title: string; index?: number
  imageinfo?: Array<{
    url: string; descriptionurl?: string; thumburl?: string; thumbwidth?: number; thumbheight?: number
    width: number; height: number; mime: string
    extmetadata?: Record<string, { value?: string } | undefined>
  }>
}

/** Text of a bit of the file page's HTML (the author is a link, often) */
const plainText = (html: string) => html.replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim()

function wikimediaPhoto(p: WikimediaPage): StockPhoto | null {
  const ii = p.imageinfo?.[0]
  if (!ii || !/^image\/(jpeg|png)$/.test(ii.mime) || Math.max(ii.width, ii.height) < WIKIMEDIA_MIN_PX) return null
  // Narrower than asked for: the file itself (the API still reports the width asked for)
  const scaled = ii.width > WIKIMEDIA_W && !!ii.thumburl && !!ii.thumbwidth && !!ii.thumbheight
  const url = scaled ? ii.thumburl! : ii.url
  const meta = (k: string) => plainText(ii.extmetadata?.[k]?.value ?? '')
  const licence = meta('LicenseShortName') || 'Free licence'
  const author = meta('Artist').slice(0, 80)
  return {
    ref: `wikimedia:${p.pageid}`, provider: 'wikimedia',
    title: p.title.replace(/^File:/, '').replace(/\.[A-Za-z0-9]+$/, '').replace(/_/g, ' ').slice(0, 120),
    thumb: scaled ? url.replace(`/${WIKIMEDIA_W}px-`, `/${WIKIMEDIA_THUMB_W}px-`) : url,
    url, width: scaled ? ii.thumbwidth! : ii.width, height: scaled ? ii.thumbheight! : ii.height,
    credit: [author, licence, 'Wikimedia Commons'].filter(Boolean).join(' · '),
    credit_required: meta('AttributionRequired') !== 'false',
    page: ii.descriptionurl,
  }
}

async function wikimediaPages(params: Record<string, string>): Promise<WikimediaPage[]> {
  const res = await fetch(`${WIKIMEDIA_API}?${new URLSearchParams({ action: 'query', ...WIKIMEDIA_INFO, ...params })}`, { headers: WIKIMEDIA_HEADERS })
  if (!res.ok) throw Object.assign(new Error('Photo search is not available right now'), { status: 502 })
  const data = await res.json() as { query?: { pages?: WikimediaPage[] } }
  return data.query?.pages ?? []
}

async function searchWikimediaPhotos(q: string, page: number): Promise<StockPhoto[]> {
  // Pictures only (no PDFs, sounds or videos), in the search's own order
  const pages = await wikimediaPages({
    generator: 'search', gsrsearch: `${q} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '40', gsroffset: String((page - 1) * 40),
  })
  return pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).flatMap(p => wikimediaPhoto(p) ?? []).slice(0, 30)
}

async function searchPixabayPhotos(q: string, page: number): Promise<StockPhoto[]> {
  const params = new URLSearchParams({ key: process.env.PIXABAY_API_KEY!, ...(q ? { q } : { editors_choice: 'true' }), image_type: 'photo', safesearch: 'true', per_page: '30', page: String(page) })
  const res = await fetch(`https://pixabay.com/api/?${params}`)
  if (!res.ok) throw Object.assign(new Error('Photo search is not available right now'), { status: 502 })
  const data = await res.json() as { hits?: Array<{ id: number; tags: string; previewURL?: string; webformatURL?: string; largeImageURL?: string; imageWidth: number; imageHeight: number; isAiGenerated?: boolean }> }
  return (data.hits ?? []).flatMap(h => {
    if (h.isAiGenerated || !h.largeImageURL) return []
    // The large picture is at most 1280 px on its long side
    const k = Math.min(1, 1280 / Math.max(h.imageWidth, h.imageHeight))
    return [{
      ref: `pixabay:${h.id}`, provider: 'pixabay' as const, title: h.tags.split(',').slice(0, 3).map(t => t.trim()).join(', '),
      thumb: h.webformatURL ?? h.previewURL ?? h.largeImageURL, url: h.largeImageURL,
      width: Math.round(h.imageWidth * k), height: Math.round(h.imageHeight * k),
    }]
  })
}

async function searchPexelsPhotos(q: string, page: number): Promise<StockPhoto[]> {
  const res = await fetch(q
    ? `https://api.pexels.com/v1/search?${new URLSearchParams({ query: q, per_page: '30', page: String(page) })}`
    : `https://api.pexels.com/v1/curated?${new URLSearchParams({ per_page: '30', page: String(page) })}`, {
    headers: { Authorization: process.env.PEXELS_API_KEY! },
  })
  if (!res.ok) throw Object.assign(new Error('Photo search is not available right now'), { status: 502 })
  const data = await res.json() as { photos?: Array<{ id: number; alt?: string; width: number; height: number; src: { large?: string; large2x?: string; medium?: string } }> }
  return (data.photos ?? []).flatMap(p => {
    const url = p.src.large2x ?? p.src.large
    if (!url) return []
    const k = Math.min(1, 1880 / Math.max(p.width, p.height))
    return [{ ref: `pexels:${p.id}`, provider: 'pexels' as const, title: p.alt?.trim() || 'Stock photo', thumb: p.src.medium ?? url, url, width: Math.round(p.width * k), height: Math.round(p.height * k) }]
  })
}

/**
 * A stock photo saved to the user's photos (overlays/<user>/, where uploaded photos go: it then
 * shows under Media ▸ Import too), once per photo — the same photo again is the saved copy.
 * Only pictures from the stock libraries' own hosts are fetched (their terms: keep a copy, don't
 * link to theirs).
 */
export async function importPhoto(userId: string, item: { ref: string; url: string; title?: string }): Promise<{ storage_path: string; preview_url: string; credit?: string; credit_required?: boolean }> {
  // (Media ▸ Memes: a KLIPY still meme — "klipy:meme:<slug>" — or an Imgflip template — "imgflip:<id>")
  const klipy = /^klipy:meme:[A-Za-z0-9_-]{1,160}$/.test(item.ref)
  const imgflip = /^imgflip:\d{1,20}$/.test(item.ref)
  if (!klipy && !imgflip && !/^(pixabay|pexels|wikimedia):\d+$/.test(item.ref)) throw Object.assign(new Error('Unknown stock photo'), { status: 400 })
  // Wikimedia: the picture and its credit are read from Wikimedia itself, by the file's id — never from what the browser sent
  const wiki = item.ref.startsWith('wikimedia:')
    ? (await wikimediaPages({ pageids: item.ref.slice('wikimedia:'.length) })).flatMap(p => wikimediaPhoto(p) ?? [])[0]
    : null
  if (item.ref.startsWith('wikimedia:') && !wiki) throw Object.assign(new Error('That photo can’t be found on Wikimedia Commons any more'), { status: 404 })
  const url = wiki?.url ?? item.url, title = wiki?.title ?? item.title
  let host = ''
  try { host = new URL(url).hostname } catch { /* invalid */ }
  if (!(wiki ? /^(upload|thumb)\.wikimedia\.org$/ : klipy ? /^static\.klipy\.com$/ : imgflip ? /^i\.imgflip\.com$/ : /(^|\.)(pixabay\.com|pexels\.com)$/).test(host)) throw Object.assign(new Error('Unknown stock photo'), { status: 400 })

  const provider = wiki ? 'Wikimedia' : klipy ? 'KLIPY' : imgflip ? 'Imgflip' : item.ref.startsWith('pixabay') ? 'Pixabay' : 'Pexels'
  const name = safeName(`${provider} ${(title ?? 'photo').split(',').slice(0, 3).join(' ')}`).slice(0, 60) || provider
  const ext = (wiki || klipy || imgflip) && /\.png$/i.test(new URL(url).pathname) ? 'png' : klipy && /\.webp$/i.test(new URL(url).pathname) ? 'webp' : 'jpg'
  const storagePath = `overlays/${userId}/${item.ref.replace(/:/g, '-')}--${name}.${ext}`
  const credit = wiki ? { credit: wiki.credit, credit_required: wiki.credit_required } : {}
  const sign = () => getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: storagePath }), { expiresIn: 60 * 60 })
  const saved = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: storagePath })).then(() => true, () => false)
  if (saved) return { storage_path: storagePath, preview_url: await sign(), ...credit }

  const res = await fetch(url, wiki ? { headers: WIKIMEDIA_HEADERS } : undefined)
  if (!res.ok) throw Object.assign(new Error('Could not download that photo'), { status: 502 })
  const type = res.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) throw Object.assign(new Error('That is not a photo'), { status: 400 })
  const body = Buffer.from(await res.arrayBuffer())
  if (body.length > 15 * 1024 * 1024) throw Object.assign(new Error('That photo is too large'), { status: 400 })
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: storagePath, Body: body, ContentType: type,
    // The credit stays with the saved file (plain letters only in a file's notes, so it is encoded)
    ...(wiki ? { Metadata: { source: 'wikimedia-commons', page: encodeURI(wiki.page ?? '').slice(0, 500), credit: encodeURIComponent(wiki.credit ?? '').slice(0, 900) } } : {}),
  }))
  return { storage_path: storagePath, preview_url: await sign(), ...credit }
}

/**
 * 4–6 short English stock-video searches that fit what is said in the clip (Gemini). Kept in
 * clip_broll_ideas (the worker makes the table) while the clip's span and its video's transcript
 * are the ones they came from: B-roll and Photos both ask each time they open, and a kept answer
 * survives a redeploy and is shared by every server copy (user, 2026-10-30: it was kept in this
 * server's memory, so those asked Gemini again). An answer still coming is shared; an empty one
 * isn't kept.
 */
const ideasAsking = new Map<string, Promise<string[]>>()
let ideasTableWarned = false
/** Without the table (the worker not yet started with it) the ideas are just not kept */
const noIdeasTable = (e: unknown) => {
  if (!ideasTableWarned) console.warn('[broll-ideas] not kept:', e instanceof Error ? e.message : e)
  ideasTableWarned = true
  return []
}

export async function brollIdeas(userId: string, clipId: string): Promise<string[]> {
  const [clip] = await sql`
    SELECT c.start_ms, c.end_ms, c.video_id, v.user_id FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}
  `
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })
  if (!aiProvider()) return []
  const [t] = await sql`SELECT id FROM transcripts WHERE video_id = ${clip.video_id} ORDER BY created_at DESC LIMIT 1`
  if (!t) return []
  const [kept] = await sql<{ ideas: string[] }[]>`
    SELECT ideas FROM clip_broll_ideas
    WHERE clip_id = ${clipId} AND transcript_id = ${t.id} AND start_ms = ${clip.start_ms} AND end_ms = ${clip.end_ms}
  `.catch(noIdeasTable)
  if (kept) return kept.ideas
  const key = `${clipId}|${t.id}|${clip.start_ms}|${clip.end_ms}`
  let asking = ideasAsking.get(key)
  if (!asking) {
    asking = askBrollIdeas(t.id, clip.start_ms, clip.end_ms, { userId, videoId: clip.video_id }).then(async ideas => {
      if (ideas.length) await sql`
        INSERT INTO clip_broll_ideas (clip_id, transcript_id, start_ms, end_ms, ideas)
        VALUES (${clipId}, ${t.id}, ${clip.start_ms}, ${clip.end_ms}, ${sql.json(ideas)})
        ON CONFLICT (clip_id) DO UPDATE SET transcript_id = EXCLUDED.transcript_id, start_ms = EXCLUDED.start_ms,
          end_ms = EXCLUDED.end_ms, ideas = EXCLUDED.ideas, created_at = now()
      `.catch(noIdeasTable)
      return ideas
    }).finally(() => ideasAsking.delete(key))
    ideasAsking.set(key, asking)
  }
  return asking
}

async function askBrollIdeas(transcriptId: string, startMs: number, endMs: number, who: { userId: string; videoId: string }): Promise<string[]> {
  const words = await sql<{ word: string }[]>`
    SELECT word FROM transcript_words WHERE transcript_id = ${transcriptId} AND start_ms >= ${startMs} AND start_ms < ${endMs} ORDER BY start_ms`
  if (!words.length) return []
  const prompt = `This is what is said in a short video clip (any language, often Telugu, Hindi or Tamil mixed with English):
${words.map(w => w.word).join(' ').slice(0, 4000)}

Suggest 6 short English searches (2-3 words each) for stock B-roll footage that would fit things, places or actions talked about. Concrete and visual only (e.g. "cinema crowd", "city traffic night"); no real people or brands.
Return ONLY a JSON array of strings.`
  try {
    // (a plain list of search words: no thinking needed — about 5× cheaper, user 2026-10-30)
    // What it cost (admin Costs: "B-roll ideas"); never slows down or fails the answer
    const onUsage = (u: { model: string; inputTokens: number; outputTokens: number }) => {
      import('./aiUsage').then(m => m.recordAiUsage({ ...who, purpose: 'broll', ...u }))
        .catch(e => console.warn('[ai-usage] not recorded:', e instanceof Error ? e.message : e))
    }
    const out = await askGemini(prompt, { thinkingBudget: 0, onUsage })
    const arr = JSON.parse(out.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as unknown[]
    return arr.filter((s): s is string => typeof s === 'string').map(s => s.trim().slice(0, 40)).filter(Boolean).slice(0, 6)
  } catch (e) {
    console.warn('[broll-ideas]', e instanceof Error ? e.message : e)
    return []
  }
}
