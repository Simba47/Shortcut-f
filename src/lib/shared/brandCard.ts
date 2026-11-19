/**
 * The Branded card's look (user, 2026-10-19: the card is the one frame a brand kit customizes):
 * its background — one colour, a gradient or a pattern of two colours — and where its video, title
 * and @handle sit. A kit keeps one (BrandKitData.card); a Branded card section carries a copy in
 * its frame settings (FrameSettings.card), which the editor and the export both draw from:
 *   • places:      cardAreas          ↔ chai-cut-backend src/python/frames.py card_areas
 *   • background:  cardBackgroundHit  ↔ frames.py card_bg_filter (ffmpeg geq, the same formulas)
 * Keep the pairs identical. Positions are shares of the 1080 × 1920 frame; pattern sizes px at 1080 wide.
 */

export type CardPattern = 'dots' | 'grid' | 'stripes' | 'checker' | 'waves'
export const CARD_PATTERNS: CardPattern[] = ['dots', 'grid', 'stripes', 'checker', 'waves']

export interface CardLook {
  bg: {
    style: 'solid' | 'gradient' | 'pattern'
    /** The card's colour (solid), the gradient's start, or the pattern's ground */
    color: string
    /** The gradient's end, or the pattern's colour */
    color2: string
    direction: 'down' | 'diagonal'
    pattern: CardPattern
    /** The pattern's size, px at 1080 wide */
    scale: number
    /**
     * How solid it is, 0–1 (user, 2026-11-19); absent = 1. Below 1 the video, blurred, shows through it (render.py
     * the same: frames.py clean_background, the frame's base)
     */
    opacity?: number
  }
  /** The video: its width (share of the frame), the height its middle sits at (share), its corner rounding (0–100) */
  video: { width: number; y: number; corners: number }
  title_at: 'top' | 'bottom'
  handle_at: 'top' | 'bottom'
}

/**
 * A frame's own background (user, 2026-10-19): the area behind and around its videos — one colour,
 * a gradient or a pattern of two colours. Any frame can have one (FrameSettings.bg); a Branded card's
 * look carries one too (CardLook.bg). The editor and the export draw it the same way
 * (backgroundPixels ↔ frames.py bg_filter).
 */
export type FrameBackground = CardLook['bg']
export const DEFAULT_FRAME_BG: FrameBackground = { style: 'solid', color: '#000000', color2: '#2e2e3a', direction: 'down', pattern: 'dots', scale: 48 }

export const CARD_VIDEO_WIDTH: [number, number] = [0.5, 1]
export const CARD_PATTERN_SCALE: [number, number] = [16, 160]

/** As the Branded card has always looked (frames.ts frame_brand_card): existing cards keep their look */
export const DEFAULT_CARD_LOOK: CardLook = {
  bg: { style: 'solid', color: '#1c1c22', color2: '#2e2e3a', direction: 'down', pattern: 'dots', scale: 48 },
  video: { width: 0.88, y: 0.51, corners: 50 },
  title_at: 'top',
  handle_at: 'bottom',
}

const HEX = /^#[0-9a-f]{6}$/i
const color = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback)
const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback)
const r3 = (v: number) => Math.round(v * 1000) / 1000

/** A background as it may be saved: anything missing or wrong takes `fallback`'s */
export function cleanFrameBackground(raw: unknown, fallback: FrameBackground = DEFAULT_FRAME_BG): FrameBackground {
  const bg = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    style: bg.style === 'gradient' || bg.style === 'pattern' ? bg.style : bg.style === 'solid' ? 'solid' : fallback.style,
    color: color(bg.color, fallback.color),
    color2: color(bg.color2, fallback.color2),
    direction: bg.direction === 'diagonal' ? 'diagonal' : bg.direction === 'down' ? 'down' : fallback.direction,
    pattern: CARD_PATTERNS.includes(bg.pattern as CardPattern) ? bg.pattern as CardPattern : fallback.pattern,
    scale: Math.round(num(bg.scale, CARD_PATTERN_SCALE[0], CARD_PATTERN_SCALE[1], fallback.scale)),
    // (kept only below 1: a solid background saves as it always has)
    ...(() => { const o = Math.round(num(bg.opacity, 0, 1, fallback.opacity ?? 1) * 100) / 100; return o < 1 ? { opacity: o } : {} })(),
  }
}

/**
 * The background a frame section shows, when it has one of its own: its own (frame.bg), else a
 * Branded card's look's; null = as the template has it (its band colour, black, or Blur fill's blur)
 */
export function frameBackgroundOf(layout: string, frame: { bg?: unknown; card?: unknown } | null | undefined): FrameBackground | null {
  if (layout === 'frame_blur_fill') return null
  if (frame?.bg && typeof frame.bg === 'object') return cleanFrameBackground(frame.bg)
  if (layout === 'frame_brand_card' && frame?.card && typeof frame.card === 'object') return cleanCardLook(frame.card).bg
  return null
}

/** A card look as it may be saved: anything missing or wrong takes `fallback`'s (the default's) */
export function cleanCardLook(raw: unknown, fallback: CardLook = DEFAULT_CARD_LOOK): CardLook {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const v = (d.video && typeof d.video === 'object' ? d.video : {}) as Record<string, unknown>
  return {
    bg: cleanFrameBackground(d.bg, fallback.bg),
    video: {
      width: r3(num(v.width, CARD_VIDEO_WIDTH[0], CARD_VIDEO_WIDTH[1], fallback.video.width)),
      y: r3(num(v.y, 0, 1, fallback.video.y)),
      corners: Math.round(num(v.corners, 0, 100, fallback.video.corners)),
    },
    title_at: d.title_at === 'bottom' ? 'bottom' : d.title_at === 'top' ? 'top' : fallback.title_at,
    handle_at: d.handle_at === 'top' ? 'top' : d.handle_at === 'bottom' ? 'bottom' : fallback.handle_at,
  }
}

// ── Places ───────────────────────────────────────────────────────────────────
/** The video keeps the card's shape: its height (share of the frame's) per share of width */
const VIDEO_RATIO = 0.6 / 0.88
const TITLE_H = 0.15, HANDLE_H = 0.1, TITLE_GAP = 0.01, HANDLE_GAP = 0.02, STACK_GAP = 0.005
const TEXT_X = 0.06, TEXT_W = 0.88

export interface CardArea { kind: 'band' | 'slot'; lane?: 'band' | 'band2'; slot?: number; x: number; y: number; w: number; h: number; radius?: number }

/** Where the card's title, video and @handle go (render.py frames.py card_areas: the same numbers) */
export function cardAreas(look: CardLook): { title: CardArea; video: CardArea; handle: CardArea } {
  const vw = Math.min(CARD_VIDEO_WIDTH[1], Math.max(CARD_VIDEO_WIDTH[0], look.video.width))
  const vh = vw * VIDEO_RATIO
  const vx = (1 - vw) / 2
  const cy = Math.min(1 - vh / 2, Math.max(vh / 2, look.video.y))
  const vy = cy - vh / 2
  const inside = (y: number, h: number) => Math.min(1 - h, Math.max(0, y))
  const ty = inside(look.title_at === 'top' ? vy - TITLE_GAP - TITLE_H : vy + vh + TITLE_GAP, TITLE_H)
  let hy: number
  if (look.handle_at === look.title_at) hy = look.handle_at === 'top' ? ty - STACK_GAP - HANDLE_H : ty + TITLE_H + STACK_GAP
  else hy = look.handle_at === 'top' ? vy - HANDLE_GAP - HANDLE_H : vy + vh + HANDLE_GAP
  return {
    title: { kind: 'band', lane: 'band', x: TEXT_X, y: ty, w: TEXT_W, h: TITLE_H },
    video: { kind: 'slot', slot: 0, x: vx, y: vy, w: vw, h: vh, radius: Math.round(look.video.corners * 0.8) },
    handle: { kind: 'band', lane: 'band2', x: TEXT_X, y: inside(hy, HANDLE_H), w: TEXT_W, h: HANDLE_H },
  }
}

// ── Background ───────────────────────────────────────────────────────────────
// Per pixel, in px at 1080 wide (u, v): the pattern's colour where it "hits", else the ground.
// frames.py card_bg_filter writes these same tests as an ffmpeg geq expression.
const mod = (a: number, b: number) => ((a % b) + b) % b

/** Whether pixel (u, v) — px at 1080 wide — shows the pattern's colour */
export function cardPatternHit(pattern: CardPattern, u: number, v: number, p: number): boolean {
  switch (pattern) {
    case 'dots': return Math.hypot(mod(u, p) - p / 2, mod(v, p) - p / 2) < p * 0.18
    case 'grid': { const t = Math.max(2, p * 0.06); return mod(u, p) < t || mod(v, p) < t }
    case 'stripes': return mod(u + v, p) < p * 0.3
    case 'checker': return mod(Math.floor(u / p) + Math.floor(v / p), 2) >= 1
    case 'waves': return mod(v + Math.sin((u / p) * 2 * Math.PI) * p * 0.25, p) < Math.max(2, p * 0.12)
  }
}

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]

/** The card's background, W × H pixels (RGBA), as the export draws it */
export const cardBackgroundPixels = (look: CardLook, W: number, H: number) => backgroundPixels(look.bg, W, H)

/** A frame background, W × H pixels (RGBA), as the export draws it (frames.py bg_filter) */
export function backgroundPixels(bg: FrameBackground, W: number, H: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(W * H * 4))
  const a = rgb(bg.color), b = rgb(bg.color2)
  const k = 1080 / W
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c = a
      if (bg.style === 'gradient') {
        const s = bg.direction === 'diagonal' ? (x / W + y / H) / 2 : y / H
        c = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s]
      } else if (bg.style === 'pattern' && cardPatternHit(bg.pattern, x * k, y * k, bg.scale)) c = b
      const i = (y * W + x) * 4
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255
    }
  }
  return out
}
