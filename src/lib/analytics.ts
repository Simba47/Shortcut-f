// Google Analytics 4 in the browser (user, 2026-11-17: the whole site, every editor tool, for the team).
//
// On only where NEXT_PUBLIC_GA_ID is set: the live site (Railway own-model). QA and local copies have
// none, so their test visits never reach the real reports.
//
// Never personal (Google's rules, and the Privacy Policy): no emails, names, video or clip titles, file
// names, typed words or links. Pages are sent by their kind ("/editor/[clip]"), not their address, and
// every value goes through cleanParams. The signed-in account is only its internal id (user_id).
//
// What's counted, and where:
//   - pages: components/analytics/GoogleAnalytics.tsx (page_view per page kind, campaign tags kept)
//   - actions: API_EVENTS below — a call to one of the site's own server addresses that worked is an
//     event (export_clip, make_clips, upload_complete…), whichever page or editor made it
//   - editor: the tool opened (EditorShell / EditorShellMobile), each edit by kind and undo / redo
//     (modules/editor/history.ts)
//   - sign_up, login and purchase: sent by the server (server/analytics.ts), so ad blockers don't lose them

import { PLANS } from './plans'
import { findTopupPack } from './credits'

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? ''

export type Params = Record<string, string | number | boolean | null | undefined>

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/**
 * Only short, plain values reach Google: no email (anything with @), no ids, no long text; a key or
 * value GA would refuse (names up to 40 characters, values up to 100) is cut or left out.
 */
export function cleanParams(p?: Params): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(p ?? {})) {
    if (v === undefined || v === null || !/^[a-z][a-z0-9_]{0,39}$/.test(k)) continue
    if (typeof v === 'number') { if (Number.isFinite(v)) out[k] = v; continue }
    if (typeof v === 'boolean') { out[k] = v; continue }
    const s = String(v).replace(UUID, '[id]').trim()
    if (!s || s.includes('@')) continue
    out[k] = s.slice(0, 100)
  }
  return out
}

/** Sends one event (nothing without GA, or before its script is on the page) */
export function track(name: string, params?: Params): void {
  if (!GA_ID || typeof window === 'undefined' || typeof window.gtag !== 'function') return
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(name)) return
  try { window.gtag('event', name, cleanParams(params)) } catch { /* never breaks the page */ }
}

/** What an id stands for, by the part of the address before it */
const ID_NAMES: Record<string, string> = { editor: '[clip]', videos: '[video]', clips: '[clip]', invoice: '[invoice]', brand: '[kit]' }

/** "/editor/3f2c…/x" → "/editor/[clip]/x": a page's kind, never whose page it is */
export function pageKind(pathname: string): string {
  const parts = pathname.split('/')
  return parts.map((seg, i) => {
    if (!seg) return seg
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) || /^\d{3,}$/.test(seg) || /^[A-Za-z0-9_-]{20,}$/.test(seg)) {
      return ID_NAMES[parts[i - 1]] ?? '[id]'
    }
    return seg
  }).join('/') || '/'
}

/** The campaign tags kept on a page's address (where a visitor came from); everything else is dropped */
const CAMPAIGN = /^(utm_(source|medium|campaign|term|content|id)|gclid|gbraid|wbraid|fbclid|ref)$/
export function campaignQuery(search: string): string {
  const q = new URLSearchParams(search)
  const keep = new URLSearchParams()
  q.forEach((v, k) => { if (CAMPAIGN.test(k)) keep.set(k, v.slice(0, 100)) })
  const s = keep.toString()
  return s ? `?${s}` : ''
}

// ---- Actions: the site's own server addresses that are an event when they work ----

type Body = Record<string, unknown> | null
interface ApiEvent { method: string; path: RegExp; event: string; params?: (body: Body) => Params }

/** "drive.google.com/…" → "google_drive": which service a link came from, never the link */
export function linkService(url: unknown): string {
  let host = ''
  try { host = new URL(String(url)).hostname.toLowerCase() } catch { return 'unknown' }
  if (host.endsWith('drive.google.com') || host.endsWith('docs.google.com')) return 'google_drive'
  if (host.endsWith('dropbox.com') || host.endsWith('dropboxusercontent.com')) return 'dropbox'
  if (host.endsWith('youtube.com') || host === 'youtu.be') return 'youtube'
  if (host.endsWith('instagram.com')) return 'instagram'
  if (host.endsWith('onedrive.live.com') || host.endsWith('1drv.ms') || host.endsWith('sharepoint.com')) return 'onedrive'
  if (host.endsWith('wetransfer.com')) return 'wetransfer'
  return 'other'
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const ID = '[0-9a-f-]{36}'
const at = (p: string) => new RegExp(`^/api/${p.replace(/:id/g, ID)}$`)

/** A plan or pack's price, for checkout's value (rupees) */
function checkoutValue(item: string): number | undefined {
  if (item.startsWith('topup:')) return findTopupPack(item.slice(6), { test: false })?.price
  return PLANS[item as keyof typeof PLANS]?.price
}

export const API_EVENTS: ApiEvent[] = [
  // Uploads and imports (dashboard)
  { method: 'POST', path: at('ingest/sign'), event: 'upload_start' },
  { method: 'POST', path: at('ingest/complete'), event: 'upload_complete', params: b => ({ video_minutes: typeof b?.duration_ms === 'number' ? Math.round(b.duration_ms / 6000) / 10 : undefined }) },
  { method: 'POST', path: at('ingest/link'), event: 'link_import', params: b => ({ service: linkService(b?.url) }) },
  { method: 'DELETE', path: at('videos/:id'), event: 'video_delete' },
  { method: 'DELETE', path: at('videos'), event: 'video_delete', params: () => ({ many: true }) },
  { method: 'POST', path: at('videos/:id/retry'), event: 'video_retry' },
  { method: 'POST', path: at('videos/:id/transcript'), event: 'video_transcribe' },
  { method: 'DELETE', path: at('videos/:id/transcript'), event: 'transcript_delete' },
  // Clips: the clip board and Make my clips
  { method: 'POST', path: at('videos/:id/auto-clips'), event: 'make_clips', params: b => b?.confirm === true ? { step: 'confirm_fewer' } : {
    clip_count: typeof b?.clip_count === 'number' ? b.clip_count : undefined, aspect: str(b?.aspect), caption_language: str(b?.caption_language),
    add_broll: b?.add_broll === true, search: b?.search === 'new' ? 'new' : 'more', brand_kit: b?.brand_kit === 'none' ? 'none' : b?.brand_kit ? 'yes' : undefined } },
  { method: 'DELETE', path: at('videos/:id/auto-clips'), event: 'make_clips_stop' },
  { method: 'POST', path: at('videos/:id/ai-detect'), event: 'find_moments' },
  { method: 'POST', path: at('videos/:id/best-moments'), event: 'best_moments' },
  { method: 'POST', path: at('videos/:id/brand'), event: 'brand_kit_apply', params: () => ({ on: 'video' }) },
  { method: 'POST', path: at('clips'), event: 'clip_create' },
  { method: 'DELETE', path: at('clips'), event: 'clip_delete' },
  { method: 'PATCH', path: at('clips/:id/favorite'), event: 'clip_favorite' },
  { method: 'PATCH', path: at('clips/:id/title'), event: 'clip_rename' },
  { method: 'POST', path: at('clips/:id/opened'), event: 'editor_open' },
  { method: 'POST', path: at('clips/:id/reedit'), event: 'clip_reedit' },
  { method: 'GET', path: at('clips/:id/download'), event: 'clip_download' },
  // Export
  { method: 'POST', path: at('export'), event: 'export_clip', params: b => ({ quality: str(b?.quality) ?? (typeof b?.quality === 'number' ? String(b.quality) : undefined), remove_fillers: b?.remove_fillers === true, captions_read_again: b?.retranscribe === true }) },
  { method: 'POST', path: at('clips/:id/cancel-export'), event: 'export_cancel' },
  // The editor's AI and server tools (its other tools are counted by modules/editor/history.ts)
  { method: 'POST', path: at('transcribe/retranscribe'), event: 'captions_generate', params: b => ({ language: str(b?.language_code), fresh: b?.fresh === true, whole_video: b?.read_all === true }) },
  { method: 'POST', path: at('transcribe/retranscribe/stop'), event: 'captions_stop' },
  { method: 'PATCH', path: at('transcribe/words'), event: 'editor_edit', params: () => ({ area: 'caption_words', change: 'change' }) },
  { method: 'POST', path: at('clips/:id/ai-text'), event: 'editor_ai', params: () => ({ feature: 'post_text' }) },
  { method: 'GET', path: at('clips/:id/broll-ideas'), event: 'editor_ai', params: () => ({ feature: 'broll_ideas' }) },
  { method: 'POST', path: at('clips/:id/emphasis'), event: 'editor_ai', params: () => ({ feature: 'key_words' }) },
  { method: 'POST', path: at('clips/:id/silences'), event: 'editor_ai', params: () => ({ feature: 'cleanup_detect' }) },
  { method: 'POST', path: at('clips/:id/subjects/auto'), event: 'editor_ai', params: () => ({ feature: 'subjects_find' }) },
  { method: 'POST', path: at('clips/:id/subjects/track'), event: 'editor_ai', params: () => ({ feature: 'subjects_track' }) },
  { method: 'POST', path: at('clips/:id/subjects/angles'), event: 'editor_ai', params: () => ({ feature: 'follow_speaker' }) },
  { method: 'POST', path: at('clips/:id/subjects/stop'), event: 'editor_ai', params: () => ({ feature: 'subjects_stop' }) },
  { method: 'POST', path: at('clips/:id/subjects'), event: 'editor_edit', params: () => ({ area: 'subjects', change: 'add' }) },
  { method: 'PATCH', path: at('clips/:id/subjects'), event: 'editor_edit', params: () => ({ area: 'subjects', change: 'change' }) },
  { method: 'DELETE', path: at('clips/:id/subjects'), event: 'editor_edit', params: () => ({ area: 'subjects', change: 'remove' }) },
  { method: 'POST', path: at('clips/:id/brand'), event: 'brand_kit_apply', params: () => ({ on: 'clip' }) },
  // Media: stock, uploads, music, memes
  { method: 'GET', path: at('stock/search'), event: 'media_search', params: () => ({ kind: 'video' }) },
  { method: 'POST', path: at('stock/import'), event: 'media_add', params: () => ({ source: 'stock_video' }) },
  { method: 'GET', path: at('stock/photos'), event: 'media_search', params: () => ({ kind: 'photo' }) },
  { method: 'POST', path: at('stock/photos/import'), event: 'media_add', params: () => ({ source: 'stock_photo' }) },
  { method: 'GET', path: at('memes'), event: 'media_search', params: () => ({ kind: 'meme' }) },
  { method: 'GET', path: at('memes/imgflip'), event: 'media_search', params: () => ({ kind: 'meme' }) },
  { method: 'POST', path: at('overlays/upload'), event: 'media_add', params: () => ({ source: 'upload' }) },
  { method: 'DELETE', path: at('media'), event: 'media_delete' },
  { method: 'GET', path: at('audio/library/search'), event: 'media_search', params: () => ({ kind: 'music' }) },
  { method: 'POST', path: at('audio/library/import'), event: 'music_add', params: () => ({ source: 'library' }) },
  { method: 'POST', path: at('audio/upload'), event: 'music_add', params: () => ({ source: 'upload' }) },
  // Brand kits
  { method: 'POST', path: at('brand-kits'), event: 'brand_kit_create', params: () => ({ from: 'scratch' }) },
  { method: 'POST', path: at('brand-kits/from-link'), event: 'brand_kit_create', params: () => ({ from: 'link' }) },
  { method: 'PATCH', path: at('brand-kits/:id'), event: 'brand_kit_update' },
  { method: 'DELETE', path: at('brand-kits/:id'), event: 'brand_kit_delete' },
  { method: 'POST', path: at('brand-kits/logo'), event: 'brand_kit_update', params: () => ({ part: 'logo' }) },
  { method: 'POST', path: at('brand-kits/font'), event: 'brand_kit_update', params: () => ({ part: 'font' }) },
  { method: 'POST', path: at('brand-kits/:id/share'), event: 'brand_kit_share' },
  { method: 'POST', path: at('brand-kits/invites/:id'), event: 'brand_kit_join' },
  // Money (the purchase itself is sent by the server when it is paid)
  { method: 'POST', path: at('billing/subscribe'), event: 'begin_checkout', params: b => { const item = str(b?.plan) ?? ''; return { item_id: item, value: checkoutValue(item), currency: 'INR' } } },
  { method: 'POST', path: at('billing/topup'), event: 'begin_checkout', params: b => { const item = `topup:${str(b?.pack) ?? ''}`; return { item_id: item, value: checkoutValue(item), currency: 'INR' } } },
  { method: 'POST', path: at('billing/cancel'), event: 'subscription_cancel' },
  { method: 'PUT', path: at('billing/details'), event: 'billing_details_save' },
  // Account
  { method: 'PATCH', path: at('account'), event: 'account_update' },
  { method: 'DELETE', path: at('account'), event: 'account_delete' },
  { method: 'POST', path: at('account/password'), event: 'password_change' },
  { method: 'POST', path: at('account/photo'), event: 'profile_photo', params: () => ({ change: 'add' }) },
  { method: 'DELETE', path: at('account/photo'), event: 'profile_photo', params: () => ({ change: 'remove' }) },
  { method: 'POST', path: at('auth/forgot-password'), event: 'password_reset_request' },
]

/** The event a call to the site's own server makes, if any (the address without its ?query) */
export function apiEvent(method: string, pathname: string): ApiEvent | undefined {
  const m = method.toUpperCase()
  return API_EVENTS.find(e => e.method === m && e.path.test(pathname))
}

/** The fields of a JSON body the events read (FormData uploads and others: none) */
export function jsonBody(body: unknown): Body {
  if (typeof body !== 'string' || body.length > 100_000) return null
  try { const v = JSON.parse(body); return v && typeof v === 'object' && !Array.isArray(v) ? v as Body : null } catch { return null }
}
