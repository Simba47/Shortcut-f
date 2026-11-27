'use client'

import { create } from 'zustand'
import type { Tone, OnScreen } from '@/lib/notices'
import type { ConfirmOptions } from '@/components/editor/ConfirmDialog'

/**
 * The site's one message system (user, 2026-11-26): toasts at the bottom centre of every page, a confirm
 * question any code can ask (askConfirm), and what each page shows already (so a finished job isn't
 * toasted on top of it). The Toaster, ConfirmHost and ActivityWatcher in Providers show them.
 */

export interface ToastAction { label: string; href?: string; onClick?: () => void }
export interface Toast {
  id: string
  tone: Tone
  text: string
  action?: ToastAction | null
  /** In place of the tone's mark: the padlock (an edit not allowed) or the copy sign (Copy / Cut) */
  icon?: 'lock' | 'copy'
  /** How long it stays (ms); null: until closed. Default: 4 s done and notes, 6 s warnings, errors stay */
  ms?: number | null
  /** A live one (an upload's percent): no ×, no timer, the code that made it removes it */
  live?: boolean
  /** Bumped each time the same id is shown again, so its timer starts over */
  n: number
}

const MAX_TOASTS = 3
export const defaultMs = (tone: Tone): number | null => (tone === 'error' ? null : tone === 'warn' ? 6000 : 4000)

interface NoticeState {
  toasts: Toast[]
  confirm: (ConfirmOptions & { resolve: (ok: boolean, checked: boolean) => void }) | null
  onScreen: Record<string, OnScreen>
  /** Bumped by watchActivity(): the watcher looks for running work at once */
  kick: number
}

export const useNotices = create<NoticeState>(() => ({ toasts: [], confirm: null, onScreen: {}, kick: 0 }))

let seq = 0
/** Show a toast (the same id again replaces it in place). Returns its id */
export function toast(t: Omit<Toast, 'id' | 'n'> & { id?: string }): string {
  const id = t.id ?? `t${++seq}`
  useNotices.setState(s => {
    const old = s.toasts.find(x => x.id === id)
    const next: Toast = { ...t, id, n: (old?.n ?? 0) + 1 }
    const list = old ? s.toasts.map(x => (x.id === id ? next : x)) : [...s.toasts, next]
    // Up to three: the oldest goes first, an error last (it hasn't been seen to)
    while (list.length > MAX_TOASTS) {
      const i = list.findIndex(x => x.tone !== 'error' && x.id !== id)
      list.splice(i >= 0 ? i : 0, 1)
    }
    return { toasts: list }
  })
  return id
}

export function dismissToast(id: string): void {
  useNotices.setState(s => ({ toasts: s.toasts.filter(x => x.id !== id) }))
}

/**
 * The app's own "Are you sure?" from anywhere, even outside a component (a hook, a click handler with no
 * dialog of its own): resolves true on the confirm button, false otherwise. In place of window.confirm.
 */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    useNotices.setState(s => {
      s.confirm?.resolve(false, false)
      return { confirm: { ...options, resolve: (ok: boolean) => resolve(ok) } }
    })
  })
}

/** A page says what it shows already (its video, its clip); the returned function takes it back */
export function showOnScreen(key: string, on: Partial<OnScreen>): () => void {
  useNotices.setState(s => ({ onScreen: { ...s.onScreen, [key]: { videoIds: on.videoIds ?? [], clipIds: on.clipIds ?? [] } } }))
  return () => useNotices.setState(s => {
    const next = { ...s.onScreen }
    delete next[key]
    return { onScreen: next }
  })
}

export function onScreenNow(): OnScreen {
  const all = Object.values(useNotices.getState().onScreen)
  return { videoIds: all.flatMap(o => o.videoIds), clipIds: all.flatMap(o => o.clipIds) }
}

/** Work was just started (an upload, Make my clips, an export): the watcher looks for it now, not on its next round */
export function watchActivity(): void {
  useNotices.setState(s => ({ kick: s.kick + 1 }))
}
