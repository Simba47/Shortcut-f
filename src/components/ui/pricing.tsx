'use client'

import { motion, useSpring } from 'framer-motion'
import React, { useState, useRef, useEffect, createContext, useContext } from 'react'
import confetti from 'canvas-confetti'
import Link from 'next/link'
import { Check, X } from 'lucide-react'
import NumberFlow from '@number-flow/react'
import { cn } from '@/lib/utils'
import { PlanSymbol, type Tier } from '@/components/ui/account-menu'

// Styled with the landing page tokens (--card, --text, --muted, --btn-bg, ...)
// so it follows the page theme instead of shadcn's colour variables.

// --- INTERACTIVE STARFIELD ---

type MousePos = { x: number | null; y: number | null }
type StarSeed = { top: number; left: number; size: number; duration: number; delay: number }

const STAR_COUNT = 110

function Star({
  seed,
  mousePosition,
  containerRef,
}: {
  seed: StarSeed
  mousePosition: MousePos
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  const springConfig = { stiffness: 100, damping: 15, mass: 0.1 }
  const springX = useSpring(0, springConfig)
  const springY = useSpring(0, springConfig)

  useEffect(() => {
    if (!containerRef.current || mousePosition.x === null || mousePosition.y === null) {
      springX.set(0)
      springY.set(0)
      return
    }

    const rect = containerRef.current.getBoundingClientRect()
    const starX = rect.left + (seed.left / 100) * rect.width
    const starY = rect.top + (seed.top / 100) * rect.height
    const deltaX = mousePosition.x - starX
    const deltaY = mousePosition.y - starY
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
    const radius = 600 // Radius of magnetic influence

    if (distance < radius) {
      const force = 1 - distance / radius
      springX.set(deltaX * force * 0.5)
      springY.set(deltaY * force * 0.5)
    } else {
      springX.set(0)
      springY.set(0)
    }
  }, [mousePosition, seed, containerRef, springX, springY])

  return (
    <motion.div
      className="absolute rounded-full bg-[var(--text)]"
      style={{
        top: `${seed.top}%`,
        left: `${seed.left}%`,
        width: seed.size,
        height: seed.size,
        x: springX,
        y: springY,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0] }}
      transition={{ duration: seed.duration, repeat: Infinity, delay: seed.delay }}
    />
  )
}

function InteractiveStarfield({
  mousePosition,
  containerRef,
}: {
  mousePosition: MousePos
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  // Seeded after mount so server and client HTML match (no hydration warning)
  const [seeds, setSeeds] = useState<StarSeed[]>([])
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setSeeds(
      Array.from({ length: STAR_COUNT }, () => ({
        top: Math.random() * 100,
        left: Math.random() * 100,
        size: 1 + Math.random() * 2,
        duration: 2 + Math.random() * 3,
        delay: Math.random() * 5,
      })),
    )
  }, [])

  return (
    <div className="pointer-events-none absolute inset-0 h-full w-full overflow-hidden">
      {seeds.map((seed, i) => (
        <Star key={i} seed={seed} mousePosition={mousePosition} containerRef={containerRef} />
      ))}
    </div>
  )
}

// --- PRICING COMPONENT LOGIC ---
// (user, 2026-11-14) Monthly / Annual switch back with its sliding pill and confetti, while the plans are still being
// decided. NOTE: annual billing doesn't exist yet — the annual prices are for show; the buttons still lead to the
// monthly plans. Up to 4 plans side by side on a desktop; a line under them for GST and the full list.

export interface PricingFeature {
  text: string
  included: boolean
}

export interface PricingPlan {
  name: string
  price: number
  /** Discounted per-month rate when billed annually */
  yearlyPrice: number
  /** Paid once (the Trial pack): no annual price, "Paid once" instead of "Billed monthly" */
  once?: boolean
  /** Bold one-line summary under the price, e.g. "999 credits every month" */
  headline: string
  subline: string
  features: PricingFeature[]
  buttonText: string
  href: string
  badge?: string
  isPopular?: boolean
  /** A special pack (the Trial): drawn as a ticket — gold, a tear line with notches, a "Paid once" stamp, a shine */
  special?: boolean
  /** Which plan (trial · starter · creator · agency): its symbol beside the name, the same as in the profile menu */
  tier?: Tier
}

interface PricingSectionProps {
  plans: PricingPlan[]
  eyebrow?: string
  title?: string
  description?: string
  currency?: string
  locale?: string
}

const PricingContext = createContext<{
  isMonthly: boolean
  setIsMonthly: (value: boolean) => void
  currency: string
  locale: string
}>({
  isMonthly: true,
  setIsMonthly: () => {},
  currency: 'INR',
  locale: 'en-IN',
})

export function PricingSection({
  plans,
  eyebrow,
  title = 'Simple, Transparent Pricing',
  description = "Choose the plan that's right for you.",
  currency = 'INR',
  locale = 'en-IN',
}: PricingSectionProps) {
  const [isMonthly, setIsMonthly] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const [mousePosition, setMousePosition] = useState<MousePos>({ x: null, y: null })
  const frame = useRef<number | null>(null)
  // (the grid follows the number of plans: 4 → four across on a desktop)
  const cols = plans.length >= 4 ? 'md:grid-cols-2 xl:grid-cols-4' : plans.length === 3 ? 'md:grid-cols-2 lg:grid-cols-3' : 'md:grid-cols-2'

  // Throttle to one update per animation frame
  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const { clientX, clientY } = event
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      setMousePosition({ x: clientX, y: clientY })
    })
  }

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
  }, [])

  return (
    <PricingContext.Provider value={{ isMonthly, setIsMonthly, currency, locale }}>
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setMousePosition({ x: null, y: null })}
        className="relative w-full py-24 sm:py-32"
      >
        <InteractiveStarfield mousePosition={mousePosition} containerRef={containerRef} />
        <div className="relative z-10 mx-auto max-w-7xl px-6">
          <div className="mx-auto mb-8 max-w-5xl text-center">
            {eyebrow && <p className="mb-4 text-base font-medium text-[var(--muted)]">{eyebrow}</p>}
            <h2 className="section-title">{title}</h2>
            <p className="mt-4 whitespace-pre-line text-lg text-[var(--muted)]">{description}</p>
          </div>
          <PricingToggle />
          {/* (a size smaller, user 2026-11-21: narrower row, tighter cards) */}
          <div className={cn('mx-auto mt-8 grid max-w-6xl grid-cols-1 items-stretch gap-4', cols)}>
            {plans.map((plan, index) => (
              <PricingCard key={plan.name} plan={plan} index={index} />
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-[var(--muted)]">
            Prices include GST ·{' '}
            <Link href="/pricing" className="font-semibold text-[var(--text)] underline-offset-4 hover:underline">
              Compare all features →
            </Link>
          </p>
        </div>
      </div>
    </PricingContext.Provider>
  )
}

function PricingToggle() {
  const { isMonthly, setIsMonthly } = useContext(PricingContext)
  const monthlyBtnRef = useRef<HTMLButtonElement>(null)
  const annualBtnRef = useRef<HTMLButtonElement>(null)
  const [pillStyle, setPillStyle] = useState({})

  useEffect(() => {
    const btn = (isMonthly ? monthlyBtnRef : annualBtnRef).current
    if (btn) {
      setPillStyle({ width: btn.offsetWidth, x: btn.offsetLeft })
    }
  }, [isMonthly])

  const handleToggle = (monthly: boolean) => {
    if (isMonthly === monthly) return
    setIsMonthly(monthly)

    if (!monthly) {
      const rect = annualBtnRef.current?.getBoundingClientRect()
      if (!rect) return
      confetti({
        particleCount: 80,
        spread: 80,
        origin: {
          x: (rect.left + rect.width / 2) / window.innerWidth,
          y: (rect.top + rect.height / 2) / window.innerHeight,
        },
        colors: ['#C8FF00', '#F4F4F5', '#9ACC00'],
        ticks: 300,
        gravity: 1.2,
        decay: 0.94,
        startVelocity: 30,
        disableForReducedMotion: true,
      })
    }
  }

  const btnClass = (active: boolean) =>
    cn(
      'relative z-10 cursor-pointer rounded-full px-5 py-2 text-sm font-medium transition-colors sm:px-6',
      active ? 'text-[var(--btn-text)]' : 'text-[var(--muted)] hover:text-[var(--text)]',
    )

  return (
    <div className="flex justify-center">
      <div className="relative flex w-fit items-center rounded-full border border-[var(--border)] bg-[var(--card)] p-1">
        <motion.div
          className="absolute left-0 top-1 bottom-1 rounded-full bg-[var(--btn-bg)]"
          initial={false}
          animate={pillStyle}
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        />
        <button ref={monthlyBtnRef} onClick={() => handleToggle(true)} className={btnClass(isMonthly)}>
          Monthly
        </button>
        <button ref={annualBtnRef} onClick={() => handleToggle(false)} className={btnClass(!isMonthly)}>
          Annual
          <span className={cn('hidden sm:inline', !isMonthly ? 'opacity-70' : 'text-[var(--accent)]')}>
            {' '}(Save 20%)
          </span>
        </button>
      </div>
    </div>
  )
}

// Click feedback: a soft ripple spreads from the exact point you press, then removes itself
function addClickRipple(e: React.PointerEvent<HTMLElement>) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const btn = e.currentTarget
  const r = btn.getBoundingClientRect()
  const size = Math.max(r.width, r.height) * 2
  const dot = document.createElement('span')
  dot.className = 'click-ripple'
  dot.style.width = dot.style.height = `${size}px`
  dot.style.left = `${e.clientX - r.left - size / 2}px`
  dot.style.top = `${e.clientY - r.top - size / 2}px`
  dot.addEventListener('animationend', () => dot.remove())
  btn.appendChild(dot)
}

function PricingCard({ plan, index }: { plan: PricingPlan; index: number }) {
  const { isMonthly, currency, locale } = useContext(PricingContext)
  const isFree = plan.price === 0
  // In the annual view the big number is the yearly total, with the full-price year struck through
  const showAnnual = !isMonthly && !isFree && !plan.once
  const annualTotal = plan.yearlyPrice * 12
  const fullYear = plan.price * 12
  const savings = fullYear - annualTotal
  const money = (n: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
  const symbol =
    new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0).find(p => p.type === 'currency')?.value ?? currency

  // (user, 2026-11-14: the original card's look, restored — sizes, lime ticks, "It's free" / "Billed monthly")
  return (
    <motion.div
      initial={{ y: 40, opacity: 0 }}
      whileInView={{ y: 0, opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, type: 'spring', stiffness: 100, damping: 20, delay: index * 0.12 }}
      className={cn(
        'relative flex flex-col rounded-2xl border p-6 text-left transition-colors',
        plan.special
          ? 'price-special'
          : plan.isPopular
          ? 'price-popular'
          : 'border-[var(--border)] bg-[var(--card)] hover:border-[var(--border-strong)]',
      )}
    >
      {/* the popular plan: a lime light travelling round its edge, a breathing glow (styles .price-popular in app/landing.css) */}
      {plan.isPopular && <span className="pc-edge" aria-hidden="true" />}
      {/* the special pack's fine gold edge, a light slowly travelling round it (styles .price-special in app/landing.css) */}
      {plan.special && <span className="ps-edge" aria-hidden="true" />}
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2.5 text-xl font-bold tracking-[-0.02em] text-[var(--text)]">
          {/* the plan's own symbol (the profile menu's), in a small tile tinted to the card */}
          {plan.tier && (
            <span className={cn('price-sym', plan.special && 'price-sym-gold', plan.isPopular && 'price-sym-lime')} aria-hidden="true">
              <PlanSymbol tier={plan.tier} size={15} className="price-sym-svg" />
            </span>
          )}
          {plan.name}
        </h3>
        {plan.badge && (
          <span
            className={cn(
              'whitespace-nowrap rounded-full px-2.5 py-[5px] text-[10px] font-bold uppercase leading-none tracking-[0.07em]',
              plan.special
                ? 'ps-badge'
                : plan.isPopular
                ? 'pc-badge'
                : 'bg-[var(--hover)] text-[var(--muted)]',
            )}
          >
            {plan.badge}
          </span>
        )}
      </div>

      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="text-base font-semibold text-[var(--muted)]">{symbol}</span>
        <span className="text-4xl font-extrabold tracking-[-0.045em] text-[var(--text)]">
          <NumberFlow value={showAnnual ? annualTotal : plan.price} locales={locale} format={{ maximumFractionDigits: 0 }} className="tabular-nums" />
        </span>
        {/* (the month, after a subscription's price — user, 2026-11-21: "₹599/month") */}
        {!plan.once && !isFree && !showAnnual && <span className="text-base font-semibold text-[var(--muted)]">/month</span>}
        {showAnnual && (
          <span className="text-xl font-bold text-[var(--dim)] line-through decoration-2">
            {new Intl.NumberFormat(locale).format(fullYear)}
          </span>
        )}
      </div>
      <p className={cn('mt-1.5 text-sm text-[var(--muted)]', plan.special && 'ps-paid')}>
        {isFree ? (
          "It's free"
        ) : plan.once ? (
          'Paid once'
        ) : showAnnual ? (
          <>
            Billed annually · <span className="font-semibold text-[var(--accent)]">save {money(savings)}</span>
          </>
        ) : (
          'Billed monthly'
        )}
      </p>

      <div className="mt-5">
        <p className="text-[15.5px] font-bold leading-snug text-[var(--text)]">{plan.headline}</p>
        <p className="mt-1 text-sm text-[var(--muted)]">{plan.subline}</p>
      </div>
      {/* the special pack: the ticket's tear line, notched at both edges */}
      {plan.special && <div className="ps-perf" aria-hidden="true" />}

      <ul role="list" className="mt-5 space-y-2.5 text-sm leading-snug">
        {plan.features.map(f => (
          <li key={f.text} className={cn('flex gap-3', f.included ? 'text-[var(--muted)]' : 'text-[var(--dim)]')}>
            {f.included ? (
              // (green ticks for what's included, grey crosses for what isn't — user, 2026-11-21)
              <Check className="mt-px h-4 w-4 flex-none text-[#22c55e]" strokeWidth={2.6} aria-label="Included" />
            ) : (
              <X className="mt-px h-4 w-4 flex-none opacity-70" aria-label="Not included" />
            )}
            {f.text}
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-6"> 
        <Link
          href={plan.href}
          onPointerDown={addClickRipple}
          className={cn(
            'relative inline-flex h-11 w-full items-center justify-center overflow-hidden rounded-full text-sm font-semibold transition active:scale-[0.96]',
            plan.special
              ? 'ps-btn'
              : plan.isPopular
              ? 'bg-[var(--btn-bg)] text-[var(--btn-text)] hover:opacity-90'
              : 'border border-[var(--border-strong)] text-[var(--text)] hover:bg-[var(--hover)]',
          )}
        >
          {plan.buttonText}
        </Link>
        {showAnnual && (
          <p className="mt-3 text-center text-xs text-[var(--dim)]">Works out to {money(plan.yearlyPrice)}/month</p>
        )}
      </div>
    </motion.div>
  )
}
