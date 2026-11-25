import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { apiError } from '@/lib/api-error'
import { creditsMode } from '@/lib/credits'
import { askAiCredits, askAiUnits, safetyFor } from '@/lib/aiLimits'
import { aiActionCounts, clipAllowance } from '@/server/services/aiUsage'
import { getUserPlan } from '@/server/services/quota'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * What the clip board shows next to its AI buttons: clips left today and for this video, saved
 * moments left, fresh searches left or their price, and what an Ask AI search costs (no monthly
 * limits since 2026-11-21; today's safety limit only). With credits off it says so and the page shows no counts.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  const mode = creditsMode()
  if (mode === 'off') return NextResponse.json({ mode })
  try {
    const [clips, actions, plan] = await Promise.all([clipAllowance(user.id, videoId), aiActionCounts(user.id), getUserPlan(user.id)])
    const units = askAiUnits(clips.durationMs)
    return NextResponse.json({
      mode, clips,
      askAi: {
        usedToday: actions.askAiToday, perDay: safetyFor(plan).askAi,
        // A search on this video: what it counts as, and its credits
        countsAs: units, nextCredits: askAiCredits(units),
      },
      rewrites: { usedThisMonth: actions.rewritesThisMonth },
    })
  } catch (err) {
    return apiError(err)
  }
}
