'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { PLANS } from '@/lib/plans'
import { BrandLogo } from '@/components/ui/brand-logo'

const PLAN_ORDER = ['free', 'starter', 'creator', 'agency'] as const

declare global {
  interface Window { Razorpay: new (o: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: never) => void) => void } }
}

function loadCheckoutScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = 'https://checkout.razorpay.com/v1/checkout.js'
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('The payment window could not load. Check your connection and try again.'))
    document.body.appendChild(el)
  })
}

export default function PricingPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [mine, setMine] = useState<{ plan: string; testMode: boolean; subscription: { status: string; expiresAt: string | null } | null } | null>(null)
  useEffect(() => {
    if (!session) return
    fetch('/api/billing/plan').then(r => r.ok ? r.json() : null).then(d => d && setMine(d)).catch(() => {})
  }, [session])

  async function handleSubscribe(planKey: string) {
    if (!session) { router.push('/login'); return }
    if (planKey === 'free') return
    setLoading(planKey)
    setError(null)
    try {
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planKey }),
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
  async function openCheckout(d: { subscriptionId: string; keyId: string; planName: string; email?: string }) {
    await loadCheckoutScript()
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

  async function cancel() {
    if (!window.confirm('Stop renewing? You keep your plan until the month you paid for ends.')) return
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
        <a href="/dashboard" aria-label="Shortcut dashboard" style={{ '--text': '#F4F4F5', '--logo': '#C8FF00', textDecoration: 'none' } as React.CSSProperties}>
          <BrandLogo shine />
        </a>
        {session && (
          <a href="/dashboard" className="text-xs px-3 py-1.5 rounded-lg" style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
            Dashboard
          </a>
        )}
      </nav>

      <main className="max-w-5xl mx-auto px-6 pt-14 pb-20">
        <h1 className="text-3xl font-bold text-white text-center mb-2">Simple, transparent pricing</h1>
        <p className="text-center mb-3" style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.9rem' }}>
          Paid plans renew monthly · Cancel anytime
        </p>

        {mine?.testMode && (
          <div className="mx-auto max-w-sm mb-10 rounded-xl px-4 py-2.5 text-center text-xs" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b' }}>
            Test mode — clicking Subscribe activates the plan instantly with no payment
          </div>
        )}
        {mine?.subscription && (
          <p className="text-center text-xs mb-8" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {mine.subscription.status === 'cancelled'
              ? `Your plan ends on ${mine.subscription.expiresAt ? new Date(mine.subscription.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'the last day of this month'}. `
              : `Renews${mine.subscription.expiresAt ? ` on ${new Date(mine.subscription.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}. `}
            {mine.subscription.status !== 'cancelled' && (
              <button onClick={cancel} className="underline" style={{ color: 'rgba(255,255,255,0.7)' }}>Cancel subscription</button>
            )}
          </p>
        )}

        {error && (
          <p className="text-center text-sm mb-6" style={{ color: '#f87171' }}>{error}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {PLAN_ORDER.map(key => {
            const plan = PLANS[key]
            const isPaid = plan.price > 0
            const isPopular = key === 'creator'
            const busy = loading === key
            return (
              <div
                key={key}
                className="rounded-2xl flex flex-col"
                style={{
                  background: isPopular ? 'rgba(200,255,0,0.08)' : '#161616',
                  border: `1px solid ${isPopular ? 'rgba(200,255,0,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  padding: '24px 20px',
                }}
              >
                {isPopular && (
                  <div className="text-xs font-semibold mb-3 px-2 py-0.5 rounded self-start" style={{ background: '#c8ff00', color: '#000' }}>
                    Most Popular
                  </div>
                )}
                <div className="text-sm font-semibold mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>{plan.name}</div>
                <div className="flex items-end gap-1 mb-5">
                  {isPaid ? (
                    <>
                      <span className="text-3xl font-bold text-white">₹{plan.price}</span>
                      <span className="text-sm pb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>/month</span>
                    </>
                  ) : (
                    <span className="text-3xl font-bold text-white">Free</span>
                  )}
                </div>

                <ul className="flex-1 space-y-2.5 mb-6">
                  {([
                    [`${plan.maxVideos} video${plan.maxVideos === 1 ? '' : 's'}`, true],
                    [`Up to ${plan.maxFileSizeGb} GB per video`, true],
                    [plan.maxClips ? `${plan.maxClips} clips` : 'Unlimited clips', true],
                    [`${plan.retentionDays} days history`, true],
                    ['Auto captions', plan.autoCaption],
                    ['No watermark', !plan.watermark],
                  ] as [string, boolean][]).map(([label, included]) => (
                    <li key={label} className="flex items-center gap-2 text-sm" style={{ color: included ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.2)' }}>
                      <span style={{ color: included ? '#c8ff00' : 'rgba(255,255,255,0.15)', fontSize: '1rem', lineHeight: '1' }}>
                        {included ? '✓' : '×'}
                      </span>
                      {label}
                    </li>
                  ))}
                </ul>

                {isPaid ? (
                  <button
                    onClick={() => handleSubscribe(key)}
                    disabled={!!loading || mine?.plan === key}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity"
                    style={{
                      background: isPopular ? '#c8ff00' : 'rgba(255,255,255,0.1)',
                      color: isPopular ? '#000' : '#fff',
                      opacity: loading && !busy ? 0.4 : 1,
                      cursor: loading ? 'wait' : 'pointer',
                    }}
                  >
                    {busy ? 'Opening payment…' : mine?.plan === key ? `Your plan — ₹${plan.price}/mo` : `Subscribe — ₹${plan.price}/mo`}
                  </button>
                ) : (
                  <div className="w-full py-2.5 rounded-xl text-sm font-semibold text-center" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    Default plan
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
