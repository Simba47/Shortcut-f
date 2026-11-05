import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { r2, R2_BUCKET } from '@/lib/r2'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { cancelRender } from '@/server/services/export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The editor's Cancel while exporting: the export stops; the clip as it was before (its last export, if any) */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    const { status, output_storage_path } = await cancelRender(user.id, clipId)
    const output_url = status === 'done' && output_storage_path
      ? await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: output_storage_path }), { expiresIn: 43200 }).catch(() => null)
      : null
    return NextResponse.json({ status, output_url })
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    return NextResponse.json({ error: e.message ?? 'Failed' }, { status: e.status ?? 500 })
  }
}
