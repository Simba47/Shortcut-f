import type { Plan } from './plans'
import { CAPTION_CREDITS_PER_MINUTE, EXPORT_CREDITS_PER_MINUTE, EXTRA_READING_CREDITS } from './credits'
import { ASK_AI_EXTRA_CREDITS, REWRITES_PER_CREDIT, EXTRA_CLIP_CREDITS } from './aiLimits'

// What the pricing page says each plan gives. Every number comes from plans.ts and aiLimits.ts,
// the same values the server applies, so the page cannot promise more than the plan allows.

export type FeatureRow = { label: string; included: boolean }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** A plan's reading: "3 hours", or "30 minutes" under an hour */
export function readingLabel(minutes: number): string {
  return minutes >= 60 ? plural(minutes / 60, 'hour', 'hours') : plural(minutes, 'minute', 'minutes')
}

export function planFeatureRows(plan: Plan): FeatureRow[] {
  const ai = plan.ai
  // Free's allowances are once only, a paid plan's renew every month
  const per = plan.allowancesOnce ? 'in total' : 'a month'
  // Free counts every clip it ever makes (videos.ts); paid plans include AI clips a month, then charge credits
  const clips: FeatureRow[] = plan.maxClips
    ? [{ label: `${plan.maxClips} clips in total`, included: true }]
    : [
        { label: 'Unlimited clips you cut yourself', included: true },
        { label: `${ai.clipsPerMonth} AI clips a month, then ${plural(EXTRA_CLIP_CREDITS, 'credit', 'credits')} each`, included: true },
      ]
  return [
    { label: `${readingLabel(plan.readingMinutes)} of video read ${per}`, included: true },
    { label: `${plural(plan.uploadsPerMonth, 'upload', 'uploads')} ${per}`, included: true },
    // A total, not per month: deleting a video frees its place (checkVideoQuota), not its reading
    { label: `${plural(plan.maxVideos, 'video', 'videos')} at a time`, included: true },
    { label: `Up to ${plan.maxFileSizeGb} GB per video`, included: true },
    ...clips,
    { label: `Up to ${ai.clipsPerRun} clips per Make my clips`, included: true },
    { label: `${plural(ai.searchesPerVideo, 'AI moment search', 'AI moment searches')} per video`, included: true },
    { label: `${ai.askAiPerMonth} Ask AI searches ${per}`, included: true },
    { label: `${ai.rewritesPerMonth} hook and title rewrites ${per}`, included: true },
    { label: `${plan.retentionDays} days history`, included: true },
    { label: 'Captions on AI clips included', included: plan.autoCaption },
    { label: 'No watermark', included: !plan.watermark },
    { label: 'Priority exports', included: plan.priorityExports },
  ]
}

/** The "What a credit buys" cards */
export function creditUses(): { name: string; price: string; note: string }[] {
  return [
    { name: 'Reading your video', price: 'In your plan',
      note: `Your plan includes hours of video read a month, however you split them. Past them, ${EXTRA_READING_CREDITS} credits per 10 minutes of video. 1 credit = ₹1.` },
    { name: 'Past your plan’s AI limits', price: `${plural(EXTRA_CLIP_CREDITS, 'credit', 'credits')} per AI clip past the month’s`,
      note: `Ask AI costs ${plural(ASK_AI_EXTRA_CREDITS, 'credit', 'credits')} per Ask AI search (a long video counts 1 per started hour), a new moment search 5 credits per 10 minutes of video, and rewrites 1 credit per ${REWRITES_PER_CREDIT} rewrites. You see the price before you confirm.` },
    { name: 'Manual edit', price: `${plural(CAPTION_CREDITS_PER_MINUTE, 'credit', 'credits')} per clip minute`,
      note: 'For the captions of a clip you cut yourself, from its main video, and for Subjects, which follows people through it (once per clip). You see the price first. Cutting and editing are free.' },
    { name: 'Export', price: `${plural(EXPORT_CREDITS_PER_MINUTE, 'credit', 'credits')} per clip minute`,
      note: 'In 1080p, a part of a minute counted as a minute. Clips can be up to 5 minutes.' },
    { name: 'Free to use', price: '0 credits',
      note: 'The editor, captions styling, text, music, stock B-roll, brand kits and grouping.' },
  ]
}
