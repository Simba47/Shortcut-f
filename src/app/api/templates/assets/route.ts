import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { apiError } from '@/lib/api-error'
import { isTemplateIcon, roundPhoto, storedPicture, templateIcon } from '@/server/services/templateAssets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 15 * 1024 * 1024

/**
 * The Templates tool's pictures (services/templateAssets.ts):
 *  - JSON { icon: 'instagram' | 'youtube' }: the platform's icon
 *  - JSON { from: storage_path, fit }: a stored picture of theirs (their own photo, or a brand kit logo they
 *    can use) cut round
 *  - form with `file` (and `fit`): a new photo from their device, cut round
 * Each answers { storage_path, preview_url }.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file') as File | null
      if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
      if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That photo is too big (15 MB at most)' }, { status: 413 })
      const fit = form.get('fit') === 'contain' ? 'contain' : 'cover'
      return NextResponse.json(await roundPhoto(user.id, Buffer.from(await file.arrayBuffer()), fit))
    }
    const body = await req.json().catch(() => ({})) as { icon?: unknown; from?: unknown; fit?: unknown }
    if (isTemplateIcon(body.icon)) return NextResponse.json(await templateIcon(body.icon))
    if (typeof body.from === 'string' && body.from.length < 400) {
      const from = body.from
      // Only pictures that are theirs: their own photos and logos, or the logo of a brand kit they can use
      let allowed = from.startsWith(`overlays/${user.id}/`) || from.startsWith(`brand/${user.id}/`)
      if (!allowed && from.startsWith('brand/')) {
        const { listBrandKits } = await import('@/server/services/brandKits')
        allowed = (await listBrandKits(user.id)).kits.some(k => k.data.logo.path === from)
      }
      if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(await roundPhoto(user.id, await storedPicture(from), body.fit === 'contain' ? 'contain' : 'cover'))
    }
    return NextResponse.json({ error: 'Nothing to make' }, { status: 400 })
  } catch (err) {
    return apiError(err)
  }
}
