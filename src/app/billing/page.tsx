'use client'

import { useCallback, useEffect, useState } from 'react'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { AccountMenu } from '@/components/ui/account-menu'
import { CreditsBadge } from '@/components/ui/credits-badge'
import { BrandLoaderScreen } from '@/components/ui/brand-loader'
import {
  TOPUP_PACKS, TEST_PACK, TOPUP_CREDIT_DAYS, POPULAR_PACK, packSaving, packUses,
  READING_CREDITS, CAPTION_CREDITS_PER_MINUTE, EXPORT_CREDITS_PER_MINUTE,
} from '@/lib/credits'
import { CLIP_CREDITS } from '@/lib/aiLimits'
import { buyCreditPack } from '@/lib/razorpayCheckout'
import type { CreditsState } from '@/components/billing/BillingCards'

/**
 * Buy credits: where the credits button goes (user, 2026-11-19), only the Purchase credits card. The credit
 * history is a popup from the account menu (account-menu.tsx); payments and invoices are a tab on Plans
 * & billing (/pricing#billing). (styles: .st-* in globals.css)
 */

/** Which credits run out, in words ("599 plan credits expire on…") */
const KIND_WORD: Record<string, string> = { plan: 'plan credits', topup: 'top-up credits', trial: 'Trial credits', bonus: 'bonus credits', refund: 'credits', free: 'free credits' }

/**
 * Purchase: the balance and the credit packs to buy right here. Packs are for paid plans (the server
 * refuses them on no plan or the Trial: topup.ts): those see the way to a plan instead.
 */
function PurchaseCard({ c, plan, testPack, onBought }: { c: CreditsState; plan: string | null; testPack: boolean; onBought: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function buy(pack: string) {
    setBusy(pack); setError(null); setNotice(null)
    try {
      const out = await buyCreditPack(pack)
      if (out) {
        setNotice(`${out.credits} credits added. You now have ${out.balance}.`)
        onBought()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  const canBuy = plan !== 'free' && plan !== 'trial'
  const packs = [...TOPUP_PACKS, ...(testPack ? [TEST_PACK] : [])]
  const n = (x: number) => x.toLocaleString('en-IN')
  const day = (at: string) => new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const expiries = c.expiries?.length ? c.expiries : c.nextExpiry ? [{ ...c.nextExpiry, kind: '' }] : []
  return (
    <section id="credits" className="st-card">
      <h2 className="st-card-title">Purchase credits</h2>

      {/* (user, 2026-11-19) "450 / 599 credits": what is left of the credits still in force, then when they run out */}
      <div>
        <p className="st-balance">
          <b>{n(c.balance)}</b>
          {c.total != null && c.total > 0 && <span className="st-balance-of"> / {n(c.total)}</span>}
          <span className="st-balance-word"> credits left</span>
        </p>
        {expiries.length > 0 && (
          <ul className="st-expiries">
            {expiries.map((e, i) => <li key={i}>{n(e.amount)} {KIND_WORD[e.kind] ?? 'credits'} expire on {day(e.at)}</li>)}
          </ul>
        )}
        {c.held > 0 && <p className="st-hint" style={{ margin: '6px 0 0' }}>{n(c.held)} are held for work still running, and come back if it fails.</p>}
      </div>

      <div>
        {!canBuy ? (
          <p className="st-hint">
            Credit packs are for paid plans. {plan === 'trial' ? 'Your unused Trial credits move into your plan when you choose one.' : 'Start with the Trial pack or choose a plan.'}{' '}
            <a href="/pricing" className="st-link">See plans</a>
          </p>
        ) : (
          <>
            {/* Each pack: the price first and biggest (what is paid), the plans' price struck beside it, then the
                credits and what they make (user, 2026-11-19: so the credits are not read as rupees) */}
            <div className="st-packs">
              {packs.map(p => {
                const saving = packSaving(p)
                const uses = packUses(p.credits, CLIP_CREDITS)
                const popular = p.key === POPULAR_PACK
                return (
                  <div key={p.key} className={`st-pack${popular ? ' is-popular' : ''}`}>
                    {popular && <span className="st-pack-badge">Popular</span>}
                    <span className="st-pack-price">
                      ₹{n(p.price)}
                      {saving && <s className="st-pack-was" aria-label={`was ₹${n(saving.was)}`}>₹{n(saving.was)}</s>}
                    </span>
                    {saving ? <span className="st-pack-save">Save {saving.percent}%</span> : <span className="st-pack-save" aria-hidden="true">&nbsp;</span>}
                    <span className="st-pack-credits">{n(p.credits)} credits</span>
                    <ul className="st-pack-uses">
                      <li><b>{n(uses.aiClips)}</b> AI clips</li>
                      <li className="st-pack-or">or</li>
                      <li><b>{n(uses.captionedMinutes)}</b> manual exports with captions</li>
                    </ul>
                    <button type="button" className={`st-btn ${popular ? 'st-btn-lime' : 'st-btn-ghost'} st-pack-buy`} disabled={!!busy || plan == null} onClick={() => buy(p.key)}>
                      {busy === p.key ? 'Opening…' : `Buy for ₹${n(p.price)}`}
                    </button>
                  </div>
                )
              })}
            </div>
            <p className="st-hint" style={{ marginTop: 10 }}>
              An AI clip is {CLIP_CREDITS} credits with its export, from a video already read (reading is {READING_CREDITS} credits per 10 minutes of video). A manual export
              is a clip of up to a minute you cut yourself, with captions ({CAPTION_CREDITS_PER_MINUTE} credits) and the export ({EXPORT_CREDITS_PER_MINUTE}).
              The struck price is the same credits at the plans&apos; rate of ₹1 a credit. Paid once, prices include GST. Pack credits last {Math.round(TOPUP_CREDIT_DAYS / 30.4)} months, and your plan&apos;s credits are used first.
            </p>
          </>
        )}
        {notice && <p className="st-ok" role="status" style={{ marginTop: 8 }}>{notice}</p>}
        {error && <p className="st-err" role="alert" style={{ marginTop: 8 }}>{error}</p>}
      </div>
      <p className="st-hint" style={{ margin: 0 }}>
        <a href="/pricing#billing" className="st-link">Payments &amp; invoices</a>
      </p>
    </section>
  )
}

export default function BillingPage() {
  const [plan, setPlan] = useState<{ plan: string; testPack: boolean } | null>(null)
  const [credits, setCredits] = useState<CreditsState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/billing/plan', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null))
      .then(d => d && setPlan({ plan: d.plan, testPack: !!d.testPack })).catch(() => {})
  }, [])
  const loadCredits = useCallback(() => {
    fetch('/api/credits', { cache: 'no-store' })
      .then(async r => { const d = await r.json().catch(() => null); if (!r.ok || !d || typeof d.balance !== 'number') throw new Error('Your credits could not be loaded. Try again in a moment.'); return d as CreditsState })
      .then(setCredits)
      .catch(e => setError(e instanceof Error ? e.message : 'Your credits could not be loaded.'))
  }, [])
  useEffect(loadCredits, [loadCredits])

  if (!credits && !error) return <BrandLoaderScreen label="Opening your credits…" />

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0b0b0c' }}>
      <nav className="flex items-center gap-3 px-4 shrink-0 sticky top-0 z-10"
        style={{ height: 56, background: 'rgba(14,14,15,0.85)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <Breadcrumbs shine items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Buy credits' }]} />
        <div className="flex-1" />
        {/* the page's own balance, so a pack bought here rolls the button up at once ("+500") */}
        <CreditsBadge credits={credits && { balance: credits.balance, held: credits.held, nextExpiry: credits.nextExpiry }} />
        <AccountMenu />
      </nav>

      <main className="st-billing flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">
        {error && <div className="st-alert st-alert-red" role="alert">{error}</div>}
        {credits && <PurchaseCard c={credits} plan={plan?.plan ?? null} testPack={!!plan?.testPack} onBought={loadCredits} />}
      </main>
    </div>
  )
}
