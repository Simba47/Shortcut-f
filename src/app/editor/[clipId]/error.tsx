'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { BrandLogo } from '@/components/ui/brand-logo'

/**
 * The editor couldn't open (user, 2026-11-12: it was always dark, with a ⚡, and went to the dashboard).
 * Now it follows the theme (the editor's own colours: .editor-theme), a calm icon as the editor's other
 * notices, Try again, and "Back to clip board" — that clip's own board (its video found from the clip;
 * the dashboard when it can't be). Styles: .ed-crash* in globals.css.
 */
export default function EditorError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  const { clipId } = useParams<{ clipId: string }>()
  const [back, setBack] = useState<{ href: string; label: string }>({ href: '/dashboard', label: 'Back to dashboard' })
  useEffect(() => {
    if (!clipId) return
    let live = true
    fetch(`/api/clips/${clipId}/preview`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { video_id?: string } | null) => { if (live && d?.video_id) setBack({ href: `/videos/${d.video_id}`, label: 'Back to clip board' }) })
      .catch(() => { /* the dashboard, then */ })
    return () => { live = false }
  }, [clipId])

  return (
    <div className="editor-theme ed-crash">
      <header className="ed-crash-head">
        <a href="/dashboard" aria-label="Shortcut dashboard" className="flex items-center rounded-lg"><BrandLogo shine size="sm" /></a>
      </header>
      <main className="ed-crash-body">
        <span className="ed-crash-ico" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>
        </span>
        <h1 className="ed-crash-title">The editor couldn&apos;t open</h1>
        <p className="ed-crash-text">Your edits are saved. Try again, or go back to your clips.</p>
        <div className="ed-crash-actions">
          <button type="button" onClick={reset} className="ed-crash-btn">Try again</button>
          <a href={back.href} className="ed-crash-btn" data-primary>{back.label}</a>
        </div>
      </main>
    </div>
  )
}
