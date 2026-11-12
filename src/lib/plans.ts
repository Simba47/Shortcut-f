export const PLANS = {
  free: {
    key: 'free' as const,
    name: 'Free',
    price: 0,
    // Credits given every billing month: the plan's price (the free plan gets a one-time grant instead: FREE_SIGNUP_CREDITS)
    monthlyCredits: 0,
    // A paid plan gives credits worth its price (1 credit = ₹1), and every action uses them. These
    // numbers are the most of each thing a plan can do, however many credits are left: past them,
    // upgrade. That is what keeps each plan's profit at 60%+ even at full use (Shortcut-Unit-Economics-Simple-Nov-2026.pdf).
    // Video read and uploads: a month on paid plans; once only on Free (allowancesOnce, as its AI
    // limits). Deleting a video gives none of it back.
    readingMinutes: 30,
    uploadsPerMonth: 3,
    allowancesOnce: true,
    // Held at once, a total: a month's uploads must fit for as long as they are kept
    maxVideos: 1,
    maxFileSizeBytes: 1 * 1024 * 1024 * 1024,
    maxFileSizeGb: 1,
    maxClips: 3,
    autoCaption: false,
    watermark: true,
    // Exports go to the front of the worker's line (the top plan's "priority rendering")
    priorityExports: false,
    retentionDays: 30,
    // AI use (lib/aiLimits.ts): clips per Make my clips run; AI clips a month
    // and a daily safety cap; free moment searches per video (1 on every plan: each one reads the whole
    // transcript, the biggest cost at full use); Ask AI searches and hook/title rewrites per month
    ai: { clipsPerRun: 3, clipsPerDay: 3, clipsPerMonth: 3, searchesPerVideo: 1, askAiPerMonth: 3, askAiPerDay: 3, rewritesPerMonth: 20 },
  },
  starter: {
    key: 'starter' as const,
    name: 'Starter',
    price: 599,
    // Credits given every billing month: the plan's price (the free plan gets a one-time grant instead: FREE_SIGNUP_CREDITS)
    monthlyCredits: 599,
    readingMinutes: 180,
    uploadsPerMonth: 10,
    allowancesOnce: false,
    maxVideos: 10,
    maxFileSizeBytes: 5 * 1024 * 1024 * 1024,
    maxFileSizeGb: 5,
    maxClips: null,
    autoCaption: true,
    watermark: false,
    priorityExports: false,
    retentionDays: 30,
    ai: { clipsPerRun: 10, clipsPerDay: 30, clipsPerMonth: 20, searchesPerVideo: 1, askAiPerMonth: 10, askAiPerDay: 10, rewritesPerMonth: 30 },
  },
  creator: {
    key: 'creator' as const,
    name: 'Creator',
    price: 999,
    // Credits given every billing month: the plan's price (the free plan gets a one-time grant instead: FREE_SIGNUP_CREDITS)
    monthlyCredits: 999,
    readingMinutes: 300,
    uploadsPerMonth: 20,
    allowancesOnce: false,
    maxVideos: 30,
    maxFileSizeBytes: 8 * 1024 * 1024 * 1024,
    maxFileSizeGb: 8,
    maxClips: null,
    autoCaption: true,
    watermark: false,
    priorityExports: false,
    retentionDays: 45,
    ai: { clipsPerRun: 15, clipsPerDay: 60, clipsPerMonth: 40, searchesPerVideo: 1, askAiPerMonth: 20, askAiPerDay: 20, rewritesPerMonth: 60 },
  },
  agency: {
    key: 'agency' as const,
    name: 'Agency',
    price: 2599,
    // Credits given every billing month: the plan's price (the free plan gets a one-time grant instead: FREE_SIGNUP_CREDITS)
    monthlyCredits: 2599,
    readingMinutes: 840,
    uploadsPerMonth: 50,
    allowancesOnce: false,
    maxVideos: 100,
    maxFileSizeBytes: 12 * 1024 * 1024 * 1024,
    maxFileSizeGb: 12,
    maxClips: null,
    autoCaption: true,
    watermark: false,
    priorityExports: true,
    retentionDays: 60,
    ai: { clipsPerRun: 20, clipsPerDay: 150, clipsPerMonth: 90, searchesPerVideo: 1, askAiPerMonth: 40, askAiPerDay: 40, rewritesPerMonth: 130 },
  },
} as const

export type PlanKey = keyof typeof PLANS
export type Plan = typeof PLANS[PlanKey]
