'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Flame, Languages, Mail, MapPin, Menu, MousePointerClick, Move, Phone, ScanFace, Send, Upload, WandSparkles, X } from 'lucide-react'
import { motion, useReducedMotion, useScroll } from 'framer-motion'
import { PricingSection, type PricingPlan } from '@/components/ui/pricing'
import { DotField } from '@/components/ui/dot-field'
import { FillButtonContent } from '@/components/ui/fill-button'
import { BrandLogo } from '@/components/ui/brand-logo'
import { CircularCarousel, type CarouselItem } from '@/components/ui/circular-carousel'
import { SectionTransition } from '@/components/ui/section-transition'
import { FaqSection, type FaqItem } from '@/components/ui/faq-section'
import { HeroSplit } from '@/components/landing/hero-split'
import { HeroEditor } from '@/components/landing/hero-editor'
import { FeatureShowcase } from '@/components/landing/feature-showcase'
import { FlyIn } from '@/components/landing/fly-in'
import { FooterWordmark } from '@/components/landing/footer-wordmark'
import type Lenis from 'lenis'
import { IntroSection, ProblemSection, WhoSection, WhySection } from '@/components/landing/sections'
import { useLiteMotion } from '@/components/ui/use-lite-motion'
import { PLANS } from '@/lib/plans'
import { brandKitLimit } from '@/lib/shared/brandKit'
import { teamSeats } from '@/lib/shared/brandTeam'
import { canKeep } from '@/lib/expiry'
import { TRIAL_PACK, TRIAL_DAYS } from '@/lib/credits'
import { COMPANY } from '@/lib/company'
import { formatMoney, planPriceMinor, type Currency } from '@/lib/currency'
import { useCurrency } from '@/lib/useCurrency'
import { GMAIL_COMPOSE, openMailAppOnPhones } from '@/components/ui/email-link'

// (user, 2026-11-14) The landing page shows the real plans, read from lib/plans.ts — the same source as the
// Pricing page and the app — so its names, prices and limits can't drift apart again. (It used to have its own
// copy: Starter shown as "Pro", Agency as "Business", Creator left out, and an Annual price billing doesn't offer.)
// The key facts only; the Pricing page lists every limit.
// (plans v2, user 2026-11-21: Trial, Starter, Pro; Agency is no longer sold)
const LANDING_PLANS = ['trial', 'starter', 'creator'] as const
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
function planFeatures(plan: (typeof PLANS)[keyof typeof PLANS]) {
  // (plans v2, 2026-11-21: credits for what you do; the hours of video read are back since 2026-11-22)
  const hours = plan.readingMinutes >= 60 ? count(plan.readingMinutes / 60, 'hour', 'hours') : `${plan.readingMinutes} minutes`
  return [
    { text: `${hours} of video ${plan.allowancesOnce ? 'in total' : 'a month'}`, included: true },
    { text: 'Spend credits on anything', included: true },
    ...(plan.uploadsLimit != null ? [{ text: `${count(plan.uploadsLimit, 'upload', 'uploads')} in total`, included: true }] : []),
    { text: 'Unlimited clips you cut yourself', included: !plan.maxClips },
    { text: `${plan.storageGb} GB of storage`, included: true },
    { text: count(plan.devices, 'device signed in at a time', 'devices signed in at a time'), included: true },
    { text: `Up to ${plan.maxFileSizeGb} GB per video`, included: true },
    { text: count(brandKitLimit(plan.key), 'brand kit', 'brand kits'), included: true },
    { text: canKeep(plan.key) ? `Videos kept ${plan.retentionDays} days, or for good with ★ Keep` : `Videos kept ${plan.retentionDays} days`, included: true },
    { text: 'Captions on AI clips', included: plan.autoCaption },
    { text: 'No watermark', included: !plan.watermark },
    // (these two last on every card, user 2026-11-23)
    { text: 'Share brand kits with your team', included: teamSeats(plan.key) > 0 },
    { text: 'Priority exports', included: plan.priorityExports },
  ]
}

/** The plans for the landing page, in rupees or dollars (2026-11-22: dollars outside India) */
const pricingPlans = (currency: Currency): PricingPlan[] => LANDING_PLANS.filter(key => planPriceMinor(key, currency) !== null).map(key => {
  const plan = PLANS[key]
  const once = plan.oneTime
  const price = (planPriceMinor(key, currency) ?? 0) / 100
  return {
    name: plan.name,
    price,
    // (user, 2026-11-14) Annual shown for now while the plans are discussed: 20% off the monthly price.
    // Billing is monthly only — the buttons still lead to the monthly plans.
    yearlyPrice: currency === 'INR' ? Math.round(price * 0.8) : Math.round(price * 80) / 100,
    once,
    // (user's website copy, 2026-11-21)
    headline: once ? `${TRIAL_PACK.credits} credits to try everything.` : `${plan.monthlyCredits.toLocaleString('en-IN')} credits every month.`,
    subline: once ? `Lasts ${TRIAL_DAYS} days. No subscription.` : 'Unused credits roll over one month.',
    features: planFeatures(plan),
    buttonText: once ? `Start for ${formatMoney(planPriceMinor(key, currency) ?? 0, currency)}` : `Choose ${plan.name}`,
    // Sign up first (landing visitors are signed out), then straight to the Pricing page to pay
    // (lib/nextPath.ts keeps ?callbackUrl through the email code and Google)
    href: '/signup?callbackUrl=%2Fpricing',
    tier: key,
    ...(key === 'creator' ? { badge: 'Most popular', isPopular: true } : {}),
    // (user, 2026-11-21: the Trial is a special pack — a ticket, in gold)
    ...(key === 'trial' ? { badge: '✦ Try it first', special: true } : {}),
  }
})

// FAQ between Pricing and the closing section. Plan-by-plan differences live in Pricing, not here.
const FAQS: FaqItem[] = [
  // (user's website copy, 2026-11-21: six questions, word for word)
  {
    question: 'What is Shortcut?',
    answer: 'Shortcut is a video editing tool that helps you turn long-form videos into short vertical clips for Instagram Reels, YouTube Shorts and TikTok.',
  },
  {
    question: 'Does Shortcut automatically choose the best moments?',
    answer: 'No. You choose the moments you want. Shortcut helps you edit them faster.',
  },
  {
    question: 'What type of videos can I upload?',
    answer: 'Podcasts, interviews, lectures, streams, vlogs and other long-form videos.',
  },
  {
    question: 'Do I need editing experience?',
    answer: 'No. Shortcut simplifies framing, cropping, captions and layouts.',
  },
  {
    question: 'Can I add captions and text?',
    answer: 'Yes. You can generate captions automatically and add your own hooks, titles and callouts.',
  },
  {
    question: 'Can I create clips without using AI clips?',
    answer: 'Yes. You can cut your own clips, and this feature is unlimited across all plans.',
  },
]

// Languages drifting across the closing section
const LANGUAGES = [
  { native: 'English', name: 'English' },
  { native: 'हिंदी', name: 'Hindi' },
  { native: 'தமிழ்', name: 'Tamil' },
  { native: 'ಕನ್ನಡ', name: 'Kannada' },
  { native: 'മലയാളം', name: 'Malayalam' },
  { native: 'বাংলা', name: 'Bengali' },
  { native: 'मराठी', name: 'Marathi' },
  { native: 'ગુજરાતી', name: 'Gujarati' },
  { native: 'ਪੰਜਾਬੀ', name: 'Punjabi' },
  { native: 'ଓଡ଼ିଆ', name: 'Odia' },
  { native: 'తెలుగు', name: 'Telugu' },
  { native: 'Tenglish', name: 'Tenglish' },
]
// Highlighted in lime wherever it appears
const HIGHLIGHT_LANGUAGE = 'Telugu'
// Per-lane depth and speed (cycled across the languages); odd lanes travel right → left
const LANE_SIZES = ['lg', 'sm', 'md', 'sm', 'lg', 'md'] as const
const LANE_DURATIONS = [22, 30, 26, 34, 24, 28]

// "How it works" steps
// How It Works (user's website copy, 2026-11-21): five steps, word for word
const STEPS = [
  { title: 'Upload Your Video', desc: 'Upload your podcast, interview, stream or any long-form video.' },
  { title: 'Select Your Moment', desc: 'Choose the exact portion of the video you want to turn into a short.' },
  { title: 'Guide Your Frame', desc: 'Play your video and move the vertical frame to follow the person or action you want to highlight.' },
  { title: 'Make It Yours', desc: 'Add automatic captions, custom text and ready-made layouts.' },
  { title: 'Finish and Post', desc: 'Your video renders while you edit. Finish your work and get your clip ready to post.' },
]

// Features: the fly-through on desktop, the circular carousel on smaller screens / reduced motion
const TUNNEL_QUERY = '(min-width: 1100px) and (pointer: fine) and (prefers-reduced-motion: no-preference)'
const tunnelSub = (on: () => void) => { const mq = window.matchMedia(TUNNEL_QUERY); mq.addEventListener('change', on); return () => mq.removeEventListener('change', on) }
const useTunnel = () => useSyncExternalStore(tunnelSub, () => window.matchMedia(TUNNEL_QUERY).matches, () => false)

const featureIcon = (glyph: string, tone: string) => <span className={`feature-icon ${tone}`} aria-hidden>{glyph}</span>

// Features (user's website copy, 2026-11-21): five, word for word, in the copy's order. Each keeps the card art of the
// feature it names (feature-tunnel.tsx: steer, export, captions, hooks, layouts); the design is unchanged
const FEATURES: CarouselItem[] = [
  { id: 'steer', tag: 'Framing', icon: featureIcon('◎', 'fi-warm'), title: 'Play-and-Steer Framing', description: 'Move your vertical frame while your video plays. Follow what matters in real time.' },
  { id: 'export', tag: 'Speed', icon: featureIcon('⬆', 'fi-green'), title: 'Parallel Rendering', description: 'Your clip renders while you edit. No waiting for a separate export.' },
  { id: 'captions', tag: 'Captions', icon: featureIcon('≋', 'fi-yellow'), title: 'Automatic Captions', description: 'Generate captions automatically for your AI-generated clips.' },
  { id: 'hooks', tag: 'Text', icon: featureIcon('⚡', 'fi-green'), title: 'Custom Text', description: 'Add hooks, titles and callouts to make your videos stand out.' },
  { id: 'layouts', tag: 'Layouts', icon: featureIcon('▤', 'fi-blue'), title: 'Ready-Made Layouts', description: 'Choose from different video and text combinations to create the look you want.' },
]

const CONTACT = COMPANY

// The phone menu's links (and the sections kept within one screen); unchanged — phones aren't part of the
// 2026-11-20 desktop rework
const EXPLORE = [
  { label: 'How it works', href: '#process' },
  { label: 'Features', href: '#features' },
  { label: 'Trends', href: '#trends' },
  { label: 'Pricing', href: '#pricing' },
]
// The desktop bar's links, after Home (user's website copy, 2026-11-20: Home · How It Works · Features ·
// Pricing · FAQ, and Get Started)
const NAV_LINKS = [
  { label: 'How It Works', href: '#process' },
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
]
// Footer "Explore" column (the client's footer links)
const FOOTER_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Help', href: '#faq' },
]

// Instagram links to the official account.
// bg is the brand colour of the circle that slides up on hover; hoverIcon (optional)
// replaces the icon on that circle.
const SOCIALS = [
  {
    label: 'Shortcut on Instagram',
    bg: 'linear-gradient(72.44deg, #FF7A00 11.92%, #FF0169 51.56%, #D300C5 85.69%)',
    href: 'https://www.instagram.com/shortcutapp_official',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
        <path fillRule="evenodd" clipRule="evenodd" d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-2a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
        <path d="M18 5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
        <path fillRule="evenodd" clipRule="evenodd" d="M1.654 4.276C1 5.56 1 7.24 1 10.6v2.8c0 3.36 0 5.04.654 6.324a6 6 0 0 0 2.622 2.622C5.56 23 7.24 23 10.6 23h2.8c3.36 0 5.04 0 6.324-.654a6 6 0 0 0 2.622-2.622C23 18.44 23 16.76 23 13.4v-2.8c0-3.36 0-5.04-.654-6.324a6 6 0 0 0-2.622-2.622C18.44 1 16.76 1 13.4 1h-2.8C7.24 1 5.56 1 4.276 1.654a6 6 0 0 0-2.622 2.622ZM13.4 3h-2.8c-1.713 0-2.878.002-3.778.075-.877.072-1.325.202-1.638.361a4 4 0 0 0-1.748 1.748c-.16.313-.29.761-.361 1.638C3.002 7.722 3 8.887 3 10.6v2.8c0 1.713.002 2.878.075 3.778.072.877.202 1.325.361 1.638a4 4 0 0 0 1.748 1.748c.313.16.761.29 1.638.361.9.073 2.065.075 3.778.075h2.8c1.713 0 2.878-.002 3.778-.075.877-.072 1.325-.202 1.638-.361a4 4 0 0 0 1.748-1.748c.16-.313.29-.761.361-1.638.073-.9.075-2.065.075-3.778v-2.8c0-1.713-.002-2.878-.075-3.778-.072-.877-.202-1.325-.361-1.638a4 4 0 0 0-1.748-1.748c-.313-.16-.761-.29-1.638-.361C16.278 3.002 15.113 3 13.4 3Z" />
      </svg>
    ),
  },
  {
    label: 'Email Shortcut',
    bg: '#FFFFFF',
    href: GMAIL_COMPOSE,
    onClick: openMailAppOnPhones,
    icon: (
      <svg viewBox="52 42 88 66" width="22" height="17" fill="currentColor" aria-hidden>
        <path d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
        <path d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
        <path d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
        <path d="M72 74V48l24 18 24-18v26L96 92" />
        <path d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
      </svg>
    ),
    // Official multicolour Gmail logo (2020)
    hoverIcon: (
      <svg viewBox="52 42 88 66" width="22" height="17" aria-hidden>
        <path fill="#4285F4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
        <path fill="#34A853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
        <path fill="#FBBC04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
        <path fill="#EA4335" d="M72 74V48l24 18 24-18v26L96 92" />
        <path fill="#C5221F" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
      </svg>
    ),
  },
  {
    label: 'Shortcut on WhatsApp',
    bg: '#25D366',
    href: 'https://wa.me/917702404917',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
      </svg>
    ),
  },
]

const NAV_H = 60      // .lp-nav height (sticky, so it covers the top of the screen)
const FIT_GAP = 16   // minimum space kept above and below a section's content

// Smooth scrolling (Lenis) on desktop; null elsewhere. Page jumps go through it so they don't fight it.
let lenis: Lenis | null = null
function scrollToY(y: number, smooth: boolean) {
  if (lenis) lenis.scrollTo(y, { immediate: !smooth, duration: 1.1 })
  else window.scrollTo({ top: y, behavior: smooth ? 'smooth' : 'auto' })
}

// Document Y of an element's layout box. Uses offsetTop, so the scroll-driven
// transforms on sections (tilt / zoom / reveal) don't skew the measurement.
function docTop(el: HTMLElement) {
  let y = 0
  for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop
  return y
}

// A section's content box: walks down the wrapper divs to the element holding the
// section padding, and measures what's inside that padding.
function sectionContent(section: HTMLElement) {
  let inner: HTMLElement = section
  while (parseFloat(getComputedStyle(inner).paddingTop) === 0 && inner.firstElementChild instanceof HTMLElement) {
    inner = inner.firstElementChild
  }
  const cs = getComputedStyle(inner)
  const padTop = parseFloat(cs.paddingTop)
  return { inner, top: docTop(inner) + padTop, height: inner.offsetHeight - padTop - parseFloat(cs.paddingBottom) }
}

// On desktop, shrink each nav section's [data-fit] element (with CSS zoom, so the
// layout shrinks too) until the section's content fits one screen below the nav.
// [data-fit] must sit inside the section's padded box so the measurements stay in
// unzoomed px.
function fitSectionsToScreen(ids: string[]) {
  for (const id of ids) {
    const section = document.getElementById(id)
    const el = section?.querySelector<HTMLElement>('[data-fit]')
    if (!section || !el) continue
    el.style.zoom = ''
    el.style.width = ''
    if (window.innerWidth < 960) { fitToWidth(el); continue }
    const excess = sectionContent(section).height - (window.innerHeight - NAV_H - FIT_GAP * 2)
    if (excess <= 0) continue
    el.style.zoom = String(Math.max(0.55, (el.offsetHeight - excess) / el.offsetHeight))
  }
}

// Phones: an element with data-fit-width="N" is laid out at N px (its full desktop
// layout) and zoomed down to the available width, so nothing has to be hidden
function fitToWidth(el: HTMLElement) {
  const design = Number(el.dataset.fitWidth)
  const parent = el.parentElement
  if (!design || !parent) return
  const cs = getComputedStyle(parent)
  const avail = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  if (avail >= design) return
  el.style.width = `${design}px`
  el.style.zoom = String(avail / design)
}

// Scroll so a section's content (inside its padding) sits in the space below the
// nav: centred when it fits, top-aligned under the nav when it's taller.
function scrollToSection(id: string, smooth: boolean) {
  const section = document.getElementById(id)
  if (!section) return
  const { top, height } = sectionContent(section)
  const room = window.innerHeight - NAV_H
  const centred = top - NAV_H - Math.max(FIT_GAP, (room - height) / 2)
  // Don't scroll so high that the previous section peeks in above this one
  let y = Math.max(centred, Math.min(docTop(section), top - NAV_H - FIT_GAP))
  // A pinned fly-in section (fly-in.tsx): land where its cards have all landed
  const fly = section.querySelector<HTMLElement>('.fly-pinned')
  if (fly?.dataset.pin) y = docTop(fly) - NAV_H + Number(fly.dataset.pin)
  scrollToY(y, smooth)
  history.replaceState(null, '', `#${id}`)
}

// A section without the scroll-driven entrance (desktop, where FlyIn animates it instead); same surface
function PlainSection({ id, className, children }: { id?: string; className?: string; variant?: string; children: React.ReactNode }) {
  return <div id={id} className={`section-transition ${className ?? ''}`}>{children}</div>
}

/**
 * "Captions in ___" (hero feature row; user 2026-11-21): the word changes through the caption languages, each in its
 * own script, starting with Telugu. Reduced motion: "multiple languages", still. Screen readers hear one sentence.
 */
const ROLL_LANGS = ['Telugu', 'Hindi', 'Tamil', 'Kannada', 'Malayalam', 'Bengali', 'Marathi', 'Gujarati', 'Punjabi', 'Odia', 'English', 'Tenglish']
  .map(n => LANGUAGES.find(l => l.name === n)!)
function HeroLangs() {
  const [i, setI] = useState(-1)                         // -1: still ("multiple languages")
  const rolled = useRef(false)                           // past the first word (from then on, 0 has a word before it)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setI(0)
    const id = setInterval(() => setI(n => (n + 1) % ROLL_LANGS.length), 1800)
    return () => clearInterval(id)
  }, [])
  const l = i < 0 ? null : ROLL_LANGS[i]
  const prev = i > 0 || (i === 0 && rolled.current) ? ROLL_LANGS[(i + ROLL_LANGS.length - 1) % ROLL_LANGS.length] : null
  if (i > 0) rolled.current = true
  return (
    <>
      <span className="sr-only">Captions in {LANGUAGES.length} languages</span>
      <span aria-hidden="true">
        Captions in{' '}
        {/* (the new word rolls in as the old one rolls out, so there is never a gap) */}
        <span className="hero-lang">
          {prev && <span className="hero-lang-word hero-lang-out" key={`o${i}`}>{prev.native}</span>}
          <span className="hero-lang-word" key={i}>{l ? l.native : 'multiple languages'}</span>
        </span>
      </span>
    </>
  )
}

/**
 * The subheadline as a moment (user, 2026-11-20): it types itself, "Turn long videos into short-form content.
 * Faster.", with a blinking cursor; a beat on "Faster."; then the payoff — the word lights up lime, a count opens
 * in front of it and runs 1× → 10×, and "10× faster." pops with a lime underline sweeping under it. Once; reduced
 * motion: the end state straight away. Screen readers hear the final sentence.
 */
const LEAD_BASE = 'Turn long videos into short-form content. '
const LEAD_WORD = 'Faster.'
function HeroLead() {
  const full = LEAD_BASE.length + LEAD_WORD.length
  const [typed, setTyped] = useState(0)
  const [n, setN] = useState(0)                        // the count (0: not started)
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setTyped(full); setN(10); setDone(true); return }
    const timers: ReturnType<typeof setTimeout>[] = []
    let raf = 0
    // type: a letter every ~16 ms (a little longer after the full stop), as the headline rises in
    // (quicker, user 2026-11-21: "10× faster." reads at ~2.7 s, not ~4.4 s)
    let at = 450
    for (let i = 1; i <= full; i++) {
      at += LEAD_BASE[i - 2] === '.' ? 120 : 16
      timers.push(setTimeout(() => setTyped(i), at))
    }
    // a beat on "Faster.", then the count
    timers.push(setTimeout(() => {
      const start = performance.now(), ms = 900
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / ms)
        setN(Math.max(1, Math.round(1 + 9 * (1 - Math.pow(1 - k, 3)))))
        if (k < 1) raf = requestAnimationFrame(step)
        else setDone(true)
      }
      raf = requestAnimationFrame(step)
    }, at + 450))
    return () => { timers.forEach(clearTimeout); cancelAnimationFrame(raf) }
  }, [full])
  const base = LEAD_BASE.slice(0, typed)
  const word = typed > LEAD_BASE.length ? LEAD_WORD.slice(0, typed - LEAD_BASE.length) : ''
  return (
    <>
      <span className="sr-only">{LEAD_BASE}10× faster.</span>
      <span aria-hidden="true">
        {base}
        {word && (
          <strong className="faster" data-hi={n > 0 || undefined} data-done={done || undefined}>
            <span className="faster-num">{n > 0 ? `${n}×` : ''}</span><span className="faster-word">{n > 0 ? 'faster.' : word}</span>
          </strong>
        )}
        {!done && <span className="lead-caret" />}
      </span>
    </>
  )
}

// Hand-drawn arrow that swaps in for the label on .arrow-btn hover
function SquiggleArrow() {
  return (
    <svg className="arrow-btn-arrow" viewBox="0 0 38 15" fill="currentColor" aria-hidden>
      <path d="M10 7.519l-.939-.344h0l.939.344zm14.386-1.205l-.981-.192.981.192zm1.276 5.509l.537.843.148-.094.107-.139-.792-.611zm4.819-4.304l-.385-.923h0l.385.923zm7.227.707a1 1 0 0 0 0-1.414L31.343.448a1 1 0 0 0-1.414 0 1 1 0 0 0 0 1.414l5.657 5.657-5.657 5.657a1 1 0 0 0 1.414 1.414l6.364-6.364zM1 7.519l.554.833.029-.019.094-.061.361-.23 1.277-.77c1.054-.609 2.397-1.32 3.629-1.787.617-.234 1.17-.392 1.623-.455.477-.066.707-.008.788.034.025.013.031.021.039.034a.56.56 0 0 1 .058.235c.029.327-.047.906-.39 1.842l1.878.689c.383-1.044.571-1.949.505-2.705-.072-.815-.45-1.493-1.16-1.865-.627-.329-1.358-.332-1.993-.244-.659.092-1.367.305-2.056.566-1.381.523-2.833 1.297-3.921 1.925l-1.341.808-.385.245-.104.068-.028.018c-.011.007-.011.007.543.84zm8.061-.344c-.198.54-.328 1.038-.36 1.484-.032.441.024.94.325 1.364.319.45.786.64 1.21.697.403.054.824-.001 1.21-.09.775-.179 1.694-.566 2.633-1.014l3.023-1.554c2.115-1.122 4.107-2.168 5.476-2.524.329-.086.573-.117.742-.115s.195.038.161.014c-.15-.105.085-.139-.076.685l1.963.384c.192-.98.152-2.083-.74-2.707-.405-.283-.868-.37-1.28-.376s-.849.069-1.274.179c-1.65.43-3.888 1.621-5.909 2.693l-2.948 1.517c-.92.439-1.673.743-2.221.87-.276.064-.429.065-.492.057-.043-.006.066.003.155.127.07.099.024.131.038-.063.014-.187.078-.49.243-.94l-1.878-.689zm14.343-1.053c-.361 1.844-.474 3.185-.413 4.161.059.95.294 1.72.811 2.215.567.544 1.242.546 1.664.459a2.34 2.34 0 0 0 .502-.167l.15-.076.049-.028.018-.011c.013-.008.013-.008-.524-.852l-.536-.844.019-.012c-.038.018-.064.027-.084.032-.037.008.053-.013.125.056.021.02-.151-.135-.198-.895-.046-.734.034-1.887.38-3.652l-1.963-.384zm2.257 5.701l.791.611.024-.031.08-.101.311-.377 1.093-1.213c.922-.954 2.005-1.894 2.904-2.27l-.771-1.846c-1.31.547-2.637 1.758-3.572 2.725l-1.184 1.314-.341.414-.093.117-.025.032c-.01.013-.01.013.781.624zm5.204-3.381c.989-.413 1.791-.42 2.697-.307.871.108 2.083.385 3.437.385v-2c-1.197 0-2.041-.226-3.19-.369-1.114-.139-2.297-.146-3.715.447l.771 1.846z" />
    </svg>
  )
}

export function LandingPage() {
  // Prices in rupees in India and dollars elsewhere, by the visitor's time zone (or their pick on the Plans page)
  const { currency } = useCurrency()
  // One progress value drives the whole hero → features transition:
  // 0 when the features sheet enters the bottom of the screen, 1 when it reaches the top.
  const sheetRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress: raw } = useScroll({ target: sheetRef, offset: ['start end', 'start start'] })
  // Once the sheet fully covers the hero, the hero stops drawing (hidden; its animation pauses) —
  // it stays pinned behind the Problem section for a while, and nobody can see it
  const [heroCovered, setHeroCovered] = useState(false)
  useEffect(() => raw.on('change', v => setHeroCovered(v >= 0.999)), [raw])
  // (user 2026-11-21: the entrances play again each time the hero comes back, not only on the first visit) once the
  // hero has been scrolled fully away, coming back remounts its words, so the headline, the typing and the buttons
  // run in again; the editor keeps playing
  const [heroVisit, setHeroVisit] = useState(0)
  const heroWasCovered = useRef(false)
  useEffect(() => {
    if (heroCovered) heroWasCovered.current = true
    else if (heroWasCovered.current) { heroWasCovered.current = false; setHeroVisit(n => n + 1) }
  }, [heroCovered])
  // As soon as the Problem section starts sliding up, the hero's looping animation pauses, so the
  // two never draw at the same time (that overlap made the hand-off stutter)
  const [heroPaused, setHeroPaused] = useState(false)
  useEffect(() => raw.on('change', v => setHeroPaused(v > 0.02)), [raw])
  const reduceMotion = useReducedMotion()
  // Phones/touch screens scroll plainly: per-frame blur/scale effects stutter there
  const lite = useLiteMotion()

  // (user, 2026-11-20: no scroll effect between the hero and the Problem section — the page scrolls plainly; the
  // Problem section's content fades up as it comes in, like the other sections)

  const heroRef = useRef<HTMLElement>(null)
  const tunnel = useTunnel()
  // Desktop: the page glides (Lenis smooth scrolling); the 3D scroll animations ride on it
  useEffect(() => {
    if (!tunnel) return
    let raf = 0, alive = true
    import('lenis').then(({ default: L }) => {
      if (!alive) return
      lenis = new L({ lerp: 0.11, wheelMultiplier: 1, smoothWheel: true })
      const loop = (t: number) => { lenis?.raf(t); raf = requestAnimationFrame(loop) }
      raf = requestAnimationFrame(loop)
    })
    return () => { alive = false; cancelAnimationFrame(raf); lenis?.destroy(); lenis = null }
  }, [tunnel])
  // Desktop: sections fly in (FlyIn) instead of the tilt / zoom entrances
  const Sec = tunnel ? PlainSection : SectionTransition

  // Keep every nav section within one screen, so a nav click shows all of it
  useEffect(() => {
    const ids = EXPLORE.map(l => l.href.slice(1))
    const fit = () => fitSectionsToScreen(ids)
    fit()
    document.fonts?.ready.then(fit)
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const goToSection = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault()
    setMenuOpen(false)
    scrollToSection(href.slice(1), !reduceMotion)
  }

  // Once the features sheet reaches the nav (i.e. we've left the hero), the black
  // link tab turns see-through
  const [pastHero, setPastHero] = useState(false)
  // Once the footer is fully open (scrolled to the bottom, or it fills the screen up to the bar),
  // the bar's logo steps aside: the footer has its own, and the two would sit on top of each other
  const [footerOpen, setFooterOpen] = useState(false)
  // Scrolled at all: the bar gets its own blurred background (the hero now scrolls under it — user, 2026-11-20)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    let raf = 0
    const check = () => {
      raf = 0
      setScrolled(window.scrollY > 8)
      const sheet = sheetRef.current
      if (sheet) setPastHero(sheet.getBoundingClientRect().top <= NAV_H)
      const foot = document.querySelector('.lp-footer')
      if (foot) {
        const r = foot.getBoundingClientRect()
        setFooterOpen(r.top <= NAV_H + 40 || r.bottom <= window.innerHeight + 2)
      }
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(check) }
    check()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const goHome = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    setMenuOpen(false)
    scrollToY(0, !reduceMotion)
  }

  // Phone menu (the tab of section links is hidden below 960px)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    const onResize = () => { if (window.innerWidth >= 960) setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize) }
  }, [menuOpen])

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target) }
      }),
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    )
    document.querySelectorAll('.lp-root .reveal:not(.visible)').forEach((el, i) => {
      ;(el as HTMLElement).style.transitionDelay = (i % 3) * 0.07 + 's'
      observer.observe(el)
    })
    return () => observer.disconnect()
    // again once desktop mode kicks in: the sections re-mount (PlainSection) with fresh elements
  }, [tunnel])

  return (
    <div className="lp-root">

      {/* ── NAV ── */}
      <nav className={`lp-nav${pastHero ? ' nav-past-hero' : ''}`} data-scrolled={scrolled || undefined}>
        <a href="#" className="logo" aria-label="Shortcut home" data-away={footerOpen || undefined} tabIndex={footerOpen ? -1 : undefined}><BrandLogo shine /></a>
        <ul className="nav-links">
          <li>
            <a href="#" onClick={goHome}>Home</a>
          </li>
          {NAV_LINKS.map(l => (
            <li key={l.href}><a href={l.href} onClick={e => goToSection(e, l.href)}>{l.label}</a></li>
          ))}
        </ul>
        <div className="nav-right">
          {/* (desktop: no Log in in the bar — the user's copy has Get Started only; the sign-up page's own bar
              has "Sign in". Phones keep it: nav-login in landing.css) */}
          <Link href="/login" className="btn-nav-ghost fill-btn fill-btn-sm nav-login"><FillButtonContent>Log in</FillButtonContent></Link>
          <Link href="/signup" className="btn-nav-primary arrow-btn">
            <span className="arrow-btn-label">Get Started</span>
            <SquiggleArrow />
          </Link>
          <button
            type="button"
            className="nav-menu-btn"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="nav-menu"
            onClick={() => setMenuOpen(o => !o)}
          >
            {menuOpen ? <X aria-hidden /> : <Menu aria-hidden />}
          </button>
        </div>
        {menuOpen && (
          <div id="nav-menu" className="nav-menu">
            <a href="#" onClick={goHome}>Home</a>
            {EXPLORE.map(l => <a key={l.href} href={l.href} onClick={e => goToSection(e, l.href)}>{l.label}</a>)}
            <Link href="/login" className="nav-menu-login">Log in</Link>
          </div>
        )}
      </nav>

      {/* ── HERO + FEATURES: hero pins while features slides over it ── */}
      <div className="hero-stack">
      <section className="hero" ref={heroRef} data-covered={heroCovered || undefined} data-paused={heroPaused || undefined}>
        {/* Soft light shade, same as the closing CTA section */}
        <div className="hero-shade" aria-hidden />
        {/* Interactive dot field: lights up around the cursor, ripples on click */}
        <div className="hero-field" aria-hidden>
          {!lite && <DotField hostRef={heroRef} mono />}
        </div>

        {/* Desktop: text and buttons on the left, the lens animation on the right.
            Below 1100px the two stack, centred. */}
        <div className="hero-grid">
        <div className="hero-text" key={heroVisit}>
          {/* (user's website copy, 2026-11-20: the headline, "short form" the one lime highlight) */}
          <h1 className="hero-headline">
            {/* (two even lines, each a whole thought — user 2026-11-22: "The shortcut / to short form") */}
            <span className="line"><span className="line-inner">The shortcut</span></span>
            <span className="line"><span className="line-inner">to <span className="warm">short form</span></span></span>
          </h1>
          <div>
          {/* the subheadline, one centred line ending in "Faster." */}
          <p className="hero-sub hero-lead intro" style={{ '--d': '.5s' } as React.CSSProperties}>
            <HeroLead />
          </p>
          {/* (phones keep the two lines here; desktop has them, shorter and animated, under the buttons) */}
          <p className="hero-body hero-copy-phone intro" style={{ '--d': '.6s' } as React.CSSProperties}>
            Got a podcast, interview, stream or long video? Turn it into <span className="whitespace-nowrap">ready-to-post</span> Instagram Reels, YouTube Shorts and TikToks in minutes.
          </p>
          <p className="hero-note hero-copy-phone intro" style={{ '--d': '.68s' } as React.CSSProperties}>
            You choose the moments. Shortcut takes care of the editing.
          </p>
          <div className="hero-ctas intro" style={{ '--d': '.78s' } as React.CSSProperties}>
            <Link href="/signup" className="btn-nav-primary arrow-btn hero-cta-main">
              <span className="arrow-btn-label">Get Started</span>
              <SquiggleArrow />
            </Link>
            <a href="#process" onClick={e => goToSection(e, '#process')} className="btn-nav-ghost fill-btn hero-cta-ghost">
              <FillButtonContent>See How It Works</FillButtonContent>
            </a>
          </div>
          {/* the feature row (hero step 6; user 2026-11-21: three premium features, not price points). Desktop only. */}
          <ul className="hero-trust intro" style={{ '--d': '.95s' } as React.CSSProperties}>
            {/* (a little life in the first two, user 2026-11-21: the flame flickers, a line scans the face frame) */}
            {([[Flame, 'Viral tracking', 'ht-flame'], [ScanFace, 'Auto detection', 'ht-scan']] as const).map(([Icon, t, c]) => (
              <li key={t}>
                <span className={`ht-icon ${c}`} aria-hidden="true"><Icon strokeWidth={1.9} /></span>
                {t}
              </li>
            ))}
            <li><Languages aria-hidden="true" strokeWidth={1.9} /><HeroLangs /></li>
          </ul>
          </div>
        </div>

        {/* recedes with the headline as the next section slides over. Desktop: the real editor turning the
            wide video into a vertical short (HeroEditor); phones keep their animation (HeroSplit) */}
        <div className="hero-visual">
          {/* (in with the headline, not after it — user 2026-11-21: the editor's place sat empty for a second) */}
          <div className="intro hero-visual-desk" style={{ '--d': '.3s' } as React.CSSProperties}>
            <HeroEditor />
          </div>
          <div className="intro hero-visual-phone" style={{ '--d': '.9s' } as React.CSSProperties}>
            <HeroSplit />
          </div>
        </div>

        </div>


      </section>

      {/* ── PROBLEM (after the hero, plainly: its heading and cards fade up as they come in) ── */}
      <div id="problem" ref={sheetRef} className="section-wrap sheet">
        <ProblemSection />
      </div>
      </div>

      {/* ── INTRODUCING SHORTCUT (user's website copy, 2026-11-21): the answer to The Problem ── */}
      <div id="intro" className="section-wrap">
        <IntroSection />
      </div>

      {/* ── HOW IT WORKS (user 2026-11-22: no scroll animation here — the headline and the five cards simply sit on the
          page: no fly-in, no section tilt, no fade-in) ── */}
      <div id="process" className="section-wrap hiw-static">
        <section className="section-inner">
          <div className="section-head">
            <p className="section-eyebrow">How it works</p>
            <h2 className="section-title hiw-title"><span>Five Simple Steps.</span> <span>One Ready-to-Post Short.</span></h2>
          </div>
          {/* (user 2026-11-22: "design the cards and placement in a creative way", same words) the five steps as the
              editor's own timeline: a track of five segments joined by "+", each step hanging under its segment; a
              white playhead plays along the track and lights the step it is passing (a loop, not a scroll animation).
              The last segment, the result, is lime. */}
          <ol className="hiw-track">
            {STEPS.map((step, i) => {
              const Icon = [Upload, MousePointerClick, Move, WandSparkles, Send][i]
              return (
                <li key={step.title} className={`hiw-step${i === STEPS.length - 1 ? ' hiw-step-end' : ''}`} style={{ '--i': i } as React.CSSProperties}>
                  <div className="hiw-seg">
                    <span className="hiw-num">{String(i + 1).padStart(2, '0')}</span>
                    <span className="hiw-ico" aria-hidden="true"><Icon strokeWidth={1.9} /></span>
                    {i < STEPS.length - 1 && <span className="hiw-join" aria-hidden="true">+</span>}
                  </div>
                  <span className="hiw-stem" aria-hidden="true" />
                  <h3 className="hiw-step-title">{step.title}</h3>
                  <p className="hiw-desc">{step.desc}</p>
                </li>
              )
            })}
            <span className="hiw-head" aria-hidden="true" />
          </ol>
          <p className="lx-loop">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 11-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
            Every clip you post makes the next one smarter.
          </p>
        </section>
      </div>

      {/* ── FEATURES: desktop flies through the cards; smaller screens get the carousel ── */}
      {tunnel ? (
        <section id="features" className="section-wrap fs-wrap">
          {/* (user 2026-11-22: a new style and a new scroll animation — the scroll showcase; was the 3D fly-through) */}
          <FeatureShowcase eyebrow="Features" title={<span className="two-line-title"><span>Everything You Need.</span> <span>Without the Editing Hassle.</span></span>} items={FEATURES} onJump={y => scrollToY(y, true)} />
        </section>
      ) : (
      <SectionTransition id="features" variant="zoom" className="section-wrap">
        <section className="section-inner">
          <div className="section-head reveal">
            <p className="section-eyebrow">Features</p>
            <h2 className="section-title two-line-title"><span>Everything You Need.</span> <span>Without the Editing Hassle.</span></h2>
          </div>
          <div data-fit className="reveal">
            <CircularCarousel items={FEATURES} />
          </div>
        </section>
      </SectionTransition>
      )}

      {/* ── WHY SHORTCUT? (user's website copy, 2026-11-21: replaces the "Inside Shortcut" board; keeps the #trends
          anchor the phone menu links to) ── */}
      <Sec id="trends" variant="tilt" className="section-wrap">
        <WhySection />
      </Sec>

      {/* ── SOCIAL PROOF ── */}
      <Sec id="proof" variant="tilt" className="section-wrap">
        {/* Who Is It For? (user's website copy, 2026-11-21: replaces the "Clippers" placeholder quotes) */}
        <WhoSection />
      </Sec>

      {/* ── PRICING ── */}
      <SectionTransition id="pricing" variant="zoom" className="section-wrap">
        <PricingSection
          plans={pricingPlans(currency)}
          currency={currency}
          locale={currency === 'INR' ? 'en-IN' : 'en-US'}
          eyebrow="Pricing"
          title="Simple Plans. More Content. Less Editing."
          description="Choose a plan that matches how much content you create."
        />
      </SectionTransition>

      {/* ── FAQ ── */}
      <div id="faq" className="section-wrap">
        <FaqSection
          eyebrow="FAQ"
          title="Questions"
          description="Everything you need to know about clipping and earning with Shortcut."
          items={FAQS}
        />
      </div>

      {/* ── CTA ── */}
      <section className={`cta-section${lite ? '' : ' cta-full'}`}>
        {/* One language per line, gliding across in alternating directions (decorative) */}
        <div className="lang-marquees" aria-hidden>
          {LANGUAGES.map((l, i) => (
            <div key={l.name} className="lang-lane" style={{ top: `${6 + i * (88 / (LANGUAGES.length - 1))}%` }}>
              <span
                className={`lm-chip lm-${LANE_SIZES[i % LANE_SIZES.length]}${i % 2 ? ' rtl' : ''}${l.name === HIGHLIGHT_LANGUAGE ? ' on' : ''}`}
                style={{
                  '--lm-dur': `${LANE_DURATIONS[i % LANE_DURATIONS.length]}s`,
                  '--lm-delay': `${-((i * 7.3) % LANE_DURATIONS[i % LANE_DURATIONS.length])}s`,
                } as React.CSSProperties}
              >
                <b>{l.native}</b>{l.name !== l.native && <small>{l.name}</small>}
              </span>
            </div>
          ))}
        </div>
        {/* (user's website copy, 2026-11-21: the final CTA, word for word; same design) */}
        {/* (the headline, user 2026-11-23: "a catchy line" on no learning curve — two short beats, one per line) */}
        {/* (one highlight: the payoff line in lime, the first line silver — user 2026-11-23) */}
        <h2 className="reveal cta-h"><span>Zero Learning Curve.</span> <span className="cta-pay">Endless Shorts.</span></h2>
        <p className="cta-lines">
          <span>Stop spending hours editing. Start creating more.</span>
          <span>Upload one video. Create more content. Get back to what you do best.</span>
        </p>
        <div className="reveal">
          {/* (a button made for the longer label, user 2026-11-21): the words, then a round arrow that moves forward on
              hover — the words never swap out */}
          <Link href="/signup" className="btn-nav-primary cta-btn">
            <span className="cta-btn-label">Get Started with Shortcut</span>
            <span className="cta-btn-ico" aria-hidden="true">
              {/* (an up-right arrow: on hover the badge slides to the button's start and turns 45° — user 2026-11-23) */}
              <svg viewBox="0 0 24 24"><path d="M7 17L17 7M8 7h9v9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
          </Link>
          {/* (the reassurance under the button, user 2026-11-22) */}
          <p className="cta-note">Ready in minutes. No editing skills needed.</p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="footer-glow" aria-hidden />
        <div className="footer-top">
          <FooterReveal className="footer-brand">
            <a href="#" className="footer-logo" aria-label="Shortcut home"><BrandLogo size="sm" /></a>
            <p className="footer-tagline">Shortcut: the shortcut to short-form.</p>
            <div className="socials">
              {SOCIALS.map(s => (
                <a
                  key={s.label}
                  href={s.href}
                  className="social"
                  aria-label={s.label}
                  title={s.label}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={s.onClick}
                  style={{ '--brand-bg': s.bg } as React.CSSProperties}
                >
                  <span className="social-face">{s.icon}</span>
                  <span className="social-face social-face-hover" aria-hidden>{s.hoverIcon ?? s.icon}</span>
                </a>
              ))}
            </div>
          </FooterReveal>

          <FooterReveal delay={0.2}>
          <nav className="footer-col" aria-label="Explore">
            <h4 className="footer-heading">Explore</h4>
            <ul className="footer-list">
              {FOOTER_LINKS.map(l => <li key={l.label}><a href={l.href} onClick={e => goToSection(e, l.href)}>{l.label}</a></li>)}
            </ul>
          </nav>
          </FooterReveal>

          <FooterReveal delay={0.3} className="footer-col" id="contact">
            <h4 className="footer-heading">Contact</h4>
            <ul className="footer-list footer-contact">
              <li><Mail aria-hidden /><a href={GMAIL_COMPOSE} target="_blank" rel="noopener noreferrer" onClick={openMailAppOnPhones}>{CONTACT.email}</a></li>
              <li><Phone aria-hidden /><a href={`tel:${CONTACT.phone.replace(/\s/g, '')}`}>{CONTACT.phone}</a></li>
              <li><MapPin aria-hidden /><address>{CONTACT.address.map(line => <span key={line}>{line}</span>)}</address></li>
            </ul>
          </FooterReveal>
        </div>

        {/* the big SHORTCUT, each letter acting out a feature (desktop) */}
        <FooterWordmark />

        <FooterReveal delay={0.4} className="footer-bottom">
          <span className="footer-copy">© 2026 {COMPANY.legalName}. All rights reserved.</span>
          <div className="footer-links">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/refunds">Refunds &amp; Cancellation</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/support">Support</Link>
          </div>
          <Link href="/delete-account" className="footer-delete">Delete account</Link>
        </FooterReveal>
      </footer>
    </div>
  )
}

// Footer columns drift down out of a blur as the footer scrolls into view, one after another
function FooterReveal({ className, id, delay = 0.1, children }: {
  className?: string
  id?: string
  delay?: number
  children: React.ReactNode
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className} id={id}>{children}</div>
  return (
    <motion.div
      className={className}
      id={id}
      initial={{ filter: 'blur(4px)', y: -8, opacity: 0 }}
      whileInView={{ filter: 'blur(0px)', y: 0, opacity: 1 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.8 }}
    >
      {children}
    </motion.div>
  )
}
