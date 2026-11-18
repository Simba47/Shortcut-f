'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

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
export function useCredits(initial?: CreditsInfo | null): { credits: CreditsInfo | null; refresh: () => Promise<void>; apply: (c: CreditsInfo) => void } {
  // (`initial`: the balance the page was sent with — the editor's, 2026-11-17: shown in the first frame, not
  // popping in a moment later; still looked up again at once. undefined: not known yet)
  const [credits, setCredits] = useState<CreditsInfo | null>(initial ?? null)
  // Only the newest answer counts (user, 2026-11-18): looks that cross (the list's polling, a refresh after an
  // upload) must never put an older balance back over a newer one — the pill would roll back and forth
  const latest = useRef(0)
  const refresh = useCallback(async () => {
    const mine = ++latest.current
    try {
      const res = await fetch('/api/credits?brief=1', { cache: 'no-store' })
      if (!res.ok || mine !== latest.current) return
      const d = await res.json()
      if (mine !== latest.current) return
      setCredits(d.mode && d.mode !== 'off' && typeof d.balance === 'number' ? { balance: d.balance, held: d.held ?? 0, nextExpiry: d.nextExpiry ?? null } : null)
    } catch { /* the next look will do */ }
  }, [])
  /**
   * A balance an answer brought with it (an upload's: what it was paid with is already taken out), shown at
   * once; any look still on its way is from before it and is dropped. Then looked at again, to be sure.
   */
  const apply = useCallback((c: CreditsInfo) => {
    latest.current++
    setCredits({ balance: c.balance, held: c.held ?? 0, nextExpiry: c.nextExpiry ?? null })
    refresh()
  }, [refresh])
  useEffect(() => {
    refresh()
    const onShow = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [refresh])
  return { credits, refresh, apply }
}
