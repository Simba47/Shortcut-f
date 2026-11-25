import type { Metadata } from 'next'
import Link from 'next/link'
import {
  BookOpen, Captions, Check, Clapperboard, Coins, Download, Film, Frame, Hash, Keyboard, LayoutGrid, LifeBuoy, Music,
  Palette, Rocket, Scissors, Search, SlidersHorizontal, Sparkles, Type, Upload, Users, WandSparkles, Crop, Image as ImageIcon,
} from 'lucide-react'
import { requireUser } from '@/server/auth'
import { toolGuides } from '@/server/services/toolGuides'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { AccountMenu } from '@/components/ui/account-menu'
import { CreditsButton } from '@/components/ui/credits-badge'
import { HintStage, type HintId } from '@/components/editor/ToolHints'
import { ClipForge } from '@/components/landing/clip-forge'
import { EditorMockup } from '@/components/ui/editor-mockup'
import { ZoomFit } from '@/components/ui/zoom-fit'
import { PLANS } from '@/lib/plans'
import {
  CAPTION_CREDITS_PER_MINUTE, EXPORT_CREDITS_PER_MINUTE, PLAN_CREDIT_DAYS, READING_CREDITS, SUBJECTS_CREDITS_PER_MINUTE,
  TOPUP_CREDIT_DAYS, TRIAL_DAYS, TRIAL_PACK, readingCredits,
} from '@/lib/credits'
import { ASK_AI_CREDITS, CLIP_CREDITS, REWRITES_PER_CREDIT, clipCredits } from '@/lib/aiLimits'
import { ACCEPTED_VIDEO_EXTENSIONS, SARVAM_LANGUAGES } from '@/lib/shared/constants'
import { SHORTCUT_GROUPS } from '@/lib/shortcuts'
import { GuideToc } from './GuideToc'
import { ToolGuidesSwitch } from './ToolGuidesSwitch'
import { Demo } from './GuideDemos'
import { Live } from './Live'
import './guide.css'

/**
 * The Guide (user, 2026-11-19): every part of Shortcut, for signed-in users — shown more than told ("no normal
 * user reads all of them"): each part is a demo and a line. The demos: the landing page's ClipForge and
 * EditorMockup, the editor's transition tiles, the timeline tools' loops (ToolHints) and the Guide's own
 * (GuideDemos.tsx). Prices and limits come from the code (credits.ts, aiLimits.ts, plans.ts).
 */

export const metadata: Metadata = {
  title: 'Guide — Shortcut',
  description: 'How Shortcut works: upload, Make my clips, Ask AI, the clip board, the editor, export and credits.',
}
export const dynamic = 'force-dynamic'

const formats = ACCEPTED_VIDEO_EXTENSIONS.map(e => e.slice(1).toUpperCase()).join(' · ')
const maxGb = Math.max(...Object.values(PLANS).map(p => p.maxFileSizeGb))
const languages = SARVAM_LANGUAGES.map(l => l.label.split(' ')[0]).join(', ')

const SECTIONS = [
  { id: 'start', label: 'Getting started', icon: <Rocket /> },
  { id: 'credits', label: 'Credits', icon: <Coins /> },
  { id: 'upload', label: 'Upload', icon: <Upload /> },
  { id: 'make-my-clips', label: 'Make my clips', icon: <Sparkles /> },
  { id: 'ask-ai', label: 'Ask AI', icon: <Search /> },
  { id: 'clip-board', label: 'Clip board', icon: <LayoutGrid /> },
  { id: 'editor', label: 'The editor', icon: <Clapperboard /> },
  { id: 'timeline', label: 'Timeline tools', icon: <SlidersHorizontal /> },
  { id: 'editor-tools', label: 'Editor tools', icon: <WandSparkles /> },
  { id: 'export', label: 'Export', icon: <Download /> },
  { id: 'brand-kit', label: 'Brand kit', icon: <Palette /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard /> },
  { id: 'help', label: 'Help', icon: <LifeBuoy /> },
]

/**
 * A part of the Guide as one screen-high panel (user, 2026-11-19: "each tab a viewport size div… if it can't
 * fit keep 2 divs"): its name and a line, then How it works in numbered steps, then the demo. A part too big
 * for one screen is two panels: the second has its own id and `toc` = the first's, so the list stays lit, and
 * `part` says "1 of 2" / "2 of 2".
 */
function Section({ id, toc, part, title, line, steps, children }: {
  id: string; toc?: string; part?: string; title: string; line?: React.ReactNode; steps?: React.ReactNode[]; children?: React.ReactNode
}) {
  const s = SECTIONS.find(x => x.id === (toc ?? id))
  return (
    <section id={id} className="gd-sec gd-panel" aria-labelledby={`${id}-h`}>
      <div className="gd-sec-head">
        <span className="gd-sec-ico" aria-hidden="true">{s?.icon}</span>
        <h2 id={`${id}-h`}>{title}</h2>
        {part && <span className="gd-part">{part}</span>}
      </div>
      {line && <p className="gd-lead">{line}</p>}
      {steps && (
        <ol className="gd-steps" aria-label="How it works">
          {steps.map((st, i) => <li key={i}><span className="gd-step-n" aria-hidden="true">{i + 1}</span><span>{st}</span></li>)}
        </ol>
      )}
      {children && <div className="gd-panel-body">{children}</div>}
    </section>
  )
}

/** A demo with at most three short facts beside it */
function Feature({ children, facts }: { children: React.ReactNode; facts: React.ReactNode[] }) {
  return (
    <Live className="gd-feat">
      <div className="gd-vis">{children}</div>
      <ul className="gd-facts">{facts.map((f, i) => <li key={i}><Check aria-hidden="true" /><span>{f}</span></li>)}</ul>
    </Live>
  )
}

// The timeline's tools, as the bar has them; each plays its loop under the mouse
const TOOLS: { id: HintId; name: string; keys?: string[]; line: string }[] = [
  { id: 'split', name: 'Split', keys: ['S'], line: 'Cut in two at the playhead' },
  { id: 'duplicate', name: 'Duplicate', keys: ['Ctrl', 'D'], line: 'Copy, right after it' },
  { id: 'delete', name: 'Delete', keys: ['Del'], line: 'Remove what’s picked' },
  { id: 'freeze', name: 'Freeze', line: 'Hold a moment still' },
  { id: 'mirror', name: 'Mirror', line: 'Flip left to right' },
  { id: 'rotate', name: 'Rotate', line: 'Turn it 90°' },
  { id: 'group', name: 'Group', keys: ['Ctrl', 'G'], line: 'Move items together' },
  { id: 'ungroup', name: 'Ungroup', line: 'Each on its own again' },
  { id: 'detach', name: 'Detach audio', line: 'Sound on its own bar' },
  { id: 'record', name: 'Record voice', line: 'Talk over the clip — dub or voiceover' },
  { id: 'undo', name: 'Undo', keys: ['Ctrl', 'Z'], line: 'Take back the last change' },
  { id: 'redo', name: 'Redo', line: 'Do it again' },
  { id: 'reset', name: 'Reset all', line: 'Back to the original clip' },
  { id: 'play', name: 'Play', keys: ['Space'], line: 'Plays exactly as it exports' },
  { id: 'prev', name: 'Previous section', line: 'Jump back a section' },
  { id: 'next', name: 'Next section', line: 'Jump to the next one' },
  { id: 'zoomin', name: 'Zoom in', line: 'Stretch for fine cuts' },
  { id: 'zoomout', name: 'Zoom out', line: 'See more at once' },
  { id: 'fit', name: 'Whole clip', line: 'All of it in view' },
  { id: 'fold', name: 'Hide timeline', line: 'More room for the video' },
]

/** A timeline tool: its loop (plays under the mouse), its name and keys, and what it does */
function ToolCard({ t }: { t: (typeof TOOLS)[number] }) {
  return (
    <div className="gd-tool" tabIndex={0} aria-label={`${t.name}: ${t.line}`}>
      <HintStage id={t.id} />
      <div className="gd-tool-name"><span>{t.name}</span>{t.keys && <span>{t.keys.map(k => <kbd key={k}>{k}</kbd>)}</span>}</div>
      <p>{t.line}</p>
    </div>
  )
}

// (the timeline's tools in two screens: changing the clip, then undo, playing and the view)
const TOOLS_EDIT = TOOLS.slice(0, 9)
const TOOLS_VIEW = TOOLS.slice(9)

const EDITOR_TOOLS = [
  { icon: <Crop />, name: 'Format', line: 'Layouts and reframing', more: 'Pick a layout (one person, split screen and more). It applies from the playhead on, so one clip can change layout.' },
  { icon: <Frame />, name: 'Frames', line: 'Videos and photos in one reel', more: 'Put several videos and photos side by side or one after another in a single clip.' },
  { icon: <Users />, name: 'Subjects', line: 'Follow whoever is talking', more: `Mark the people once; the frame follows whoever speaks. ${SUBJECTS_CREDITS_PER_MINUTE} credits a minute, once per clip.` },
  { icon: <Type />, name: 'Text', line: 'Titles and hooks on top', more: 'Add a title or hook on top of the video, in your fonts and colours.' },
  { icon: <ImageIcon />, name: 'Media', line: 'Your videos, B-roll, photos', more: 'Bring in your own videos and photos, or free stock B-roll, onto the Videos lane.' },
  { icon: <Music />, name: 'Music', line: 'Quieter while people talk', more: 'Background music that drops down by itself whenever someone is talking.' },
  { icon: <Scissors />, name: 'Cleanup', line: 'Cut silences and um, uh', more: 'Detect finds silences, filler words and repeats. Play each one, then delete or keep it.' },
  { icon: <Hash />, name: 'Post', line: 'Title, caption, hashtags', more: `AI writes a title, caption and hashtags for posting. Rewrites: 1 credit for ${REWRITES_PER_CREDIT}.` },
  { icon: <Palette />, name: 'Brand kit', line: 'Your logo and colours', more: 'Your logo, colours and caption look, put on the clip in one press.' },
]

// A worked example for the Credits panel, from the real prices: a 30-minute video, 10 AI clips, each exported
// (an AI clip's export is in its price since 2026-11-21)
const EX_MIN = 30, EX_CLIPS = 10
const EX = { read: readingCredits(EX_MIN * 60_000), clips: clipCredits(EX_CLIPS) }
const EX_TOTAL = EX.read + EX.clips

// (plans v2, 2026-11-21: Trial, Starter, Pro; Agency no longer sold)
const PAID_ORDER = ['trial', 'starter', 'creator'] as const
const sizes = PAID_ORDER.map(k => `${PLANS[k].name} ${PLANS[k].maxFileSizeGb} GB`).join(' · ')
const perRun = PAID_ORDER.map(k => `${PLANS[k].name} ${PLANS[k].ai.clipsPerRun}`).join(' · ')

// The transition tiles, as the editor plays them (globals.css .tr-tile / .tr-demo)
const TRANSITIONS = [['fade', 'Dissolve'], ['slideleft', 'Slide'], ['wipe', 'Wipe'], ['zoomin', 'Zoom'], ['circleopen', 'Circle'], ['fadeblack', 'Dip']]

const PRICES = [
  { n: READING_CREDITS, unit: 'per 10 min', what: 'Reading a video' },
  { n: CLIP_CREDITS, unit: 'per clip', what: 'Make my clips (export included)' },
  { n: ASK_AI_CREDITS, unit: 'per hour', what: 'Ask AI search' },
  { n: CAPTION_CREDITS_PER_MINUTE, unit: 'per min', what: 'Captions on your clip' },
  { n: SUBJECTS_CREDITS_PER_MINUTE, unit: 'per min', what: 'Following people' },
  { n: EXPORT_CREDITS_PER_MINUTE, unit: 'per min', what: 'Export' },
  { n: 1, unit: `per ${REWRITES_PER_CREDIT}`, what: 'AI rewrites' },
]

// The keys most people use (the rest: Keyboard shortcuts in the editor, ?)
const TOP_KEYS = ['Play or pause', 'Split at the playhead', 'Delete what’s selected', 'Duplicate what’s selected', 'Undo', 'Paste at the playhead (into any clip)']
const keyItems = SHORTCUT_GROUPS.flatMap(g => g.items).filter(i => TOP_KEYS.includes(i.what))

export default async function GuidePage() {
  const user = await requireUser()
  const guides = await toolGuides(user.id).catch(() => ({ on: true, chosen: false, exported: false }))

  return (
    <div className="gd-page">
      <nav className="gd-nav">
        <Breadcrumbs shine items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Guide' }]} />
        <div className="flex-1" />
        <CreditsButton />
        <AccountMenu />
      </nav>

      <div className="gd-wrap">
        <GuideToc items={SECTIONS} />

        <main className="gd-main">
          {/* ── Getting started: the page's head and the four steps, one screen ── */}
          <section id="start" className="gd-sec gd-panel gd-panel-hero" aria-labelledby="start-h">
            <header className="gd-hero">
              <span className="gd-kicker"><BookOpen aria-hidden="true" />Guide</span>
              <h1 id="start-h">Long video in. Ready clips out.</h1>
              <p>Shortcut turns one long video (a podcast, an interview, a stream) into short vertical clips with captions, ready to post. Here is each part, one screen at a time.</p>
            </header>
            <nav className="gd-flow" aria-label="The four steps">
              <a href="#upload"><span className="gd-flow-n">1</span><b>Upload</b><span>Drop your video or paste a Drive / Dropbox link. We read the speech once.</span></a>
              <a href="#make-my-clips"><span className="gd-flow-n">2</span><b>Make clips</b><span>AI picks the best moments and makes them into clips with captions and a title.</span></a>
              <a href="#editor"><span className="gd-flow-n">3</span><b>Edit</b><span>Open any clip to trim it, change the layout, style the captions, add music.</span></a>
              <a href="#export"><span className="gd-flow-n">4</span><b>Export</b><span>Make the video in 1080p, download it and post it.</span></a>
            </nav>
            <p className="gd-note"><Sparkles aria-hidden="true" /><span>New here? The Trial pack: {TRIAL_PACK.credits} credits for ₹{TRIAL_PACK.price}, for {TRIAL_DAYS} days, to try everything. <Link href="/pricing">See plans</Link></span></p>
          </section>

          {/* ── Credits ── */}
          <Section id="credits" title="Credits" line="Credits pay for the work we run for you. 1 credit ≈ ₹1, and you always see the price before anything runs."
            steps={[
              'Your plan adds credits every month (the Trial: once).',
              'Before anything that costs credits, you see the price and say OK.',
              'If a job fails, its credits come straight back.',
            ]}>
            <div className="gd-prices">
              {PRICES.map(p => (
                <div className="gd-price" key={p.what}><b>{p.n}</b><span>{p.unit}</span><em>{p.what}</em></div>
              ))}
            </div>
            <div className="gd-example">
              <b>Example</b>
              <span>A {EX_MIN}-minute video: reading {EX.read} + {EX_CLIPS} AI clips with their exports {EX.clips} = <strong>{EX_TOTAL} credits</strong></span>
            </div>
            <ul className="gd-facts gd-facts-row">
              <li><Check aria-hidden="true" /><span>Plan credits last {PLAN_CREDIT_DAYS} days</span></li>
              <li><Check aria-hidden="true" /><span>Credit packs last {Math.round(TOPUP_CREDIT_DAYS / 30.4)} months</span></li>
              <li><Check aria-hidden="true" /><span>Need more? <Link href="/billing">Buy credits</Link></span></li>
            </ul>
          </Section>

          {/* ── Upload ── */}
          <Section id="upload" title="Upload" line="Bring in your long video: from your computer, or from a Google Drive or Dropbox link."
            steps={[
              'On the Dashboard, drop a video file, or paste a share link.',
              `See the price (${READING_CREDITS} credits per 10 minutes) and say OK.`,
              'We read the speech. You can leave the page while it works.',
            ]}>
            <div className="gd-duo">
              <Feature facts={[formats, sizes]}><Demo scene="upload" label="A video file drops in and uploads" /></Feature>
              <Feature facts={['Share as “Anyone with the link”', 'You OK the credits first']}><Demo scene="link" label="A Drive link is pasted, the credits are OK’d, and it imports" /></Feature>
            </div>
            <p className="gd-note"><Captions aria-hidden="true" /><span>Speech is read in {languages}.</span></p>
          </Section>

          {/* ── Make my clips ── */}
          <Section id="make-my-clips" title="Make my clips" line="AI finds the best moments in your video and finishes each one for you."
            steps={[
              'Open the video’s Clip board and press Make my clips.',
              `Choose how many (per run: ${perRun}). ${CLIP_CREDITS} credits a clip, its export included.`,
              'Each clip comes cut, framed, captioned and with a title hook.',
            ]}>
            <Live className="gd-wide lp-root gd-lp"><ClipForge clips={10} /></Live>
            <div className="gd-chips">
              <span className="gd-chip">Captions</span><span className="gd-chip">Title hook</span>
              <span className="gd-chip">Follow people</span><span className="gd-chip">Split screen</span>
              <span className="gd-chip">Up to 1 clip per minute of video</span>
            </div>
          </Section>

          {/* ── Ask AI ── */}
          <Section id="ask-ai" title="Ask AI" line="Looking for something specific? Say it, and AI finds those moments."
            steps={[
              'Type what you want: “funny reactions”, “hot takes”, “the pricing part”.',
              `AI reads the whole video (${ASK_AI_CREDITS} credits per started hour).`,
              'The moments light up. Press + to keep one as a clip.',
            ]}>
            <Feature facts={['Search in your own words', 'See where each moment is', 'Press + to keep one']}><Demo scene="askai" label="A search is typed, moments light up on the video, results get a plus" /></Feature>
          </Section>

          {/* ── Clip board ── */}
          <Section id="clip-board" title="Clip board" line="Every clip of a video, in one place."
            steps={[
              'AI clips and your own arrive here as cards.',
              'Press New clip to cut one yourself, ♥ to keep a favourite.',
              'Open any card in the editor. Green means it has been exported.',
            ]}>
            <Feature facts={['Make your own with New clip', '♥ keeps favourites', 'Green = exported']}><Demo scene="clipboard" label="Clips arrive on the board, one gets a heart, one is exported" /></Feature>
          </Section>

          {/* ── The editor ── */}
          <Section id="editor" title="The editor" line="Make a clip yours. What you see is exactly what you export, and it saves by itself."
            steps={[
              'Drag the frame to steer who is in view, or pick a layout.',
              'Style the captions, add text, music, B-roll and transitions.',
              'Play it back: it plays just as it will export.',
            ]}>
            <Live className="gd-wide lp-root gd-lp gd-mock">
              <ZoomFit width={880} className="editor-showcase pw-editor"><EditorMockup /></ZoomFit>
            </Live>
          </Section>

          {/* ── Timeline tools: two screens ── */}
          <Section id="timeline" part="1 of 2" title="Timeline tools: change the clip" line="The bar above the timeline. Point at a card to watch it work."
            steps={['Pick a part on the timeline (or put the playhead where you want).', 'Press the tool, or its key.']}>
            <div className="gd-tool-grid gd-tool-grid-3">
              {TOOLS_EDIT.map(t => <ToolCard key={t.id} t={t} />)}
            </div>
          </Section>
          <Section id="timeline-2" toc="timeline" part="2 of 2" title="Timeline tools: undo, play and view" line="Take back a change, play it, and zoom the timeline for fine cuts.">
            <div className="gd-tool-grid">
              {TOOLS_VIEW.map(t => <ToolCard key={t.id} t={t} />)}
            </div>
            <ToolGuidesSwitch initial={guides} />
          </Section>

          {/* ── Editor tools: two screens ── */}
          <Section id="editor-tools" part="1 of 2" title="Editor tools: captions and transitions" line="The two you will use on almost every clip.">
            <div className="gd-duo">
              <Live className="gd-feat gd-feat-col">
                <div className="gd-vis"><Demo scene="captions" label="Captions light up word by word" /></div>
                <div className="gd-feat-name"><Captions aria-hidden="true" /><b>Captions</b><span>Word by word, the spoken one lit. Pick a look, colours and size. {CAPTION_CREDITS_PER_MINUTE} credits a minute on a clip you cut yourself.</span></div>
              </Live>
              <Live className="gd-feat gd-feat-col">
                <div className="gd-vis gd-trs">
                  {TRANSITIONS.map(([k, name]) => (
                    <span className="tr-tile" data-on="" key={k}>
                      <span className="tr-demo" data-kind={k} aria-hidden="true"><i className="tr-a" /><i className="tr-b" /><i className="tr-fx" /></span>
                      <span className="tr-name">{name}</span>
                    </span>
                  ))}
                </div>
                <div className="gd-feat-name"><Film aria-hidden="true" /><b>Transitions</b><span>Smooth joins where two parts meet. Free.</span></div>
              </Live>
            </div>
          </Section>
          <Section id="editor-tools-2" toc="editor-tools" part="2 of 2" title="Editor tools: everything else" line="Down the left side of the editor. Press one to open its panel.">
            <div className="gd-icons gd-icons-more">
              {EDITOR_TOOLS.map(t => (
                <div className="gd-icon" key={t.name}><span aria-hidden="true">{t.icon}</span><b>{t.name}</b><em>{t.more}</em></div>
              ))}
            </div>
          </Section>

          {/* ── Export ── */}
          <Section id="export" title="Export" line="One press makes the finished video. Keep editing while it is made."
            steps={[
              `Press Export and see the price (${EXPORT_CREDITS_PER_MINUTE} credit per minute of clip).`,
              'It is made in 1080p while you carry on.',
              'Press Download. Changed it afterwards? Export again.',
            ]}>
            <Feature facts={['Price shown first', 'Failed? Credits come back', 'Edited after? Export again']}><Demo scene="export" label="Export is pressed, the clip is made, Download appears" /></Feature>
          </Section>

          {/* ── Brand kit ── */}
          <Section id="brand-kit" title="Brand kit" line="Set your look once, and every clip wears it."
            steps={[
              'Make a kit: your logo, colours and caption look.',
              'On the Clip board, press Put on all.',
              'Change the kit later, and the clips follow.',
            ]}>
            <Feature facts={['Logo, colours, caption look', 'Put on all from the Clip board', 'Change the kit, clips follow']}><Demo scene="brand" label="A brand kit goes onto three clips" /></Feature>
          </Section>

          {/* ── Shortcuts ── */}
          <Section id="shortcuts" title="Shortcuts" line={<>The keys you will use most in the editor. Press <kbd className="gd-kbd">?</kbd> there for all of them.</>}>
            <div className="gd-keys">
              {keyItems.map(it => (
                <div className="gd-key" key={it.what}><span>{it.keys.map(k => <kbd key={k}>{k}</kbd>)}</span><em>{it.what.replace(' (into any clip)', '')}</em></div>
              ))}
            </div>
          </Section>

          {/* ── Help ── */}
          <Section id="help" title="Still stuck?" line="We are happy to help. Write to us and a person answers.">
            <div className="gd-help">
              <Link href="/support" className="gd-btn"><LifeBuoy aria-hidden="true" />Support</Link>
              <Link href="/dashboard" className="gd-btn" data-ghost="">Back to the Dashboard</Link>
            </div>
          </Section>
        </main>
      </div>
    </div>
  )
}
