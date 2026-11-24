'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { VelocityMarquee } from '@/components/ui/velocity-marquee'
import { BrandLogo } from '@/components/ui/brand-logo'
import { GraduationCap, Megaphone, Mic, MonitorPlay, MousePointerClick, Move, Scissors, Sparkles, Upload, User } from 'lucide-react'
import { LayoutGroup, motion } from 'framer-motion'

/**
 * Landing-page sections for the "Turn every video into income" story (styles: .lx-* in
 * app/landing.css). Copy follows the client's page; bracketed placeholders from it are kept in
 * the constants below so they're easy to fill in.
 */

// ── Problem ─────────────────────────────────────────────────────────────────────
// (user's website copy, 2026-11-20: the headline, three lines and a closing question.) Laid out as a story
// (user: "make the user know what that section is"): the words on the left; on the right "the grind" — the
// chores the copy names, each with its time, ticking in and adding up to an afternoon (an example, labelled so);
// then the closing question as the turn to what comes next.
const GRIND: { task: string; min: number }[] = [
  { task: 'Cropping', min: 45 },
  { task: 'Resizing', min: 25 },
  { task: 'Adjusting frames', min: 60 },
  { task: 'Adding captions', min: 55 },
  { task: 'Exporting', min: 35 },
]
const GRIND_TOTAL = GRIND.reduce((n, g) => n + g.min, 0)
const GRIND_MAX = Math.max(...GRIND.map(g => g.min))
// The time each should take (the dashed line on every bar): each one runs past it, the overtime in red
const GRIND_LIMIT = 12
// The whole job as planned (each chore's limit, added up): the total runs well past it
const GRIND_PLANNED = GRIND_LIMIT * GRIND.length
const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min}m`)

/**
 * Takes entrances back to their start instantly (no reverse animation): while off screen, `.lx-reset` switches every
 * transition and animation off for one frame, the pieces lose `.in`, and the next entrance plays from the very start —
 * even when the visitor comes back before a slow reverse would have finished (user 2026-11-21: "the animation works
 * only the first time").
 */
function resetInstant(root: HTMLElement, els: HTMLElement[]) {
  root.classList.add('lx-reset')
  els.forEach(e => e.classList.remove('in'))
  void root.offsetWidth
  root.classList.remove('lx-reset')
}

/**
 * Scroll entrances that play every time (user 2026-11-21: "like the first visit, each time I come back"): an element
 * gets .in as it comes into view and loses it once it is fully off screen, so it is ready to run in again.
 * Reduced motion: everything shown, still.
 */
function useReplayReveal(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-anim]'))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { els.forEach(e => e.classList.add('in')); return }
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting && e.intersectionRatio >= 0.2) e.target.classList.add('in')
      else if (!e.isIntersecting && e.target.classList.contains('in')) resetInstant(e.target as HTMLElement, [e.target as HTMLElement])
    }), { threshold: [0, 0.2], rootMargin: '0px 0px -6% 0px' })
    els.forEach(e => io.observe(e))
    return () => io.disconnect()
  }, [ref])
}

/**
 * Scroll entrances that follow the scroll's direction (user 2026-11-22: "the same reverse as the Problem section"):
 * scrolling down, each piece plays in as it comes on screen; arriving from below, it is simply there already; and
 * scrolling back up past it, it closes (data-closing — a quick fade down, its list closing last item first) as it
 * slides towards the foot of the screen — so a section folds away bottom-up — and plays in again if the visitor turns
 * round. Fully off screen, everything resets at once (resetInstant). Reduced motion: shown, still.
 */
function useDirectionalReveal(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-anim]'))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { els.forEach(e => e.classList.add('in')); return }
    const playIn = (e: HTMLElement) => { delete e.dataset.closing; e.classList.add('in') }
    const showNow = (e: HTMLElement) => { e.classList.add('lx-reset'); delete e.dataset.closing; e.classList.add('in'); void e.offsetWidth; e.classList.remove('lx-reset') }
    const io = new IntersectionObserver(entries => entries.forEach(en => {
      const e = en.target as HTMLElement
      if (en.isIntersecting && en.intersectionRatio >= 0.2 && !e.classList.contains('in')) {
        // (coming into view from the top of the screen = the visitor is scrolling up: already there)
        if (en.boundingClientRect.top < 0) showNow(e); else playIn(e)
      } else if (!en.isIntersecting && (e.classList.contains('in') || e.dataset.closing != null)) {
        delete e.dataset.closing; resetInstant(e, [e])
      }
    }), { threshold: [0, 0.2], rootMargin: '0px 0px -6% 0px' })
    els.forEach(e => io.observe(e))
    let lastY = window.scrollY, raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const y = window.scrollY, up = y < lastY, line = window.innerHeight * 0.8
        lastY = y
        for (const e of els) {
          const top = e.getBoundingClientRect().top
          if (up && e.classList.contains('in') && e.dataset.closing == null && top > line) e.dataset.closing = ''
          else if (!up && e.dataset.closing != null && top < line) {
            // (turned round: it plays in again from the start)
            resetInstant(e, [e]); delete e.dataset.closing
            requestAnimationFrame(() => e.classList.add('in'))
          }
        }
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { io.disconnect(); window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [ref])
}

/** The chores, ticking in one by one, and the clock adding them up (once, when it comes into view) */
function GrindCard() {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)
  const [total, setTotal] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setOn(true); setTotal(GRIND_TOTAL); return }
    let raf = 0, wait: ReturnType<typeof setTimeout> | null = null
    let shown = false
    const io = new IntersectionObserver(([e]) => {
      // (fully off screen: back to the start, ready to run again on the next visit)
      if (!e.isIntersecting) {
        if (shown) {
          shown = false; cancelAnimationFrame(raf); if (wait) clearTimeout(wait)
          // (back to the start at once, not by a slow reverse — see resetInstant)
          el.classList.add('lx-reset'); setOn(false); setTotal(0)
          setTimeout(() => el.classList.remove('lx-reset'), 80)
        }
        return
      }
      if (shown || e.intersectionRatio < 0.35) return
      shown = true
      setOn(true)
      // the clock starts as the rows land, and finishes with the last one
      wait = setTimeout(() => {
        const start = performance.now(), ms = 2800
        const tick = (now: number) => {
          const k = Math.min(1, (now - start) / ms)
          setTotal(Math.round(GRIND_TOTAL * (1 - Math.pow(1 - k, 2))))
          if (k < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      }, 350)
    }, { threshold: [0, 0.35] })
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(raf); if (wait) clearTimeout(wait) }
  }, [])
  return (
    <div ref={ref} className="lx-grind" data-on={on || undefined} role="img"
      aria-label={`Example: turning one video into five clips by hand — ${GRIND.map(g => `${g.task} ${hm(g.min)}`).join(', ')}; about ${hm(GRIND_TOTAL)} in total`}>
      <div className="lx-grind-head" aria-hidden="true">
        <span className="lx-grind-rec" />
        <span>Turning 1 video into 5 clips</span>
        <em>by hand</em>
      </div>
      {/* what the bars mean (user 2026-11-21: the card should read at a glance) */}
      <div className="lx-grind-legend" aria-hidden="true">
        <span><i className="lx-grind-sw-plan" />Planned</span>
        <span><i className="lx-grind-sw-over" />Overtime</span>
      </div>
      <ul className="lx-grind-rows" aria-hidden="true">
        {GRIND.map((g, i) => (
          <li key={g.task} style={{
            '--i': i, '--w': `${(g.min / GRIND_MAX) * 100}%`,
            '--lim': `${(GRIND_LIMIT / GRIND_MAX) * 100}%`, '--lim-in': `${(GRIND_LIMIT / g.min) * 100}%`,
          } as React.CSSProperties}>
            <span className="lx-grind-task">{g.task}</span>
            <span className="lx-grind-bar"><i /></span>
            <span className="lx-grind-time">{hm(g.min)}</span>
          </li>
        ))}
      </ul>
      {/* the total, as overtime (user, 2026-11-20): the clock counts up white; past the planned time it turns
          red, its bar runs past the planned line, and the overtime pops in and counts with it */}
      <div className="lx-grind-total" data-over={total > GRIND_PLANNED || undefined} aria-hidden="true">
        <div className="lx-grind-total-row">
          <span>Actually took</span>
          <b>{hm(total)}</b>
        </div>
        <div className="lx-grind-total-bar" style={{ '--plan': `${(GRIND_PLANNED / GRIND_TOTAL) * 100}%`, '--fill': `${(total / GRIND_TOTAL) * 100}%` } as React.CSSProperties}>
          <i />
          <span className="lx-grind-plan-mark" />
        </div>
        <div className="lx-grind-total-foot">
          <span className="lx-grind-plan">Planned: {hm(GRIND_PLANNED)}</span>
          <span className="lx-grind-over" key={total > GRIND_PLANNED ? 'over' : 'not'}>+{hm(Math.max(0, total - GRIND_PLANNED))} over</span>
        </div>
      </div>
    </div>
  )
}

/**
 * The Problem's timeline (user 2026-11-21: "the points are not coming properly … the last text should appear only
 * after the problem section has appeared"). One trigger for the whole first screen — once a third of it is in view,
 * every piece in it starts together and runs on its own delay (label, headline, card, then 01 → 02 → 03), so nothing
 * waits on its own scroll position. The closing question is held back until that sequence has finished (or the screen
 * was scrolled past), and only then writes in once it is on screen. Leaving fully resets both, to replay next time.
 */
const PB_SEQUENCE_MS = 3400
function useProblemTimeline(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current
    const main = root?.querySelector<HTMLElement>('.lx-pb-main')
    const turn = root?.querySelector<HTMLElement>('.lx-pb-turn')
    if (!root || !main || !turn) return
    const mainEls = Array.from(main.querySelectorAll<HTMLElement>('[data-anim]'))
    const turnEls = Array.from(turn.querySelectorAll<HTMLElement>('[data-anim]'))
    const show = (els: HTMLElement[], on: boolean) => els.forEach(e => e.classList.toggle('in', on))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { show(mainEls, true); show(turnEls, true); return }

    let mainIn = false, mainDone = false, turnSeen = false, closed = false, timer: ReturnType<typeof setTimeout> | null = null
    const maybeShowTurn = () => {
      // (the problem screen has played, or it is already above the screen: the question may come)
      const passed = main.getBoundingClientRect().bottom < 0
      if (turnSeen && (mainDone || passed)) show(turnEls, true)
    }
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.target === main) {
        if (e.isIntersecting && e.intersectionRatio >= 0.15 && !mainIn) {
          mainIn = true
          // (user 2026-11-22) from above, everything plays in, the steps opening 01 → 02 → 03; from below, it is simply
          // there already, all three steps open — they close 03 → 02 → 01 as the visitor carries on up past them
          if (e.boundingClientRect.top < 0) {
            root.classList.add('lx-reset'); show(mainEls, true); void root.offsetWidth; root.classList.remove('lx-reset')
            mainDone = true; maybeShowTurn()
          } else {
            show(mainEls, true)
            timer = setTimeout(() => { mainDone = true; maybeShowTurn() }, PB_SEQUENCE_MS)
          }
        } else if (!e.isIntersecting && mainIn) {
          mainIn = false; mainDone = false; closed = false
          if (timer) clearTimeout(timer)
          delete main.dataset.closing
          resetInstant(main, mainEls)
          maybeShowTurn()
        }
      } else {
        if (e.isIntersecting && e.intersectionRatio >= 0.6) { turnSeen = true; maybeShowTurn() }
        else if (!e.isIntersecting) { turnSeen = false; resetInstant(turn, turnEls) }
      }
    }), { threshold: [0, 0.15, 0.3, 0.6] })
    io.observe(main); io.observe(turn)

    // the steps close 03 → 02 → 01 when the visitor scrolls back up past them (their list sliding down towards the
    // foot of the screen), and open again 01 → 02 → 03 if they turn round and scroll down
    const steps = main.querySelector<HTMLElement>('.lx-pb-steps')
    const stepEls = steps ? Array.from(steps.querySelectorAll<HTMLElement>('li[data-anim]')) : []
    let lastY = window.scrollY, raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const y = window.scrollY, up = y < lastY
        lastY = y
        if (!mainIn || !steps) return
        const top = steps.getBoundingClientRect().top, vh = window.innerHeight
        if (up && !closed && top > vh * 0.62) {
          closed = true; main.dataset.closing = ''
          stepEls.forEach(li => li.classList.remove('in'))
        } else if (!up && closed && top < vh * 0.62) {
          closed = false; delete main.dataset.closing
          stepEls.forEach(li => li.classList.add('in'))
        }
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { io.disconnect(); if (timer) clearTimeout(timer); window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [ref])
}

/** The chores named in the copy, marked in the line (not links, just emphasis) */
const CHORE_WORDS = /(cropping|resizing|adjusting frames|adding captions|exporting)/g
const PROBLEM_LONG = 'But turning that one video into multiple short clips means hours of cropping, resizing, adjusting frames, adding captions and exporting.'
const PROBLEM_CLOSE = 'What if editing wasn’t the thing slowing you down?'

/**
 * The Problem (user, 2026-11-20: "full freedom — a premium section a new visitor understands at once"). Read
 * top to bottom like a short story: the headline; then the three lines as a numbered path (01 recording →
 * 02 the grind → 03 the point) beside "the grind" card; then the closing question on one line.
 * Scroll entrances, once each, every piece from its own side (styles .lx-pb-* in app/landing.css): the label
 * drops in, the headline lines rise from behind a mask, the steps slide in from the left, the card glides in
 * from the right (then its rows tick in), the question writes in word by word. Reduced motion: all shown.
 */
export function ProblemSection() {
  const ref = useRef<HTMLElement>(null)
  useProblemTimeline(ref)
  const d = (s: number) => ({ '--d': `${s}s` } as React.CSSProperties)
  return (
    <section ref={ref} className="section-inner lx-pb">
      {/* (the problem alone fills the first screen; the question comes after it, user 2026-11-21) */}
      <div className="lx-pb-main">
      <header className="lx-pb-head">
        <p className="lx-pb-eyebrow" data-anim="down"><i aria-hidden="true" />The problem</p>
        <h2 className="lx-pb-title">
          {/* (the mask is what's watched: the line itself starts hidden below it) */}
          <span className="lx-pb-mask" data-anim="rise" style={d(0.08)}><span>Creating Content Is Easy.</span></span>
          <span className="lx-pb-mask" data-anim="rise" style={d(0.2)}><span className="lx-pb-title-2">Editing It Takes <em>Forever.</em></span></span>
        </h2>
      </header>

      <div className="lx-pb-body">
        <ol className="lx-pb-steps">
          <li data-anim="step" style={{ '--df': '0.3s', '--dc': '0.6s' } as React.CSSProperties}>
            <span className="lx-pb-num" aria-hidden="true">01</span>
            <p>You spend hours recording a podcast, interview or video.</p>
          </li>
          <li data-anim="step" style={{ '--df': '1.3s', '--dc': '0.3s' } as React.CSSProperties}>
            <span className="lx-pb-num" aria-hidden="true">02</span>
            <p>{PROBLEM_LONG.split(CHORE_WORDS).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</p>
          </li>
          <li data-anim="step" className="lx-pb-point" style={{ '--df': '2.3s', '--dc': '0s' } as React.CSSProperties}>
            <span className="lx-pb-num" aria-hidden="true">03</span>
            <p>You have the content. You just don’t have the time to edit it all.</p>
          </li>
        </ol>
        <div className="lx-pb-card" data-anim="right" style={d(0.1)}><GrindCard /></div>
      </div>
      </div>

      <div className="lx-pb-turn">
        <p className="lx-pb-close" aria-label={PROBLEM_CLOSE}>
          {PROBLEM_CLOSE.split(' ').map((w, i) => (
            <span key={i} aria-hidden="true" data-anim="word" className={w === 'wasn’t' ? 'lx-pb-key' : undefined} style={d(0.15 + i * 0.07)}>{w}</span>
          ))}
        </p>
      </div>
    </section>
  )
}

// ── Trends ──────────────────────────────────────────────────────────────────────
const TREND_TOPICS = [
  { name: 'Side hustles', w: 92 }, { name: 'Gold prices', w: 78 }, { name: 'Credit card tips', w: 64 }, { name: 'First salary', w: 55 },
]
const TREND_ROW = ['Side hustles', 'Gold prices', 'Credit card tips', 'First salary', 'AI tools', 'Cricket highlights', 'Podcast hot takes', 'Study hacks']
const HOOK_ROW = ['“Wait for it…”', '25–40 sec clips', 'Karaoke captions', '“Nobody talks about this”', 'Split screen', '“Here’s the truth”', 'Hot take openers']
const Star = () => (
  <svg className="vm-spin vm-star" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 0l4 14 14-4-10 10 10 10-14-4-4 14-4-14-14 4 10-10L2 10l14 4z" /></svg>
)

function TrendsCard() {
  return (
    <div className="lx-card reveal" aria-label="Example: trends in Finance this week">
      <div className="lx-card-head">
        <span className="lx-card-title">Trending in Finance this week</span>
        <span className="lx-chip">Updated daily</span>
      </div>
      <ul className="lx-topics">
        {TREND_TOPICS.map((t, i) => (
          <li key={t.name}>
            <span className="lx-topic-rank">{i + 1}</span>
            <span className="lx-topic-name">{t.name}</span>
            <span className="lx-topic-bar"><span style={{ width: `${t.w}%`, animationDelay: `${0.15 * i}s` }} /></span>
          </li>
        ))}
      </ul>
      <div className="lx-metrics">
        <div><span>Views vs. average</span><b className="lx-up">3x</b></div>
        <div><span>Best clip length</span><b>25–40 sec</b></div>
        <div><span>Top hook style</span><b>A question</b></div>
      </div>
      <div className="lx-match"><span className="lx-dot" aria-hidden="true" /><b>3 moments</b> in your latest upload match</div>
    </div>
  )
}

/** What's trending right now, as two rows that react to scrolling: topics one way, the hooks and
    formats winning views the other. Drag or flick them. */
function TrendRows() {
  return (
    <div className="lx-trend-rows reveal">
      <VelocityMarquee label={`Trending topics: ${TREND_ROW.join(', ')}`} className="vm-solid" speed={55}>
        {TREND_ROW.map(t => <span key={t} className="vm-item">{t}<Star /></span>)}
      </VelocityMarquee>
      <VelocityMarquee label={`Hooks and formats getting views: ${HOOK_ROW.join(', ')}`} className="vm-outline" direction={-1} speed={45}>
        {HOOK_ROW.map(t => <span key={t} className="vm-item">{t}<Star /></span>)}
      </VelocityMarquee>
    </div>
  )
}

// ── Earnings dashboard ──────────────────────────────────────────────────────────
// TODO(content): the client's page leaves these numbers as [X]; this card is an illustration
const DASH_STATS = [{ label: 'Views', value: '[X]' }, { label: 'Clips posted', value: '[X]' }, { label: 'Earnings', value: '₹[X]' }]
const DASH_CHANNELS = ['All channels', 'Instagram Reels', 'YouTube Shorts']
// Little trend lines under each stat (shape only, no numbers)
const SPARKS = ['M0 13 L10 11 L20 12 L30 8 L40 9 L50 5 L60 3', 'M0 12 L10 12 L20 9 L30 10 L40 6 L50 6 L60 4', 'M0 14 L10 12 L20 13 L30 9 L40 7 L50 4 L60 1']
const TOP_CLIPS = [{ name: 'Side hustle myths', w: 88 }, { name: 'First salary rule', w: 70 }, { name: 'Gold or index fund?', w: 52 }]
function EarningsCard() {
  return (
    <div className="lx-card lx-dash reveal" aria-label="Example earnings dashboard">
      <div className="lx-card-head">
        <span className="lx-card-title"><span className="lx-livedot" aria-hidden="true" />Last 30 days</span>
        {/* The channel filter flips through each platform */}
        <span className="lx-chip lx-chip-cycle" aria-label="All channels">
          {DASH_CHANNELS.map(c => <span key={c}>{c}</span>)}
        </span>
      </div>
      <div className="lx-stats">
        {DASH_STATS.map((s, i) => (
          <div key={s.label} className="lx-stat" data-earn={s.label === 'Earnings' || undefined} style={{ '--i': i } as React.CSSProperties}>
            <span>{s.label}</span>
            <CountUp value={s.value} />
            <svg className="lx-spark" viewBox="0 0 60 16" preserveAspectRatio="none" aria-hidden="true"><path d={SPARKS[i]} vectorEffect="non-scaling-stroke" /></svg>
          </div>
        ))}
      </div>
      {/* A rising line that draws itself, and a pulse on today’s point */}
      <div className="lx-graph-wrap" aria-hidden="true">
        <svg className="lx-graph" viewBox="0 0 300 80" preserveAspectRatio="none">
          <defs>
            <linearGradient id="lx-graph-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#c8ff00" stopOpacity=".13" /><stop offset="1" stopColor="#c8ff00" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className="lx-graph-grid" d="M0 20H300M0 40H300M0 60H300" vectorEffect="non-scaling-stroke" />
          <path className="lx-graph-area" d="M0 70 L40 62 L80 66 L120 48 L160 52 L200 34 L240 30 L300 10 L300 80 L0 80 Z" fill="url(#lx-graph-fill)" />
          <path className="lx-graph-line" d="M0 70 L40 62 L80 66 L120 48 L160 52 L200 34 L240 30 L300 10" fill="none" stroke="#c8ff00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="lx-graph-dot" />
        <span className="lx-graph-tip">Today</span>
      </div>
      <p className="lx-mini-title">Top clips</p>
      <ul className="lx-topics">
        {TOP_CLIPS.map((c, i) => (
          <li key={c.name}>
            <span className="lx-topic-rank" data-top={i === 0 || undefined}>{i + 1}</span>
            <span className="lx-topic-name">{c.name}</span>
            <span className="lx-topic-bar"><span style={{ width: `${c.w}%`, animationDelay: `${0.4 + 0.15 * i}s` }} /></span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Inside Shortcut: one board with every card (trends, earnings, output) ───────
type BoardId = 'trends' | 'earnings' | 'clips' | 'hours' | 'views'
type BoardCell = { id: BoardId; label: string; meta: string; title?: string; desc?: string; size: 'wide' | 'side' | 'stat' }
const BOARD: BoardCell[] = [
  { id: 'trends', label: 'Trends', meta: 'Updated daily', size: 'wide', title: 'Know what’s hot before you clip', desc: 'Topics, hooks and clip lengths getting the most views in your niche right now. AI flags the moments in your uploads that match.' },
  { id: 'earnings', label: 'Analytics', meta: 'Every channel', size: 'side', title: 'See exactly what’s earning', desc: 'Views, watch time and earnings for every clip across Instagram Reels and YouTube Shorts. Shortcut learns from your best performers.' },
  { id: 'clips', label: 'Output', meta: 'Per upload', size: 'stat' },
  { id: 'hours', label: 'Speed', meta: 'Per video', size: 'stat' },
  { id: 'views', label: 'Formats', meta: 'Ready to post', size: 'stat' },
]
const GRIP = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
    <circle cx="3.5" cy="2.5" r="1.1" /><circle cx="8.5" cy="2.5" r="1.1" /><circle cx="3.5" cy="6" r="1.1" /><circle cx="8.5" cy="6" r="1.1" /><circle cx="3.5" cy="9.5" r="1.1" /><circle cx="8.5" cy="9.5" r="1.1" />
  </svg>
)

function BoardBody({ id }: { id: BoardId }) {
  if (id === 'trends') return <TrendsCard />
  if (id === 'earnings') return <EarningsCard />
  const s = PROOF_STATS.find(p => p.kind === id)!
  return (
    <div className="bx-num">
      <StatArt kind={s.kind} />
      <CountUp value={s.value} />
      <span>{s.label}</span>
    </div>
  )
}

export function InsightsSection() {
  const [order, setOrder] = useState<BoardId[]>(BOARD.map(c => c.id))
  const [dragging, setDragging] = useState<BoardId | null>(null)
  const [over, setOver] = useState<BoardId | null>(null)
  const drop = (target: BoardId) => {
    if (dragging && dragging !== target) {
      setOrder(o => { const n = [...o]; const a = n.indexOf(dragging), b = n.indexOf(target); [n[a], n[b]] = [n[b], n[a]]; return n })
    }
    setDragging(null); setOver(null)
  }
  return (
    <section className="section-inner">
      <div className="section-head reveal">
        <p className="section-eyebrow">Inside Shortcut</p>
        <h2 className="section-title">Everything you need to clip smarter, on one board.</h2>
        <p className="section-sub">What’s trending, what’s earning and how fast you get there, side by side.</p>
      </div>
      {/* data-fit: the page scales this down so the whole board fits one screen under the nav */}
      <div data-fit className="bx-fit">
      <p className="bx-hint reveal">{GRIP}Drag and rearrange the cards to build your own board.</p>
      <LayoutGroup>
        <div className="bx-grid reveal">
          {order.map(id => {
            const cell = BOARD.find(c => c.id === id)!
            return (
              <motion.div key={id} layout transition={{ type: 'spring', stiffness: 380, damping: 34 }} className={`bx-cell bx-${cell.size}`}
                data-dragging={dragging === id || undefined} data-over={over === id && dragging !== id || undefined}>
                <div
                  className="bx-inner"
                  draggable
                  onDragStart={e => { setDragging(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) }}
                  onDragEnd={() => { setDragging(null); setOver(null) }}
                  onDragOver={e => { e.preventDefault(); if (over !== id) setOver(id) }}
                  onDragLeave={() => setOver(o => (o === id ? null : o))}
                  onDrop={e => { e.preventDefault(); drop(id) }}
                >
                  <div className="bx-head">
                    <span className="bx-label">{cell.label}</span>
                    <span className="bx-meta">{cell.meta}<span className="bx-grip" title="Drag to move">{GRIP}</span></span>
                  </div>
                  {cell.title && <h3 className="bx-title">{cell.title}</h3>}
                  {cell.desc && <p className="bx-desc">{cell.desc}</p>}
                  <BoardBody id={id} />
                </div>
              </motion.div>
            )
          })}
        </div>
      </LayoutGroup>
      </div>
    </section>
  )
}

// ── Campaigns (coming soon) ─────────────────────────────────────────────────────
const SAMPLE_EMAILS = ['you@example.com', 'clipper@gmail.com', 'creator@studio.in', 'hello@yourchannel.com']

/** Placeholder that types an email, pauses, deletes it and types the next, while the field is empty */
function useTypingPlaceholder(active: boolean) {
  const [text, setText] = useState(SAMPLE_EMAILS[0])
  useEffect(() => {
    if (!active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setText(SAMPLE_EMAILS[0]); return }
    let word = 0, len = 0, deleting = false
    let id: ReturnType<typeof setTimeout>
    const step = () => {
      const full = SAMPLE_EMAILS[word]
      len += deleting ? -1 : 1
      setText(full.slice(0, len))
      let wait = deleting ? 35 : 75 + Math.random() * 60   // typing is uneven, like a person
      if (!deleting && len === full.length) { deleting = true; wait = 1600 }
      else if (deleting && len === 0) { deleting = false; word = (word + 1) % SAMPLE_EMAILS.length; wait = 400 }
      id = setTimeout(step, wait)
    }
    setText(''); id = setTimeout(step, 500)
    return () => clearTimeout(id)
  }, [active])
  return text
}

export function CampaignsSection() {
  const [email, setEmail] = useState('')
  const [joined, setJoined] = useState(false)
  const [focused, setFocused] = useState(false)
  // types while the field is empty and not being typed in
  const typed = useTypingPlaceholder(!email && !focused)
  const placeholder = !email && !focused ? typed + '|' : 'you@example.com'
  return (
    <section className="section-inner">
      <div className="lx-campaign reveal">
        <span className="lx-soon">Coming soon</span>
        <h2 className="section-title">Get paid to clip.</h2>
        <p className="section-sub">Creators and brands will pay you per view to clip their content. Pick a campaign, clip it in minutes, post, and earn. Every source is approved, so your channel stays safe and your payouts stay predictable.</p>
        <p className="lx-early">Get early access</p>
        {joined ? (
          <p className="lx-joined" role="status">✓ You’re on the list. We’ll email you when campaigns open.</p>
        ) : (
          // TODO(backend): save the waitlist email
          <form className="lx-wait" onSubmit={e => { e.preventDefault(); if (/\S+@\S+\.\S+/.test(email)) setJoined(true) }}>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholder={placeholder} aria-label="Your email" />
            <button type="submit">Join the waitlist</button>
          </form>
        )}
      </div>
    </section>
  )
}

// ── Social proof ────────────────────────────────────────────────────────────────
// TODO(content): the client's page leaves these as placeholders; fill in real numbers and quotes.
// Numeric values (e.g. '12,400', '₹2.5L', '3.2M') count up when they scroll in.
const PROOF_STATS: { value: string; label: string; kind: 'clips' | 'hours' | 'views' }[] = [
  // Pre-launch: what the product does, not usage counts. Swap in real totals (e.g. '50,000+') once live.
  { value: '1 → 10', label: 'one long video in, ready-to-post clips out', kind: 'clips' },
  { value: 'Minutes', label: 'not hours, from upload to posted', kind: 'hours' },
  { value: '9:16', label: 'made for Instagram Reels and YouTube Shorts', kind: 'views' },
]
const QUOTES = [
  { quote: '[Quote about speed or volume, like going from 5 to 40 clips a week.]', who: '[Name], [niche] clipper', tag: 'More clips' },
  { quote: '[Quote about play-and-steer fixing AI mistakes.]', who: '[Name], [niche] clipper', tag: 'Play and steer' },
  { quote: '[Quote about trends or analytics leading to more views.]', who: '[Name], [niche] clipper', tag: 'More views' },
]

/** Counts a number up the first time it scrolls into view; text like '[X]' is shown as-is */
function CountUp({ value }: { value: string }) {
  // only plain amounts like '12,400', '₹2.5L' or '3.2M+' count up; '1 → 10' or '9:16' stay as written
  const m = /^([^\d]*)([\d,]*\.?\d+)([^\d]*)$/.exec(value)
  const ref = useRef<HTMLElement>(null)
  const [shown, setShown] = useState(m ? m[1] + '0' + m[3] : value)
  useEffect(() => {
    if (!m || !ref.current) return
    const target = parseFloat(m[2].replace(/,/g, ''))
    const decimals = (m[2].split('.')[1] ?? '').length
    const fmt = (n: number) => m[1] + n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + m[3]
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(value); return }
    let raf = 0
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      const start = performance.now()
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / 1600)
        setShown(fmt(target * (1 - Math.pow(1 - p, 3))))
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, { threshold: 0.5 })
    io.observe(ref.current)
    return () => { io.disconnect(); cancelAnimationFrame(raf) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return <b ref={ref}>{shown}</b>
}

/** A small looping illustration for each stat */
function StatArt({ kind }: { kind: 'clips' | 'hours' | 'views' }) {
  if (kind === 'clips') return (
    // Clips dealt out of one long video
    <span className="lx-art lx-art-clips" aria-hidden="true"><i /><i /><i /></span>
  )
  if (kind === 'hours') return (
    // A clock rewinding: time handed back
    <span className="lx-art lx-art-hours" aria-hidden="true">
      <svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" /><path className="lx-hand-h" d="M20 20V12" /><path className="lx-hand-m" d="M20 20h9" /><circle cx="20" cy="20" r="1.8" fill="currentColor" stroke="none" /></svg>
    </span>
  )
  return (
    // Bars climbing, with the trend line on top
    <span className="lx-art lx-art-views" aria-hidden="true"><i /><i /><i /><i />
      <svg viewBox="0 0 40 24" preserveAspectRatio="none"><path d="M2 20L14 14L24 16L38 3" /></svg>
    </span>
  )
}

/** Moves the card spotlight with the pointer */
function spotlight(e: React.PointerEvent<HTMLElement>) {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.lx-glow')
  if (!el) return
  const r = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${e.clientX - r.left}px`)
  el.style.setProperty('--my', `${e.clientY - r.top}px`)
}

const initial = (who: string) => (who.replace(/[^A-Za-z]/g, '')[0] ?? 'S').toUpperCase()

export function ProofSection() {
  return (
    <section className="section-inner">
      <div className="section-head reveal">
        <p className="section-eyebrow">Clippers</p>
        <h2 className="section-title">Clippers are posting more with Shortcut.</h2>
      </div>
      <div className="lx-quotes reveal" onPointerMove={spotlight}>
        {QUOTES.map((q, i) => (
          <figure key={i} className="lx-quote lx-glow" style={{ '--i': i } as React.CSSProperties}>
            <div className="lx-quote-top">
              <svg className="lx-quote-mark" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 7h4v4c0 3-1.5 5-4 6l-.8-1.4C7.8 14.8 8.5 13.6 8.6 12H7zm7 0h4v4c0 3-1.5 5-4 6l-.8-1.4c1.6-.8 2.3-2 2.4-3.6H14z" /></svg>
              <span className="lx-quote-tag">{q.tag}</span>
            </div>
            <span className="lx-stars" aria-label="5 out of 5 stars">
              {[0, 1, 2, 3, 4].map(s => (
                <svg key={s} viewBox="0 0 24 24" style={{ '--s': s } as React.CSSProperties} aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" /></svg>
              ))}
            </span>
            <blockquote>{q.quote}</blockquote>
            <figcaption>
              <span className="lx-avatar" aria-hidden="true"><span>{initial(q.who)}</span></span>
              {q.who}
            </figcaption>
          </figure>
        ))}
      </div>
      <TrendRows />
    </section>
  )
}

// ── Steer (the editor) ──────────────────────────────────────────────────────────
export function SteerIntro() {
  return (
    <div className="section-head reveal">
      <p className="section-eyebrow">Play and steer</p>
      <h2 className="section-title">AI got the frame wrong? Steer it right.</h2>
      <p className="section-sub">Hit play and guide the vertical frame live, like a camera operator. Follow whoever is talking. No keyframes, no frame-by-frame dragging. One pass and the clip is fixed.</p>
      <Link href="/signup" className="lx-cta">Start clipping
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </Link>
    </div>
  )
}

/**
 * Introducing Shortcut (user's website copy; redesigned 2026-11-21: "design this section perfectly"). After The
 * Problem — its answer. The name; the two sentences as one paragraph; then the payoff line made into a picture: two
 * cards, "You decide what matters." (the three things the copy says you do) and "Shortcut does the rest." (the very
 * chores The Problem's card timed at 3h 40m, ticked off one by one); under them, what goes away. Every entrance
 * replays each visit (useReplayReveal).
 */
const YOU_DO = [
  { Icon: Upload, text: 'Upload your video' },
  { Icon: MousePointerClick, text: 'Select the moment' },
  { Icon: Move, text: 'Guide the frame' },
]
const SHORTCUT_DOES = ['Cropping', 'Resizing', 'Adjusting frames', 'Adding captions', 'Exporting']
export function IntroSection() {
  const ref = useRef<HTMLElement>(null)
  useDirectionalReveal(ref)
  const d = (s: number) => ({ '--d': `${s}s` } as React.CSSProperties)
  return (
    <section ref={ref} className="section-inner lx-in" aria-labelledby="intro-title">
      <header className="lx-in-head">
        {/* (the label, refined — user 2026-11-21: the plain pill looked odd): the brand mark, "Introducing" quiet,
            "Shortcut" bright, a fine lime-to-clear edge and one light sweep as it comes in */}
        <p className="lx-in-eyebrow" data-anim="down">
          <span className="lx-in-eyebrow-mark" aria-hidden="true"><BrandLogo size="sm" /></span>
          <span className="lx-in-eyebrow-a">Introducing</span>
          <b>Shortcut</b>
        </p>
        <h2 className="lx-in-title" id="intro-title">
          {/* (its own entrance, user 2026-11-21): "Meet Shortcut." comes into focus word by word; then a lime light
              sweeps left to right and paints "Your Shortcut to Short-Form." in behind it */}
          {/* (user 2026-11-22) "Meet" introduces itself — its letters drop in one by one with a small bounce; then
              "Shortcut." is revealed in 3D (below) */}
          <span className="lx-in-line lx-in-line-1" data-anim="focus" style={d(0.1)}>
            <span className="lx-in-meet">
              {'Meet'.split('').map((c, k) => <span key={k} style={{ '--k': k } as React.CSSProperties}>{c}</span>)}
            </span>
            {/* "Shortcut." — the frame reveal (user 2026-11-22: "something creative, it should look like revealing"):
                the product's own vertical frame (white corner brackets, as in the hero's editor) appears over the start of
                the word, only what is inside it showing; it glides across, settles in the middle, then opens out to the
                full word — revealed — and its brackets fade */}
            <span className="lx-in-cut" aria-label="Shortcut.">
              <span className="lx-in-frame-word" aria-hidden="true">Shortcut.</span>
              <i className="lx-in-frame" aria-hidden="true"><b /></i>
            </span>
          </span>
          <span className="lx-in-line lx-in-line-2" data-anim="wipe" style={d(2.5)}>
            <span className="lx-in-paint">
              <span className="lx-in-title-2">Your Shortcut to Short-Form.</span>
              <i className="lx-in-beam" aria-hidden="true" />
            </span>
          </span>
        </h2>
      </header>

      {/* (two sentences, two lines of their own — user 2026-11-21: the bold one broke mid-line into the next) */}
      <div className="lx-in-lede" data-anim="up" style={d(0.3)}>
        <p className="lx-in-lede-1">Shortcut makes turning long videos into short-form content incredibly simple.</p>
        <p className="lx-in-lede-2">Upload your video, select the moment you want, guide the frame and let Shortcut handle the repetitive editing work.</p>
      </div>

      {/* what goes away (in the copy's order: after the two sentences, before the payoff) */}
      {/* (each line appears, then a red line strikes through it, it dims and its ✕ pops — one after the other;
          user 2026-11-21) */}
      <ul className="lx-in-gone" data-anim="seq" style={d(0.5)}>
        {['No complicated editing.', 'No unnecessary waiting.', 'No learning curve.'].map((t, i) => (
          <li key={t} style={{ '--i': i, '--ri': 2 - i } as React.CSSProperties}>
            <span className="lx-in-gone-t">{t}</span>
          </li>
        ))}
      </ul>

      {/* the payoff line, as a picture: what you do · what Shortcut does */}
      <div className="lx-in-split">
        <div className="lx-in-card lx-in-you" data-anim="left" style={d(0.15)}>
          <span className="lx-in-tag"><span className="lx-in-tag-mark" aria-hidden="true"><User strokeWidth={2.2} /></span>Your part</span>
          <h3>You decide what matters.</h3>
          <ul>
            {YOU_DO.map(({ Icon, text }, i) => (
              <li key={text} style={{ '--i': i, '--ri': YOU_DO.length - 1 - i } as React.CSSProperties}>
                <span className="lx-in-num" aria-hidden="true">{i + 1}</span>
                <span className="lx-in-ico" aria-hidden="true"><Icon strokeWidth={1.9} /></span>{text}
              </li>
            ))}
          </ul>
          <p className="lx-in-foot">That’s all you do.</p>
        </div>

        {/* (just the fine line between the two parts — the arrow button is gone, user 2026-11-21) */}
        <span className="lx-in-divider" data-anim="fade" style={d(0.5)} aria-hidden="true" />

        <div className="lx-in-card lx-in-sc" data-anim="right" style={d(0.3)}>
          <span className="lx-in-tag lx-in-tag-sc"><span className="lx-in-tag-mark" aria-hidden="true"><BrandLogo size="sm" /></span>Shortcut’s part</span>
          <h3>Shortcut does the rest.</h3>
          <ul>
            {SHORTCUT_DOES.map((text, i) => (
              <li key={text} style={{ '--i': i, '--ri': SHORTCUT_DOES.length - 1 - i } as React.CSSProperties}>
                <svg className="lx-in-mark" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4L16 6" /></svg>{text}
              </li>
            ))}
          </ul>
          <p className="lx-in-foot lx-in-foot-sc">The repetitive editing work, handled for you.</p>
        </div>
      </div>

    </section>
  )
}

/**
 * Why Shortcut? (user's website copy, 2026-11-21; replaces the "Inside Shortcut" board). The three ways to make a
 * short, side by side — Traditional editing · AI clipping tools · Shortcut — each with its line from the copy and two
 * plain meters, Control and Speed (how the copy itself compares them: control but slow · fast but no control · both).
 * Shortcut's column is the highlighted one. The closing line, "Built for speed. Made for control.", lands last.
 * Entrances replay on every visit (useReplayReveal).
 */
const WHY = [
  { id: 'trad', label: 'Traditional Editing', line: 'You have complete control, but every crop, caption and export takes time.', control: 0.95, speed: 0.22 },
  { id: 'ai', label: 'AI Clipping Tools', line: 'They’re fast, but AI chooses the moments and framing. You often end up fixing the results.', control: 0.25, speed: 0.92 },
  { id: 'sc', label: 'Shortcut', line: 'You choose the moments. You guide the frame. Shortcut handles the repetitive editing.', control: 0.95, speed: 0.92 },
]
export function WhySection() {
  const ref = useRef<HTMLElement>(null)
  useReplayReveal(ref)
  const d = (s: number) => ({ '--d': `${s}s` } as React.CSSProperties)
  return (
    <section ref={ref} className="section-inner lx-why" aria-labelledby="why-title">
      <header className="lx-why-head">
        <p className="lx-why-eyebrow" data-anim="down">Why Shortcut?</p>
        <h2 className="lx-why-title" id="why-title" data-anim="up" style={d(0.1)}>
          Not Another AI That <span className="lx-why-em">Decides for You.</span>
        </h2>
      </header>

      <div className="lx-why-cols">
        {WHY.map((w, i) => (
          <article key={w.id} className={`lx-why-col lx-why-${w.id}`} data-anim="up" style={d(0.25 + i * 0.18)}>
            <div className="lx-why-top">
              {w.id === 'sc'
                ? <span className="lx-why-tag lx-why-tag-sc"><span className="lx-in-tag-mark" aria-hidden="true"><BrandLogo size="sm" /></span>Shortcut</span>
                : <span className="lx-why-tag">{w.label}</span>}
              {w.id === 'sc' && <span className="lx-why-best">Both</span>}
            </div>
            <p className="lx-why-line">{w.line}</p>
            <dl className="lx-why-meters">
              {([['Control', w.control], ['Speed', w.speed]] as const).map(([k, v], j) => (
                <div key={k} className="lx-why-meter" style={{ '--v': v, '--j': j } as React.CSSProperties}>
                  <dt>{k}</dt>
                  <dd><i /></dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>

      <p className="lx-why-close" data-anim="up" style={d(0.4)}>
        Built for <b>speed</b>. Made for <b>control</b>.
      </p>
    </section>
  )
}

/**
 * Who Is It For? (user's website copy, 2026-11-21; replaces the "Clippers" placeholder quotes). Six audiences, each a
 * card with its icon, name and the copy's line. Same family as Why Shortcut (label, headline, cards); entrances replay
 * on every visit (useReplayReveal).
 */
const WHO = [
  { Icon: Mic, name: 'Podcasters', line: 'Turn every episode into multiple short-form videos.' },
  { Icon: MonitorPlay, name: 'YouTubers', line: 'Get more Reels and Shorts from your existing videos.' },
  { Icon: Sparkles, name: 'Content Creators', line: 'Create more content without spending hours editing.' },
  { Icon: Scissors, name: 'Editors & Agencies', line: 'Produce more clips without repetitive editing work.' },
  { Icon: GraduationCap, name: 'Educators & Coaches', line: 'Turn lessons, lectures and webinars into bite-sized content.' },
  { Icon: Megaphone, name: 'Brands & Marketers', line: 'Repurpose interviews, events and product videos.' },
]
export function WhoSection() {
  const ref = useRef<HTMLElement>(null)
  useReplayReveal(ref)
  const d = (s: number) => ({ '--d': `${s}s` } as React.CSSProperties)
  return (
    <section ref={ref} className="section-inner lx-who" aria-labelledby="who-title">
      <header className="lx-who-head">
        <p className="lx-why-eyebrow" data-anim="down">Who is it for?</p>
        <h2 className="lx-who-title" id="who-title" data-anim="up" style={d(0.1)}>
          <span>Made for Everyone</span> <span className="lx-who-em">Creating Long-Form Content.</span>
        </h2>
      </header>
      <ul className="lx-who-grid">
        {WHO.map(({ Icon, name, line }, i) => (
          <li key={name} className="lx-who-card" data-anim="up" style={d(0.25 + (i % 3) * 0.12 + Math.floor(i / 3) * 0.22)}>
            <span className={`lx-who-ico lx-who-ico-${i}`} aria-hidden="true"><Icon strokeWidth={1.8} /></span>
            <h3>{name}</h3>
            <p>{line}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
