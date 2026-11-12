import type postgres from 'postgres'
import sql from '@/lib/db'
import { creditsMode, subjectsCredits, subjectsNewMs } from '@/lib/credits'
import { hasColumn } from './clips'
import { charge, ensureCreditsSchema, linkJob, sweep } from './credits'

// ── Subjects: people marked in a clip and followed through it ─────────────────
// The editor's Subjects tool. The user marks a person (a click on them at a moment of the source
// video); "Track" queues a worker job (chai-cut-backend jobs/track_subjects.ts) that finds them 4×
// a second and saves where their face is (clip_subjects.path). The editor then lets the user frame
// any view on any subject, wherever they like — nothing is applied by itself.

export interface Subject {
  id: string
  label: string
  color: string
  /** Where it was marked: ms of the source video, and fractions of the frame */
  mark_ms: number; mark_x: number; mark_y: number
  status: 'new' | 'queued' | 'running' | 'done' | 'failed'
  error: string | null
  progress: number
  /** [[source ms, x, y, w, h], …] of their face, only where they were seen (fractions of the frame) */
  path: Array<[number, number, number, number, number, number?]> | null
  scan_start_ms: number | null
  scan_end_ms: number | null
  /** The camera cuts found while tracking (source ms); null before the worker saved them */
  cuts?: number[] | null
  /** When they are talking ([start, end] source ms, to the word); null before the worker saved them */
  speaking?: Array<[number, number]> | null
  /** A group subject: a camera shot marked with its format and views (null for a person) */
  shot?: ShotArrangement | null
  /** A group subject: wherever the clip shows that shot ([start, end] source ms), once found */
  spans?: Array<[number, number]> | null
}

/**
 * A group subject's format: the layout, and each view where the user put it (fractions of the
 * source picture). Wherever the clip shows the marked shot again, the editor puts exactly this there.
 */
export interface ShotArrangement {
  layout: string
  boxes: Array<{ slot_index: number; x: number; y: number; w: number; h: number }>
}
/** The formats a group subject can be marked in (frames keep their own lanes, so not those) */
const SHOT_LAYOUTS: Record<string, number> = { vertical: 1, split: 2, trio: 3, spotlight: 1, centered: 1, horizontal: 1 }
/** As many as the camera angles listed (the worker's MAX_ANGLES): every angle can be given its own group */
export const MAX_SHOTS = 12

/** A group subject's format from the editor, checked (a 400 when it isn't one) */
function cleanShot(v: unknown): ShotArrangement {
  const bad = () => Object.assign(new Error('This format can’t be marked as a group subject'), { status: 400 })
  const o = v as { layout?: unknown; boxes?: unknown } | null
  if (!o || typeof o.layout !== 'string' || !(o.layout in SHOT_LAYOUTS) || !Array.isArray(o.boxes)) throw bad()
  const n = SHOT_LAYOUTS[o.layout]
  const boxes = (o.boxes as Array<Record<string, unknown>>).map(b => {
    const slot_index = Number(b?.slot_index), x = Number(b?.x), y = Number(b?.y), w = Number(b?.w), h = Number(b?.h)
    if (!Number.isInteger(slot_index) || slot_index < 0 || slot_index >= n) throw bad()
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || x < -0.001 || y < -0.001 || x + w > 1.001 || y + h > 1.001) throw bad()
    const r = (q: number) => Math.round(q * 10000) / 10000
    return { slot_index, x: r(x), y: r(y), w: r(w), h: r(h) }
  })
  if (boxes.length !== n || new Set(boxes.map(b => b.slot_index)).size !== n) throw bad()
  return { layout: o.layout, boxes: boxes.sort((a, b) => a.slot_index - b.slot_index) }
}

export const MAX_SUBJECTS = 10
// One colour each (up to 12): people and groups share them, so up to 12 on the video at once tell apart
const COLORS = ['#f472b6', '#38bdf8', '#facc15', '#a78bfa', '#fb923c', '#34d399', '#f87171', '#22d3ee', '#e879f9', '#fbbf24', '#4ade80', '#93c5fd']

/** The table comes with the worker that tracks subjects (its start-up adds it) */
function notReady(err: unknown): never {
  if ((err as { code?: string })?.code === '42P01') {
    throw Object.assign(new Error('Subject tracking needs the latest worker. It starts working once the backend is updated.'), { status: 503 })
  }
  throw err
}

async function ownClip(userId: string, clipId: string) {
  const [clip] = await sql<{ id: string; user_id: string; start_ms: number; end_ms: number; ai_edit_job_id: string | null }[]>`
    SELECT c.id, v.user_id, c.start_ms, c.end_ms, c.ai_edit_job_id FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}
  `
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })
  return clip
}

// ── Credits ───────────────────────────────────────────────────────────────────
// The worker's job costs credits once per clip, whichever button starts it (following people, the
// angles scan, Sub-edit): more people or following again on the same clip is free, a clip made longer
// pays for the new part, and a clip from Make my clips is free (its AI clip covers it). A job that
// fails or is stopped gives its credits back and its part is no longer paid for (credits.ts sweep).

let chargesReady: Promise<void> | null = null
function ensureCharges(): Promise<void> {
  chargesReady ??= (async () => {
    await ensureCreditsSchema()
    await sql`
      CREATE TABLE IF NOT EXISTS subject_charges (
        id BIGSERIAL PRIMARY KEY,
        clip_id UUID NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
        hold_id UUID NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`CREATE INDEX IF NOT EXISTS subject_charges_clip_idx ON subject_charges (clip_id)`
  })().catch(e => { chargesReady = null; throw e })
  return chargesReady
}

/** The price of following this part of the clip. Credits on: past nothing yet, not paid for and not agreed to (`pay`), it asks first (402 subjects_cost) */
async function subjectsPrice(userId: string, clip: { id: string; ai_edit_job_id: string | null }, startMs: number, endMs: number, pay: unknown): Promise<number> {
  const mode = creditsMode()
  if (mode === 'off' || clip.ai_edit_job_id) return 0
  await ensureCharges()
  await sweep(userId)
  const paid = await sql<{ start_ms: number; end_ms: number }[]>`
    SELECT s.start_ms, s.end_ms FROM subject_charges s JOIN credit_holds h ON h.id = s.hold_id
    WHERE s.clip_id = ${clip.id} AND h.status <> 'released'`
  const price = subjectsCredits(subjectsNewMs(startMs, endMs, paid))
  if (price > 0 && mode === 'on' && pay !== true) {
    throw Object.assign(new Error(`Following people in this clip costs ${price} credit${price === 1 ? '' : 's'}, once for this clip.`), { status: 402, expose: true, code: 'subjects_cost', credits: price })
  }
  return price
}

/** Queues the worker's job and takes its credits together, so a clip that cannot be paid for queues nothing */
async function queueSubjectsJob(tx: postgres.TransactionSql, userId: string, clipId: string, payload: { start_ms: number; end_ms: number; [k: string]: unknown }, price: number) {
  const hold = price > 0 ? await charge(userId, { amount: price, refType: 'subjects', refId: clipId }, tx) : null
  const [job] = await tx<{ id: string }[]>`INSERT INTO jobs (type, payload, status) VALUES ('track_subjects', ${tx.json({ clip_id: clipId, ...payload, user_id: userId } as never)}, 'queued') RETURNING id`
  if (hold) {
    await linkJob(hold.id, job.id, tx)
    await tx`INSERT INTO subject_charges (clip_id, hold_id, start_ms, end_ms) VALUES (${clipId}, ${hold.id}, ${payload.start_ms}, ${payload.end_ms})`
  }
}

const BASE_COLUMNS = sql`id, label, color, mark_ms, mark_x, mark_y, status, error, progress, path, scan_start_ms, scan_end_ms`
const WITH_CUTS = sql`id, label, color, mark_ms, mark_x, mark_y, status, error, progress, path, scan_start_ms, scan_end_ms, cuts`
const WITH_ALL = sql`id, label, color, mark_ms, mark_x, mark_y, status, error, progress, path, scan_start_ms, scan_end_ms, cuts, speaking`
const WITH_SHOTS = sql`id, label, color, mark_ms, mark_x, mark_y, status, error, progress, path, scan_start_ms, scan_end_ms, cuts, speaking, shot, spans`
type Extras = 'shots' | 'all' | 'cuts' | 'none'
/** Which of the newer columns the table has (the worker adds them when it starts). A plain answer,
 *  not a fragment: a query fragment must never be awaited (awaiting one runs it) */
const pick = (x: Extras) => (x === 'shots' ? WITH_SHOTS : x === 'all' ? WITH_ALL : x === 'cuts' ? WITH_CUTS : BASE_COLUMNS)
async function extras(): Promise<Extras> {
  if (await hasColumn('clip_subjects', 'spans')) return 'shots'
  if (await hasColumn('clip_subjects', 'speaking')) return 'all'
  return (await hasColumn('clip_subjects', 'cuts')) ? 'cuts' : 'none'
}

export async function listSubjects(userId: string, clipId: string): Promise<Subject[]> {
  await ownClip(userId, clipId)
  try {
    return await sql<Subject[]>`SELECT ${pick(await extras())} FROM clip_subjects WHERE clip_id = ${clipId} ORDER BY created_at`
  } catch (e) { return notReady(e) }
}

/**
 * Mark a person: at `mark_ms` of the source video, where they were clicked (fractions of the frame).
 * With `shot` (the format and views on screen), a group subject instead: the camera shot at that
 * moment, which gets that format wherever the clip shows it.
 */
export async function addSubject(userId: string, clipId: string, body: { mark_ms?: unknown; x?: unknown; y?: unknown; shot?: unknown }): Promise<Subject> {
  await ownClip(userId, clipId)
  const t = Number(body.mark_ms), x = Number(body.x), y = Number(body.y)
  if (![t, x, y].every(Number.isFinite) || t < 0 || x < 0 || x > 1 || y < 0 || y > 1) {
    throw Object.assign(new Error('Click on the person in the video to mark them'), { status: 400 })
  }
  const shot = body.shot != null ? cleanShot(body.shot) : null
  try {
    const cols = await extras()
    if (shot && cols !== 'shots') {
      throw Object.assign(new Error('Group subjects need the latest worker. They start working once the backend is updated.'), { status: 503 })
    }
    // One mark at a time per clip: two taps saved at once both read "C" as the free name and made two
    // C's (user, 2026-10-24) — the lock holds the second until the first is in
    return await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`clip_subjects:${clipId}`}))`
      const existing = cols === 'shots'
        ? await tx<{ label: string; color: string; group: boolean; mark_ms: number; mark_x: number; mark_y: number; status: string }[]>`SELECT label, color, shot IS NOT NULL AS "group", mark_ms, mark_x, mark_y, status FROM clip_subjects WHERE clip_id = ${clipId}`
        : (await tx<{ label: string; color: string; mark_ms: number; mark_x: number; mark_y: number; status: string }[]>`SELECT label, color, mark_ms, mark_x, mark_y, status FROM clip_subjects WHERE clip_id = ${clipId}`).map(r => ({ ...r, group: false }))
      const same = existing.filter(s => s.group === !!shot)
      // The same person marked again at the same moment and place (a second tap; a mark that failed can be
      // made again) — about a face apart (user, 2026-10-29: two clicks on one man, 3% apart down, made F and G)
      const twice = !shot && same.find(s => s.status !== 'failed' && Math.abs(Number(s.mark_ms) - t) <= 1000 && Math.abs(Number(s.mark_x) - x) <= 0.05 && Math.abs(Number(s.mark_y) - y) <= 0.08)
      if (twice) throw Object.assign(new Error(`They are marked already, as ${twice.label}.`), { status: 409 })
      if (shot && same.length >= MAX_SHOTS) throw Object.assign(new Error(`Up to ${MAX_SHOTS} group subjects per clip`), { status: 400 })
      if (!shot && same.length >= MAX_SUBJECTS) throw Object.assign(new Error(`Up to ${MAX_SUBJECTS} subjects per clip`), { status: 400 })
      // The first free name (a letter for a person, "Group 1" for a shot) and colour
      const labels = new Set(existing.map(s => s.label)), colors = new Set(existing.map(s => s.color))
      const label = shot
        ? `Group ${Array.from({ length: MAX_SHOTS + 1 }, (_, i) => i + 1).find(i => !labels.has(`Group ${i}`))}`
        : [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find(l => !labels.has(l)) ?? `S${existing.length + 1}`
      const color = COLORS.find(c => !colors.has(c)) ?? COLORS[existing.length % COLORS.length]
      const [row] = shot
        ? await tx<Subject[]>`
            INSERT INTO clip_subjects (clip_id, label, color, mark_ms, mark_x, mark_y, shot)
            VALUES (${clipId}, ${label}, ${color}, ${Math.round(t)}, ${x}, ${y}, ${tx.json(shot as never)})
            RETURNING ${pick(cols)}
          `
        : await tx<Subject[]>`
            INSERT INTO clip_subjects (clip_id, label, color, mark_ms, mark_x, mark_y)
            VALUES (${clipId}, ${label}, ${color}, ${Math.round(t)}, ${x}, ${y})
            RETURNING ${pick(cols)}
          `
      return row
    })
  } catch (e) { return notReady(e) }
}

/** A new name for a subject (shown on the video and in the list) */
export async function renameSubject(userId: string, clipId: string, id: string, label: unknown): Promise<Subject> {
  await ownClip(userId, clipId)
  const name = String(label ?? '').trim().slice(0, 24)
  if (!name) throw Object.assign(new Error('Give the subject a name'), { status: 400 })
  try {
    const [row] = await sql<Subject[]>`UPDATE clip_subjects SET label = ${name} WHERE id = ${id} AND clip_id = ${clipId} RETURNING ${pick(await extras())}`
    if (!row) throw Object.assign(new Error('Subject not found'), { status: 404 })
    return row
  } catch (e) { return notReady(e) }
}

export async function deleteSubject(userId: string, clipId: string, id: string): Promise<void> {
  await ownClip(userId, clipId)
  try {
    await sql`DELETE FROM clip_subjects WHERE id = ${id} AND clip_id = ${clipId}`
  } catch (e) { return notReady(e) }
}

/** Remove everyone marked in the clip (the editor's Reset all). Nothing to remove before the table exists. */
export async function deleteAllSubjects(userId: string, clipId: string): Promise<void> {
  await ownClip(userId, clipId)
  try {
    await sql`DELETE FROM clip_subjects WHERE clip_id = ${clipId}`
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') return
    throw e
  }
}

/**
 * Follow the subjects through [start_ms, end_ms] of the source video (the clip as it is in the
 * editor). New and failed subjects are tracked; `all` tracks every one again (after the clip's
 * start or end moved).
 */
export async function trackSubjects(userId: string, clipId: string, body: { start_ms?: unknown; end_ms?: unknown; all?: unknown; pay?: unknown }): Promise<Subject[]> {
  const clip = await ownClip(userId, clipId)
  let start = Number(body.start_ms), end = Number(body.end_ms)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) { start = clip.start_ms; end = clip.end_ms }
  // Never longer than the longest clip the editor allows, with some room
  end = Math.min(end, start + 6 * 60_000)
  try {
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM clip_subjects WHERE clip_id = ${clipId} AND status NOT IN ('queued', 'running')
        AND (${body.all === true} OR status IN ('new', 'failed'))`
    const price = n ? await subjectsPrice(userId, clip, Math.round(start), Math.round(end), body.pay) : 0
    await sql.begin(async tx => {
      const queued = await tx<{ id: string }[]>`
        UPDATE clip_subjects SET status = 'queued', progress = 0, error = NULL
        WHERE clip_id = ${clipId} AND status NOT IN ('queued', 'running')
          AND (${body.all === true} OR status IN ('new', 'failed'))
        RETURNING id
      `
      if (!queued.length) return
      // A job still waiting will take these too; one already running takes only its own
      // (not a Sub-edit or an angles scan of the clip: those never track the marked ones)
      const [waiting] = await tx`
        SELECT 1 FROM jobs WHERE type = 'track_subjects' AND status = 'queued' AND payload->>'clip_id' = ${clipId}
          AND payload->>'auto' IS NULL AND payload->>'angles' IS NULL LIMIT 1
      `
      // (a new part paid for gets its own job: the one waiting does not read it)
      if (!waiting || price > 0) await queueSubjectsJob(tx, userId, clipId, { start_ms: Math.round(start), end_ms: Math.round(end) }, price)
    })
    return await sql<Subject[]>`SELECT ${pick(await extras())} FROM clip_subjects WHERE clip_id = ${clipId} ORDER BY created_at`
  } catch (e) {
    // An older database that doesn't allow this kind of job yet
    if ((e as { code?: string })?.code === '23514') {
      throw Object.assign(new Error('Subject tracking needs the latest worker. It starts working once the backend is updated.'), { status: 503 })
    }
    return notReady(e)
  }
}

// ── Camera angles ──────────────────────────────────────────────────────────────
// The Subjects tool lists every camera angle of the clip (a shot, and everywhere it comes back), so
// each can be given its subject or its group and none is missed. The worker finds them
// (jobs/track_subjects.ts findAngles, a track_subjects job with payload angles) into clip_angles.

export interface Angle {
  /** How many people it shows; 0: the other shots (no faces, or too short to be an angle) */
  people: number
  /** A moment that shows it (source ms), and the faces there, left to right (fractions of the frame);
   *  `person`: who it is, the same number in every angle (none: too small to tell, or an older list) */
  at: number
  faces: Array<{ x: number; y: number; w: number; h: number; person?: number }>
  /** Wherever the clip shows it: [start, end] source ms */
  spans: Array<[number, number]>
}
export interface AnglesState {
  /** none: never looked for; unavailable: the worker that finds them isn't deployed yet */
  status: 'none' | 'queued' | 'running' | 'done' | 'failed' | 'unavailable'
  progress: number
  error: string | null
  angles: Angle[]
  scan_start_ms: number | null
  scan_end_ms: number | null
}
const NO_ANGLES: AnglesState = { status: 'none', progress: 0, error: null, angles: [], scan_start_ms: null, scan_end_ms: null }
/** A scan not heard from for this long has stopped (the worker restarted): it can be started again */
const ANGLES_STUCK = '5 minutes'
const OUT_OF_DATE_WORKER = 'The worker that took this scan is out of date, so it could not run it. Update or restart that worker, then try again.'

export async function getAngles(userId: string, clipId: string): Promise<AnglesState> {
  await ownClip(userId, clipId)
  try {
    const [row] = await sql<(Omit<AnglesState, 'angles'> & { angles: Angle[] | null; stuck: boolean; job_failed: string | null })[]>`
      SELECT status, progress, error, angles, scan_start_ms, scan_end_ms,
        status IN ('queued', 'running') AND updated_at < now() - ${ANGLES_STUCK}::interval AS stuck,
        -- The scan's job failed without the worker's handler marking the row (say a worker from before
        -- this kind of job took it): the row would wait at 5% until it counts as stuck
        (SELECT CASE WHEN j.status = 'failed' THEN coalesce(j.error, 'failed') END FROM jobs j
          WHERE j.type = 'track_subjects' AND j.payload->>'clip_id' = ${clipId} AND j.payload->>'angles' = 'true'
          ORDER BY j.created_at DESC LIMIT 1) AS job_failed
      FROM clip_angles WHERE clip_id = ${clipId}
    `
    if (!row) return NO_ANGLES
    const { stuck, job_failed, ...state } = row
    if (job_failed && (state.status === 'queued' || state.status === 'running')) {
      const why = /No handler/i.test(job_failed) ? OUT_OF_DATE_WORKER : 'Looking for the angles failed. Try again.'
      // Saved, so Try again can start a new scan (one is only started once the last one is over)
      await sql`UPDATE clip_angles SET status = 'failed', progress = 100, error = ${why}, updated_at = now() WHERE clip_id = ${clipId} AND status IN ('queued', 'running')`
      return { ...state, angles: [], status: 'failed', progress: 100, error: why }
    }
    if (stuck) return { ...state, angles: [], status: 'failed', error: 'Looking for the angles stopped. Try again.' }
    return { ...state, angles: state.status === 'done' ? state.angles ?? [] : [], error: state.status === 'failed' ? (state.error === OUT_OF_DATE_WORKER ? OUT_OF_DATE_WORKER : 'The angles could not be found this time. Try again.') : null }
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') return { ...NO_ANGLES, status: 'unavailable' }
    throw e
  }
}

/** Look for the angles through [start_ms, end_ms] of the source video (the clip as it is in the editor) */
export async function scanAngles(userId: string, clipId: string, body: { start_ms?: unknown; end_ms?: unknown; pay?: unknown }): Promise<AnglesState> {
  const clip = await ownClip(userId, clipId)
  let start = Number(body.start_ms), end = Number(body.end_ms)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) { start = clip.start_ms; end = clip.end_ms }
  start = Math.max(0, start)
  end = Math.min(end, start + 6 * 60_000)
  try {
    const [going] = await sql`
      SELECT 1 FROM clip_angles WHERE clip_id = ${clipId} AND status IN ('queued', 'running') AND updated_at >= now() - ${ANGLES_STUCK}::interval`
    const price = going ? 0 : await subjectsPrice(userId, clip, Math.round(start), Math.round(end), body.pay)
    await sql.begin(async tx => {
      // One scan at a time: a row already waiting or being worked on is left alone
      const [queued] = await tx<{ clip_id: string }[]>`
        INSERT INTO clip_angles (clip_id, status, progress) VALUES (${clipId}, 'queued', 0)
        ON CONFLICT (clip_id) DO UPDATE SET status = 'queued', progress = 0, error = NULL, updated_at = now()
          WHERE clip_angles.status NOT IN ('queued', 'running') OR clip_angles.updated_at < now() - ${ANGLES_STUCK}::interval
        RETURNING clip_id
      `
      if (queued) await queueSubjectsJob(tx, userId, clipId, { start_ms: Math.round(start), end_ms: Math.round(end), angles: true }, price)
    })
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') return { ...NO_ANGLES, status: 'unavailable' }
    throw e
  }
  return getAngles(userId, clipId)
}

/**
 * Stop (the Subjects tool, user 2026-10-24): the clip's scan and following stop. Their jobs are marked
 * stopped (a waiting one is never taken; a running one is stopped by the worker within 2 s, which then
 * writes nothing — track_subjects.ts stopWatch), and the clip's rows are put back here at once, so it
 * holds even when no worker is running: the people being followed are marked again, ready to follow;
 * a scan goes back to the scenes found before it (none: not detected yet).
 */
export async function stopSubjects(userId: string, clipId: string): Promise<{ subjects: Subject[]; angles: AnglesState }> {
  await ownClip(userId, clipId)
  try {
    await sql.begin(async tx => {
      await tx`
        UPDATE jobs SET status = 'failed', error = ${STOPPED}
        WHERE type = 'track_subjects' AND payload->>'clip_id' = ${clipId} AND payload->>'auto' IS NULL AND status IN ('queued', 'processing')
      `
      await tx`UPDATE clip_subjects SET status = 'new', progress = 0, error = NULL WHERE clip_id = ${clipId} AND status IN ('queued', 'running')`
      await tx`DELETE FROM clip_angles WHERE clip_id = ${clipId} AND status IN ('queued', 'running') AND angles IS NULL`
      await tx`UPDATE clip_angles SET status = 'done', progress = 100, error = NULL, updated_at = now() WHERE clip_id = ${clipId} AND status IN ('queued', 'running')`
    })
  } catch (e) { return notReady(e) }
  return { subjects: await listSubjects(userId, clipId), angles: await getAngles(userId, clipId) }
}

// ── Sub-edit (the clip board's button) ─────────────────────────────────────────
// One press: the worker finds the people in the clip by itself, marks and tracks them, and frames
// the clip on whoever is talking — written into the clip (jobs/track_subjects.ts, payload auto).

export interface SubEditState {
  /** stopped: the user pressed Stop */
  status: 'none' | 'queued' | 'processing' | 'done' | 'failed' | 'stopped'
  error: string | null
  /** While it works: how long since the worker started on it (ms) */
  elapsed_ms: number | null
  /** While it waits for the worker: how many jobs are ahead of it */
  ahead: number | null
  /** About how long the work itself takes for this clip (ms), not counting waiting for the worker */
  estimate_ms: number
}

/** What the worker writes on a stopped Sub-edit (track_subjects.ts STOPPED) */
const STOPPED = 'Stopped by the user'

/**
 * About how long the worker takes on a clip this long: fetching the editing copy, reading its
 * faces 4× a second with their lips, following everyone and writing the framing. Measured on QA's
 * worker (2026-10-12): 8–11 s for a 32 s clip, 21 s for a 2 min one. Waiting for the worker (other
 * jobs ahead) is shown on its own, never guessed into this.
 */
const estimateMs = (clipMs: number) => Math.round(6000 + 0.14 * clipMs)

/** The latest Sub-edit of the clip, and how long one takes */
export async function subEditStatus(userId: string, clipId: string): Promise<SubEditState> {
  const clip = await ownClip(userId, clipId)
  const estimate_ms = estimateMs(Number(clip.end_ms) - Number(clip.start_ms))
  const [job] = await sql<{ status: string; error: string | null; working: number; ahead: number }[]>`
    SELECT j.status, j.error,
      -- the claim (status → processing) sets updated_at (the jobs_updated_at trigger)
      EXTRACT(EPOCH FROM (now() - j.updated_at)) * 1000 AS working,
      (SELECT count(*) FROM jobs o WHERE o.status IN ('queued', 'processing') AND o.type <> 'proxy'
        AND o.id <> j.id AND (o.status = 'processing' OR o.created_at < j.created_at))::int AS ahead
    FROM jobs j
    WHERE j.type = 'track_subjects' AND j.payload->>'clip_id' = ${clipId} AND j.payload->>'auto' = 'true'
    ORDER BY j.created_at DESC LIMIT 1
  `.catch(() => [])
  if (!job) return { status: 'none', error: null, elapsed_ms: null, ahead: null, estimate_ms }
  if (job.status === 'failed' && job.error === STOPPED) return { status: 'stopped', error: null, elapsed_ms: null, ahead: null, estimate_ms }
  const status = job.status as SubEditState['status']
  // The worker's error is for the logs; the user gets the reason in plain words when there is one
  const error = status === 'failed' ? plainError(job.error) : null
  return {
    status, error, estimate_ms,
    elapsed_ms: status === 'processing' ? Math.round(Number(job.working)) : null,
    ahead: status === 'queued' ? Number(job.ahead) : null,
  }
}

/** Stop the clip's Sub-edit: one waiting never starts; one running stops within a couple of seconds */
export async function stopSubEdit(userId: string, clipId: string): Promise<SubEditState> {
  await ownClip(userId, clipId)
  await sql`
    UPDATE jobs SET status = 'failed', error = ${STOPPED}
    WHERE type = 'track_subjects' AND payload->>'clip_id' = ${clipId} AND payload->>'auto' = 'true'
      AND status IN ('queued', 'processing')
  `
  return subEditStatus(userId, clipId)
}

function plainError(e: string | null): string {
  if (e && /No people could be found|No one could be followed/.test(e)) return 'No people could be found in this clip.'
  return 'Sub-edit didn\u2019t work this time. Try again.'
}

/** Start a Sub-edit (or report the one already running) */
export async function startSubEdit(userId: string, clipId: string, body: { pay?: unknown } = {}): Promise<SubEditState> {
  const clip = await ownClip(userId, clipId)
  const now = await subEditStatus(userId, clipId)
  if (now.status === 'queued' || now.status === 'processing') return now
  const price = await subjectsPrice(userId, clip, Number(clip.start_ms), Number(clip.end_ms), body.pay)
  try {
    await sql.begin(tx => queueSubjectsJob(tx, userId, clipId, { start_ms: Number(clip.start_ms), end_ms: Number(clip.end_ms), auto: true }, price))
  } catch (e) {
    // An older database that doesn't allow this kind of job yet
    if ((e as { code?: string })?.code === '23514') {
      throw Object.assign(new Error('Sub-edit needs the latest worker. It starts working once the backend is updated.'), { status: 503 })
    }
    throw e
  }
  return subEditStatus(userId, clipId)
}
