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
    // AI use (lib/aiLimits.ts): clips per Make my clips run; AI clips included a month (then credits)
    // and a daily safety cap; fresh moment searches per video; Ask AI searches and hook/title
    // rewrites per month (then credits)
    ai: { clipsPerRun: 3, clipsPerDay: 3, clipsPerMonth: 3, searchesPerVideo: 1, askAiPerMonth: 10, askAiPerDay: 5, rewritesPerMonth: 20 },
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
    ai: { clipsPerRun: 10, clipsPerDay: 30, clipsPerMonth: 60, searchesPerVideo: 3, askAiPerMonth: 100, askAiPerDay: 30, rewritesPerMonth: 150 },
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
    ai: { clipsPerRun: 15, clipsPerDay: 60, clipsPerMonth: 120, searchesPerVideo: 3, askAiPerMonth: 200, askAiPerDay: 50, rewritesPerMonth: 300 },
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
    ai: { clipsPerRun: 20, clipsPerDay: 150, clipsPerMonth: 300, searchesPerVideo: 5, askAiPerMonth: 600, askAiPerDay: 150, rewritesPerMonth: 1000 },
  },
} as const

export type PlanKey = keyof typeof PLANS
export type Plan = typeof PLANS[PlanKey]
