'use client'

import type { Currency } from '@/lib/currency'

/**
 * The ₹ / $ switch on the pricing pages (2026-11-22), for a wrong guess from the time zone. Once the account has
 * paid, its currency is fixed and the switch becomes a line saying which.
 */
export function CurrencySwitch({ currency, onChange, locked }: { currency: Currency; onChange: (c: Currency) => void; locked: boolean }) {
  if (locked) {
    return <p className="st-hint text-center" style={{ margin: 0 }}>Your account pays in {currency === 'INR' ? 'Indian rupees (₹)' : 'US dollars ($)'}.</p>
  }
  return (
    <div className="flex justify-center">
      <div className="st-tabs" role="radiogroup" aria-label="Currency">
        <button type="button" role="radio" className="st-tab" aria-selected={currency === 'INR'} aria-checked={currency === 'INR'} onClick={() => onChange('INR')}>₹ India</button>
        <button type="button" role="radio" className="st-tab" aria-selected={currency === 'USD'} aria-checked={currency === 'USD'} onClick={() => onChange('USD')}>$ Outside India</button>
      </div>
    </div>
  )
}
