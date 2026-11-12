'use client'

import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * First-time tour of the editing board: dims the page, spotlights one area at a time and explains
 * it in a card next to it. Areas are found by their `data-tour` attribute. Shows once per browser
 * (remembered in localStorage); the header's "?" button replays it.
 */

export type TourStep = { target: string; title: string; body: string }

export const EDITOR_TOUR: TourStep[] = [
  {
    target: 'formats',
    title: 'Pick a format',
    body: 'Choose how your video fits the vertical frame — one speaker, split screen and more. Drag the box on the video to frame what matters.',
  },
  {
    target: 'timeline',
    title: 'Trim on the timeline',
    body: 'Click anywhere to jump, or click a section to select it. Drag its ends to resize it, or press ✂ Split (S) to cut it in two.',
  },
  {
    target: 'tools',
    title: 'Add captions, text and B-roll',
    body: 'Everything else lives here: auto-captions, text, B-roll and cleanup. Pick a tool and its options open next to it.',
  },
  {
    target: 'export',
    title: 'Export your reel',
    body: 'Check it in the preview on the right, then press Export at the top right. You can keep editing while it renders.',
  },
]

const STORAGE_KEY = 'shortcut.editorTour.v1'
const CARD_W = 320
const GAP = 14
const PAD = 6

export function hasSeenEditorTour(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === 'done' } catch { return true }
}
function markSeen() {
  try { localStorage.setItem(STORAGE_KEY, 'done') } catch { /* private mode: it just shows again next time */ }
}

type Rect = { top: number; left: number; width: number; height: number }

export function EditorTour({ open, onClose, steps = EDITOR_TOUR }: { open: boolean; onClose: () => void; steps?: TourStep[] }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const step = steps[i]

  useEffect(() => { if (open) setI(0) }, [open])

  const finish = useCallback(() => { markSeen(); onClose() }, [onClose])
  const next = useCallback(() => { if (i < steps.length - 1) setI(i + 1); else finish() }, [i, steps.length, finish])
  const back = useCallback(() => setI(v => Math.max(0, v - 1)), [])

  // Measure the spotlighted area now and whenever the window changes
  useLayoutEffect(() => {
    if (!open || !step) return
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
      if (!el) { setRect(null); return }
      const r = el.getBoundingClientRect()
      setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [open, step])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish() }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); next() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); back() }
    }
    // Capture phase so the editor's own shortcuts (Space, arrows) don't fire underneath
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, next, back, finish])

  if (!open || !step || typeof document === 'undefined') return null

  // Card goes below the area if there's room, else above, else beside it; always kept on screen
  const vw = window.innerWidth, vh = window.innerHeight
  let cardTop = vh / 2 - 90, cardLeft = vw / 2 - CARD_W / 2
  if (rect) {
    const below = rect.top + rect.height + GAP
    const above = rect.top - GAP - 190
    if (below + 190 < vh) cardTop = below
    else if (above > 8) cardTop = above
    else cardTop = Math.min(vh - 200, Math.max(8, rect.top))
    cardLeft = rect.left + rect.width / 2 - CARD_W / 2
    // Tall areas (like the tool rail) along a side: put the card next to them
    if (rect.height > vh * 0.6) {
      cardTop = Math.max(8, Math.min(vh - 220, rect.top + 40))
      cardLeft = rect.left + rect.width + GAP > vw - CARD_W - 8 ? rect.left - CARD_W - GAP : rect.left + rect.width + GAP
    }
    cardLeft = Math.max(12, Math.min(vw - CARD_W - 12, cardLeft))
  }

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: 200 }} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      {/* Dim everything except the spotlight (a hole cut with a huge shadow) */}
      {rect ? (
        <div className="absolute pointer-events-none"
          style={{
            top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: 14,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.66), 0 0 0 2px #c8ff00, 0 0 24px 4px rgba(200,255,0,0.35)',
            transition: 'top .35s cubic-bezier(.2,.8,.2,1), left .35s cubic-bezier(.2,.8,.2,1), width .35s cubic-bezier(.2,.8,.2,1), height .35s cubic-bezier(.2,.8,.2,1)',
          }} />
      ) : <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.66)' }} />}
      {/* Clicks outside the card don't reach the editor */}
      <div className="absolute inset-0" onClick={e => e.stopPropagation()} />

      <div key={i} className="absolute flex flex-col gap-3 p-5 rounded-2xl ed-tour-card"
        style={{
          top: cardTop, left: cardLeft, width: CARD_W,
          background: 'linear-gradient(180deg, #1c1c1e, #121213)', color: '#F4F4F5',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 24px 60px -12px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold tracking-wider uppercase" style={{ color: '#c8ff00' }}>
            Step {i + 1} of {steps.length}
          </span>
          <button type="button" onClick={finish} className="text-xs transition-colors hover:text-white" style={{ color: 'rgba(244,244,245,0.5)' }}>
            Skip tour
          </button>
        </div>
        <h2 id="tour-title" className="text-base font-bold leading-snug">{step.title}</h2>
        <p id="tour-body" className="text-sm leading-relaxed" style={{ color: 'rgba(244,244,245,0.7)' }}>{step.body}</p>

        <div className="flex items-center justify-between pt-1">
          {/* Progress dots */}
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {steps.map((_, d) => (
              <span key={d} className="h-1.5 rounded-full transition-all duration-300"
                style={{ width: d === i ? 18 : 6, background: d === i ? '#c8ff00' : d < i ? 'rgba(200,255,0,0.4)' : 'rgba(255,255,255,0.18)' }} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {i > 0 && (
              <button type="button" onClick={back}
                className="h-9 px-3 rounded-lg text-xs font-semibold transition-colors hover:bg-white/10" style={{ color: 'rgba(244,244,245,0.8)' }}>
                Back
              </button>
            )}
            <button type="button" onClick={next} autoFocus
              className="h-9 px-4 rounded-lg text-xs font-bold transition-opacity hover:opacity-90"
              style={{ background: '#c8ff00', color: '#000' }}>
              {i === steps.length - 1 ? 'Start editing' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Friendly placeholder for a panel with nothing in it yet: icon, a short line, and a tip */
export function EmptyState({ icon, title, tip }: { icon: React.ReactNode; title: string; tip?: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 px-4 py-6 rounded-xl"
      style={{ background: 'rgb(var(--ed-fg, 244 244 245) / 0.025)', border: '1px dashed rgb(var(--ed-fg, 244 244 245) / 0.12)' }}>
      <span className="w-10 h-10 flex items-center justify-center rounded-xl"
        style={{ background: 'rgba(200,255,0,0.1)', color: '#c8ff00', boxShadow: 'inset 0 0 0 1px rgba(200,255,0,0.25)' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
      </span>
      <p className="text-sm font-semibold" style={{ color: 'rgb(var(--ed-fg, 244 244 245) / 0.85)' }}>{title}</p>
      {tip && <p className="text-xs leading-relaxed max-w-[240px]" style={{ color: 'rgb(var(--ed-fg, 244 244 245) / 0.45)' }}>{tip}</p>}
    </div>
  )
}
