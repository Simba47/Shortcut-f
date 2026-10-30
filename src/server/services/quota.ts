import sql from '@/lib/db'
import { effectivePlan } from '@/server/services/billing'
import { PLANS, type PlanKey } from '@/lib/plans'

export async function getUserPlan(userId: string): Promise<PlanKey> {
  const [row] = await sql<{ plan: string }[]>`SELECT plan FROM users WHERE id = ${userId}`
  // A paid plan counts only while its subscription is paid up (billing.ts)
  const plan = await effectivePlan(userId, row?.plan ?? 'free')
  return (plan in PLANS ? plan : 'free') as PlanKey
}

export async function getUserPlanConfig(userId: string) {
  const key = await getUserPlan(userId)
  return PLANS[key]
}

export async function checkVideoQuota(userId: string): Promise<void> {
  const plan = await getUserPlanConfig(userId)
  // Stock clips saved for auto B-roll don't count
  const [row] = await sql<{ count: string }[]>`SELECT COUNT(*) as count FROM videos WHERE user_id = ${userId} AND role <> 'asset'`
  const count = parseInt(row?.count ?? '0', 10)
  if (count >= plan.maxVideos) {
    throw Object.assign(
      new Error(`Your ${plan.name} plan allows ${plan.maxVideos} video${plan.maxVideos === 1 ? '' : 's'}. Upgrade to add more.`),
      { status: 403 }
    )
  }
}

export async function checkClipQuota(userId: string): Promise<void> {
  const plan = await getUserPlanConfig(userId)
  if (!plan.maxClips) return
  const [row] = await sql<{ count: string }[]>`
    SELECT COUNT(*) as count FROM clips c
    JOIN videos v ON v.id = c.video_id
    WHERE v.user_id = ${userId}
  `
  const count = parseInt(row?.count ?? '0', 10)
  if (count >= plan.maxClips) {
    throw Object.assign(
      new Error(`Your ${plan.name} plan allows ${plan.maxClips} clips. Upgrade to create more.`),
      { status: 403 }
    )
  }
}

/** Largest video a user can upload as B-roll from the editor (or the plan's limit, if smaller) */
export const MAX_BROLL_UPLOAD_BYTES = 500 * 1024 * 1024

/** A B-roll upload (editor): no video-count limit, only a size cap */
export async function checkBrollSize(userId: string, fileSizeBytes: number): Promise<void> {
  const plan = await getUserPlanConfig(userId)
  const cap = Math.min(plan.maxFileSizeBytes, MAX_BROLL_UPLOAD_BYTES)
  if (fileSizeBytes > cap) {
    throw Object.assign(
      new Error(`Videos added to a clip can be up to ${Math.round(cap / (1024 * 1024))} MB. Trim it or pick a shorter one.`),
      { status: 403 },
    )
  }
}

export async function checkFileSizeQuota(userId: string, fileSizeBytes: number): Promise<void> {
  const plan = await getUserPlanConfig(userId)
  if (fileSizeBytes > plan.maxFileSizeBytes) {
    throw Object.assign(
      new Error(`Your ${plan.name} plan allows videos up to ${plan.maxFileSizeGb} GB. Upgrade for larger files.`),
      { status: 403 }
    )
  }
}
