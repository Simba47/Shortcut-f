export const PLANS = {
  // (user, 2026-11-16) No free plan any more. "free" is now an account with no plan: it can sign in and
  // look around, and nothing that costs us runs until it buys the Trial pack or a plan (the limits below
  // are all 0, and no sign-up credits are given: FREE_SIGNUP_CREDITS). The key stays 'free' because it is
  // what users.plan holds when nothing is bought.
  free: {
    key: 'free' as const,
    name: 'No plan',
    price: 0,
    // Credits given every billing month: the plan's price (the Trial pack's are given once when it is paid: TRIAL_PACK)
    monthlyCredits: 0,
    // A paid plan gives credits worth its price (1 credit = ₹1), and every action uses them. These
    // numbers are the most of each thing a plan can do, however many credits are left: past them,
    // upgrade. That is what keeps each plan's profit at 60%+ even at full use (Shortcut-Unit-Economics-Simple-Nov-2026.pdf).
    // Video read and uploads: a month on paid plans; once only on the Trial (allowancesOnce, as its AI
    // limits). Deleting a video gives none of it back.
    readingMinutes: 0,
    uploadsPerMonth: 0,
    allowancesOnce: true,
    // Paid once (the Trial pack), not a monthly subscription
    oneTime: false,
    // Held at once, a total: a month's uploads must fit for as long as they are kept
    maxVideos: 0,
    maxFileSizeBytes: 0,
    maxFileSizeGb: 0,
    maxClips: null,
    autoCaption: false,
    watermark: false,
    // Exports go to the front of the worker's line (the top plan's "priority rendering")
    priorityExports: false,
    // Your company's name, GSTIN, state and address on your invoices (the billing page's "Details on your
    // invoices"): Agency only (user, 2026-11-19). Other plans get the invoice with their account's name and email.
    gstInvoices: false,
    retentionDays: 30,
    // AI use (lib/aiLimits.ts): clips per Make my clips run; AI clips a month
    // and a daily safety cap; free moment searches per video (1 on every plan: each one reads the whole
    // transcript, the biggest cost at full use); Ask AI searches and hook/title rewrites per month
    ai: { clipsPerRun: 0, clipsPerDay: 0, clipsPerMonth: 0, searchesPerVideo: 0, askAiPerMonth: 0, askAiPerDay: 0, rewritesPerMonth: 0 },
  },
  // (user, 2026-11-16) The Trial pack: ₹50 paid once (a Razorpay order, like a credit pack) for 99 credits
  // that last 14 days, to try everything; once per account. Its limits are once only. Modelled with the 13 Nov
  // costs: ₹41.2 reaches us (GST, one-time 2.36% fee) and full use costs ₹30.7, so 25% profit at full use
  // (21% from 2027), about 74% at typical use: below the plans' 60%, the user's choice ("with same credits
  // make it 50 rupee"; it was ₹99 for the same pack at 62%). The biggest cost is each upload's GPU start-up (₹3.63).
  // Unused trial credits move into a paid plan when the user subscribes (billing.ts carryTrialCredits).
  trial: {
    key: 'trial' as const,
    name: 'Trial',
    price: 50,
    // Its 99 credits come with the payment (TRIAL_PACK), not every month
    monthlyCredits: 0,
    readingMinutes: 30,
    uploadsPerMonth: 2,
    allowancesOnce: true,
    oneTime: true,
    maxVideos: 2,
    maxFileSizeBytes: 2 * 1024 * 1024 * 1024,
    maxFileSizeGb: 2,
    maxClips: null,
    autoCaption: true,
    watermark: false,
    priorityExports: false,
    gstInvoices: false,
    retentionDays: 14,
    ai: { clipsPerRun: 3, clipsPerDay: 3, clipsPerMonth: 3, searchesPerVideo: 1, askAiPerMonth: 2, askAiPerDay: 2, rewritesPerMonth: 20 },
  },
  starter: {
    key: 'starter' as const,
    name: 'Starter',
    price: 599,
    // Credits given every billing month: the plan's price
    monthlyCredits: 599,
    readingMinutes: 180,
    uploadsPerMonth: 10,
    allowancesOnce: false,
    oneTime: false,
    maxVideos: 10,
    maxFileSizeBytes: 5 * 1024 * 1024 * 1024,
    maxFileSizeGb: 5,
    maxClips: null,
    autoCaption: true,
    watermark: false,
    priorityExports: false,
    gstInvoices: false,
    retentionDays: 30,
    ai: { clipsPerRun: 10, clipsPerDay: 30, clipsPerMonth: 20, searchesPerVideo: 1, askAiPerMonth: 10, askAiPerDay: 10, rewritesPerMonth: 30 },
  },
  creator: {
    key: 'creator' as const,
    name: 'Creator',
    price: 999,
    // Credits given every billing month: the plan's price
    monthlyCredits: 999,
    readingMinutes: 300,
    uploadsPerMonth: 20,
    allowancesOnce: false,
    oneTime: false,
    maxVideos: 30,
    maxFileSizeBytes: 8 * 1024 * 1024 * 1024,
    maxFileSizeGb: 8,
    maxClips: null,
    autoCaption: true,
    watermark: false,
    priorityExports: false,
    gstInvoices: false,
    retentionDays: 45,
    ai: { clipsPerRun: 15, clipsPerDay: 60, clipsPerMonth: 40, searchesPerVideo: 1, askAiPerMonth: 20, askAiPerDay: 20, rewritesPerMonth: 60 },
  },
  agency: {
    key: 'agency' as const,
    name: 'Agency',
    price: 2599,
    // Credits given every billing month: the plan's price
    monthlyCredits: 2599,
    readingMinutes: 840,
    uploadsPerMonth: 50,
    allowancesOnce: false,
    oneTime: false,
    maxVideos: 100,
    maxFileSizeBytes: 12 * 1024 * 1024 * 1024,
    maxFileSizeGb: 12,
    maxClips: null,
    autoCaption: true,
    watermark: false,
    priorityExports: true,
    gstInvoices: true,
    retentionDays: 60,
    ai: { clipsPerRun: 20, clipsPerDay: 150, clipsPerMonth: 90, searchesPerVideo: 1, askAiPerMonth: 40, askAiPerDay: 40, rewritesPerMonth: 130 },
  },
} as const

export type PlanKey = keyof typeof PLANS
export type Plan = typeof PLANS[PlanKey]
