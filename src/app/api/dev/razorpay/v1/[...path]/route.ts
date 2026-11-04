import { NextRequest, NextResponse } from 'next/server'
import { razorpayMode } from '@/lib/razorpay'
import { mockApi } from '@/server/dev/razorpayMock'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The fake Razorpay API (see server/dev/razorpayMock.ts): answers only in mock mode, otherwise this route does not exist */
async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  if (razorpayMode() !== 'mock') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { path } = await params
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : undefined
  const out = await mockApi(req.method, `/${path.join('/')}`, body, req.headers.get('authorization') ?? undefined)
  return NextResponse.json(out.body, { status: out.status })
}
export { handle as GET, handle as POST }
