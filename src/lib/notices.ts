// Alerts and notifications (user, 2026-11-26: "build all four steps"): which account banner shows, and what a
// finished job says. Pure (no React, no database) so the rules are tested on their own (notices.test.ts); the
// server sends the facts (server/services/notices.ts) and the components show them (components/notices).

/** The four tones every message has (toast, card, banner): done, a note, careful, failed */
export type Tone = 'ok' | 'info' | 'warn' | 'error'

// ── Account banners ──────────────────────────────────────────────────────────

/** Under this many credits the "running low" banner shows (user's choice, 2026-11-26): less than one 10-minute reading */
export const CREDITS_LOW = 15
/** Credits expiring within this many days are warned about */
export const EXPIRY_WARN_DAYS = 7
/** The Trial's last days: its banner shows from this many days before it ends */
export const TRIAL_WARN_DAYS = 2
/** Storage used, in percent, from which its banner shows (the dashboard's old strip: 85%) */
export const STORAGE_WARN_PCT = 85
/** A failed renewal is told about for this long after it (then the account is simply on no plan) */
export const RENEWAL_FAILED_DAYS = 30

/** What the server knows about the account (GET /api/notices) */
export interface AccountFacts {
  /** The plan on now (plans.ts key; 'free' = no plan) */
  plan: string
  /** The top plan (nothing bigger to sell): no "See plans" */
  topPlan: boolean
  /** null: credits are off on this site (nothing about credits is shown) */
  credits: { balance: number; expiring: { amount: number; at: string } | null } | null
  trial: { active: boolean; endsAt: string | null }
  /** The paid plan Razorpay couldn't renew, and when it ended; null: none (or a plan was bought since) */
  renewalFailed: { planName: string; at: string } | null
  storage: { usedBytes: number; totalBytes: number } | null
}

export type BannerKind = 'renewal_failed' | 'out_of_credits' | 'trial_ending' | 'credits_low' | 'credits_expiring' | 'storage_low' | 'storage_full'

export interface Banner {
  kind: BannerKind
  tone: 'warn' | 'error'
  /** The bold first words */
  title: string
  /** The rest, in grey */
  text: string
  action: { label: string; href: string } | null
  /**
   * What it was about when it was hidden: a hidden banner comes back once this changes (things got worse:
   * fewer credits left, fewer days, more storage used), never for the same state again
   */
  level: string
}

const DAY = 86_400_000

/** India time (+5:30): "today" and "tomorrow" are its calendar days */
const IST_MS = 330 * 60_000
const istDay = (ms: number) => Math.floor((ms + IST_MS) / DAY)

/** "today", "tomorrow", "in 3 days" (calendar days in India, not 24-hour stretches) */
export function inDays(at: string | Date, now: number): string {
  const d = istDay(new Date(at).getTime()) - istDay(now)
  return d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`
}

/** "3 December" (India's way of writing it) */
export function dayMonth(at: string | Date): string {
  return new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
}

function gb(bytes: number): string {
  const g = bytes / 1024 ** 3
  return `${g >= 10 ? Math.round(g) : Math.round(g * 10) / 10} GB`
}

/**
 * Every banner the account calls for, the most urgent first: a failed renewal, no credits, the Trial ending,
 * credits low, credits expiring, storage. (Only the first that isn't hidden is shown: pickBanner.)
 */
export function accountBanners(f: AccountFacts, now: number = Date.now()): Banner[] {
  const out: Banner[] = []
  const onPlan = f.plan !== 'free'
  const plans = { label: 'See plans', href: '/pricing' }
  const buy = { label: 'Buy credits', href: '/billing#credits' }

  if (f.renewalFailed && !onPlan) {
    out.push({
      kind: 'renewal_failed', tone: 'error',
      title: `We couldn’t renew your ${f.renewalFailed.planName} plan.`,
      text: 'The payment didn’t go through. Renew to keep your videos: they’re deleted 7 days after a plan ends.',
      action: { label: 'Renew plan', href: '/pricing' }, level: f.renewalFailed.at,
    })
  }
  const c = f.credits
  if (c && onPlan && c.balance <= 0) {
    out.push({
      kind: 'out_of_credits', tone: 'error',
      title: 'You’re out of credits.',
      text: 'Reading videos, Make my clips and exports need credits.',
      action: buy, level: '0',
    })
  }
  if (f.plan === 'trial' && f.trial.active && f.trial.endsAt) {
    const left = new Date(f.trial.endsAt).getTime() - now
    if (left > 0 && left <= TRIAL_WARN_DAYS * DAY) {
      const when = inDays(f.trial.endsAt, now)
      out.push({
        kind: 'trial_ending', tone: 'warn',
        title: `Your Trial ends ${when}.`,
        text: 'Pick a plan to keep your videos and what’s left of your credits.',
        action: plans, level: when,
      })
    }
  }
  if (c && onPlan && c.balance > 0 && c.balance < CREDITS_LOW) {
    out.push({
      kind: 'credits_low', tone: 'warn',
      title: `${c.balance} credit${c.balance === 1 ? '' : 's'} left.`,
      text: 'That’s less than reading one 10-minute video.',
      action: buy,
      // (hidden at 12, back at 5 or fewer)
      level: c.balance <= 5 ? 'very' : 'low',
    })
  }
  if (c && c.balance > 0 && c.expiring && c.expiring.amount > 0) {
    const left = new Date(c.expiring.at).getTime() - now
    // (the Trial's credits end with the Trial: its own banner says so)
    const trialEnd = f.plan === 'trial' && f.trial.endsAt && Math.abs(new Date(f.trial.endsAt).getTime() - new Date(c.expiring.at).getTime()) < DAY
    if (left > 0 && left <= EXPIRY_WARN_DAYS * DAY && !trialEnd) {
      const n = c.expiring.amount
      out.push({
        kind: 'credits_expiring', tone: 'warn',
        title: `${n} credit${n === 1 ? '' : 's'} expire${n === 1 ? 's' : ''} ${left < 2 * DAY ? inDays(c.expiring.at, now) : `on ${dayMonth(c.expiring.at)}`}.`,
        text: 'Use them before then, or they’re gone.',
        action: { label: 'Make clips', href: '/dashboard' }, level: c.expiring.at,
      })
    }
  }
  const s = f.storage
  if (s && s.totalBytes > 0) {
    const pct = (s.usedBytes / s.totalBytes) * 100
    if (pct >= 100) {
      out.push({
        kind: 'storage_full', tone: 'warn',
        title: `Your ${gb(s.totalBytes)} of storage is full.`,
        text: f.topPlan ? 'Delete old videos to upload more.' : 'Delete old videos, or get more space with a bigger plan.',
        action: f.topPlan ? null : plans, level: 'full',
      })
    } else if (pct >= STORAGE_WARN_PCT) {
      out.push({
        kind: 'storage_low', tone: 'warn',
        title: `You’ve used ${gb(s.usedBytes)} of your ${gb(s.totalBytes)}.`,
        text: `${gb(s.totalBytes - s.usedBytes)} free — delete old videos${f.topPlan ? '' : ', or get more space with a bigger plan'}.`,
        action: f.topPlan ? null : plans,
        // (hidden at 86%, back at 90% and again at 95%)
        level: String(Math.floor(pct / 5) * 5),
      })
    }
  }
  return out
}

/** Banners hidden this visit: kind → the level it was hidden at */
export type Hidden = Partial<Record<BannerKind, string>>

/** The banner to show: the most urgent one not hidden at its present level. `onlyRed`: the editor's slim strip */
export function pickBanner(f: AccountFacts | null, hidden: Hidden, opts: { onlyRed?: boolean; now?: number } = {}): Banner | null {
  if (!f) return null
  return accountBanners(f, opts.now).find(b => (!opts.onlyRed || b.tone === 'error') && hidden[b.kind] !== b.level) ?? null
}

// ── Work finished ────────────────────────────────────────────────────────────

/** A job of the user's that finished (GET /api/notices/activity) */
export interface FinishedJob {
  id: string
  kind: 'reading' | 'clips' | 'export'
  ok: boolean
  videoId: string
  videoTitle: string | null
  clipId: string | null
  clipTitle: string | null
  /** Make my clips: how many clips it made */
  made: number | null
  /** Credits given back for it (a failed job, or the clips a run didn't make); 0: none */
  refunded: number
}

export interface FinishedNote {
  tone: Tone
  text: string
  action: { label: string; href: string } | null
  /** For the browser notification (the tab hidden): a title and a line */
  title: string
  body: string
}

/** A name in quotes, shortened: “Podcast episode 12 with…” */
export function quoted(name: string | null | undefined, max = 32): string {
  const n = (name ?? '').trim()
  if (!n) return ''
  return `“${n.length > max ? `${n.slice(0, max - 1).trimEnd()}…` : n}”`
}

function back(n: number): string {
  return n > 0 ? ` · ${n} credit${n === 1 ? '' : 's'} came back` : ''
}

/** What a finished job says, as a toast and as a browser notification */
export function finishedNote(j: FinishedJob): FinishedNote {
  const video = quoted(j.videoTitle) || 'Your video'
  const board = `/videos/${j.videoId}`
  if (j.kind === 'reading') {
    return j.ok
      ? { tone: 'ok', text: `${video} is read`, action: { label: 'Make clips', href: board }, title: 'Your video is read', body: `${video} is ready for clips.` }
      : { tone: 'error', text: `Couldn’t read ${video}${back(j.refunded)}`, action: { label: 'See why', href: '/dashboard' }, title: 'Your video couldn’t be read', body: `${video}: open the dashboard to see why.` }
  }
  if (j.kind === 'clips') {
    if (!j.ok) {
      return { tone: 'error', text: `Make my clips didn’t finish${back(j.refunded)}`, action: { label: 'Open', href: board }, title: 'Make my clips didn’t finish', body: `${video}: open it to try again.` }
    }
    const n = j.made ?? 0
    if (n === 0) return { tone: 'info', text: `Make my clips found no clips in ${video}${back(j.refunded)}`, action: { label: 'Open', href: board }, title: 'Make my clips found no clips', body: video }
    const what = `${n} clip${n === 1 ? ' is' : 's are'} ready`
    return { tone: 'ok', text: `${what}${back(j.refunded)}`, action: { label: 'Open', href: board }, title: what, body: `From ${video}.` }
  }
  const clip = quoted(j.clipTitle) || 'Your reel'
  return j.ok
    ? { tone: 'ok', text: `${clip} is exported`, action: j.clipId ? { label: 'Download', href: `/api/clips/${j.clipId}/download` } : { label: 'Open', href: board }, title: 'Your reel is ready', body: `${clip} is ready to download.` }
    : { tone: 'error', text: `${clip} didn’t export${back(j.refunded)}`, action: j.clipId ? { label: 'Try again', href: `/editor/${j.clipId}` } : null, title: 'An export didn’t finish', body: `${clip}: open it to try again.` }
}

/** What a page shows already, so a finished job about it isn't toasted on top (the editor's own export, the board's video) */
export interface OnScreen { videoIds: string[]; clipIds: string[] }
export function shownAlready(j: FinishedJob, on: OnScreen): boolean {
  if (j.clipId && on.clipIds.includes(j.clipId)) return true
  // (the clip board shows its video's reading, Make my clips and exports as they happen)
  return on.videoIds.includes(j.videoId)
}

/** The tab's name while something finished out of sight: "✓ Ready · Dashboard — Shortcut" (only once) */
export const READY_PREFIX = '✓ Ready · '
export function readyTitle(title: string): string {
  return title.startsWith(READY_PREFIX) ? title : `${READY_PREFIX}${title}`
}
export function plainTitle(title: string): string {
  return title.startsWith(READY_PREFIX) ? title.slice(READY_PREFIX.length) : title
}
