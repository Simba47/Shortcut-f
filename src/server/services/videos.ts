import { askAiUnits } from '@/lib/aiLimits'
import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { aiProvider, askGemini, GEMINI_MODEL, type GeminiUsage } from '@/lib/gemini'
import { creditsMode } from '@/lib/credits'
import { clipsAllowed, extraClipCredits, type LimitedBy } from '@/lib/aiLimits'
import { r2, R2_BUCKET } from '@/lib/r2'
import sql from '@/lib/db'
import { findClips, type FoundClip, type Subscores } from './clipFinder'
import { logSuggestionEvents, type SuggestionSource } from './suggestionEvents'

/**
 * One model picks clips everywhere — Best moments, Ask AI, and Make my clips on the worker
 * (jobs/ai_edit.ts) — so the three agree with each other and there is one price and one vendor.
 * (Before: Claude Haiku, Gemini 3.1 Pro preview and Gemini 2.5 Flash, one each.)
 */
export const CLIP_MODEL = GEMINI_MODEL

/** 'shown' for each AI suggestion returned (plain fallback chunks are not AI picks) */
function logShown(userId: string, videoId: string, source: SuggestionSource, model: string, suggestions: ClipSuggestion[]) {
  logSuggestionEvents(suggestions.filter(s => typeof s.score === 'number').map(s => ({
    user_id: userId, video_id: videoId, source, event: 'shown' as const,
    suggestion: { start_ms: s.start_ms, end_ms: s.end_ms, title: s.title, score: s.score, subscores: s.subscores, reason: s.reason, model },
  })))
}

export async function listVideos(userId: string, includeAssets = false) {
  return sql`
    SELECT id, title, status, download_progress, duration_ms, created_at, storage_path, source_url, source_type,
      -- Assets: B-roll the user uploaded in the editor (no stock_ref) or a saved stock clip
      role = 'asset' AS is_asset, (role = 'asset' AND stock_ref IS NULL) AS is_upload_asset,
      -- Why processing failed (e.g. a link that isn't shared publicly). Read through to_jsonb so
      -- this works before the worker has added the column.
      to_jsonb(videos)->>'error' AS error,
      -- Its editing copy (the worker's jobs/proxy.ts), once made: what the editor plays
      to_jsonb(videos)->>'proxy_path' AS proxy_path,
      (SELECT COUNT(*)::int FROM clips c WHERE c.video_id = videos.id) AS clip_count
    -- Stock clips saved for auto B-roll are the user's assets, not videos they uploaded
    FROM videos WHERE user_id = ${userId} AND (${includeAssets} OR role <> 'asset') ORDER BY created_at DESC
  `
}

export async function renameVideo(userId: string, videoId: string, title: string) {
  const trimmed = title.trim().slice(0, 120)
  if (!trimmed) throw Object.assign(new Error('Title cannot be empty'), { status: 400 })
  const [video] = await sql`
    UPDATE videos SET title = ${trimmed}
    WHERE id = ${videoId} AND user_id = ${userId}
    RETURNING id, title
  `
  if (!video) throw Object.assign(new Error('Not found'), { status: 404 })
  return { video }
}

export async function getVideo(userId: string, videoId: string) {
  const [video] = await sql`
    SELECT id, user_id, status, download_progress, duration_ms
    FROM videos WHERE id = ${videoId}
  `
  if (!video || video.user_id !== userId) {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  return { video }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Most items one bulk delete may remove */
export const MAX_BULK_DELETE = 100

/** Distinct, well-formed ids from a request body (a malformed id would make Postgres error) */
export function cleanIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && UUID.test(id)))]
}

/** Where a video's editing copy is kept (the worker's jobs/proxy.ts proxyKeyFor): deleted with it */
export function proxyKeyFor(storagePath: string): string {
  return storagePath.replace(/\.[^.]+$/, '') + '_proxy.mp4'
}

/**
 * Ask the worker for a video's editing copy (a video from before copies were made, opened in the
 * editor). Once: not when it has one, or one is queued or being made. Best effort — a worker that
 * can't make copies yet refuses the job, and the editor keeps playing the original.
 */
export async function requestProxy(userId: string, videoId: string): Promise<{ queued: boolean }> {
  const [v] = await sql`
    SELECT id, status, storage_path, stock_ref, to_jsonb(videos)->>'proxy_path' AS proxy_path
    FROM videos WHERE id = ${videoId} AND user_id = ${userId}`
  if (!v) throw Object.assign(new Error('Not found'), { status: 404 })
  if (v.status !== 'ready' || !v.storage_path || v.proxy_path || v.stock_ref) return { queued: false }
  try {
    const rows = await sql`
      INSERT INTO jobs (type, payload, status)
      SELECT 'proxy', ${sql.json({ video_id: videoId })}, 'queued'
      WHERE NOT EXISTS (
        SELECT 1 FROM jobs WHERE type = 'proxy' AND status IN ('queued', 'processing') AND payload->>'video_id' = ${videoId}
      )
      RETURNING id`
    return { queued: rows.length > 0 }
  } catch {
    return { queued: false }
  }
}

/** Remove files from R2, 1,000 keys per request (the S3 limit). Best effort: rows are what matter. */
export async function deleteR2Keys(keys: string[]) {
  for (let i = 0; i < keys.length; i += 1000) {
    await r2.send(new DeleteObjectsCommand({
      Bucket: R2_BUCKET,
      Delete: { Objects: keys.slice(i, i + 1000).map(Key => ({ Key })), Quiet: true },
    })).catch(() => {})
  }
}

export async function deleteVideo(userId: string, videoId: string) {
  return deleteVideos(userId, [videoId])
}

/**
 * Delete several of the user's videos at once, with their clips and every stored file (the
 * upload, its cached audio and each clip's export). All or nothing: if any id isn't one of the
 * user's videos, nothing is deleted.
 */
/**
 * B-roll the user uploaded in the editor (an asset, not a stock clip) that only these clips use
 * — in a section, a frame or as a video overlay. Read before the clips are deleted; stock clips
 * are kept for reuse, and an upload another clip still uses stays.
 */
export async function uploadsOnlyUsedBy(userId: string, clipIds: string[]): Promise<Array<{ id: string; storage_path: string | null }>> {
  if (!clipIds.length) return []
  return sql<Array<{ id: string; storage_path: string | null }>>`
    WITH refs AS (
      SELECT cb.source_video_id AS vid, s.clip_id FROM crop_boxes cb JOIN segments s ON s.id = cb.segment_id
        WHERE cb.source_video_id IS NOT NULL
      UNION ALL
      SELECT o.source_video_id, o.clip_id FROM overlays o WHERE o.source_video_id IS NOT NULL
      UNION ALL
      SELECT (it->>'source_video_id')::uuid, s.clip_id FROM segments s
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(s.frame->'items') = 'array' THEN s.frame->'items' ELSE '[]'::jsonb END) it
        WHERE it->>'kind' = 'video' AND (it->>'source_video_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    SELECT v.id, v.storage_path FROM videos v
    WHERE v.user_id = ${userId} AND v.role = 'asset' AND v.stock_ref IS NULL
      AND v.id IN (SELECT vid FROM refs WHERE clip_id = ANY(${clipIds}))
      AND NOT EXISTS (SELECT 1 FROM refs WHERE refs.vid = v.id AND NOT (refs.clip_id = ANY(${clipIds})))
  `
}

/** Deletes the uploads found by uploadsOnlyUsedBy: their files, then their rows */
export async function deleteUploads(uploads: Array<{ id: string; storage_path: string | null }>) {
  if (!uploads.length) return
  await deleteR2Keys(uploads.flatMap(u => u.storage_path
    ? [u.storage_path, u.storage_path.replace(/\.[^.]+$/, '_audio.flac'), u.storage_path.replace(/\.[^.]+$/, '_reading.json'), proxyKeyFor(u.storage_path)] : []))
  await sql`DELETE FROM videos WHERE id = ANY(${uploads.map(u => u.id)}) AND role = 'asset' AND stock_ref IS NULL`
}

export async function deleteVideos(userId: string, videoIds: string[]) {
  const ids = cleanIds(videoIds)
  if (ids.length === 0) throw Object.assign(new Error('No videos selected'), { status: 400 })
  if (ids.length > MAX_BULK_DELETE) throw Object.assign(new Error(`You can delete up to ${MAX_BULK_DELETE} videos at a time`), { status: 400 })

  const videos = await sql`SELECT id, storage_path FROM videos WHERE id = ANY(${ids}) AND user_id = ${userId}`
  if (videos.length !== ids.length) throw Object.assign(new Error('Not found'), { status: 404 })

  const keysToDelete: string[] = []
  for (const video of videos) {
    if (!video.storage_path) continue
    keysToDelete.push(video.storage_path)
    // FLAC audio cache created during transcription
    keysToDelete.push(video.storage_path.replace(/\.[^.]+$/, '_audio.flac'))
    // A whole-video reading that stopped part-way (the worker deletes it itself once it finishes)
    keysToDelete.push(video.storage_path.replace(/\.[^.]+$/, '_reading.json'))
    // Its editing copy (made by the worker for the editor)
    keysToDelete.push(proxyKeyFor(video.storage_path))
  }
  // Rendered output for every clip of these videos
  const clipOutputs = await sql`
    SELECT output_storage_path FROM clips
    WHERE video_id = ANY(${ids}) AND output_storage_path IS NOT NULL
  `
  for (const row of clipOutputs) keysToDelete.push(row.output_storage_path as string)
  // B-roll uploaded into these videos' clips and used nowhere else goes too
  const clipIds = (await sql<{ id: string }[]>`SELECT id FROM clips WHERE video_id = ANY(${ids})`).map(r => r.id)
  const uploads = (await uploadsOnlyUsedBy(userId, clipIds)).filter(u => !ids.includes(u.id))

  await deleteR2Keys(keysToDelete)
  // Clips, formats, captions, overlays… go with their video (foreign keys cascade)
  await sql`DELETE FROM videos WHERE id = ANY(${ids}) AND user_id = ${userId}`
  await deleteUploads(uploads)
  return { deleted: ids.length }
}

/**
 * Best moments and Ask AI read the whole video's words. Captions aren't made automatically any
 * more, so the first use starts them and asks the user to come back (409).
 */
/**
 * The words Best moments and Ask AI pick from: Gemini's reading of the whole video when there is one,
 * else the worker's reference transcript when it is marked for picking (./referenceTranscript), else
 * the newest transcript (from before whole readings were recorded). A transcript holding only some
 * clips' captions (Make my clips from the reference transcript writes those) is never picked from
 * while a reference transcript is there.
 */
async function wordsToPickFrom(videoId: string): Promise<Word[]> {
  const [whole] = await sql`
    SELECT t.id FROM transcripts t WHERE t.video_id = ${videoId} AND (to_jsonb(t)->>'whole_video')::boolean
    ORDER BY t.created_at DESC LIMIT 1`
  if (!whole) {
    const { pickingWords } = await import('./referenceTranscript')
    const reference = await pickingWords(videoId)
    if (reference) return reference
  }
  const [transcriptRow] = whole ? [whole] : await sql`
    SELECT id FROM transcripts WHERE video_id = ${videoId} ORDER BY created_at DESC LIMIT 1
  `
  return transcriptRow
    ? await sql<Word[]>`SELECT word, start_ms, end_ms FROM transcript_words WHERE transcript_id = ${transcriptRow.id} ORDER BY start_ms`
    : []
}

async function needWholeTranscript(videoId: string) {
  const { ensureVideoTranscript } = await import('./transcribe')
  if (await ensureVideoTranscript(videoId) === 'running') {
    throw Object.assign(new Error('Reading your video first — this takes a few minutes for a long video. Try again shortly.'), { status: 409 })
  }
}

export interface ClipSuggestion {
  id: string; title: string; start_ms: number; end_ms: number; summary: string
  /** Viral score 0–99 (AI suggestions only) */
  score?: number
  /** One line on why the clip should work */
  reason?: string
  subscores?: Subscores
}
type Word = { word: string; start_ms: number; end_ms: number }

/** Records what each Gemini call cost (services/aiUsage.ts); never slows down or fails the answer */
function usageOf(userId: string, videoId: string, purpose: string) {
  return (u: GeminiUsage) => {
    import('./aiUsage').then(m => m.recordAiUsage({ userId, videoId, purpose, ...u }))
      .catch(e => console.warn('[ai-usage] not recorded:', e instanceof Error ? e.message : e))
  }
}

/** A fresh moment search past the included ones: the page asks first, then sends pay: true */
function searchCostsError(credits: number) {
  return Object.assign(
    new Error(`Finding new moments for this video costs ${credits} credit${credits === 1 ? '' : 's'}: the included searches for it are used.`),
    { status: 402, expose: true, code: 'search_costs', credits },
  )
}

/** A run past the month's included AI clips (and maybe a paid search): the page asks first, then sends pay: true */
function clipsCostError(credits: number, extra: number, searchCredits: number) {
  const clips = `${extra} of these clips ${extra === 1 ? 'is' : 'are'} past this month's included AI clips`
  return Object.assign(
    new Error(`${clips}${searchCredits ? ', and a new search is needed' : ''}. This run costs ${credits} credit${credits === 1 ? '' : 's'}.`),
    { status: 402, expose: true, code: 'clips_cost', credits },
  )
}

/** How many Best moments are shown at a time */
const BEST_SHOWN = 8
/** A fresh search keeps up to this many moments for later ("Make more clips", "View more") */
const SAVE_UP_TO = 60

export interface SuggestionOptions {
  /** Look for new moments even when saved ones are left */
  fresh?: boolean
  /** The user agreed to pay for a search past the included ones */
  pay?: boolean
}

export async function getVideoSuggestions(userId: string, videoId: string, extraExclude: Array<[number, number]> = [], sopts: SuggestionOptions = {}): Promise<{ suggestions: ClipSuggestion[]; model?: string; credits?: number }> {
  const [video] = await sql`
    SELECT id, user_id, duration_ms, status FROM videos WHERE id = ${videoId}
  `
  if (!video || video.user_id !== userId) {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }

  await needWholeTranscript(videoId)
  const words = await wordsToPickFrom(videoId)

  const durationMs = video.duration_ms ?? 0
  if (words.length === 0) return { suggestions: makeTimeChunks(durationMs) }

  const model = CLIP_MODEL
  const aiUsage = await import('./aiUsage')
  // Moments a search already found and saved: shown again without asking AI (no cost)
  if (!sopts.fresh) {
    const saved = await aiUsage.unusedMoments(videoId, extraExclude)
    if (saved.length) {
      const suggestions = saved.slice(0, BEST_SHOWN).map((m, i) => toSuggestion(m as FoundClip, `saved-${i}`))
      logShown(userId, videoId, 'best_moments', model, suggestions)
      return { suggestions, model }
    }
  }

  // A fresh search: counted per video, and past the included ones it costs credits (asked first)
  const price = creditsMode() === 'on' ? (await aiUsage.clipAllowance(userId, videoId)).nextSearchCredits : 0
  if (price > 0 && !sopts.pay) throw searchCostsError(price)

  // Plain chunks only when no AI can answer
  if (!aiProvider()) return { suggestions: makeWordChunks(words, durationMs) }

  // Skip what's already a clip, and moments already listed (so "View more" finds new ones)
  const exclude = [...await clippedRanges(videoId, durationMs), ...extraExclude]
  const { charge, release, settle } = await import('./credits')
  const hold = price > 0 ? await charge(userId, { amount: price, refType: 'search', refId: videoId }) : null
  try {
    const found = await detectBestMoments(words, durationMs, exclude, usageOf(userId, videoId, 'best_moments'))
    await aiUsage.saveMoments(videoId, found)
    await aiUsage.recordSearch(userId, videoId, 'best_moments', null, hold ? price : 0)
    if (hold) await settle(hold.id)
    const suggestions = found.slice(0, BEST_SHOWN).map((c, i) => toSuggestion(c, `ai-${i}`))
    logShown(userId, videoId, 'best_moments', model, suggestions)
    return { suggestions, model, ...(hold ? { credits: price } : {}) }
  } catch (e) {
    if (hold) await release(hold.id).catch(() => {})
    console.error(`[suggestions] ${model} error:`, e)
    return { suggestions: makeWordChunks(words, durationMs) }
  }
}

export interface AddedMoment extends ClipSuggestion {
  /** The draft clip made for this moment (missing when the plan had no room left) */
  clip_id?: string
}

/**
 * "Find best moments": AI picks new moments (skipping ones already made into clips) and each one
 * is saved straight away as a draft clip in the Best moments section — no "Use" needed. Plain
 * fallback chunks (no AI, no score) are shown but not saved. On a plan with a clip limit, only
 * as many as there is room for are saved.
 */
export async function addBestMoments(userId: string, videoId: string, sopts: SuggestionOptions = {}): Promise<{ moments: AddedMoment[]; notSaved: number; limitMessage: string | null }> {
  const { suggestions, model } = await getVideoSuggestions(userId, videoId, [], sopts)
  const picks = suggestions.filter(s => typeof s.score === 'number')
  if (!picks.length) {
    return {
      moments: suggestions, notSaved: 0,
      // Plain chunks: the AI didn't answer (not set up, or it failed), so nothing is saved
      limitMessage: suggestions.length ? 'AI couldn\'t pick moments right now, so these are plain parts of the video and weren\'t added to your clips. Try again in a moment.' : null,
    }
  }

  const { getUserPlanConfig } = await import('./quota')
  const plan = await getUserPlanConfig(userId)
  let room = picks.length
  if (plan.maxClips) {
    const [row] = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM clips c JOIN videos v ON v.id = c.video_id WHERE v.user_id = ${userId}
    `
    room = Math.max(0, Math.min(room, plan.maxClips - parseInt(row?.count ?? '0', 10)))
  }
  const toSave = picks.slice(0, room)
  const rows = toSave.length
    ? await sql<{ id: string; start_ms: number; end_ms: number }[]>`
        INSERT INTO clips ${sql(toSave.map(s => ({
          video_id: videoId, start_ms: Math.round(s.start_ms), end_ms: Math.round(s.end_ms), status: 'draft', title: s.title,
        })))}
        RETURNING id, start_ms, end_ms`
    : []
  // The account's default brand kit on them (services/brandKits.ts)
  const { brandNewClips } = await import('./brandKits')
  await brandNewClips(userId, rows.map(r => ({ id: r.id, lengthMs: r.end_ms - r.start_ms })))
  // Pair each new clip with its moment by time (RETURNING order isn't guaranteed)
  const clipIdOf = new Map<ClipSuggestion, string>()
  for (const s of toSave) {
    const row = rows.find(r => r.start_ms === Math.round(s.start_ms) && r.end_ms === Math.round(s.end_ms))
    if (row) clipIdOf.set(s, row.id)
  }
  // Which section the clips belong to is read from this log (see the clip board page), so it is
  // written before answering. "auto_added" tells these apart from clips a user picked with "Use".
  if (clipIdOf.size) {
    await sql`
      INSERT INTO ai_suggestion_events ${sql([...clipIdOf].map(([s, clipId]) => ({
        user_id: userId, video_id: videoId, clip_id: clipId, source: 'best_moments', event: 'used',
        suggestion: sql.json({ start_ms: s.start_ms, end_ms: s.end_ms, title: s.title, score: s.score ?? null,
          subscores: s.subscores ?? null, reason: s.reason ?? null, model: model ?? CLIP_MODEL, auto_added: true } as never),
      })))}
    `.catch(e => console.warn('[best-moments] section not recorded:', e instanceof Error ? e.message : e))
  }
  const saved = clipIdOf.size
  const notSaved = picks.length - saved
  return {
    moments: picks.map(s => (clipIdOf.has(s) ? { ...s, clip_id: clipIdOf.get(s) } : s)),
    notSaved,
    limitMessage: notSaved > 0 && plan.maxClips
      ? `Your ${plan.name} plan allows ${plan.maxClips} clips, so ${saved ? `only ${saved} of ${picks.length} were` : 'none were'} added. Upgrade to keep them all.`
      : null,
  }
}

// Criteria-steered clip detection ("find me the funniest moments", "controversial takes", etc.) —
// same transcript source as getVideoSuggestions, but the caller picks what to look for.
export async function getVideoSuggestionsByCriteria(
  userId: string, videoId: string, criteria: string, opts: { pay?: boolean } = {},
): Promise<{ suggestions: ClipSuggestion[] }> {
  const trimmedCriteria = criteria.trim().slice(0, 200)
  if (!trimmedCriteria) throw Object.assign(new Error('Tell the AI what to look for'), { status: 400 })

  const [video] = await sql`
    SELECT id, user_id, duration_ms, status FROM videos WHERE id = ${videoId}
  `
  if (!video || video.user_id !== userId) {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }

  await needWholeTranscript(videoId)
  const words = await wordsToPickFrom(videoId)

  const durationMs = video.duration_ms ?? 0
  if (words.length === 0) {
    throw Object.assign(new Error('This video has no transcript yet'), { status: 400 })
  }

  // Counted against the month's allowance (1 per started hour of the video), then credits; refused past the daily cap.
  // Checked before any AI call, and given back if the AI does not answer.
  const { askAiPrice, beginAiAction } = await import('./aiUsage')
  const units = askAiUnits(durationMs)
  // Past the month it costs credits: the price is asked about first, as a search and clips are
  if (!opts.pay) {
    const price = await askAiPrice(userId, units)
    if (price > 0) {
      throw Object.assign(new Error(`This Ask AI search costs ${price} credits${units > 1 ? `: on this video one search counts as ${units}` : ''}.`), { status: 402, expose: true, code: 'ask_costs', credits: price })
    }
  }
  const action = await beginAiAction(userId, 'ask_ai', videoId, units)
  if (!aiProvider()) { await action.fail(); throw Object.assign(new Error('AI clip detection is not configured'), { status: 500 }) }

  try {
    const suggestions = await detectClipsByCriteria(words, durationMs, trimmedCriteria, usageOf(userId, videoId, 'ask_ai'))
    await action.done()
    logShown(userId, videoId, 'clip_search', CLIP_MODEL, suggestions)
    return { suggestions }
  } catch (e) {
    await action.fail()
    throw e
  }
}

function toSuggestion(c: FoundClip, id: string): ClipSuggestion {
  return {
    id, title: c.title, start_ms: c.start_ms, end_ms: c.end_ms, summary: c.summary,
    score: c.score, reason: c.reason, subscores: c.subscores,
  }
}

/**
 * Moments of this video that are already clips (from "Use", Make my clips or made by hand), so
 * Best moments offers new ones instead of the same moments again. Long clips, like "Edit full
 * video", are editing sessions rather than a picked moment and don't count.
 */
async function clippedRanges(videoId: string, durationMs: number): Promise<Array<[number, number]>> {
  const rows = await sql<{ start_ms: number; end_ms: number }[]>`
    SELECT start_ms, end_ms FROM clips WHERE video_id = ${videoId}
  `
  return rows
    .filter(c => c.end_ms - c.start_ms <= 3 * 60_000 && (!durationMs || c.end_ms - c.start_ms < 0.9 * durationMs))
    .map(c => [c.start_ms, c.end_ms])
}

// Best moments: the whole transcript in ~10-minute windows (see clipFinder.ts)
// Every good moment is kept (up to SAVE_UP_TO, more candidates per window), so later "View more"
// and "Make more clips" pick from them instead of searching again
async function detectBestMoments(words: Word[], durationMs: number, exclude: Array<[number, number]>, onUsage?: (u: GeminiUsage) => void): Promise<FoundClip[]> {
  const ask = (system: string, user: string, o?: { temperature?: number; thinkingBudget?: number }) => askGemini(user, { model: CLIP_MODEL, system, onUsage, ...o })
  return findClips({
    words, durationMs, mode: { kind: 'best' }, ask, exclude, limit: SAVE_UP_TO, perWindow: 12, spread: true,
    log: msg => console.error('[suggestions]', msg),
  })
}

// Clip search: Gemini reads the whole transcript in windows and keeps only genuine matches.
// Clips end on a line the model chose, so the old +5 s end padding is no longer needed.
async function detectClipsByCriteria(
  words: Word[], durationMs: number, criteria: string, onUsage?: (u: GeminiUsage) => void,
): Promise<ClipSuggestion[]> {
  const ask = (system: string, user: string, o?: { temperature?: number; thinkingBudget?: number }) => askGemini(user, { model: CLIP_MODEL, system, onUsage, ...o })
  const clips = await findClips({
    words, durationMs, mode: { kind: 'search', criteria }, ask,
    log: msg => console.error('[ai-detect]', msg),
  })
  return clips.map((c, i) => toSuggestion(c, `ai-criteria-${i}`))
}

function makeWordChunks(words: Word[], durationMs: number): ClipSuggestion[] {
  const TARGET_MS = 60_000
  const suggestions: ClipSuggestion[] = []
  let chunkStart = 0, chunkWords: string[] = [], idx = 0
  for (const w of words) {
    if (chunkWords.length === 0) chunkStart = w.start_ms
    chunkWords.push(w.word)
    if (w.end_ms - chunkStart >= TARGET_MS) {
      suggestions.push({ id: `chunk-${idx++}`, title: chunkWords.slice(0, 6).join(' ').trim(), start_ms: chunkStart, end_ms: w.end_ms, summary: '' })
      chunkWords = []
    }
  }
  if (chunkWords.length > 0 && words.length > 0) {
    suggestions.push({ id: `chunk-${idx}`, title: chunkWords.slice(0, 6).join(' ').trim(), start_ms: chunkStart, end_ms: words[words.length - 1].end_ms || durationMs, summary: '' })
  }
  return suggestions
}

function makeTimeChunks(durationMs: number): ClipSuggestion[] {
  const chunkMs = 60_000
  return Array.from({ length: Math.max(1, Math.ceil(durationMs / chunkMs)) }, (_, i) => ({
    id: `time-${i}`, title: `Segment ${i + 1}`,
    start_ms: i * chunkMs, end_ms: Math.min((i + 1) * chunkMs, durationMs), summary: '',
  }))
}

// ── "Make my clips": the worker's AI Edit job picks, frames and exports clips on its own ──

export const AUTO_CLIP_COUNTS = [3, 5, 10] as const

/** The Make my clips checkboxes (each on unless false), and what the captions and the title are written in */
export interface AutoClipOptions {
  /** The brand kit put on the clips: 'default' (the account's default kit, if any), 'none', or a kit's id */
  brandKit?: string
  captions?: boolean; title?: boolean; motion?: boolean; layouts?: boolean
  /** 'native' = the speaker's own script (Telugu, Hindi letters); 'roman' = English letters (Tenglish, Hinglish…) */
  captionLanguage?: 'native' | 'roman'
  /** 'roman' = English letters in the speaker's language; 'english'; 'native' = the speaker's own script */
  titleLanguage?: 'roman' | 'english' | 'native'
}

/**
 * The brand kit Make my clips puts on its clips: 'none', a kit the user can use — their own or one
 * shared with them (the worker reads either: its lib/brandKit.ts) — else 'default'. (A shared kit used
 * to be turned into 'default' here, so the clips got the user's own default kit instead.)
 */
async function brandKitChoice(userId: string, want: string | undefined): Promise<string> {
  if (want === 'none') return 'none'
  if (want) {
    const { canUseKit } = await import('./brandKits')
    if (await canUseKit(userId, want)) return want
  }
  return 'default'
}

export interface MakeClipsOptions extends AutoClipOptions {
  /** 'more' (default): pick from the moments already found, when any are left; 'new': search again */
  search?: 'more' | 'new'
  /** The user agreed to pay for a search past the included ones */
  pay?: boolean
}

/**
 * Make my clips. What is limited is what costs (lib/aiLimits.ts, services/aiUsage.ts): AI clips
 * a month (past them, credits per clip), a daily safety cap, clips per video, and fresh moment
 * searches per video. "Make more clips" picks from the moments a search already saved, with no new
 * search. A run asking for more than is left makes what is left and says why (limited_by).
 */
export async function createAutoClips(userId: string, videoId: string, clipCount = 5, addBroll = false, options: MakeClipsOptions = {}) {
  const requested = Math.round(Number(clipCount))
  const mode = creditsMode()
  if (!Number.isFinite(requested) || requested < 1 || (mode === 'off' && requested > 10)) {
    throw Object.assign(new Error('Choose between 1 and 10 clips'), { status: 400 })
  }
  const [video] = await sql`
    SELECT id, status, storage_path, duration_ms FROM videos WHERE id = ${videoId} AND user_id = ${userId}
  `
  if (!video) throw Object.assign(new Error('Not found'), { status: 404 })
  if (video.status !== 'ready' || !video.storage_path) {
    throw Object.assign(new Error('This video is still processing. Try again once it is ready.'), { status: 409 })
  }

  const aiUsage = await import('./aiUsage')
  const allowance = await aiUsage.clipAllowance(userId, videoId)
  let count = requested
  let limitedBy: LimitedBy | 'saved' = null
  if (mode === 'on') {
    const r = clipsAllowed({ requested, perRun: allowance.perRun, dayLeft: allowance.dayLeft, videoLeft: allowance.videoLeft })
    if (r.count === 0) {
      throw Object.assign(new Error(r.limitedBy === 'day'
        ? `You've made ${allowance.clipsToday} of today's ${allowance.clipsPerDay} AI clips. More tomorrow.`
        : `This video already has ${allowance.videoClips} AI clips, the most for its length (1 per minute of video).`), { status: 429, expose: true })
    }
    count = r.count; limitedBy = r.limitedBy
  }
  // "More clips" from saved moments while any are left; otherwise (or when asked) a fresh search
  const fromSaved = options.search !== 'new' && allowance.savedLeft > 0
  if (fromSaved && count > allowance.savedLeft) { count = allowance.savedLeft; limitedBy = 'saved' }
  const price = !fromSaved && mode === 'on' ? allowance.nextSearchCredits : 0
  const clipCost = mode === 'on' ? extraClipCredits(count, allowance.monthLeft) : { extra: 0, credits: 0 }

  const { checkClipQuota, getUserPlanConfig } = await import('./quota')
  await checkClipQuota(userId)
  const plan = await getUserPlanConfig(userId)
  if (plan.maxClips) {
    const [row] = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM clips c JOIN videos v ON v.id = c.video_id WHERE v.user_id = ${userId}
    `
    const left = plan.maxClips - parseInt(row?.count ?? '0', 10)
    if (count > left) {
      throw Object.assign(
        new Error(`Your ${plan.name} plan allows ${plan.maxClips} clips and you have room for ${Math.max(0, left)} more. Choose fewer clips or upgrade.`),
        { status: 403 },
      )
    }
  }
  // Asked after the plan's own clip limit, so the free plan is told to upgrade, not offered paid clips
  if (clipCost.credits > 0 && !options.pay) throw clipsCostError(clipCost.credits + price, clipCost.extra, price)
  if (price > 0 && !options.pay) throw searchCostsError(price)

  const [running] = await sql`
    SELECT id FROM ai_edit_jobs WHERE video_id = ${videoId} AND status IN ('queued', 'running') LIMIT 1
  `
  if (running) throw Object.assign(new Error('AI is already making clips for this video. Wait for it to finish.'), { status: 409 })

  const { charge, linkJob, release } = await import('./credits')
  const hold = price > 0 ? await charge(userId, { amount: price, refType: 'search', refId: videoId }) : null
  let clipHold: Awaited<ReturnType<typeof charge>> | null = null
  try {
    clipHold = clipCost.credits > 0 ? await charge(userId, { amount: clipCost.credits, refType: 'ai_clips', refId: videoId }) : null
    const [aiJob] = await sql`
      INSERT INTO ai_edit_jobs (video_id, clip_count, status) VALUES (${videoId}, ${count}, 'queued') RETURNING id
    `
    const payload = {
      ai_edit_job_id: aiJob.id, video_id: videoId, clip_count: count, add_broll: addBroll,
      captions: options.captions !== false, title: options.title !== false,
      motion: options.motion !== false, layouts: options.layouts !== false,
      caption_language: options.captionLanguage === 'roman' ? 'roman' : 'native',
      title_language: options.titleLanguage === 'english' || options.titleLanguage === 'native' ? options.titleLanguage : 'roman',
      brand_kit: await brandKitChoice(userId, options.brandKit),
      // 'saved': pick from video_moments (the worker makes no new search); 'new': search and save
      search: fromSaved ? 'saved' : 'new',
      user_id: userId,
    }
    const [job] = await sql`INSERT INTO jobs (type, payload, status) VALUES ('ai_edit', ${sql.json(payload)}, 'queued') RETURNING id`
    // The search's credits follow the job: a run that fails gives them back (credits.sweep)
    if (hold) await linkJob(hold.id, job.id)
    if (clipHold) await linkJob(clipHold.id, job.id)
    if (!fromSaved) await aiUsage.recordSearch(userId, videoId, 'make_clips', aiJob.id, hold ? price : 0)
    return {
      ai_edit_job_id: aiJob.id as string, clip_count: count, limited_by: limitedBy, search: fromSaved ? 'saved' as const : 'new' as const,
      credits: (hold ? price : 0) + (clipHold ? clipCost.credits : 0), extra_clips: clipHold ? clipCost.extra : 0,
    }
  } catch (err) {
    if (hold) await release(hold.id).catch(() => {})
    if (clipHold) await release(clipHold.id).catch(() => {})
    throw err
  }
}

/**
 * "Yes, make these": the latest run found fewer good moments than clips asked for and stopped to
 * ask (status 'confirm', the moments kept in ai_edit_jobs.found). It is queued again with the
 * same choices, to make exactly those moments — they are not looked for (or paid for) again.
 */
export async function confirmAutoClips(userId: string, videoId: string) {
  const [video] = await sql`SELECT id FROM videos WHERE id = ${videoId} AND user_id = ${userId}`
  if (!video) throw Object.assign(new Error('Not found'), { status: 404 })
  const [job] = await sql`
    SELECT id, status, (CASE WHEN jsonb_typeof(to_jsonb(j)->'found') = 'array' THEN jsonb_array_length(to_jsonb(j)->'found') ELSE 0 END) AS found
    FROM ai_edit_jobs j WHERE video_id = ${videoId} ORDER BY created_at DESC LIMIT 1
  `
  if (!job || job.status !== 'confirm' || !job.found) throw Object.assign(new Error('Nothing is waiting for your answer. Press Make my clips to start again.'), { status: 409 })
  const [first] = await sql`
    SELECT payload FROM jobs WHERE type = 'ai_edit' AND payload->>'ai_edit_job_id' = ${job.id} ORDER BY created_at DESC LIMIT 1
  `
  // Only the first yes counts (a double click must not queue it twice)
  const taken = await sql`
    UPDATE ai_edit_jobs SET status = 'queued', clip_count = ${job.found}, progress = 0 WHERE id = ${job.id} AND status = 'confirm' RETURNING id
  `
  if (!taken.length) return { ai_edit_job_id: job.id as string }
  const payload = { ...(first?.payload as Record<string, unknown> ?? {}), ai_edit_job_id: job.id, video_id: videoId, clip_count: job.found, confirmed: true }
  await sql`INSERT INTO jobs (type, payload, status) VALUES ('ai_edit', ${sql.json(payload as never)}, 'queued')`
  return { ai_edit_job_id: job.id as string }
}

export interface AutoClip {
  id: string; title: string | null; start_ms: number; end_ms: number; status: string
  output_url: string | null; ai_score: number | null; ai_reason: string | null
  post_caption: string | null; hashtags: string[] | null
}

/** The video's latest AI Edit job (status, progress, error) and every clip AI Edit made from it, newest batch first */
/** Marks a stopped run (the table's statuses have no 'cancelled'); the worker watches for this exact text */
export const AI_EDIT_CANCELLED = 'Cancelled by you'

/**
 * Stops this video's running (or waiting) Make my clips run. The worker notices within a few
 * seconds and stops what it is doing; clips it already made are kept.
 */
export async function cancelAutoClips(userId: string, videoId: string) {
  const [video] = await sql`SELECT id FROM videos WHERE id = ${videoId} AND user_id = ${userId}`
  if (!video) throw Object.assign(new Error('Not found'), { status: 404 })
  const stopped = await sql`
    UPDATE ai_edit_jobs SET status = 'failed', error = ${AI_EDIT_CANCELLED}
    WHERE video_id = ${videoId} AND status IN ('queued', 'running', 'confirm')
    RETURNING id
  `
  if (!stopped.length) throw Object.assign(new Error('Nothing is running for this video'), { status: 409 })
  // Not picked up by a worker yet: take it off the queue too
  const ids = stopped.map(r => r.id as string)
  await sql`
    UPDATE jobs SET status = 'failed', error = ${AI_EDIT_CANCELLED}
    WHERE type = 'ai_edit' AND status = 'queued' AND payload->>'ai_edit_job_id' = ANY(${ids})
  `
  return { stopped: ids.length }
}

export async function getAutoClips(userId: string, videoId: string) {
  const [video] = await sql`SELECT id FROM videos WHERE id = ${videoId} AND user_id = ${userId}`
  if (!video) throw Object.assign(new Error('Not found'), { status: 404 })

  // progress / ai_score / ai_reason are read through to_jsonb so this works before the worker adds them
  const [job] = await sql`
    SELECT id, status, error, clip_count, created_at, COALESCE((to_jsonb(j)->>'progress')::int, 0) AS progress,
      (CASE WHEN jsonb_typeof(to_jsonb(j)->'found') = 'array' THEN jsonb_array_length(to_jsonb(j)->'found') ELSE 0 END) AS found_count
    FROM ai_edit_jobs j WHERE video_id = ${videoId} ORDER BY created_at DESC LIMIT 1
  `
  if (!job) return { job: null, clips: [] as AutoClip[] }

  const rows = await sql`
    SELECT c.id, c.title, c.start_ms, c.end_ms, c.status, c.output_storage_path,
      (to_jsonb(c)->>'ai_score')::int AS ai_score, to_jsonb(c)->>'ai_reason' AS ai_reason,
      to_jsonb(c)->>'post_caption' AS post_caption, to_jsonb(c)->'hashtags' AS hashtags
    FROM clips c JOIN ai_edit_jobs j ON j.id = c.ai_edit_job_id
    WHERE j.video_id = ${videoId}
    ORDER BY j.created_at DESC, (to_jsonb(c)->>'ai_score')::int DESC NULLS LAST
  `
  const clips: AutoClip[] = await Promise.all(rows.map(async r => ({
    id: r.id, title: r.title, start_ms: r.start_ms, end_ms: r.end_ms, status: r.status,
    ai_score: r.ai_score, ai_reason: r.ai_reason,
    post_caption: r.post_caption ?? null, hashtags: Array.isArray(r.hashtags) ? r.hashtags : null,
    output_url: r.status === 'done' && r.output_storage_path
      ? await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: r.output_storage_path }), { expiresIn: 43200 }).catch(() => null)
      : null,
  })))
  return {
    // found_count: the good moments a run found before it stopped to ask about making fewer clips ('confirm')
    job: { id: job.id, status: job.status, progress: job.progress, error: job.error, clip_count: job.clip_count, found_count: Number(job.found_count) || 0 },
    clips,
  }
}
