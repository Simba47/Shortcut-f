'use client'

import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { finishedNote, plainTitle, readyTitle, shownAlready, type FinishedJob } from '@/lib/notices'
import { onScreenNow, toast, useNotices } from './store'
import { accountChanged } from './AccountBanner'

/** While the user has work running, it's looked at this often */
const RUNNING_EVERY_MS = 5000
const CURSOR_KEY = 'nt-activity-cursor'
const ASKED_KEY = 'nt-notify-asked'

function canNotify(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

/**
 * Work finished while you were away (user, 2026-11-26): a reading, a Make my clips run or an export that
 * finishes says so on whatever page is open — a toast (unless that page shows it already), "✓ Ready" in the
 * tab's name while the tab is hidden, and a browser notification if the user turned them on. It looks at the
 * user's work when a page opens, when the tab comes back, when work is started (watchActivity), and every
 * few seconds while something is running — never while nothing is.
 */
export function ActivityWatcher() {
  const { status } = useSession()
  const kick = useNotices(s => s.kick)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const offered = useRef(false)

  useEffect(() => {
    if (status !== 'authenticated') return
    // (its own per run of the effect: a kick while a look is on its way starts a fresh one; a job told twice
    // replaces its own toast, and its notification has the same tag)
    let stopped = false, busy = false
    const check = async () => {
      if (busy || stopped) return
      busy = true
      if (timer.current) { clearTimeout(timer.current); timer.current = null }
      let running = 0
      try {
        const since = sessionStorage.getItem(CURSOR_KEY)
        const res = await fetch(`/api/notices/activity${since ? `?since=${encodeURIComponent(since)}` : ''}`, { cache: 'no-store' })
        if (res.ok && res.headers.get('content-type')?.includes('json')) {
          const d = await res.json() as { cursor: string; running: number; finished: FinishedJob[] }
          sessionStorage.setItem(CURSOR_KEY, d.cursor)
          running = d.running
          if (d.finished.length) {
            tell(d.finished)
            accountChanged()
          }
        }
      } catch { /* the next look will do */ }
      busy = false
      if (!stopped && running > 0) timer.current = setTimeout(check, RUNNING_EVERY_MS)
    }
    const tell = (jobs: FinishedJob[]) => {
      const on = onScreenNow()
      const hidden = document.hidden
      let toasted = false
      for (const j of jobs) {
        const note = finishedNote(j)
        // (the editor shows its own export, with its own "✓ Ready" tab name)
        const ownClip = !!j.clipId && on.clipIds.includes(j.clipId)
        if (!shownAlready(j, on)) {
          toast({ id: `job-${j.id}`, tone: note.tone, text: note.text, action: note.action })
          toasted = true
        }
        if (hidden && !ownClip) {
          document.title = readyTitle(document.title)
          if (canNotify() && Notification.permission === 'granted') {
            try {
              const n = new Notification(note.title, { body: note.body, tag: `shortcut-${j.id}`, icon: '/favicon.png' })
              n.onclick = () => { window.focus(); if (note.action) window.location.href = note.action.href; n.close() }
            } catch { /* some browsers only notify from a service worker */ }
          }
        }
      }
      // Browser notifications: offered once, after the first long job finished (never on a first visit)
      if (toasted && !offered.current && canNotify() && Notification.permission === 'default' && !localStorage.getItem(ASKED_KEY)) {
        offered.current = true
        try { localStorage.setItem(ASKED_KEY, '1') } catch { /* asked again next visit */ }
        setTimeout(() => toast({
          id: 'notify-offer', tone: 'info', ms: 12_000,
          text: 'Get a ping when work finishes and this tab is in the background?',
          action: { label: 'Turn on', onClick: () => { void Notification.requestPermission() } },
        }), 1500)
      }
    }
    const onShow = () => {
      if (document.hidden) return
      document.title = plainTitle(document.title)
      void check()
    }
    void check()
    document.addEventListener('visibilitychange', onShow)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onShow)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [status, kick])

  return null
}
