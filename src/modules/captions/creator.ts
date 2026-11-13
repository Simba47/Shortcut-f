import type { CaptionStyle } from '@chai-cut/shared'
import { TEMPLATE_FONTS, templateFontFamily, type CaptionTemplate, type CreatorLook } from './templates'

/**
 * The Creator caption styles in the editor: a template with a `look` (group "Creator").
 * Mirrors the export's creator_captions.py (backend src/python): same lines, places and timing.
 *
 * Every size is px at 1080 wide (k = W / 1080). A font of size N is drawn so its full height
 * (OS/2 winAscent + winDescent) is N, as libass sizes it, its baseline `asc` of that from the top.
 * Words appear when they are spoken (a short fade). See creator_captions.py for what each look is.
 *
 * The key word of a line is the first emphasised one (caption_styles.emphasis: picked by AI,
 * changed in the Captions panel), else its line word (caption_styles.line_keys: the word AI says
 * carries it, changed there too), else its longest word ("build": its middle one).
 */

export type CaptionWord = { word: string; start_ms: number; end_ms: number }
type Rect = { x: number; y: number; w: number; h: number }

const FADE_MS = 120
const BUILD_MS = 150
const SCROLL_MS = 180
const SCRIBBLE_MS = 260
const SUBTITLE_DIM = 1 - 0x59 / 255     // subtitle: words already spoken
const GHOST = 1 - 0xb8 / 255            // scroll: the words before / after
const FIT = 0.9                         // split / subtitle / scribble: a line's widest (wider: on to the next line)

/** Where a look sits when the captions haven't been moved (position_y) */
export const CREATOR_DEFAULT_Y: Record<CreatorLook, number> = {
  behind: 0.2, difference: 0.22, build: 0.58, multi: 0.1, scroll: 0.62, split: 0.76, subtitle: 0.62, scribble: 0.72,
}
/** multi: a new corner each line (left/right, top of the block as a share of the height) */
const MULTI_SPOTS: Array<['left' | 'right', number]> = [['left', 0.10], ['right', 0.10], ['right', 0.40], ['left', 0.40]]

const loaded = new Set<string>()
function load(key: string) {
  const f = TEMPLATE_FONTS[key]
  const family = templateFontFamily(key)
  if (f && !loaded.has(family) && typeof FontFace !== 'undefined') {
    loaded.add(family)
    new FontFace(family, `url(/caption-fonts/${f.file})`, { weight: String(f.weight), style: f.italic ? 'italic' : 'normal' }).load()
      .then(face => document.fonts.add(face))
      .catch(() => loaded.delete(family))
  }
  return family
}

/**
 * Lines in another script are drawn in its Noto font, with the style's own weight and slant put on
 * it (the browser thickens / slants it, as libass does); Latin letters in such a line come from the
 * style's own font (fallback). The export's creator_captions.py has the same list.
 */
const SCRIPTS: Array<[number, number, string]> = [[0x0c00, 0x0c7f, 'noto-telugu'], [0x0900, 0x097f, 'noto-devanagari'], [0x0b80, 0x0bff, 'noto-tamil'],
  [0x0c80, 0x0cff, 'noto-kannada'], [0x0d00, 0x0d7f, 'noto-malayalam'], [0x0980, 0x09ff, 'noto-bengali']]
/** Display fonts that are one heavy weight though their files say regular (400) */
const HEAVY = new Set(['anton', 'bangers', 'bebas', 'lilita', 'luckiest'])
/** The Noto font for the first non-Latin script in the text, null for Latin text (creator_captions.script_font) */
export function scriptFont(text: string): string | null {
  for (const ch of text) {
    const o = ch.codePointAt(0)!
    const s = SCRIPTS.find(([lo, hi]) => o >= lo && o <= hi)
    if (s) return s[2]
  }
  return null
}

/** A template font, loaded from the file the export uses (registered as it is: its weight and slant); in a script's Noto font when `script` */
function font(key: string, script: string | null = null) {
  const own = TEMPLATE_FONTS[key] ? key : 'poppins'
  const f = TEMPLATE_FONTS[own]
  const family = load(own)
  const s = script ? TEMPLATE_FONTS[script] : undefined
  if (s) {
    const sFamily = load(script!)
    const weight = f.weight >= 600 || HEAVY.has(own) ? 700 : 400
    return { css: (n: number) => `${f.italic ? 'italic ' : ''}${weight} ${n * s.em}px "${sFamily}", "${family}", sans-serif`, asc: s.asc ?? 0.7 }
  }
  return { css: (n: number) => `${f.italic ? 'italic ' : ''}${f.weight} ${n * f.em}px "${family}", sans-serif`, asc: f.asc ?? 0.8 }
}

const letters = (t: string) => (t.match(/[\p{L}\p{N}]/gu) ?? []).length

/**
 * The line's key word: the first emphasised, else its line word (`line`: the longest if AI marked
 * more than one), else the longest (build: the middle one) — creator_captions.key_index
 */
export function creatorKeyIndex(texts: string[], emph: boolean[], look: CreatorLook, line: boolean[] = []): number {
  const e = emph.indexOf(true)
  if (e >= 0) return e
  const marked = line.flatMap((on, j) => (on && j < texts.length ? [j] : []))
  if (marked.length) return marked.reduce((b, j) => (letters(texts[j]) > letters(texts[b]) ? j : b))
  if (look === 'build') return Math.min(1, texts.length - 1)
  let best = 0
  texts.forEach((t, j) => { if (letters(t) > letters(texts[best])) best = j })
  return best
}

/** The words a line marks: scribble every emphasised one (none picked at all: its key word), the others their key word */
export function creatorKeys(texts: string[], emph: boolean[], look: CreatorLook, anyEmphasis: boolean, line: boolean[] = []): Set<number> {
  if (look !== 'scribble') return new Set([creatorKeyIndex(texts, emph, look, line)])
  if (emph.some(Boolean)) return new Set(emph.flatMap((e, j) => (e ? [j] : [])))
  return anyEmphasis ? new Set() : new Set([creatorKeyIndex(texts, emph, look, line)])
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** A hand-drawn underline: a wavy band from x0 to x1 (creator_captions._wave_path) */
function wavePath(ctx: CanvasRenderingContext2D, x0: number, x1: number, yc: number, amp: number, lam: number, th: number) {
  const n = Math.max(2, Math.floor((x1 - x0) / (lam / 8)))
  const xs = Array.from({ length: n + 1 }, (_, i) => x0 + ((x1 - x0) * i) / n)
  const mid = xs.map(x => yc + amp * Math.sin((2 * Math.PI * (x - x0)) / lam))
  ctx.beginPath()
  xs.forEach((x, i) => (i ? ctx.lineTo(x, mid[i] - th / 2) : ctx.moveTo(x, mid[i] - th / 2)))
  for (let i = xs.length - 1; i >= 0; i--) ctx.lineTo(xs[i], mid[i] + th / 2)
  ctx.closePath()
}

let behindCanvas: HTMLCanvasElement | null = null

/**
 * Draws one caption line in a Creator look. `line`: its words (shown text), `lineIndex` its place
 * among the lines (multi moves corner each line), `lineEnd` when it leaves. `person`: where the
 * person is (look "behind": personMask.ts; null while that loads — drawn in front then).
 * Returns where it drew (shares of the canvas).
 */
export function drawCreatorCaptions(
  ctx: CanvasRenderingContext2D,
  line: CaptionWord[],
  lineIndex: number,
  lineEnd: number,
  tMs: number,
  style: Partial<CaptionStyle>,
  tpl: CaptionTemplate,
  person: CanvasImageSource | null,
  /** A font picked over the style's own (user, 2026-11-12), for Latin lines. ⚠️ Not in the export yet (backend) */
  picked: { family: string; em: number } | null = null,
): Rect | null {
  const look = tpl.look!
  const W = ctx.canvas.width, H = ctx.canvas.height
  const k = W / 1080
  const color = style.color ?? tpl.color
  const hl = style.highlight_color ?? tpl.hl
  const S = (style.size ?? 52) * (tpl.size / 100) * k
  const keyN = S * (tpl.keyScale ?? 100) / 100
  // (a line in another script: its Noto font, in the style's weight and slant)
  const script = scriptFont(line.map(w => w.word).join(' '))
  const own = picked && !script ? { css: (n: number) => `700 ${n * picked.em}px "${picked.family}", sans-serif`, asc: 0.8 } : null
  const base = own ?? font(tpl.font, script), key = own ?? font(tpl.keyFont ?? tpl.font, script)
  const shadow = (tpl.shadow ?? 0) * k
  const cx = W / 2                                    // (drawCaptions moves it where it was dragged)
  const cy = (style.position_y ?? CREATOR_DEFAULT_Y[look]) * H
  const upper = !!tpl.upper || !!style.uppercase
  const emphasis = style.emphasis ?? {}
  const anyEmphasis = Object.values(emphasis).some(Boolean)

  const a = line[0].start_ms
  const t = tMs - a
  const texts = line.map(w => (upper ? w.word.toUpperCase() : w.word))
  const emph = line.map(w => !!emphasis[String(w.start_ms)])
  const lineKeys = style.line_keys ?? {}
  const lineWord = line.map(w => !!lineKeys[String(w.start_ms)])
  const ons = line.map(w => w.start_ms - a)
  const offs = line.map((_, j) => (line[j + 1]?.start_ms ?? lineEnd) - a)
  const kk = creatorKeyIndex(texts, emph, look, lineWord)
  const reveal = (on: number) => (on <= 0 ? 1 : clamp01((t - on) / FADE_MS))

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  const grow = (x: number, y: number, w: number, h: number) => {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x + w); y0 = Math.min(y0, y); y1 = Math.max(y1, y + h)
  }

  // A run of text with its baseline at y, from x (left)
  const run = (g: CanvasRenderingContext2D, text: string, f: ReturnType<typeof font>, n: number, fill: string, x: number, y: number, alpha: number, shad = shadow) => {
    if (alpha <= 0) return
    g.font = f.css(n)
    g.globalAlpha = alpha
    g.fillStyle = fill
    if (shad > 0) { g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowOffsetX = g.shadowOffsetY = shad; g.shadowBlur = 0 }
    g.fillText(text, x, y)
    g.shadowColor = 'transparent'; g.shadowOffsetX = g.shadowOffsetY = 0
    g.globalAlpha = 1
  }
  const width = (f: ReturnType<typeof font>, n: number, text: string) => { ctx.font = f.css(n); return ctx.measureText(text).width }
  // The baseline of a one-font line centred on y (libass \an5)
  const centredBase = (f: ReturnType<typeof font>, n: number, y: number) => y - n / 2 + n * f.asc

  // Words in one font along a line: left from x, each faded as `alpha(j)`
  const words = (g: CanvasRenderingContext2D, idx: number[], f: ReturnType<typeof font>, n: number, fill: (j: number) => string,
    x: number, baseY: number, alpha: (j: number) => number) => {
    const space = width(f, n, ' ')
    for (const j of idx) {
      const w = width(f, n, texts[j])
      run(g, texts[j], f, n, fill(j), x, baseY, alpha(j))
      x += w + space
    }
  }
  const lineWidth = (idx: number[], f: ReturnType<typeof font>, n: number) =>
    idx.reduce((s, j) => s + width(f, n, texts[j]), 0) + width(f, n, ' ') * Math.max(0, idx.length - 1)
  /**
   * A line too wide for `max` broken into rows of whole words (user, 2026-11-12: Size stopped growing the
   * line once it filled the width — now it goes on to two lines). `widthOf`: a row's width.
   * ⚠️ The export (backend) still narrows the line instead: to be matched there
   */
  const rowsOf = (idx: number[], widthOf: (row: number[]) => number, max: number) => {
    const rows: number[][] = []
    for (const j of idx) {
      const row = rows[rows.length - 1]
      if (row && widthOf([...row, j]) <= max) row.push(j)
      else rows.push([j])
    }
    return rows
  }

  ctx.save()
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  if (look === 'behind') {
    // One word, as big as the size asks, narrowed to fit 88% of the width; under the person
    const w0 = width(base, S, texts[0])
    const n = w0 > 0 ? S * Math.min(1, (0.88 * W) / w0) : S
    const w = width(base, n, texts[0])
    const m = ctx.getTransform()
    const off = (behindCanvas ??= document.createElement('canvas'))
    if (off.width !== W || off.height !== H) { off.width = W; off.height = H }
    const g = off.getContext('2d')!
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, W, H)
    g.setTransform(m)
    g.textBaseline = 'alphabetic'
    run(g, texts[0], base, n, color, cx - w / 2, centredBase(base, n, cy), 1, 0)
    if (person) {
      // (the mask is the whole frame: drawn without the move left / right)
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.globalCompositeOperation = 'destination-out'
      g.drawImage(person, 0, 0, W, H)
      g.globalCompositeOperation = 'source-over'
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(off, 0, 0)
    ctx.setTransform(m)
    grow(cx - w / 2, cy - n / 2, w, n)
  } else if (look === 'difference') {
    // The key word big in difference blend; the words before it small above, those after small below
    const rows: Array<[number[], number]> = ([
      [Array.from({ length: kk }, (_, j) => j), S * 0.95],
      [[kk], keyN * 0.9],
      [Array.from({ length: texts.length - kk - 1 }, (_, j) => kk + 1 + j), S * 0.95],
    ] as Array<[number[], number]>).filter(([idx]) => idx.length > 0)
    let y = cy - rows.reduce((s, [, h]) => s + h, 0) / 2
    for (const [idx, h] of rows) {
      const yc = y + h / 2
      if (idx[0] === kk && idx.length === 1) {
        const w = width(key, keyN, texts[kk])
        ctx.globalCompositeOperation = 'difference'
        run(ctx, texts[kk], key, keyN, color, cx - w / 2, centredBase(key, keyN, yc), reveal(ons[kk]), 0)
        ctx.globalCompositeOperation = 'source-over'
        grow(cx - w / 2, yc - keyN / 2, w, keyN)
      } else {
        const w = lineWidth(idx, base, S)
        words(ctx, idx, base, S, () => color, cx - w / 2, centredBase(base, S, yc), j => reveal(ons[j]))
        grow(cx - w / 2, yc - S / 2, w, S)
      }
      y += h
    }
  } else if (look === 'build') {
    const pitch = S * 0.92
    texts.forEach((text, j) => {
      const on = ons[j]
      const rise = on > 0 ? S * 0.18 * (1 - clamp01((t - on) / BUILD_MS)) : 0
      const y = cy + (j - (texts.length - 1) / 2) * pitch
      const w = width(base, S, text)
      run(ctx, text, base, S, j === kk ? hl : color, cx - w / 2, centredBase(base, S, y + rise), reveal(on))
      grow(cx - w / 2, y - S / 2, w, S)
    })
  } else if (look === 'multi') {
    const [side, top] = MULTI_SPOTS[lineIndex % MULTI_SPOTS.length]
    const x = side === 'left' ? Math.round(W * 0.08) : Math.round(W * 0.92)
    const rows: Array<[number[], ReturnType<typeof font>, number]> = [
      [Array.from({ length: kk }, (_, j) => j), base, S],
      [[kk], key, keyN],
      [Array.from({ length: texts.length - kk - 1 }, (_, j) => kk + 1 + j), base, S],
    ]
    let y = top * H
    for (const [idx, f, n] of rows) {
      if (!idx.length) continue
      const w = lineWidth(idx, f, n)
      const left = side === 'left' ? x : x - w
      words(ctx, idx, f, n, () => color, left, y + n * f.asc, j => reveal(ons[j]))
      grow(left, y, w, n)
      y += n * 0.95
    }
  } else if (look === 'scroll') {
    // The word being spoken (before the first: the first), the one before above, the next below
    const pitch = S * 1.05
    let j = 0
    while (j + 1 < texts.length && t >= ons[j + 1]) j++
    const step = j > 0 ? pitch * (1 - clamp01((t - ons[j]) / SCROLL_MS)) : 0
    for (const d of [-1, 0, 1]) {
      const i = j + d
      if (i < 0 || i >= texts.length) continue
      const n = d === 0 ? S : S * 0.8
      const y = cy + d * pitch + step
      const w = width(base, n, texts[i])
      run(ctx, texts[i], base, n, hl, cx - w / 2, centredBase(base, n, y), d === 0 ? 1 : GHOST)
      if (d === 0) grow(cx - w / 2, y - n / 2, w, n)
    }
  } else if (look === 'split') {
    // One line, the key word in its own font and size, on one baseline; the line's height centred on cy
    // (narrowed to fit FIT of the width)
    // (too wide for one line: on to more lines, each word whole — a word wider than a line narrows them all)
    const full = texts.map((_, j) => (j === kk ? { f: key, n: keyN } : { f: base, n: S }))
    const widest = Math.max(...texts.map((tx, j) => width(full[j].f, full[j].n, tx)))
    const fit = widest > 0 ? Math.min(1, (FIT * W) / widest) : 1
    const parts = full.map(p => ({ f: p.f, n: p.n * fit }))
    const rowWidth = (row: number[]) => row.reduce((s, j, i) => s + width(parts[j].f, parts[j].n, texts[j] + (i + 1 < row.length ? ' ' : '')), 0)
    const rows = rowsOf(texts.map((_, j) => j), rowWidth, FIT * W)
    const heights = rows.map(row => ({
      A: Math.max(...row.map(j => parts[j].n * parts[j].f.asc)), D: Math.max(...row.map(j => parts[j].n * (1 - parts[j].f.asc))),
    }))
    let top = cy - heights.reduce((s, h) => s + h.A + h.D, 0) / 2
    rows.forEach((row, r) => {
      const { A, D } = heights[r]
      const baseY = top + A
      const rw = rowWidth(row)
      let x = cx - rw / 2
      grow(x, top, rw, A + D)
      row.forEach((j, i) => {
        const text = texts[j] + (i + 1 < row.length ? ' ' : '')
        run(ctx, text, parts[j].f, parts[j].n, j === kk ? hl : color, x, baseY, reveal(ons[j]))
        x += width(parts[j].f, parts[j].n, text)
      })
      top += A + D
    })
  } else if (look === 'subtitle' || look === 'scribble') {
    const all = texts.map((_, j) => j)
    // (too wide for one line: on to more lines, each word whole — a word wider than a line narrows them all)
    const widest = Math.max(...texts.map(tx => width(base, S, tx)))
    const n = widest > 0 ? S * Math.min(1, (FIT * W) / widest) : S
    const rows = rowsOf(all, row => lineWidth(row, base, n), FIT * W)
    const pitch = n * 1.08
    const keys = look === 'scribble' ? creatorKeys(texts, emph, look, anyEmphasis, lineWord) : null
    rows.forEach((row, r) => {
      const w = lineWidth(row, base, n)
      const left = cx - w / 2
      const yc = cy + (r - (rows.length - 1) / 2) * pitch
      const baseY = centredBase(base, n, yc)
      if (keys) {
        // The underlines first (under the text), each drawn left to right when its word is spoken
        const space = width(base, n, ' ')
        const amp = n * 0.06, lam = n * 0.42, th = Math.max(2, n * 0.07)
        let x = left
        for (const j of row) {
          const ww = width(base, n, texts[j])
          if (keys.has(j)) {
            const p = ons[j] > 0 ? clamp01((t - ons[j]) / SCRIBBLE_MS) : 1
            if (p > 0) {
              ctx.save()
              ctx.beginPath()
              ctx.rect(x - th, 0, (ww + 2 * th) * p, H)
              ctx.clip()
              wavePath(ctx, x, x + ww, baseY + n * 0.14, amp, lam, th)
              ctx.fillStyle = hl
              ctx.fill()
              ctx.restore()
            }
          }
          x += ww + space
        }
      }
      words(ctx, row, base, n, () => color, left, baseY, j => {
        const rv = reveal(ons[j])
        // subtitle: the words already said dimmed
        return look === 'subtitle' && t >= offs[j] && offs[j] < lineEnd - a ? rv * SUBTITLE_DIM : rv
      })
      grow(left, yc - n / 2, w, n)
    })
  }

  ctx.restore()
  return isFinite(x0) ? { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H } : null
}
