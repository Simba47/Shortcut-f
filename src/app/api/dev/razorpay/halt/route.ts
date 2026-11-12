import { NextRequest, NextResponse } from 'next/server'
import { razorpayMode } from '@/lib/razorpay'
import { mockHalt } from '@/server/dev/razorpayMock'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Test helper: POST {"subscription_id": "sub_mock..."} to make renewals fail for good, so the plan ends at once */
export async function POST(req: NextRequest) {
  if (razorpayMode() !== 'mock') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = await req.json().catch(() => ({}))
  const out = await mockHalt(String(b.subscription_id ?? ''))
  return NextResponse.json(out, { status: out.ok ? 200 : 404 })
}
