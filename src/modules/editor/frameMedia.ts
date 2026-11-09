import type { SegmentLocal, FrameItem } from '@chai-cut/shared'
import { isFrameLayout, frameOf, mainAudioVolume, itemSourceAt } from './frames'

// Media a frame's lanes show besides the main video: other uploaded videos and photos. The
// preview canvas draws them; this keeps one element per video item, in step with the main
// player (looping, since frames loop shorter videos), and plays each item's sound at the volume
// set for the export so the preview sounds like the result.

export interface FrameMediaPool {
  /** The element playing a video item */
  video: (item: FrameItem) => HTMLVideoElement | null
  image: (url: string) => HTMLImageElement | null
  /** Call every frame with the format being shown; plays/pauses/seeks its videos to match */
  sync: (seg: SegmentLocal | null, clipMs: number, playing: boolean, main?: HTMLVideoElement | null) => void
  /** The editor's "Original video sound" level (0–1): scales the main video's sound everywhere */
  setMainGain: (gain: number) => void
  dispose: () => void
}

// Start loading a video item this long before it appears, so it's ready on time
const PRELOAD_MS = 2000

export function createFrameMediaPool(getVideoUrl: (videoId: string) => string | undefined): FrameMediaPool {
  const videos = new Map<string, { el: HTMLVideoElement; videoId: string }>()
  const images = new Map<string, HTMLImageElement>()

  function video(item: FrameItem) {
    if (!item.source_video_id) return null
    let entry = videos.get(item.id)
    if (entry && entry.videoId !== item.source_video_id) { release(item.id); entry = undefined }
    if (!entry) {
      const url = getVideoUrl(item.source_video_id)
      if (!url) return null
      const el = document.createElement('video')
      el.crossOrigin = 'anonymous'
      el.preload = 'auto'
      el.playsInline = true
      el.loop = true
      el.muted = true
      el.src = url
      entry = { el, videoId: item.source_video_id }
      videos.set(item.id, entry)
    }
    return entry.el
  }

  function release(id: string) {
    const e = videos.get(id)
    if (!e) return
    e.el.pause(); e.el.removeAttribute('src'); e.el.load()
    videos.delete(id)
  }

  function image(url: string) {
    let img = images.get(url)
    if (!img) {
      img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = url
      images.set(url, img)
    }
    return img
  }

  let mainGain = 1
  function setMainGain(gain: number) { mainGain = Math.max(0, Math.min(1, gain)) }

  function sync(seg: SegmentLocal | null, clipMs: number, playing: boolean, main?: HTMLVideoElement | null) {
    const frame = seg && isFrameLayout(seg.layout) ? frameOf(seg) : null
    // The main video's own sound in this frame
    if (main) {
      // Every slot showing the main video adds its own sound (one element: capped at full volume)
      // …scaled by the editor's "Original video sound" level
      const vol = (frame ? Math.min(1, mainAudioVolume(frame)) : 1) * mainGain
      if (Math.abs(main.volume - vol) > 0.01) main.volume = Math.max(0, Math.min(1, vol))
    }
    const inUse = new Set<string>()
    for (const it of frame?.items ?? []) {
      if (it.kind !== 'video' || !it.source_video_id || !seg) continue
      const from = Math.max(it.start_ms, seg.start_ms), to = Math.min(it.end_ms, seg.end_ms)
      if (clipMs < from - PRELOAD_MS || clipMs >= to) continue
      const v = video(it)
      if (!v) continue
      inUse.add(it.id)
      if (!(v.duration > 0)) continue
      const showing = clipMs >= from
      // Where this item's video should be, looping over its own length (frozen, or in one of its
      // freeze stretches: held on that picture, silent — render.py holds that one picture)
      const at = itemSourceAt(it, clipMs)
      const target = (at.ms / 1000) % v.duration
      const drift = Math.abs(v.currentTime - target)
      const vol = it.muted || at.held ? 0 : it.volume ?? 1
      v.muted = !showing || vol <= 0
      v.volume = Math.max(0, Math.min(1, vol))
      if (playing && showing && !at.held) {
        if (v.paused) v.play().catch(() => {})
        if (drift > 0.35 && drift < v.duration - 0.35) v.currentTime = target
      } else {
        if (!v.paused) v.pause()
        if (drift > 0.04 && !v.seeking) v.currentTime = target
      }
    }
    for (const [id, e] of videos) {
      if (inUse.has(id)) continue
      if (!e.el.paused) e.el.pause()
      e.el.muted = true
    }
    // Drop elements of items that no longer exist anywhere near here
    if (videos.size > 12) for (const id of [...videos.keys()]) if (!inUse.has(id)) release(id)
  }

  function dispose() {
    for (const id of [...videos.keys()]) release(id)
    images.clear()
  }

  return { video, image, sync, setMainGain, dispose }
}
