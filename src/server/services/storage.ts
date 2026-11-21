import { HeadObjectCommand } from '@aws-sdk/client-s3'
import sql from '@/lib/db'
import { r2, R2_BUCKET } from '@/lib/r2'
import { PLANS, isTopPlan } from '@/lib/plans'
import { formatStorage } from '@/lib/storage'
import { getUserPlan, NO_PLAN_MESSAGE } from './quota'

// What a plan holds at once (plans v2, user 2026-11-21: Trial 5 GB, Starter 15 GB, Pro 30 GB): the total
// size of the user's videos' own files, the upload or the link's download. B-roll and overlay files
// added in the editor (role 'asset', each at most 500 MB) and the editing copies and exports made from a
// video are not counted. Deleting a video frees its space (and, from step 3, a video that expires).
//
// Each video's size is kept on it (videos.file_size): written at upload; for one made before, or a link
// import, taken from what is already known (the download's total, the reading's file size) or, failing
// that, asked of storage once.

const fail = (message: string, status: number) => Object.assign(new Error(message), { status, expose: true })

let ready: Promise<void> | null = null
export function ensureStorageSchema(): Promise<void> {
  ready ??= (async () => {
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS file_size BIGINT`
    // (the link import's columns: the worker and ingest.ts add them too)
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS download_total BIGINT`
  })().catch(e => { ready = null; throw e })
  return ready
}

/** Asked of storage at most this many at a time (a user's older videos, once each) */
const HEAD_BATCH = 20

/** Sizes not written yet: from what is known, else from storage. A file that is gone counts 0. */
async function fillSizes(userId: string): Promise<void> {
  await ensureStorageSchema()
  // A link import: its download's total. An upload: the size its reading wrote down.
  await sql`
    UPDATE videos SET file_size = download_total
    WHERE user_id = ${userId} AND file_size IS NULL AND download_total IS NOT NULL AND storage_path IS NOT NULL AND storage_path <> ''`
  await sql`
    UPDATE videos v SET file_size = r.file_size FROM reading_usage r
    WHERE r.video_id = v.id AND r.file_size IS NOT NULL AND v.user_id = ${userId} AND v.file_size IS NULL AND v.storage_path IS NOT NULL AND v.storage_path <> ''`
    .catch(() => { /* no reading_usage table yet (a new database): storage answers instead */ })
  const left = await sql<{ id: string; storage_path: string }[]>`
    SELECT id, storage_path FROM videos
    WHERE user_id = ${userId} AND file_size IS NULL AND storage_path IS NOT NULL AND storage_path <> '' AND role IS DISTINCT FROM 'asset'
    LIMIT ${HEAD_BATCH}`
  await Promise.all(left.map(async v => {
    let size = 0
    try {
      size = (await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: v.storage_path }))).ContentLength ?? 0
    } catch (e) {
      // Not there (deleted from storage): 0. Storage not reachable: left unknown, asked again next time
      const code = (e as { name?: string; $metadata?: { httpStatusCode?: number } })
      if (code?.name !== 'NotFound' && code?.$metadata?.httpStatusCode !== 404) return
    }
    await sql`UPDATE videos SET file_size = ${size} WHERE id = ${v.id} AND file_size IS NULL`
  }))
}

/**
 * Bytes this user's videos hold: each one's file (a link still downloading counts what it will be, so two
 * imports at once can't both pass). `exceptVideoId`: left out (the video being checked itself).
 */
export async function storageUsed(userId: string, exceptVideoId: string | null = null): Promise<number> {
  await fillSizes(userId)
  const [r] = await sql<{ used: string }[]>`
    SELECT COALESCE(SUM(COALESCE(file_size, download_total, 0)), 0) AS used FROM videos
    WHERE user_id = ${userId} AND role IS DISTINCT FROM 'asset'
      AND (storage_path IS NOT NULL AND storage_path <> '' OR status IS DISTINCT FROM 'failed')
      AND (${exceptVideoId}::uuid IS NULL OR id <> ${exceptVideoId}::uuid)`
  return Number(r.used)
}

/** The plan's storage and what is used of it */
export async function storageSummary(userId: string): Promise<{ usedBytes: number; limitBytes: number; limitGb: number }> {
  const plan = PLANS[await getUserPlan(userId)]
  return { usedBytes: await storageUsed(userId), limitBytes: plan.storageBytes, limitGb: plan.storageGb }
}

/** What a refusal adds: a way to more space (none past Pro, the top plan) */
function moreSpace(planKey: string): string {
  return isTopPlan(planKey) ? 'Delete a video to make room.' : 'Delete a video to make room, or upgrade for more space.'
}

/**
 * Refuses a video that would not fit: no plan, the storage already full, or this file (`addBytes`; 0 when
 * not known yet, a link) bigger than what is free. `exceptVideoId`: the video itself, when it is already a
 * row (a link import waiting for the OK). Returns the bytes still free after it.
 */
export async function checkStorage(userId: string, addBytes: number, exceptVideoId: string | null = null): Promise<number> {
  const key = await getUserPlan(userId)
  if (key === 'free') throw fail(NO_PLAN_MESSAGE, 403)
  const plan = PLANS[key]
  const used = await storageUsed(userId, exceptVideoId)
  const free = Math.max(0, plan.storageBytes - used)
  if (free <= 0) {
    throw fail(`Your ${plan.storageGb} GB of storage is full (${formatStorage(used)} used). ${moreSpace(key)}`, 403)
  }
  if (addBytes > free) {
    throw fail(`This video is ${formatStorage(addBytes)}, and ${formatStorage(free)} of your ${plan.storageGb} GB is free. ${moreSpace(key)}`, 403)
  }
  return free - Math.max(0, addBytes)
}

/** The message the worker shows when a link's file turns out bigger than what is free (or than the plan's file limit) */
export function linkTooBigMessage(planKey: string, maxBytes: number, byStorage: boolean): string {
  const plan = PLANS[planKey as keyof typeof PLANS] ?? PLANS.free
  return byStorage
    ? `This video is bigger than the ${formatStorage(maxBytes)} free of your ${plan.storageGb} GB. ${moreSpace(planKey)}`
    : `This video is bigger than your plan's ${plan.maxFileSizeGb} GB limit for one video.`
}
