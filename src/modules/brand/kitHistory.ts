// Undo, Redo and Start over in the brand kit window (user, 2026-11-12: "if I've done anything wrong
// making the brand kit, I want to change it back"). Each step keeps the kits as they were before it;
// undoing puts them back and keeps what they were for Redo. Quick changes in a row (a name being typed,
// a colour being dragged) and changes made together (Make default: two kits at once) are one step.
// Start over: a kit as it was when the window opened. Kept in memory only — closing the window ends it.
import type { BrandKitData } from '@/lib/shared/brandKit'

/** What a step puts back of a kit */
export interface KitState { name: string; data: BrandKitData; logo_url: string | null }

interface Step { at: number; kits: Record<string, KitState> }

export interface KitHistory {
  undo: Step[]
  redo: Step[]
  /** Each kit changed since the window opened, as it was then */
  first: Record<string, KitState>
}

/** Changes closer together than this are one step */
export const STEP_GAP_MS = 800
/** The most steps kept */
const MAX_STEPS = 100

export const emptyHistory = (): KitHistory => ({ undo: [], redo: [], first: {} })

/**
 * A kit is about to change (`before`: as it is now): the change is a step of its own, or part of the last.
 * `alone`: a step of its own, and the next change isn't folded into it (Start over)
 */
export function record(h: KitHistory, id: string, before: KitState, now: number, alone = false): KitHistory {
  const last = h.undo[h.undo.length - 1]
  const first = id in h.first ? h.first : { ...h.first, [id]: before }
  if (alone) return { undo: [...h.undo, { at: 0, kits: { [id]: before } }].slice(-MAX_STEPS), redo: [], first }
  if (last && now - last.at < STEP_GAP_MS) {
    // (the step keeps each kit as it was at its start)
    const kits = id in last.kits ? last.kits : { ...last.kits, [id]: before }
    return { undo: [...h.undo.slice(0, -1), { at: now, kits }], redo: [], first }
  }
  return { undo: [...h.undo, { at: now, kits: { [id]: before } }].slice(-MAX_STEPS), redo: [], first }
}

/**
 * The last step taken back: what to put back (`put`), and the history after it, with the kits as they
 * are now kept for Redo. `now`: a kit as it is (undefined: it's gone — left out)
 */
export function undo(h: KitHistory, now: (id: string) => KitState | undefined): { h: KitHistory; put: Record<string, KitState> } | null {
  return move(h, 'undo', now)
}

/** The last step undone, done again */
export function redo(h: KitHistory, now: (id: string) => KitState | undefined): { h: KitHistory; put: Record<string, KitState> } | null {
  return move(h, 'redo', now)
}

function move(h: KitHistory, from: 'undo' | 'redo', now: (id: string) => KitState | undefined) {
  const to = from === 'undo' ? 'redo' : 'undo'
  const list = h[from]
  const step = list[list.length - 1]
  if (!step) return null
  const put: Record<string, KitState> = {}
  const back: Record<string, KitState> = {}
  for (const [id, state] of Object.entries(step.kits)) {
    const cur = now(id)
    if (!cur) continue
    put[id] = state
    back[id] = cur
  }
  const rest = { ...h, [from]: list.slice(0, -1) }
  if (!Object.keys(put).length) return { h: rest, put }
  // (at 0: the next change after it is never folded into it)
  return { h: { ...rest, [to]: [...h[to], { at: 0, kits: back }] }, put }
}

/** Has the kit changed since the window opened (Start over has something to do) */
export function changedSinceOpen(h: KitHistory, id: string, now: KitState | undefined): boolean {
  const was = h.first[id]
  return !!was && !!now && !sameState(was, now)
}

export function sameState(a: KitState, b: KitState): boolean {
  return a.name === b.name && a.logo_url === b.logo_url && JSON.stringify(a.data) === JSON.stringify(b.data)
}
