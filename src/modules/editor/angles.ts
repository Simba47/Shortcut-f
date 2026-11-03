import { subjectBoxAt, type SubjectPoint } from './subjects'
import type { Brief } from './briefWiden'

// ── Camera angles (SubjectsPanel) ─────────────────────────────────────────────
// The worker lists the clip's camera angles (a shot, and everywhere it comes back — server
// services/subjects.ts getAngles). Here each becomes a row of the Subjects tool: where the clip, as
// it is now, shows it; who of the marked people is in it; and whether a group is marked on it. An
// angle with neither is "not set": the view there follows whoever is talking, as everywhere.

export interface Angle {
  /** How many people it shows; 0: the other shots (no faces, or too short to be an angle) */
  people: number
  /**
   * A moment that shows it (source ms), and the faces there, left to right (fractions of the frame).
   * `person`: who it is (the worker's face identities) — the same number in every angle they are in;
   * none when the face was too small to tell, or the list is from before identities
   */
  at: number
  faces: Array<{ x: number; y: number; w: number; h: number; person?: number }>
  /** Wherever the clip shows it: [start, end] source ms */
  spans: Array<[number, number]>
  /** Who talks in each of `spans`: talk[i][k] is how long faces[k] talks in spans[i] (ms); none without a transcript */
  talk?: number[][]
  /**
   * Who is in each of `spans` (indexes into `faces`), when not everyone is in every one (the scan, 2026-11-03:
   * a place showing only one man was formatted for the scene's six); none: everyone, everywhere
   */
  present?: number[][]
  /** Someone on screen briefly (~0.5 s, the scan's close looks): Follow widens the view to take them in (briefWiden.ts) */
  brief?: Brief[]
}

/** What a row needs to know of a marked subject */
export interface AngleSubject {
  id: string; label: string; color: string
  mark_ms: number; mark_x: number; mark_y: number
  status: string
  path: SubjectPoint[] | null
  /** A group subject (a marked shot) */
  shot?: { layout: string } | null
}

export interface AngleRow {
  people: number
  at: number
  /**
   * `box.person`: who it is (as Angle's faces) — Auto format marks each person once. `added`: someone
   * marked by hand (+ Add) whom the scan didn't find here, followed and seen in it — one of its people;
   * `pending`: marked by hand here, not followed yet — shown waiting, not counted (where they are isn't known)
   */
  faces: Array<{ box: { x: number; y: number; w: number; h: number; person?: number }; subject: { label: string; color: string } | null; added?: boolean; pending?: boolean }>
  /** Where the clip shows it now: [start, end] ms of the timeline (removed parts left out) */
  shown: Array<[number, number]>
  /** The same stretches, each with who talks there (ms per face, as `faces`; null: not known) — Auto format decides each on its own */
  places: Array<{ shown: [number, number]; talk: number[] | null; present: number[] | null }>
  totalMs: number
  /** The group marked on this angle */
  group: { label: string; layout: string; color: string } | null
  /**
   * Its format, when each of its stretches is exactly one section (Auto format or a format picked in
   * the Subjects tool leaves it so): the layout, or 'mixed' when they differ (the speaker at the bottom
   * of a Split can change between them). Null: not formatted as a scene
   */
  formatted: string | null
  /** It has a group, or (one person) they are marked — someone marked elsewhere doesn't set a group scene */
  set: boolean
  /** Where the playhead goes to show it (timeline ms) */
  jumpMs: number
}

/** Marked from the view, the mark is the view's middle: the face at most this far across from it is theirs (as the tracker's VIEW_MARK_REACH) */
const MARK_REACH = 0.25
/** A stretch shorter than this isn't shown as one */
const MIN_SHOWN_MS = 200

/**
 * The angles as rows, for the clip as it is now. `cuts`: the camera cuts the tracker found (source
 * ms); `toTimeline`: source ms → timeline ms; `lengthMs`: the clip's length on the timeline.
 * Angles the clip no longer shows (their parts were removed) are left out.
 */
export function angleRows(
  angles: readonly Angle[], subjects: readonly AngleSubject[], cuts: readonly number[],
  toTimeline: (sourceMs: number) => number, lengthMs: number,
  /** The layout of the one section covering exactly [a, b] of the timeline, or null (several, or not exactly) */
  formatOf?: (a: number, b: number) => string | null,
): AngleRow[] {
  // (a mark that failed — no face there — doesn't hold a face: it can be marked again)
  const people = subjects.filter(s => !s.shot && s.status !== 'failed')
  // Who each marked person is: the face they were marked on, in the angle of their mark. They are
  // marked in every angle that face's person is in (user, 2026-10-24: the same woman, marked in one
  // close-up, showed unmarked in her other close-up and was marked again — a second subject)
  const personOf = new Map<string, number>()
  for (const s of people) {
    const home = angles.find(x => x.spans.some(([b, e]) => s.mark_ms >= b && s.mark_ms < e))
    let best: number | undefined, bestD = Infinity
    for (const f of home?.faces ?? []) {
      const dx = Math.abs(s.mark_x - (f.x + f.w / 2)), dy = Math.abs(s.mark_y - (f.y + f.h / 2))
      if (f.person === undefined || dx > MARK_REACH || dx + dy >= bestD) continue
      bestD = dx + dy; best = f.person
    }
    if (best !== undefined && ![...personOf.values()].includes(best)) personOf.set(s.id, best)
  }
  return angles.flatMap((a): AngleRow[] => {
    const places = a.spans
      .map(([s, e], i) => ({ shown: [Math.max(0, Math.round(toTimeline(s))), Math.min(lengthMs, Math.round(toTimeline(e)))] as [number, number], talk: a.talk?.[i] ?? null, present: a.present?.[i] ?? null }))
      .filter(({ shown: [s, e] }) => e - s >= MIN_SHOWN_MS)
    const shown = places.map(p => p.shown)
    if (!shown.length) return []
    const inAngle = (sourceMs: number) => a.spans.some(([s, e]) => sourceMs >= s && sourceMs < e)

    // Each marked person's place in this angle's picture: the face that is them (who they are), else
    // where the tracker saw them at that moment, else (not looked for yet) where they were marked, if
    // that was in this angle. A face known to be someone else is never theirs
    const taken = new Map<number, AngleSubject>()
    for (const s of people) {
      const p = personOf.get(s.id)
      const k = p === undefined ? -1 : a.faces.findIndex((f, i) => f.person === p && !taken.has(i))
      if (k >= 0) taken.set(k, s)
    }
    for (const s of people) {
      if ([...taken.values()].includes(s)) continue
      const seen = s.status === 'done' && s.path?.length ? subjectBoxAt(s.path, a.at, cuts as number[]) : null
      const tracked = s.status === 'done' && !!s.path?.length
      if (tracked && !seen) continue
      if (!tracked && !inAngle(s.mark_ms)) continue
      const px = seen ? seen.x + seen.w / 2 : s.mark_x, py = seen ? seen.y + seen.h / 2 : s.mark_y
      let best = -1, bestD = Infinity
      a.faces.forEach((f, k) => {
        if (taken.has(k) || (f.person !== undefined && personOf.has(s.id))) return
        const dx = Math.abs(px - (f.x + f.w / 2)), dy = Math.abs(py - (f.y + f.h / 2))
        // Seen by the tracker: on that face. Only marked: the face nearest across
        if (seen ? dx > f.w || dy > f.h : dx > MARK_REACH) return
        const d = seen ? dx + dy : dx
        if (d < bestD) { bestD = d; best = k }
      })
      if (best >= 0) taken.set(best, s)
    }
    const g = subjects.find(s => s.shot && inAngle(s.mark_ms))
    const faces: AngleRow['faces'] = a.faces.map((box, k) => {
      const s = taken.get(k)
      return { box, subject: s ? { label: s.label, color: s.color } : null }
    })
    // People marked by hand (+ Add) whom the scan didn't find here (user, 2026-10-29: a listener sitting
    // still was read as a picture, and adding him changed nothing): followed and seen in this scene, they
    // are one of its people — on its card, in its count and in Auto format's decision; marked here and not
    // followed yet, they show waiting
    const sizeW = a.faces.length ? a.faces.reduce((n, f) => n + f.w, 0) / a.faces.length : 0.09
    const sizeH = a.faces.length ? a.faces.reduce((n, f) => n + f.h, 0) / a.faces.length : 0.16
    for (const s of people) {
      if ([...taken.values()].includes(s)) continue
      const subject = { label: s.label, color: s.color }
      if (s.status === 'done' && s.path?.length) {
        const box = seenInAngle(s.path, a, cuts)
        // (on a face the scan found: that face is someone else's, or theirs and already shown)
        if (!box || a.faces.some(f => Math.abs(box.x + box.w / 2 - (f.x + f.w / 2)) < f.w && Math.abs(box.y + box.h / 2 - (f.y + f.h / 2)) < f.h)) continue
        faces.push({ box: { x: box.x, y: box.y, w: box.w, h: box.h }, subject, added: true })
      } else if (s.status !== 'done' && inAngle(s.mark_ms)) {
        faces.push({ box: { x: Math.max(0, s.mark_x - sizeW / 2), y: Math.max(0, s.mark_y - sizeH / 2), w: sizeW, h: sizeH }, subject, pending: true })
      }
    }
    const count = a.people + faces.filter(f => f.added).length

    // The playhead goes to the angle's own moment where the clip still has it, else into its first stretch
    const atT = Math.round(toTimeline(a.at))
    const first = shown[0]
    const jumpMs = shown.some(([s, e]) => atT >= s && atT < e - 50) ? atT : Math.round(first[0] + Math.min(600, (first[1] - first[0]) / 2))
    const layouts = formatOf ? shown.map(([s, e]) => formatOf(s, e)) : []
    const formatted = layouts.length && layouts.every(Boolean) ? (new Set(layouts).size === 1 ? layouts[0] : 'mixed') : null
    return [{
      people: count, at: a.at, faces, shown, places, jumpMs, formatted,
      totalMs: shown.reduce((n, [s, e]) => n + e - s, 0),
      group: g ? { label: g.label, layout: g.shot!.layout, color: g.color } : null,
      // A scene of two or more is a group scene: set by a group marked on it, or by its format (Auto
      // format) — never by someone marked elsewhere (user, 2026-10-24: marking the man in his close-up
      // ticked every group scene he sits in) — each scene is its own
      set: !!g || (count < 2 ? faces.some(f => f.subject && !f.pending) : !!formatted),
    }]
  })
}

/** Where a followed person is in this angle: at its own moment, else the first moment of its stretches they're seen in */
function seenInAngle(path: readonly SubjectPoint[], a: Angle, cuts: readonly number[]) {
  const at = subjectBoxAt(path, a.at, cuts as number[])
  if (at) return at
  for (const [s, e] of a.spans) for (let t = s + 250; t < e; t += 250) {
    const box = subjectBoxAt(path, t, cuts as number[])
    if (box) return box
  }
  return null
}

/**
 * The people in one of a row's places — Auto format decides each place on them: the scan's faces seen
 * there (all, when the scan doesn't say), and the people added by hand and found; marks still being
 * found are left out (where they are isn't known). With how long each talks there
 */
export function placePeople(row: AngleRow, place: AngleRow['places'][number]): { boxes: AngleRow['faces'][number]['box'][]; talk: number[] | null } {
  const keep = row.faces.map((f, k) => !f.pending && (!!f.added || !place.present || place.present.includes(k)))
  return {
    boxes: row.faces.filter((_, k) => keep[k]).map(f => f.box),
    talk: place.talk ? row.faces.flatMap((f, k) => (keep[k] ? [f.added ? 0 : place.talk![k] ?? 0] : [])) : null,
  }
}

/** The row showing at `t` (timeline ms), or null */
export function angleAt(rows: readonly AngleRow[], t: number): number | null {
  const i = rows.findIndex(r => r.shown.some(([s, e]) => t >= s && t < e))
  return i >= 0 ? i : null
}
