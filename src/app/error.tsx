'use client'

import { startTransition, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { BrandLogo } from '@/components/ui/brand-logo'
import { CalmPanda } from '@/components/errors/CalmPanda'
import './not-found.css'

/**
 * A page crashed (user, 2026-11-28): the same look as the 404 (not-found.tsx, styles in not-found.css), but
 * calm — the panda just stands, breathing (no gag: something broke, and the user may worry about their work).
 * Try again re-renders the page (and re-asks the server, for a crash there); home is the dashboard when signed
 * in. The error code is Next's digest: the same code sits next to the full error in the server log, so a user
 * can quote it to Support (shown only when there is one — a crash in the browser has none).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  const router = useRouter()
  const { status } = useSession()
  const signedIn = status === 'authenticated'
  const [copied, setCopied] = useState(false)

  const tryAgain = () => startTransition(() => { router.refresh(); reset() })
  const copy = () => {
    if (!error.digest) return
    navigator.clipboard?.writeText(error.digest).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400) }).catch(() => {})
  }
  const home = signedIn ? '/dashboard' : '/'

  return (
    <div className="nf nf-crash">
      <header className="nf-head">
        <Link href={home} className="nf-logo" aria-label="Shortcut home"><BrandLogo /></Link>
        {status === 'unauthenticated' && <Link href="/login" className="nf-login">Log in</Link>}
      </header>

      <main className="nf-main">
        <CalmPanda />

        <p className="nf-eyebrow">Something went wrong</p>
        <h1 className="nf-title">That wasn&apos;t supposed to happen.</h1>
        <p className="nf-sub">
          <span>Something broke on our side, not yours. Your work is saved.</span>{' '}
          <span>Try again, or head back home.</span>
        </p>

        <div className="nf-actions">
          <Link href={home} className="nf-btn nf-btn-quiet">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>
            {signedIn ? 'Go to dashboard' : 'Take me home'}
          </Link>
          <button type="button" className="nf-btn nf-btn-main" onClick={tryAgain}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" /></svg>
            Try again
          </button>
        </div>

        {error.digest && (
          <p className="nf-codeline">
            Error code <code>{error.digest}</code>
            <button type="button" className="nf-copy" onClick={copy} aria-label={copied ? 'Copied' : 'Copy the error code'} {...(copied ? { 'data-done': '' } : {})}>
              {copied
                ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>}
            </button>
          </p>
        )}
      </main>

      <footer className="nf-foot">
        <span>© 2026 Shortcut · Stoory Marketing Pvt. Ltd.</span>
        <nav aria-label="Legal"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/support">Support</Link></nav>
      </footer>
    </div>
  )
}
