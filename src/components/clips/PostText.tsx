'use client'

import { useCallback, useEffect, useState } from 'react'
import { TopUpLink } from '@/components/ui/credits-badge'

export interface PostTextValue {
  title: string | null
  post_caption: string | null
  hashtags: string[] | null
}

// Colours follow the editor's theme (--ed-fg) and fall back to white text on the dark clip board
const fg = (a: number) => `rgb(var(--ed-fg, 255 255 255) / ${a})`

/**
 * The words to post a clip with (title, caption, hashtags), each with Copy, and Regenerate to
 * have AI write them again (POST /api/clips/[clipId]/ai-text).
 */
export function PostText({ clipId, value, onChange, compact = false, prepare }: {
  clipId: string
  value: PostTextValue
  onChange: (v: PostTextValue & { hook?: string }) => void
  compact?: boolean
  /**
   * Run before writing (the editor: make the clip's captions when it has none — the text is
   * written from them). It throws with what to tell the user when it can't.
   */
  prepare?: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const tags = (value.hashtags ?? []).map(t => `#${t}`).join(' ')
  const empty = !value.post_caption && !(value.hashtags ?? []).length
  // What is left of the month's rewrites, or what the next costs. A gallery of clips looks only when a button is pointed at
  const [note, setNote] = useState<string | null>(null)
  const loadNote = useCallback(() => {
    fetch(`/api/clips/${clipId}/ai-text`).then(r => (r.ok ? r.json() : null)).then((d: { note?: string } | null) => setNote(d?.note ?? null)).catch(() => {})
  }, [clipId])
  useEffect(() => { if (!compact) loadNote() }, [compact, loadNote])

  async function regenerate() {
    setBusy(true); setError(null)
    try {
      if (prepare) {
        setPreparing(true)
        try { await prepare() } finally { setPreparing(false) }
      }
      const res = await fetch(`/api/clips/${clipId}/ai-text`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not write the text')
      onChange({ title: data.title, post_caption: data.post_caption, hashtags: data.hashtags, hook: data.hook })
      loadNote()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not write the text')
    } finally {
      setBusy(false)
    }
  }

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500)
    } catch { setError('Copy is blocked by the browser. Select the text instead.') }
  }

  const row = (key: string, label: string, text: string) => text ? (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: fg(0.4) }}>{label}</p>
        <p className="text-xs leading-relaxed break-words select-text" style={{ color: fg(0.85) }}>{text}</p>
      </div>
      <button onClick={() => copy(key, text)} className="shrink-0 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors"
        style={{ color: copied === key ? '#4ade80' : fg(0.75), background: fg(0.07) }}>
        {copied === key ? 'Copied' : 'Copy'}
      </button>
    </div>
  ) : null

  return (
    <div className={`flex flex-col ${compact ? 'gap-1.5 mt-2' : 'gap-2'}`}>
      {row('title', 'Title', value.title ?? '')}
      {row('caption', 'Post caption', value.post_caption ?? '')}
      {row('tags', 'Hashtags', tags)}
      <div className="flex items-center gap-2">
        <button onClick={regenerate} disabled={busy} onMouseEnter={() => { if (compact && !note) loadNote() }}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-50"
          style={{ color: fg(0.75), border: `1px solid ${fg(0.12)}` }}>
          {busy && <span className="inline-block w-2.5 h-2.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
          {empty ? '✦ Write post text' : '✦ Regenerate'}
        </button>
        {error && <span className="text-[11px]" style={{ color: '#f87171' }}>{error}<TopUpLink message={error} /></span>}
      </div>
      {note && <p className="text-[11px]" style={{ color: fg(0.5) }}>{note}</p>}
      {preparing && (
        <p role="status" className="text-[11px] leading-relaxed" style={{ color: 'var(--ed-accent-text, #c8ff00)' }}>
          Getting the clip&rsquo;s captions so we can write your post — this takes a moment. They won&rsquo;t show on the video.
        </p>
      )}
    </div>
  )
}
