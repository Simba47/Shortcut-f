'use client'

import { useCallback, useEffect, useState } from 'react'

export interface CreditsInfo {
  balance: number
  held: number
  nextExpiry: { amount: number; at: string } | null
}

/**
 * The signed-in user's credit balance, or null while it loads and whenever credits are off (the
 * site then shows no prices). Looks again when the tab comes back into view, so a top-up made in
 * another tab, or a job that finished, shows without a reload.
 */
export function useCredits(): { credits: CreditsInfo | null; refresh: () => void } {
  const [credits, setCredits] = useState<CreditsInfo | null>(null)
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/credits', { cache: 'no-store' })
      if (!res.ok) return
      const d = await res.json()
      setCredits(d.mode && d.mode !== 'off' && typeof d.balance === 'number' ? { balance: d.balance, held: d.held ?? 0, nextExpiry: d.nextExpiry ?? null } : null)
    } catch { /* the next look will do */ }
  }, [])
  useEffect(() => {
    refresh()
    const onShow = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [refresh])
  return { credits, refresh }
}
