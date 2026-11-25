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
    // A paid plan gives credits worth its price (1 credit = ₹1), and every action uses them. Since
    // 2026-11-21 (user, plans v2) credits are the only limit: no monthly hours, uploads, AI clips, Ask AI
    // or rewrites. Every price keeps 60%+ (Shortcut-Unit-Economics-Simple-Nov-2026.pdf), so spending
    // them all is fine; what is left are safety limits (aiLimits.ts SAFETY_PER_DAY) and the worker's
    // per-person jobs at once (shortcut-b queue.ts).
    // Uploads in total: only the Trial has a number (each upload costs a GPU start-up, ₹3.63, and its
    // margin is thin); null = no limit. Deleting a video gives none back.
    uploadsLimit: 0 as number | null,
    // The Trial's counts (its uploads, its rewrites' "1 credit per 5") run for its whole life, not a month
    allowancesOnce: true,
    // Paid once (the Trial pack), not a monthly subscription
    oneTime: false,
    // Storage held at once (plans v2, user 2026-11-21: Trial 5 GB, Starter 15, Pro 30): the total size of the
    // user's videos' own files (server/services/storage.ts); deleting or (step 3) expiring a video frees it.
    // It replaced a count of videos. One file can be at most maxFileSizeBytes.
    storageGb: 0,
    storageBytes: 0 * 1024 * 1024 * 1024,
    // Devices signed in at once (plans v2, user 2026-11-21: Trial 1, Starter 2, Pro 3): a new sign-in past it
    // signs out the least recently used one (modules/auth/devices.ts)
    devices: 1,
    maxFileSizeBytes: 0,
    maxFileSizeGb: 0,
    maxClips: null,
    autoCaption: false,
    watermark: false,
    // Exports go to the front of the worker's line (the top plan's "priority rendering"): Pro (user, 2026-11-21)
    priorityExports: false,
    // Your company's name, GSTIN, state and address on your invoices (the billing page's "Details on your
    // invoices"): Pro only (Agency's until 2026-11-21). Other plans get the invoice with their account's name and email.
    gstInvoices: false,
    // Days an upload is kept (Trial 7, Starter and Pro 30: plans v2)
    retentionDays: 30,
    // AI use (lib/aiLimits.ts): clips per Make my clips run (one job's size); free moment searches per
    // video (1 on every plan: each one reads the whole transcript, then 5 credits per 10 min)
    ai: { clipsPerRun: 0, searchesPerVideo: 0 },
    // Shown on the pricing page: sold to new buyers (Agency is kept for anyone still on it, not sold)
    sold: false,
  },
  // (user, 2026-11-16) The Trial pack: paid once (a Razorpay order, like a credit pack) for 99 credits,
  // to try everything; once per account. ₹49 for 7 days since 2026-11-21 (plans v2; it was ₹50 for 14). Its limits are once only. Modelled with the 13 Nov
  // costs: ₹41.2 reaches us (GST, one-time 2.36% fee) and full use costs ₹30.7, so 25% profit at full use
  // (21% from 2027), about 74% at typical use: below the plans' 60%, the user's choice ("with same credits
  // make it 50 rupee"; it was ₹99 for the same pack at 62%). The biggest cost is each upload's GPU start-up (₹3.63).
  // Unused trial credits move into a paid plan when the user subscribes (billing.ts carryTrialCredits).
  trial: {
    key: 'trial' as const,
    name: 'Trial',
    price: 49,
    // Its 99 credits come with the payment (TRIAL_PACK), not every month
    monthlyCredits: 0,
    uploadsLimit: 2,
    allowancesOnce: true,
    oneTime: true,
    storageGb: 5,
    storageBytes: 5 * 1024 * 1024 * 1024,
    devices: 1,
    maxFileSizeBytes: 2 * 1024 * 1024 * 1024,
    maxFileSizeGb: 2,
    maxClips: null,
    autoCaption: true,
    watermark: false,
    priorityExports: false,
    gstInvoices: false,
    retentionDays: 7,
    ai: { clipsPerRun: 3, searchesPerVideo: 1 },
    sold: true,
  },
  starter: {
    key: 'starter' as const,
    name: 'Starter',
    price: 599,
    // Credits given every billing month: the plan's price
    monthlyCredits: 599,
    uploadsLimit: null,
    allowancesOnce: false,
    oneTime: false,
    storageGb: 15,
    storageBytes: 15 * 1024 * 1024 * 1024,
    devices: 2,
    maxFileSizeBytes: 5 * 1024 * 1024 * 1024,
    maxFileSizeGb: 5,
    maxClips: null,
    autoCaption: true,
    watermark: false,
    priorityExports: false,
    gstInvoices: false,
    retentionDays: 30,
    ai: { clipsPerRun: 10, searchesPerVideo: 1 },
    sold: true,
  },
  // Pro (user, 2026-11-21: "Creator" renamed; the key stays 'creator', which accounts, subscriptions and
  // Razorpay already hold). Agency's extras moved here: team sharing, GSTIN invoices, priority exports.
  creator: {
    key: 'creator' as const,
    name: 'Pro',
    price: 999,
    // Credits given every billing month: the plan's price
    monthlyCredits: 999,
    uploadsLimit: null,
    allowancesOnce: false,
    oneTime: false,
    storageGb: 30,
    storageBytes: 30 * 1024 * 1024 * 1024,
    devices: 3,
    maxFileSizeBytes: 8 * 1024 * 1024 * 1024,
    maxFileSizeGb: 8,
    maxClips: null,
    autoCaption: true,
    watermark: false,
    priorityExports: true,
    gstInvoices: true,
    retentionDays: 30,
    ai: { clipsPerRun: 15, searchesPerVideo: 1 },
    sold: true,
  },
  // Not sold since 2026-11-21 (plans v2: Trial, Starter, Pro). Kept so anyone still paying for it keeps it
  // until their subscription ends.
  agency: {
    key: 'agency' as const,
    name: 'Agency',
    price: 2599,
    // Credits given every billing month: the plan's price
    monthlyCredits: 2599,
    uploadsLimit: null,
    allowancesOnce: false,
    oneTime: false,
    storageGb: 50,
    storageBytes: 50 * 1024 * 1024 * 1024,
    devices: 3,
    maxFileSizeBytes: 12 * 1024 * 1024 * 1024,
    maxFileSizeGb: 12,
    maxClips: null,
    autoCaption: true,
    watermark: false,
    priorityExports: true,
    gstInvoices: true,
    retentionDays: 60,
    ai: { clipsPerRun: 20, searchesPerVideo: 1 },
    sold: false,
  },
  // (user, 2026-11-25: "full access without any limits to developer@shortcutapp.in so that he can test very
  // large") Shortcut's own test accounts: never sold, only given from the admin (on the live site only to
  // @shortcutapp.in accounts). Everything a plan limits is set past any test: storage, one file's size (75 GB:
  // uploads go in 8 MB parts and storage takes at most 10,000 of them), devices, clips per Make my clips run,
  // free moment searches, how long videos are kept, and no daily safety limits (aiLimits.ts safetyFor).
  // Credits are still counted, so tests see real prices: the admin gives 1,000,000 with it.
  // Left as they are for everyone: 1 AI clip per minute of video, 500 MB for a video added inside the editor,
  // and the worker's fair share per person (its jobs wait, they are never refused).
  unlimited: {
    key: 'unlimited' as const,
    name: 'Unlimited (testing)',
    price: 0,
    monthlyCredits: 0,
    uploadsLimit: null,
    allowancesOnce: false,
    oneTime: false,
    storageGb: 10_000,
    storageBytes: 10_000 * 1024 * 1024 * 1024,
    devices: 100,
    maxFileSizeBytes: 75 * 1024 * 1024 * 1024,
    maxFileSizeGb: 75,
    maxClips: null,
    autoCaption: true,
    watermark: false,
    priorityExports: true,
    gstInvoices: true,
    retentionDays: 3650,
    ai: { clipsPerRun: 100, searchesPerVideo: 1000 },
    sold: false,
  },
} as const

export type PlanKey = keyof typeof PLANS
export type Plan = typeof PLANS[PlanKey]

/** The top plan sold: Pro (key 'creator', since 2026-11-21), and Agency, no longer sold (and Unlimited, testing only). Nothing to upgrade to from these. */
export function isTopPlan(plan: string | null | undefined): boolean {
  return plan === 'creator' || plan === 'agency' || plan === 'unlimited'
}
