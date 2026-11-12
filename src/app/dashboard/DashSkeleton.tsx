'use client'

import './dashboard.css'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'

/**
 * The dashboard while it loads (user, 2026-11-11: \"grey placeholder cards, not the full-screen loader\"): its own
 * frame at once — the top bar, the heading, the upload strip — and grey cards gently pulsing where the videos
 * will be, in their places, so nothing jumps when they arrive. Shown when the dashboard is opened (loading.tsx)
 * and while its videos are fetched (page.tsx). Nothing in it can be pressed. (styles: .skel-* in dashboard.css)
 */
export function DashSkeleton() {
  return (
    <div className="dash" aria-busy="true">
      <nav className="dash-nav app-nav">
        <Breadcrumbs shine items={[{ label: 'Dashboard' }]} />
        <div className="dash-nav-right" aria-hidden="true">
          <span className="skel" style={{ width: 120, height: 30 }} />
          <span className="skel" style={{ width: 118, height: 40 }} />
          <span className="skel" style={{ width: 84, height: 40 }} />
          <span className="skel" style={{ width: 104, height: 40 }} />
        </div>
      </nav>
      <main className="dash-main">
        <p className="sr-only" role="status">Loading your videos…</p>
        <div className="dash-head" aria-hidden="true">
          <h1><span className="dash-title">Your videos</span></h1>
          <div className="dash-tools">
            <span className="skel" style={{ width: 240, height: 40 }} />
            <span className="skel" style={{ width: 96, height: 40 }} />
            <span className="skel" style={{ width: 80, height: 40 }} />
          </div>
        </div>
        <div className="skel skel-strip" aria-hidden="true" />
        <div className="dash-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="vcard skel-card" style={{ '--d': `${i * 0.08}s` } as React.CSSProperties}>
              <div className="skel skel-thumb" />
              <div className="skel-info">
                <span className="skel skel-line" />
                <span className="skel skel-line" data-short="" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
