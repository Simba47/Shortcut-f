import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3'
import sql from '@/lib/db'
import { r2, R2_BUCKET } from '@/lib/r2'
import { hashPassword, validatePassword, verifyPassword } from '@/modules/auth/password'
import { deleteR2Keys, proxyKeyFor } from './videos'
import { getUserPlanConfig } from './quota'

/**
 * Account settings: read the profile, change the name, the profile photo and the password, delete
 * the account. Used by /api/account, /api/account/photo and /api/account/password, and the /settings page.
 */

const MAX_NAME = 60
/** The settings page sends a 256 px square JPEG (about 20 KB); this is only the ceiling */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024

/**
 * Where the browser gets the photo from: our own route (the file itself stays private in storage).
 * users.image keeps the storage key; its file name goes in ?v= so a new photo is a new address.
 */
export const photoUrl = (key: string | null) => (key?.startsWith('avatars/') ? `/api/account/photo?v=${key.split('/').pop()!.slice(0, 8)}` : null)

export interface AccountInfo {
  email: string
  name: string | null
  /** The profile photo's address, when one was added */
  image: string | null
  /** When the email was confirmed (signup OTP) */
  emailVerified: string | null
  planName: string
  /** Signed up with a password (not only a sign-in provider), so it can be changed here */
  hasPassword: boolean
}

export async function getAccount(userId: string): Promise<AccountInfo> {
  const [row] = await sql<{ email: string; name: string | null; image: string | null; emailVerified: Date | null; password_hash: string | null }[]>`
    SELECT email, name, image, "emailVerified", password_hash FROM users WHERE id = ${userId}
  `
  if (!row) throw Object.assign(new Error('Account not found'), { status: 404 })
  const plan = await getUserPlanConfig(userId)
  return {
    email: row.email,
    name: row.name,
    image: photoUrl(row.image),
    emailVerified: row.emailVerified ? new Date(row.emailVerified).toISOString() : null,
    planName: plan.name,
    hasPassword: !!row.password_hash,
  }
}

/** Your name, as shown on the profile button and menu. Empty clears it (the email's name shows). */
export async function updateName(userId: string, raw: unknown): Promise<string | null> {
  if (typeof raw !== 'string') throw Object.assign(new Error('Name must be text'), { status: 400 })
  // One line, no control characters, trimmed
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  if (name.length > MAX_NAME) throw Object.assign(new Error(`Keep your name under ${MAX_NAME} characters`), { status: 400 })
  const value = name || null
  await sql`UPDATE users SET name = ${value} WHERE id = ${userId}`
  return value
}

/** The picture's real type, read from its first bytes (the browser's word for it isn't trusted) */
function photoType(b: Buffer): { ext: string; contentType: string } | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', contentType: 'image/jpeg' }
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', contentType: 'image/png' }
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { ext: 'webp', contentType: 'image/webp' }
  return null
}

/** Set the profile photo: stored under avatars/<user>/, the one before it deleted. Returns its address. */
export async function savePhoto(userId: string, file: File): Promise<string> {
  if (file.size > MAX_PHOTO_BYTES) throw Object.assign(new Error('That photo is too large. Choose one under 2 MB.'), { status: 400 })
  const body = Buffer.from(await file.arrayBuffer())
  const type = photoType(body)
  if (!type) throw Object.assign(new Error('Choose a JPG, PNG or WebP photo'), { status: 400 })

  const key = `avatars/${userId}/${crypto.randomUUID()}.${type.ext}`
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: type.contentType }))
  const [old] = await sql<{ image: string | null }[]>`SELECT image FROM users WHERE id = ${userId}`
  await sql`UPDATE users SET image = ${key} WHERE id = ${userId}`
  if (old?.image?.startsWith(`avatars/${userId}/`)) await deleteR2Keys([old.image])
  return photoUrl(key)!
}

/** Remove the profile photo */
export async function removePhoto(userId: string): Promise<void> {
  const [old] = await sql<{ image: string | null }[]>`SELECT image FROM users WHERE id = ${userId}`
  await sql`UPDATE users SET image = NULL WHERE id = ${userId}`
  if (old?.image?.startsWith(`avatars/${userId}/`)) await deleteR2Keys([old.image])
}

/** The profile photo's address as saved now (null: none added) — the profile button checks it against the session's */
export async function getPhotoUrl(userId: string): Promise<string | null> {
  const [row] = await sql<{ image: string | null }[]>`SELECT image FROM users WHERE id = ${userId}`
  return photoUrl(row?.image ?? null)
}

/** The profile photo's bytes, for /api/account/photo (null: none added) */
export async function readPhoto(userId: string): Promise<{ body: Uint8Array; contentType: string } | null> {
  const [row] = await sql<{ image: string | null }[]>`SELECT image FROM users WHERE id = ${userId}`
  // Only our own stored photos: never fetch an address that got into the column some other way
  if (!row?.image?.startsWith(`avatars/${userId}/`)) return null
  try {
    const obj = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: row.image }))
    if (!obj.Body) return null
    return { body: await obj.Body.transformToByteArray(), contentType: obj.ContentType ?? 'image/jpeg' }
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') return null
    throw err
  }
}

/** Change the password: the current one must be right, and the new one must pass the same rules as signup */
export async function changePassword(userId: string, current: unknown, next: unknown): Promise<void> {
  if (typeof current !== 'string' || typeof next !== 'string' || !current || !next) {
    throw Object.assign(new Error('Enter your current password and a new one'), { status: 400 })
  }
  const [row] = await sql<{ password_hash: string | null }[]>`SELECT password_hash FROM users WHERE id = ${userId}`
  if (!row?.password_hash) throw Object.assign(new Error('This account has no password to change'), { status: 400 })
  if (!(await verifyPassword(current, row.password_hash))) {
    throw Object.assign(new Error('Your current password is not right'), { status: 400 })
  }
  if (current === next) throw Object.assign(new Error('Choose a password different from the current one'), { status: 400 })
  const problem = validatePassword(next)
  if (problem) throw Object.assign(new Error(problem), { status: 400 })
  await sql`UPDATE users SET password_hash = ${await hashPassword(next)} WHERE id = ${userId}`
}

/**
 * Delete the account and everything in it, for good: every stored file (uploads, their cached
 * audio, every clip's export), then every row that belongs to the user (videos with their clips,
 * subscriptions, logs…), then the user. Needs the password (when the account has one) as a check.
 */
export async function deleteAccount(userId: string, password: unknown): Promise<void> {
  const [row] = await sql<{ email: string; password_hash: string | null }[]>`SELECT email, password_hash FROM users WHERE id = ${userId}`
  if (!row) throw Object.assign(new Error('Account not found'), { status: 404 })
  if (row.password_hash) {
    if (typeof password !== 'string' || !(await verifyPassword(password, row.password_hash))) {
      throw Object.assign(new Error('Your password is not right'), { status: 400 })
    }
  }
  await purgeAccount(userId)
}

/**
 * The account and everything in it, deleted for good: its files, then every row pointing at it, then the user. Run by
 * Delete account in Settings (after the password), and for an account Shortcut's admin deleted once its 30 days to
 * restore it are over (accountDeletion.ts).
 */
export async function purgeAccount(userId: string): Promise<void> {
  const [row] = await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${userId}`
  if (!row) return

  // Files first (best effort: a missing file shouldn't keep the account alive)
  const videos = await sql<{ storage_path: string | null }[]>`SELECT storage_path FROM videos WHERE user_id = ${userId}`
  const clipOutputs = await sql<{ output_storage_path: string }[]>`
    SELECT c.output_storage_path FROM clips c JOIN videos v ON v.id = c.video_id
    WHERE v.user_id = ${userId} AND c.output_storage_path IS NOT NULL
  `
  const keys: string[] = []
  for (const v of videos) {
    if (!v.storage_path) continue
    // (_audio.flac: the sound kept for captions; _reading.json: a whole-video reading that stopped part-way)
    keys.push(v.storage_path, v.storage_path.replace(/\.[^.]+$/, '_audio.flac'), v.storage_path.replace(/\.[^.]+$/, '_reading.json'), proxyKeyFor(v.storage_path))
  }
  for (const c of clipOutputs) keys.push(c.output_storage_path)
  keys.push(...await listR2Keys(`overlays/${userId}/`), ...await listR2Keys(`avatars/${userId}/`))
  await deleteR2Keys(keys)

  // Then every row pointing at the user, found from the database's own foreign keys (so a table
  // added later is covered too), then the user. One transaction: all of it or none of it.
  await sql.begin(async tx => {
    const refs = await tx<{ tbl: string; col: string }[]>`
      SELECT cl.relname AS tbl, att.attname AS col
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = ANY(c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass
    `
    // Videos first: their clips, formats, captions… go with them (cascade)
    refs.sort((a, b) => (a.tbl === 'videos' ? -1 : b.tbl === 'videos' ? 1 : 0))
    for (const r of refs) await tx`DELETE FROM ${tx(r.tbl)} WHERE ${tx(r.col)} = ${userId}`
    // Tables that keep user_id without a foreign key
    await tx`DELETE FROM videos WHERE user_id = ${userId}`
    for (const t of ['subscriptions', 'suggestion_events']) {
      const [has] = await tx`SELECT 1 FROM information_schema.columns WHERE table_name = ${t} AND column_name = 'user_id'`
      if (has) await tx`DELETE FROM ${tx(t)} WHERE user_id = ${userId}`
    }
    // Sign-in codes are kept by email, not user id
    await tx`DELETE FROM verification_otps WHERE email = ${row.email}`
    await tx`DELETE FROM users WHERE id = ${userId}`
  })
}

/** Every stored file under a folder, e.g. the images and logos a user added in the editor (best effort) */
async function listR2Keys(prefix: string): Promise<string[]> {
  const keys: string[] = []
  let token: string | undefined
  try {
    do {
      const page = await r2.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token }))
      for (const o of page.Contents ?? []) if (o.Key) keys.push(o.Key)
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
  } catch {}
  return keys
}
