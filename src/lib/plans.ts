export const PLANS = {
  free: {
    key: 'free' as const,
    name: 'Free',
    price: 0,
    // Credits given every billing month (the free plan gets a one-time grant instead: FREE_SIGNUP_CREDITS)
    monthlyCredits: 0,
    maxVideos: 1,
    maxFileSizeBytes: 1 * 1024 * 1024 * 1024,
    maxFileSizeGb: 1,
    maxClips: 3,
    autoCaption: false,
    watermark: true,
    // Exports go to the front of the worker's line (the top plan's "priority rendering")
    priorityExports: false,
    retentionDays: 30,
  },
  starter: {
    key: 'starter' as const,
    name: 'Starter',
    price: 599,
    // Credits given every billing month (the free plan gets a one-time grant instead: FREE_SIGNUP_CREDITS)
    monthlyCredits: 200,
    maxVideos: 5,
    maxFileSizeBytes: 5 * 1024 * 1024 * 1024,
    maxFileSizeGb: 5,
    maxClips: null,
    autoCaption: true,
    watermark: false,
    priorityExports: false,
    retentionDays: 30,
  },
  creator: {
    key: 'creator' as const,
    name: 'Creator',
    price: 999,
    // Credits given every billing month (the free plan gets a one-time grant instead: FREE_SIGNUP_CREDITS)
    monthlyCredits: 400,
    maxVideos: 15,
    maxFileSizeBytes: 8 * 1024 * 1024 * 1024,
    maxFileSizeGb: 8,
    maxClips: null,
    autoCaption: true,
    watermark: false,
    priorityExports: false,
    retentionDays: 45,
  },
  agency: {
    key: 'agency' as const,
    name: 'Agency',
    price: 2599,
    // Credits given every billing month (the free plan gets a one-time grant instead: FREE_SIGNUP_CREDITS)
    monthlyCredits: 1000,
    maxVideos: 30,
    maxFileSizeBytes: 12 * 1024 * 1024 * 1024,
    maxFileSizeGb: 12,
    maxClips: null,
    autoCaption: true,
    watermark: false,
    priorityExports: true,
    retentionDays: 60,
  },
} as const

export type PlanKey = keyof typeof PLANS
export type Plan = typeof PLANS[PlanKey]
