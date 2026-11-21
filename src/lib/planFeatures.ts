import type { Plan } from './plans'
import { CAPTION_CREDITS_PER_MINUTE, EXPORT_CREDITS_PER_MINUTE, READING_CREDITS, SUBJECTS_CREDITS_PER_MINUTE } from './credits'
import { ASK_AI_CREDITS, REWRITES_PER_CREDIT, CLIP_CREDITS } from './aiLimits'
import { brandKitLimit } from './shared/brandKit'
import { teamSeats } from './shared/brandTeam'
import { canKeep } from './expiry'

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
  const kits = brandKitLimit(plan.key)
  return [
    // (user, 2026-11-21, plans v2) credits are the only limit: no monthly hours, uploads, AI clips or Ask AI
    { label: 'Spend your credits on anything, no monthly limits', included: true },
    ...(plan.uploadsLimit != null ? [{ label: `${plural(plan.uploadsLimit, 'upload', 'uploads')} in total`, included: true }] : []),
    // Held at once: deleting a video frees its space (server/services/storage.ts)
    { label: `${plan.storageGb} GB of storage`, included: true },
    { label: `Up to ${plan.maxFileSizeGb} GB per video`, included: true },
    // Signed in on this many devices at once (modules/auth/devices.ts)
    { label: plural(plan.devices, 'device signed in at a time', 'devices signed in at a time'), included: true },
    ...(plan.maxClips ? [{ label: `${plan.maxClips} clips in total`, included: true }] : [{ label: 'Unlimited clips you cut yourself', included: true }]),
    { label: `Up to ${ai.clipsPerRun} clips per Make my clips`, included: true },
    // (user, 2026-11-21: "free" read as free AI; it is paid for by the video's reading at upload)
    { label: ai.searchesPerVideo === 1 ? 'First AI moment search included with every video' : `First ${ai.searchesPerVideo} AI moment searches included with every video`, included: true },
    { label: plural(kits, 'brand kit', 'brand kits'), included: true },
    { label: 'Share your brand kits with your team', included: teamSeats(plan.key) > 0 },
    { label: plan.oneTime ? `Lasts ${plan.retentionDays} days` : `Videos kept ${plan.retentionDays} days`, included: true },
    // Pro: ★ Keep, a chosen video never expires (still counted in the storage): server/services/expiry.ts
    { label: 'Keep chosen videos for good', included: canKeep(plan.key) },
    { label: 'Captions on AI clips included', included: plan.autoCaption },
    { label: 'No watermark', included: !plan.watermark },
    { label: 'Priority exports', included: plan.priorityExports },
    { label: 'GST invoices with your company details', included: plan.gstInvoices },
  ]
}

/** The "What a credit buys" cards */
export function creditUses(): { name: string; price: string; note: string }[] {
  return [
    { name: 'Reading your video', price: `${READING_CREDITS} credits per 10 minutes`,
      note: `Taken when you upload. A video that fails gives them back.` },
    { name: 'AI clips', price: `${plural(CLIP_CREDITS, 'credit', 'credits')} per AI clip`,
      note: `Captions, title, framing and the export included. Ask AI costs ${plural(ASK_AI_CREDITS, 'credit', 'credits')} per Ask AI search (a long video: per started hour), a new moment search after the included one 5 credits per 10 minutes of video, and rewrites 1 credit per ${REWRITES_PER_CREDIT} rewrites.` },
    { name: 'Manual edit', price: `${plural(CAPTION_CREDITS_PER_MINUTE, 'credit', 'credits')} per clip minute`,
      note: `For the captions of a clip you cut yourself, from its main video, and ${SUBJECTS_CREDITS_PER_MINUTE} more for Subjects, which follows people through it (once per clip). You see the price first. Cutting and editing are free.` },
    { name: 'Export', price: `${plural(EXPORT_CREDITS_PER_MINUTE, 'credit', 'credits')} per clip minute`,
      note: 'In 1080p, a part of a minute counted as a minute. Clips can be up to 5 minutes. An AI clip’s first export is in its price.' },
    { name: 'Free to use', price: '0 credits',
      note: 'The editor, captions styling, text, music, stock B-roll, brand kits and grouping.' },
  ]
}

/**
 * The pricing page's plan cards (user, 2026-11-21: "simple, and show the difference between plans"): only what
 * differs, the same rows in the same order on every card, so they read side by side. `value` false: not on this
 * plan; `strong`: what this plan adds over the one below it (lit on the card).
 */
export type CompareRow = { label: string; value: string | false; strong?: boolean }
export function planCompareRows(plan: Plan): CompareRow[] {
  const kits = brandKitLimit(plan.key)
  const team = teamSeats(plan.key) > 0
  const keep = canKeep(plan.key)
  return [
    { label: 'Uploads', value: plan.uploadsLimit != null ? `${plan.uploadsLimit} in total` : 'No limit' },
    { label: 'Storage', value: `${plan.storageGb} GB` },
    { label: 'One video up to', value: `${plan.maxFileSizeGb} GB` },
    { label: 'Videos kept', value: keep ? `${plan.retentionDays} days, or ★ Keep for good` : `${plan.retentionDays} days`, strong: keep },
    { label: 'Signed in on', value: plural(plan.devices, 'device', 'devices') },
    { label: 'Brand kits', value: team ? `${kits}, shared with your team` : String(kits), strong: team },
    { label: 'Clips per Make my clips', value: `Up to ${plan.ai.clipsPerRun}` },
    { label: 'Priority exports', value: plan.priorityExports ? 'Yes' : false, strong: plan.priorityExports },
    { label: 'GST invoice with your company', value: plan.gstInvoices ? 'Yes' : false, strong: plan.gstInvoices },
  ]
}

/** What every plan has, said once under the cards (not repeated on each) */
export function everyPlanIncludes(): string[] {
  return [
    'No monthly limits: spend credits on anything',
    'Unlimited clips you cut yourself',
    'First AI moment search included with every video',
    'Captions on AI clips, 1080p exports, no watermark',
  ]
}

/** "What a credit buys", short: one line each (the pricing page; creditUses keeps the long notes) */
export function creditPrices(): Array<{ name: string; price: string }> {
  return [
    { name: 'Reading your video (at upload)', price: `${READING_CREDITS} per 10 min` },
    { name: 'AI clip, export included', price: plural(CLIP_CREDITS, 'credit', 'credits') },
    { name: 'Captions on a clip you cut', price: `${CAPTION_CREDITS_PER_MINUTE} per minute` },
    { name: 'Export', price: `${EXPORT_CREDITS_PER_MINUTE} per minute` },
    { name: 'Ask AI search', price: `${ASK_AI_CREDITS} per hour of video` },
    { name: 'Subjects (follow people)', price: `${SUBJECTS_CREDITS_PER_MINUTE} per minute` },
  ]
}
