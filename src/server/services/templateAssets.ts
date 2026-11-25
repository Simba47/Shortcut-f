import sharp from 'sharp'
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2, R2_BUCKET } from '@/lib/r2'

/**
 * The Templates tool's pictures (lib/shared/templates.ts), as photos on the clip so the export draws them
 * like any other: the platforms' icons (made once, shared by everyone) and a person's photo or logo cut
 * round. Made here with sharp, kept in R2.
 */

const SIZE = 512

/**
 * The platforms' official marks as their brand guides give them, unchanged in shape and colour: Instagram's
 * glyph on its gradient, YouTube's red play button (on a white disc, so it reads on any photo)
 */
const ICONS: Record<'instagram' | 'youtube' | 'whatsapp', string> = {
  instagram: `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs>
      <radialGradient id="g" cx="0.3" cy="1.07" r="1.3">
        <stop offset="0" stop-color="#fdf497"/><stop offset="0.05" stop-color="#fdf497"/>
        <stop offset="0.45" stop-color="#fd5949"/><stop offset="0.6" stop-color="#d6249f"/><stop offset="0.9" stop-color="#285AEB"/>
      </radialGradient>
    </defs>
    <rect x="16" y="16" width="480" height="480" rx="120" fill="url(#g)" stroke="#ffffff" stroke-width="24"/>
    <rect x="128" y="128" width="256" height="256" rx="72" fill="none" stroke="#ffffff" stroke-width="30"/>
    <circle cx="256" cy="256" r="62" fill="none" stroke="#ffffff" stroke-width="30"/>
    <circle cx="335" cy="177" r="19" fill="#ffffff"/>
  </svg>`,
  youtube: `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <circle cx="256" cy="256" r="244" fill="#ffffff"/>
    <path d="M427 176c-4-15-16-27-31-31-27-7-140-7-140-7s-113 0-140 7c-15 4-27 16-31 31-7 27-7 80-7 80s0 53 7 80c4 15 16 27 31 31 27 7 140 7 140 7s113 0 140-7c15-4 27-16 31-31 7-27 7-80 7-80s0-53-7-80z" fill="#FF0000"/>
    <path d="M222 304l94-48-94-48z" fill="#ffffff"/>
  </svg>`,
  // WhatsApp's mark: the white speech bubble with the handset, on its green
  whatsapp: `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <circle cx="256" cy="256" r="246" fill="#25D366" stroke="#ffffff" stroke-width="16"/>
    <path d="M256 104c-84 0-152 66-152 148 0 29 9 57 24 80l-17 62 64-17c24 13 52 21 81 21 84 0 152-66 152-148s-68-146-152-146z" fill="none" stroke="#ffffff" stroke-width="24" stroke-linejoin="round"/>
    <path d="M206 178c-6-1-12 0-17 5-9 9-18 21-17 38 2 29 21 60 47 84 26 24 58 40 86 41 17 1 29-8 38-17 5-5 6-11 4-17l-7-21c-2-5-7-8-12-7l-33 6c-4 1-8 4-10 8l-6 12c-25-12-45-31-58-56l12-6c4-2 7-6 8-10l6-33c1-5-2-10-7-12z" fill="#ffffff"/>
  </svg>`,
}
export type TemplateIcon = keyof typeof ICONS
export const isTemplateIcon = (x: unknown): x is TemplateIcon => x === 'instagram' || x === 'youtube' || x === 'whatsapp'

const sign = (key: string) => getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 43200 })

/** A platform's icon in R2 (made the first time it's asked for) */
export async function templateIcon(name: TemplateIcon): Promise<{ storage_path: string; preview_url: string }> {
  const key = `templates/icons/${name}-v1.png`
  const there = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })).then(() => true, () => false)
  if (!there) {
    const png = await sharp(Buffer.from(ICONS[name])).resize(SIZE, SIZE).png().toBuffer()
    await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: png, ContentType: 'image/png', CacheControl: 'public, max-age=31536000' }))
  }
  return { storage_path: key, preview_url: await sign(key) }
}

/**
 * A photo or logo cut into a circle with a white ring (a person's photo fills it; a logo sits inside it on
 * white), saved as the user's own photo
 */
export async function roundPhoto(userId: string, input: Buffer, fit: 'cover' | 'contain'): Promise<{ storage_path: string; preview_url: string }> {
  const ring = 14, inner = SIZE - ring * 2
  const pic = await sharp(input).rotate()
    .resize(fit === 'cover' ? inner : Math.round(inner * 0.72), fit === 'cover' ? inner : Math.round(inner * 0.72), { fit: fit === 'cover' ? 'cover' : 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png().toBuffer()
  const disc = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2}" fill="#ffffff"/></svg>`)
  const hole = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}"><circle cx="${inner / 2}" cy="${inner / 2}" r="${inner / 2}" fill="#000"/></svg>`)
  // The picture inside the circle (a logo on white), then the white disc round it for the ring
  const base = await sharp({ create: { width: inner, height: inner, channels: 4, background: fit === 'cover' ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: pic, gravity: 'center' }]).png().toBuffer()
  const round = await sharp(base).composite([{ input: hole, blend: 'dest-in' }]).png().toBuffer()
  const png = await sharp(disc).composite([{ input: round, left: ring, top: ring }]).png().toBuffer()
  const key = `overlays/${userId}/${crypto.randomUUID()}--template-photo.png`
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: png, ContentType: 'image/png' }))
  return { storage_path: key, preview_url: await sign(key) }
}

/** A stored picture's bytes (the user's own photo, or a brand kit's logo they can use) */
export async function storedPicture(key: string): Promise<Buffer> {
  const res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }))
  const bytes = await res.Body?.transformToByteArray()
  if (!bytes?.length) throw Object.assign(new Error('That picture is not there any more'), { status: 404, expose: true })
  return Buffer.from(bytes)
}
