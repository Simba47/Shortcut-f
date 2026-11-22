'use client'

import { useCallback, useEffect, useState } from 'react'
import { currencyFromTimeZone, isCurrency, type Currency } from './currency'

// Which currency the pricing pages show (user, 2026-11-22: "Auto, locked at first payment"):
//   1. an account that has paid: its own (`locked`, from /api/billing/plan), and the switch is hidden
//   2. the visitor's own pick on the ₹ / $ switch, kept in this browser
//   3. the browser's time zone: India's is rupees, anywhere else dollars
// The first frame is rupees (the server can't know the time zone), then the guess.

const KEY = 'sc-currency'

function stored(): Currency | null {
  try { const v = window.localStorage.getItem(KEY); return isCurrency(v) ? v : null } catch { return null }
}

export function useCurrency(locked?: Currency | null): { currency: Currency; setCurrency: (c: Currency) => void; locked: boolean } {
  const [picked, setPicked] = useState<Currency>('INR')
  useEffect(() => {
    let tz: string | undefined
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone } catch { tz = undefined }
    setPicked(stored() ?? currencyFromTimeZone(tz))
  }, [])
  const setCurrency = useCallback((c: Currency) => {
    setPicked(c)
    try { window.localStorage.setItem(KEY, c) } catch { /* private window: this visit only */ }
  }, [])
  return { currency: locked ?? picked, setCurrency, locked: !!locked }
}
