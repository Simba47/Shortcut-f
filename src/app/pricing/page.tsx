'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { PLANS } from '@/lib/plans'
import {
  TOPUP_PACKS, TRIAL_PACK, TRIAL_DAYS, TOPUP_CREDIT_DAYS, READING_CREDITS, CAPTION_CREDITS_PER_MINUTE, EXPORT_CREDITS_PER_MINUTE, packUses,
} from '@/lib/credits'
import { planCompareRows, everyPlanIncludes, creditPrices } from '@/lib/planFeatures'
import { SAFETY_PER_DAY, CLIP_CREDITS } from '@/lib/aiLimits'
import { BrandLogo } from '@/components/ui/brand-logo'
import { CreditsBadge } from '@/components/ui/credits-badge'
import { useCredits } from '@/lib/useCredits'
import { buyCreditPack, loadCheckoutScript, CHECKOUT_SCRIPT } from '@/lib/razorpayCheckout'
import { PaymentsCards } from '@/components/billing/BillingCards'
import { CurrencySwitch } from '@/components/billing/CurrencySwitch'
import { useCurrency } from '@/lib/useCurrency'
import { formatMoney, packPriceMinor, planPriceMinor, type Currency } from '@/lib/currency'
import { askConfirm } from '@/components/notices/store'
import { AlertCard } from '@/components/notices/Notices'

// (user, 2026-11-16) No free plan: the Trial pack (paid once) comes first. Plans v2 (2026-11-21): Trial,
// Starter, Pro; Agency (not sold) shows only to someone still on it
const PLAN_ORDER = ['trial', 'starter', 'creator', 'agency'] as const

export default function PricingPage() {
  const { credits, refresh: refreshCredits } = useCredits()
  const { data: session } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Signed in, two tabs (user, 2026-11-19): Plans, and Payments & invoices (#billing, so a link can open it):
  // payment history, and on Pro the company details for invoices
  const [tab, setTab] = useState<'plans' | 'billing'>('plans')
  const [paidKey, setPaidKey] = useState(0)
  useEffect(() => {
    const read = () => setTab(window.location.hash === '#billing' ? 'billing' : 'plans')
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  const pickTab = (t: 'plans' | 'billing') => {
    setTab(t)
    window.history.replaceState(null, '', t === 'billing' ? '#billing' : window.location.pathname)
  }

  const [mine, setMine] = useState<{ plan: string; testMode: boolean; paymentsMode?: 'off' | 'mock' | 'test' | 'live'; testPack?: boolean; subscription: { status: string; expiresAt: string | null } | null; trial?: { used: boolean; active: boolean; endsAt: string | null }; currency?: Currency | null } | null>(null)
  useEffect(() => {
    if (!session) return
    fetch('/api/billing/plan').then(r => r.ok ? r.json() : null).then(d => d && setMine(d)).catch(() => {})
  }, [session])
  // Rupees or dollars (2026-11-22): the account's once it has paid, else the time zone's guess or the switch
  const { currency, setCurrency, locked, available } = useCurrency(mine?.currency ?? null)
  const price = (key: string) => { const m = planPriceMinor(key, currency); return m === null ? '' : formatMoney(m, currency) }

  async function handleSubscribe(planKey: string) {
    if (!session) { router.push('/login'); return }
    if (planKey === 'free') return
    // The Trial pack is paid once (an order, like a credit pack), not a subscription
    if (planKey === 'trial') { await handleTopup('trial'); return }
    setLoading(planKey)
    setError(null)
    try {
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planKey, currency }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      if (data.test) { router.push('/dashboard'); return }   // a test copy without payments
      await openCheckout(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(null)
    }
  }

  /** Razorpay's payment window; after paying, the server checks the signature and turns the plan on */
  async function openCheckout(d: { subscriptionId: string; keyId: string; planName: string; email?: string; checkoutScript?: string }) {
    await loadCheckoutScript(d.checkoutScript ?? CHECKOUT_SCRIPT)
    await new Promise<void>((resolve, reject) => {
      const rz = new window.Razorpay({
        key: d.keyId,
        subscription_id: d.subscriptionId,
        name: 'Shortcut',
        description: `${d.planName} plan, monthly`,
        prefill: d.email ? { email: d.email } : undefined,
        theme: { color: '#c8ff00' },
        handler: async (r: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => {
          try {
            const res = await fetch('/api/billing/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) })
            const out = await res.json()
            if (!res.ok) throw new Error(out.error ?? 'The payment could not be verified. If money was taken, it will show here shortly.')
            router.push('/dashboard')
            resolve()
          } catch (e) { reject(e) }
        },
        modal: { ondismiss: () => resolve() },
      })
      rz.on('payment.failed', (f: { error?: { description?: string } }) => reject(new Error(f.error?.description ?? 'The payment failed. Please try again.')))
      rz.open()
    })
  }

  const [topupBusy, setTopupBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** Buying a credit pack: an order, Razorpay's payment window, then the server checks it and adds the credits */
  async function handleTopup(packKey: string) {
    if (!session) { router.push('/login'); return }
    setTopupBusy(packKey); setError(null); setNotice(null)
    try {
      const out = await buyCreditPack(packKey, currency)
      if (out) {
        setNotice(`${out.credits} credits added. You now have ${out.balance}.`)
        refreshCredits()
        setPaidKey(k => k + 1)
        // The Trial is on: straight to uploading
        if (packKey === 'trial') router.push('/dashboard')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setTopupBusy(null)
    }
  }

  // The plans on show: those sold, and Agency only to someone still on it (in rupees: it has no dollar price)
  const shown = PLAN_ORDER.filter(key => (PLANS[key].sold && planPriceMinor(key, currency) !== null) || mine?.plan === key)

  async function cancel() {
    if (!await askConfirm({ title: 'Stop renewing?', body: 'You keep your plan until the month you paid for ends.', confirmLabel: 'Stop renewing', cancelLabel: 'Keep it' })) return
    setError(null)
    const res = await fetch('/api/billing/cancel', { method: 'POST' })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) { setError(out.error ?? 'Could not cancel'); return }
    setMine(m => m && { ...m, subscription: { status: 'cancelled', expiresAt: out.endsAt ?? m.subscription?.expiresAt ?? null } })
  }

  return (
    <div className="min-h-screen" style={{ background: '#0d0d0d' }}>
      <nav className="flex items-center justify-between px-6 py-3 border-b" style={{ background: '#111', borderColor: 'rgba(255,255,255,0.07)' }}>
        {/* Same animated logo as every other page; colours pinned because this header is always dark */}
        <a href={session ? '/dashboard' : '/'} aria-label={session ? 'Shortcut dashboard' : 'Shortcut home'} style={{ '--text': '#F4F4F5', '--logo': '#C8FF00', textDecoration: 'none' } as React.CSSProperties}>
          <BrandLogo shine />
        </a>
        {/* Open signed out too (Razorpay's website review): a way in instead of the credits */}
        {!session && (
          <a href="/login" className="text-xs px-3 py-1.5 rounded-lg" style={{ color: '#000', background: '#c8ff00' }}>
            Sign in
          </a>
        )}
        {session && (
          <div className="flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.8)' }}>
          <CreditsBadge credits={credits} />
          <a href="/dashboard" className="text-xs px-3 py-1.5 rounded-lg" style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
            Dashboard
          </a>
          </div>
        )}
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        {/* (open signed out too, for Razorpay's review: then only the plans, no tabs) */}
        {session && (
          <div className="flex justify-center mb-10">
            <div className="st-tabs" role="tablist" aria-label="Plans and billing">
              <button type="button" role="tab" className="st-tab" aria-selected={tab === 'plans'} onClick={() => pickTab('plans')}>Plans</button>
              <button type="button" role="tab" className="st-tab" aria-selected={tab === 'billing'} onClick={() => pickTab('billing')}>Payments &amp; invoices</button>
            </div>
          </div>
        )}

        {session && tab === 'billing' ? <PaymentsCards reloadKey={paidKey} /> : <div className="st-billing flex flex-col gap-6">
        {/* (user, 2026-11-21: "a lot and useless"; the Buy credits page's look, simple, and the plans told apart):
            the plans as cards like the credit packs, only what differs on each; what every plan has said once; the
            prices short; packs one line to Buy credits */}
        <header className="text-center">
          <h1 className="st-title">Plans</h1>
          <p className="st-sub">Every plan gives you credits to spend on anything: reading videos, AI clips, captions and exports. Start with the Trial, then pick the plan that fits how much you make.</p>
        </header>

        {mine?.testMode && <div className="st-alert" style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.08)' }}>Test mode: Subscribe turns the plan on at once with no payment.</div>}
        {mine?.paymentsMode === 'mock' && <div className="st-alert" style={{ color: '#6cb3ff', background: 'rgba(51,149,255,0.08)' }}>Dummy payments: this runs with dummy Razorpay keys. Nothing is charged.</div>}
        {mine?.paymentsMode === 'test' && <div className="st-alert" style={{ color: '#6cb3ff', background: 'rgba(51,149,255,0.08)' }}>Razorpay test mode: use Razorpay&apos;s test cards. Nothing real is charged.</div>}
        {mine?.subscription && (
          <p className="st-hint text-center" style={{ margin: 0 }}>
            {mine.subscription.status === 'cancelled'
              ? `Your plan ends on ${mine.subscription.expiresAt ? new Date(mine.subscription.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'the last day of this month'}. `
              : `Renews${mine.subscription.expiresAt ? ` on ${new Date(mine.subscription.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}. `}
            {mine.subscription.status !== 'cancelled' && <button type="button" onClick={cancel} className="st-link">Cancel subscription</button>}
          </p>
        )}
        <CurrencySwitch currency={currency} onChange={setCurrency} locked={locked} available={available} />
        {notice && <p className="st-ok text-center" role="status">{notice}</p>}
        {error && <AlertCard className="max-w-xl w-full mx-auto" title="That didn’t go through" detail={error} onClose={() => setError(null)} />}

        <section className="st-card">
          <div className={`st-plans${shown.length > 3 ? ' has-4' : ''}`}>
            {shown.map(key => {
              const plan = PLANS[key]
              const once = plan.oneTime
              const credits = once ? TRIAL_PACK.credits : plan.monthlyCredits
              const uses = packUses(credits, CLIP_CREDITS)
              const current = mine?.plan === key
              const popular = key === 'creator'
              const busy = loading === key || (once && topupBusy === 'trial')
              const n = (x: number) => x.toLocaleString('en-IN')
              return (
                <div key={key} className={`st-pack st-plan${popular ? ' is-popular' : ''}${current ? ' is-current' : ''}`}>
                  {current ? <span className="st-pack-badge is-mine">Your plan</span> : popular && <span className="st-pack-badge">Most popular</span>}
                  <span className="st-plan-name">{plan.name}</span>
                  <span className="st-pack-price">{price(key)}<span className="st-plan-per">{once ? ' once' : '/month'}</span></span>
                  <span className="st-pack-credits">{n(credits)} credits {once ? `for ${TRIAL_DAYS} days` : 'every month'}</span>
                  <ul className="st-pack-uses">
                    <li><b>{n(uses.aiClips)}</b> AI clips</li>
                    <li className="st-pack-or">or</li>
                    <li><b>{n(uses.captionedMinutes)}</b> manual exports with captions</li>
                  </ul>
                  <dl className="st-plan-rows">
                    {planCompareRows(plan).map(r => (
                      <div key={r.label} className={r.value === false ? 'is-off' : r.strong ? 'is-strong' : undefined}>
                        <dt>{r.label}</dt><dd>{r.value === false ? '—' : r.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {once ? (
                    current ? <span className="st-plan-state">Ends {mine?.trial?.endsAt ? new Date(mine.trial.endsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'soon'}</span>
                      : mine && (mine.plan !== 'free' || mine.trial?.used) ? <span className="st-plan-state">{mine.plan !== 'free' ? 'You have a plan' : 'Trial used'}</span>
                      : <button type="button" className="st-btn st-btn-ghost st-pack-buy" disabled={!!loading || !!topupBusy} onClick={() => handleSubscribe(key)}>
                          {busy ? 'Opening payment…' : `Start trial for ${price(key)}`}</button>
                  ) : current ? (
                    <span className="st-plan-state">{price(key)} a month</span>
                  ) : !plan.sold ? null : (
                    <button type="button" className={`st-btn ${popular ? 'st-btn-lime' : 'st-btn-ghost'} st-pack-buy`} disabled={!!loading || !!topupBusy} onClick={() => handleSubscribe(key)}>
                      {busy ? 'Opening payment…' : `Choose ${plan.name}`}</button>
                  )}
                </div>
              )
            })}
          </div>
          <p className="st-hint" style={{ margin: 0 }}>
            An AI clip is {CLIP_CREDITS} credits, from a video already read (reading is {READING_CREDITS} credits per 10 minutes of video). A manual export is a clip of up to a minute
            you cut yourself, with captions ({CAPTION_CREDITS_PER_MINUTE} credits) and the export ({EXPORT_CREDITS_PER_MINUTE}). {currency === 'INR' ? 'Prices include GST.' : 'Prices are in US dollars; your bank may add its own foreign-currency fee.'} Plans renew monthly and you can cancel
            anytime; unused credits roll over one month, and your Trial&apos;s unused credits move into your plan.
          </p>
        </section>

        <section className="st-card">
          <h2 className="st-card-title">Every plan includes</h2>
          <ul className="st-includes">{everyPlanIncludes().map(t => <li key={t}>{t}</li>)}</ul>
        </section>

        <section className="st-card">
          <h2 className="st-card-title">What a credit buys</h2>
          <ul className="st-prices">{creditPrices().map(p => <li key={p.name}><span>{p.name}</span><b>{p.price}</b></li>)}</ul>
          <p className="st-hint" style={{ margin: 0 }}>You see the price before every step. A job that fails gives its credits back.</p>
        </section>

        <section id="topups" className="st-card">
          <h2 className="st-card-title">Need more credits?</h2>
          <p className="st-hint" style={{ margin: 0 }}>
            Credit packs for paid plans, paid once, last {Math.round(TOPUP_CREDIT_DAYS / 30.4)} months:{' '}
            {TOPUP_PACKS.map(p => `${p.credits.toLocaleString('en-IN')} for ${formatMoney(packPriceMinor(p.key, currency) ?? 0, currency)}`).join(' · ')}.{' '}
            {session ? <a href="/billing#credits" className="st-link">Buy credits</a> : <a href="/login" className="st-link">Sign in to buy</a>}
          </p>
        </section>

        <p className="st-hint text-center" style={{ margin: 0 }}>
          A video gets at most 1 AI clip per minute of its length, and for safety one account can make up to {SAFETY_PER_DAY.aiClips} AI clips and read {SAFETY_PER_DAY.readingMinutes / 60} hours
          of video a day. Videos and their clips are deleted after the days shown (from each upload): you get an email a few days before. See our{' '}
          <a href="/refunds" className="st-link">Refund and Cancellation Policy</a>, <a href="/terms" className="st-link">Terms</a> and <a href="/privacy" className="st-link">Privacy Policy</a>.
        </p>
        </div>}
      </main>
    </div>
  )
}
