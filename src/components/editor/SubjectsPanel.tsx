'use client'

import { useEffect, useState } from 'react'
import { useFaceAt, useFrameAt } from '@/modules/clips/thumbs'

// ── Subjects: mark the people, and the view follows them through the clip ─────
// Mark the subject: the person in the view. Mark the shot: a group subject — the format on screen and
// its views (say Split: two people on top, one below) go wherever the clip shows that camera shot
// again, over following whoever is talking. Marking only adds them to the list; once everyone and
// every group is marked, Mark in the whole clip looks for all of them through the whole clip
// together, and then lays the clip out once: the groups' formats, and everywhere else the view on
// whoever is talking. Undo takes it back.
//
// The panel asks "Who is in this clip?": the people of the camera angle (scene) at the playhead as faces
// to tap, with a strip of the other scenes to go through so none is missed (a scene's shot, and everywhere
// it comes back). A scene left as it is isn't lost: the view there follows whoever is talking, as everywhere.
// Group shots are folded away (optional); one button at the bottom, Follow them in the clip, does the rest.

export interface SubjectItem {
  id: string
  label: string
  color: string
  status: 'new' | 'queued' | 'running' | 'done' | 'failed'
  error: string | null
  progress: number
  /** How much of the clip they are seen in (0–1), once tracked */
  seen: number | null
  /** Tracked before the clip's start or end moved: the new part isn't covered */
  stale: boolean
  /** Their face for the picture on the card: a moment of the video (its own time, ms) and the face's box there */
  face: { ms: number; box: { x: number; y: number; w: number; h: number } } | null
  /** A group subject (a marked shot): its format, and how many times the clip shows the shot (once found) */
  group?: { layout: string; places: number } | null
}

/** A camera angle of the clip (modules/editor/angles.ts angleRows) */
export interface AngleItem {
  /** How many people it shows; 0: the other shots (no faces, or too short to be an angle) */
  people: number
  /** A moment that shows it (the video's own time, ms): its picture, and the faces there, left to right */
  at: number
  /** `added`: marked by hand (+ Add) and found here; `pending`: marked by hand here, being looked for */
  faces: Array<{ box: { x: number; y: number; w: number; h: number }; subject: { label: string; color: string } | null; added?: boolean; pending?: boolean }>
  /** Where the clip shows it (each a stretch of the timeline), and for how long in all */
  shown: unknown[]
  totalMs: number
  /** The group marked on it */
  group: { label: string; layout: string; color: string } | null
  /** Someone in it is marked (one person), or it has a group or its own format (two or more) */
  set: boolean
  /** Its format, each of its stretches exactly one section (Auto format): the layout, 'mixed' when they differ; null: not */
  formatted?: string | null
}

export interface AnglesView {
  /** none: never looked for (Detect subjects starts it); scanning: the worker is looking for them;
   *  unavailable: this worker can't yet (the buttons alone are shown) */
  status: 'loading' | 'none' | 'scanning' | 'done' | 'failed' | 'unavailable'
  progress: number
  error: string | null
  items: AngleItem[]
  /** The angle at the playhead (its place in items) */
  now: number | null
  /** Found before the clip's start or end moved out: the new part isn't in the list */
  stale?: boolean
}

interface Props {
  angles: AnglesView
  /** Go to an angle (the playhead moves to a moment that shows it) */
  onOpenAngle: (index: number) => void
  /** Mark the person whose face this is, in that angle */
  onMarkFace: (index: number, face: number) => void
  /** The face being marked right now (saving): it shows so until it turns into their letter */
  savingFace?: { index: number; face: number } | null
  /** Mark someone by a click on the video (a face the list doesn't show) */
  onClickMark: () => void
  /** Look for the people and scenes (Detect subjects, Detect again, Try again) — only when pressed */
  onScanAngles: () => void
  subjects: SubjectItem[]
  loading: boolean
  error: string | null
  marking: boolean
  onToggleMarking: () => void
  /** Mark the shot on screen, with its format and views, as a group subject */
  onMarkShot: () => void
  /** Everyone and every group is marked: look for them through the whole clip, then lay it out */
  onMarkInClip: () => void
  /** The ones followed need following again (the clip changed since): Follow them again does it */
  retrack: boolean
  /** Auto format: detects if needed, then every scene not formatted yet gets its format and views, everyone is marked, Follow starts */
  onAutoFormat: () => void
  /** Where Auto format is: waiting for its scan, or laying the formats out */
  autoPhase: 'idle' | 'detecting' | 'formatting'
  /** How Auto format lays the scenes: 'vertical' — every scene Vertical, on whoever talks; 'cuts' — the Rulebook's formats, everyone in */
  autoMode: 'vertical' | 'cuts'
  onAutoMode: (mode: 'vertical' | 'cuts') => void
  /** Stop whatever runs: Auto format, the scan, the following */
  onStop: () => void
  onRemove: (id: string) => void
  onRename: (id: string, label: string) => void
  /** The video the faces are cut from (for the pictures on the cards) */
  videoUrl: string | null
  showOnVideo: boolean
  onShowOnVideo: (on: boolean) => void
  /** What the last framing did ("The view switches between A and B…") or why it couldn't */
  notice: string | null
}

const muted = 'rgb(var(--ed-fg) / 0.5)'
const LAYOUT_NAMES: Record<string, string> = { vertical: 'Vertical', split: 'Split', trio: 'Trio', spotlight: 'Spotlight', centered: 'Centered', horizontal: 'Horizontal' }
/** 75 000 → "1:15" */
const clock = (ms: number) => { const s = Math.max(1, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export function SubjectsPanel(p: Props) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [groupOpen, setGroupOpen] = useState(false)
  // Mark as group just pressed: it says so for a moment (✓ Marked), so the press is seen
  const [marked, setMarked] = useState(false)
  useEffect(() => { if (!marked) return; const id = setTimeout(() => setMarked(false), 1400); return () => clearTimeout(id) }, [marked])
  const busy = p.subjects.some(s => s.status === 'queued' || s.status === 'running')
  /** Marked but not looked for yet (or the last try failed): Follow takes them */
  const waiting = p.subjects.filter(s => s.status === 'new' || s.status === 'failed').length
  const tracked = p.subjects.filter(s => s.status === 'done')
  // The angles with people are the ones to go through; with none found the buttons alone do the marking
  const withPeople = p.angles.items.filter(a => a.people > 0)
  const listed = p.angles.status === 'done' && withPeople.length > 0
  const set = withPeople.filter(a => a.set).length
  // The scene shown: the one at the playhead, else the first one not set yet
  const atPlayhead = p.angles.now !== null ? p.angles.items[p.angles.now] : undefined
  const cur = atPlayhead && atPlayhead.people > 0 ? atPlayhead : (withPeople.find(a => !a.set) ?? withPeople[0])
  const curAt = cur ? p.angles.items.indexOf(cur) : -1
  const curNo = cur ? withPeople.indexOf(cur) + 1 : 0
  const scanPct = Math.max(5, p.angles.progress)
  const canFollow = !busy && (waiting > 0 || p.retrack)
  const scanning = p.angles.status === 'scanning'
  const detected = p.angles.status === 'done'
  /** Something runs (a scan, Auto format, the following): Stop shows, Detect and Auto format wait */
  const working = scanning || busy || p.autoPhase !== 'idle'
  // Detect again is the next thing to do: the clip grew past what was found
  const detectHot = detected && !!p.angles.stale && !working
  const canAct = p.angles.status !== 'loading' && p.angles.status !== 'unavailable'
  // The press shows at once (user, 2026-10-31: Detect and Stop took 4–7 s to change, so it looked like
  // nothing happened): the pressed button turns to "Starting…" / "Stopping…" with a running bar until the
  // worker's answer arrives — the scan or Auto format under way, or everything stopped — at most 30 s
  const [pending, setPending] = useState<'auto' | 'detect' | 'stop' | null>(null)
  const [pendingSince, setPendingSince] = useState(0)
  function press(which: 'auto' | 'detect' | 'stop', run: () => void) {
    setPending(which); setPendingSince(Date.now()); run()
  }
  useEffect(() => {
    if (pending === 'stop' ? !working : pending === 'detect' ? scanning || p.angles.status === 'failed' : pending === 'auto' && p.autoPhase !== 'idle') setPending(null)
  }, [pending, working, scanning, p.angles.status, p.autoPhase])
  useEffect(() => { if (!pending) return; const id = setTimeout(() => setPending(null), 30_000); return () => clearTimeout(id) }, [pending])
  // (after a few seconds, a line says it's on its way, so a slow answer doesn't look like a dead button)
  const [slowPress, setSlowPress] = useState(false)
  useEffect(() => {
    setSlowPress(false)
    if (!pending) return
    const id = setTimeout(() => setSlowPress(true), Math.max(0, pendingSince + 3000 - Date.now()))
    return () => clearTimeout(id)
  }, [pending, pendingSince])
  const spinner = (dark: boolean) => (
    <span className="w-3.5 h-3.5 shrink-0 rounded-full animate-spin motion-reduce:animate-none" aria-hidden="true"
      style={dark ? { border: '2px solid rgba(0,0,0,0.25)', borderTopColor: '#000' } : { border: '2px solid rgb(var(--ed-fg) / 0.2)', borderTopColor: 'currentColor' }} />
  )
  // Following them (user, 2026-10-24: "add a processing bar so we understand it is going on"): how far
  // the ones being followed are, and — while none has started — how long they have waited for the worker
  const following = p.subjects.filter(s => s.status === 'queued' || s.status === 'running')
  const started = following.some(s => s.status === 'running')
  const followPct = following.length ? Math.round(following.reduce((n, s) => n + (s.status === 'running' ? Math.max(5, s.progress) : 0), 0) / following.length) : 0
  const followPeople = following.filter(s => !s.group).length, followGroups = following.length - followPeople
  const [waitSince, setWaitSince] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const waitingToStart = following.length > 0 && !started
  useEffect(() => {
    if (!waitingToStart) { setWaitSince(null); return }
    setWaitSince(t => t ?? Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [waitingToStart])
  const waitedMs = waitSince ? Math.max(0, now - waitSince) : 0
  const skeleton = (
    <div className="flex gap-3" aria-hidden="true">
      {[0, 1, 2].map(i => <span key={i} className="w-14 h-14 rounded-full animate-pulse motion-reduce:animate-none" style={{ background: 'rgb(var(--ed-fg) / 0.07)' }} />)}
    </div>
  )
  /** A small section title ("Marked · 3") */
  const heading = (text: string) => <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'rgb(var(--ed-fg) / 0.42)' }}>{text}</span>
  const groupIcon = (size: number) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M2.5 20a5.5 5.5 0 0111 0M10.5 20a5.5 5.5 0 0111 0" />
    </svg>
  )

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 flex flex-col gap-4 p-4">
        {/* Title, and how many scenes are set */}
        <div className="flex items-center gap-2">
          <h3 className="flex-1 min-w-0 text-[15px] font-bold text-[var(--ed-text)]">Who is in this clip?</h3>
          {listed && (
            <span className="shrink-0 h-6 px-2 flex items-center rounded-full text-[11px] font-semibold tabular-nums"
              title={`${set} of ${withPeople.length} scenes have their person or group`}
              style={set === withPeople.length
                ? { background: 'rgba(200,255,0,0.14)', color: 'var(--ed-accent-text)' }
                : { background: 'rgb(var(--ed-fg) / 0.07)', color: 'rgb(var(--ed-fg) / 0.7)' }}>
              {set}/{withPeople.length} set
            </span>
          )}
        </div>

        {/* Two buttons, ever (user, 2026-10-31: "do we need two different buttons to show detecting and to stop —
            keep them in a single button"): Auto format on the left, Detect on the right. The one that runs turns
            into its own Stop — its progress fills it, a ■ on its right, and pointed at it reads "Stop" in red;
            the other dims. A following started anywhere else is stopped on Auto format's button */}
        {canAct && (() => {
          const detectRuns = scanning || pending === 'detect'
          const autoRuns = !detectRuns && (p.autoPhase !== 'idle' || pending === 'auto' || busy)
          const stopping = pending === 'stop'
          const autoPct = p.autoPhase === 'detecting' ? scanPct : p.autoPhase === 'idle' && busy && started ? followPct : null
          const autoLabel = p.autoPhase === 'formatting' ? 'Formatting…' : p.autoPhase === 'detecting' ? 'Detecting…' : p.autoPhase === 'idle' && busy ? 'Following…' : 'Auto format…'
          const stopIcon = <svg width="9" height="9" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" /></svg>
          /** The inside of a running button: what it does (and how far), or — pointed at — Stop */
          // `accent`: the loading circle and the % in the palette colour (Detect — user, 2026-10-31)
          const running = (label: string, pct: number | null, dark: boolean, accent?: string) => stopping
            ? <>{spinner(dark)}<span className="truncate">Stopping…</span></>
            : <>
                <span className="ed-run-label relative flex items-center gap-2 min-w-0">
                  {accent
                    ? <span className="w-3.5 h-3.5 shrink-0 rounded-full animate-spin motion-reduce:animate-none" aria-hidden="true" style={{ border: '2px solid rgba(200,255,0,0.22)', borderTopColor: accent }} />
                    : spinner(dark)}
                  <span className="truncate">{label}</span>
                  {pct !== null && <span className="tabular-nums" style={accent ? { color: accent } : { opacity: 0.7 }}>{pct}%</span>}
                </span>
                <span className="ed-run-stop relative items-center gap-1.5">{stopIcon}<span>Stop</span></span>
                <span className="ed-run-mark relative ml-auto shrink-0 w-5 h-5 rounded-md flex items-center justify-center"
                  style={{ background: dark ? 'rgba(0,0,0,0.14)' : 'rgb(var(--ed-fg) / 0.1)' }}>{stopIcon}</span>
              </>
          return (
            <div className="flex items-stretch gap-2">
              {autoRuns ? (
                <button type="button" onClick={() => press('stop', p.onStop)} disabled={stopping} aria-busy="true"
                  aria-label={`${autoLabel}${autoPct !== null ? ` ${autoPct}%` : ''} — press to stop`}
                  title={busy && p.autoPhase === 'idle' ? 'Stop following (the people stay marked, ready to follow again)' : 'Stop Auto format (formats already laid stay — Undo takes them back)'}
                  className="ed-tap ed-runbtn ed-autobtn ed-autobtn-go relative overflow-hidden flex-1 min-w-0 h-11 px-3 flex items-center justify-center gap-2 rounded-xl text-[12.5px] font-bold disabled:cursor-default"
                  data-running data-tone="lime" style={{ color: 'var(--ed-text)' }}>
                  {autoPct !== null && <span aria-hidden="true" className="absolute inset-y-0 left-0 transition-[width] duration-500" style={{ width: `${autoPct}%`, background: 'rgba(200,255,0,0.14)' }} />}
                  {running(autoLabel, autoPct, false, 'var(--ed-accent-text)')}
                </button>
              ) : (
                <button type="button" onClick={() => press('auto', p.onAutoFormat)} disabled={detectRuns || !!pending}
                  title={p.autoMode === 'vertical'
                    ? 'Detects the scenes if needed, then makes every scene Vertical on whoever is talking — the view cuts to each speaker — marks everyone and follows them. Scenes you formatted yourself stay as they are.'
                    : 'Detects the scenes if needed, then gives every scene its format from who is in it and where they sit (Vertical, Split, Trio, or the whole picture — nobody left out), marks everyone and follows them. Scenes you formatted yourself stay as they are.'}
                  className={`ed-tap flex-1 min-w-0 h-11 flex items-center justify-center gap-2 rounded-xl text-[12.5px] font-bold disabled:cursor-default ${detectRuns ? '' : 'ed-autobtn'}`}
                  style={detectRuns
                    ? { background: 'rgb(var(--ed-fg) / 0.06)', color: 'rgb(var(--ed-fg) / 0.4)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.08)' }
                    : { color: 'var(--ed-accent-text)' }}>
                  <svg className="ed-autobtn-spark" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>
                  <span className="truncate">Auto format</span>
                </button>
              )}
              {detectRuns ? (
                <button type="button" onClick={() => press('stop', p.onStop)} disabled={stopping} aria-busy="true"
                  aria-label={`Detecting ${scanPct}% — press to stop`} title="Stop detecting (the scenes found before stay)"
                  className="ed-tap ed-runbtn relative overflow-hidden flex-1 min-w-0 h-11 px-3 flex items-center justify-center gap-2 rounded-xl text-[12.5px] font-bold disabled:cursor-default"
                  data-running data-tone="dark"
                  // (white text; the palette colour on its border, loading circle and % — user, 2026-10-31)
                  style={{ background: 'rgb(var(--ed-fg) / 0.07)', color: 'var(--ed-text)', boxShadow: 'inset 0 0 0 1.5px rgba(200,255,0,0.5)' }}>
                  <span aria-hidden="true" className="absolute inset-y-0 left-0 transition-[width] duration-500" style={{ width: `${scanPct}%`, background: 'rgb(var(--ed-fg) / 0.07)' }} />
                  {running('Detecting', scanPct, false, 'var(--ed-accent-text)')}
                </button>
              ) : (
                <button type="button" onClick={() => press('detect', p.onScanAngles)} disabled={autoRuns || !!pending}
                  title={detected ? 'Look for the scenes and people again (someone missed, a scene wrong, or the clip changed). The people you marked stay marked.' : 'Find the scenes, people and groups in this clip. Nothing is formatted.'}
                  className="ed-tap flex-1 min-w-0 h-11 flex items-center justify-center gap-2 rounded-xl text-[12.5px] font-bold transition-colors hover:bg-[rgb(var(--ed-fg)/0.12)] disabled:cursor-default"
                  style={detectHot
                    ? { background: 'rgba(200,255,0,0.14)', color: 'var(--ed-accent-text)', boxShadow: 'inset 0 0 0 1.5px rgba(200,255,0,0.55)' }
                    : { background: 'rgb(var(--ed-fg) / 0.07)', color: 'var(--ed-text)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)', opacity: autoRuns ? 0.45 : 1 }}>
                  {detected
                    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 11-2.64-6.36" /><path d="M21 4v5h-5" /></svg>
                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0" /><circle cx="18" cy="15" r="3" /><path d="M20.2 17.2L22 19" /></svg>}
                  <span className="truncate">{detected ? 'Detect again' : 'Detect'}</span>
                </button>
              )}
            </div>
          )
        })()}
        {/* A slow answer: a line saying it's on its way (the buttons themselves show the work) */}
        {canAct && slowPress && (pending === 'auto' || pending === 'stop') && (
          <p className="-mt-2 text-[11px]" role="status" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
            {pending === 'stop' ? 'Stopping… this can take a few seconds.' : 'Starting… the worker is getting it ready, this can take a few seconds.'}
          </p>
        )}
        {/* How Auto format lays the scenes (user, 2026-10-28): Vertical — the speaker first; Cuts — the Rulebook's formats.
            (2026-10-31: "highlight it properly") a soft lime pill slides under the one chosen, each with its icon */}
        {canAct && (
          <div className="-mt-2 flex items-center gap-2.5">
            <span className="text-[11.5px] font-medium whitespace-nowrap" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>Auto format as</span>
            <div role="radiogroup" aria-label="Auto format as" className="sp-mode" data-mode={p.autoMode} data-off={working || undefined}>
              <span className="sp-mode-pill" aria-hidden="true" />
              {(['vertical', 'cuts'] as const).map(m => (
                <button key={m} type="button" role="radio" aria-checked={p.autoMode === m} disabled={working} onClick={() => p.onAutoMode(m)}
                  title={m === 'vertical'
                    ? 'Every scene Vertical, on whoever is talking: the view cuts to each speaker, at least 2 seconds on each. Listeners can be out of the picture.'
                    : 'Each scene gets its format from who is in it (Vertical, Split, Trio, or the whole picture), with everyone kept in.'}
                  className="sp-mode-opt" data-on={p.autoMode === m || undefined}>
                  {m === 'vertical'
                    ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>
                    : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.6" /><circle cx="6" cy="18" r="2.6" /><path d="M8.2 7.6L20 18M8.2 16.4L20 6" /></svg>}
                  {m === 'vertical' ? 'Vertical' : 'Cuts'}
                </button>
              ))}
            </div>
          </div>
        )}
        {p.angles.status === 'done' && p.angles.stale && !working && (
          <p className="-mt-2 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.75)' }}>The clip got longer — Detect again to look in the new part too.</p>
        )}
        {/* (shown from the press itself: one loading, not "Starting…" and then "Detecting…" — user, 2026-10-31) */}
        {(scanning || pending === 'detect') && (
          <div className="flex flex-col gap-3" role="status" aria-label={`Looking for people ${scanPct}%`}>
            <div className="flex items-center gap-2.5">
              <span className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgb(var(--ed-fg) / 0.08)' }}>
                <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${scanPct}%`, background: '#c8ff00' }} />
              </span>
              <span className="text-[11px] tabular-nums" style={{ color: muted }}>{scanPct}%</span>
            </div>
            {skeleton}
          </div>
        )}
        {p.angles.status === 'failed' && (
          <p className="text-[11.5px]" style={{ color: muted }}>{p.angles.error ?? 'The people could not be found.'} Press Detect to try again.</p>
        )}
        {p.angles.status === 'done' && !listed && (
          <p className="text-[11.5px]" style={{ color: muted }}>No one was found in this clip.</p>
        )}

        {/* The scenes, and the one at the playhead */}
        {listed && cur && (
          <div className="flex flex-col gap-2.5">
            {withPeople.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar" role="group" aria-label="Scenes">
                {withPeople.map((a, n) => (
                  <SceneThumb key={n} angle={a} no={n + 1} current={a === cur} videoUrl={p.videoUrl} onOpen={() => p.onOpenAngle(p.angles.items.indexOf(a))} />
                ))}
              </div>
            )}
            {heading(`Scene ${curNo} · ${cur.people === 1 ? '1 person' : `${cur.people} people`}`)}
            <div className="flex flex-col gap-3.5 rounded-2xl px-4 py-5"
              style={{ background: 'rgb(var(--ed-fg) / 0.035)', boxShadow: cur.set ? 'inset 0 0 0 1.5px rgba(200,255,0,0.45)' : 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.07)' }}>
              {cur.people >= 2 ? (
                // Several people together are one group: one card, one button (the layout and views are the ones on screen)
                <>
                  {/* (user, 2026-10-31) the more faces, the smaller each one (6 at most, then "+N"), the count on one line,
                      and Mark as group on a line of its own when the card has no room beside them — nothing cut off */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
                    <div className="flex items-center shrink-0">
                      {cur.faces.slice(0, MAX_FACE_DOTS).map((f, k) => <FaceDot key={`${curAt}-${k}`} videoUrl={p.videoUrl} at={cur.at} box={f.box} first={k === 0} size={faceDotSize(cur.faces.length)} />)}
                      {cur.faces.length > MAX_FACE_DOTS && (
                        <span className="rounded-full shrink-0 flex items-center justify-center text-[10.5px] font-bold tabular-nums"
                          style={{ width: faceDotSize(cur.faces.length), height: faceDotSize(cur.faces.length), marginLeft: -Math.round(faceDotSize(cur.faces.length) * 0.28),
                            color: 'var(--ed-text)', background: 'rgb(var(--ed-fg) / 0.12)', boxShadow: '0 0 0 2px #111112' }}>
                          +{cur.faces.length - MAX_FACE_DOTS}
                        </span>
                      )}
                    </div>
                    <span className="text-[14.5px] font-semibold text-[var(--ed-text)] whitespace-nowrap">{cur.people} angles</span>
                    {/* Mark as group: small, at the card's top right (user, 2026-10-30) */}
                    {!cur.group && (
                      <button type="button" onClick={() => { p.onMarkShot(); setMarked(true) }} data-marked={marked || undefined}
                        title="Set this scene's layout and views first (say Split), then mark it. Every time the clip shows this shot again, it gets the same."
                        className="sp-mark ml-auto shrink-0 h-8 px-3 flex items-center gap-1.5 rounded-lg text-[12px] font-bold whitespace-nowrap transition-colors hover:bg-[rgb(var(--ed-fg)/0.12)] active:scale-95"
                        // (neutral either way — user, 2026-10-31: less of the palette colour)
                        style={{ background: 'rgb(var(--ed-fg) / 0.06)', color: 'var(--ed-text)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)' }}>
                        {marked
                          ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="sp-mark-tick"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>Marked</>
                          : <>{groupIcon(13)}Mark as group</>}
                      </button>
                    )}
                  </div>
                  {cur.group ? (
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: 'var(--ed-accent-text)' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                      {cur.group.label} · {LAYOUT_NAMES[cur.group.layout] ?? cur.group.layout}
                    </span>
                  ) : (
                    <>
                      {/* Formatted (Auto format, place by place: the speaker can change which view is whose) */}
                      {cur.formatted && (
                        <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: 'var(--ed-accent-text)' }}
                          title={cur.formatted === 'mixed' ? 'Each time this shot comes back it has its own format — who talks decides who is where' : undefined}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                          Formatted · {cur.formatted === 'mixed' ? 'by who talks' : LAYOUT_NAMES[cur.formatted] ?? cur.formatted}
                        </span>
                      )}
                    </>
                  )}
                </>
              ) : (
                <div className="flex flex-wrap gap-4">
                  {cur.faces.map((f, k) => <AngleFace key={`${curAt}-${k}`} videoUrl={p.videoUrl} at={cur.at} face={f} onMark={() => p.onMarkFace(curAt, k)}
                    saving={p.savingFace?.index === curAt && p.savingFace.face === k} />)}
                  <AddFace marking={p.marking} onClick={p.onClickMark} />
                </div>
              )}
            </div>
          </div>
        )}
        {/* (the "Or mark the person in the 9:16 view" link is gone — user, 2026-10-31; marking stays on the
            scene's + tile, and while it's on the line says how to use it) */}
        {p.marking && (
          <p className="text-[11.5px]" style={{ color: 'rgb(var(--ed-fg) / 0.75)' }}>Click a person on the video… (Esc to stop)</p>
        )}

        {p.error && <p role="alert" className="text-xs" style={{ color: '#f87171' }}>{p.error}</p>}

        {/* The people and groups marked */}
        {p.loading && !p.subjects.length ? (
          <p className="text-xs" style={{ color: muted }}>Loading…</p>
        ) : p.subjects.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between h-6">
              {heading(`Marked · ${p.subjects.length}`)}
              {tracked.length > 0 && (
                <button type="button" onClick={() => p.onShowOnVideo(!p.showOnVideo)} aria-pressed={p.showOnVideo}
                  aria-label="Show them on the video" title={p.showOnVideo ? 'Hide them on the video' : 'Show them on the video'}
                  className="w-6 h-6 flex items-center justify-center rounded transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
                  style={{ color: p.showOnVideo ? 'var(--ed-accent-text)' : muted }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {p.showOnVideo
                      ? <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>
                      : <><path d="M3 3l18 18" /><path d="M10.6 5.1A10.4 10.4 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-2.9 3.9M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.5 4.5-1.2" /></>}
                  </svg>
                </button>
              )}
            </div>
            {p.subjects.map(s => (
              <div key={s.id} className="group flex items-center gap-2.5 rounded-lg pl-2 pr-1.5 py-1.5 transition-colors hover:bg-[rgb(var(--ed-fg)/0.04)]">
                <Avatar subject={s} videoUrl={p.videoUrl} />
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {renaming === s.id ? (
                      <input autoFocus value={name} maxLength={24} onChange={e => setName(e.target.value)}
                        onBlur={() => { if (name.trim() && name.trim() !== s.label) p.onRename(s.id, name.trim()); setRenaming(null) }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null) }}
                        className="flex-1 min-w-0 h-6 px-1.5 rounded text-[13px] outline-none text-[var(--ed-text)]"
                        style={{ background: 'rgb(var(--ed-fg) / 0.08)' }} aria-label="Subject name" />
                    ) : (
                      <button type="button" onClick={() => { setRenaming(s.id); setName(s.label) }} title="Rename"
                        className="min-w-0 truncate text-left text-[13px] font-semibold text-[var(--ed-text)]">{s.label}</button>
                    )}
                    {s.group && <span className="shrink-0" title="Group" style={{ color: muted }}>{groupIcon(12)}</span>}
                  </div>
                  <span className="truncate text-[11px]" title={s.status === 'failed' ? s.error ?? undefined : undefined}
                    style={{ color: s.status === 'failed' ? '#f87171' : muted }}>
                    {s.status === 'new' && 'Ready'}
                    {s.status === 'queued' && 'Getting ready…'}
                    {s.status === 'running' && `${s.group ? 'Finding this shot' : 'Following'}… ${Math.max(5, s.progress)}%`}
                    {s.status === 'failed' && (s.error ?? (s.group ? 'Shot not found — remove and mark again' : 'Not found — remove and mark again'))}
                    {s.status === 'done' && (s.group
                      ? `${LAYOUT_NAMES[s.group.layout] ?? s.group.layout} · ${s.group.places === 0 ? 'not in this clip' : s.group.places === 1 ? 'once' : `${s.group.places} places`}`
                      : s.seen === null ? 'Ready' : s.seen < 0.02 ? 'Not seen in this clip' : `Seen in ${Math.round(s.seen * 100)}%`)}
                  </span>
                  {s.status === 'running' && (
                    <span className="h-0.5 rounded-full overflow-hidden" style={{ background: 'rgb(var(--ed-fg) / 0.08)' }}>
                      <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(5, s.progress)}%`, background: 'rgb(var(--ed-fg) / 0.7)' }} />
                    </span>
                  )}
                </div>
                <button type="button" onClick={() => p.onRemove(s.id)} aria-label={`Remove ${s.label}`} title="Remove (the view keeps the framing it has now)"
                  className="shrink-0 w-6 h-6 flex items-center justify-center rounded opacity-50 transition group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[rgba(239,68,68,0.12)] hover:text-[#f87171]" style={{ color: muted }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* A group shot when no scenes were listed (with scenes, each group scene's card does this) */}
        {!listed && p.angles.status !== 'none' && p.angles.status !== 'scanning' && p.angles.status !== 'loading' && (
          <div className="flex flex-col rounded-xl" style={{ background: 'rgb(var(--ed-fg) / 0.035)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.06)' }}>
            <button type="button" onClick={() => setGroupOpen(o => !o)} aria-expanded={groupOpen} className="flex items-center gap-2 px-3 py-2.5 text-left">
              <span className="text-[12.5px] font-semibold text-[var(--ed-text)]">Group shot</span>
              <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>optional</span>
              <svg className="ml-auto shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                style={{ color: muted, transform: groupOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {groupOpen && (
              <div className="px-3 pb-3">
                <button type="button" onClick={p.onMarkShot}
                  title="Set the format and place the views first (say Split), then mark it. Every time the clip shows this shot again, it gets the same."
                  className="w-full h-9 flex items-center justify-center gap-2 rounded-lg text-[12.5px] font-semibold transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
                  style={{ background: 'rgb(var(--ed-fg) / 0.06)', color: 'var(--ed-text)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }}>
                  {groupIcon(15)}
                  Mark this shot as a group
                </button>
              </div>
            )}
          </div>
        )}

        {p.notice && <p role="status" className="text-[11.5px]" style={{ color: 'rgb(var(--ed-fg) / 0.75)' }}>{p.notice}</p>}
      </div>

      {/* Follow them: always in reach at the bottom of the panel, once someone is marked */}
      {p.subjects.length > 0 && <div className="sticky bottom-0 flex flex-col gap-1.5 px-4 pt-3 pb-4" style={{ background: 'var(--ed-panel)', borderTop: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
        {busy && (
          <div className="flex flex-col gap-1.5 pb-1" role="status" aria-live="polite">
            <div className="flex items-center justify-between gap-2 text-[11.5px]">
              <span className="font-semibold text-[var(--ed-text)]">
                {started
                  ? `Following ${followPeople ? `${followPeople} ${followPeople === 1 ? 'person' : 'people'}` : ''}${followPeople && followGroups ? ' and ' : ''}${followGroups ? `${followGroups} ${followGroups === 1 ? 'group' : 'groups'}` : ''}…`
                  : 'Waiting to start…'}
              </span>
              <span className="tabular-nums" style={{ color: muted }}>{started ? `${followPct}%` : clock(waitedMs)}</span>
            </div>
            <span className="relative block h-1.5 rounded-full overflow-hidden" style={{ background: 'rgb(var(--ed-fg) / 0.08)' }}>
              {started
                ? <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${followPct}%`, background: '#c8ff00' }} />
                // (not started: a light sliding across — it is waiting, not stuck at 0%)
                : <span className="absolute top-0 bottom-0 w-[30%] rounded-full animate-[ai-scan_1.4s_ease-in-out_infinite] motion-reduce:animate-none" style={{ left: '-30%', background: 'linear-gradient(90deg, transparent, #c8ff00, transparent)' }} />}
            </span>
            <span className="text-[11px]" style={{ color: !started && waitedMs > 60_000 ? '#fbbf24' : muted }}>
              {!started && waitedMs > 60_000
                ? 'The worker hasn’t picked this up yet — it starts as soon as one is free.'
                : 'Runs in the background — keep editing. The view changes when it’s done.'}
            </span>
          </div>
        )}
        {!busy && p.retrack && waiting === 0 && <p className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.75)' }}>The clip changed since they were followed.</p>}
        <button type="button" onClick={p.onMarkInClip} disabled={!canFollow}
          className="h-10 flex items-center justify-center gap-2 rounded-lg text-[13px] font-bold transition-opacity disabled:opacity-50"
          style={canFollow ? { background: '#c8ff00', color: '#000' } : { background: 'rgb(var(--ed-fg) / 0.07)', color: 'rgb(var(--ed-fg) / 0.6)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          {waiting > 0 ? `Follow them in the clip (${waiting})` : p.retrack ? 'Follow them again' : 'Follow them in the clip'}
        </button>
      </div>}
    </div>
  )
}

/** One scene (camera angle) in the strip: its picture, ringed in lime when it is the one shown, ticked when set */
function SceneThumb({ angle: a, no, current, videoUrl, onOpen }: { angle: AngleItem; no: number; current: boolean; videoUrl: string | null; onOpen: () => void }) {
  // useFrameAt reads a little after the moment it is given
  const picture = useFrameAt(videoUrl, Math.max(0, a.at - 600))
  return (
    <button type="button" onClick={onOpen} aria-pressed={current} aria-label={`Scene ${no}, ${a.people === 1 ? '1 person' : `${a.people} people`}${a.set ? ', done' : ''}`}
      className={`relative shrink-0 w-[72px] h-[41px] rounded-lg overflow-hidden transition-opacity ${current ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
      style={{ background: 'rgb(var(--ed-fg) / 0.08)' }}>
      {picture
        // eslint-disable-next-line @next/next/no-img-element
        && <img src={picture} alt="" className="w-full h-full object-cover" />}
      {/* (the ring over the picture) */}
      <span className="absolute inset-0 rounded-lg pointer-events-none" style={{ boxShadow: current ? 'inset 0 0 0 2px rgba(200,255,0,0.5)' : 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.14)' }} />
      <span className="absolute left-1 top-1 min-w-[15px] h-[15px] px-1 rounded text-[9.5px] font-bold leading-[15px] text-center" style={{ background: 'rgba(0,0,0,0.7)', color: '#fff' }}>{no}</span>
      {a.set && (
        <span className="absolute right-1 bottom-1 w-[15px] h-[15px] rounded-full flex items-center justify-center" style={{ background: '#c8ff00' }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
      )}
    </button>
  )
}

/** One face of a group card: a small round picture, overlapping the one before it */
/** A group's faces: at most this many shown, then "+N" */
const MAX_FACE_DOTS = 6
/** A group's face size by how many there are: big for two, smaller step by step, so the card has room */
function faceDotSize(n: number) { return n <= 2 ? 40 : n === 3 ? 34 : n === 4 ? 30 : n <= 6 ? 26 : 22 }

function FaceDot({ videoUrl, at, box: b, first, size = 40 }: { videoUrl: string | null; at: number; box: AngleItem['faces'][number]['box']; first: boolean; size?: number }) {
  // A little room around the face
  const x = Math.max(0, b.x - b.w * 0.25), y = Math.max(0, b.y - b.h * 0.3)
  const url = useFaceAt(videoUrl, at, { x, y, w: Math.min(1 - x, b.w * 1.5), h: Math.min(1 - y, b.h * 1.5) })
  return (
    <span className="rounded-full overflow-hidden shrink-0" aria-hidden="true"
      style={{ width: size, height: size, marginLeft: first ? 0 : -Math.round(size * 0.28), background: 'rgb(var(--ed-fg) / 0.1)', boxShadow: '0 0 0 2px #111112' }}>
      {url
        // eslint-disable-next-line @next/next/no-img-element
        && <img src={url} alt="" className="w-full h-full object-cover" />}
    </span>
  )
}

/** A face of an angle: marked — in that person's colour, with their name; not yet — a click marks them */
function AngleFace({ videoUrl, at, face: f, onMark, saving }: { videoUrl: string | null; at: number; face: AngleItem['faces'][number]; onMark: () => void; saving?: boolean }) {
  // A little room around the face
  const b = f.box
  const x = Math.max(0, b.x - b.w * 0.25), y = Math.max(0, b.y - b.h * 0.3)
  const box = { x, y, w: Math.min(1 - x, b.w * 1.5), h: Math.min(1 - y, b.h * 1.5) }
  const url = useFaceAt(videoUrl, at, box)
  const picture = (
    <span className="relative w-14 h-14 rounded-full overflow-hidden flex items-center justify-center text-[17px] font-bold"
      // (marked: a plain soft-white ring, not the person's colour — user, 2026-10-31: "keep the colour simple")
      style={f.subject
        ? { background: 'rgb(var(--ed-fg) / 0.1)', color: 'var(--ed-text)', boxShadow: '0 0 0 2px rgb(var(--ed-fg) / 0.55), 0 0 0 4.5px rgb(var(--ed-fg) / 0.06)' }
        : { background: 'rgb(var(--ed-fg) / 0.08)', color: muted, boxShadow: '0 0 0 1.5px rgb(var(--ed-fg) / 0.22)' }}>
      {url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt="" className="w-full h-full object-cover" />
        : f.subject ? f.subject.label.slice(0, 1).toUpperCase() : '+'}
    </span>
  )
  if (f.subject) {
    return (
      <span className="flex flex-col items-center gap-1.5 w-14" aria-busy={f.pending}
        title={f.pending ? `${f.subject.label} is marked — looking for them in the clip` : f.added ? `${f.subject.label} is marked (added by you)` : `${f.subject.label} is marked`}>
        <span className="relative rounded-full">
          {picture}
          {/* Added by hand, being looked for: a ring turning round them (user, 2026-10-29: + Add showed nothing) */}
          {f.pending && <span className="absolute -inset-[3px] rounded-full animate-spin motion-reduce:animate-none" style={{ border: '2.5px solid rgb(var(--ed-fg) / 0.14)', borderTopColor: 'rgb(var(--ed-fg) / 0.85)' }} />}
        </span>
        {/* (the name in white; their colour only as a small dot — it matches their box on the video) */}
        <span className="max-w-full flex items-center gap-1 text-[11px] font-bold" style={{ color: 'var(--ed-text)' }}>
          {!f.pending && <i className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: f.subject.color }} aria-hidden="true" />}
          <span className="truncate">{f.pending ? 'Finding…' : f.subject.label}</span>
        </span>
      </span>
    )
  }
  return (
    <button type="button" onClick={onMark} disabled={saving} aria-busy={saving} title={saving ? 'Marking…' : 'Mark this person'} className="group/face flex flex-col items-center gap-1.5 w-14">
      <span className="relative rounded-full transition-shadow group-hover/face:shadow-[0_0_0_3px_rgba(200,255,0,0.3)]">
        {picture}
        {/* Being saved: a soft white ring turning round the face (not lime — user, 2026-10-31) */}
        {saving && <span className="absolute -inset-[3px] rounded-full animate-spin motion-reduce:animate-none" style={{ border: '2.5px solid rgb(var(--ed-fg) / 0.14)', borderTopColor: 'rgb(var(--ed-fg) / 0.85)' }} />}
      </span>
      {/* (white, not lime — user, 2026-10-31) */}
      <span className="text-[11px] font-semibold" style={{ color: 'var(--ed-text)' }}>{saving ? 'Marking…' : 'Mark'}</span>
    </button>
  )
}

/** Someone the scene's faces don't show: a click here, then a click on them in the video */
function AddFace({ marking, onClick }: { marking: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={marking}
      title={marking ? 'Click the person on the video (Esc to stop)' : 'Someone missing? Click here, then click them on the video'}
      className="group/add flex flex-col items-center gap-1.5 w-14">
      <span className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${marking ? 'animate-pulse motion-reduce:animate-none' : ''}`}
        style={{ border: `1.5px dashed ${marking ? 'rgba(200,255,0,0.5)' : 'rgb(var(--ed-fg) / 0.28)'}`, color: marking ? 'var(--ed-text)' : muted }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </span>
      <span className="text-[11px] font-semibold group-hover/add:text-[var(--ed-text)]" style={{ color: marking ? 'var(--ed-text)' : muted }}>
        {marking ? 'Click video' : 'Add'}
      </span>
    </button>
  )
}

/**
 * The person's face (cut from the video where they were marked) in a plain soft-white ring; their initial until
 * it's ready. Their colour only as a small dot on it (user, 2026-10-31: "keep that colour minimal") — it matches
 * their box on the video
 */
function Avatar({ subject: s, videoUrl }: { subject: SubjectItem; videoUrl: string | null }) {
  const url = useFaceAt(videoUrl, s.face?.ms ?? null, s.face?.box ?? null)
  return (
    <span className="relative shrink-0 w-8 h-8">
      <span className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-[12px] font-bold"
        style={{ background: 'rgb(var(--ed-fg) / 0.1)', color: 'var(--ed-text)', boxShadow: '0 0 0 1.5px rgb(var(--ed-fg) / 0.45)' }}>
        {url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={url} alt={s.label} className="w-full h-full object-cover" />
          : s.label.slice(0, 1).toUpperCase()}
      </span>
      <i className="absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full" aria-hidden="true"
        style={{ background: s.color, boxShadow: '0 0 0 2px var(--ed-panel, #111)' }} />
    </span>
  )
}
