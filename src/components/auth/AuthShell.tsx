import Link from 'next/link'
import { Check } from 'lucide-react'
import { BrandLogo } from '@/components/ui/brand-logo'
import { CrowdCanvas } from '@/components/ui/crowd-canvas'
import { AuthStage } from './AuthStage'
import { COMPANY } from '@/lib/company'
import { BrandScene } from './BrandScene'
import { AUTH } from './strings'

/** The landing dust: where along the form's bottom (%), how far it drifts (px, out and up), its size (px), how long (s) */
const DUST: [number, number, number, number, number][] = [
  // the two corners: big clouds rolling out sideways and up
  [-2, -120, -70, 210, 1.4], [102, 120, -70, 210, 1.4],
  [4, -80, -110, 150, 1.3], [96, 80, -110, 150, 1.3],
  // along the bottom edge: smaller puffs spreading out
  [18, -60, -36, 170, 1.15], [36, -26, -48, 150, 1.1], [50, 0, -30, 180, 1.1], [64, 26, -48, 150, 1.1], [82, 60, -36, 170, 1.15],
]

/** What the brand side says — each auth screen can say its own (Sign in / sign up use the default) */
export type AuthBrand = {
  title: readonly string[]
  lead: string
  points?: readonly string[]
  /** The creator photo with Shortcut at work over it, behind the words (desktop) */
  visual?: boolean
}

const DEFAULT_BRAND: AuthBrand = { title: AUTH.brand.title, lead: AUTH.brand.lead, visual: true }
/** Forgot / reset password: reassurance in place of the pitch */
export const RECOVERY_BRAND: AuthBrand = { title: AUTH.recovery.brand.title, lead: AUTH.recovery.brand.lead, visual: true }

/**
 * The auth card every auth screen sits in (styles: app/auth.css): one card that always fits the
 * window (user, 2026-10-31) — the brand side on its left, the screen's form on its right. On phones
 * the brand side is a short header above the form.
 */
export function AuthShell({ brand = DEFAULT_BRAND, navAction, panda, children }: {
  brand?: AuthBrand
  /** The nav's switch (Sign in ↔ Create account); by default a plain "Sign in" (the recovery screens) */
  navAction?: React.ReactNode
  /**
   * Sign in / sign up: the panda (PandaStage) in the card, on the form's left under one spotlight, in
   * place of the crowd, the stage lights and the floating reactions (user, 2026-11-24; wide windows only)
   */
  panda?: React.ReactNode
  children: React.ReactNode
}) {
  const pitch = (
    <div className="auth-pitch">
      <h2>{brand.title.map((line, i) => <span key={line}>{i > 0 && <br />}{line}</span>)}</h2>
      <p>{brand.lead}</p>
      {brand.points && brand.points.length > 0 && (
        <ul>
          {brand.points.map(p => <li key={p}><Check aria-hidden />{p}</li>)}
        </ul>
      )}
    </div>
  )
  const card = (
    <div className="auth-card">
      <aside className="auth-brand" data-scene={brand.visual || undefined}>
        <Link href="/" aria-label={AUTH.brand.home} className="auth-home"><BrandLogo /></Link>
        {brand.visual ? <BrandScene>{pitch}</BrandScene> : <div className="auth-stage">{pitch}</div>}
        <p className="auth-fine">{AUTH.brand.fine}</p>
      </aside>
      {/* (sign in / sign up, wide windows: the panda on the card's left; phones: hidden) */}
      {panda}

      <main className="auth-side">
        <div className="auth-panel">{children}</div>
      </main>
      {/* (the dust as the form lands in the card — PandaStage drops it; wide windows, motion on) */}
      {panda && (
        <span className="ap-dust" aria-hidden="true">
          {DUST.map(([x, dx, dy, size, d], i) => (
            <span key={i} style={{ '--x': `${x}%`, '--dx': `${dx}px`, '--dy': `${dy}px`, '--s': `${size}px`, '--d': `${d}s` } as React.CSSProperties} />
          ))}
        </span>
      )}
    </div>
  )
  return (
    <div className="auth-root" data-panda={panda ? '' : undefined}>
      {!panda && <>
        {/* the audience along the bottom, behind the card (wide windows; decorative): it rises into place once
            and stands still, low and dim — calm behind the form (user, 2026-11-19: it walked, bobbed and reacted) */}
        <CrowdCanvas src="/landing/crowd.png" className="auth-crowd" tone={0.26} fill={0.42} stand />
        {/* the show above the audience: stage lights from the top, live reactions up the sides */}
        <AuthStage />
      </>}
      {/* (wide windows: a slim bar above the card, a line below it — phones keep the card alone) */}
      <header className="auth-nav">
        <Link href="/" aria-label={AUTH.brand.home} className="auth-nav-logo"><BrandLogo size="sm" /></Link>
        <nav aria-label={AUTH.nav.label}>
          <Link href="/pricing">{AUTH.nav.pricing}</Link>
          {navAction ?? <NavSwitch prompt={AUTH.nav.haveAccount} label={AUTH.nav.toSignin} href="/login" />}
        </nav>
      </header>

      {card}

      <footer className="auth-foot">
        <span>© {new Date().getFullYear()} {AUTH.footer.brand}<span className="auth-foot-co"> · {AUTH.footer.company}</span></span>
        <nav aria-label={AUTH.footer.label}>
          <Link href="/terms">{AUTH.footer.terms}</Link>
          <Link href="/privacy">{AUTH.footer.privacy}</Link>
          <Link href="/support">{AUTH.footer.support}</Link>
          <a href={`mailto:${COMPANY.email}`}>{AUTH.footer.contact}</a>
        </nav>
      </footer>
    </div>
  )
}

/**
 * The nav's switch: a quiet prompt and a small outlined button — a link, or (Sign in / sign up, which
 * switch in place and keep what was typed) a button
 */
export function NavSwitch({ prompt, label, href, onClick }: { prompt: string; label: string; href?: string; onClick?: () => void }) {
  return (
    <span className="auth-nav-switch">
      <span className="auth-nav-prompt">{prompt}</span>
      {onClick
        ? <button type="button" className="auth-nav-btn" onClick={onClick}>{label}</button>
        : <Link href={href ?? '/login'} className="auth-nav-btn">{label}</Link>}
    </span>
  )
}
