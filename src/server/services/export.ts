import sql from '@/lib/db'
import type { RenderQuality } from '@chai-cut/shared'
import { creditsMode, exportCredits } from '@/lib/credits'
import { charge, linkJob, release, type Hold } from './credits'

// retranscribe: regenerate this clip's captions first (Gemini), then render —
// the worker queues the render once the new transcript is saved.
export async function queueRender(userId: string, clipId: string, quality: RenderQuality = '1080p', retranscribe = false, removeFillers?: boolean) {
  const [row] = await sql`
    SELECT c.id, c.status, c.start_ms, c.end_ms, v.storage_path, v.user_id
    FROM clips c JOIN videos v ON v.id = c.video_id
    WHERE c.id = ${clipId}
  `
  if (!row) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (row.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })
  if (row.status === 'rendering') throw Object.assign(new Error('Already rendering'), { status: 409 })
  if (!row.storage_path) throw Object.assign(new Error('Video not ready (no storage path)'), { status: 400 })

  // Credits: 2 for a clip up to 3 minutes, 3 up to 5 minutes, none longer (checked only when credits
  // are on, so the site behaves as before until then). Taken before anything changes, given back if
  // the export cannot be queued.
  let hold: Hold | null = null
  if (creditsMode() !== 'off') {
    hold = await charge(userId, { amount: exportCredits(row.end_ms - row.start_ms), refType: 'render', refId: clipId })
  }
  try {
    return await startRender(userId, clipId, row.storage_path as string, quality, retranscribe, removeFillers, hold)
  } catch (err) {
    if (hold) await release(hold.id).catch(e => console.error('[credits] could not give the credits back:', e))
    throw err
  }
}

async function startRender(
  userId: string, clipId: string, storagePath: string, quality: RenderQuality,
  retranscribe: boolean, removeFillers: boolean | undefined, hold: Hold | null,
) {
  // The clip's brand kit changed since it went on (a new logo, other colours): the clip follows it
  // first, so a clip exported without being opened is on-brand (brandApply.ts; never fails the export)
  const { catchUpClip } = await import('./brandApply')
  await catchUpClip(clipId)

  await sql`UPDATE clips SET status = 'rendering' WHERE id = ${clipId}`
  // "Remove pauses and filler words", as the editor shows it when exporting
  if (typeof removeFillers === 'boolean') {
    const { clipsHasRemoveFillers } = await import('./clips')
    if (await clipsHasRemoveFillers()) await sql`UPDATE clips SET remove_fillers = ${removeFillers} WHERE id = ${clipId}`
  }

  const { getUserPlanConfig } = await import('./quota')
  const plan = await getUserPlanConfig(userId)
  // user_id: the worker's fair limits (exports one person runs at once); priority: the top plan's
  // exports go to the front of the line
  const payload = { clip_id: clipId, video_storage_path: storagePath, quality, watermark: plan.watermark, user_id: userId,
    ...(plan.priorityExports ? { priority: true } : {}) }
  if (retranscribe && plan.autoCaption) {
    try {
      const { queueRetranscribe } = await import('./transcribe')
      const captionJob = await queueRetranscribe(userId, clipId, 'unknown', payload)  // 'unknown' → reuse the video's language
      // The render is queued later by the worker, so until then the export's credits follow the captions job
      if (hold && captionJob) await linkJob(hold.id, captionJob)
      return { job_id: null, retranscribing: true }
    } catch (err) {
      await sql`UPDATE clips SET status = 'draft' WHERE id = ${clipId}`
      throw err
    }
  }
  const [job] = await sql`
    INSERT INTO jobs (type, payload, status) VALUES ('render', ${sql.json(payload)}, 'queued') RETURNING id
  `
  if (!job) {
    await sql`UPDATE clips SET status = 'draft' WHERE id = ${clipId}`
    throw Object.assign(new Error('Failed to queue render job'), { status: 500 })
  }
  if (hold) await linkJob(hold.id, job.id)
  // Not awaited: the log never slows the export down
  import('./suggestionEvents').then(m => m.logClipEvents(userId, [clipId], 'exported')).catch(() => {})
  return { job_id: job.id }
}

/** Why a cancelled export's job stopped (jobs.error) */
export const RENDER_CANCELLED = 'Cancelled by the user'

/**
 * Stop an export (the editor's Cancel): its job — waiting, or running: the worker sees it within a
 * couple of seconds and stops (queue.ts) — is cancelled, and the clip goes back to how it was before:
 * its last export if it has one, else a draft. Both in one go, so the worker never sees one without
 * the other. A render still to come after its captions (render_after) isn't queued (transcribe.ts).
 */
export async function cancelRender(userId: string, clipId: string): Promise<{ status: string; output_storage_path: string | null }> {
  const [row] = await sql`
    SELECT c.status, c.output_storage_path, v.user_id FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}
  `
  if (!row) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (row.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })
  const done = await sql.begin(async tx => {
    const [clip] = await tx`
      UPDATE clips SET status = CASE WHEN output_storage_path IS NOT NULL THEN 'done' ELSE 'draft' END
      WHERE id = ${clipId} AND status = 'rendering' RETURNING status, output_storage_path
    `
    await tx`
      UPDATE jobs SET status = 'failed', error = ${RENDER_CANCELLED}
      WHERE type = 'render' AND payload->>'clip_id' = ${clipId} AND status IN ('queued', 'processing')
    `
    return clip
  })
  // (not exporting any more: finished or failed meanwhile — as it is now)
  return done ? { status: done.status, output_storage_path: done.output_storage_path } : { status: row.status, output_storage_path: row.output_storage_path }
}
