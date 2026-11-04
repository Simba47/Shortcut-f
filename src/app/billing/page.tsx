'use client'

import { useEffect, useState } from 'react'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { AccountMenu } from '@/components/ui/account-menu'
import { BrandLoaderScreen } from '@/components/ui/brand-loader'
import { amountInRupees } from '@/lib/invoice'

type Payment = { id: string; invoiceNo: string | null; planName: string; amountPaise: number; paidAt: string }
type Details = { name: string | null; gstin: string | null; stateCode: string | null; address: string | null }
type State = { code: string; name: string }

/** Payments and invoices: what you paid, the invoice for each payment, and what goes on your next invoices. (styles: .st-* in globals.css) */
export default function BillingPage() {
  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [details, setDetails] = useState<Details>({ name: null, gstin: null, stateCode: null, address: null })
  const [states, setStates] = useState<State[]>([])
  const [taxInvoices, setTaxInvoices] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/billing/payments')
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not load your payments'); return d })
      .then(d => { setPayments(d.payments); setDetails(d.details); setStates(d.states); setTaxInvoices(d.taxInvoices) })
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load your payments'))
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setSaved(false); setError(null)
    try {
      const res = await fetch('/api/billing/details', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(details) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Could not save')
      setDetails(d.details); setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  if (!payments && !error) return <BrandLoaderScreen label="Opening your payments…" />
  const set = (k: keyof Details) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { setSaved(false); setDetails(d => ({ ...d, [k]: e.target.value || null })) }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0b0b0c' }}>
      <nav className="flex items-center gap-3 px-4 shrink-0 sticky top-0 z-10"
        style={{ height: 56, background: 'rgba(14,14,15,0.85)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <Breadcrumbs shine items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Payments & invoices' }]} />
        <div className="flex-1" />
        <AccountMenu />
      </nav>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">
        <header>
          <h1 className="st-title">Payments &amp; invoices</h1>
          <p className="st-sub">Every payment you have made, with its {taxInvoices ? 'GST invoice' : 'receipt'}. <a href="/pricing" className="st-link">Plans →</a></p>
        </header>

        {error && <div className="st-alert st-alert-red" role="alert">{error}</div>}

        <section className="st-card">
          <h2 className="st-card-title">Payments</h2>
          {payments && payments.length === 0 && <p className="st-hint">No payments yet. When you subscribe, each payment shows up here.</p>}
          {payments && payments.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: 'rgba(244,244,245,0.85)' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'rgba(244,244,245,0.45)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    <th style={{ padding: '8px 8px 8px 0' }}>Date</th><th style={{ padding: 8 }}>Plan</th>
                    <th style={{ padding: 8, textAlign: 'right' }}>Amount</th><th style={{ padding: 8 }}>Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                      <td style={{ padding: '10px 8px 10px 0', whiteSpace: 'nowrap' }}>{new Date(p.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td style={{ padding: 10 }}>{p.planName}</td>
                      <td style={{ padding: 10, textAlign: 'right', whiteSpace: 'nowrap' }}>₹{amountInRupees(p.amountPaise)}</td>
                      <td style={{ padding: 10, whiteSpace: 'nowrap' }}>
                        <a href={`/billing/invoice/${p.id}`} className="st-link" target="_blank" rel="noopener">{p.invoiceNo ?? 'View'}</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <form className="st-card" onSubmit={save}>
          <h2 className="st-card-title">Details on your invoices</h2>
          <p className="st-hint">Used for your next payments; invoices already issued don&apos;t change. Add your company&apos;s GSTIN to claim input tax credit.</p>
          <label className="st-field"><span className="st-label">Name or company</span>
            <input className="st-input" value={details.name ?? ''} onChange={set('name')} maxLength={120} /></label>
          <label className="st-field"><span className="st-label">GSTIN (optional)</span>
            <input className="st-input" value={details.gstin ?? ''} onChange={set('gstin')} maxLength={15} placeholder="36AABCS1234A1Z5" style={{ textTransform: 'uppercase' }} /></label>
          <label className="st-field"><span className="st-label">State</span>
            <select className="st-input" value={details.stateCode ?? ''} onChange={set('stateCode')}>
              <option value="">Not set</option>
              {states.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select></label>
          <label className="st-field"><span className="st-label">Address (optional)</span>
            <textarea className="st-input" rows={2} value={details.address ?? ''} onChange={set('address')} maxLength={300} /></label>
          <div>
            <button type="submit" className="st-btn st-btn-lime" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            {saved && <span className="st-hint" style={{ marginLeft: 12 }}>Saved</span>}
          </div>
        </form>
      </main>
    </div>
  )
}
