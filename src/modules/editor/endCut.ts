import type { SegmentLocal } from '@chai-cut/shared'
import { isGapPart } from './visibility'

/**
 * Deleting the main video's LAST part ends the clip there (user, 2026-11-15: "a 2 min clip, the last
 * 1:30 deleted, exports 2 min" — Delete leaves an empty space and the clip kept its length, so the
 * export played 1:30 of black). In the middle, Delete still leaves an empty space (nothing after it
 * moves); at the end there is nothing to keep in place, so that stretch is cut out instead, as an
 * edge dragged in would — and empty spaces just before it go with it, so no black is left at the end.
 * Deleting the FIRST part starts the clip later the same way (startCut, user 2026-11-21: it left black
 * at the start).
 *
 * The stretch to cut, in timeline ms, or null to leave an empty space as before:
 *  - only parts of the main row after it, all empty spaces (or none): it is the last part with video
 *  - nothing plays there on another row or on top — a video or photo on a row, a video in a window, a
 *    text or photo that isn't held to the clip's end — nor past the main row's end (the room kept after
 *    it for such things): then the stretch is kept, as an empty space, so what plays there keeps its time
 *
 * Texts and photos held to the clip's end (`pinnable` reaching it: the brand kit's logo over the whole
 * clip or its last seconds, a closing line) don't keep it: they go along with the end (pinToEdges) —
 * user 2026-11-21: with the kit's logo on, deleting the last part never shortened the clip.
 */
export function endCut(opts: {
  segments: SegmentLocal[]
  mainVideoId: string | null | undefined
  /** Videos in a window, and anything else on top that keeps its time: everything that plays over the clip at a time */
  onTop: ReadonlyArray<{ start_ms: number; end_ms: number }>
  /** Texts and photos on top: these keep their time too, unless held to the clip's end (they go with it) */
  pinnable?: ReadonlyArray<{ start_ms: number; end_ms: number }>
  /** A video or photo on a row (not the main row) */
  isShot: (s: SegmentLocal) => boolean
  /** The room kept after the main row for things that reach past it (EditorShell isTail) */
  isTail: (s: SegmentLocal) => boolean
  /** The main-row part being deleted (an empty space at the end too: the room it keeps is cut once nothing plays there) */
  partId: string
}): { start: number; end: number } | null {
  const { segments, mainVideoId, onTop, isShot, isTail, partId } = opts
  if (segments.some(isTail)) return null
  const main = mainRow(segments, isShot, isTail)
  const i = main.findIndex(s => s.id === partId)
  if (i < 0) return null
  const part = main[i]
  if (!main.slice(i + 1).every(s => isGapPart(s, mainVideoId))) return null
  const end = Math.max(...main.map(s => s.end_ms))
  // (held to the end: it goes along with it, so it keeps nothing here)
  const keeps = [...onTop, ...(opts.pinnable ?? []).filter(o => o.end_ms < end - 1)]
  const covered = coveredBy(segments.filter(isShot), keeps)
  if (covered(part.start_ms, end)) return null
  // Empty spaces just before it, touching it, with nothing playing on them, go too
  let start = part.start_ms
  for (let k = i - 1; k >= 0; k--) {
    const s = main[k]
    if (!isGapPart(s, mainVideoId) || Math.abs(s.end_ms - start) > 1 || covered(s.start_ms, s.end_ms)) break
    start = s.start_ms
  }
  return end - start > 0 ? { start, end } : null
}

/**
 * Deleting the main video's FIRST part (only empty spaces before it, or none): the clip starts after it
 * instead of with black (user, 2026-11-21), with the empty spaces just after it — as endCut does at the
 * end. Null (an empty space, as before) when something plays there that keeps its time: a video on a
 * row, a video in a window, a text or photo not held to the clip's start (the hook title, held to it,
 * goes along with the start: pinToEdges).
 */
export function startCut(opts: Omit<Parameters<typeof endCut>[0], 'isTail'> & { isTail?: (s: SegmentLocal) => boolean }): { start: number; end: number } | null {
  const { segments, mainVideoId, onTop, isShot, partId } = opts
  const isTail = opts.isTail ?? (() => false)
  const main = mainRow(segments, isShot, isTail)
  const i = main.findIndex(s => s.id === partId)
  if (i < 0) return null
  const part = main[i]
  if (!main.slice(0, i).every(s => isGapPart(s, mainVideoId))) return null
  const start = Math.min(...main.map(s => s.start_ms))
  const keeps = [...onTop, ...(opts.pinnable ?? []).filter(o => o.start_ms > start + 1)]
  const covered = coveredBy(segments.filter(isShot), keeps)
  if (covered(start, part.end_ms)) return null
  // Empty spaces just after it, touching it, with nothing playing on them, go too
  let end = part.end_ms
  for (let k = i + 1; k < main.length; k++) {
    const s = main[k]
    if (!isGapPart(s, mainVideoId) || Math.abs(s.start_ms - end) > 1 || covered(s.start_ms, s.end_ms)) break
    end = s.end_ms
  }
  return end - start > 0 ? { start, end } : null
}

/**
 * After the clip's own start or end was cut (a part deleted there, `[` / `]`, an edge dragged in), the
 * texts and photos held to that edge stay held to it, as long as they were (never longer than the clip):
 * the brand kit's logo over its first or last seconds, the hook title, a closing line. Cut out with the
 * stretch they'd be gone — the logo vanished (user, 2026-11-21). One over the whole clip covers the whole
 * clip again. `before`: as they were; `after`: as the cut left them (a missing one is put back). Timeline
 * ms; `lengthBefore` / `lengthAfter`: the clip's length either side of the cut [a, b).
 */
export function pinToEdges<T extends { id: string; start_ms: number; end_ms: number }>(
  before: readonly T[], after: readonly T[], a: number, b: number, lengthBefore: number, lengthAfter: number,
): T[] {
  const atStart = a <= 1, atEnd = b >= lengthBefore - 1
  if ((!atStart && !atEnd) || lengthAfter <= 0) return after as T[]
  const placed = new Map<string, [number, number]>()
  for (const o of before) {
    const fromStart = atStart && o.start_ms <= 1, toEnd = atEnd && o.end_ms >= lengthBefore - 1
    if (!fromStart && !toEnd) continue
    const len = Math.min(o.end_ms - o.start_ms, lengthAfter)
    placed.set(o.id, fromStart && toEnd ? [0, lengthAfter] : fromStart ? [0, len] : [lengthAfter - len, lengthAfter])
  }
  if (!placed.size) return after as T[]
  const out = after.map(o => { const p = placed.get(o.id); return p ? { ...o, start_ms: p[0], end_ms: p[1] } : o })
  for (const o of before) {
    const p = placed.get(o.id)
    if (p && !after.some(x => x.id === o.id)) out.push({ ...o, start_ms: p[0], end_ms: p[1] })
  }
  return out
}

/** The parts of the main row (not videos on rows, not the room after it), in time order */
function mainRow(segments: SegmentLocal[], isShot: (s: SegmentLocal) => boolean, isTail: (s: SegmentLocal) => boolean) {
  return segments.filter(s => !isShot(s) && !isTail(s)).sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms)
}

/** Whether a video on a row, or something on top that keeps its time, plays anywhere over [a, b) */
function coveredBy(shots: SegmentLocal[], keeps: ReadonlyArray<{ start_ms: number; end_ms: number }>) {
  return (a: number, b: number) => shots.some(s => s.start_ms < b && s.end_ms > a) || keeps.some(o => o.start_ms < b && o.end_ms > a)
}
