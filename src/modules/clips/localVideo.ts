'use client'

import { useEffect, useSyncExternalStore } from 'react'

/**
 * The whole video, downloaded once into the browser, so the clip board's player never waits on
 * the network again: playing from any moment and dragging along it read from the computer
 * (a jump is only the decode).
 *
 * - Fetched in full while the clip board is open; until it is all here the player streams from
 *   the link as before, then switches over in place.
 * - Written straight to the browser's Cache Storage as it arrives (on disk, not held in the
 *   page's memory), under the file's own key — the storage path, not the signed link, which
 *   changes every visit — so opening the same video again is instant. Only the last few videos
 *   are kept.
 * - Leaving the clip board stops a download that hasn't finished (it must not eat the connection
 *   other pages stream their videos on) and lets go of the copy (it stays in the cache).
 * - Progress is a separate subscription (useLocalVideoProgress), so only the player re-renders
 *   as it moves, not the page around it.
 * - Too big (MAX_BYTES), no Cache Storage, no room, or the download fails: it keeps streaming.
 */

const CACHE = 'shortcut-videos-v1'
const KEEP = 3
const MAX_BYTES = 2 * 1024 ** 3
/** A page left (or remounted) within this long keeps its download going */
const LINGER_MS = 4000
const cacheKey = (key: string) => `/__local-video/${encodeURIComponent(key)}`

type Entry = {
  url: string | null
  progress: number | null
  users: number
  /** Downloads when it isn't saved (an entry that only looks for a saved copy doesn't) */
  fetching: boolean
  abort: AbortController
  drop: ReturnType<typeof setTimeout> | null
}
const entries = new Map<string, Entry>()
// (one list for all: a player can subscribe before its page's effect has made the entry)
const listeners = new Set<() => void>()

function notify() { for (const l of listeners) l() }

async function evictOld(c: Cache) {
  const reqs = await c.keys()
  if (reqs.length <= KEEP) return
  const dated = await Promise.all(reqs.map(async r => ({ r, at: Number((await c.match(r))?.headers.get('X-Saved-At') ?? 0) })))
  dated.sort((a, b) => b.at - a.at)
  await Promise.all(dated.slice(KEEP).map(d => c.delete(d.r)))
}

async function load(src: string, key: string, e: Entry, fetchIfMissing = true) {
  const done = (url: string | null) => {
    if (e.abort.signal.aborted) { if (url) URL.revokeObjectURL(url); return }
    e.url = url
    e.progress = null
    notify()
  }
  try {
    if (typeof caches === 'undefined') return done(null)
    const c = await caches.open(CACHE)
    const req = cacheKey(key)
    let hit = await c.match(req)
    if (!hit && !fetchIfMissing) return done(null)
    if (!hit) {
      const res = await fetch(src, { signal: e.abort.signal })
      if (!res.ok || !res.body) return done(null)
      const total = Number(res.headers.get('Content-Length') ?? 0)
      if (total > MAX_BYTES) return done(null)
      // Counted on the way to the cache (shown in steps of 2%)
      let got = 0, shown = 0
      const counted = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctl) {
          got += chunk.byteLength
          if (got > MAX_BYTES) throw new Error('too big to hold')
          const p = total ? Math.min(0.99, got / total) : 0
          if (p - shown >= 0.02) { shown = p; e.progress = p; notify() }
          ctl.enqueue(chunk)
        },
      }))
      await c.put(req, new Response(counted, {
        headers: { 'Content-Type': res.headers.get('Content-Type') || 'video/mp4', 'X-Saved-At': String(Date.now()) },
      }))
      void evictOld(c).catch(() => {})
      hit = await c.match(req)
    }
    // (a blob read from the cache stays on disk: it doesn't fill the page's memory)
    const blob = hit ? await hit.blob() : null
    done(blob && blob.size > 0 ? URL.createObjectURL(blob) : null)
  } catch {
    done(null)
  }
}

function enter(src: string, key: string, fetchIfMissing = true) {
  let e = entries.get(key)
  if (!e) {
    e = { url: null, progress: fetchIfMissing ? 0 : null, users: 0, fetching: fetchIfMissing, abort: new AbortController(), drop: null }
    entries.set(key, e)
    void load(src, key, e, fetchIfMissing)
    notify()
  } else if (fetchIfMissing && !e.fetching && !e.url) {
    // (one that only looked for a saved copy, and the clip board now wants it: it downloads)
    e.fetching = true
    e.progress = 0
    void load(src, key, e, true)
    notify()
  }
  if (e.drop) { clearTimeout(e.drop); e.drop = null }
  e.users++
}

function leave(key: string) {
  const e = entries.get(key)
  if (!e) return
  e.users--
  if (e.users > 0) return
  e.drop = setTimeout(() => {
    if (e.users > 0) return
    e.abort.abort()
    if (e.url) URL.revokeObjectURL(e.url)
    entries.delete(key)
    notify()
  }, LINGER_MS)
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

function useEntry<T>(k: string, pick: (e: Entry | undefined) => T, server: T): T {
  return useSyncExternalStore(subscribe, () => pick(entries.get(k)), () => server)
}

/**
 * The URL to play `src` from: the downloaded copy once it is all here, else `src` itself.
 * Starts (or joins) the download. `key` names the file across visits (its storage path).
 */
export function useLocalVideo(src: string | null | undefined, key?: string | null, opts?: {
  /**
   * false: only a copy already here or coming (the clip board's, saved or still downloading) is used — no
   * download of its own. Watch as reels (user, 2026-11-19): a whole-video download there took the
   * connection from the reels being watched; there each reel streams its own part when played
   */
  download?: boolean
}): string {
  const k = key || src || ''
  const fetchIfMissing = opts?.download !== false
  useEffect(() => {
    if (!src || !k) return
    enter(src, k, fetchIfMissing)
    return () => leave(k)
  }, [src, k, fetchIfMissing])
  const url = useEntry(k, e => e?.url ?? null, null)
  return url ?? src ?? ''
}

/** How far the download of `key` is: 0 → 1; null when there is nothing to wait for */
export function useLocalVideoProgress(key: string | null | undefined): number | null {
  return useEntry(key || '', e => (e ? e.progress : null), null)
}
