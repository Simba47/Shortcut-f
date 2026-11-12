import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Media ▸ Memes: hidden 2026-11-13 (user) until the meme libraries approve; the route as it was is below
export async function GET() {
  return NextResponse.json({ error: 'Memes is switched off for now' }, { status: 410 })
}

// import { NextRequest, NextResponse } from 'next/server'
// import { requireUser } from '@/server/auth'
// import { searchImgflip } from '@/server/services/memes'
// import { apiError } from '@/lib/api-error'

// export const runtime = 'nodejs'
// export const dynamic = 'force-dynamic'

// // Imgflip meme templates (Media ▸ Memes): ?q=distracted — all of Imgflip with API Premium, else its top 100
// export async function GET(req: NextRequest) {
//   const user = await requireUser()
//   if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
//   try {
//     return NextResponse.json(await searchImgflip(req.nextUrl.searchParams.get('q') ?? ''))
//   } catch (err) {
//     return apiError(err)
//   }
// }
