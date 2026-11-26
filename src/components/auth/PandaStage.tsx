'use client'

import { useEffect, useRef, useState } from 'react'
import {
  CLIPS, CLIP_NAMES, CUT_IN_AFTER, LOOP_OF, PANDA_POSTER, PANDA_POSTER_INTRO, RATE, TUG_AT,
  clipSrc, onPandaCue, type ClipName, type OnceClip, type Pose,
} from './panda'

/**
 * The brand panda beside the sign-in / sign-up card, under one soft spotlight (styles: .ap-* in
 * app/auth.css; desktop only — phones keep the card alone). It reacts to the form:
 *   - sign-up opens with it looking away; it notices you, turns and waves (the form is already
 *     there); sign-in: it waves
 *   - the email box: it turns to the card and reads along
 *   - a password box: paws over its eyes; the password shown (the eye button): it peeks
 *   - an error: oops (a real failure, or a little head shake for a small slip — taking turns when
 *     they repeat); signed in: it celebrates, then the next page opens
 *   - Sign in ↔ Create account: it tugs the cord, the form flies up and falls back in (any click
 *     or key brings it down at once)
 *   - otherwise it stands, breathing and blinking
 * Each clip is its own small video; one plays at a time and the next fades in over it as it starts
 * (a few frames), so the joins don't jump. Motion turned down: a still panda, the card just there.
 */
/** Where the panda shows (and moves): wide windows, motion not turned down */
const SHOW_MEDIA = '(min-width: 900px) and (prefers-reduced-motion: no-preference)'

export function PandaStage({ intro }: { intro: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState(false)
  /** No show (motion turned down): the still faces you, not away */
  const [still, setStill] = useState(false)

  useEffect(() => {
    if (window.matchMedia(SHOW_MEDIA).matches) { setLive(true); return }
    // (no show: the card is simply there)
    setStill(true)
    ref.current?.closest('.auth-root')?.querySelector('.auth-side')?.removeAttribute('data-drop')
  }, [])

  useEffect(() => {
    const stage = ref.current
    if (!live || !stage) return
    const player = new Player(stage, intro)
    return () => player.stop()
  }, [live, intro])

  const firstClip: ClipName = intro ? 'greet' : 'hello'
  return (
    <div ref={ref} className="ap-stage" aria-hidden="true">
      {/* (the first clip and the idle loop start downloading as the page arrives — wide windows with
          motion on only — so the panda moves as soon as the page shows; the Player picks them up) */}
      <link rel="preload" as="fetch" crossOrigin="anonymous" href={clipSrc(firstClip)} media={SHOW_MEDIA} />
      <link rel="preload" as="fetch" crossOrigin="anonymous" href={clipSrc('idle')} media={SHOW_MEDIA} />
      <div className="ap-box">
        <div className="ap-film">
          {/* (shown until the first clip plays, and the whole panda when motion is turned down) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="ap-still" src={intro && !still ? PANDA_POSTER_INTRO : PANDA_POSTER} alt="" width={640} height={720} />
          {/* (the Player loads each clip into memory and gives it its source) */}
          {live && CLIP_NAMES.map(name => (
            <video key={name} data-clip={name} muted playsInline disablePictureInPicture preload="auto" />
          ))}
        </div>
        <span className="ap-floor" />
      </div>
      <span className="ap-light" />
    </div>
  )
}

/** From each pose, the clips the form can call for next (kept running in the background) */
const NEXT_FROM: Record<Pose, ClipName[]> = {
  neutral: ['watch-in', 'cover-in', 'idle'],
  watch: ['watch-out', 'watch-cover', 'watch-loop'],
  cover: ['cover-out', 'peek-open', 'cover-hold'],
  peek: ['peek-close', 'peek-hold'],
}

/** The fade between two clips (ms) — matches .ap-film video[data-on="top"]; leaving a loop partway: FADE_SLOW */
const FADE = 140
const FADE_SLOW = 200

class Player {
  private vids = new Map<ClipName, HTMLVideoElement>()
  private root: HTMLElement
  /** The card's form side — what drops in at the tug */
  private card: HTMLElement | null
  private cur: ClipName | null = null
  /** Where the panda is once the current clip is done */
  private pose: Pose = 'neutral'
  /** What the form asks for now (from where the focus is) */
  private want: Pose = 'neutral'
  /** Reactions waiting to play (from standing) */
  private queue: OnceClip[] = []
  private lastOops: 'oops' | 'oops-small' | null = null
  private celebrateDone: (() => void) | null = null
  private token = 0
  /** The token of the clip that has actually started (jumped back to its start and playing) */
  private started = -1
  /** The token of the clip last brought up on screen */
  private shown = -1
  private stopped = false
  private off: (() => void)[] = []
  private timers = new Set<number>()

  constructor(private stage: HTMLElement, intro: boolean) {
    this.root = stage.closest('.auth-root') ?? document.body
    this.card = this.root.querySelector<HTMLElement>('.auth-side')
    stage.querySelectorAll<HTMLVideoElement>('video[data-clip]').forEach(v => {
      const name = v.dataset.clip as ClipName
      this.vids.set(name, v)
      // (only a clip that has really started over counts: one kept running in the background can hit its
      // end just as it's called up, before it has jumped back to its start)
      const ended = () => { if (this.cur === name && this.started === this.token) this.advance() }
      v.addEventListener('ended', ended)
      this.off.push(() => v.removeEventListener('ended', ended))
    })
    // No waiting between clips (user, 2026-11-25: "between every video there is lag"):
    //  - every clip is downloaded once into memory (a blob), so starting one never waits on the network
    //  - each hidden clip is kept with its first frame decoded (the browser lets a paused hidden video go
    //    to sleep; waking it took up to 0.7 s), checked every couple of seconds
    //  - the next clip is started a frame before the current one ends, and shown on its first frame
    const urls: string[] = []
    const first: ClipName = intro ? 'greet' : 'hello'
    const load = (name: ClipName) => {
      const v = this.vids.get(name)
      if (!v || v.getAttribute('src')) return
      // (the same request the page's preload made, so the first two come straight from it)
      fetch(clipSrc(name), { mode: 'cors', credentials: 'same-origin' }).then(r => (r.ok ? r.blob() : Promise.reject())).then(b => {
        if (this.stopped || v.getAttribute('src')) return
        const url = URL.createObjectURL(b); urls.push(url)
        v.src = url; v.load()
        v.addEventListener('loadedmetadata', () => { this.prime(v); this.warm() }, { once: true })
      }).catch(() => { if (!this.stopped && !v.getAttribute('src')) { v.src = clipSrc(name); v.load() } })
    }
    load(first); load('idle')
    this.later(() => CLIP_NAMES.forEach(load), 150)
    const keepAwake = window.setInterval(() => this.vids.forEach(v => { if (!v.dataset.on) this.prime(v) }), 2000)
    this.off.push(() => { window.clearInterval(keepAwake); urls.forEach(u => URL.revokeObjectURL(u)) })

    // the form: where the focus is, the eye buttons
    let t = 0
    const read = () => { window.clearTimeout(t); t = window.setTimeout(() => this.setWant(this.readForm()), 90) }
    this.root.addEventListener('focusin', read)
    this.root.addEventListener('focusout', read)
    this.root.addEventListener('click', read)
    this.off.push(() => {
      window.clearTimeout(t)
      this.root.removeEventListener('focusin', read)
      this.root.removeEventListener('focusout', read)
      this.root.removeEventListener('click', read)
    })
    this.off.push(onPandaCue(cue => {
      if (cue.type === 'oops') {
        // (its own reaction first; the other one when the same kind comes again, so a retry doesn't look canned)
        const own = cue.small ? 'oops-small' : 'oops'
        const other = cue.small ? 'oops' : 'oops-small'
        const pick = this.lastOops === own ? other : own
        this.lastOops = pick
        this.queue = this.queue.filter(q => q !== 'oops' && q !== 'oops-small')
        this.enqueue(pick)
      } else if (cue.type === 'switch') {
        this.liftCard()
        if (this.cur !== 'tug' && !this.queue.includes('tug')) this.enqueue('tug')
        else if (this.cur === 'tug' && this.time() > (TUG_AT.tug ?? 0)) this.dropCard()
      } else {
        this.celebrateDone = cue.done
        this.queue = ['celebrate']
        // (now, from standing or a reaction; a turn in or out finishes first — it's short)
        const cur = this.cur
        if (cur && ('once' in CLIPS[cur] || (cur === 'idle'))) this.play('celebrate')
        else this.nudge()
      }
    }))

    // (the form is there from the start — user, 2026-11-25: the cord and the fall only for Sign in ↔ Create account)
    this.card?.removeAttribute('data-drop')
    this.play(intro ? 'greet' : 'hello')
  }

  stop() {
    this.stopped = true
    this.off.forEach(f => f())
    this.timers.forEach(id => window.clearTimeout(id))
    this.card?.removeAttribute('data-drop')
    this.celebrateDone?.()
  }

  private later(fn: () => void, ms: number) {
    const id = window.setTimeout(() => { this.timers.delete(id); if (!this.stopped) fn() }, ms)
    this.timers.add(id)
    return id
  }

  /**
   * The clips that can come next from where the panda is going are kept running, hidden: a playing
   * video is never put to sleep by the browser, so the next one starts at once (a paused hidden one
   * could take over a second to wake). The rest pause.
   */
  private warm() {
    const next = new Set<ClipName>([this.decide(), ...NEXT_FROM[this.pose]])
    this.vids.forEach((v, name) => {
      if (v.dataset.on || name === this.cur) return   // (on screen, or just starting)
      if (next.has(name)) { if (v.paused && v.getAttribute('src') && v.readyState >= 1) { v.loop = true; v.play().catch(() => {}) } }
      else if (!v.paused) { v.pause(); v.currentTime = 0 }
    })
  }

  /** A hidden clip, ready to start at once: its first frame decoded (a seek to 0 wakes it) */
  private prime(v: HTMLVideoElement) {
    if (v.readyState < 2 && v.getAttribute('src') && !v.seeking) v.currentTime = 0
  }

  /**
   * A clip that ends on its own: the next one starts a frame before it does (so they meet with no
   * stop); 'ended' stays as the fallback
   */
  private watchEnd(name: ClipName, v: HTMLVideoElement, token: number) {
    if (typeof v.requestVideoFrameCallback !== 'function') return
    // (a frame from before the jump back is ignored: only once a frame near its start has shown)
    let fresh = false
    const tick = (_: number, meta: VideoFrameCallbackMetadata) => {
      if (this.stopped || token !== this.token || this.cur !== name) return
      if (meta.mediaTime < 0.25) fresh = true
      const left = (v.duration - meta.mediaTime) / (v.playbackRate || 1)
      if (fresh && Number.isFinite(left) && left <= 0.07) { this.advance(); return }
      v.requestVideoFrameCallback(tick)
    }
    v.requestVideoFrameCallback(tick)
  }

  /** Where the form's focus says the panda should be */
  private readForm(): Pose {
    const el = document.activeElement as HTMLElement | null
    if (!el || !this.root.contains(el)) return 'neutral'
    const box = el.closest('.auth-password')
    if (box) return box.querySelector('.auth-eye[aria-pressed="true"]') ? 'peek' : 'cover'
    if (el.matches('input[type="email"], #auth-code')) return 'watch'
    return 'neutral'
  }

  private setWant(p: Pose) {
    if (p === this.want) return
    this.want = p
    this.nudge()
  }

  private enqueue(clip: OnceClip) {
    this.queue.push(clip)
    this.nudge()
  }

  /** Seconds into the current clip (its own time) */
  private time() {
    const v = this.cur && this.vids.get(this.cur)
    return v ? v.currentTime : 0
  }

  /** Something changed: move on now if the current clip may be cut, else hurry it along */
  private nudge() {
    const cur = this.cur
    if (!cur) return
    const spec = CLIPS[cur] as { loop?: true; once?: true }
    if (spec.loop) { const next = this.decide(); if (next !== cur) this.play(next); return }
    if (spec.once) {
      // (the cord pulls: once the card is down — at the tug, or sooner by a click — the form comes first)
      const cardDown = cur === 'tug' && !this.card?.dataset.drop
      if (cardDown || this.time() >= CUT_IN_AFTER[cur as OnceClip]) this.play(this.decide())
      return
    }
    // (a turn in or out: let it finish — they're short — but quicker when it's going the wrong way)
    const v = this.vids.get(cur)
    if (v && this.decide() !== LOOP_OF[this.pose]) v.playbackRate = 1.6
  }

  /** The clip before ran to its own end (so it meets the next on the same frame) — set by advance() */
  private natural = false

  private advance() {
    this.natural = true
    if (this.cur === 'celebrate') { this.celebrateDone?.(); this.celebrateDone = null }
    this.play(this.decide())
  }

  /** The next clip, from where the panda is to what's wanted */
  private decide(): ClipName {
    const goal: Pose = this.queue.length ? 'neutral' : this.want
    switch (this.pose) {
      case 'peek': return goal === 'peek' ? 'peek-hold' : 'peek-close'
      case 'cover': return goal === 'cover' ? 'cover-hold' : goal === 'peek' ? 'peek-open' : 'cover-out'
      case 'watch': return goal === 'watch' ? 'watch-loop' : goal === 'neutral' ? 'watch-out' : 'watch-cover'
      case 'neutral':
        if (this.queue.length) return this.queue[0]
        return goal === 'watch' ? 'watch-in' : goal === 'neutral' ? 'idle' : 'cover-in'
    }
  }

  private play(name: ClipName) {
    const v = this.vids.get(name)
    if (!v || this.stopped) return
    const prevName = this.cur
    const prev = prevName ? this.vids.get(prevName) : undefined
    // (leaving a loop partway through — the panda a little off its shared pose — the blend is longer;
    // a clip that ran to its end meets the next on the very same frame)
    const natural = this.natural
    this.natural = false
    // (leaving a loop, or a reaction cut short by the form: the panda is off its shared frame — a short
    // blend, the new clip held on its first frame meanwhile; a clip that ran to its end: an instant swap)
    const slow = !!prevName && prevName !== name && ('loop' in CLIPS[prevName] || !natural)
    const token = ++this.token
    if (this.queue[0] === name) this.queue.shift()
    this.cur = name
    this.pose = CLIPS[name].pose
    if (name === 'celebrate') this.later(() => { if (this.cur === 'celebrate') { this.celebrateDone?.(); this.celebrateDone = null } }, 2400)
    v.loop = 'loop' in CLIPS[name]
    // (a turn in or out on the way to something else — not to rest — goes quicker)
    const passing = !('loop' in CLIPS[name]) && !('once' in CLIPS[name]) && this.decide() !== LOOP_OF[this.pose]
    if (TUG_AT[name] !== undefined && this.card?.dataset.drop) this.watchTug(name, token)

    // it starts underneath, and comes up over the one before on its first new frame — the one before
    // keeps playing (or holds its last frame) until then, so the panda never sits on a frozen frame
    const reveal = () => {
      if (token !== this.token || this.shown === token) return
      this.shown = token
      // (a clip that ran to its end meets the next on the very same frame: swapped at once, no blend —
      // a blend there only showed the next one's first movement over the held frame; leaving a loop:
      // a short blend, the new clip held on its first frame meanwhile)
      v.dataset.fade = slow ? 'slow' : prevName && prevName !== name ? 'none' : 'quick'
      v.dataset.on = 'top'
      this.stage.dataset.playing = ''
      // every other clip still on screen goes under it and then away — not only the one before in the
      // player's own order: when switching fast, that one may never have come up at all
      this.vids.forEach(o => {
        if (o === v || !o.dataset.on) return
        o.dataset.on = 'under'
        this.later(() => {
          if (o.dataset.on !== 'under') return
          o.removeAttribute('data-on'); o.pause(); o.currentTime = 0
          this.warm()
        }, (slow ? FADE_SLOW : FADE) + 40)
      })
    }
    const start = () => {
      if (token !== this.token) return
      v.loop = 'loop' in CLIPS[name]
      v.playbackRate = RATE[name] ?? (passing ? 1.6 : 1)
      const go = () => {
        if (token !== this.token) return
        if (slow) {
          // (leaving a loop: it comes up holding its first frame — the shared pose — and only moves
          // once it is fully over the loop; moving during the fade showed two poses at once)
          reveal()
          this.later(() => { if (token === this.token) play() }, FADE_SLOW)
          return
        }
        play()
      }
      const play = () => {
        this.started = token
        v.play().catch(() => this.dropCard())
        // (it comes up on its first frame actually shown — never on a frame from before the jump back)
        if (typeof v.requestVideoFrameCallback === 'function') v.requestVideoFrameCallback(() => reveal())
        else v.addEventListener('playing', reveal, { once: true })
        // (never left waiting on a frame callback that doesn't come)
        this.later(reveal, 400)
        if (!('loop' in CLIPS[name])) this.watchEnd(name, v, token)
      }
      // (a clip kept running in the background jumps back to its start first — and, to come up held on
      // its first frame, stops there)
      if (slow && !v.paused) v.pause()
      if (v.currentTime > 0.001 || !v.paused) { v.addEventListener('seeked', go, { once: true }); v.currentTime = 0 }
      else go()
      this.warm()
    }
    if (prev === v) { this.started = token; v.currentTime = 0; v.play().catch(() => {}); if (!('loop' in CLIPS[name])) this.watchEnd(name, v, token); return }
    if (v.readyState >= 2) start()
    else {
      // (not ready yet: still arriving into memory, or asleep — start the moment its first frame is
      // there; the one before keeps playing meanwhile)
      let done = false
      const go = () => {
        if (done) return; done = true
        ;['loadeddata', 'canplay', 'seeked'].forEach(e => v.removeEventListener(e, go))
        start()
      }
      ;['loadeddata', 'canplay', 'seeked'].forEach(e => v.addEventListener(e, go))
      this.prime(v)
      // (can't load: the form mustn't wait on it)
      v.addEventListener('error', () => this.dropCard(), { once: true })
    }
  }

  /** At the clip's tug, the card drops */
  private watchTug(name: ClipName, token: number) {
    const at = TUG_AT[name]!
    const v = this.vids.get(name)!
    const tick = () => {
      if (this.stopped || token !== this.token || !this.card?.dataset.drop) return
      if (this.cur === name && v.dataset.on && v.currentTime >= at) { this.dropCard(); return }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  /** The form waits above the card (until the tug, a click or a key, or `ms`) */
  private waitForTug(ms: number) {
    const now = () => this.dropCard()
    document.addEventListener('pointerdown', now, { capture: true, once: true })
    document.addEventListener('keydown', now, { capture: true, once: true })
    const id = this.later(now, ms)
    this.off.push(() => {
      document.removeEventListener('pointerdown', now, { capture: true })
      document.removeEventListener('keydown', now, { capture: true })
      window.clearTimeout(id)
    })
  }

  private liftCard() {
    if (!this.card || this.card.dataset.drop === 'up') return
    this.card.dataset.drop = 'up'
    this.waitForTug(3200)
  }

  private dropCard() {
    const card = this.card
    if (!card || !card.dataset.drop || card.dataset.drop === 'in') return
    card.dataset.drop = 'in'
    const done = () => {
      card.removeEventListener('animationend', ended)
      if (card.dataset.drop === 'in') card.removeAttribute('data-drop')
    }
    // (its own drop — not the form's animations inside it)
    const ended = (e: AnimationEvent) => { if (e.target === card) done() }
    card.addEventListener('animationend', ended)
    this.later(done, 1800)
  }
}
