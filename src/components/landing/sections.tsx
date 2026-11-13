'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { VelocityMarquee } from '@/components/ui/velocity-marquee'
import { LayoutGroup, motion } from 'framer-motion'
import { useProblemFlip } from '@/components/landing/problem-flip'

/**
 * Landing-page sections for the "Turn every video into income" story (styles: .lx-* in
 * app/landing.css). Copy follows the client's page; bracketed placeholders from it are kept in
 * the constants below so they're easy to fill in.
 */

// ── Problem ─────────────────────────────────────────────────────────────────────
type PainArt = 'hours' | 'crop' | 'blind'
const PAINS: { art: PainArt; title: string; desc: string; fix: string; href: string }[] = [
  { art: 'hours', title: 'Hours per video', desc: 'Finding moments, cropping, captioning, exporting. One long video can eat your whole afternoon.', fix: 'One upload, a week of clips', href: '#process' },
  { art: 'crop', title: 'AI that gets it wrong', desc: 'The crop drifts off the speaker, the cut lands mid-sentence, and fixing it means opening a timeline.', fix: 'Steer it right while it plays', href: '#process' },
  { art: 'blind', title: 'Posting blind', desc: 'You don’t know which topics are hot or which clips earned, so you can’t double down on what works.', fix: 'See what’s trending and earning', href: '#trends' },
]
const CHORES = ['Find', 'Crop', 'Caption', 'Export']

/** The editing clock running away: hours pile up while the chores tick by one at a time */
function HoursArt() {
  const [secs, setSecs] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setSecs(3 * 3600 + 47 * 60 + 12); return }
    // Ticks only while it can be seen (on screen, the tab showing): off screen it used to redraw 12×
    // a second for as long as the page was open
    let id: ReturnType<typeof setInterval> | null = null
    let seen = false
    const run = () => {
      const want = seen && !document.hidden
      if (want && !id) id = setInterval(() => setSecs(s => (s + 97) % (4 * 3600)), 80)
      else if (!want && id) { clearInterval(id); id = null }
    }
    const io = new IntersectionObserver(([e]) => { seen = e.isIntersecting; run() })
    if (ref.current) io.observe(ref.current)
    document.addEventListener('visibilitychange', run)
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', run); if (id) clearInterval(id) }
  }, [])
  const hh = Math.floor(secs / 3600), mm = Math.floor(secs / 60) % 60, ss = secs % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <div ref={ref} className="lx-pa lx-pa-hours" aria-hidden="true">
      <div className="lx-pa-timer"><span className="lx-pa-rec" />{hh}:{pad(mm)}:{pad(ss)}</div>
      <div className="lx-pa-chores">{CHORES.map((c, i) => <span key={c} style={{ '--k': i } as React.CSSProperties}>{c}</span>)}</div>
      <div className="lx-pa-track"><span /></div>
    </div>
  )
}

/** A 9:16 crop drifting off the speaker, flagged, then snapping back */
function CropArt() {
  return (
    <div className="lx-pa lx-pa-crop" aria-hidden="true">
      <div className="lx-pa-frame">
        <span className="lx-pa-bokeh" /><span className="lx-pa-person"><i /><b /></span>
        <span className="lx-pa-person lx-pa-person-2"><i /><b /></span>
        <span className="lx-pa-box"><em>Off the speaker</em></span>
      </div>
    </div>
  )
}

/** Analytics you can't read: bars keep guessing, values are question marks */
function BlindArt() {
  return (
    <div className="lx-pa lx-pa-blind" aria-hidden="true">
      <div className="lx-pa-bars">
        {[0, 1, 2, 3, 4, 5].map(i => <span key={i} style={{ '--k': i } as React.CSSProperties}><em>?</em></span>)}
      </div>
      <div className="lx-pa-legend"><span>Views ?</span><span>Earned ?</span><span>Hot topic ?</span></div>
    </div>
  )
}

const FIX_ARROW = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>

function PainCard({ p, i }: { p: (typeof PAINS)[number]; i: number }) {
  return (
    <article className={`lx-pain lx-pain-${p.art}`} style={{ '--i': i } as React.CSSProperties}>
      {p.art === 'hours' ? <HoursArt /> : p.art === 'crop' ? <CropArt /> : <BlindArt />}
      <span className="lx-pain-num">0{i + 1}</span>
      <h3>{p.title}</h3>
      <p>{p.desc}</p>
      {/* How Shortcut answers it: jumps to the section that shows the fix */}
      <a className="lx-pain-fix" href={p.href}>
        <span>{p.fix}</span>
        {FIX_ARROW}
      </a>
    </article>
  )
}

/**
 * The Problem. With `flip` (desktop), the cards play a scroll story (problem-flip.ts): they rise out
 * of the hero as a deck, deal out, then each turns over to its fix, and lines lead on to How it works.
 */
export function ProblemSection({ flip = false }: { flip?: boolean }) {
  const outer = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), fit = useRef<HTMLDivElement>(null)
  useProblemFlip(flip, outer, stage, fit)
  const body = (
    <section className="section-inner">
      <div className="section-head reveal">
        <p className="section-eyebrow">The problem</p>
        <h2 className="section-title">More clips means more money.<br /> Editing slows you down.</h2>
        <p className="section-sub">Every hour spent scrubbing timelines and fixing crops is an hour you’re not posting. Manual editing is too slow to keep up. AI clippers are fast, but you still end up fixing their framing clip by clip.</p>
      </div>
      <div className="lx-pains reveal">
        {PAINS.map((p, i) => flip ? (
          <div key={p.title} className="pf-card">
            <div className="pf-flip">
              <PainCard p={p} i={i} />
              {/* the back: Shortcut's answer to it */}
              <a className="pf-back" href={p.href}>
                <span className="pf-back-num">0{i + 1}</span>
                <span className="pf-back-fix">{p.fix}</span>
                <span className="pf-back-go">{FIX_ARROW}</span>
              </a>
            </div>
            <span className="pf-bridge" aria-hidden="true" />
          </div>
        ) : <PainCard key={p.title} p={p} i={i} />)}
      </div>
    </section>
  )
  if (!flip) return body
  return (
    <div ref={outer} className="pf">
      <div ref={stage} className="pf-stage"><div ref={fit} className="pf-fit">{body}</div></div>
    </div>
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
      <Link href="/signup" className="lx-cta">Start clipping free
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </Link>
    </div>
  )
}
