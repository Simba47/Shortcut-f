'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { pickBanner, type AccountFacts, type Hidden } from '@/lib/notices'
import { NoticeIcon } from './Notices'
import './notices.css'

/** Something changed the account (credits spent or given back, a purchase): the banners look again */
export const ACCOUNT_CHANGED = 'shortcut:account-changed'
export function accountChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ACCOUNT_CHANGED))
}

const HIDDEN_KEY = 'nt-hidden-banners'
function readHidden(): Hidden {
  try { return JSON.parse(sessionStorage.getItem(HIDDEN_KEY) ?? '{}') as Hidden } catch { return {} }
}

/**
 * The most urgent thing about the account, at the top of the page (user, 2026-11-26): a failed renewal, no
 * credits, the Trial ending, credits low or expiring, storage. One at a time; × hides it for this visit, and
 * it comes back if things get worse. `slim`: the editor's — only the red ones, in a thin strip.
 */
export function AccountBanner({ slim, className, style }: { slim?: boolean; className?: string; style?: React.CSSProperties }) {
  const [facts, setFacts] = useState<AccountFacts | null>(null)
  const [hidden, setHidden] = useState<Hidden>({})
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notices', { cache: 'no-store' })
      if (res.ok && res.headers.get('content-type')?.includes('json')) setFacts(await res.json())
    } catch { /* the next look will do */ }
  }, [])
  useEffect(() => {
    setHidden(readHidden())
    load()
    const onShow = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener(ACCOUNT_CHANGED, load)
    // (the Trial's and credits' days count down while a page stays open)
    const slow = setInterval(load, 5 * 60_000)
    return () => { document.removeEventListener('visibilitychange', onShow); window.removeEventListener(ACCOUNT_CHANGED, load); clearInterval(slow) }
  }, [load])

  const b = pickBanner(facts, hidden, { onlyRed: slim })
  if (!b) return null
  const hide = () => {
    const next = { ...readHidden(), [b.kind]: b.level }
    try { sessionStorage.setItem(HIDDEN_KEY, JSON.stringify(next)) } catch { /* private mode: hidden until the page reloads */ }
    setHidden(next)
  }
  return (
    <div role={b.tone === 'error' ? 'alert' : 'status'} className={`nt nt-banner${className ? ` ${className}` : ''}`} data-tone={b.tone} data-slim={slim ? '' : undefined} style={style}>
      <span className="nt-ico"><NoticeIcon tone={b.tone} size={slim ? 14 : 16} /></span>
      <p><strong>{b.title}</strong> <span>{b.text}</span></p>
      {b.action && <Link href={b.action.href} className="nt-banner-cta">{b.action.label}</Link>}
      <button type="button" className="nt-x" aria-label="Hide this message" onClick={hide}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  )
}
