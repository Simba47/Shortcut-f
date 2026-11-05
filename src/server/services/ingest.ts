import {
  PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, CreateMultipartUploadCommand, UploadPartCommand,
  CompleteMultipartUploadCommand, ListPartsCommand, AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2, R2_BUCKET } from '@/lib/r2'
import sql from '@/lib/db'
import { ACCEPTED_VIDEO_EXTENSIONS } from '@chai-cut/shared'

const err = (message: string, status: number) => Object.assign(new Error(message), { status })

// ── Import from a link ────────────────────────────────────────────────────────
// Google Drive and Dropbox share links download fine from our servers. YouTube and other sites
// need yt-dlp from a home internet connection (they block data-centre IPs), so they're not
// offered yet.

export type LinkSource = 'gdrive' | 'dropbox'

export function linkSourceOf(url: URL): LinkSource | 'youtube' | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'drive.google.com' || host === 'docs.google.com' || host === 'drive.usercontent.google.com') return 'gdrive'
  if (host === 'dropbox.com' || host.endsWith('.dropbox.com') || host === 'db.tt') return 'dropbox'
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return 'youtube'
  return null
}

export async function ingestLink(userId: string, rawUrl: string) {
  let url: URL
  try { url = new URL(rawUrl) } catch {
    throw err('Please paste a valid link.', 400)
  }
  const source = linkSourceOf(url)
  if (source === 'youtube') {
    throw err('Importing from YouTube is coming soon. For now, upload the file or paste a Google Drive or Dropbox link.', 400)
  }
  if (!source) {
    throw err('Paste a Google Drive or Dropbox link to a video file, or upload the file.', 400)
  }
  if (source === 'gdrive' && /\/(drive\/)?folders\//.test(url.pathname)) {
    throw err('That\'s a folder link. Open the video in Google Drive and copy its own link.', 400)
  }

  const { checkVideoQuota, getUserPlanConfig } = await import('./quota')
  const { checkBeforeUpload, recordReading } = await import('./readingUsage')
  await checkVideoQuota(userId)
  await checkBeforeUpload(userId, null)
  const plan = await getUserPlanConfig(userId)

  const [video] = await sql`
    INSERT INTO videos (user_id, source_type, source_url, status)
    VALUES (${userId}, 'link', ${url.toString()}, 'uploaded')
    RETURNING id
  `
  if (!video) throw err('Failed to create video record', 500)
  await recordReading(userId, video.id, null)

  // Every link import needs this job: it downloads the file (on every plan). Captions are not
  // made here: they cost money, so they're made when someone asks (captions switched on in the
  // editor, Make my clips, Best moments, Ask AI).
  // max_bytes: the worker stops downloads bigger than the plan allows.
  const payload = { video_id: video.id, storage_path: '', link_source: source, max_bytes: plan.maxFileSizeBytes, transcribe_full: false }
  await sql`INSERT INTO jobs (type, payload, status) VALUES ('transcribe', ${sql.json(payload)}, 'queued')`

  return { video_id: video.id }
}

// ── Direct upload to R2 (browser → R2, resumable) ─────────────────────────────
// The browser (Uppy) asks us to sign each S3 request of its upload. A new upload gets its key
// here, after the plan checks; every later request must be for one of this user's own uploads.

export interface SignUploadRequest {
  method: 'PUT' | 'POST' | 'GET' | 'DELETE'
  key: string
  uploadId?: string
  partNumber?: number
  /** Several parts signed in one go (PUT): up to 100 part numbers */
  partNumbers?: number[]
  /** The file being uploaded — needed to start an upload (duration_ms when the browser could read it) */
  file?: { name: string; size: number; type?: string; duration_ms?: number }
  /** B-roll uploaded in the editor: saved as an asset (not on the dashboard, not counted as a video) */
  asset?: boolean
}

const UPLOAD_URL_TTL_S = 3600

function uploadExtension(filename: string) {
  const ext = '.' + (filename.split('.').pop() ?? '').toLowerCase()
  if (!ACCEPTED_VIDEO_EXTENSIONS.includes(ext as never)) {
    throw err('That file type isn\'t supported. Please upload an MP4, MOV, MKV or WebM.', 415)
  }
  return ext
}

export async function signUploadRequest(userId: string, r: SignUploadRequest): Promise<{ url: string; key?: string; headers?: Record<string, string> } | { urls: Record<string, string> }> {
  const startsUpload = !r.uploadId && (r.method === 'POST' || r.method === 'PUT')
  if (startsUpload) {
    if (!r.file?.name || !(r.file.size > 0)) throw err('File details missing', 400)
    const ext = uploadExtension(r.file.name)
    const { checkVideoQuota, checkFileSizeQuota, checkBrollSize } = await import('./quota')
    if (r.asset === true) {
      await checkBrollSize(userId, r.file.size)
    } else {
      await checkVideoQuota(userId)
      await checkFileSizeQuota(userId, r.file.size)
      const { checkBeforeUpload } = await import('./readingUsage')
      await checkBeforeUpload(userId, typeof r.file.duration_ms === 'number' ? r.file.duration_ms : null)
    }
    const key = `raw/${userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`
    const contentType = r.file.type || 'video/mp4'
    const command = r.method === 'POST'
      ? new CreateMultipartUploadCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType })
      : new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType })
    const url = await getSignedUrl(r2, command, { expiresIn: UPLOAD_URL_TTL_S })
    return { url, key, headers: { 'Content-Type': contentType } }
  }

  // Everything else continues an upload: only ever one of this user's own
  if (typeof r.key !== 'string' || !r.key.startsWith(`raw/${userId}/`) || r.key.includes('..')) throw err('Not your upload', 403)
  const Key = r.key
  if (r.uploadId) {
    const UploadId = r.uploadId
    if (r.method === 'PUT' && Array.isArray(r.partNumbers)) {
      // A batch of parts at once (the uploader asks ahead: one request instead of one per part)
      const nums = r.partNumbers.map(Number)
      if (!nums.length || nums.length > 100 || nums.some(n => !Number.isInteger(n) || n < 1 || n > 10000)) throw err('Invalid part numbers', 400)
      const urls: Record<string, string> = {}
      await Promise.all(nums.map(async PartNumber => {
        urls[PartNumber] = await getSignedUrl(r2, new UploadPartCommand({ Bucket: R2_BUCKET, Key, UploadId, PartNumber }), { expiresIn: UPLOAD_URL_TTL_S })
      }))
      return { urls }
    }
    if (r.method === 'PUT') {
      const PartNumber = Number(r.partNumber)
      if (!Number.isInteger(PartNumber) || PartNumber < 1 || PartNumber > 10000) throw err('Invalid part number', 400)
      return { url: await getSignedUrl(r2, new UploadPartCommand({ Bucket: R2_BUCKET, Key, UploadId, PartNumber }), { expiresIn: UPLOAD_URL_TTL_S }) }
    }
    if (r.method === 'GET') return { url: await getSignedUrl(r2, new ListPartsCommand({ Bucket: R2_BUCKET, Key, UploadId }), { expiresIn: UPLOAD_URL_TTL_S }) }
    if (r.method === 'POST') return { url: await getSignedUrl(r2, new CompleteMultipartUploadCommand({ Bucket: R2_BUCKET, Key, UploadId }), { expiresIn: UPLOAD_URL_TTL_S }) }
    if (r.method === 'DELETE') return { url: await getSignedUrl(r2, new AbortMultipartUploadCommand({ Bucket: R2_BUCKET, Key, UploadId }), { expiresIn: UPLOAD_URL_TTL_S }) }
  }
  if (r.method === 'DELETE') {
    // Only a finished upload that was never turned into a video (e.g. cancelled at the last
    // step) — never the file behind one of the user's videos
    const [inUse] = await sql`SELECT 1 FROM videos WHERE storage_path = ${Key} LIMIT 1`
    if (inUse) throw err('That upload belongs to a video; delete the video instead.', 409)
    return { url: await getSignedUrl(r2, new DeleteObjectCommand({ Bucket: R2_BUCKET, Key }), { expiresIn: UPLOAD_URL_TTL_S }) }
  }
  throw err('Unsupported upload request', 400)
}

// Uploads used to go through two older routes (/api/ingest/upload, which held the whole file in
// server memory, and /api/ingest/signed-url, a single PUT capped at 5 GB). Both were replaced by
// the resumable upload above (useVideoUpload + signUploadRequest) and removed.

/** `asset`: B-roll uploaded in the editor — kept off the dashboard and out of the plan's video count */
export async function completeUpload(userId: string, storagePath: string, durationMs?: number, title?: string, asset = false) {
  // Only a file this user uploaded (it could otherwise claim someone else's upload)
  if (!storagePath.startsWith(`raw/${userId}/`) || storagePath.includes('..')) throw err('Not your upload', 403)
  // Already turned into a video (e.g. the reply was lost and the browser asked again): answer
  // with that video instead of making a second one that shares its file
  const [existing] = await sql`SELECT id FROM videos WHERE storage_path = ${storagePath} AND user_id = ${userId} LIMIT 1`
  if (existing) return { video_id: existing.id as string }
  let size = 0
  try {
    const head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: storagePath }))
    size = head.ContentLength ?? 0
  } catch {
    throw err('Your upload couldn\'t be verified — please try uploading again.', 404)
  }

  // Check the file as it actually arrived (the size the browser reported could be wrong), and the
  // video count again (it was checked when the upload started, which may be a while ago)
  const { checkVideoQuota, checkFileSizeQuota, checkBrollSize } = await import('./quota')
  const { checkBeforeUpload, recordReading } = await import('./readingUsage')
  try {
    if (asset) {
      await checkBrollSize(userId, size)
    } else {
      await checkFileSizeQuota(userId, size)
      await checkVideoQuota(userId)
      await checkBeforeUpload(userId, durationMs ?? null)
    }
  } catch (e) {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: storagePath })).catch(() => {})
    throw e
  }

  const [video] = await sql`
    INSERT INTO videos (user_id, source_type, storage_path, status, duration_ms, title, role)
    VALUES (${userId}, 'upload', ${storagePath}, 'ready', ${durationMs ?? null}, ${title?.trim().slice(0, 120) || null},
      ${asset ? 'asset' : 'project'})
    RETURNING id
  `
  if (!video) throw err('Failed to create video record', 500)
  if (!asset) {
    // Counted now, whatever is done with the video after. Credits spent between the check above and
    // here: the upload is taken back, as if the check had said so.
    try {
      await recordReading(userId, video.id, durationMs ?? null)
    } catch (e) {
      await sql`DELETE FROM videos WHERE id = ${video.id}`
      await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: storagePath })).catch(() => {})
      throw e
    }
  }

  // Every upload gets a worker job: it fills in the length when the browser couldn't read it
  // (e.g. MKV or iPhone HEVC files). No captions here: they're made when someone asks for them
  // (captions switched on in the editor, Make my clips, Best moments, Ask AI)
  const payload = { video_id: video.id, storage_path: storagePath, transcribe_full: false }
  await sql`INSERT INTO jobs (type, payload, status) VALUES ('transcribe', ${sql.json(payload)}, 'queued')`
  return { video_id: video.id }
}
