import sql from '@/lib/db'

// renderAfter: when set, the worker queues this render job once transcription finishes
export async function queueRetranscribe(userId: string, clipId: string, languageCode: string, renderAfter?: { clip_id: string; video_storage_path: string; quality: string; watermark: boolean; user_id?: string; priority?: boolean }, opts: { fresh?: boolean } = {}) {
  const [row] = await sql`
    SELECT c.video_id, c.start_ms, c.end_ms, v.storage_path, v.user_id
    FROM clips c JOIN videos v ON v.id = c.video_id
    WHERE c.id = ${clipId}
  `
  if (!row || row.user_id !== userId) {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  if (!row.storage_path) {
    throw Object.assign(new Error('Video not yet uploaded'), { status: 400 })
  }

  let resolvedLang = languageCode
  if (!languageCode || languageCode === 'unknown') {
    const [existing] = await sql`
      SELECT language FROM transcripts WHERE video_id = ${row.video_id}
      ORDER BY created_at DESC LIMIT 1
    `
    if (existing?.language) resolvedLang = existing.language
  }

  const { getUserPlanConfig } = await import('./quota')
  const plan = await getUserPlanConfig(userId)
  const payload = {
    video_id: row.video_id,
    storage_path: row.storage_path,
    language_code: resolvedLang,
    is_retranscribe: true,
    clip_id: clipId,
    clip_start_ms: row.start_ms,
    clip_end_ms: row.end_ms,
    user_id: userId,
    // The top plan: first in the worker's line and in the shared Google line, as its exports
    ...(plan.priorityExports ? { priority: true } : {}),
    // "Captions on" (no language picked, no fresh-captions export): only parts with no words need
    // reading, so a video already read in full needs no new reading (the worker checks). Regenerate
    // (`fresh`) always reads the clip again: it did nothing on a video read in full (user, 2026-11-06)
    ...(!renderAfter && !opts.fresh && (!languageCode || languageCode === 'unknown') ? { fill_gaps: true } : {}),
    ...(renderAfter ? { render_after: renderAfter } : {}),
  }
  const [job] = await sql`INSERT INTO jobs (type, payload, status) VALUES ('transcribe', ${sql.json(payload)}, 'queued') RETURNING id`
  return job?.id as string | undefined
}

/**
 * The whole video's transcript, for features that read all of it (Best moments, Ask AI). Captions
 * are never made automatically (they cost money), so the first time one of those features is
 * used, this starts it. 'ready' = the whole video has been read (or, for transcripts from before
 * that was recorded, words cover the video); 'running' = being made now. A reading that failed
 * is reported once, with its reason; asking again after that starts it again (the worker keeps
 * the parts it had read, so only the rest is sent).
 */
export async function ensureVideoTranscript(videoId: string): Promise<'ready' | 'running'> {
  const [video] = await sql`SELECT storage_path, duration_ms, user_id FROM videos WHERE id = ${videoId}`
  if (await hasWholeTranscript(videoId, video?.duration_ms ?? null)) return 'ready'
  const [last] = await sql`
    SELECT id, status, error, payload->>'reported' AS reported FROM jobs
    WHERE type = 'transcribe' AND payload->>'video_id' = ${videoId} AND payload->>'transcribe_full' = 'true'
    ORDER BY created_at DESC LIMIT 1`
  if (last?.status === 'queued' || last?.status === 'processing') return 'running'
  if (last?.status === 'failed') {
    const reason = readingFailure(last.error)
    // A video with no sound will never have words: say so every time, never read it again
    const final = /has no sound/i.test(reason)
    if (final || !last.reported) {
      if (!final) await sql`UPDATE jobs SET payload = payload || '{"reported": true}'::jsonb WHERE id = ${last.id}`
      throw Object.assign(new Error(final ? reason : `Reading your video failed: ${reason} Try again to continue from where it stopped.`), { status: 400 })
    }
  }
  if (video?.storage_path) {
    const { getUserPlanConfig } = await import('./quota')
    const plan = await getUserPlanConfig(video.user_id)
    // The top plan: first in the shared Google line among readings (an editor's captions still go first)
    const payload = { video_id: videoId, storage_path: video.storage_path, transcribe_full: true, ...(plan.priorityExports ? { priority: true } : {}) }
    // One reading per video, even when two asks come at once (two tabs, a double click, AI edit
    // picked while Best moments asks): the check and the insert hold the video's lock, so the
    // second ask finds the first one's job instead of paying for the video twice
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`transcript:${videoId}`}))`
      const [busy] = await tx`
        SELECT 1 FROM jobs WHERE type = 'transcribe' AND payload->>'video_id' = ${videoId}
          AND payload->>'transcribe_full' = 'true' AND status IN ('queued', 'processing') LIMIT 1`
      if (!busy) await tx`INSERT INTO jobs (type, payload, status) VALUES ('transcribe', ${tx.json(payload)}, 'queued')`
    })
  }
  return 'running'
}

/**
 * Whether the whole video has been read: a transcript saved as the whole video, or (from before
 * that was recorded) words in most of its minutes. Captions made for one clip (manual edit) only
 * cover that clip, so they never count.
 */
async function hasWholeTranscript(videoId: string, durationMs: number | null): Promise<boolean> {
  // (to_jsonb: a database whose worker hasn't added the field yet has no whole_video)
  const [whole] = await sql`
    SELECT 1 FROM transcripts t WHERE t.video_id = ${videoId} AND (to_jsonb(t)->>'whole_video')::boolean LIMIT 1`
  if (whole) return true
  const [{ minutes }] = await sql`
    SELECT COUNT(DISTINCT (tw.start_ms / 60000))::int AS minutes FROM transcript_words tw
    WHERE tw.transcript_id = (SELECT t.id FROM transcripts t WHERE t.video_id = ${videoId}
      AND EXISTS (SELECT 1 FROM transcript_words WHERE transcript_id = t.id) ORDER BY t.created_at DESC LIMIT 1)`
  const total = Math.max(1, Math.ceil((durationMs ?? 60000) / 60000))
  return minutes / total >= 0.6
}

// ── AI edit and manual edit ───────────────────────────────────────────────────
// The dashboard asks how to make clips. AI edit (Best moments, Ask AI, Make my clips) reads the
// whole video's words, so picking it starts that reading straight away and the clip board shows
// how far it is. Manual edit never reads the whole video: a clip's captions are made for that
// clip alone, in the editor, and never wait for a whole-video reading.

export interface VideoTranscriptState {
  /** none: never asked for; running: being read now; ready: the whole video is read */
  status: 'none' | 'running' | 'ready' | 'failed'
  /** While running: how much has been read (0–100), when the worker says; stopped: how far it got */
  progress: number | null
  error: string | null
  /** The last reading was stopped by the user (status none): Unlock carries on from where it stopped */
  stopped?: boolean
  /** While running: its place in line when it is waiting its turn (1 = next), else null (placeInLine) */
  place?: number | null
  /** While running, what the worker is doing (its job's read_step): getting the sound, reading its
   *  parts, saving the transcript — null from a worker that doesn't say */
  step?: 'audio' | 'reading' | 'saving' | null
  /** While reading: the parts read and all of them (the video is read in parts) */
  done?: number | null
  total?: number | null
  /** Waiting to start (queued), what for: 'copy' — this video's editing copy is being made in the
   *  long-job slot; 'queue' — other videos' readings are ahead (place); 'server' — the server is busy
   *  with other work or picking it up */
  waitingOn?: 'copy' | 'queue' | 'server' | null
}

/** What Stop writes on the reading's job (the worker's READING_STOPPED: it stops when it sees it) */
const READING_STOPPED = 'Stopped by the user'

async function ownVideo(userId: string, videoId: string) {
  const [video] = await sql<{ user_id: string; duration_ms: number | null }[]>`SELECT user_id, duration_ms FROM videos WHERE id = ${videoId}`
  if (!video || video.user_id !== userId) throw Object.assign(new Error('Video not found'), { status: 404 })
  return video
}

/**
 * A caption job's place in line (1 = next), or null when it isn't waiting (being read now, done, or
 * no line). Two lines: the worker's queue while the job is queued (jobs of its kind queued before
 * it, the top plan's first), then the shared Google line while the worker waits for Google
 * (google_waiting: the worker's lib/googleBudget.ts — editors' captions before readings, the top plan
 * first, then first come; only there when GOOGLE_STT_TPM / GEMINI_STT_TPM is set). Vertex and the
 * Gemini key each have their own line (lane 'stt' / 'stt-key'): the place is in the line it waits in.
 */
export async function placeInLine(jobId: string): Promise<number | null> {
  const [job] = await sql<{ status: string; reading: boolean; priority: boolean; created_at: Date }[]>`
    SELECT status, COALESCE(payload->>'transcribe_full', '') = 'true' AS reading,
      payload @> '{"priority":true}'::jsonb AS priority, created_at
    FROM jobs WHERE id = ${jobId} AND type = 'transcribe'`
  if (!job) return null
  if (job.status === 'queued') {
    const [{ ahead }] = await sql<{ ahead: number }[]>`
      SELECT count(*)::int AS ahead FROM jobs
      WHERE type = 'transcribe' AND status = 'queued' AND id <> ${jobId}
        AND (COALESCE(payload->>'transcribe_full', '') = 'true') = ${job.reading}
        AND ((payload @> '{"priority":true}'::jsonb) > ${job.priority}
          OR ((payload @> '{"priority":true}'::jsonb) = ${job.priority} AND created_at < ${job.created_at}))`
    return ahead + 1
  }
  if (job.status !== 'processing') return null
  try {
    const [row] = await sql<{ place: number | null }[]>`
      WITH alive AS (
        SELECT id, lane, job_id, rank, since FROM google_waiting
        WHERE lane IN ('stt', 'stt-key') AND seen > clock_timestamp() - interval '30 seconds'
      ), mine AS (SELECT lane, rank, since, id FROM alive WHERE job_id = ${jobId} ORDER BY rank, since, id LIMIT 1)
      SELECT (SELECT count(DISTINCT COALESCE(a.job_id, a.id))::int + 1 FROM alive a, mine m
        WHERE a.lane = m.lane AND COALESCE(a.job_id, a.id) <> ${jobId} AND (a.rank < m.rank OR (a.rank = m.rank AND (a.since, a.id) < (m.since, m.id)))) AS place
      FROM mine`
    return row?.place ?? null
  } catch {
    return null   // no shared line (the table is made when the worker first uses it)
  }
}

/** How far the whole video's reading is (nothing is started) */
export async function videoTranscriptState(userId: string, videoId: string): Promise<VideoTranscriptState> {
  const video = await ownVideo(userId, videoId)
  if (await hasWholeTranscript(videoId, video.duration_ms)) return { status: 'ready', progress: 100, error: null }
  const [last] = await sql<{ id: string; status: string; error: string | null; read_pct: string | null; read_step: string | null; read_done: string | null; read_total: string | null }[]>`
    SELECT id, status, error, payload->>'read_pct' AS read_pct, payload->>'read_step' AS read_step,
      payload->>'read_done' AS read_done, payload->>'read_total' AS read_total FROM jobs
    WHERE type = 'transcribe' AND payload->>'video_id' = ${videoId} AND payload->>'transcribe_full' = 'true'
    ORDER BY created_at DESC LIMIT 1`
  if (last?.status === 'queued') {
    const place = await placeInLine(last.id)
    const [copy] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM jobs WHERE type = 'proxy' AND status = 'processing' AND payload->>'video_id' = ${videoId}`
    const waitingOn = copy?.n ? 'copy' : place && place > 1 ? 'queue' : 'server'
    return { status: 'running', progress: 0, error: null, place, waitingOn }
  }
  if (last?.status === 'processing') {
    const step = last.read_step === 'audio' || last.read_step === 'reading' || last.read_step === 'saving' ? last.read_step : null
    return {
      status: 'running', progress: last.read_pct === null ? null : Math.min(99, Number(last.read_pct)), error: null, place: await placeInLine(last.id),
      step, done: last.read_done === null ? null : Number(last.read_done), total: last.read_total === null ? null : Number(last.read_total),
    }
  }
  if (last?.status === 'failed' && last.error === READING_STOPPED) {
    return { status: 'none', progress: last.read_pct === null ? null : Math.min(99, Number(last.read_pct)), error: null, stopped: true }
  }
  if (last?.status === 'failed') return { status: 'failed', progress: null, error: readingFailure(last.error) }
  return { status: 'none', progress: null, error: null }
}

/** AI edit: start reading the whole video now (once — a reading already made or under way is kept) */
export async function startVideoTranscript(userId: string, videoId: string): Promise<VideoTranscriptState> {
  await ownVideo(userId, videoId)
  // A failed reading is started again here (the worker keeps the parts it had read): the user
  // picked AI edit again, so they want it
  const [last] = await sql`
    SELECT id FROM jobs WHERE type = 'transcribe' AND payload->>'video_id' = ${videoId} AND payload->>'transcribe_full' = 'true'
      AND status = 'failed' AND NOT (payload ? 'reported') ORDER BY created_at DESC LIMIT 1`
  if (last) await sql`UPDATE jobs SET payload = payload || '{"reported": true}'::jsonb WHERE id = ${last.id}`
  await ensureVideoTranscript(videoId).catch(() => { /* its reason is in the state below */ })
  return videoTranscriptState(userId, videoId)
}

/**
 * Stop the whole video's reading (the clip board's lock): one waiting never starts, one running
 * stops within a couple of seconds (the worker checks its job). The parts already read are kept, so
 * Unlock later carries on from there; marked as reported, so that Unlock starts it again at once
 * instead of reporting it as a failure.
 */
export async function stopVideoTranscript(userId: string, videoId: string): Promise<VideoTranscriptState> {
  await ownVideo(userId, videoId)
  await sql`
    UPDATE jobs SET status = 'failed', error = ${READING_STOPPED}, payload = payload || '{"reported": true}'::jsonb
    WHERE type = 'transcribe' AND payload->>'video_id' = ${videoId} AND payload->>'transcribe_full' = 'true'
      AND status IN ('queued', 'processing')
  `
  return videoTranscriptState(userId, videoId)
}

/**
 * The editor's Stop on a clip's Regenerate (user, 2026-11-06): the job is marked stopped, so a queued
 * one never runs and a running one stops within ~2 s (the worker's runTranscribeJob) without writing
 * anything — the clip keeps the words it had. False when it had already finished.
 */
export async function stopClipCaptions(userId: string, jobId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw Object.assign(new Error('Not found'), { status: 404 })
  const [job] = await sql<{ user_id: string | null }[]>`
    SELECT v.user_id FROM jobs j JOIN clips c ON c.id::text = j.payload->>'clip_id' JOIN videos v ON v.id = c.video_id
    WHERE j.id = ${jobId} AND j.type = 'transcribe'`
  if (!job || job.user_id !== userId) throw Object.assign(new Error('Not found'), { status: 404 })
  const stopped = await sql`
    UPDATE jobs SET status = 'failed', error = ${READING_STOPPED}
    WHERE id = ${jobId} AND status IN ('queued', 'processing') RETURNING id`
  return stopped.length > 0
}

/** Why a reading failed, in a sentence: the worker's own message, without a failed command's pages of output */
function readingFailure(error: string | null): string {
  const first = (error ?? '').split('\n')[0].trim()
  if (!first || /^Command failed/i.test(first)) return 'The video file could not be read.'
  const text = first.length > 240 ? `${first.slice(0, 240)}…` : first
  return /[.!?]$/.test(text) ? text : `${text}.`
}
