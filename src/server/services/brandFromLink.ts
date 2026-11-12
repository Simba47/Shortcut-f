import dns from 'node:dns/promises'
import net from 'node:net'
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2, R2_BUCKET } from '@/lib/r2'
import { LOGO_LINK_SECONDS } from './brandKits'
import { readSiteStyle, mergePalette, googleFontFamilies, loadSharp, logoColors } from './brandStyle'
// (the logo's colours are read where the other brand colours are: brandStyle.ts)
export { logoColors } from './brandStyle'
import type { LinkBrand } from '@/lib/shared/brandKit'

/**
 * A brand kit filled from a link (the Brand kit tool's "Fill from a link"): the page at a website or
 * profile link is read for the brand's name, @handle, logo, colours and fonts — no paid service. The
 * logo is copied into the user's brand folder like an uploaded one. Colours come from the logo's own
 * colours (read with sharp, which Next ships), the site's styles and its theme colour; fonts from its
 * styles, matched to the nearest of the editor's fonts (brandStyle.ts).
 *
 * The link is the user's: the server fetches it only over http(s) on the usual ports, never to a
 * private or local address (checked again at every redirect), with time and size limits.
 */

const err = (message: string, status: number) => Object.assign(new Error(message), { status, expose: true })
const TIMEOUT_MS = 8000
const MAX_PAGE = 2 * 1024 * 1024
const MAX_IMAGE = 5 * 1024 * 1024
/** A site's styles: at most this many stylesheets read, each at most this big */
const MAX_SHEETS = 4
const MAX_CSS = 1536 * 1024
/** A stylesheet slower than this is skipped: the brand's name and logo shouldn't wait on it */
const CSS_TIMEOUT_MS = 4000
const UA = 'Mozilla/5.0 (compatible; ShortcutBrandKit/1.0; +https://shortcutapp.in)'

export type { LinkBrand } from '@/lib/shared/brandKit'

/** The IPv4 address inside an IPv6 one (::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d), dotted or in
 *  hex: a parsed link writes [::ffff:127.0.0.1] as ::ffff:7f00:1, which still reaches 127.0.0.1 */
function embeddedV4(ip: string): string | null {
  const rest = /^(?:::(?:ffff:)?|64:ff9b::)(.+)$/i.exec(ip)?.[1]
  if (!rest) return null
  if (net.isIPv4(rest)) return rest
  const h = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest)
  if (!h) return null
  const [a, b] = [parseInt(h[1], 16), parseInt(h[2], 16)]
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
}

/** An address the server must never fetch: loopback, private, link-local, carrier NAT, multicast, reserved */
export function privateAddress(ip: string): boolean {
  const v4 = net.isIPv4(ip) ? ip : embeddedV4(ip)
  if (v4) {
    const [a, b] = v4.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
  }
  const v6 = ip.toLowerCase()
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9')
    || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff')
}

/** The link as a URL the server may fetch, or an error for the user */
async function safeUrl(raw: string): Promise<URL> {
  let url: URL
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`) } catch { throw err('That doesn’t look like a link', 400) }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw err('Use a website or profile link (https://…)', 400)
  if (url.port && url.port !== '80' && url.port !== '443') throw err('That link can’t be read', 400)
  if (url.username || url.password) throw err('That link can’t be read', 400)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw err('That link can’t be read', 400)
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map(a => a.address)
  if (!addrs.length) throw err('That website couldn’t be found', 400)
  if (addrs.some(privateAddress)) throw err('That link can’t be read', 400)
  return url
}

/** GET with every redirect checked again, a time limit, and at most `max` bytes read */
async function fetchSafe(raw: string, max: number, accept: string, ms = TIMEOUT_MS): Promise<{ body: Buffer; type: string; url: URL }> {
  let url = await safeUrl(raw)
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(ms), headers: { 'User-Agent': UA, Accept: accept } })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await safeUrl(new URL(res.headers.get('location')!, url).toString())
      continue
    }
    if (res.status === 401 || res.status === 403 || res.status === 429) throw err('That site doesn’t let us read it — add your logo and colours below instead', 400)
    if (res.status === 404 || res.status === 410) throw err('That page isn’t there — check the link', 400)
    if (!res.ok || !res.body) throw err('That page couldn’t be opened. Check the link, or fill the kit in by hand.', 400)
    const chunks: Uint8Array[] = []
    let n = 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      n += value.length
      if (n > max) { await reader.cancel().catch(() => {}); break }
      chunks.push(value)
    }
    return { body: Buffer.concat(chunks), type: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(), url }
  }
  throw err('That link redirects too many times', 400)
}

const decode = (s: string) => s
  .replace(/&#x([0-9a-f]{1,6});/gi, (m, h) => { const n = parseInt(h, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m })
  .replace(/&#(\d{1,7});/g, (m, d) => { const n = +d; return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m })
  .replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? '')
  return out
}

/** The page's tags that tell its brand, read without a full HTML parser */
export function readPage(html: string, base: URL) {
  // (the whole page as fetched, up to MAX_PAGE: a profile page can put its tags a megabyte in)
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => attrs(m[0]))
  const meta = (key: string) => metas.find(m => (m.property ?? m.name ?? '').toLowerCase() === key)?.content || null
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => attrs(m[0]))
  const abs = (u: string | null | undefined) => { if (!u || u.startsWith('data:')) return null; try { return new URL(u, base).toString() } catch { return null } }
  const title = decode(/<title[^>]*>([^<]*)</i.exec(html)?.[1] ?? '')
  const social = /(^|\.)(instagram|youtube|x|twitter|tiktok|facebook|linkedin|threads)\.(com|net)$/i.test(base.hostname)
  // On a profile page the brand is the profile ("Nike (@nike) • Instagram photos…", "MrBeast - YouTube"), not the site
  const profileName = (t: string | null) => t ? t.split(/\s+\(@|\s+[|•·–—-]\s+|\s+on\s+(Instagram|TikTok|X|Threads)\b/)[0].trim() || null : null
  const siteName = social
    ? profileName(meta('og:title') || meta('twitter:title') || title)
    : meta('og:site_name') || meta('application-name') || titleName(title)
  const share = abs(meta('og:image') || meta('twitter:image'))
  const size = (l: Record<string, string>) => Math.max(0, ...(l.sizes ?? '').split(/\s+/).map(s => parseInt(s, 10) || 0))
  // The site's own icons — always its brand mark: the big home-screen ones first, the 16-px tab icons last
  const icons = links.filter(l => /(^|\s)(apple-touch-icon(-precomposed)?|icon|shortcut icon|mask-icon|fluid-icon)(\s|$)/i.test(l.rel ?? ''))
    .sort((a, b) => rank(b) - rank(a) || size(b) - size(a)).map(l => abs(l.href))
  function rank(l: Record<string, string>) {
    if (/apple-touch/i.test(l.rel)) return 4
    if (/fluid-icon/i.test(l.rel) || size(l) >= 96) return 3
    if (/svg/i.test(l.type ?? '') || /\.svg(\?|$)/i.test(l.href ?? '') || /mask-icon/i.test(l.rel)) return 2
    return 1
  }
  // A logo picture on the page counts only when it is the site's own: in its header or top bar, or its
  // file named for the brand ("boAt_logo_black.svg"). A page's other logos — customers, partners,
  // events, products ("promo_logo_apple_watch") — are someone else's, and photos ("…forms the Stripe
  // logo", a .jpg, 2000 px wide) are no logo at all
  const domain = base.hostname.split('.').slice(0, -1).filter(l => l.length >= 3 && l !== 'www').pop() // (open.spotify.com: spotify)
  const brandKeys = [...new Set([siteName, domain]
    .map(k => (k ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')).filter(k => k.length >= 3))]
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const logoImgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => attrs(m[0])).filter(a => {
    const src = a.src ?? a['data-src'] ?? '', file = decodeURIComponent(src.split(/[?#]/)[0].split('/').pop() ?? '')
    if (!/logo/i.test(`${file} ${a.alt ?? ''} ${a.class ?? ''} ${a.id ?? ''}`) || /\.jpe?g$/i.test(file) || (parseInt(a.width ?? '', 10) || 0) >= 1000) return false
    const ownPlace = /(^|[\s_-])(header|navbar|nav|site|brand|masthead|top)[\w-]*logo|logo[\w-]*(header|nav|site|brand|main|primary)/i.test(`${a.class ?? ''} ${a.id ?? ''}`)
    const ownFile = brandKeys.some(k => flat(file).startsWith(k) || flat(file).startsWith(`logo${k}`))
      || ((a.alt ?? '').length <= 40 && brandKeys.some(k => flat(a.alt ?? '').startsWith(k) && /logo/i.test(a.alt ?? '')))
    return ownPlace || ownFile
  }).map(a => abs(a.src ?? a['data-src']))
  // (a share picture that is the logo — open_graph_logo.png — is one too; any other is a banner)
  const shareLogo = share && /logo/i.test(share.split('/').pop() ?? '') ? share : null
  // On a profile page the share picture is the profile picture: the best logo there
  const logos = [...new Set((social ? [share, ...icons] : [...logoImgs, shareLogo, ...icons]).filter((u): u is string => !!u))]
  // Its styles: the stylesheets it links (a social profile's are the network's, not the brand's), its
  // inline <style>s, and the fonts its Google Fonts links load
  const sheets = social ? [] : [...new Set(links
    .filter(l => /(^|\s)stylesheet(\s|$)/i.test(l.rel ?? '') || (/(^|\s)preload(\s|$)/i.test(l.rel ?? '') && l.as === 'style'))
    .map(l => abs(l.href)).filter((u): u is string => !!u))]
  const inlineCss = social ? [] : [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).filter(s => s.length < MAX_CSS)
  const googleFamilies = social ? [] : sheets.flatMap(googleFontFamilies)
  return {
    name: siteName ? siteName.slice(0, 40) : null, handle: handleOf(base, meta('twitter:site')), themeColor: hexColor(meta('theme-color')), logos,
    sheets: sheets.filter(u => !googleFontFamilies(u).length), inlineCss, googleFamilies,
  }
}

/** The site's fonts and colours from its styles (brandStyle.ts): its stylesheets read side by side; one that can't be read is skipped */
export async function siteStyle(info: ReturnType<typeof readPage>) {
  if (!info.inlineCss.length && !info.sheets.length && !info.googleFamilies.length) return null
  const sheets = await Promise.all(info.sheets.slice(0, MAX_SHEETS).map(u =>
    fetchSafe(u, MAX_CSS, 'text/css,*/*;q=0.1', CSS_TIMEOUT_MS).then(r => (/css|text\/plain|octet/.test(r.type) || !r.type ? r.body.toString('utf8') : ''), () => '')))
  const css = [...info.inlineCss, ...sheets].filter(Boolean)
  // (fonts a stylesheet loads from Google Fonts with @import count as loaded too)
  const imported = css.flatMap(c => [...c.matchAll(/@import\s+(?:url\()?["']?(https:\/\/fonts\.googleapis\.com[^"')\s]+)/gi)].flatMap(m => googleFontFamilies(m[1])))
  return readSiteStyle(css, [...info.googleFamilies, ...imported])
}

/** A site's name from its page title — the shorter end: "Stripe | Financial…", "The AI workspace… | Notion" */
function titleName(title: string): string | null {
  // (a page standing in for the site — a redirect, a bot check — names nothing)
  if (/^(redirecting|just a moment|attention required|access denied|loading|please wait|403|404|error)\b/i.test(title)) return null
  const parts = title.split(/\s+[|–—·:-]\s+/).map(p => p.trim()).filter(Boolean)
  if (!parts.length) return null
  const first = parts[0], last = parts[parts.length - 1]
  return last.length < first.length ? last : first
}

/** The @handle: from a profile link's path, else the site's Twitter / X account */
function handleOf(url: URL, twitterSite: string | null): string | null {
  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  const first = url.pathname.split('/').filter(Boolean)[0] ?? ''
  const clean = (h: string) => (h.replace(/^@+/, '').match(/^[A-Za-z0-9._]{1,30}$/) ? h.replace(/^@+/, '') : null)
  if (/^(instagram|x|twitter|tiktok|threads\.net)/.test(host) || host === 'threads.net') {
    if (first && !/^(p|reel|reels|explore|stories|share|i|home|intent)$/i.test(first)) return clean(first)
  }
  if (/^(youtube\.com|m\.youtube\.com)$/.test(host) && first.startsWith('@')) return clean(first)
  return twitterSite ? clean(twitterSite) : null
}

function hexColor(v: string | null): string | null {
  if (!v) return null
  const s = v.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
  const m = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s)
  return m ? `#${[m[1], m[2], m[3]].map(x => Math.min(255, +x).toString(16).padStart(2, '0')).join('')}` : null
}

/** Reads the link and copies its logo into the user's brand folder */
export async function brandFromLink(userId: string, link: unknown): Promise<LinkBrand> {
  if (typeof link !== 'string' || !link.trim() || link.length > 500) throw err('Paste a website or profile link', 400)
  const open = (url: string) => fetchSafe(url, MAX_PAGE, 'text/html,application/xhtml+xml').catch(e => {
    throw e?.expose ? e : err('That page couldn’t be opened. Check the link, or fill the kit in by hand.', 400)
  })
  let page = await open(link.trim())
  // A page that only sends you on (<meta http-equiv="refresh" content="0; url=…">): the page it sends to
  const refresh = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/i.exec(page.body.subarray(0, 20_000).toString('utf8'))
  const next = refresh && /url\s*=\s*['"]?([^'">\s]+)/i.exec(attrs(refresh[0]).content ?? '')?.[1]
  if (next) page = await open(new URL(next, page.url).toString()).catch(() => page)
  if (!/html|xml|text\/plain/.test(page.type) && page.type) throw err('That link isn’t a web page', 400)
  const info = readPage(page.body.toString('utf8'), page.url)
  // (the styles read while the logo is looked for)
  const styleRead = siteStyle(info).catch(() => null)
  const sharp = await loadSharp()
  type Pick = { body: Buffer; type: string; ratio: number | null; colors: { main: string; accent: string | null } | null }
  let pick: Pick | null = null
  // (a 32-px tab icon blurs on a video: used only when the page has nothing bigger)
  let small: Pick | null = null
  for (const src of info.logos.slice(0, 8)) {
    const img = await fetchSafe(src, MAX_IMAGE, 'image/png,image/webp,image/svg+xml,image/jpeg,image/*').catch(() => null)
    if (!img || img.body.length < 100) continue
    const isSvg = img.type === 'image/svg+xml' || /^\s*(<\?xml[^>]*>\s*)?<svg/i.test(img.body.subarray(0, 300).toString('utf8'))
    if (!sharp) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(img.type)) continue
      pick = { body: img.body, type: img.type, ratio: null, colors: null }
      break
    }
    try {
      const pic = sharp(img.body, { density: isSvg ? 300 : undefined }).resize(1024, 1024, { fit: 'inside', withoutEnlargement: !isSvg })
      const out = await pic.png().toBuffer({ resolveWithObject: true })
      const side = Math.max(out.info.width, out.info.height)
      if (side < 32 || out.info.height < 16) continue
      const { data, info: px } = await sharp(out.data).resize(48, 48, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const found: Pick = { body: out.data, type: 'image/png', ratio: out.info.height / out.info.width, colors: logoColors(data, px.channels) }
      if (side >= 64) { pick = found; break }
      small ??= found
    } catch { continue }
  }
  pick ??= small
  let logo: LinkBrand['logo'] = null
  if (pick) {
    const ext = pick.type === 'image/png' ? 'png' : pick.type === 'image/jpeg' ? 'jpg' : 'webp'
    const path = `brand/${userId}/${crypto.randomUUID()}.${ext}`
    // (the logo not stored: the name and colours still come back)
    const stored = await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: path, Body: pick.body, ContentType: pick.type })).then(() => true, () => false)
    if (stored) {
      const url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: path }), { expiresIn: LOGO_LINK_SECONDS }).catch(() => null)
      logo = { path, url, ratio: pick.ratio }
    }
  }
  const style = await styleRead
  // The logo's own colours first (the brand's), then the site's and its theme colour
  const colors = mergePalette(pick?.colors ?? null, style?.colors ?? [], info.themeColor)
  return {
    source: page.url.hostname.replace(/^www\./, ''),
    name: info.name, handle: info.handle, logo, colors,
    fonts: style && (style.heading || style.body) ? { heading: style.heading, body: style.body } : null,
  }
}
