import type { AudioTrack, FrameHold, SegmentLocal } from '@chai-cut/shared'
import { getBoxPositionAtLerp } from '@/lib/interpolation'
import { frameHeldBefore, isMainHold } from './frames'
import { addedVideoBox, isGapPart } from './visibility'
import type { KeyframeMap } from './store'
import { isMainAudioTrack, type TimedState } from './trimState'

// ── Inserted videos ("put a video in between", like CapCut) ───────────────────
// An inserted video is a part of the main row of its own: the main video stops where it goes in,
// the inserted video plays, and the main video carries on from where it stopped — everything
// after it in the clip moves later by its length, and the clip gets that much longer.
//
// It is saved as a section whose crop box shows the other video (as B-roll does) and whose
// video_offset_ms says where the main video stands still meanwhile (clip-relative ms of the main
// video). That marks it as inserted, not a video on top. Every other time stays timeline time;
// the export reads the main video's position of each section from it (render.ts, render.py).

/** A video put in between: on the timeline [at, at + ms), the main video held at `hold` (clip ms of the main video) */
export interface InsertSpan { id: string; at: number; ms: number; hold: number }

/** Whether `seg` is an inserted video (not a video on top, not a part of the main video) */
export function isInsert(seg: SegmentLocal, mainVideoId: string | null | undefined): boolean {
  return seg.video_offset_ms != null && !!addedVideoBox(seg, mainVideoId)
}

/** The inserted videos of a clip, in time order */
export function insertsOf(segments: SegmentLocal[], mainVideoId: string | null | undefined): InsertSpan[] {
  return segments
    .filter(s => isInsert(s, mainVideoId) && s.end_ms > s.start_ms)
    .map(s => ({ id: s.id, at: s.start_ms, ms: s.end_ms - s.start_ms, hold: s.video_offset_ms as number }))
    .sort((a, b) => a.at - b.at)
}

/** How close before the main video's end a video dropped on a row still goes on after it (ms) */
export const AFTER_MAIN_SNAP_MS = 800

/**
 * Whether a video dropped at `atMs` on `lane` goes onto the end of the main row (`mainEnd`: where its
 * last part ends): dropped on the main row or a row of videos, at that end or past it. Nothing of the
 * main video plays there, so on top each video would only step a row further down with no cut
 * between them for a transition; on the main row they meet, as on CapCut's main track.
 */
export function goesAfterMain(atMs: number, lane: string | null | undefined, mainEnd: number): boolean {
  return (lane === 'main' || (!!lane && /^track-(\d+|new|below)$/.test(lane))) && atMs >= mainEnd - AFTER_MAIN_SNAP_MS
}

/** How much the inserted videos add to the clip (ms) */
export const insertedMs = (inserts: InsertSpan[]) => inserts.reduce((t, i) => t + i.ms, 0)

/** The insert playing at timeline `t`, if any */
export const insertAt = (inserts: InsertSpan[], t: number) => inserts.find(i => t >= i.at && t < i.at + i.ms) ?? null

/** Where the main video is at timeline `t` (clip-relative ms of the main video); inside an insert: where it is held */
export function videoAt(inserts: InsertSpan[], t: number): number {
  let before = 0
  for (const i of inserts) {
    if (t < i.at) break
    if (t < i.at + i.ms) return i.hold
    before += i.ms
  }
  return t - before
}

/**
 * The timeline time where the main video shows its moment `v` (clip-relative ms). A moment where an
 * insert goes in is shown after it (the main video carries on from there).
 */
export function timelineAt(inserts: InsertSpan[], v: number): number {
  let t = v
  for (const i of inserts) if (i.hold <= v) t += i.ms
  return t
}

/**
 * Timeline [at, at + d) opened up for a video put in there: what starts at or after `at` moves
 * later by d; a part of the main row running across `at` is cut in two there (the second half
 * shows the main video from the same moment on, after the gap); text, photos and music running
 * across it stay on through the gap (they get longer); the main video's own sound (detached) is
 * cut in two like the picture. A transition after a section that was cut stays at its end.
 * `newId` makes the ids of second halves.
 */
export function rippleInsert(state: TimedState, at: number, d: number, newId: () => string = () => crypto.randomUUID()): TimedState {
  if (!(d > 0)) return state
  const later = (t: number) => (t >= at ? t + d : t)
  const keyframes: KeyframeMap = {}
  const renamed: Record<string, string> = {}
  const segments: SegmentLocal[] = []
  for (const seg of state.segments) {
    if (seg.start_ms >= at) {
      segments.push(shiftSeg(seg, d))
      for (const box of seg.crop_boxes) keyframes[box.id] = (state.keyframes[box.id] ?? []).map(k => ({ ...k, t_ms: k.t_ms + d }))
      continue
    }
    if (seg.end_ms <= at) {
      segments.push(seg)
      for (const box of seg.crop_boxes) if (state.keyframes[box.id]) keyframes[box.id] = state.keyframes[box.id]
      continue
    }
    // Runs across: cut in two, the second half after the gap
    const rightId = newId()
    renamed[seg.id] = rightId
    const into = at - seg.start_ms
    const left: SegmentLocal = {
      ...seg, end_ms: at,
      frame: seg.frame?.items ? { ...seg.frame, items: seg.frame.items.filter(it => it.start_ms < at).map(it => ({ ...it, end_ms: Math.min(it.end_ms, at) })) } : seg.frame,
    }
    const right: SegmentLocal = {
      ...seg, id: rightId, start_ms: at + d, end_ms: seg.end_ms + d, sort_order: seg.sort_order + 0.5,
      frame: seg.frame?.items
        ? { ...seg.frame, items: seg.frame.items.filter(it => it.end_ms > at).map(it => ({
            ...it, id: newId(), start_ms: Math.max(it.start_ms, at) + d, end_ms: it.end_ms + d,
            ...(it.kind === 'video' && it.start_ms < at ? { source_offset_ms: (it.source_offset_ms ?? 0) + (at - it.start_ms) } : {}),
          })) }
        : seg.frame,
      crop_boxes: seg.crop_boxes.map(box => ({ ...box, id: newId(), source_offset_ms: (box.source_offset_ms ?? 0) + into * (box.source_video_id || box.image_path ? 1 : speedOf(seg)) })),
    }
    segments.push(left, right)
    seg.crop_boxes.forEach((box, bi) => {
      const kfs = [...(state.keyframes[box.id] ?? [])].sort((a, b) => a.t_ms - b.t_ms)
      const rightBox = right.crop_boxes[bi]
      // Each half keeps the view it had on its side of the cut
      const posAt = kfs.length ? getBoxPositionAtLerp(at, kfs) : null
      keyframes[box.id] = kfs.filter(k => k.t_ms < at)
      if (posAt && !keyframes[box.id].length) keyframes[box.id] = [{ id: newId(), box_id: box.id, t_ms: seg.start_ms, ...getBoxPositionAtLerp(seg.start_ms, kfs) }]
      keyframes[rightBox.id] = [
        ...(posAt ? [{ id: newId(), box_id: rightBox.id, t_ms: at + d, ...posAt }] : []),
        ...kfs.filter(k => k.t_ms > at).map(k => ({ ...k, id: newId(), box_id: rightBox.id, t_ms: k.t_ms + d })),
      ]
    })
  }

  const audioTracks = state.audioTracks.flatMap((t): AudioTrack[] => {
    const s = t.start_ms, e = t.end_ms ?? Infinity
    if (s >= at) return [{ ...t, start_ms: s + d, ...(t.end_ms != null ? { end_ms: t.end_ms + d } : {}) }]
    if (e <= at) return [t]
    if (isMainAudioTrack(t)) {
      // The video's own sound stops with its picture and carries on after the gap
      return [
        { ...t, end_ms: at, fade_out: false },
        { ...t, id: newId(), start_ms: at + d, ...(t.end_ms != null ? { end_ms: t.end_ms + d } : {}),
          ...(t.offset_ms != null ? { offset_ms: t.offset_ms + (at - s) } : {}), fade_in: false },
      ]
    }
    // Music plays on through the inserted video
    return [{ ...t, ...(t.end_ms != null ? { end_ms: t.end_ms + d } : {}) }]
  })

  return {
    // (each crop box carries its keyframes too, as rippleDelete leaves them)
    segments: segments.sort((a, b) => a.start_ms - b.start_ms || a.sort_order - b.sort_order).map((s, i) => ({
      ...s, sort_order: i,
      crop_boxes: s.crop_boxes.map(box => ({ ...box, keyframes: (keyframes[box.id] ?? []).map(({ t_ms, x, y, w, h }) => ({ t_ms, x, y, w, h })) })),
    })),
    keyframes,
    overlays: state.overlays.map(o => ({ ...o, start_ms: later(o.start_ms), end_ms: o.end_ms > at ? o.end_ms + d : o.end_ms })),
    textOverlays: state.textOverlays.map(o => ({ ...o, start_ms: later(o.start_ms), end_ms: o.end_ms > at ? o.end_ms + d : o.end_ms })),
    audioTracks,
    // (a section cut in two: its transition belongs to its end, now the second half's)
    transitions: state.transitions.map(t => (renamed[t.after_segment_id] ? { ...t, after_segment_id: renamed[t.after_segment_id] } : t)),
  }
}

function shiftSeg(seg: SegmentLocal, d: number): SegmentLocal {
  return {
    ...seg, start_ms: seg.start_ms + d, end_ms: seg.end_ms + d,
    frame: seg.frame?.items ? { ...seg.frame, items: seg.frame.items.map(it => ({ ...it, start_ms: it.start_ms + d, end_ms: it.end_ms + d })) } : seg.frame,
  }
}

/**
 * Everything on the timeline from `from` on moved by `d` (a freeze added, resized or removed): what
 * runs across `from` gets longer or shorter and stays one piece. `keepAt`: what starts exactly at
 * `from` stays there and gets longer (a freeze at the very start of a video). Moved earlier, what's in
 * the time taken out is pulled to its edge, and goes if nothing of it is left.
 */
export function rippleFreeze(state: TimedState, from: number, d: number, keepAt = false): TimedState {
  const start = (t: number) => (d > 0 ? ((keepAt ? t > from : t >= from) ? t + d : t) : (t >= from ? t + d : Math.min(t, from + d)))
  const end = (t: number) => (d > 0 ? (t > from ? t + d : t) : (t >= from ? t + d : Math.min(t, from + d)))
  const span = <T extends { start_ms: number; end_ms: number }>(x: T): T => ({ ...x, start_ms: start(x.start_ms), end_ms: end(x.end_ms) })
  const keyframes: KeyframeMap = {}
  for (const [id, kfs] of Object.entries(state.keyframes)) {
    const at = new Map(kfs.map(k => [start(k.t_ms), k] as const))
    keyframes[id] = [...at].map(([t_ms, k]) => ({ ...k, t_ms })).sort((a, b) => a.t_ms - b.t_ms)
  }
  const segments = state.segments.map(s => ({
    ...span(s),
    crop_boxes: s.crop_boxes.map(box => ({ ...box, keyframes: (keyframes[box.id] ?? []).map(({ t_ms, x, y, w, h }) => ({ t_ms, x, y, w, h })) })),
    frame: s.frame?.items ? { ...s.frame, items: s.frame.items.map(span).filter(it => it.end_ms > it.start_ms) } : s.frame,
  }))
  const audioTracks = state.audioTracks.flatMap((t): AudioTrack[] => {
    const e = t.end_ms ?? Infinity
    if (isMainAudioTrack(t)) {
      // The video's own sound stops with its picture, and carries on after the freeze
      if (d > 0 && t.start_ms < from && e > from) {
        return [
          { ...t, end_ms: from, fade_out: false },
          { ...t, id: crypto.randomUUID(), start_ms: from + d, ...(t.end_ms != null ? { end_ms: t.end_ms + d } : {}), ...(t.offset_ms != null ? { offset_ms: t.offset_ms + (from - t.start_ms) } : {}), fade_in: false },
        ]
      }
      if (t.start_ms >= from) return [{ ...t, start_ms: t.start_ms + d, ...(t.end_ms != null ? { end_ms: t.end_ms + d } : {}) }]
      return [t]
    }
    return [{ ...t, start_ms: start(t.start_ms), ...(t.end_ms != null ? { end_ms: end(t.end_ms) } : {}) }]
  })
  return {
    ...state, segments, keyframes, audioTracks,
    overlays: state.overlays.map(span).filter(o => o.end_ms > o.start_ms),
    textOverlays: state.textOverlays.map(span).filter(o => o.end_ms > o.start_ms),
  }
}

/**
 * The clip with one of a frame's freezes changed. `i` < 0: `h` added; `h` null: freeze `i` removed;
 * else freeze `i` is now `h`. The time is added or taken back; the freezes after it keep their place in the video.
 */
export function freezeChanged(state: TimedState, segId: string, i: number, h: FrameHold | null): TimedState {
  const seg = state.segments.find(x => x.id === segId)
  if (!seg) return state
  const holds = seg.frame?.freeze?.holds ?? []
  const old = holds[i]
  if (i < 0 ? !h : !old) return state
  const main = isMainHold(i < 0 ? (h as FrameHold) : old)
  const end = seg.end_ms
  // On the main video the time goes in where it stops. On another layer the main video plays straight
  // on, so what's on the timeline stays with it: the time goes in at the end of the part
  const moved = (at: number, d: number, keepAt = false) => (main ? rippleFreeze(state, at, d, keepAt) : rippleFreeze(state, d > 0 ? end - 1 : end, d))
  let out = state, next: FrameHold[], d = 0
  if (i < 0) {
    const add = h as FrameHold
    d = add.len_ms
    out = moved(seg.start_ms + add.at_ms, d, true)
    next = [...holds.map(x => (main && x.at_ms >= add.at_ms ? { ...x, at_ms: x.at_ms + d } : x)), add]
  } else if (!h) {
    d = -old.len_ms
    out = moved(seg.start_ms + old.at_ms + old.len_ms, d)
    next = holds.filter((_, j) => j !== i).map(x => (main && x.at_ms > old.at_ms ? { ...x, at_ms: x.at_ms + d } : x))
  } else {
    d = h.len_ms - old.len_ms
    if (d) out = moved(seg.start_ms + old.at_ms + old.len_ms, d)
    next = holds.map((x, j) => (j === i ? { ...old, ...h } : main && x.at_ms > old.at_ms ? { ...x, at_ms: x.at_ms + d } : x))
  }
  next.sort((a, b) => a.at_ms - b.at_ms)
  const layer = i < 0 ? h?.on : old.on
  return {
    ...out,
    segments: out.segments.map(s => {
      if (s.id !== segId) return s
      // (a video ending before the part does gets its added time itself, up to what comes next on its lane)
      const items = main || !d || !s.frame?.items ? s.frame?.items : s.frame.items.map(it => {
        // (reached the part's end before this change: the ripple has already moved it)
        if (it.id !== layer || (seg.frame?.items?.find(x => x.id === layer)?.end_ms ?? end) >= end - 1) return it
        const after = s.frame?.items?.filter(x => x.lane === it.lane && x.start_ms >= it.end_ms).map(x => x.start_ms) ?? []
        return { ...it, end_ms: Math.max(it.start_ms + 1, Math.min(it.end_ms + d, s.end_ms, ...after)) }
      })
      return { ...s, frame: { ...s.frame, ...(items ? { items } : {}), freeze: next.length ? { ...s.frame?.freeze, holds: next } : null } }
    }),
  }
}

// ── The clip as pieces (a clip with videos put in between) ────────────────────
// With a video put in between, each part of the main row says itself which moment of the main
// video it starts at (its main crop box's source_offset_ms, clip-relative ms of the main video).
// So a part can also skip video — cut from its edge — and a part cut back can show it again: the
// clip plays its parts one after another, holding the main video during an inserted one.

/**
 * A stretch of the timeline [at, at + ms): the main video from `from` on — at `speed` (1 when
 * not given: `ms` of timeline is `ms · speed` of video) — or held at `hold` while an inserted video plays
 */
export interface Piece {
  id: string; at: number; ms: number; from?: number; hold?: number; speed?: number; /** its sound's pitch follows the speed */ pitch?: boolean
  /** The empty space a part left in the main row (visibility.ts isGapPart): nothing of it is seen or heard */
  blank?: boolean
}

/** A part's speed (1 as filmed); never 0 or less */
export const speedOf = (s: { speed?: number | null } | null | undefined) => (s?.speed && s.speed > 0 ? s.speed : 1)
/** How much of the main video a piece plays (ms) */
export const pieceVideoMs = (p: Piece) => p.ms * (p.speed ?? 1)

/** Where in the main video a part of the main row starts (clip-relative ms), null when it shows none */
export function mainFrom(seg: SegmentLocal): number | null {
  const box = seg.crop_boxes.find(b => !b.source_video_id && !b.image_path)
  return box ? Math.max(0, box.source_offset_ms ?? 0) : null
}

/**
 * The clip's pieces, in time order, from its main row (the parts, not the videos on top): an
 * inserted video holds the main video; any other part plays it from its own moment. Time no part
 * covers (default framing) carries the video on from the piece before it.
 *
 * `gapsHold`: the empty space a part left holds the main video too (the player's clock runs on
 * its own there, as in the room after the main video) — the part moved away plays that moment
 * where it is now, so the moment is seen in one place only. Otherwise the space runs its moment, blank.
 */
export function piecesOf(segments: SegmentLocal[], mainVideoId: string | null | undefined, isLayer: (s: SegmentLocal) => boolean, gapsHold = false): Piece[] {
  const rows = segments.filter(s => !isLayer(s) && s.end_ms > s.start_ms).sort((a, b) => a.start_ms - b.start_ms)
  const out: Piece[] = []
  let cursor = 0, videoNow = 0
  for (const s of rows) {
    if (s.start_ms > cursor + 1) {
      out.push({ id: `gap-${cursor}`, at: cursor, ms: s.start_ms - cursor, from: videoNow })
      videoNow += s.start_ms - cursor
    }
    const at = Math.max(cursor, s.start_ms), ms = s.end_ms - at
    if (ms <= 0) continue
    const blank = isGapPart(s, mainVideoId)
    if (isInsert(s, mainVideoId)) out.push({ id: s.id, at, ms, hold: s.video_offset_ms as number })
    else if (blank && gapsHold) out.push({ id: s.id, at, ms, hold: mainFrom(s) ?? videoNow, blank })
    else if (s.frame?.freeze?.holds?.length) {
      // A part with freezes: the main video stops for its own and carries on from the same moment.
      // Another layer's add time the main video doesn't play through: it holds its last picture for that
      const holds = s.frame.freeze.holds
      const added = holds.filter(h => !isMainHold(h)).reduce((sum, h) => sum + h.len_ms, 0)
      const playEnd = Math.max(at, s.end_ms - added)
      let t = at, v = (mainFrom(s) ?? videoNow) + (at - s.start_ms) - frameHeldBefore(s.frame, at - s.start_ms), n = 0
      for (const h of holds.filter(isMainHold)) {
        const a = Math.max(t, s.start_ms + h.at_ms), b = Math.min(playEnd, s.start_ms + h.at_ms + h.len_ms)
        if (b <= a) continue
        if (a > t) { out.push({ id: n ? `${s.id}~${n}` : s.id, at: t, ms: a - t, from: v }); v += a - t; n++ }
        out.push({ id: `${s.id}~freeze${n++}`, at: a, ms: b - a, hold: v })
        t = b
      }
      if (playEnd > t) { out.push({ id: n ? `${s.id}~${n}` : s.id, at: t, ms: playEnd - t, from: v }); v += playEnd - t; n++ }
      if (s.end_ms > playEnd) out.push({ id: `${s.id}~freeze${n}`, at: playEnd, ms: s.end_ms - playEnd, hold: v })
      videoNow = v
    } else {
      const speed = speedOf(s)
      const from = (mainFrom(s) ?? videoNow) + (at - s.start_ms) * speed
      out.push({ id: s.id, at, ms, from, ...(speed !== 1 ? { speed } : {}), ...(s.pitch ? { pitch: true } : {}), ...(blank ? { blank } : {}) })
      videoNow = from + ms * speed
    }
    cursor = at + ms
  }
  return out
}

/** How long the pieces play */
export const piecesLength = (pieces: Piece[]) => (pieces.length ? pieces[pieces.length - 1].at + pieces[pieces.length - 1].ms : 0)

/** The piece playing at timeline `t` (the last one at or past the end) */
export function pieceAt(pieces: Piece[], t: number): Piece | null {
  for (const p of pieces) if (t < p.at + p.ms) return t >= p.at ? p : null
  return pieces[pieces.length - 1] ?? null
}

/** Where the main video is at timeline `t` (clip-relative ms); in an inserted video: where it waits */
export function videoAtPieces(pieces: Piece[], t: number): number {
  const p = pieceAt(pieces, t)
  if (!p) return Math.max(0, t)
  return p.hold != null ? p.hold : (p.from ?? 0) + Math.min(p.ms, Math.max(0, t - p.at)) * (p.speed ?? 1)
}

/** Where on the timeline the main video shows its moment `v` (clip ms): a moment cut out lands where the clip goes on after it */
export function timelineAtPieces(pieces: Piece[], v: number): number {
  // (where it is seen first: empty space a part left still runs its moment, and the part has it now)
  for (const blank of [false, true]) {
    for (const p of pieces) if (!!p.blank === blank && p.from != null && v >= p.from && v < p.from + pieceVideoMs(p)) return p.at + (v - p.from) / (p.speed ?? 1)
  }
  const next = pieces.find(p => p.from != null && p.from > v)
  return next ? next.at : piecesLength(pieces)
}

/**
 * Where a word of the main video (its moment [s, e), clip ms) is heard on the timeline: where it is
 * seen first (as timelineAtPieces), then again in every other piece that plays it (a duplicated
 * part says it again), each kept to its piece. The first one is no longer than the word lasts there
 * (a part played again right after: the word at its end doesn't run on over the copy). [start, end)s.
 */
export function wordPlaces(pieces: Piece[], s: number, e: number): [number, number][] {
  const mid = (s + e) / 2
  const plays = (p: Piece) => p.from != null && !p.blank && mid >= p.from && mid < p.from + pieceVideoMs(p)
  const a = timelineAtPieces(pieces, s)
  const sp = pieceAt(pieces, a)?.speed ?? 1
  const out: [number, number][] = [[a, Math.max(a + 1, Math.min(timelineAtPieces(pieces, e), a + (e - s) / sp))]]
  for (const p of pieces.filter(plays).slice(1)) {
    const k = p.speed ?? 1
    const from = Math.max(p.at, p.at + (s - p.from!) / k), to = Math.min(p.at + p.ms, p.at + (e - p.from!) / k)
    out.push([from, Math.max(from + 1, to)])
  }
  return out
}

/**
 * Timeline [a, b) cut out of a clip of pieces, the gap closed (as rippleDelete does), with every
 * part keeping which moment of the main video it starts at — so what comes after a cut part
 * starts later in the video, skipping the piece cut. Parts running across a or b are cut in two first.
 */
export function rippleCut(state: TimedState, a: number, b: number, rippleDelete: (s: TimedState, a: number, b: number) => TimedState, newId: () => string = () => crypto.randomUUID()): TimedState {
  if (!(b > a)) return state
  // Cut in two where a part runs across a or b (each half from its own moment of the video)
  const split = (st: TimedState, t: number): TimedState => {
    const segments: SegmentLocal[] = []
    const keyframes = { ...st.keyframes }
    const renamed: Record<string, string> = {}
    for (const s of st.segments) {
      if (!(s.start_ms < t && s.end_ms > t)) { segments.push(s); continue }
      const into = t - s.start_ms
      const right: SegmentLocal = {
        ...s, id: newId(), start_ms: t, sort_order: s.sort_order + 0.5,
        // (a box of the main video moves on by as much video as the part plays before the cut)
        crop_boxes: s.crop_boxes.map(box => ({ ...box, id: newId(), source_offset_ms: (box.source_offset_ms ?? 0) + into * (box.source_video_id || box.image_path ? 1 : speedOf(s)) })),
        frame: s.frame?.items ? { ...s.frame, items: s.frame.items.filter(it => it.end_ms > t).map(it => ({ ...it, id: newId(), start_ms: Math.max(it.start_ms, t) })) } : s.frame,
      }
      renamed[s.id] = right.id
      s.crop_boxes.forEach((box, i) => {
        const kfs = [...(st.keyframes[box.id] ?? [])].sort((x, y) => x.t_ms - y.t_ms)
        const at = kfs.length ? getBoxPositionAtLerp(t, kfs) : null
        keyframes[box.id] = kfs.filter(k => k.t_ms < t)
        if (!keyframes[box.id].length && kfs.length) keyframes[box.id] = [{ ...kfs[0], t_ms: s.start_ms }]
        const rb = right.crop_boxes[i]
        keyframes[rb.id] = [...(at ? [{ id: newId(), box_id: rb.id, t_ms: t, ...at }] : []), ...kfs.filter(k => k.t_ms > t).map(k => ({ ...k, id: newId(), box_id: rb.id }))]
      })
      segments.push({ ...s, end_ms: t, frame: s.frame?.items ? { ...s.frame, items: s.frame.items.filter(it => it.start_ms < t).map(it => ({ ...it, end_ms: Math.min(it.end_ms, t) })) } : s.frame }, right)
    }
    // (a transition at a part's end stays at its end: the second half's)
    return { ...st, segments, keyframes, transitions: st.transitions.map(x => (renamed[x.after_segment_id] ? { ...x, after_segment_id: renamed[x.after_segment_id] } : x)) }
  }
  const before = split(split(state, a), b)
  const offsets = new Map<string, number>()
  for (const s of before.segments) for (const box of s.crop_boxes) if (!box.source_video_id && !box.image_path) offsets.set(box.id, box.source_offset_ms ?? 0)
  const after = rippleDelete(before, a, b)
  // rippleDelete moves a part's main-video position with its start (for removed parts saved in
  // source time); here each part keeps its own moment of the video
  return {
    ...after,
    segments: after.segments.map(s => ({
      ...s, crop_boxes: s.crop_boxes.map(box => (offsets.has(box.id) ? { ...box, source_offset_ms: offsets.get(box.id)! } : box)),
    })),
  }
}
