'use client'

import { useId, type MouseEvent } from 'react'
import type { CreditsInfo } from '@/lib/useCredits'
import { BRAND_TOP, BRAND_BOTTOM } from '@/components/ui/brand-logo'

/**
 * The Shortcut coin, the credits' mark (user, 2026-11-16: "a perfect coin with the S on it… completely
 * premium"): a minted black-metal coin — a bevelled steel rim lit from the top left, a dark face set
 * into it — with the logo's S (BrandLogo) raised on it in lime (a light edge above, a shadow below)
 * and a soft sheen. The S turns amber when the balance is low.
 */
const STOPS = (cs: string[]) => cs.map((c, k) => <stop key={k} offset={k / (cs.length - 1)} stopColor={c} />)
export function CreditCoin({ size = 20, low = false }: { size?: number; low?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const s = low ? ['#ffe39a', '#f5a623', '#d17f00'] : ['#e9ff8f', '#c8ff00', '#a3d100']
  const S = (fill: string, dx = 0, dy = 0, opacity = 1) => (
    <g transform={`translate(${20 + dx} ${20 + dy}) scale(.158) translate(-51 -59)`} fill={fill} opacity={opacity}>
      <path d={BRAND_TOP} /><path d={BRAND_BOTTOM} />
    </g>
  )
  return (
    <svg className="credit-coin" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}r`} x1=".15" y1="0" x2=".85" y2="1">{STOPS(['#8a8a8a', '#3a3a3a', '#1a1a1a', '#4a4a4a'])}</linearGradient>
        <linearGradient id={`${id}f`} x1=".85" y1="1" x2=".15" y2="0">{STOPS(['#2a2a2a', '#151515', '#0c0c0c'])}</linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="1">{STOPS(s)}</linearGradient>
        <linearGradient id={`${id}h`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".18" /><stop offset=".45" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="19.5" fill={`url(#${id}r)`} />
      <circle cx="20" cy="20" r="16" fill="#050505" />
      <circle cx="20" cy="20" r="15.3" fill={`url(#${id}f)`} />
      {S('#000', 0.55, 0.75, 0.9)}
      {S(low ? '#fff1cc' : '#f7ffd6', -0.45, -0.5, 0.9)}
      {S(`url(#${id}s)`)}
      <circle cx="20" cy="20" r="19.2" fill={`url(#${id}h)`} />
    </svg>
  )
}

/** The balance in a page's header; it opens the credit history on the billing page */
export function CreditsBadge({ credits, className = 'credits-badge', onClick }: { credits: CreditsInfo | null; className?: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  if (!credits) return null
  const soon = credits.nextExpiry ? `${credits.nextExpiry.amount} credits expire ${new Date(credits.nextExpiry.at).toLocaleDateString()}. ` : ''
  const low = credits.balance <= 5
  return (
    <a href="/billing#credits" onClick={onClick} className={`${className}${credits.balance <= 5 ? ' is-low' : ''}`} title={`${soon}See your credit history`}>
      <CreditCoin low={low} />
      <span className="credits-num"><strong>{credits.balance}</strong> <span className="credits-word">credits</span></span>
    </a>
  )
}

/** Beside an "out of credits" message: the way to get more */
export function TopUpLink({ message }: { message: string | null | undefined }) {
  if (!message || !/Top up or upgrade/.test(message)) return null
  return <a href="/pricing#topups" className="credits-topup">Get credits</a>
}
