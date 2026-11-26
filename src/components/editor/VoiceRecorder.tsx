'use client'

/**
 * Record voice (user, 2026-11-25): talk over the clip while it plays. Press Record → 3-2-1 → the clip
 * plays from the playhead while the mic records → Stop (or Space / Esc, or the clip ends) → the take
 * goes on the audio lane where it started (EditorShell onTake). The captions show big meanwhile, so a
 * line can be read while dubbing it. "Mute the original under my voice" (on by default) makes it a dub.
 *
 * The mic is read raw (an AudioWorklet) and saved as a WAV: exact length, no codec delay, and the
 * samples can be lined up with the clip — the take starts where the playhead was, corrected for the
 * mic's delay (modules/editor/voice.ts takeFrames).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { encodeWav, maxTakeSeconds, takeFrames } from '@/modules/editor/voice'
import { usePlayerStore } from '@/modules/player/store'

export type VoiceTake = { blob: Blob; startMs: number; lenMs: number; mutesOriginal: boolean }

type Word = { word: string; start_ms: number; end_ms: number }

interface Props {
  onClose: () => void
  /** The clip's live time (ms on the timeline) and its changes */
  getTime: () => number
  subscribe: (fn: () => void) => () => void
  isPlaying: () => boolean
  play: () => void
  pause: () => void
  seek: (ms: number) => void
  clipLengthMs: number
  /** The captions' words, timeline ms: shown big while recording */
  words: Word[]
  muteOriginal: boolean
  onMuteOriginal: (on: boolean) => void
  /** Recording now (the editor silences the original / older voices meanwhile) */
  onRecording: (on: boolean) => void
  /** A finished take; `replaceId`: the take it re-does (Retake). Returns the new bar's id. */
  onTake: (take: VoiceTake, replaceId?: string) => string | null
}

// The worklet: hands the mic's samples (with the audio clock's frame of the first one) to the page while
// recording, and its level ~20 times a second always (the meter)
const WORKLET = `
class ShortcutVoiceRec extends AudioWorkletProcessor {
  constructor() {
    super(); this.on = false; this.buf = new Float32Array(8192); this.n = 0; this.f0 = 0; this.sum = 0; this.peak = 0; this.cnt = 0
    this.port.onmessage = e => {
      if (e.data === 'on') { this.on = true; this.n = 0 }
      else if (e.data === 'off') { this.flush(); this.on = false; this.port.postMessage({ done: true }) }
    }
  }
  flush() { if (this.n) { this.port.postMessage({ f: this.f0, d: this.buf.slice(0, this.n) }); this.n = 0 } }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) { const x = ch[i]; this.sum += x * x; const a = x < 0 ? -x : x; if (a > this.peak) this.peak = a }
      this.cnt += ch.length
      if (this.cnt >= sampleRate / 20) { this.port.postMessage({ lv: Math.sqrt(this.sum / this.cnt), pk: this.peak }); this.sum = 0; this.peak = 0; this.cnt = 0 }
      if (this.on) {
        if (this.n + ch.length > this.buf.length) this.flush()
        if (this.n === 0) this.f0 = currentFrame
        this.buf.set(ch, this.n); this.n += ch.length
      }
    }
    return true
  }
}
registerProcessor('shortcut-voice-rec', ShortcutVoiceRec)
`

type Phase = 'starting' | 'ready' | 'count' | 'rec' | 'saving' | 'error'
type Line = { words: Word[]; a: number; b: number }

/** The captions in short lines (a pause, a sentence's end or 7 words ends one) */
function linesOf(words: Word[]): Line[] {
  const out: Line[] = []
  let cur: Word[] = []
  const push = () => { if (cur.length) out.push({ words: cur, a: cur[0].start_ms, b: cur[cur.length - 1].end_ms }); cur = [] }
  for (const w of words) {
    const last = cur[cur.length - 1]
    if (last && (w.start_ms - last.end_ms > 650 || cur.length >= 7 || /[.!?।]$/.test(last.word))) push()
    cur.push(w)
  }
  push()
  return out
}

/** What to tell the user when the mic didn't open — the real reason, by the browser's error name */
export function micProblem(name: string, message: string): string {
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'The microphone is blocked. Allow it for this site (the mic icon in the address bar) — on Windows also Settings › Privacy › Microphone — then press Try again.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'No microphone found. Plug one in (or pick another), then press Try again.'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'The computer would not start the microphone (another app may be holding it, or its driver stopped). Press Try again; if it keeps happening, unplug it or restart the browser.'
    case 'InsecureError':
      return 'Recording needs a secure (https) page.'
    default:
      return `The microphone could not be started${name ? ` (${name}${message ? `: ${message}` : ''})` : ''}. Press Try again.`
  }
}

const fmt = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export function VoiceRecorder(p: Props) {
  const [phase, setPhase] = useState<Phase>('starting')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  const [level, setLevel] = useState(0)
  const [count, setCount] = useState(3)
  const [now, setNow] = useState(() => p.getTime())
  const [lastTake, setLastTake] = useState<{ id: string; startMs: number } | null>(null)
  // Where the take being recorded starts (the timer counts from it)
  const [takeFrom, setTakeFrom] = useState(0)
  const playing = usePlayerStore(s => s.playing)
  // The clip has started playing for this take (so a stop of playback afterwards ends the take)
  const startedRef = useRef(false)

  const ctxRef = useRef<AudioContext | null>(null)
  const nodeRef = useRef<AudioWorkletNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const chunksRef = useRef<Array<{ f: number; d: Float32Array }>>([])
  const doneRef = useRef<(() => void) | null>(null)
  const takeRef = useRef<{ fromMs: number; anchor: { clipMs: number; ctxSec: number } | null; replaceId?: string } | null>(null)
  const timersRef = useRef<number[]>([])
  const phaseRef = useRef<Phase>('starting')
  phaseRef.current = phase
  const propsRef = useRef(p)
  propsRef.current = p

  // ── The mic: asked for on open (the meter shows it works before recording), again on a device change ──
  // One opening at a time: each call takes a number, and an older one still on its way (React's dev mode
  // opens the panel twice at once; a quick device change) gives up and lets its mic go when it lands
  // (user, 2026-11-25: two at once collided and showed "close other apps", with no other app using it).
  // The audio graph (context + worklet) is made once per open panel and thrown away when it closes.
  const genRef = useRef(0)
  const stopRef = useRef<((why?: string) => Promise<void>) | null>(null)
  const graphRef = useRef<Promise<{ ctx: AudioContext; node: AudioWorkletNode }> | null>(null)

  function graph(): Promise<{ ctx: AudioContext; node: AudioWorkletNode }> {
    if (graphRef.current) return graphRef.current
    const made = (async () => {
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
        try { await ctx.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
        const node = new AudioWorkletNode(ctx, 'shortcut-voice-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' })
        node.port.onmessage = (e: MessageEvent) => {
          const m = e.data as { f?: number; d?: Float32Array; lv?: number; pk?: number; done?: boolean }
          if (m.d && m.f != null) chunksRef.current.push({ f: m.f, d: m.d })
          else if (m.lv != null) setLevel(l => Math.max(Math.min(1, Math.sqrt(m.lv!) * 1.6), l * 0.7))
          else if (m.done) { doneRef.current?.(); doneRef.current = null }
        }
        // (pulled by the graph, silent: nothing of the mic is played back)
        const mute = ctx.createGain(); mute.gain.value = 0
        node.connect(mute).connect(ctx.destination)
        return { ctx, node }
      } catch (e) {
        void ctx.close().catch(() => {})
        throw e
      }
    })()
    graphRef.current = made
    made.then(({ ctx, node }) => {
      // (the panel closed while it was being made: not used)
      if (graphRef.current !== made) { void ctx.close().catch(() => {}); return }
      ctxRef.current = ctx; nodeRef.current = node
    }, () => { if (graphRef.current === made) graphRef.current = null })
    return made
  }

  /** Lets the mic go and takes the graph down (the panel closed) */
  function closeMic() {
    genRef.current++
    streamRef.current?.getTracks().forEach(t => t.stop())
    sourceRef.current?.disconnect()
    void ctxRef.current?.close().catch(() => {})
    streamRef.current = null; sourceRef.current = null; ctxRef.current = null; nodeRef.current = null; graphRef.current = null
  }

  const openMic = useCallback(async (id: string) => {
    const gen = ++genRef.current
    const stale = () => gen !== genRef.current
    setError(null)
    let stream: MediaStream | null = null
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('insecure'), { name: 'InsecureError' })
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...(id ? { deviceId: { exact: id } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
      if (stale()) { stream.getTracks().forEach(t => t.stop()); return }
      const { ctx, node } = await graph()
      if (stale() || ctx.state === 'closed') { stream.getTracks().forEach(t => t.stop()); return }
      await ctx.resume()
      if (stale()) { stream.getTracks().forEach(t => t.stop()); return }
      // The newer mic in, the one before out
      streamRef.current?.getTracks().forEach(t => t.stop())
      sourceRef.current?.disconnect()
      const src = ctx.createMediaStreamSource(stream)
      src.connect(node)
      streamRef.current = stream; sourceRef.current = src
      ctxRef.current = ctx; nodeRef.current = node
      // The mic went away (unplugged, taken by the computer): say so; a take being recorded ends there
      const track = stream.getAudioTracks()[0]
      if (track) track.onended = () => {
        if (stale() || streamRef.current !== stream) return
        const gone = () => { setError('The microphone stopped (unplugged or taken by the computer). Pick a mic, then press Try again.'); setPhase('error') }
        // (a take being recorded is kept up to there)
        if (phaseRef.current === 'rec') { void stopRef.current?.().then(gone); return }
        gone()
      }
      const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput')
      if (stale()) return
      setDevices(list)
      setDeviceId(stream.getAudioTracks()[0]?.getSettings().deviceId ?? id)
      setError(null)
      setPhase(ph => (ph === 'starting' || ph === 'error' ? 'ready' : ph))
    } catch (e) {
      stream?.getTracks().forEach(t => t.stop())
      if (stale()) return
      const name = (e as { name?: string })?.name ?? ''
      console.warn('[record voice] the microphone did not open:', e)
      setError(micProblem(name, (e as { message?: string })?.message ?? ''))
      setPhase('error')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    p.pause()
    void openMic('')
    const timers = timersRef.current
    return () => {
      for (const t of timers) clearTimeout(t)
      closeMic()
      propsRef.current.onRecording(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The meter falls back when the mic goes quiet
  useEffect(() => {
    const id = window.setInterval(() => setLevel(l => (l < 0.01 ? 0 : l * 0.8)), 80)
    return () => clearInterval(id)
  }, [])

  // The clock: the teleprompter and the timer follow the playhead; while recording, the first moving
  // frame lines the clip up with the audio clock
  useEffect(() => p.subscribe(() => {
    const t = propsRef.current.getTime()
    setNow(t)
    const take = takeRef.current
    if (phaseRef.current === 'rec' && take && !take.anchor && propsRef.current.isPlaying() && t > take.fromMs + 1 && ctxRef.current) {
      take.anchor = { clipMs: t, ctxSec: ctxRef.current.currentTime }
    }
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Record → 3-2-1 → play and record; Stop → the take ──
  function start(replace?: { id: string; startMs: number }) {
    if (phaseRef.current !== 'ready' || !nodeRef.current) return
    setNotice(null)
    const len = p.clipLengthMs
    let from = replace ? replace.startMs : p.getTime()
    if (from >= len - 300) from = 0
    p.seek(from)
    chunksRef.current = []
    takeRef.current = { fromMs: from, anchor: null, ...(replace ? { replaceId: replace.id } : {}) }
    startedRef.current = false
    setTakeFrom(from)
    // (the mic runs through the countdown: the take's first moment has sound before it)
    nodeRef.current.port.postMessage('on')
    setCount(3)
    setPhase('count')
    // (the countdown reads the phase before React has drawn it: set it now)
    phaseRef.current = 'count'
    p.onRecording(true)
    const tick = (n: number) => {
      if (phaseRef.current !== 'count') return
      if (n > 0) { setCount(n); timersRef.current.push(window.setTimeout(() => tick(n - 1), 1000)); return }
      setPhase('rec')
      phaseRef.current = 'rec'
      propsRef.current.seek(from)
      propsRef.current.play()
    }
    tick(3)
  }

  const stop = useCallback(async (why?: string) => {
    const ph = phaseRef.current
    if (ph === 'count') {
      // Stopped during the countdown: nothing recorded
      for (const t of timersRef.current) clearTimeout(t)
      timersRef.current = []
      nodeRef.current?.port.postMessage('off')
      takeRef.current = null
      setPhase('ready')
      phaseRef.current = 'ready'
      propsRef.current.onRecording(false)
      return
    }
    if (ph !== 'rec') return
    const pr = propsRef.current
    pr.pause()
    const toMs = Math.min(pr.clipLengthMs, pr.getTime())
    setPhase('saving')
    phaseRef.current = 'saving'
    await new Promise<void>(res => { doneRef.current = res; nodeRef.current?.port.postMessage('off'); window.setTimeout(res, 1500) })
    pr.onRecording(false)
    const take = takeRef.current
    takeRef.current = null
    const ctx = ctxRef.current
    const chunks = chunksRef.current
    chunksRef.current = []
    if (!take || !ctx || !chunks.length || !take.anchor || toMs - take.fromMs < 300) {
      setNotice(why ?? 'That was too short to keep — press Record and talk for a moment.')
      setPhase('ready')
      return
    }
    // Lay the chunks out by their frames, then cut the take's own stretch from them
    const sr = ctx.sampleRate
    const base = chunks[0].f
    const last = chunks[chunks.length - 1]
    const all = new Float32Array(last.f + last.d.length - base)
    for (const c of chunks) all.set(c.d, c.f - base)
    const settings = streamRef.current?.getAudioTracks()[0]?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined
    const inLat = typeof settings?.latency === 'number' && settings.latency > 0 && settings.latency < 0.5 ? settings.latency : 0.01
    // (what the user sees is a frame or two behind the player's time, plus the audio graph's own delay)
    const outLat = Math.min(0.2, (ctx.baseLatency || 0) + 0.02)
    const { first, end } = takeFrames({
      anchorClipMs: take.anchor.clipMs, anchorCtxSec: take.anchor.ctxSec, fromMs: take.fromMs, toMs,
      sampleRate: sr, inLatSec: inLat, outLatSec: outLat,
    })
    const n = Math.max(0, Math.min(end - first, maxTakeSeconds(sr) * sr))
    const samples = new Float32Array(n)
    const from = first - base
    for (let i = 0; i < n; i++) { const j = from + i; samples[i] = j >= 0 && j < all.length ? all[j] : 0 }
    // A tiny fade at each end: no click where the take starts and stops
    const fadeN = Math.min(Math.round(sr * 0.008), n >> 1)
    for (let i = 0; i < fadeN; i++) { const g = i / fadeN; samples[i] *= g; samples[n - 1 - i] *= g }
    const lenMs = Math.round(n / sr * 1000)
    const id = pr.onTake({ blob: encodeWav(samples, sr), startMs: take.fromMs, lenMs, mutesOriginal: pr.muteOriginal }, take.replaceId)
    if (id) setLastTake({ id, startMs: take.fromMs })
    setNotice(why ?? null)
    setPhase('ready')
  }, [])

  stopRef.current = stop
  // The clip ended (or was paused some other way) while recording: the take ends there
  useEffect(() => {
    if (phase !== 'rec') return
    if (playing) startedRef.current = true
    else if (startedRef.current) void stop()
  }, [phase, playing, stop])
  // A take as long as one upload holds stops by itself
  useEffect(() => {
    if (phase !== 'rec' || !ctxRef.current) return
    const max = maxTakeSeconds(ctxRef.current.sampleRate) * 1000
    const id = window.setTimeout(() => void stop(`A take can be up to ${Math.floor(max / 60000)} minutes — record the rest as the next take.`), max - 200)
    return () => clearTimeout(id)
  }, [phase, stop])

  // Space / Esc stop a take (before the editor's own Space = play); Esc closes otherwise
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ph = phaseRef.current
      if (e.key === ' ' || e.key === 'Escape') {
        if (ph === 'rec' || ph === 'count') { e.preventDefault(); e.stopPropagation(); void stop(); return }
        if (e.key === 'Escape' && ph !== 'saving') { e.preventDefault(); e.stopPropagation(); propsRef.current.onClose() }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [stop])

  // ── Teleprompter: the line being said (its said words lit) and the next one ──
  const lines = useMemo(() => linesOf(p.words.filter(w => w.word.trim())), [p.words])
  const li = lines.findIndex(l => now < l.b + 250)
  const line = li >= 0 ? lines[li] : null
  const next = li >= 0 ? lines[li + 1] : null

  const recording = phase === 'rec'
  const busy = phase === 'count' || phase === 'rec' || phase === 'saving'

  return (
    <div role="dialog" aria-label="Record voice" className="vr-card"
      style={{
        position: 'fixed', left: '50%', bottom: 16, transform: 'translateX(-50%)', zIndex: 60,
        width: 'min(620px, calc(100vw - 32px))', borderRadius: 16, padding: 14,
        background: 'var(--ed-panel, #17171c)', color: 'var(--ed-text, #fff)',
        boxShadow: '0 18px 50px rgba(0,0,0,0.45), inset 0 0 0 1px rgb(var(--ed-fg, 255 255 255) / 0.1)',
      }}>
      {/* Teleprompter */}
      <div aria-live="off" style={{ minHeight: 64, marginBottom: 12, padding: '10px 12px', borderRadius: 12, background: 'rgb(var(--ed-fg, 255 255 255) / 0.05)', textAlign: 'center' }}>
        {line ? (
          <>
            <p style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.35, margin: 0 }}>
              {line.words.map((w, i) => (
                <span key={i} style={{ color: now >= w.start_ms ? 'var(--ed-text, #fff)' : 'rgb(var(--ed-fg, 255 255 255) / 0.4)', transition: 'color .12s' }}>{w.word} </span>
              ))}
            </p>
            {next && <p style={{ fontSize: 14, margin: '4px 0 0', color: 'rgb(var(--ed-fg, 255 255 255) / 0.35)' }}>{next.words.map(w => w.word).join(' ')}</p>}
          </>
        ) : (
          <p style={{ fontSize: 14, margin: '12px 0 0', color: 'rgb(var(--ed-fg, 255 255 255) / 0.45)' }}>
            {p.words.length ? 'No more captions after this point.' : 'Your captions show here while you record.'}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Record / Stop: a big icon with its word (user, 2026-11-25: make play and stop much clearer) —
            ▶ Record (green) · 3-2-1 Cancel · ■ Stop (red, pulsing while it records) */}
        <button type="button" onClick={() => (busy ? void stop() : start())} disabled={phase === 'starting' || phase === 'error' || phase === 'saving'}
          aria-label={busy ? 'Stop recording' : 'Start recording'}
          title={busy ? 'Stop (Space)' : 'Start recording'}
          className={recording ? 'vr-live' : undefined}
          style={{
            flexShrink: 0, minWidth: 128, height: 56, padding: '0 18px 0 8px', borderRadius: 28, border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 10,
            background: busy ? '#ef4444' : '#22c55e', color: '#fff',
            boxShadow: busy ? '0 0 0 0 rgba(239,68,68,0.6)' : '0 6px 18px -6px rgba(34,197,94,0.7)',
            opacity: phase === 'starting' || phase === 'error' || phase === 'saving' ? 0.45 : 1,
          }}>
          <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 20, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.22)' }}>
            {phase === 'count'
              ? <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{count}</span>
              : busy
                ? <svg width="18" height="18" viewBox="0 0 18 18"><rect x="1" y="1" width="16" height="16" rx="3" fill="#fff" /></svg>
                : <svg width="20" height="20" viewBox="0 0 20 20"><path d="M5 2.8v14.4a1 1 0 0 0 1.5.86l12-7.2a1 1 0 0 0 0-1.72l-12-7.2A1 1 0 0 0 5 2.8z" fill="#fff" /></svg>}
          </span>
          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.01em' }}>
            {phase === 'count' ? 'Cancel' : busy ? 'Stop' : 'Record'}
          </span>
        </button>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
            {recording && <span className="vr-dot" style={{ width: 8, height: 8, borderRadius: 4, background: '#ef4444', animation: 'vr-blink 1s steps(2) infinite' }} />}
            <span>
              {phase === 'starting' ? 'Opening the microphone…'
                : phase === 'error' ? 'Microphone not available'
                  : phase === 'count' ? 'Get ready…'
                    : recording ? `Recording · ${fmt(now - takeFrom)}`
                      : phase === 'saving' ? 'Saving the take…'
                        : lastTake ? 'Saved on the timeline' : 'Press Record — the clip plays while you talk'}
            </span>
          </div>
          {/* Mic level */}
          <div aria-hidden="true" style={{ height: 6, borderRadius: 3, background: 'rgb(var(--ed-fg, 255 255 255) / 0.1)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.round(level * 100)}%`, background: level > 0.9 ? '#ef4444' : '#22c55e', transition: 'width 80ms linear' }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: busy ? 'default' : 'pointer', color: 'rgb(var(--ed-fg, 255 255 255) / 0.75)' }}>
            <input type="checkbox" checked={p.muteOriginal} disabled={busy} onChange={e => p.onMuteOriginal(e.target.checked)} className="accent-purple-500" />
            Mute the original voice under my recording (dub)
          </label>
        </div>

        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          {lastTake && !busy && (
            <button type="button" onClick={() => start(lastTake)} disabled={phase !== 'ready'}
              title="Record the last take again (it replaces it)"
              style={{ padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: 'rgb(var(--ed-fg, 255 255 255) / 0.08)', color: 'inherit' }}>
              ↺ Retake
            </button>
          )}
          <button type="button" onClick={() => p.onClose()} disabled={busy}
            style={{ padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: 'none', cursor: busy ? 'default' : 'pointer', background: 'rgb(var(--ed-fg, 255 255 255) / 0.08)', color: 'inherit', opacity: busy ? 0.4 : 1 }}>
            Done
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 11, color: 'rgb(var(--ed-fg, 255 255 255) / 0.5)' }}>
        {devices.length > 1 ? (
          <select value={deviceId} disabled={busy} onChange={e => { setDeviceId(e.target.value); void openMic(e.target.value) }}
            aria-label="Microphone"
            style={{ maxWidth: 220, fontSize: 11, padding: '3px 6px', borderRadius: 6, background: 'rgb(var(--ed-fg, 255 255 255) / 0.06)', color: 'inherit', border: '1px solid rgb(var(--ed-fg, 255 255 255) / 0.12)' }}>
            {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
          </select>
        ) : null}
        <span style={{ flex: 1, minWidth: 0 }}>🎧 Use headphones so the clip’s sound isn’t recorded too · Space or Esc stops</span>
      </div>
      {(error || notice) && <p role="alert" style={{ margin: '8px 0 0', fontSize: 12, color: error ? '#f87171' : '#fbbf24' }}>{error ?? notice}</p>}
      {phase === 'error' && (
        <button type="button" onClick={() => void openMic(deviceId)} style={{ marginTop: 6, padding: '5px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: 'rgb(var(--ed-fg, 255 255 255) / 0.1)', color: 'inherit' }}>
          Try again
        </button>
      )}
      <style>{'@keyframes vr-blink { 0% { opacity: 1 } 100% { opacity: 0.2 } } .vr-live { animation: vr-pulse 1.4s ease-out infinite } @keyframes vr-pulse { 0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.6) } 100% { box-shadow: 0 0 0 12px rgba(239,68,68,0) } } @media (prefers-reduced-motion: reduce) { .vr-live { animation: none } }'}</style>
    </div>
  )
}
