'use client'

import { useEffect, useRef, useState } from 'react'
import {
  CLIPS, CLIP_NAMES, CUT_IN_AFTER, LOOP_OF, PANDA_POSTER, PANDA_POSTER_INTRO, RATE, TUG_AT,
  clipSrc, onPandaCue, type ClipName, type OnceClip, type Pose,
} from './panda'

/**
 * The brand panda beside the sign-in / sign-up card, under one soft spotlight (styles: .ap-* in
 * app/auth.css; desktop only — phones keep the card alone). It reacts to the form:
 *   - sign-up opens with it looking away; it notices you, waves, pulls the cord — and the card
 *     drops in at the tug (any click or key drops it at once); sign-in: it waves
 *   - the email box: it turns to the card and reads along
 *   - a password box: paws over its eyes; the password shown (the eye button): it peeks
 *   - an error: oops (a real failure, or a little head shake for a small slip — taking turns when
 *     they repeat); signed in: it celebrates, then the next page opens
 *   - Sign in ↔ Create account: it tugs the cord, the card goes up and drops back in
 *   - otherwise it stands, breathing and blinking
 * Each clip is its own small video; one plays at a time and the next fades in over it as it starts
 * (a few frames), so the joins don't jump. Motion turned down: a still panda, the card just there.
 */
export function PandaStage({ intro }: { intro: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState(false)
  /** No show (motion turned down): the still faces you, not away */
  const [still, setStill] = useState(false)

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 900px)').matches
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (desktop && !calm) { setLive(true); return }
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

  return (
    <div ref={ref} className="ap-stage" aria-hidden="true">
      <div className="ap-box">
        <div className="ap-film">
          {/* (shown until the first clip plays, and the whole panda when motion is turned down) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="ap-still" src={intro && !still ? PANDA_POSTER_INTRO : PANDA_POSTER} alt="" width={640} height={720} />
          {live && CLIP_NAMES.map(name => (
            <video key={name} data-clip={name} src={clipSrc(name)} muted playsInline disablePictureInPicture
              preload={name === (intro ? 'intro' : 'hello') || name === 'idle' ? 'auto' : 'none'} />
          ))}
        </div>
        <span className="ap-floor" />
      </div>
      <span className="ap-light" />
    </div>
  )
}

/** The fade between two clips (ms) — matches .ap-film video[data-on="top"] */
const FADE = 140

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
  private stopped = false
  private off: (() => void)[] = []
  private timers = new Set<number>()

  constructor(private stage: HTMLElement, intro: boolean) {
    this.root = stage.closest('.auth-root') ?? document.body
    this.card = this.root.querySelector<HTMLElement>('.auth-side')
    stage.querySelectorAll<HTMLVideoElement>('video[data-clip]').forEach(v => {
      const name = v.dataset.clip as ClipName
      this.vids.set(name, v)
      const ended = () => { if (this.cur === name) this.advance() }
      v.addEventListener('ended', ended)
      this.off.push(() => v.removeEventListener('ended', ended))
    })
    // (the rest load once the first is on its way)
    this.later(() => this.vids.forEach(v => { if (v.preload !== 'auto') { v.preload = 'auto'; v.load() } }), 700)

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

    if (intro) {
      // the card waits up top until the tug; a click or a key brings it now; never longer than this
      this.waitForTug(7500)
      this.play('intro')
    } else {
      this.card?.removeAttribute('data-drop')
      this.play('hello')
    }
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
      const cardDown = (cur === 'intro' || cur === 'tug') && !this.card?.dataset.drop
      if (cardDown || this.time() >= CUT_IN_AFTER[cur as OnceClip]) this.play(this.decide())
      return
    }
    // (a turn in or out: let it finish — they're short — but quicker when it's going the wrong way)
    const v = this.vids.get(cur)
    if (v && this.decide() !== LOOP_OF[this.pose]) v.playbackRate = 1.6
  }

  private advance() {
    if (this.cur === 'celebrate') { this.celebrateDone?.(); this.celebrateDone = null }
    this.play(this.decide())
  }

  /** The next clip, from where the panda is to what's wanted */
  private decide(): ClipName {
    const goal: Pose = this.queue.length ? 'neutral' : this.want
    switch (this.pose) {
      case 'peek': return goal === 'peek' ? 'peek-hold' : 'peek-close'
      case 'cover': return goal === 'cover' ? 'cover-hold' : goal === 'peek' ? 'peek-open' : 'cover-out'
      case 'watch': return goal === 'watch' ? 'watch-loop' : 'watch-out'
      case 'neutral':
        if (this.queue.length) return this.queue[0]
        return goal === 'watch' ? 'watch-in' : goal === 'neutral' ? 'idle' : 'cover-in'
    }
  }

  private play(name: ClipName) {
    const v = this.vids.get(name)
    if (!v || this.stopped) return
    const prev = this.cur ? this.vids.get(this.cur) : undefined
    const token = ++this.token
    if (this.queue[0] === name) this.queue.shift()
    this.cur = name
    this.pose = CLIPS[name].pose
    if (name === 'celebrate') this.later(() => { if (this.cur === 'celebrate') { this.celebrateDone?.(); this.celebrateDone = null } }, 2000)
    v.loop = 'loop' in CLIPS[name]
    // (a turn in or out on the way to something else — not to rest — goes quicker)
    const passing = !('loop' in CLIPS[name]) && !('once' in CLIPS[name]) && this.decide() !== LOOP_OF[this.pose]
    if (TUG_AT[name] !== undefined && this.card?.dataset.drop) this.watchTug(name, token)

    const show = () => {
      if (token !== this.token) return
      v.playbackRate = RATE[name] ?? (passing ? 1.6 : 1)
      v.currentTime = 0
      v.play().catch(() => this.dropCard())
      v.dataset.on = 'top'
      this.stage.dataset.playing = ''
      if (prev && prev !== v) {
        prev.dataset.on = 'under'
        this.later(() => {
          if (prev.dataset.on !== 'under') return
          prev.removeAttribute('data-on'); prev.pause(); prev.currentTime = 0
        }, FADE + 40)
      }
    }
    if (v.readyState >= 2) show()
    else {
      if (v.preload !== 'auto') { v.preload = 'auto'; v.load() }
      v.addEventListener('loadeddata', show, { once: true })
      // (can't load: the card mustn't wait on it)
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
    if (!this.card || this.card.dataset.drop === 'up' || this.card.dataset.drop === 'wait') return
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
