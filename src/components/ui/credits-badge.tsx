'use client'

import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
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

/**
 * The balance as a counter of reels (user, 2026-11-18: "numbers go up and stops at that number"): each digit
 * that changes spins upward through 0–9 — the last digit twice round, the others once — slowing and settling
 * on its digit of the new balance; left to right they stop one after another, the last digit last (~1.1s).
 * Lit while they spin: white when credits are taken, lime when added. Digits that stay the same stay still; a
 * digit gained or lost (999 ↔ 1000) opens or closes its slot. The first balance, and every change with motion
 * turned down, is shown as it is.
 */
function Odometer({ value }: { value: number }) {
  const [roll, setRoll] = useState<{ value: number; from: string | null; key: number }>({ value, from: null, key: 0 })
  if (roll.value !== value) {
    // (set while rendering, React's way of following a prop: the new number never shows a frame before its spin)
    const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    setRoll({ value, from: still ? null : String(roll.value), key: roll.key + 1 })
  }
  const to = String(value)
  if (roll.from == null || roll.value !== value) return <span className="odo">{to}</span>
  const n = Math.max(roll.from.length, to.length)
  const A = roll.from.padStart(n, ' '), B = to.padStart(n, ' ')
  const tone = value < Number(roll.from) ? 'is-spent' : 'is-added'
  const changed = [...B].map((d, i) => d !== A[i])
  const total = changed.filter(Boolean).length
  let k = 0
  return (
    <span className="odo">
      {[...B].map((now, i) => {
        const was = A[i]
        if (!changed[i]) return <span key={`${roll.key}-${i}`} className="odo-slot">{now}</span>
        const fromD = was === ' ' ? 0 : Number(was), toD = now === ' ' ? 0 : Number(now)
        const turns = i === n - 1 ? 2 : 1
        const steps = turns * 10 + ((toD - fromD + 10) % 10)
        const strip = Array.from({ length: steps + 1 }, (_, j) => (fromD + j) % 10)
        if (now === ' ') strip[strip.length - 1] = -1           // a digit lost: lands on nothing, its slot closes
        strip.push(now === ' ' ? -1 : (toD + 1) % 10)           // (the one just past it, seen as it settles back)
        const order = k++
        const ms = total > 1 ? 800 + Math.round((300 * order) / (total - 1)) : 1000
        const size = was === ' ' ? ' odo-grow' : now === ' ' ? ' odo-shrink' : ''
        return (
          <span key={`${roll.key}-${i}`} className={`odo-slot is-rolling ${tone}${size}`}>
            <span className="odo-strip" style={{ animationDuration: `${ms}ms`, ['--odo-to' as string]: `${-1.25 * steps}em` }}>
              {strip.map((d, j) => <span key={j} className="odo-digit">{d < 0 ? ' ' : d}</span>)}
            </span>
          </span>
        )
      })}
    </span>
  )
}

/**
 * The balance in a page's header; it opens the credit history on the billing page. When it changes, the
 * digits roll to the new number (Odometer), the coin turns once, and the change itself ("−15", "+50") shows by the pill:
 * credits taken drop away from it (neutral), credits added rise into it (lime) — then fade.
 */
export function CreditsBadge({ credits, className = 'credits-badge', onClick }: { credits: CreditsInfo | null; className?: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  const balance = credits?.balance ?? null
  const last = useRef(balance)
  const [change, setChange] = useState<{ n: number; key: number } | null>(null)
  useEffect(() => {
    const before = last.current
    last.current = balance
    if (before == null || balance == null || before === balance) return
    setChange({ n: balance - before, key: Date.now() })
  }, [balance])
  if (!credits) return null
  const soon = credits.nextExpiry ? `${credits.nextExpiry.amount} credits expire ${new Date(credits.nextExpiry.at).toLocaleDateString()}. ` : ''
  const low = credits.balance <= 5
  return (
    <a href="/billing#credits" onClick={onClick} className={`${className} credits-live${low ? ' is-low' : ''}`} title={`${soon}See your credit history`}>
      {/* (own keys: the coin's — new each change, so its turn plays again — and the chip's must never be the same,
          or React keeps the old coin beside the new one: two coins, user 2026-11-19) */}
      <span key={`coin-${change?.key ?? 0}`} className={`credit-coin-turn${change ? ' is-turning' : ''}`}><CreditCoin low={low} /></span>
      <span className="credits-num"><strong><span aria-hidden="true"><Odometer value={credits.balance} /></span><span className="sr-only">{credits.balance}</span></strong> <span className="credits-word">credits</span></span>
      {change && (
        <span key={`chip-${change.key}`} className={`credits-change ${change.n < 0 ? 'is-spent' : 'is-added'}`} aria-hidden="true">
          {change.n < 0 ? `−${Math.abs(change.n)}` : `+${change.n}`}
        </span>
      )}
      <span className="sr-only" aria-live="polite">{change ? `${Math.abs(change.n)} credits ${change.n < 0 ? 'used' : 'added'}. ${credits.balance} left.` : ''}</span>
    </a>
  )
}

/** Beside an "out of credits" message: the way to get more */
export function TopUpLink({ message }: { message: string | null | undefined }) {
  if (!message || !/Top up or upgrade/.test(message)) return null
  return <a href="/pricing#topups" className="credits-topup">Get credits</a>
}
