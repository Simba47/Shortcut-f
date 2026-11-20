'use client'

import { useCallback, useEffect, useState } from 'react'
import { amountInRupees } from '@/lib/invoice'
import { ledgerLabel } from '@/lib/credits'

// The account's money cards (user, 2026-11-19): Credit history in a popup from the account menu, Payment
// history and the Agency invoice details on Plans & billing (its Payments & invoices tab). The Purchase credits card is the billing page (/billing), where the credits button goes.
// Styles: .st-* in globals.css; wrap them in .st-billing for the bigger text.

type CreditRow = { id: string; delta: number; reason: string; refType: string | null; shadow: boolean; createdAt: string }
export type CreditsState = {
  balance: number; held: number; nextExpiry: { amount: number; at: string } | null; ledger: CreditRow[]
  /** What the credits still in force came as ("450 / 599"), and when what is left runs out */
  total?: number | null; expiries?: { amount: number; at: string; kind: string }[]
}

const TABLE = { width: '100%', borderCollapse: 'collapse', fontSize: 14.5, color: 'rgba(244,244,245,0.85)' } as const
const HEAD = { textAlign: 'left', color: 'rgba(244,244,245,0.45)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' } as const
const ROW = { borderTop: '1px solid rgba(255,255,255,0.07)' }

/**
 * Credit history: what each credit went on, newest first (the last 30: /api/credits). The inside of the
 * account menu's Credit history popup (user, 2026-11-19: from the menu, no longer a tab on Account settings).
 */
export function CreditHistory() {
  const [c, setC] = useState<CreditsState | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    fetch('/api/credits', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && typeof d.balance === 'number') setC(d); else setFailed(true) }).catch(() => setFailed(true))
  }, [])
  const rows = c?.ledger.filter(r => !r.shadow) ?? []
  return (
    <div className="st-billing am-ch-body">
      <p className="st-hint" style={{ margin: 0 }}>Every time credits are added or used: what it was for and how many. Credits for a job that fails come back to you and show up here too.</p>
      {c && <p className="st-hint" style={{ margin: 0 }}>You have <b style={{ color: '#F4F4F5' }}>{c.balance} credits</b>. <a href="/billing" className="st-link">Buy credits</a></p>}
      {!c && !failed && <p className="st-hint">Loading…</p>}
      {failed && <p className="st-hint">Your credit history could not be loaded. Try again in a moment.</p>}
      {c && rows.length === 0 && <p className="st-hint">Nothing here yet. Each time credits are added or used, it shows up here.</p>}
      {rows.length > 0 && (
        <div className="st-scroll">
          <table style={TABLE}>
            <thead>
              <tr style={HEAD}>
                <th style={{ padding: '8px 8px 8px 0' }}>Date</th><th style={{ padding: 8 }}>What</th><th style={{ padding: 8, textAlign: 'right' }}>Credits</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={ROW}>
                  <td style={{ padding: '10px 8px 10px 0', whiteSpace: 'nowrap' }}>{new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                  <td style={{ padding: 10 }}>{ledgerLabel(r.reason, r.refType)}</td>
                  <td style={{ padding: 10, textAlign: 'right', whiteSpace: 'nowrap', color: r.delta > 0 ? '#c8ff00' : undefined }}>{r.delta > 0 ? `+${r.delta}` : r.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

type Payment = { id: string; invoiceNo: string | null; planName: string; amountPaise: number; paidAt: string }
type Details = { name: string | null; gstin: string | null; stateCode: string | null; address: string | null }
type State = { code: string; name: string }
type PaymentsInfo = { payments: Payment[]; invoiceDetails: boolean; details: Details | null; states: State[]; taxInvoices: boolean }

/**
 * Payment history, and on Agency the company details for the invoices beside it (plans.ts gstInvoices).
 * `reloadKey`: change it to load again (after a payment on the same page).
 */
export function PaymentsCards({ reloadKey = 0 }: { reloadKey?: number }) {
  const [info, setInfo] = useState<PaymentsInfo | null>(null)
  const [details, setDetails] = useState<Details>({ name: null, gstin: null, stateCode: null, address: null })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(() => {
    fetch('/api/billing/payments', { cache: 'no-store' })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not load your payments'); return d as PaymentsInfo })
      .then(d => { setInfo(d); if (d.details) setDetails(d.details) })
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load your payments'))
  }, [])
  useEffect(load, [load, reloadKey])

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
  const set = (k: keyof Details) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { setSaved(false); setDetails(d => ({ ...d, [k]: e.target.value || null })) }
  const payments = info?.payments ?? null

  return (
    <div className="st-billing flex flex-col gap-6">
      {error && <div className="st-alert st-alert-red" role="alert">{error}</div>}
      {/* Agency: Payment history | Details on your invoices, side by side; other plans: Payment history alone */}
      <div className="st-grid">
        <section className={`st-card${info?.invoiceDetails ? '' : ' st-wide'}`}>
          <div>
            <h2 className="st-card-title">Payment history</h2>
            <p className="st-card-desc">Every payment you have made, for a plan, the Trial or a credit pack. Open its {info?.taxInvoices ? 'GST invoice' : 'receipt'} to view, print or save it.</p>
          </div>
          {!info && !error && <p className="st-hint">Loading…</p>}
          {payments && payments.length === 0 && <p className="st-hint">No payments yet. When you pay for a plan or credits, each payment shows up here.</p>}
          {payments && payments.length > 0 && (
            <div className="st-scroll">
              <table style={TABLE}>
                <thead>
                  <tr style={HEAD}>
                    <th style={{ padding: '8px 8px 8px 0' }}>Date</th><th style={{ padding: 8 }}>Plan</th>
                    <th style={{ padding: 8, textAlign: 'right' }}>Amount</th><th style={{ padding: 8 }}>Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} style={ROW}>
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

        {/* Company details on invoices: Agency only (plans.ts gstInvoices, user 2026-11-19) */}
        {info?.invoiceDetails && (
          <form className="st-card" onSubmit={save}>
            <div>
              <h2 className="st-card-title">Details on your invoices</h2>
              <p className="st-card-desc">Your company&apos;s name, GSTIN, state and address, printed on your next invoices. Add your GSTIN to claim input tax credit. Invoices already issued don&apos;t change.</p>
            </div>
            <label className="st-field"><span className="st-label">Name or company</span>
              <input className="st-input" value={details.name ?? ''} onChange={set('name')} maxLength={120} /></label>
            <label className="st-field"><span className="st-label">GSTIN (optional)</span>
              <input className="st-input" value={details.gstin ?? ''} onChange={set('gstin')} maxLength={15} placeholder="36AABCS1234A1Z5" style={{ textTransform: 'uppercase' }} /></label>
            <label className="st-field"><span className="st-label">State</span>
              <select className="st-input" value={details.stateCode ?? ''} onChange={set('stateCode')}>
                <option value="">Not set</option>
                {info.states.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select></label>
            <label className="st-field"><span className="st-label">Address (optional)</span>
              <textarea className="st-input" rows={2} value={details.address ?? ''} onChange={set('address')} maxLength={300} /></label>
            <div>
              <button type="submit" className="st-btn st-btn-lime" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              {saved && <span className="st-hint" style={{ marginLeft: 12 }}>Saved</span>}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
