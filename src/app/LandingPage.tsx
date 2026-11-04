'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import NumberFlow from '@number-flow/react'
import { Mail, MapPin, Menu, Phone, X } from 'lucide-react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionStyle } from 'framer-motion'
import { PricingSection, type PricingPlan } from '@/components/ui/pricing'
import { DotField } from '@/components/ui/dot-field'
import { ClipForge } from '@/components/landing/clip-forge'
import { ZoomFit } from '@/components/ui/zoom-fit'
import { TiltCard } from '@/components/ui/tilt-card'
import { FillButtonContent } from '@/components/ui/fill-button'
import { EditorMockup } from '@/components/ui/editor-mockup'
import { BrandLogo } from '@/components/ui/brand-logo'
import { CircularCarousel, type CarouselItem } from '@/components/ui/circular-carousel'
import { SectionTransition } from '@/components/ui/section-transition'
import { FaqSection, type FaqItem } from '@/components/ui/faq-section'
import { HeroSplit } from '@/components/landing/hero-split'
import { FeatureTunnel } from '@/components/landing/feature-tunnel'
import { FlyIn } from '@/components/landing/fly-in'
import type Lenis from 'lenis'
import { InsightsSection, ProblemSection, ProofSection } from '@/components/landing/sections'
import { neutralStyle, useLiteMotion } from '@/components/ui/use-lite-motion'
import { PLANS } from '@/lib/plans'
import { COMPANY, MODEL_CREDIT } from '@/lib/company'
import { GMAIL_COMPOSE, openMailAppOnPhones } from '@/components/ui/email-link'

const free = PLANS.free
const pro = PLANS.starter // shown as "Pro" on the landing page
const business = PLANS.agency // shown as "Business"

// Annual pricing is display-only for now: billing only supports monthly.
// Every card lists the same rows (✓/✗) so plans are easy to compare.
// Notes: video limits are totals, not monthly (see checkVideoQuota); AI clip
// suggestions need a transcript, which only plans with auto-captions get.
function planFeatures(plan: (typeof PLANS)[keyof typeof PLANS]) {
  return [
    { text: 'AI finds the best moments', included: plan.autoCaption },
    { text: `Up to ${plan.maxFileSizeGb} GB per video`, included: true },
    { text: `${plan.retentionDays}-day history`, included: true },
    { text: 'Auto-captions in Telugu, Hindi & Hinglish', included: plan.autoCaption },
    { text: 'Your logo on your clips', included: true },
    { text: 'No watermark', included: !plan.watermark },
  ]
}

const videos = (n: number) => `${n} long video${n === 1 ? '' : 's'}`

const PRICING_PLANS: PricingPlan[] = [
  {
    name: 'Free',
    price: free.price,
    yearlyPrice: free.price,
    headline: `Process ${videos(free.maxVideos)}`,
    subline: `Cut up to ${free.maxClips} clips`,
    features: planFeatures(free),
    buttonText: 'Start for free',
    href: '/signup',
  },
  {
    name: 'Pro',
    price: pro.price,
    yearlyPrice: Math.round(pro.price * 0.8),
    headline: `Process ${videos(pro.maxVideos)}`,
    subline: 'Cut as many clips as you want',
    features: planFeatures(pro),
    buttonText: 'Go Pro',
    href: '/signup',
    badge: 'Most popular',
    isPopular: true,
  },
  {
    name: 'Business',
    price: business.price,
    yearlyPrice: Math.round(business.price * 0.8),
    headline: `Process ${videos(business.maxVideos)}`,
    subline: 'Cut as many clips as you want',
    features: planFeatures(business),
    buttonText: 'Go Business',
    href: '/signup',
    badge: 'For agencies',
  },
]

// FAQ between Pricing and the closing section. Plan-by-plan differences live in Pricing, not here.
const FAQS: FaqItem[] = [
  {
    question: 'How fast can I make a clip?',
    // TODO(content): the client's page leaves the minutes as [X]
    answer: 'Most clips are ready to post in [X] minutes from upload, including captions and branding.',
  },
  {
    question: 'What if the AI picks the wrong moment or framing?',
    answer: 'Edit any clip in the timeline, or hit play and steer the frame to fix it in one pass.',
  },
  {
    question: 'Which platforms can I post to?',
    answer: 'YouTube Shorts, Instagram Reels and TikTok. Connect your channels once and post in one tap.',
  },
  {
    question: 'How do trending topics work?',
    answer: 'We show which topics, hooks and clip lengths are getting views in your niche, then highlight matching moments in your uploads.',
  },
  {
    question: 'Can I use any video?',
    answer: 'Use videos you own or have permission to use. Clips from content you don’t have rights to can get your channel struck or demonetized. Paid campaigns, coming soon, give you approved sources to clip.',
  },
  {
    question: 'Is there a free plan?',
    answer: `Yes. Your first ${free.maxClips} clips are free, no credit card needed.`,
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
const STEPS = [
  { title: 'See what’s working', desc: 'Check trending topics in your niche, plus the hooks and clip lengths getting the most views this week.' },
  { title: 'Upload and let AI clip', desc: 'Paste a link or upload a long video. AI cuts ready-to-post shorts with captions, headlines and your brand kit.' },
  { title: 'Fix in one pass, then post', desc: 'Framing off? Hit play and steer the frame live. No keyframes. Then post straight to your channels.' },
  { title: 'Track and earn more', desc: 'See views and earnings for every clip. Shortcut learns what works for you and picks better moments next time.' },
]

// Features: the fly-through on desktop, the circular carousel on smaller screens / reduced motion
const TUNNEL_QUERY = '(min-width: 1100px) and (pointer: fine) and (prefers-reduced-motion: no-preference)'
const tunnelSub = (on: () => void) => { const mq = window.matchMedia(TUNNEL_QUERY); mq.addEventListener('change', on); return () => mq.removeEventListener('change', on) }
const useTunnel = () => useSyncExternalStore(tunnelSub, () => window.matchMedia(TUNNEL_QUERY).matches, () => false)

const featureIcon = (glyph: string, tone: string) => <span className={`feature-icon ${tone}`} aria-hidden>{glyph}</span>

const FEATURES: CarouselItem[] = [
  { id: 'moments', tag: 'AI', icon: featureIcon('✦', 'fi-cyan'), title: 'Your best moments, found for you', description: 'Upload one video and get a batch of ready-to-post clips in minutes, not hours.' },
  { id: 'steer', tag: 'Framing', icon: featureIcon('◎', 'fi-warm'), title: 'Fix any frame in one pass', description: 'Hit play and guide the frame live. No keyframes, no frame-by-frame dragging.' },
  { id: 'captions', tag: 'Captions', icon: featureIcon('≋', 'fi-yellow'), title: 'Captions that keep them watching', description: 'Accurate captions in seconds, styled to stop the scroll even on mute.' },
  { id: 'hooks', tag: 'Hooks', icon: featureIcon('⚡', 'fi-green'), title: 'Win the first second', description: 'Add hooks and titles that grab attention before viewers swipe away.' },
  { id: 'brand', tag: 'Brand', icon: featureIcon('◈', 'fi-purple'), title: 'Every clip looks like yours', description: 'Your fonts, colors and logo applied to every clip automatically.' },
  { id: 'layouts', tag: 'Layouts', icon: featureIcon('▤', 'fi-blue'), title: 'Ready-made layouts', description: 'Video with text on top, split screen, video with photo, and more.' },
  { id: 'export', tag: 'Speed', icon: featureIcon('⬆', 'fi-green'), title: 'No waiting to export', description: 'Clips render while you edit, so they’re ready the moment you finish.' },
  { id: 'post', tag: 'Publish', icon: featureIcon('➚', 'fi-cyan'), title: 'Post everywhere at once', description: 'Send clips straight to YouTube Shorts, Reels and TikTok from one place.' },
]

const CONTACT = COMPANY

const EXPLORE = [
  { label: 'How it works', href: '#process' },
  { label: 'Features', href: '#features' },
  { label: 'Trends', href: '#trends' },
  { label: 'Pricing', href: '#pricing' },
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

// Hand-drawn arrow that swaps in for the label on .arrow-btn hover
function SquiggleArrow() {
  return (
    <svg className="arrow-btn-arrow" viewBox="0 0 38 15" fill="currentColor" aria-hidden>
      <path d="M10 7.519l-.939-.344h0l.939.344zm14.386-1.205l-.981-.192.981.192zm1.276 5.509l.537.843.148-.094.107-.139-.792-.611zm4.819-4.304l-.385-.923h0l.385.923zm7.227.707a1 1 0 0 0 0-1.414L31.343.448a1 1 0 0 0-1.414 0 1 1 0 0 0 0 1.414l5.657 5.657-5.657 5.657a1 1 0 0 0 1.414 1.414l6.364-6.364zM1 7.519l.554.833.029-.019.094-.061.361-.23 1.277-.77c1.054-.609 2.397-1.32 3.629-1.787.617-.234 1.17-.392 1.623-.455.477-.066.707-.008.788.034.025.013.031.021.039.034a.56.56 0 0 1 .058.235c.029.327-.047.906-.39 1.842l1.878.689c.383-1.044.571-1.949.505-2.705-.072-.815-.45-1.493-1.16-1.865-.627-.329-1.358-.332-1.993-.244-.659.092-1.367.305-2.056.566-1.381.523-2.833 1.297-3.921 1.925l-1.341.808-.385.245-.104.068-.028.018c-.011.007-.011.007.543.84zm8.061-.344c-.198.54-.328 1.038-.36 1.484-.032.441.024.94.325 1.364.319.45.786.64 1.21.697.403.054.824-.001 1.21-.09.775-.179 1.694-.566 2.633-1.014l3.023-1.554c2.115-1.122 4.107-2.168 5.476-2.524.329-.086.573-.117.742-.115s.195.038.161.014c-.15-.105.085-.139-.076.685l1.963.384c.192-.98.152-2.083-.74-2.707-.405-.283-.868-.37-1.28-.376s-.849.069-1.274.179c-1.65.43-3.888 1.621-5.909 2.693l-2.948 1.517c-.92.439-1.673.743-2.221.87-.276.064-.429.065-.492.057-.043-.006.066.003.155.127.07.099.024.131.038-.063.014-.187.078-.49.243-.94l-1.878-.689zm14.343-1.053c-.361 1.844-.474 3.185-.413 4.161.059.95.294 1.72.811 2.215.567.544 1.242.546 1.664.459a2.34 2.34 0 0 0 .502-.167l.15-.076.049-.028.018-.011c.013-.008.013-.008-.524-.852l-.536-.844.019-.012c-.038.018-.064.027-.084.032-.037.008.053-.013.125.056.021.02-.151-.135-.198-.895-.046-.734.034-1.887.38-3.652l-1.963-.384zm2.257 5.701l.791.611.024-.031.08-.101.311-.377 1.093-1.213c.922-.954 2.005-1.894 2.904-2.27l-.771-1.846c-1.31.547-2.637 1.758-3.572 2.725l-1.184 1.314-.341.414-.093.117-.025.032c-.01.013-.01.013.781.624zm5.204-3.381c.989-.413 1.791-.42 2.697-.307.871.108 2.083.385 3.437.385v-2c-1.197 0-2.041-.226-3.19-.369-1.114-.139-2.297-.146-3.715.447l.771 1.846z" />
    </svg>
  )
}

export function LandingPage() {
  // One progress value drives the whole hero → features transition:
  // 0 when the features sheet enters the bottom of the screen, 1 when it reaches the top.
  const sheetRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress: raw } = useScroll({ target: sheetRef, offset: ['start end', 'start start'] })
  const p = useSpring(raw, { stiffness: 120, damping: 24, mass: 0.3 })
  // Once the sheet fully covers the hero, the hero stops drawing (hidden; its animation pauses) —
  // it stays pinned behind the Problem section for a while, and nobody can see it
  const [heroCovered, setHeroCovered] = useState(false)
  useEffect(() => raw.on('change', v => setHeroCovered(v >= 0.999)), [raw])
  const reduceMotion = useReducedMotion()
  // Phones/touch screens scroll plainly: per-frame blur/scale effects stutter there
  const lite = useLiteMotion()
  const fx = (style: MotionStyle) => (reduceMotion || lite ? neutralStyle(style) : style)

  // Hero breaks apart: lines drift in opposite directions, text blurs and recedes
  const line1X = useTransform(p, [0, 1], ['0%', '-22%'])
  const line2X = useTransform(p, [0, 1], ['0%', '22%'])
  const textOpacity = useTransform(p, [0, 0.75], [1, 0])
  const textScale = useTransform(p, [0, 1], [1, 0.9])
  const textBlur = useTransform(p, [0, 0.75], ['blur(0px)', 'blur(12px)'])
  const detailsOpacity = useTransform(p, [0, 0.35], [1, 0])
  const detailsY = useTransform(p, [0, 0.35], [0, -40])
  // Background dot field fades out as the hero recedes
  const fieldOpacity = useTransform(p, [0, 0.8], [1, 0])
  // Features rises as a card and flattens to full width
  const sheetScale = useTransform(p, [0, 1], [0.9, 1])
  const sheetRadius = useTransform(p, [0, 1], [48, 0])

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

  // "Your first N clips are free": N counts up from 0 once the line has faded in, like earnings
  // adding up (N is the Free plan's clip limit, so it always matches Pricing)
  const [freeClips, setFreeClips] = useState(0)
  useEffect(() => {
    if (reduceMotion) { setFreeClips(free.maxClips); return }
    const t = setTimeout(() => setFreeClips(free.maxClips), 1300)
    return () => clearTimeout(t)
  }, [reduceMotion])

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
  useEffect(() => {
    let raf = 0
    const check = () => {
      raf = 0
      const sheet = sheetRef.current
      if (sheet) setPastHero(sheet.getBoundingClientRect().top <= NAV_H)
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
    document.querySelectorAll('.lp-root .reveal').forEach((el, i) => {
      ;(el as HTMLElement).style.transitionDelay = (i % 3) * 0.07 + 's'
      observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  return (
    <div className="lp-root">

      {/* ── NAV ── */}
      <nav className={`lp-nav${pastHero ? ' nav-past-hero' : ''}`}>
        <a href="#" className="logo" aria-label="Shortcut home"><BrandLogo shine /></a>
        <ul className="nav-links">
          <li>
            <a href="#" onClick={goHome}>Home</a>
          </li>
          {EXPLORE.map(l => (
            <li key={l.href}><a href={l.href} onClick={e => goToSection(e, l.href)}>{l.label}</a></li>
          ))}
        </ul>
        <div className="nav-right">
          <Link href="/login" className="btn-nav-ghost fill-btn fill-btn-sm"><FillButtonContent>Log in</FillButtonContent></Link>
          <Link href="/signup" className="btn-nav-primary arrow-btn">
            <span className="arrow-btn-label">Get started</span>
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
      <section className="hero" ref={heroRef} data-covered={heroCovered || undefined}>
        {/* Soft light shade, same as the closing CTA section */}
        <div className="hero-shade" aria-hidden />
        {/* Interactive dot field: lights up around the cursor, ripples on click */}
        <motion.div className="hero-field" aria-hidden style={fx({ opacity: fieldOpacity })}>
          {!lite && <DotField hostRef={heroRef} />}
        </motion.div>

        {/* Desktop: text and buttons on the left, the lens animation on the right.
            Below 1100px the two stack, centred. */}
        <div className="hero-grid">
        <motion.div className="hero-text" style={fx({ opacity: textOpacity, scale: textScale, filter: textBlur })}>
          <h1 className="hero-headline">
            <motion.span className="line" style={fx({ x: line1X })}><span className="line-inner">Turn every video</span></motion.span>
            <motion.span className="line" style={fx({ x: line2X })}><span className="line-inner">into <span className="warm">income.</span></span></motion.span>
          </h1>
          <motion.div style={fx({ opacity: detailsOpacity, y: detailsY })}>
          <p className="hero-sub intro" style={{ '--d': '.55s' } as React.CSSProperties}>
            AI finds the best moments, cuts them into <span className="whitespace-nowrap">ready-to-post</span> shorts, and shows you what&rsquo;s trending.
          </p>
          <div className="hero-ctas intro" style={{ '--d': '.7s' } as React.CSSProperties}>
            <Link href="/signup" className="btn-nav-primary arrow-btn hero-cta-main">
              <span className="arrow-btn-label">Start clipping free</span>
              <SquiggleArrow />
            </Link>
            <a href="#process" onClick={e => goToSection(e, '#process')} className="btn-nav-ghost fill-btn hero-cta-ghost">
              <FillButtonContent>See how it works</FillButtonContent>
            </a>
          </div>
          {/* Earnings line: a growth chart draws itself, and the free-clip number (lime, no badge)
              flips in while it counts up, then flips again now and then (styles: .hero-earn in landing.css) */}
          <div className="hero-earn intro" style={{ '--d': '.85s' } as React.CSSProperties}>
            <svg className="earn-chart" width="26" height="20" viewBox="0 0 26 20" fill="none" aria-hidden="true">
              <path className="earn-line" d="M2 16l6-6 4.5 4L22 4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              <path className="earn-head" d="M16 4h6v6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="earn-text">
              No credit card needed. Your first{' '}
              <span className="earn-num">
                <span className="earn-coin">
                  <NumberFlow value={freeClips} className="tabular-nums" />
                </span>
              </span>{' '}
              clips are free.
            </p>
          </div>
          </motion.div>
        </motion.div>

        {/* recedes with the headline as the next section slides over */}
        <motion.div className="hero-visual" style={fx({ opacity: textOpacity, scale: textScale })}>
          <div className="intro" style={{ '--d': '.9s' } as React.CSSProperties}>
            <HeroSplit />
          </div>
        </motion.div>
        </div>

      </section>

      {/* ── PROBLEM (slides up over the pinned hero) ── */}
      <motion.div
        id="problem"
        ref={sheetRef}
        className="section-wrap sheet"
        style={fx({ scale: sheetScale, borderTopLeftRadius: sheetRadius, borderTopRightRadius: sheetRadius })}
      >
        <ProblemSection flip={tunnel} />
      </motion.div>
      </div>

      {/* ── HOW IT WORKS ── */}
      <Sec id="process" variant="tilt" className="section-wrap">
        <FlyIn on={tunnel} pieces=".pw-stage, .fly-step, .lx-loop" pin={1.1} from="above">
        <section className="section-inner">
          <div className="section-head reveal">
            <p className="section-eyebrow">How it works</p>
            <h2 className="section-title">From long video to earning clips in four steps.</h2>
          </div>
          {/* The process in motion: on the left, the clip forge (long video in, clips out) and the
              editing board (steer the frame live); the right column is kept for cards */}
          <div className="pw">
            <div className="pw-left">
              <figure className="pw-stage reveal">
                <figcaption className="pw-label"><span>01</span>AI finds your best moments and cuts the clips</figcaption>
                <ClipForge clips={10} />
              </figure>
              <figure className="pw-stage reveal">
                <figcaption className="pw-label"><span>02</span>Steer any frame right while it plays</figcaption>
                <ZoomFit width={880} className="editor-showcase pw-editor">
                  <span className="lx-live" aria-hidden="true"><span className="lx-dot" />Steering live</span>
                  <EditorMockup />
                </ZoomFit>
              </figure>
            </div>
            <div className="pw-right">
              {/* TODO: cards go here */}
            </div>
          </div>
          <div className="process-grid">
            {STEPS.map((step, i) => (
              // fly-step: what flies in on desktop (FlyIn), so the card keeps its own tilt and fade
              <div key={step.title} className="fly-step">
              <TiltCard className="process-step" index={i}>
                <div className="tilt-card-inner">
                  <div className="step-num"><div className="step-num-circle">{i + 1}</div> Step {i + 1}</div>
                  <h3 className="step-title">{step.title}</h3>
                  <p className="step-desc">{step.desc}</p>
                </div>
              </TiltCard>
              </div>
            ))}
          </div>
          <p className="lx-loop reveal">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 11-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
            Every clip you post makes the next one smarter.
          </p>
        </section>
        </FlyIn>
      </Sec>

      {/* ── FEATURES: desktop flies through the cards; smaller screens get the carousel ── */}
      {tunnel ? (
        <section id="features" className="section-wrap ft-wrap">
          <FeatureTunnel eyebrow="Features" title="Everything you need to post more and earn more." items={FEATURES} />
        </section>
      ) : (
      <SectionTransition id="features" variant="zoom" className="section-wrap">
        <section className="section-inner">
          <div className="section-head reveal">
            <p className="section-eyebrow">Features</p>
            <h2 className="section-title">Everything you need to post more and earn more.</h2>
          </div>
          <div data-fit className="reveal">
            <CircularCarousel items={FEATURES} />
          </div>
        </section>
      </SectionTransition>
      )}

      {/* ── INSIDE SHORTCUT: trends, earnings and output on one board (keeps the #trends anchor for the nav) ── */}
      <Sec id="trends" variant="tilt" className="section-wrap">
        <FlyIn on={tunnel} pieces=".bx-hint, .bx-inner"><InsightsSection /></FlyIn>
      </Sec>

      {/* ── SOCIAL PROOF ── */}
      <Sec id="proof" variant="tilt" className="section-wrap">
        <FlyIn on={tunnel} pieces=".lx-quote, .lx-trend-rows"><ProofSection /></FlyIn>
      </Sec>

      {/* ── PRICING ── */}
      <SectionTransition id="pricing" variant="zoom" className="section-wrap">
        <PricingSection
          plans={PRICING_PLANS}
          eyebrow="Pricing"
          title="Simple pricing. Serious reels."
          description={'Start free. Go Pro when your content takes off.'}
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
      <section className="cta-section">
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
        <h2 className="reveal">Your next video could be your <span className="accent">best week</span> yet.</h2>
        <p className="reveal">Upload one video. Leave with a week of clips.</p>
        <div className="reveal">
          <Link href="/signup" className="btn-nav-primary arrow-btn hero-cta-main">
            <span className="arrow-btn-label">Start clipping free</span>
            <SquiggleArrow />
          </Link>
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

        <FooterReveal delay={0.4} className="footer-bottom">
          <span className="footer-copy">© 2026 {COMPANY.legalName}. All rights reserved.</span>
          <div className="footer-links">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/support">Support</Link>
          </div>
          <Link href="/delete-account" className="footer-delete">Delete account</Link>
          {/* Required by the speech model's licence (lib/company.ts MODEL_CREDIT) */}
          <span className="footer-copy footer-credit">{MODEL_CREDIT}</span>
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
