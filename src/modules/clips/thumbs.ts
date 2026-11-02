'use client'

import { useEffect, useState } from 'react'

/**
 * Still frames of a video at given moments, for clip and suggestion thumbnails. One hidden video
 * per source grabs the frames one after another (seek → draw → JPEG); results are cached for the
 * page, so a card that re-renders or comes back shows its picture straight away.
 */

const W = 192, H = 108
const cache = new Map<string, string>()
const waiters = new Map<string, Array<(url: string | null) => void>>()
/** A face to cut out: its box (fractions of the frame); the picture is a square around it, `px` wide */
type FaceCrop = { x: number; y: number; w: number; h: number; px: number }
type Job = { key: string; atSec: number; face?: FaceCrop; tries?: number; width?: number }

/** The frame now on screen is drawn (a paused video's new frame after a seek), or a short wait where that can't be told */
function framePresented(video: HTMLVideoElement): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, 600)
    const done = () => { clearTimeout(t); resolve() }
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }
    if (typeof v.requestVideoFrameCallback === 'function') v.requestVideoFrameCallback(done)
    else requestAnimationFrame(() => requestAnimationFrame(done))
  })
}

/**
 * Go to `at` (seconds) and wait until its picture is the one shown. A picture was drawn on 'seeked'
 * alone, and that came before the new frame was decoded — or from the seek before (a 4 s wait ran
 * out, its listener stayed, and fired for the next job): the Subjects tool showed scene 1's picture
 * as scene 2's (user, 2026-10-24). False when it didn't get there.
 */
async function seekTo(video: HTMLVideoElement, at: number): Promise<boolean> {
  if (Math.abs(video.currentTime - at) > 0.001 || video.readyState < 2) {
    video.currentTime = at
    const arrived = await new Promise<boolean>(resolve => {
      const t = setTimeout(() => { video.removeEventListener('seeked', on); resolve(false) }, 10000)
      function on() {
        if (video.seeking) return
        clearTimeout(t)
        video.removeEventListener('seeked', on)
        resolve(true)
      }
      video.addEventListener('seeked', on)
    })
    if (!arrived) return false
  }
  await framePresented(video)
  return Math.abs(video.currentTime - at) < 0.05 && video.readyState >= 2
}
const queues = new Map<string, { video: HTMLVideoElement; jobs: Job[]; busy: boolean }>()

function keyOf(src: string, ms: number) { return `${src}#${Math.round(ms / 100)}` }

function settle(key: string, url: string | null) {
  if (url) cache.set(key, url)
  for (const w of waiters.get(key) ?? []) w(url)
  waiters.delete(key)
}

async function run(src: string) {
  const q = queues.get(src)
  if (!q || q.busy) return
  q.busy = true
  const { video } = q
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  try {
    if (video.readyState < 1) {
      await new Promise<void>(r => {
        const t = setTimeout(r, 8000)
        video.addEventListener('loadedmetadata', () => { clearTimeout(t); r() }, { once: true })
      })
    }
    while (q.jobs.length) {
      const job = q.jobs.shift()!
      if (cache.has(job.key)) { settle(job.key, cache.get(job.key)!); continue }
      const dur = video.duration
      const at = isFinite(dur) && dur > 0 ? Math.min(job.atSec, Math.max(0, dur - 0.1)) : job.atSec
      if (!(await seekTo(video, at))) {
        // Not there (a slow read): once more at the back of the line, else no picture — never another moment's
        if ((job.tries ?? 0) < 1) q.jobs.push({ ...job, tries: (job.tries ?? 0) + 1 })
        else settle(job.key, null)
        continue
      }
      // A big picture (the Transitions preview screen): one more frame's wait, so what is drawn is the
      // fully decoded picture at the moment, never a half-ready one (user, 2026-11-01: a shot looked blurred)
      if (job.width) await framePresented(video)
      let url: string | null = null
      try {
        if (ctx && video.videoWidth && job.face) {
          // A square around the face (head and a little of the shoulders), from the full-size frame
          const vw = video.videoWidth, vh = video.videoHeight, f = job.face
          const side = Math.min(vw, vh, 2.1 * Math.max(f.w * vw, f.h * vh))
          const cx = (f.x + f.w / 2) * vw, cy = (f.y + f.h * 0.55) * vh
          const sx = Math.max(0, Math.min(vw - side, cx - side / 2)), sy = Math.max(0, Math.min(vh - side, cy - side / 2))
          canvas.width = f.px; canvas.height = f.px
          ctx.drawImage(video, sx, sy, side, side, 0, 0, f.px, f.px)
          url = canvas.toDataURL('image/jpeg', 0.85)
        } else if (ctx && video.videoWidth) {
          // Cover the 16:9 thumbnail, like object-fit: cover (a wider one asked for, e.g. the Transitions
          // preview screen: sharper, never more than the video's own size)
          const w = job.width ? Math.min(job.width, video.videoWidth) : W, h = Math.round((w * H) / W)
          canvas.width = w; canvas.height = h
          const s = Math.max(w / video.videoWidth, h / video.videoHeight)
          const dw = video.videoWidth * s, dh = video.videoHeight * s
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh)
          url = canvas.toDataURL('image/jpeg', job.width ? 0.9 : 0.7)
        }
      } catch { url = null }   // a source without CORS can't be read: no thumbnail
      settle(job.key, url)
    }
  } finally {
    q.busy = false
  }
}

function request(src: string, ms: number, face?: FaceCrop, width?: number): Promise<string | null> {
  const key = face ? `${keyOf(src, ms)}@${[face.x, face.y, face.w, face.h].map(v => v.toFixed(3)).join(',')}` : width ? `${keyOf(src, ms)}@w${width}` : keyOf(src, ms)
  if (cache.has(key)) return Promise.resolve(cache.get(key)!)
  return new Promise(resolve => {
    const list = waiters.get(key)
    if (list) { list.push(resolve); return }
    waiters.set(key, [resolve])
    let q = queues.get(src)
    if (!q) {
      const video = document.createElement('video')
      video.crossOrigin = 'anonymous'
      video.preload = 'auto'
      video.muted = true
      video.playsInline = true
      // On the page (2 px, invisible): a video that isn't shown may never present its new frame after a seek
      video.setAttribute('aria-hidden', 'true')
      video.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1'
      document.body.appendChild(video)
      video.src = src
      q = { video, jobs: [], busy: false }
      queues.set(src, q)
    }
    q.jobs.push({ key, atSec: ms / 1000, face, width })
    void run(src)
  })
}

/** A thumbnail of `src` at `ms` (a little into the moment, so it isn't a cut's first frame); null until ready.
 *  `width`: a bigger picture than a thumbnail (px, 16:9) */
export function useFrameAt(src: string | null | undefined, ms: number, width?: number): string | null {
  const at = ms + 600
  const k = (s: string) => (width ? `${keyOf(s, at)}@w${width}` : keyOf(s, at))
  const [url, setUrl] = useState<string | null>(() => (src ? cache.get(k(src)) ?? null : null))
  useEffect(() => {
    if (!src) return
    let alive = true
    const hit = cache.get(k(src))
    if (hit) { setUrl(hit); return }
    request(src, at, undefined, width).then(u => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [src, at, width]) // eslint-disable-line react-hooks/exhaustive-deps
  return url
}

/**
 * A square picture of a face: the frame of `src` at `ms` (the video's own time), cut out around
 * `box` (the face, fractions of the frame), `px` wide. Null until ready, or when it can't be read.
 */
export function useFaceAt(src: string | null | undefined, ms: number | null, box: { x: number; y: number; w: number; h: number } | null, px = 112): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const sig = box ? [box.x, box.y, box.w, box.h].map(v => v.toFixed(3)).join(',') : ''
  useEffect(() => {
    if (!src || ms === null || !box) { setUrl(null); return }
    let alive = true
    request(src, ms, { ...box, px }).then(u => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [src, ms, sig, px]) // eslint-disable-line react-hooks/exhaustive-deps
  return url
}
