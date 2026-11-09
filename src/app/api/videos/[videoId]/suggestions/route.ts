import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Best moments: removed 2026-11-09 (user), kept commented: this answers that it's gone; the route as it was is below
export async function GET() {
  return NextResponse.json({ error: 'Best moments was removed' }, { status: 410 })
}

// import { NextRequest, NextResponse } from 'next/server'
// import { requireUser } from '@/server/auth'
// import { getVideoSuggestions } from '@/server/services/videos'

// export const runtime = 'nodejs'
// export const dynamic = 'force-dynamic'

// export async function GET(_req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  // const user = await requireUser()
  // if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // const { videoId } = await params
  // try {
    // return NextResponse.json(await getVideoSuggestions(user.id, videoId))
  // } catch (err: unknown) {
    // const e = err as { message?: string; status?: number }
    // return NextResponse.json({ error: e.message ?? 'Failed' }, { status: e.status ?? 500 })
  // }
// }
