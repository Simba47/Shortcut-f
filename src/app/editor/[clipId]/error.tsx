'use client'

import { startTransition, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { BrandLogo } from '@/components/ui/brand-logo'

/**
 * The editor couldn't open (user, 2026-11-12; redone 2026-11-28 to match the other error pages, kept simple:
 * no picture, no extra text). The editor's own colours (.editor-theme) and top bar, with the way back in it;
 * a small calm icon (no red alarm); Try again (the main one: re-opens the editor, asking the server again) and
 * back to that clip's own board (its video found from the clip; the dashboard when it can't be).
 * Styles: .ed-crash* in globals.css.
 */
export default function EditorError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  const router = useRouter()
  const { clipId } = useParams<{ clipId: string }>()
  const [back, setBack] = useState<{ href: string; label: string; short: string }>({ href: '/dashboard', label: 'Back to dashboard', short: 'Dashboard' })
  useEffect(() => {
    if (!clipId) return
    let live = true
    fetch(`/api/clips/${clipId}/preview`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { video_id?: string } | null) => { if (live && d?.video_id) setBack({ href: `/videos/${d.video_id}`, label: 'Back to clip board', short: 'Clip board' }) })
      .catch(() => { /* the dashboard, then */ })
    return () => { live = false }
  }, [clipId])

  const tryAgain = () => startTransition(() => { router.refresh(); reset() })
  const arrow = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>

  return (
    <div className="editor-theme ed-crash">
      <header className="ed-crash-head">
        <a href="/dashboard" aria-label="Shortcut dashboard" className="flex items-center rounded-lg"><BrandLogo shine size="sm" /></a>
        <a href={back.href} className="ed-crash-back" aria-label={back.label}>{arrow}<span>{back.short}</span></a>
      </header>
      <main className="ed-crash-body">
        <span className="ed-crash-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>
        </span>
        <h1 className="ed-crash-title">The editor couldn&apos;t open</h1>
        <p className="ed-crash-text"><span>Your edits are saved.</span> <span>Try again, or go back to your clips.</span></p>
        <div className="ed-crash-actions">
          <a href={back.href} className="ed-crash-btn">{arrow}{back.label}</a>
          <button type="button" onClick={tryAgain} className="ed-crash-btn" data-primary>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" /></svg>
            Try again
          </button>
        </div>
      </main>
    </div>
  )
}
