import type { CaptionStyle } from '@chai-cut/shared'
import { sameGradient } from './gradient'

// ── Caption parts: a different caption style from one moment of the clip to the next ──────────
// The clip's caption style (caption_styles) is the look of its first part. A split (as a video
// part is split, at the playhead) starts a new part there, with a look of its own; each part runs
// to where the next one starts. Saved beside the rows (clips.layers.captionParts), in clip time
// (the timeline as it plays), and read by the export (render.ts caption_parts, render.py).
//
// A part's look is only how the captions look: where they sit, which script, on or off, the key
// words and the timing stay one setting for the whole clip.

/** A part after the first: from `start_ms` (clip ms) to where the next one starts, in its own look */
export interface CaptionPart { id: string; start_ms: number; style: Partial<CaptionStyle> }

/** What a part's look is made of (the Captions panel's style, colours, size, font, case) */
export const LOOK_KEYS = ['template', 'animation', 'color', 'highlight_color', 'font', 'size', 'uppercase', 'stroke_width', 'words_per_line', 'gradient'] as const

/** A part as it plays: its stretch of the clip (clip ms) and its look over the clip's own */
export interface PlayedPart { id: string | null; index: number; start_ms: number; end_ms: number; style: Partial<CaptionStyle> }

/** A part never shorter than this (ms): a split closer than that to another is refused */
export const MIN_PART_MS = 400

/** The look keys of a style (nothing else) */
export function lookOf(style: Partial<CaptionStyle>): Partial<CaptionStyle> {
  const out: Record<string, unknown> = {}
  for (const k of LOOK_KEYS) if (style[k] !== undefined) out[k] = style[k]
  return out as Partial<CaptionStyle>
}

/** Whether a change touches a part's look (else it is a setting of the whole clip) */
export const isLookChange = (updates: Partial<CaptionStyle>) => Object.keys(updates).some(k => (LOOK_KEYS as readonly string[]).includes(k))

/** Parts as saved, made safe: inside the clip, in order, none too close to another or to its ends */
export function cleanParts(parts: unknown, lengthMs: number): CaptionPart[] {
  if (!Array.isArray(parts)) return []
  const out: CaptionPart[] = []
  for (const p of [...parts].sort((a, b) => Number(a?.start_ms) - Number(b?.start_ms))) {
    const at = Math.round(Number(p?.start_ms))
    if (!Number.isFinite(at) || at < MIN_PART_MS || at > lengthMs - MIN_PART_MS) continue
    if (out.length && at - out[out.length - 1].start_ms < MIN_PART_MS) continue
    out.push({ id: typeof p?.id === 'string' ? p.id : crypto.randomUUID(), start_ms: at, style: lookOf(p?.style && typeof p.style === 'object' ? p.style : {}) })
  }
  return out
}

/** Every part as it plays, the first one (the clip's own style) included */
export function playedParts(base: Partial<CaptionStyle>, parts: CaptionPart[], lengthMs: number): PlayedPart[] {
  const starts = [{ id: null as string | null, start_ms: 0, style: {} as Partial<CaptionStyle> }, ...parts]
  return starts.map((p, i) => ({
    id: p.id, index: i, start_ms: p.start_ms,
    end_ms: i + 1 < starts.length ? starts[i + 1].start_ms : Math.max(p.start_ms, lengthMs),
    style: { ...base, ...p.style },
  }))
}

/** The part playing at clip time `t` */
export function playedPartAt(played: PlayedPart[], t: number): PlayedPart {
  for (let i = played.length - 1; i > 0; i--) if (t >= played[i].start_ms) return played[i]
  return played[0]
}

/**
 * Where a split at `t` really goes: into the pause between the two words nearest to it, so a
 * caption line is never cut in the middle of a word (words in clip ms). No words near: at `t`.
 */
export function splitPoint(t: number, words: { start_ms: number; end_ms: number }[]): number {
  const sorted = [...words].sort((a, b) => a.start_ms - b.start_ms)
  const inside = sorted.find(w => t > w.start_ms && t < w.end_ms)
  if (!inside) return Math.round(t)
  // (before the word, or after it: whichever is nearer)
  const i = sorted.indexOf(inside)
  const before = i > 0 ? (sorted[i - 1].end_ms + inside.start_ms) / 2 : inside.start_ms
  const after = i + 1 < sorted.length ? (inside.end_ms + sorted[i + 1].start_ms) / 2 : inside.end_ms
  return Math.round(t - inside.start_ms <= inside.end_ms - t ? before : after)
}

/**
 * The parts with a new one starting at `t` (clip ms, already at a pause: splitPoint), in the look
 * of the part it splits. Null when it would make a part shorter than MIN_PART_MS.
 */
export function splitParts(parts: CaptionPart[], base: Partial<CaptionStyle>, t: number, lengthMs: number): { parts: CaptionPart[]; id: string } | null {
  const at = Math.round(t)
  if (at < MIN_PART_MS || at > lengthMs - MIN_PART_MS) return null
  if (parts.some(p => Math.abs(p.start_ms - at) < MIN_PART_MS)) return null
  const played = playedParts(base, parts, lengthMs)
  const from = playedPartAt(played, at)
  const id = crypto.randomUUID()
  const style = from.index === 0 ? lookOf(base) : lookOf(parts[from.index - 1].style)
  return { parts: [...parts, { id, start_ms: at, style }].sort((a, b) => a.start_ms - b.start_ms), id }
}

/** A part's look changed (index 0: the clip's own style, the caller's to change) */
export function withPartLook(parts: CaptionPart[], id: string, updates: Partial<CaptionStyle>): CaptionPart[] {
  const look = lookOf(updates)
  return parts.map(p => (p.id === id ? { ...p, style: { ...p.style, ...look } } : p))
}

/** A part taken away: its time goes to the part before it */
export const withoutPart = (parts: CaptionPart[], id: string) => parts.filter(p => p.id !== id)

/** Where a part starts moved (dragging the edge between two parts), kept clear of its neighbours */
export function movePartStart(parts: CaptionPart[], id: string, t: number, lengthMs: number): CaptionPart[] {
  const i = parts.findIndex(p => p.id === id)
  if (i < 0) return parts
  const lo = (i > 0 ? parts[i - 1].start_ms : 0) + MIN_PART_MS
  const hi = (i + 1 < parts.length ? parts[i + 1].start_ms : lengthMs) - MIN_PART_MS
  if (hi < lo) return parts
  const at = Math.round(Math.min(hi, Math.max(lo, t)))
  return at === parts[i].start_ms ? parts : parts.map(p => (p.id === id ? { ...p, start_ms: at } : p))
}

/** A short name for a part's look, for the timeline and the panel ("Creator · Behind bold", "Classic") */
export function lookName(style: Partial<CaptionStyle>, templateName?: (id: string) => string | undefined): string {
  if (style.template) return templateName?.(style.template) ?? 'Style'
  const a = style.animation ?? 'karaoke'
  return a.charAt(0).toUpperCase() + a.slice(1)
}

/** Two looks the same (every look key) */
function sameLook(a: Partial<CaptionStyle>, b: Partial<CaptionStyle>): boolean {
  return LOOK_KEYS.every(k => (k === 'gradient' ? sameGradient(a.gradient, b.gradient) : (a[k] ?? null) === (b[k] ?? null)))
}

/**
 * A look given to the captions from `from` to `to` (clip ms; past the clip's ends: its start or
 * end), as the Captions panel does it: no split to make first. The edges go into the pauses
 * between words (splitPoint), or onto a part's start already near; the stretch gets the look,
 * every other part keeps its own; neighbours left with the same look become one part again.
 * Returns the look of the first part (the clip's own style) and the parts after it, each with its
 * whole look (so a later change to the first one never reaches them).
 */
export function applyLook(
  base: Partial<CaptionStyle>, parts: CaptionPart[], from: number, to: number, updates: Partial<CaptionStyle>,
  lengthMs: number, words: { start_ms: number; end_ms: number }[],
): { baseLook: Partial<CaptionStyle>; parts: CaptionPart[] } {
  const look = lookOf(updates)
  let a = from <= MIN_PART_MS ? 0 : splitPoint(from, words)
  let b = to >= lengthMs - MIN_PART_MS ? lengthMs : splitPoint(to, words)
  if (b - a < MIN_PART_MS) b = Math.min(lengthMs, a + MIN_PART_MS)
  const played = playedParts(base, parts, lengthMs)
  const near = (t: number) => played.find(p => Math.abs(p.start_ms - t) < MIN_PART_MS)
  const cuts = new Set(played.map(p => p.start_ms))
  if (a > 0) { const n = near(a); if (n) a = n.start_ms; else cuts.add(a) }
  if (b < lengthMs) { const n = near(b); if (n) b = n.start_ms; else if (lengthMs - b >= MIN_PART_MS) cuts.add(b); else b = lengthMs }
  const starts = [...cuts].filter(s => s < lengthMs).sort((x, y) => x - y)
  const segs = starts.map(s => {
    const old = playedPartAt(played, s)
    return { start: s, id: played.find(p => p.start_ms === s)?.id ?? null, style: { ...lookOf(old.style), ...(s >= a && s < b ? look : {}) } }
  })
  // (neighbours with the same look: one part)
  const merged = segs.filter((sg, i) => i === 0 || !sameLook(sg.style, segs[i - 1].style))
  return {
    baseLook: merged[0]?.style ?? lookOf({ ...base, ...look }),
    parts: merged.slice(1).map(sg => ({ id: sg.id ?? crypto.randomUUID(), start_ms: sg.start, style: sg.style })),
  }
}
