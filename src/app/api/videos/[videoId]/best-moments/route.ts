import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Best moments: removed 2026-11-09 (user), kept commented: this answers that it's gone; the route as it was is below
export async function POST() {
  return NextResponse.json({ error: 'Best moments was removed' }, { status: 410 })
}

// import { NextRequest, NextResponse } from 'next/server'
// import { requireUser } from '@/server/auth'
// import { addBestMoments, getVideoSuggestions } from '@/server/services/videos'
// import { apiError } from '@/lib/api-error'

// export const runtime = 'nodejs'
// export const dynamic = 'force-dynamic'

// // "Find best moments": AI finds new moments and saves each as a draft clip (Best moments section)
// // ?list=1: just the moments, to pick from (nothing saved); body { exclude: [[start, end], …] } skips
// // ones already listed so "View more" finds new ones
// export async function POST(req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  // const user = await requireUser()
  // if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // const { videoId } = await params
  // try {
    // if (req.nextUrl.searchParams.get('list') === '1') {
      // const body = await req.json().catch(() => ({}))
      // const exclude = Array.isArray(body?.exclude)
        // ? (body.exclude as unknown[]).filter((r): r is [number, number] => Array.isArray(r) && r.length === 2 && r.every(n => typeof n === 'number')).slice(0, 200)
        // : []
      // const { suggestions } = await getVideoSuggestions(user.id, videoId, exclude)
      // return NextResponse.json({ moments: suggestions, limitMessage: null })
    // }
    // return NextResponse.json(await addBestMoments(user.id, videoId))
  // } catch (err) {
    // return apiError(err)
  // }
// }
