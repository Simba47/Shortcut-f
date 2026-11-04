import { NextRequest, NextResponse } from 'next/server'
import { razorpayMode } from '@/lib/razorpay'
import { mockRenew } from '@/server/dev/razorpayMock'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Test helper: POST {"subscription_id": "sub_mock..."} to make the next monthly charge happen now (plan credits are granted again) */
export async function POST(req: NextRequest) {
  if (razorpayMode() !== 'mock') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = await req.json().catch(() => ({}))
  const out = await mockRenew(String(b.subscription_id ?? ''))
  return NextResponse.json(out, { status: out.ok ? 200 : 400 })
}
