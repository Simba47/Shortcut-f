/**
 * The panda beside the sign-in / sign-up card (PandaStage.tsx): its clips, and the cues the form
 * sends it. The clips (public/auth/panda) are cut from the user's Kling renders — 640 × 720 on
 * black, 24 fps, no sound — so that each one starts where the one before it ends.
 */

const DIR = '/auth/panda'
export const PANDA_POSTER = `${DIR}/poster.webp`
/** Sign-up's first frame: looking away, before it notices you (the greeting) */
export const PANDA_POSTER_INTRO = `${DIR}/poster-intro.webp`

/**
 * Where each clip leaves the panda:
 *   neutral  standing, facing you          watch  head turned to the card, reading
 *   cover    paws over its eyes             peek   one eye peeking out between them
 */
export type Pose = 'neutral' | 'watch' | 'cover' | 'peek'

export const CLIPS = {
  // once, from standing (they end standing)
  greet: { pose: 'neutral', once: true },        // sign-up opens: looks away, notices you, turns, waves, lowers its paw (the form is already there)
  hello: { pose: 'neutral', once: true },        // sign-in: waves at you
  tug: { pose: 'neutral', once: true },          // Sign in ↔ Create account: pulls the cord, the card drops back in
  oops: { pose: 'neutral', once: true },         // something really went wrong: eek, sheepish head scratch
  'oops-small': { pose: 'neutral', once: true }, // a small slip in the form: a little head shake
  celebrate: { pose: 'neutral', once: true },    // signed in: happy bounces with paws up, a big wave
  // standing still (looped)
  idle: { pose: 'neutral', loop: true },
  // the email box
  'watch-in': { pose: 'watch' },
  'watch-loop': { pose: 'watch', loop: true },
  'watch-out': { pose: 'neutral' },
  // the password boxes
  'cover-in': { pose: 'cover' },
  'cover-hold': { pose: 'cover', loop: true },
  'cover-out': { pose: 'neutral' },
  // the password shown (the eye button)
  'peek-open': { pose: 'peek' },
  'peek-hold': { pose: 'peek', loop: true },
  'peek-close': { pose: 'cover' },
} as const satisfies Record<string, { pose: Pose; loop?: true; once?: true }>

export type ClipName = keyof typeof CLIPS
export type OnceClip = 'greet' | 'hello' | 'tug' | 'oops' | 'oops-small' | 'celebrate'
export const CLIP_NAMES = Object.keys(CLIPS) as ClipName[]
export const clipSrc = (name: ClipName) => `${DIR}/${name}.mp4`

/** The loop each pose rests in */
export const LOOP_OF: Record<Pose, ClipName> = { neutral: 'idle', watch: 'watch-loop', cover: 'cover-hold', peek: 'peek-hold' }

/** Seconds into a clip (its own time) when the cord is tugged — the form starts to fall then */
export const TUG_AT: Partial<Record<ClipName, number>> = { tug: 1.8 }
/** How fast a clip plays (the tug a little quicker, so the form is back in about a second and a half) */
export const RATE: Partial<Record<ClipName, number>> = { tug: 1.35, oops: 1.1 }
/** Seconds into a once-clip after which something new may cut in (the cord let go, the reaction read) */
export const CUT_IN_AFTER: Record<OnceClip, number> = { greet: 1.5, hello: 1.2, tug: 3.4, oops: 2.2, 'oops-small': 1.2, celebrate: Infinity }

/** What the form tells the panda */
export type PandaCue =
  | { type: 'oops'; small: boolean }
  | { type: 'switch' }
  | { type: 'celebrate'; done: () => void }

let listener: ((cue: PandaCue) => void) | null = null
/** The stage listens (one at a time); returns the way to stop */
export function onPandaCue(fn: (cue: PandaCue) => void) {
  listener = fn
  return () => { if (listener === fn) listener = null }
}
/** An error came up: a real failure (wrong password, server) or a small slip (passwords differ, a box not ticked) */
export const pandaOops = (small: boolean) => listener?.({ type: 'oops', small })
/** Sign in ↔ Create account, picked by the person: the panda tugs the cord and the card swaps */
export const pandaSwitch = () => listener?.({ type: 'switch' })
/**
 * Signed in: the panda celebrates, then the next page opens. Resolves at once when there is no
 * panda (phones, motion turned down), and never waits more than a couple of seconds.
 */
export function pandaCelebrate(): Promise<void> {
  return new Promise(resolve => {
    if (!listener) { resolve(); return }
    listener({ type: 'celebrate', done: resolve })
    setTimeout(resolve, 2800)
  })
}
