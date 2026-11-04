'use client'

import { preloadMascot } from '@/components/ui/mascot'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CaptionStyle, SegmentLocal, TextOverlay, TranscriptWord } from '@chai-cut/shared'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { BrandLoaderScreen } from '@/components/ui/brand-loader'
import { AccountMenu } from '@/components/ui/account-menu'
import ThemeSwitch from '@/components/ui/cinematic-theme-switcher'
import { ClipPlayer } from '@/components/clips/ClipPlayer'
import { PostText } from '@/components/clips/PostText'

export interface GalleryClip {
  id: string; title: string | null; start_ms: number; end_ms: number; status: string
  /** The Make my clips run it came from, and when */
  batch: string; batch_at: string
  ai_score: number | null; ai_reason: string | null
  post_caption: string | null; hashtags: string[] | null; output_url: string | null
  segments: SegmentLocal[]; words: TranscriptWord[]
  captionStyle: CaptionStyle | null; textOverlays: TextOverlay[]
}

const ACCENT = '#c8ff00'

/**
 * AI edits: every clip "Make my clips" made from the video, a section per run (newest first), each
 * playable in 9:16 here; Edit opens the editor, Export renders one
 */
export function ClipsGallery({ video, videoUrl, stockUrls, job, clips: initial }: {
  video: { id: string; title: string | null }
  videoUrl: string
  stockUrls: Record<string, string>
  job: { status: string; error: string | null } | null
  clips: GalleryClip[]
}) {
  // (the loader shown when a clip is opened has the mascot: its picture is fetched now)
  preloadMascot()
  const router = useRouter()
  const [clips, setClips] = useState(initial)
  const [opening, setOpening] = useState(false)
  useEffect(() => { setClips(initial) }, [initial])
  const [exportError, setExportError] = useState<string | null>(null)
  const running = job?.status === 'queued' || job?.status === 'running'
  // One section per Make my clips run, newest first (clips arrive in that order)
  const batches = clips.reduce<Array<{ id: string; at: string; clips: GalleryClip[] }>>((acc, c) => {
    const last = acc[acc.length - 1]
    if (last?.id === c.batch) last.clips.push(c)
    else acc.push({ id: c.batch, at: c.batch_at, clips: [c] })
    return acc
  }, [])
  const exporting = clips.some(c => c.status === 'rendering')

  // While the AI is still making clips, or clips are exporting, check every 3 s
  useEffect(() => {
    if (!running && !exporting) return
    const t = setInterval(async () => {
      const res = await fetch(`/api/videos/${video.id}/auto-clips`).catch(() => null)
      if (!res?.ok) return
      const data = await res.json() as { job: { status: string } | null; clips: Array<{ id: string; status: string; output_url: string | null }> }
      if (running && data.job?.status !== job?.status) { router.refresh(); return }
      setClips(cs => cs.map(c => {
        const u = data.clips.find(x => x.id === c.id)
        return u ? { ...c, status: u.status, output_url: u.output_url } : c
      }))
    }, 3000)
    return () => clearInterval(t)
  }, [running, exporting, video.id, job?.status, router])

  // Download: AI's clips are edits, not files yet, so the first Download exports the clip and the
  // file saves by itself once it's ready
  const [wantDl, setWantDl] = useState<string[]>([])
  useEffect(() => {
    const ready = wantDl.filter(id => clips.some(c => c.id === id && c.output_url))
    if (!ready.length) return
    for (const id of ready) {
      const a = document.createElement('a')
      a.href = `/api/clips/${id}/download`
      a.download = ''
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
    setWantDl(w => w.filter(id => !ready.includes(id)))
  }, [clips, wantDl])
  useEffect(() => {
    // An export that failed: stop waiting on it
    setWantDl(w => w.some(id => clips.some(c => c.id === id && c.status === 'failed')) ? w.filter(id => !clips.some(c => c.id === id && c.status === 'failed')) : w)
  }, [clips])

  async function exportClip(id: string) {
    setWantDl(w => w.includes(id) ? w : [...w, id])
    setExportError(null)
    const res = await fetch('/api/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clip_id: id, quality: '1080p' }),
    })
    if (!res.ok) {
      setWantDl(w => w.filter(x => x !== id))
      setExportError((await res.json().catch(() => ({}))).error ?? 'Export failed')
      return
    }
    setClips(cs => cs.map(c => c.id === id ? { ...c, status: 'rendering', output_url: null } : c))
  }

  const best = clips.reduce<number | null>((m, c) => typeof c.ai_score === 'number' ? Math.max(m ?? 0, c.ai_score) : m, null)
  const fmtLen = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` }
  const fmtWhen = (iso: string) => {
    const d = new Date(iso)
    const today = new Date().toDateString() === d.toDateString()
    return today
      ? `Today, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
      : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  }

  // Layout (styles: .ag-* in globals.css): a header with the video's name and a few numbers, a
  // status banner while AI works, then one section per batch with a grid of clip cards. Each card:
  // the reel (with its score and length on top), title, why AI picked it, Edit + Export/Download,
  // and the post text folded away until you open it.
  return (
    <div className="ag-page min-h-screen flex flex-col">
      {opening && <BrandLoaderScreen mascot overlay label="Getting your clip ready, please wait…" />}
      <nav className="app-nav flex items-center gap-3 px-4 shrink-0 sticky top-0 z-10"
        style={{ height: 56, background: 'rgba(14,14,15,0.85)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <Breadcrumbs shine items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Clip board', href: `/videos/${video.id}` },
          { label: 'AI edits' },
        ]} />
        <div className="flex-1" />
        <ThemeSwitch />
        <AccountMenu />
      </nav>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-8">
        {/* ── Header ── */}
        <header className="ag-hero">
          <div className="min-w-0 flex-1">
            <p className="ag-eyebrow">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7z" /></svg>
              AI edits
            </p>
            <h1 className="ag-title" title={video.title ?? undefined}>{video.title || 'Your video'}</h1>
            <p className="ag-sub">Play any clip to watch it as a reel. Like it? Download it. Edit it to make changes.</p>
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <span className="ag-stat"><b>{clips.length}</b> clip{clips.length === 1 ? '' : 's'}</span>
              {batches.length > 1 && <span className="ag-stat"><b>{batches.length}</b> batches</span>}
              {best != null && <span className="ag-stat ag-stat-lime" title="The highest viral score (0–99)">Best score <b>{best}</b></span>}
            </div>
          </div>
          <a href={`/videos/${video.id}`} className="ag-back">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            Back to clip board
          </a>
        </header>

        {/* ── Status ── */}
        {running && (
          <div className="ag-banner ag-banner-lime" role="status">
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
            <div>
              <p className="font-semibold">AI is making your clips</p>
              <p className="ag-banner-sub">New clips appear here by themselves as soon as they’re ready.</p>
            </div>
          </div>
        )}
        {job?.status === 'failed' && job.error === 'Cancelled by you' && (
          <div className="ag-banner" role="status">You stopped the last run{clips.length ? '. The clips it made are below.' : '.'}</div>
        )}
        {job?.status === 'failed' && job.error !== 'Cancelled by you' && (
          <div className="ag-banner ag-banner-red" role="alert">
            {/* (a video with no sound can't be tried again: its message says what to do) */}
            {/no sound/i.test(job.error ?? '') ? job.error : <>Making clips failed{job.error ? `: ${job.error}` : ''}. Try again from the clip board.</>}
          </div>
        )}
        {exportError && <div className="ag-banner ag-banner-red" role="alert">{exportError}</div>}
        {!running && clips.length === 0 && (
          <div className="ag-empty">
            <span className="ag-empty-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7z" /></svg>
            </span>
            <p className="ag-empty-title">No AI clips yet</p>
            <p className="ag-sub" style={{ margin: 0 }}>Go back to the clip board and press <b className="ag-strong">Make my clips</b>.</p>
          </div>
        )}

        {/* ── Batches ── */}
        {batches.map((b, bi) => (
          <section key={b.id} className="flex flex-col gap-4">
            <div className="ag-batch">
              <span className="ag-batch-name" data-latest={bi === 0 || undefined}>{bi === 0 ? 'Latest' : `Batch ${batches.length - bi}`}</span>
              <span className="ag-batch-meta">{b.clips.length} clip{b.clips.length === 1 ? '' : 's'} · {fmtWhen(b.at)}</span>
              <span className="ag-batch-line" aria-hidden="true" />
            </div>
            <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
              {b.clips.map(c => (
                <article key={c.id} className="ag-card">
                  <div className="relative">
                    <ClipPlayer videoUrl={videoUrl} mainVideoId={video.id}
                      stockUrls={Object.fromEntries(c.segments.flatMap(sg => sg.crop_boxes.map(b => b.source_video_id))
                        .filter((id): id is string => !!id && !!stockUrls[id]).map(id => [id, stockUrls[id]]))}
                      startMs={c.start_ms} endMs={c.end_ms} segments={c.segments}
                      words={c.words} captionStyle={c.captionStyle} textOverlays={c.textOverlays} />
                    {/* Score and length on top of the reel */}
                    <div className="ag-overlay" aria-hidden="true">
                      {typeof c.ai_score === 'number' && (
                        <span className="ag-score" title="Viral score (0–99)">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>
                          {c.ai_score}
                        </span>
                      )}
                      <span className="flex-1" />
                      <span className="ag-len">{fmtLen(c.end_ms - c.start_ms)}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 px-1">
                    <h3 className="ag-card-title" title={c.title ?? undefined}>{c.title || 'Untitled clip'}</h3>
                    {c.ai_reason && (
                      <p className="ag-why">
                        <span className="ag-why-label">Why AI picked it</span>
                        {c.ai_reason}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => { setOpening(true); router.push(`/editor/${c.id}`) }} className="ag-btn ag-btn-lime">
                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9.5 2L12 4.5M2 12l.7-2.8L10 1.5 12.5 4 4.8 11.3 2 12z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      Edit
                    </button>
                    {c.output_url ? (
                      <a href={`/api/clips/${c.id}/download`} download className="ag-btn ag-btn-dark">
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 2v7M4 7l3 3 3-3M2 11.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        Download
                      </a>
                    ) : (
                      <button onClick={() => exportClip(c.id)} disabled={c.status === 'rendering'} className="ag-btn ag-btn-dark"
                        title={c.status === 'rendering' ? 'It downloads by itself when ready' : 'Export this clip as AI edited it, then download it'}>
                        {c.status === 'rendering'
                          ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          : <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 2v7M4 7l3 3 3-3M2 11.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        {c.status === 'rendering' ? (wantDl.includes(c.id) ? 'Preparing…' : 'Exporting…') : 'Download'}
                      </button>
                    )}
                  </div>

                  {/* Post text, folded until opened */}
                  <details className="ag-post">
                    <summary>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
                      <span className="flex-1">Post text</span>
                      <span className="ag-post-hint">Title · caption · hashtags</span>
                      <svg className="ag-post-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                    </summary>
                    <div className="ag-post-body">
                      <PostText compact clipId={c.id} value={{ title: c.title, post_caption: c.post_caption, hashtags: c.hashtags }}
                        onChange={t => setClips(cs => cs.map(x => x.id === c.id ? { ...x, title: t.title, post_caption: t.post_caption, hashtags: t.hashtags } : x))} />
                    </div>
                  </details>
                </article>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}
