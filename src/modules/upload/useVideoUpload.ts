'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Uploads a video straight from the browser to R2 as a multipart upload: the file goes up in
// 16 MB parts, PARALLEL_PARTS at once (one at a time left most of the connection idle — each part
// also waited for its own signature from our server first; the parts' links are now asked for in
// batches). A failed part is retried on its own, the upload waits while the browser is offline,
// and "Retry" after a failure continues with the parts R2 doesn't have yet instead of starting again.
// A dropped connection (user, 2026-11-01: Wi-Fi off and on again took very long to carry on): the
// parts on their way hung on the dead connection until the browser gave up on them, minutes later.
// Now going offline drops them at once, a part that has sent nothing for STALL_MS is dropped and
// sent again, and back online the upload carries on straight away (a drop isn't counted as one of
// a part's tries; the card says it's waiting for the connection meanwhile). Our server only signs each request (/api/ingest/sign),
// which is where the plan's size and video-count limits are checked. The state carries the
// measured speed and time left (uploadPace), and each upload logs how fast it went.

/** (8 MB: a part cut off by a dropped connection is sent again from its start — less to send again) */
const PART_SIZE = 8 * 1024 * 1024
/** Parts going up at once (browsers open about 6 connections to one host) */
const PARALLEL_PARTS = 6
/** Part links signed per request to our server */
const SIGN_BATCH = 24
/** Tries for a part the server refused (an expired link…); a dropped connection while online counts
 *  against NET_TRIES instead, and none while offline (it waits) */
const PART_TRIES = 3
const NET_TRIES = 12
/** A part that has sent nothing for this long is on a dead connection: dropped and sent again */
const STALL_MS = 12_000
/** After its last byte, how long a part may wait for R2's answer before it is sent again */
const ANSWER_MS = 45_000
/** A request to our server (signing) that hasn't answered in this long is asked again */
const SIGN_TIMEOUT_MS = 20_000
/** Progress reaches the page at most this often (each part reports many times a second: redrawing the page for each was wasted work) */
const REPORT_MS = 250
/** The speed shown is over the last this long (steady, but still follows a change in the connection) */
const SPEED_WINDOW_MS = 8000
/** No speed or time left until it has been measured this long (the first second runs fast: the
 *  browser counts bytes as sent once they're in the connection's buffer, before they've gone) */
const SPEED_MIN_MS = 3000
/** How far the time left moves towards each new estimate (4 reports a second: settles in ~1 s) */
const LEFT_EASE = 0.3

export type UploadPhase = 'idle' | 'uploading' | 'finishing' | 'failed'

export interface UploadState {
  phase: UploadPhase
  fileName: string
  /** 0–100 */
  progress: number
  error: string | null
  /** A failed upload can continue (connection problems); a refused one can't (plan limit, file type) */
  canRetry: boolean
  /** Bytes in R2 so far, of `total` */
  loaded: number
  total: number
  /** Measured upload speed (bytes a second) and the time left at it; null until measured */
  bytesPerSec: number | null
  secondsLeft: number | null
  /** The connection is gone: it carries on by itself once it's back */
  offline: boolean
}

const IDLE: UploadState = { phase: 'idle', fileName: '', progress: 0, error: null, canRetry: false, loaded: 0, total: 0, bytesPerSec: null, secondsLeft: null, offline: false }

/** "924 MB", "1.4 GB" */
export function formatBytes(n: number) {
  const mb = n / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`
}
/** The speed and time left, e.g. "6.2 MB/s · about 2 min left" (null until measured) */
export function uploadPace(s: UploadState): string | null {
  if (s.bytesPerSec == null || s.secondsLeft == null) return null
  const left = s.secondsLeft
  const time = left < 10 ? 'a few seconds' : `about ${left < 60 ? `${Math.ceil(left / 10) * 10} s` : left < 3600 ? `${Math.ceil(left / 60)} min` : `${Math.floor(left / 3600)} h ${Math.ceil((left % 3600) / 60)} min`}`
  return `${(s.bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s · ${time} left`
}

async function readDurationMs(file: File): Promise<number | undefined> {
  try {
    return await new Promise<number>((resolve, reject) => {
      const v = document.createElement('video')
      v.preload = 'metadata'
      const url = URL.createObjectURL(file)
      v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Math.round(v.duration * 1000)) }
      v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('metadata')) }
      v.src = url
    })
  } catch {
    return undefined // e.g. a format this browser can't read; the worker fills it in later
  }
}

/** A refusal from our server (plan limit, file type…): shown as it is, and `final` ones can't be retried */
const userError = (message: string, final: boolean) => Object.assign(new Error(message), { userFacing: true, final })
/** Aborts when any of `signals` does, or after `ms` (AbortSignal.any / .timeout are missing from older
 *  Safari: done by hand there) */
function limitSignal(ms: number, signals: AbortSignal[]): AbortSignal {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(new DOMException('Timed out', 'TimeoutError')), ms)
  for (const sg of signals) {
    if (sg.aborted) { c.abort(sg.reason); break }
    sg.addEventListener('abort', () => c.abort(sg.reason), { once: true })
  }
  c.signal.addEventListener('abort', () => clearTimeout(t), { once: true })
  return c.signal
}
/** A dropped or dead connection (not a refusal): sent again once the connection is back */
const netError = (message: string) => Object.assign(new Error(message), { network: true })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
/** Resolves once the browser is online (at once when it is) */
function online(): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine) return Promise.resolve()
  return new Promise(r => window.addEventListener('online', () => r(), { once: true }))
}

/** What a running (or interrupted) upload has got to: kept so Retry carries on from there */
interface Multipart { key: string; uploadId: string; etags: (string | null)[] }

/** `asset`: B-roll uploaded in the editor (kept off the dashboard, not counted as a video) */
export function useVideoUpload(onDone: (videoId: string) => void, { asset = false }: { asset?: boolean } = {}) {
  const [state, setState] = useState<UploadState>(IDLE)
  const fileRef = useRef<File | null>(null)
  const mpRef = useRef<Multipart | null>(null)
  /** Set once the file is in R2: a failure after that only needs the last step again */
  const uploadedKeyRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const xhrs = useRef(new Set<XMLHttpRequest>())
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  // Leaving the page mid-upload loses it: ask first. Unmounting stops it and removes the parts.
  const busy = state.phase === 'uploading' || state.phase === 'finishing'
  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])
  useEffect(() => () => { stopAll(); abortMultipart(mpRef.current) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** The file's length, read once: sent when the upload starts, so the plan's hours are checked before it runs */
  const durationRef = useRef<number | undefined>(undefined)
  // The price the upload card is asking about, and the answer it is waiting for
  const [priceAsk, setPriceAsk] = useState<{ minutes: number; credits: number; balance: number } | null>(null)
  const priceAnswerRef = useRef<((yes: boolean) => void) | null>(null)
  /** The file already said yes to: a dropped connection or Retry doesn't ask again */
  const pricePaidForRef = useRef<File | null>(null)
  /**
   * Reading a video costs credits: asked before anything is uploaded.
   * (Nothing asked when credits are off, or if the price can't be fetched: the server still checks.)
   */
  async function askReadingPrice(file: File) {
    durationRef.current = await readDurationMs(file)
    if (asset || !durationRef.current || pricePaidForRef.current === file) return
    const res = await fetch('/api/ingest/reading-price', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ duration_ms: durationRef.current }),
    }).catch(() => null)
    const p = await res?.json().catch(() => null) as { on?: boolean; credits?: number; overMs?: number; balance?: number } | null
    if (!p?.on || !p.credits) return
    // (past the hours, or without enough credits, the server refuses the upload and says so)
    if (p.overMs || p.credits > (p.balance ?? 0)) return
    // Asked on the upload card (priceAsk); Cancel there ends the upload (cancel, which answers no)
    const yes = await new Promise<boolean>(resolve => {
      priceAnswerRef.current = resolve
      setPriceAsk({ minutes: Math.ceil(durationRef.current! / 60_000), credits: p.credits!, balance: p.balance ?? 0 })
    })
    priceAnswerRef.current = null
    setPriceAsk(null)
    if (!yes) throw userError('Upload stopped. No credits were used.', true)
    pricePaidForRef.current = file
  }

  async function sign(body: Record<string, unknown>) {
    const f = fileRef.current
    // (a request on a connection that died never answers: asked again after SIGN_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch('/api/ingest/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, file: f ? { name: f.name, size: f.size, type: f.type, ...(durationRef.current ? { duration_ms: durationRef.current } : {}) } : undefined, ...(asset ? { asset: true } : {}) }),
        signal: timed(SIGN_TIMEOUT_MS),
      })
    } catch (e) {
      if (abortRef.current?.signal.aborted) throw e
      throw netError('Network error')
    }
    const data = await res.json().catch(() => ({}))
    // 4xx = we refused it (plan limit, file type…): show why, and don't offer Retry
    if (!res.ok) throw userError(data.error ?? 'Upload failed', res.status < 500)
    return data
  }

  /** Cancel's signal, and a time limit (a request on a dead connection never answers) */
  function timed(ms: number): AbortSignal {
    return limitSignal(ms, abortRef.current ? [abortRef.current.signal] : [])
  }

  function stopAll() {
    abortRef.current?.abort()
    for (const x of xhrs.current) x.abort()
    xhrs.current.clear()
  }
  function abortMultipart(mp: Multipart | null) {
    if (!mp) return
    fetch('/api/ingest/sign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'DELETE', key: mp.key, uploadId: mp.uploadId }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => (d?.url ? fetch(d.url, { method: 'DELETE' }) : null))
      .catch(() => { /* the bucket's lifecycle rule is the backstop */ })
  }

  /** Start the multipart upload in R2: its key (from our server) and upload id (from R2) */
  async function create(file: File): Promise<Multipart> {
    const s = await sign({ method: 'POST', key: '' }) as { url: string; key: string; headers?: Record<string, string> }
    const res = await fetch(s.url, { method: 'POST', headers: s.headers, signal: timed(30_000) }).catch(e => { throw abortRef.current?.signal.aborted ? e : netError('Network error') })
    if (!res.ok) throw new Error(`Could not start the upload (${res.status})`)
    const uploadId = (await res.text()).match(/<UploadId>([^<]+)<\/UploadId>/)?.[1]
    if (!uploadId) throw new Error('Could not start the upload')
    return { key: s.key, uploadId, etags: Array(Math.max(1, Math.ceil(file.size / PART_SIZE))).fill(null) }
  }

  /** Parts on their way that were dropped for the connection (offline, stalled), not by Cancel */
  const dropped = useRef(new WeakSet<XMLHttpRequest>())
  /** One part up (XHR: its progress counts as it goes). Resolves with its ETag. A part that stops
   *  moving (a dead connection) is dropped after STALL_MS — ANSWER_MS once all of it is sent */
  function putPart(url: string, blob: Blob, onBytes: (n: number) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest()
      xhrs.current.add(x)
      let last = Date.now()
      let allSent = false
      const watch = setInterval(() => {
        if (Date.now() - last > (allSent ? ANSWER_MS : STALL_MS)) { dropped.current.add(x); x.abort() }
      }, 2000)
      const end = () => { clearInterval(watch); xhrs.current.delete(x) }
      x.open('PUT', url)
      x.upload.onprogress = e => { last = Date.now(); allSent = e.loaded >= blob.size; onBytes(e.loaded) }
      x.onload = () => {
        end()
        const etag = x.getResponseHeader('ETag')
        if (x.status >= 200 && x.status < 300 && etag) resolve(etag)
        else reject(new Error(`Part failed (${x.status})`))
      }
      x.onerror = () => { end(); reject(netError('Network error')) }
      x.onabort = () => { end(); reject(dropped.current.has(x) ? netError('Connection dropped') : Object.assign(new Error('Aborted'), { aborted: true })) }
      x.send(blob)
    })
  }

  /** Every part R2 doesn't have yet, PARALLEL_PARTS at once; progress over the whole file */
  async function uploadParts(file: File, mp: Multipart) {
    const n = mp.etags.length
    const sent = new Array<number>(n).fill(0)
    mp.etags.forEach((e, i) => { if (e) sent[i] = Math.min(PART_SIZE, file.size - i * PART_SIZE) })
    // Speed: bytes sent over the last SPEED_WINDOW_MS (parts R2 already had don't count)
    const samples: Array<{ t: number; done: number }> = []
    const began = performance.now()
    const before = sent.reduce((a, b) => a + b, 0)
    let lastReport = 0
    let pending: ReturnType<typeof setTimeout> | null = null
    // The time left shown: what is left at the measured speed, eased towards each new estimate
    // (follows the connection both ways, without jumping at every report)
    let shownLeft: number | null = null
    const report = (now = false) => {
      const t = performance.now()
      if (!now && t - lastReport < REPORT_MS) {
        pending ??= setTimeout(() => { pending = null; report(true) }, REPORT_MS - (t - lastReport))
        return
      }
      if (pending) { clearTimeout(pending); pending = null }
      lastReport = t
      const done = sent.reduce((a, b) => a + b, 0)
      samples.push({ t, done })
      while (samples.length > 2 && t - samples[0].t > SPEED_WINDOW_MS) samples.shift()
      const span = t - samples[0].t
      const speed = t - began >= SPEED_MIN_MS && span > 0 ? Math.max(0, ((done - samples[0].done) * 1000) / span) : null
      if (speed) {
        const estimate = (file.size - done) / speed
        shownLeft = shownLeft == null ? estimate : shownLeft + (estimate - shownLeft) * LEFT_EASE
      }
      setState(s => (s.phase === 'uploading' ? {
        ...s,
        progress: Math.min(99, Math.round((done / file.size) * 100)),
        loaded: done,
        total: file.size,
        bytesPerSec: speed,
        secondsLeft: shownLeft,
      } : s))
    }
    report(true)
    // Offline: the parts on their way are dropped at once (they'd hang on the dead connection), the
    // card says it's waiting; back online, the workers carry on at once (each waits in online())
    const goneOffline = () => {
      for (const x of xhrs.current) { dropped.current.add(x); x.abort() }
      setState(s => (s.phase === 'uploading' ? { ...s, offline: true, bytesPerSec: null, secondsLeft: null } : s))
    }
    const backOnline = () => {
      // (the speed is measured again from here)
      samples.length = 0; shownLeft = null
      setState(s => (s.phase === 'uploading' ? { ...s, offline: false } : s))
    }
    window.addEventListener('offline', goneOffline)
    window.addEventListener('online', backOnline)
    const todo = mp.etags.map((e, i) => (e ? -1 : i)).filter(i => i >= 0)
    const urls = new Map<number, string>()
    /** Links for the next parts, signed in batches ahead of need */
    let signing: Promise<void> | null = null
    async function urlFor(i: number): Promise<string> {
      while (!urls.has(i)) {
        if (!signing) {
          const want = todo.filter(j => !urls.has(j)).slice(0, SIGN_BATCH)
          signing = sign({ method: 'PUT', key: mp.key, uploadId: mp.uploadId, partNumbers: want.map(j => j + 1) })
            .then((d: { urls: Record<string, string> }) => { for (const j of want) if (d.urls[j + 1]) urls.set(j, d.urls[j + 1]) })
            .finally(() => { signing = null })
        }
        await signing
      }
      return urls.get(i)!
    }
    let next = 0
    async function worker() {
      while (next < todo.length) {
        const i = todo[next++]
        const blob = file.slice(i * PART_SIZE, Math.min(file.size, (i + 1) * PART_SIZE))
        let refused = 0, drops = 0
        for (;;) {
          await online()
          try {
            const etag = await putPart(await urlFor(i), blob, b => { sent[i] = b; report() })
            mp.etags[i] = etag
            sent[i] = blob.size
            report(true)
            break
          } catch (e) {
            const info = e as { aborted?: boolean; userFacing?: boolean; network?: boolean }
            if (info.aborted || info.userFacing || abortRef.current?.signal.aborted) throw e
            sent[i] = 0
            report(true)
            urls.delete(i)   // (a link that failed may have run out: a fresh one)
            if (info.network) {
              // Offline: no try used up — it waits for the connection (online()), then goes again at once
              if (typeof navigator !== 'undefined' && !navigator.onLine) continue
              if (++drops >= NET_TRIES) throw e
              await sleep(Math.min(8000, 500 * 2 ** (drops - 1)))
            } else {
              if (++refused >= PART_TRIES) throw e
              await sleep(1000 * 2 ** (refused - 1))
            }
          }
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, todo.length) }, worker))
    } finally {
      if (pending) clearTimeout(pending)
      window.removeEventListener('offline', goneOffline)
      window.removeEventListener('online', backOnline)
    }
    // How it went, for checking the connection (the browser's console)
    const secs = (performance.now() - began) / 1000
    const bytes = file.size - before
    if (bytes > 0 && secs > 0) console.info(`[upload] ${formatBytes(bytes)} in ${Math.round(secs)} s — ${(bytes / (1024 * 1024) / secs).toFixed(1)} MB/s (${((bytes * 8) / 1e6 / secs).toFixed(0)} Mbit/s)`)
  }

  /** All parts are in: R2 joins them into the file */
  async function complete(mp: Multipart) {
    const s = await sign({ method: 'POST', key: mp.key, uploadId: mp.uploadId }) as { url: string }
    const body = `<CompleteMultipartUpload>${mp.etags.map((e, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${e}</ETag></Part>`).join('')}</CompleteMultipartUpload>`
    const res = await fetch(s.url, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body, signal: timed(60_000) }).catch(e => { throw abortRef.current?.signal.aborted ? e : netError('Network error') })
    const text = await res.text()
    if (!res.ok || /<Error>/.test(text)) throw new Error('Could not finish the upload')
  }

  async function finish(file: File, key: string) {
    setState(s => ({ ...s, phase: 'finishing', progress: 100, loaded: file.size, bytesPerSec: null, secondsLeft: null }))
    const durationMs = durationRef.current ?? await readDurationMs(file)
    const res = await fetch('/api/ingest/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage_path: key, title: file.name.replace(/\.[^.]+$/, ''), ...(durationMs ? { duration_ms: durationMs } : {}), ...(asset ? { asset: true } : {}) }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw userError(data.error ?? 'Upload failed', res.status < 500)
    return data.video_id as string
  }

  async function run(resumes = 0) {
    const file = fileRef.current
    if (!file) return
    abortRef.current = new AbortController()
    try {
      let key = uploadedKeyRef.current
      if (!key) {
        await online()
        if (!mpRef.current) {
          await askReadingPrice(file)
          mpRef.current = await create(file)
        }
        const mp = mpRef.current
        await uploadParts(file, mp)
        await complete(mp)
        key = mp.key
        uploadedKeyRef.current = key
        mpRef.current = null
      }
      const videoId = await finish(file, key)
      setState(IDLE)
      fileRef.current = null; uploadedKeyRef.current = null
      onDoneRef.current(videoId)
    } catch (e) {
      if (fileRef.current !== file) return   // cancelled, or another upload started
      stopAll()
      const info = e as { userFacing?: boolean; final?: boolean; network?: boolean }
      // The connection dropped at the start or the end (or a part ran out of tries on it): once it's
      // back, it carries on by itself from where it got to — a few times before asking for Retry
      if (info.network && resumes < 3) {
        setState(s => (s.phase === 'uploading' ? { ...s, offline: typeof navigator !== 'undefined' && !navigator.onLine } : s))
        await online()
        await sleep(1500)
        if (fileRef.current !== file) return
        setState(s => (s.phase === 'uploading' ? { ...s, offline: false } : s))
        return run(resumes + 1)
      }
      const message = e instanceof Error && info.userFacing
        ? e.message
        : 'The upload was interrupted. Check your connection and press Retry — it continues where it stopped.'
      setState(s => ({ ...s, phase: 'failed', error: message, canRetry: !info.final, offline: false }))
    }
  }

  const start = useCallback((file: File) => {
    priceAnswerRef.current?.(false)
    stopAll()
    abortMultipart(mpRef.current)
    fileRef.current = file
    mpRef.current = null
    uploadedKeyRef.current = null
    setState({ ...IDLE, phase: 'uploading', fileName: file.name, total: file.size })
    run()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => {
    if (!fileRef.current) return
    // (the speed is measured again from here)
    setState(s => ({ ...s, phase: 'uploading', error: null, canRetry: false, bytesPerSec: null, secondsLeft: null, offline: false }))
    run()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Stop the upload and remove what reached R2 */
  const cancel = useCallback(() => {
    fileRef.current = null
    priceAnswerRef.current?.(false)
    stopAll()
    // The parts of an unfinished upload go with it
    abortMultipart(mpRef.current)
    mpRef.current = null
    // A file that finished uploading but never became a video (the last step failed) is removed
    // here; the server refuses if it already belongs to a video
    const orphan = uploadedKeyRef.current
    if (orphan) {
      fetch('/api/ingest/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'DELETE', key: orphan }),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(d => (d?.url ? fetch(d.url, { method: 'DELETE' }) : null))
        .catch(() => { /* the bucket's lifecycle rule is the backstop */ })
    }
    uploadedKeyRef.current = null
    setState(IDLE)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Yes to the price the card is asking about */
  const confirmPrice = useCallback(() => { priceAnswerRef.current?.(true) }, [])

  return { state, start, retry, cancel, priceAsk, confirmPrice }
}
