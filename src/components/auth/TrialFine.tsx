'use client'

import { AUTH } from './strings'
import { useCurrency } from '@/lib/useCurrency'
import { trialPriceText } from '@/lib/currency'

/** "Try everything for ₹49 · No subscription", with the Trial's price in the visitor's currency (2026-11-22) */
export function TrialFine() {
  const { currency } = useCurrency()
  return <>{AUTH.brand.fine(trialPriceText(currency))}</>
}
