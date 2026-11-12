import type { Plan } from './plans'
import { CAPTION_CREDITS_PER_MINUTE, EXPORT_CREDITS_PER_MINUTE, READING_CREDITS, SUBJECTS_CREDITS_PER_MINUTE } from './credits'
import { ASK_AI_CREDITS, REWRITES_PER_CREDIT, CLIP_CREDITS } from './aiLimits'

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
  // Free counts every clip it ever makes (videos.ts); paid plans have AI clips a month
  const clips: FeatureRow[] = plan.maxClips
    ? [{ label: `${plan.maxClips} clips in total`, included: true }]
    : [
        { label: 'Unlimited clips you cut yourself', included: true },
        { label: `${ai.clipsPerMonth} AI clips a month`, included: true },
      ]
  return [
    { label: `${readingLabel(plan.readingMinutes)} of video read ${per}`, included: true },
    { label: `${plural(plan.uploadsPerMonth, 'upload', 'uploads')} ${per}`, included: true },
    // A total, not per month: deleting a video frees its place (checkVideoQuota), not its reading
    { label: `${plural(plan.maxVideos, 'video', 'videos')} at a time`, included: true },
    { label: `Up to ${plan.maxFileSizeGb} GB per video`, included: true },
    ...clips,
    { label: `Up to ${ai.clipsPerRun} clips per Make my clips`, included: true },
    { label: `${plural(ai.searchesPerVideo, 'free AI moment search', 'free AI moment searches')} per video`, included: true },
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
    { name: 'Reading your video', price: `${READING_CREDITS} credits per 10 minutes`,
      note: `Taken when you upload, up to your plan's hours. A video that fails gives them back.` },
    { name: 'AI clips', price: `${plural(CLIP_CREDITS, 'credit', 'credits')} per AI clip`,
      note: `Captions, title and framing included. Ask AI costs ${plural(ASK_AI_CREDITS, 'credit', 'credits')} per Ask AI search (a long video: per started hour), a new moment search past the free one 5 credits per 10 minutes of video, and rewrites 1 credit per ${REWRITES_PER_CREDIT} rewrites.` },
    { name: 'Manual edit', price: `${plural(CAPTION_CREDITS_PER_MINUTE, 'credit', 'credits')} per clip minute`,
      note: `For the captions of a clip you cut yourself, from its main video, and ${SUBJECTS_CREDITS_PER_MINUTE} more for Subjects, which follows people through it (once per clip). You see the price first. Cutting and editing are free.` },
    { name: 'Export', price: `${plural(EXPORT_CREDITS_PER_MINUTE, 'credit', 'credits')} per clip minute`,
      note: 'In 1080p, a part of a minute counted as a minute. Clips can be up to 5 minutes.' },
    { name: 'Free to use', price: '0 credits',
      note: 'The editor, captions styling, text, music, stock B-roll, brand kits and grouping.' },
  ]
}
