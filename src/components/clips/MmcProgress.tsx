'use client'
/**
 * The Make my clips progress card (user, 2026-11-21): its top in two halves. On the left a loop of what the AI
 * is doing now, in the Guide's style, changing with the worker's step (stepScene); on the right a ring that
 * fills to a full circle with the run's percent. Under them, the step in words, how many clips, and Stop.
 * Sample: claude.ai/artifact/L4p7xmFkcRiwqhX7rgb5r7
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { HintStage } from '@/components/editor/ToolHints'
import { Demo } from '@/app/guide/GuideDemos'
import { Spinner } from '@/components/ui/spinner'
import '@/app/guide/guide.css'
import './mmcProgress.css'

/** The tool loops' stage size (toolHints.css .th-stage) */
const STAGE_W = 216, STAGE_H = 120

export type MmcScene = 'audio' | 'captions' | 'moments' | 'edges' | 'title' | 'scan' | 'frame'

/**
 * Which loop shows, from what the worker says it's doing (ai_edit.ts step texts); an older worker that says
 * nothing: from the percent (its steps' parts of the bar: 5–19 captions, 20–27 moments, 27–30 edges, 30–33
 * the clips' captions, 33–35 titles, 35–45 getting ready / screens, 45–99 framing)
 */
export function stepScene(text: string | null | undefined, percent: number): MmcScene {
  const t = (text ?? '').toLowerCase()
  if (/missed speech|captions for the clip/.test(t)) return 'captions'
  if (/caption/.test(t)) return 'audio'
  if (/best moments/.test(t)) return 'moments'
  if (/starts and ends/.test(t)) return 'edges'
  if (/title|hook/.test(t)) return 'title'
  if (/ready for framing|screens|graphics/.test(t)) return 'scan'
  if (/fram/.test(t)) return 'frame'
  return percent < 20 ? 'audio' : percent < 27 ? 'moments' : percent < 30 ? 'edges' : percent < 33 ? 'captions'
    : percent < 35 ? 'title' : percent < 45 ? 'scan' : 'frame'
}

/** A small picture (sky, sun, a person, the ground), as on the timeline tools' screens */
function Pic() {
  return <div className="th-pic"><i className="th-pic-sun" /><i className="th-pic-ground" /><i className="th-pic-head" /><i className="th-pic-body" /></div>
}

/** The wide video, as the loops draw it */
const WIDE = { left: 31, top: 16, width: 154, height: 88 } as const

function Loop({ scene }: { scene: MmcScene }) {
  switch (scene) {
    // Getting the video's captions: its sound comes off onto its own bar (the Guide's Detach audio)
    case 'audio': return <HintStage id="detach" />
    // Edges: the cuts land on the clip's start and end (the Guide's Split)
    case 'edges': return <HintStage id="split" />
    case 'captions': return <Demo scene="captions" label="Captions" />
    case 'moments': return <Demo scene="askai" label="Finding the best moments" askText="best moments" />
    case 'title':
      return (
        <div className="th-stage mmcv" style={{ ['--th-d' as string]: '3.4s' }} aria-hidden="true">
          <div className="th-loop">
            <span className="gdv-phone" style={{ left: 77, top: 6, width: 62, height: 108 }}>
              <Pic />
              <b className="mmcv-title"><em>WAIT FOR IT</em></b>
            </span>
          </div>
        </div>
      )
    case 'scan':
      return (
        <div className="th-stage mmcv" style={{ ['--th-d' as string]: '2.8s' }} aria-hidden="true">
          <div className="th-loop">
            <div className="th-screen" style={WIDE}>
              <Pic />
              <i className="mmcv-found" style={{ left: 12, top: 30, width: 46, height: 58 }} />
              <i className="mmcv-found" style={{ left: 112, top: 8, width: 32, height: 32, animationDelay: '.5s' }} />
              <i className="mmcv-sweep" />
            </div>
          </div>
        </div>
      )
    case 'frame':
      return (
        <div className="th-stage mmcv" style={{ ['--th-d' as string]: '3.6s' }} aria-hidden="true">
          <div className="th-loop">
            <div className="th-screen" style={WIDE}>
              <Pic />
              <i className="mmcv-frame" />
            </div>
          </div>
        </div>
      )
  }
}

/** The step's loop, scaled to the half it sits in (the stage is a fixed 216 × 120); a new step fades in */
function FitStage({ scene }: { scene: MmcScene }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setScale(el.clientWidth / STAGE_W || 1)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-[9px]" style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}`, background: '#0b0b0d' }}>
      <div className="absolute left-0 top-0" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        <div key={scene} className="mmcv-in" data-mmc-scene={scene}><Loop scene={scene} /></div>
      </div>
    </div>
  )
}

/** The ring: the run's percent as a circle filling up, the number in the middle */
function Ring({ percent, accent }: { percent: number; accent: string }) {
  const R = 50, C = 2 * Math.PI * R
  const p = Math.min(100, Math.max(0, percent))
  return (
    <div className="relative w-full grid place-items-center rounded-[9px]"
      style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}`, background: 'radial-gradient(120% 90% at 50% 0%, #17171b 0%, #0b0b0d 70%)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.07)', containerType: 'inline-size' }}
      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(p)} aria-label="Making your clips">
      <svg viewBox="0 0 120 120" className="h-[82%] aspect-square -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="9" stroke="rgba(255,255,255,0.08)" />
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="9" stroke={accent} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - p / 100)}
          style={{ transition: 'stroke-dashoffset 500ms linear', filter: 'drop-shadow(0 0 5px rgba(200,255,0,0.35))' }} />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-bold tabular-nums" style={{ color: accent, fontSize: 'clamp(14px, 11cqw, 24px)' }}>
        {Math.floor(p)}%
      </span>
    </div>
  )
}

export function MmcProgress({ percent, scene, text, note, accent, stopping, onStop }: {
  percent: number
  /** The loop for the step the run is on (stepScene) */
  scene: MmcScene
  /** What the worker says it's doing */
  text: string
  /** "Making 3 clips", and any word about the wait */
  note: string
  accent: string
  stopping: boolean
  onStop: () => void
}) {
  return (
    <div className="flex flex-col gap-2.5 px-3 py-3 rounded-xl" style={{ background: 'rgba(200,255,0,0.04)', border: '1px solid rgba(200,255,0,0.12)' }}>
      <div className="grid grid-cols-2 gap-2.5">
        <FitStage scene={scene} />
        <Ring percent={percent} accent={accent} />
      </div>
      <p className="text-xs leading-snug" style={{ color: 'rgb(var(--cb-fg) / 0.75)' }} aria-live="polite">{text}</p>
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[11px]" style={{ color: 'rgb(var(--cb-fg) / 0.4)' }}>{note}</p>
        <button type="button" onClick={onStop} disabled={stopping}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors hover:bg-red-500/20 disabled:opacity-50"
          style={{ color: '#fca5a5', border: '1px solid rgba(239,68,68,0.35)' }}>
          {stopping ? <Spinner /> : <span aria-hidden="true" className="w-2 h-2 rounded-[2px]" style={{ background: 'currentColor' }} />}
          {stopping ? 'Stopping…' : 'Stop'}
        </button>
      </div>
    </div>
  )
}
