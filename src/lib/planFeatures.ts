import type { Plan } from './plans'
import { EXPORT_CREDITS, LONG_EXPORT_CREDITS } from './credits'
import { ASK_AI_EXTRA_CREDITS, REWRITES_PER_CREDIT, EXTRA_CLIP_CREDITS } from './aiLimits'

// What the pricing page says each plan gives. Every number comes from plans.ts and aiLimits.ts,
// the same values the server applies, so the page cannot promise more than the plan allows.

export type FeatureRow = { label: string; included: boolean }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function planFeatureRows(plan: Plan): FeatureRow[] {
  const ai = plan.ai
  // Free counts every clip it ever makes (videos.ts); paid plans include AI clips a month, then charge credits
  const clips: FeatureRow[] = plan.maxClips
    ? [{ label: `${plan.maxClips} clips in total`, included: true }]
    : [
        { label: 'Unlimited clips you cut yourself', included: true },
        { label: `${ai.clipsPerMonth} AI clips a month, then ${plural(EXTRA_CLIP_CREDITS, 'credit', 'credits')} each`, included: true },
      ]
  return [
    // A total, not per month: deleting a video frees its place (checkVideoQuota)
    { label: `${plural(plan.maxVideos, 'video', 'videos')} at a time`, included: true },
    { label: `Up to ${plan.maxFileSizeGb} GB per video`, included: true },
    ...clips,
    { label: `Up to ${ai.clipsPerRun} clips per Make my clips`, included: true },
    { label: `${plural(ai.searchesPerVideo, 'AI moment search', 'AI moment searches')} per video`, included: true },
    { label: `${ai.askAiPerMonth} Ask AI searches a month`, included: true },
    { label: `${ai.rewritesPerMonth} hook and title rewrites a month`, included: true },
    { label: `${plan.retentionDays} days history`, included: true },
    { label: 'Auto captions', included: plan.autoCaption },
    { label: 'No watermark', included: !plan.watermark },
    { label: 'Priority exports', included: plan.priorityExports },
  ]
}

/** The "What a credit buys" cards */
export function creditUses(): { name: string; price: string; note: string }[] {
  return [
    { name: 'AI edit', price: '1 credit per minute of video',
      note: 'Reads the whole video once. Finding moments, Make my clips, Ask AI and rewrites are then included up to your plan’s limits.' },
    { name: 'Past your plan’s AI limits', price: `${EXTRA_CLIP_CREDITS} credit per AI clip past the month’s`,
      note: `Ask AI costs ${ASK_AI_EXTRA_CREDITS} credit per Ask AI search, a new moment search 1 credit per 10 minutes of video, and rewrites 1 credit per ${REWRITES_PER_CREDIT} rewrites. You see the price before you confirm.` },
    { name: 'Manual edit', price: '1 credit per clip minute',
      note: 'For the captions of a clip you cut yourself. Cutting and editing are free.' },
    { name: 'Export', price: `${EXPORT_CREDITS} credits (${LONG_EXPORT_CREDITS} for 3 to 5 min)`,
      note: 'Per clip, in 1080p. Clips can be up to 5 minutes.' },
    { name: 'Free to use', price: '0 credits',
      note: 'The editor, captions styling, text, music, stock B-roll, brand kits and grouping.' },
  ]
}
