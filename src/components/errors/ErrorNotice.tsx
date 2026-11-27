import Link from 'next/link'
import { BrandLogo } from '@/components/ui/brand-logo'
import { CalmPanda } from './CalmPanda'
import '@/app/not-found.css'

/**
 * A simple "can't go on from here" page for the account screens (user, 2026-11-28: simple, not the sign-in
 * card): the expired restore link and the reset page opened without its email. The error pages' look
 * (not-found.css): on wide windows the panda stands left of the message and looks down at it, then breathes;
 * on phones it's stacked, the panda calm above. A title, two short lines, one way on.
 * Without the panda (`icon` given — the reset page, user 2026-11-28): centred, a small calm icon on top instead.
 */
export function ErrorNotice({ title, lines, action, icon }: {
  title: string
  lines: readonly [string, string]
  action: { href: string; label: string }
  /** no panda: this small icon over the title, everything centred */
  icon?: React.ReactNode
}) {
  return (
    <div className="nf nf-crash">
      <header className="nf-head">
        <Link href="/" className="nf-logo" aria-label="Shortcut home"><BrandLogo /></Link>
        <Link href="/login" className="nf-login">Sign in</Link>
      </header>
      <main className="nf-main">
        <div className={icon ? 'nf-plain' : 'nf-side'}>
          {icon ? <span className="nf-ico" aria-hidden="true">{icon}</span> : <CalmPanda small look />}
          <div className="nf-side-text">
            <h1 className="nf-title">{title}</h1>
            <p className="nf-sub"><span>{lines[0]}</span>{' '}<span>{lines[1]}</span></p>
            <div className="nf-actions">
              <Link href={action.href} className="nf-btn nf-btn-main">
                {action.label}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </Link>
            </div>
          </div>
        </div>
      </main>
      <footer className="nf-foot">
        <span>© {new Date().getFullYear()} Shortcut · Stoory Marketing Pvt. Ltd.</span>
        <nav aria-label="Legal"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/support">Support</Link></nav>
      </footer>
    </div>
  )
}
