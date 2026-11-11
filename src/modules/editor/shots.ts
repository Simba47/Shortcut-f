import type { CropBoxLocal, SegmentLocal } from '@chai-cut/shared'
import { getBoxPositionAtLerp } from '@/lib/interpolation'
import { isFrameLayout } from './frames'
import { addedVideoBox, isGapPart, isMainShot } from './visibility'

// ── Videos on top (B-roll) ────────────────────────────────────────────────────
// In the editor a video put over the clip is a LAYER: it sits on its own lane over the sections,
// and the sections under it stay whole — their format, their views, their edges. (It used to be
// a section of its own that cut the section under it in two.)
//
// Everything that plays or exports a saved clip — the worker, the clip board, an older editor —
// expects ONE row of parts that never overlap: a video on top as a part of its own, the section
// under it cut around it. So the layers are flattened into that row:
//   • flattenShots:   layers → the single row (the preview draws it, and it is what is saved)
//   • toSaved:        the row, plus a note of the sections that were cut (saved beside it)
//   • restoreLayers:  saved rows + that note → the layers again
//   • healLegacy:     rows saved before layers (no note): the section before a video takes the
//                     time under it back, and joins up with the part after it

type Main = string | null | undefined

/**
 * A video put over the clip (B-roll): a layer over the sections. An inserted video (it has
 * video_offset_ms: the main video waits meanwhile, inserts.ts) is a part of the main row instead.
 */
export const isShot = (seg: SegmentLocal, mainVideoId: Main) => !!addedVideoBox(seg, mainVideoId) && seg.video_offset_ms == null

const byStart = (a: SegmentLocal, b: SegmentLocal) => a.start_ms - b.start_ms || a.sort_order - b.sort_order

/**
 * A new id made from another, the same every time (rows that are parts of one section keep
 * their ids from save to save). Shaped like the ids the database makes.
 */
export function derivedId(base: string, n: number): string {
  // cyrb128: four 32-bit hashes of the text
  const text = `${base}#${n}`
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  const hex = [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** The stretch [a, b) of a section or video: what it shows from a on (each slot's video carries on from there) */
function part(of: SegmentLocal, a: number, b: number): SegmentLocal {
  const shift = a - of.start_ms
  return {
    ...of, start_ms: a, end_ms: b,
    crop_boxes: shift ? of.crop_boxes.map(box => ({ ...box, source_offset_ms: (box.source_offset_ms ?? 0) + shift })) : of.crop_boxes,
  }
}

/** The empty stretch after the main video, for what's on top to run on: a video put in at the end, hidden and muted (EditorShell's tail) */
const isTailSection = (s: SegmentLocal) => s.video_offset_ms != null && !!s.hidden && !!s.crop_boxes[0]?.hidden && !!s.crop_boxes[0]?.source_video_id

/** How much of [a, b) lies in sections for which `is` holds */
function shareUnder(sections: SegmentLocal[], a: number, b: number, is: (s: SegmentLocal) => boolean): number {
  if (!(b > a)) return 0
  let ms = 0
  for (const s of sections) if (is(s)) ms += Math.max(0, Math.min(b, s.end_ms) - Math.max(a, s.start_ms))
  return ms / (b - a)
}

/**
 * The clip as it plays: every section cut where a video plays over it, the videos in between, in
 * time order, nothing overlapping. Where two videos overlap, the one on the higher lane is on top
 * (on the same lane, the one that starts later) — but a hidden video is see-through: any shown
 * video under it is on top of it, and it only has the time no shown video plays in.
 *
 * A part that isn't the last part of its section keeps the section's id while drawing (`forSave`
 * off: its crop boxes are the section's own, so the preview reads and edits the section's views).
 * Saved (`forSave`), each row needs its own id: the last part keeps the section's (a transition
 * after the section stays with it), the parts before it get ids made from it; a part that starts
 * later than its section gets its view at that moment as its first keyframe, as the export expects.
 *
 * "Mute the main video" and "hide the main video" on a section still count under a video on top:
 * the video's row carries them (the export reads them from the row that plays).
 *
 * Stacked as the timeline shows them, as in Premiere / Resolve: a row higher up covers the ones under
 * it. `below` rows of videos sit under the main video (tracks 0 … below-1): the main video covers
 * them, and they show where it isn't — after its end, from the moment they've reached there, and
 * through its parts that are hidden or deleted (a hidden part is see-through, as the eye on a track
 * in Premiere: user, 2026-11-06 — where nothing is under it, it stays black). The empty stretch after
 * the main video (the editor's "tail") is under everything.
 *
 * A part of the main video on a row (visibility.ts isMainShot) is a part of the main video again
 * where it shows: the main video from its moment (`mainStart`: where the clip starts in the video,
 * its box is in the video's own time), with its own sound — so the main player, the export and the
 * clip board play it as any other part. Hidden, it isn't there at all.
 */
export function flattenShots(segments: SegmentLocal[], mainVideoId: Main, forSave = false, below = 0, mainStart = 0): SegmentLocal[] {
  if (segments.some(s => hiddenMainShot(s, mainVideoId))) segments = segments.filter(s => !hiddenMainShot(s, mainVideoId))
  // Placed lowest first: each one placed cuts the ones before it (so the last placed is on top)
  const shown = (s: SegmentLocal) => (s.crop_boxes[0]?.hidden ? 0 : 1)
  const shots = segments.filter(s => isShot(s, mainVideoId) && s.end_ms > s.start_ms)
    .sort((a, b) => shown(a) - shown(b) || (a.track ?? 0) - (b.track ?? 0) || byStart(a, b))
  if (!shots.length) return segments
  const sections = segments.filter(s => !isShot(s, mainVideoId))
  // A part of the main video on a row past the end of the main row: the room up to it is empty
  // space of the main row (else the main video would carry on there, seen)
  const mainShots = shots.filter(s => isMainShot(s, mainVideoId))
  if (mainShots.length) {
    const rowEnd = Math.max(0, ...sections.map(s => s.end_ms)), reach = Math.max(...mainShots.map(s => s.end_ms))
    if (reach > rowEnd + 1) sections.push(roomFill(derivedId(`${mainShots[0].id}:room`, 0), rowEnd, reach))
  }
  const under = shots.filter(s => (s.track ?? 0) < below), over = shots.filter(s => (s.track ?? 0) >= below)
  let parts: { seg: SegmentLocal; of: SegmentLocal }[] = []
  const lay = (item: SegmentLocal) => {
    parts = parts.flatMap(p => {
      if (p.seg.end_ms <= item.start_ms || p.seg.start_ms >= item.end_ms) return [p]
      const out: typeof parts = []
      if (p.seg.start_ms < item.start_ms) out.push({ of: p.of, seg: part(p.of, p.seg.start_ms, item.start_ms) })
      if (p.seg.end_ms > item.end_ms) out.push({ of: p.of, seg: part(p.of, item.end_ms, p.seg.end_ms) })
      return out
    })
    parts.push({ seg: item, of: item })
  }
  // Bottom up: the empty stretch after the main video and the gaps in it (parts deleted in the
  // editor: what's under the main video shows through them), the videos under it, the main video,
  // the videos over it
  const gap = (s: SegmentLocal) => isGapPart(s, mainVideoId)
  // (a part with the main video hidden, a deleted part among them: the rows under it show through;
  // a frame is never hidden as a whole, and a part showing an added video shows that)
  const seeThrough = (s: SegmentLocal) => gap(s) || (!!s.hidden && !isFrameLayout(s.layout) && !addedVideoBox(s, mainVideoId))
  for (const sec of sections.filter(x => isTailSection(x) || seeThrough(x))) lay(sec)
  for (const shot of under) lay(shot)
  for (const sec of sections.filter(x => !isTailSection(x) && !seeThrough(x))) lay(sec)
  for (const shot of over) lay(shot)

  const groups = new Map<string, typeof parts>()
  for (const p of parts) groups.set(p.of.id, [...(groups.get(p.of.id) ?? []), p])
  const out: SegmentLocal[] = []
  for (const group of groups.values()) {
    group.sort((a, b) => a.seg.start_ms - b.seg.start_ms)
    group.forEach((p, i) => {
      let seg = p.seg
      if (isMainShot(p.of, mainVideoId)) seg = asMainPart(seg, mainStart)
      else if (isShot(p.of, mainVideoId)) {
        const muted = shareUnder(sections, seg.start_ms, seg.end_ms, s => !!s.muted) > 0.5
        // (not the empty stretch after the main video, nor a gap: what runs on there isn't hidden by it)
        const hidden = shareUnder(sections, seg.start_ms, seg.end_ms, s => !!s.hidden && !isFrameLayout(s.layout) && !isTailSection(s) && !gap(s)) > 0.5
        seg = { ...seg, muted, hidden }
      }
      if (forSave) {
        const last = i === group.length - 1
        const later = seg.start_ms > p.of.start_ms
        if (!last || later) {
          seg = {
            ...seg,
            ...(last ? {} : { id: derivedId(p.of.id, i) }),
            crop_boxes: seg.crop_boxes.map(box => ({
              ...box,
              ...(last ? {} : { id: derivedId(box.id, i) }),
              ...(later && box.keyframes?.length ? {
                keyframes: [
                  { t_ms: seg.start_ms, ...getBoxPositionAtLerp(seg.start_ms, box.keyframes) },
                  ...box.keyframes.filter(k => k.t_ms > seg.start_ms).map(({ t_ms, x, y, w, h }) => ({ t_ms, x, y, w, h })),
                ],
              } : {}),
            })),
          }
        }
      }
      out.push(seg)
    })
  }
  return out.sort(byStart).map((s, i) => ({ ...s, sort_order: i }))
}

const hiddenMainShot = (s: SegmentLocal, mainVideoId: Main) => isMainShot(s, mainVideoId) && !!s.crop_boxes[0]?.hidden

/** Empty space of the main row over [a, b) (visibility.ts isGapPart), made while flattening: never in the editor's own parts, and not brought back from a save (toSaved: a row that is no part) */
function roomFill(id: string, a: number, b: number): SegmentLocal {
  const view = { x: 0, y: 0, w: 1, h: 1 }
  return {
    id, start_ms: a, end_ms: b, layout: 'vertical', sort_order: 0, hidden: true, muted: true,
    crop_boxes: [{ id: derivedId(id, 1), slot_index: 0, source_video_id: null, source_offset_ms: a, hidden: true, keyframes: [{ t_ms: a, ...view }] } as CropBoxLocal],
  }
}

/**
 * A part of the main video on a row as the part of the main video it plays there (see flattenShots;
 * dragged back onto the main row: place.ts lowerToRow): its moment clip-relative again (`mainStart`:
 * where the clip starts in the video), its switches the part's
 */
export function asMainPart(seg: SegmentLocal, mainStart: number): SegmentLocal {
  const { track: _t, lane: _l, speed: _s, ...rest } = seg
  const box = seg.crop_boxes[0]
  return {
    ...rest, muted: !!box.muted, hidden: !!box.hidden,
    crop_boxes: [{ ...box, source_video_id: null, source_offset_ms: Math.max(0, Math.round((box.source_offset_ms ?? 0) - mainStart)), muted: false, hidden: false }],
  }
}

// ── Saving and loading ────────────────────────────────────────────────────────

/** What is saved beside the rows (clips.layers) to get the layers back */
export interface SavedLayers {
  v: 1
  /** The rows this note belongs to, as "id:start:end": rows changed by anything else (an older editor) make it void */
  rows: string[]
  /** The sections (and videos under another video) that were cut, whole */
  cut: SegmentLocal[]
  /** Ids of the rows that are parts of those */
  parts: string[]
  /** Videos on top added as B-roll (uploaded in the B-roll panel): they stay on the B-roll lane */
  broll?: string[]
  /** Videos on top on a lane above the first (id → lane) */
  tracks?: Record<string, number>
}
// (a part of the main video on a row is always noted whole in `cut`: its row is saved as a plain
// part of the main video, or not at all while it's hidden, and only the note brings it back)

const rowKeys = (rows: SegmentLocal[]) => rows.map(r => `${r.id}:${Math.round(r.start_ms)}:${Math.round(r.end_ms)}`).sort()

/**
 * The layers as they are saved: the single row (see flattenShots) and the note that brings the
 * layers back. `segments` in the times the clip is saved in, each crop box with its keyframes.
 * No video on top = nothing to note (null).
 */
export function toSaved(segments: SegmentLocal[], mainVideoId: Main, below = 0, mainStart = 0): { rows: SegmentLocal[]; layers: SavedLayers | null } {
  const whole = segments.map(s => ({ ...s, start_ms: Math.round(s.start_ms), end_ms: Math.round(s.end_ms) })).filter(s => s.end_ms > s.start_ms)
  if (!whole.some(s => isShot(s, mainVideoId))) return { rows: whole, layers: null }
  const rows = flattenShots(whole, mainVideoId, true, below, mainStart)
  const kept = new Map(rows.map(r => [r.id, r]))
  // Saved whole: its own row has its own times (a video's row may differ in the flags it carries)
  const isWhole = (s: SegmentLocal) => { const r = kept.get(s.id); return !!r && r.start_ms === s.start_ms && r.end_ms === s.end_ms }
  const cut = whole.filter(s => !isWhole(s) || isMainShot(s, mainVideoId))
  const ids = new Set(whole.map(s => s.id))
  const parts = rows.filter(r => !ids.has(r.id) || cut.some(c => c.id === r.id)).map(r => r.id)
  const broll = whole.filter(s => isShot(s, mainVideoId) && s.lane === 'broll').map(s => s.id)
  const tracks = Object.fromEntries(whole.filter(s => isShot(s, mainVideoId) && (s.track ?? 0) > 0).map(s => [s.id, s.track!]))
  return {
    rows,
    layers: {
      v: 1, rows: rowKeys(rows), parts, ...(broll.length ? { broll } : {}), ...(Object.keys(tracks).length ? { tracks } : {}),
      // (image_url is a link that runs out: the row's own is used when the clip is opened)
      cut: cut.map(c => ({ ...c, crop_boxes: c.crop_boxes.map(({ image_url: _url, ...b }) => b) })),
    },
  }
}

/** In time order, numbered in that order */
const inOrder = (segments: SegmentLocal[]) => [...segments].sort(byStart).map((s, i) => ({ ...s, sort_order: i }))

function validLayers(x: unknown): x is SavedLayers {
  const l = x as SavedLayers | null
  return !!l && l.v === 1 && Array.isArray(l.rows) && Array.isArray(l.cut) && Array.isArray(l.parts)
    && l.cut.every(c => !!c && typeof c.id === 'string' && Array.isArray(c.crop_boxes) && Number.isFinite(c.start_ms) && Number.isFinite(c.end_ms))
}

/** A video on top keeps no "main video" switches of its own (its row carried the section's: see flattenShots) */
const plainShot = (s: SegmentLocal, mainVideoId: Main): SegmentLocal => {
  if (!isShot(s, mainVideoId) || !('muted' in s || 'hidden' in s)) return s
  const { muted: _m, hidden: _h, ...rest } = s
  return rest
}

/**
 * Saved rows as the editor's layers. With the note saved beside them (and rows it still belongs
 * to) every section comes back whole, exactly as it was. Otherwise — a clip saved before layers,
 * made by Make my clips, or changed since by an older editor — healLegacy rebuilds what it can.
 * `renamed`: sections that were joined into another (old id → the id that stays), for what
 * points at a section by id (transitions).
 */
export function restoreLayers(rows: SegmentLocal[], layers: unknown, mainVideoId: Main): { segments: SegmentLocal[]; renamed: Record<string, string> } {
  // (parts of the main video on rows are saved as plain parts of it: only the note has them)
  const mainShots = validLayers(layers) && layers.cut.some(c => isMainShot(c, mainVideoId))
  if (!mainShots && !rows.some(r => isShot(r, mainVideoId))) return { segments: rows, renamed: {} }
  // Which videos were added as B-roll (ids stay the same, so this holds even when the rest of the note is void)
  const brollIds = new Set(Array.isArray((layers as SavedLayers | null)?.broll) ? (layers as SavedLayers).broll : [])
  const saved = (layers as SavedLayers | null)?.tracks
  const tracks = saved && typeof saved === 'object' ? saved : {}
  const out = restoreRows(rows, layers, mainVideoId)
  if (!brollIds.size && !Object.keys(tracks).length) return out
  return {
    ...out,
    segments: out.segments.map(s => {
      if (!isShot(s, mainVideoId)) return s
      const t = Number(tracks[s.id])
      return { ...s, ...(brollIds.has(s.id) ? { lane: 'broll' as const } : {}), ...(Number.isInteger(t) && t > 0 ? { track: t } : {}) }
    }),
  }
}

function restoreRows(rows: SegmentLocal[], layers: unknown, mainVideoId: Main): { segments: SegmentLocal[]; renamed: Record<string, string> } {
  if (validLayers(layers)) {
    const now = rowKeys(rows)
    if (now.length === layers.rows.length && now.every((k, i) => k === layers.rows[i])) {
      const parts = new Set(layers.parts)
      const byId = new Map(rows.map(r => [r.id, r]))
      const whole = layers.cut.map((c): SegmentLocal => {
        const row = byId.get(c.id)
        if (!row) return c
        // The row is the fresh copy (its frame, its picture links); the note has its whole time and views
        return {
          ...row, start_ms: c.start_ms, end_ms: c.end_ms,
          crop_boxes: c.crop_boxes.map((b): CropBoxLocal => {
            const url = row.crop_boxes.find(x => x.id === b.id)?.image_url
            return url ? { ...b, image_url: url } : b
          }),
        }
      })
      return { segments: inOrder([...rows.filter(r => !parts.has(r.id)), ...whole].map(s => plainShot(s, mainVideoId))), renamed: {} }
    }
  }
  return healLegacy(rows, mainVideoId)
}

/**
 * Rows from before layers: each video sits in a hole it cut in a section. The section before it
 * takes the time under the video back and, where the part after it is its own continuation,
 * joins up with it (each part keeps its views) — the section is whole again under the video.
 * A video at the very start: the section after it starts under it instead.
 */
export function healLegacy(rows: SegmentLocal[], mainVideoId: Main): { segments: SegmentLocal[]; renamed: Record<string, string> } {
  const shots = rows.filter(r => isShot(r, mainVideoId)).sort(byStart)
  let sections = rows.filter(r => !isShot(r, mainVideoId)).sort(byStart)
  const renamed: Record<string, string> = {}
  const touches = (a: number, b: number) => Math.abs(a - b) <= 1
  const isMain = (b: CropBoxLocal) => !b.source_video_id && !b.image_path

  for (const shot of shots) {
    // Only a hole the video itself cut: nothing under it
    if (sections.some(s => s.start_ms < shot.end_ms - 1 && s.end_ms > shot.start_ms + 1)) continue
    const prev = sections.find(s => touches(s.end_ms, shot.start_ms))
    const next = sections.find(s => touches(s.start_ms, shot.end_ms))
    if (prev) {
      let grown: SegmentLocal = { ...prev, end_ms: shot.end_ms }
      const continues = !!next && next.layout === prev.layout && !isFrameLayout(prev.layout) && !prev.locked && !next.locked
        && prev.crop_boxes.length === next.crop_boxes.length
        && prev.crop_boxes.every(box => {
          const other = next.crop_boxes.find(x => x.slot_index === box.slot_index)
          return !!other && isMain(box) && isMain(other)
            && Math.abs(((box.source_offset_ms ?? 0) + (next.start_ms - prev.start_ms)) - (other.source_offset_ms ?? 0)) <= 2
        })
      if (next && continues) {
        grown = {
          ...grown, end_ms: next.end_ms,
          crop_boxes: prev.crop_boxes.map(box => {
            const other = next.crop_boxes.find(x => x.slot_index === box.slot_index)!
            // The part before keeps its views up to where the part after began, then the part after's
            const mine = (box.keyframes ?? []).filter(k => k.t_ms < next.start_ms - 1)
            const theirs = (other.keyframes ?? []).filter(k => k.t_ms >= next.start_ms)
            const all = box.keyframes ?? []
            const hold = all.length ? getBoxPositionAtLerp(next.start_ms - 1, all) : null
            const first = theirs.length ? getBoxPositionAtLerp(next.start_ms, theirs) : null
            const same = !!hold && !!first && (['x', 'y', 'w', 'h'] as const).every(k => Math.abs(first[k] - hold[k]) < 1e-4)
            const keyframes = [
              ...mine,
              ...(hold && first && !same && next.start_ms - 1 > prev.start_ms ? [{ t_ms: next.start_ms - 1, ...hold }] : []),
              ...theirs,
            ].map(({ t_ms, x, y, w, h }) => ({ t_ms, x, y, w, h })).sort((p, q) => p.t_ms - q.t_ms)
            return { ...box, keyframes: keyframes.length ? keyframes : all }
          }),
        }
        renamed[next.id] = prev.id
        sections = sections.filter(s => s.id !== next.id)
      }
      sections = sections.map(s => (s.id === prev.id ? grown : s))
    } else if (next) {
      const d = shot.start_ms - next.start_ms
      sections = sections.map(s => (s.id !== next.id ? s : {
        ...s, start_ms: shot.start_ms,
        crop_boxes: s.crop_boxes.map(b => (isMain(b) ? { ...b, source_offset_ms: Math.max(0, (b.source_offset_ms ?? 0) + d) } : b)),
      }))
    }
  }
  return { segments: inOrder([...sections, ...shots.map(s => plainShot(s, mainVideoId))]), renamed }
}
