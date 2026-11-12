'use client'

import { useBrandPalette, useBrandLock, withBrand } from './brandPalette'
import { InfoTip } from '@/components/ui/info-tip'
import { useEffect, useRef, useState } from 'react'
import type { TextOverlay } from '@chai-cut/shared'
import { FontPicker, loadVideoFonts } from './CaptionStyler'
import { EmptyState } from './EditorTour'
import { TimeRange } from './ItemTimeRange'
import { EmojiButton, EmojiGrid, insertAtCursor } from './EmojiPicker'
import { TEXT_ANIMATION_GROUPS, TEXT_PRESETS, replayTextAnimation, textCss, type TextStyle, type TextAnimation } from '@/modules/editor/textStyle'

interface Props {
  overlays: TextOverlay[]
  currentTimeMs: number
  clipDurationMs: number
  onAdd: (overlay: Omit<TextOverlay, 'id' | 'clip_id'>) => void
  onUpdate: (id: string, updates: Partial<TextOverlay>) => void
  onRemove: (id: string) => void
  /** A text just added elsewhere (the timeline's "+"): it opens and its box takes focus with the words selected */
  focusId?: string | null
  onFocused?: () => void
  /**
   * A brand kit's ready text styles (brand kit Phase 3: the clip's kit, else the default one): "Your
   * brand" adds text in each; the first is how "Add" styles new text. Absent: no kit
   */
  brand?: {
    name: string; styles: Array<{ id: string; name: string; text: string; look: Partial<TextOverlay> }>; onFontAll?: () => void
    /** The kit's calls to action (brand kit Phase 5): each added in its call to action style in one tap */
    lines?: string[]
  } | null
  /** The text picked on the timeline or the preview: it opens here */
  selectedId?: string | null
  onSelect?: (id: string) => void
  /**
   * 'tabs' (the desktop editor, user 2026-11-09: "like the CC section"): the picked text's preview and
   * a Text · Style · Look · Motion bar pinned at the top, one kind of setting at a time. 'stack' (the
   * phone): every text a card that opens with all its settings
   */
  layout?: 'stack' | 'tabs'
  /**
   * Copy style (user, 2026-11-12): take the picked text's look, put it on the picked texts, or on every
   * text of the clip. Null: not now (no text picked / nothing copied). `look`: the copied look (its button shows it)
   */
  styleTools?: { copy: (() => void) | null; paste: (() => void) | null; pasteAll: (() => void) | null; look: Partial<TextOverlay> | null }
}

/** The Text panel's sub-tabs (tabbed layout), as the Captions panel's */
type TextTab = 'text' | 'style' | 'look' | 'motion'
const TEXT_TABS: { id: TextTab; label: string }[] = [
  { id: 'text', label: 'Text' }, { id: 'style', label: 'Style' }, { id: 'look', label: 'Look' }, { id: 'motion', label: 'Motion' },
]
/** Each sub-tab's icon (24-unit paths): T, a wand with sparks, a palette, a play with motion lines */
const TAB_ICONS: Record<TextTab, React.ReactNode> = {
  text: <path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />,
  style: <><path d="M4 20L15 9" /><path d="M14 4l.8 2.2L17 7l-2.2.8L14 10l-.8-2.2L11 7l2.2-.8z" /><path d="M19 12l.5 1.5L21 14l-1.5.5L19 16l-.5-1.5L17 14l1.5-.5z" /></>,
  look: <><path d="M12 3a9 9 0 100 18c1.1 0 1.6-.8 1.6-1.6 0-.9-.6-1.3-.6-2.1 0-.9.7-1.5 1.6-1.5H17a4 4 0 004-4c0-4.9-4-8.8-9-8.8z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7" r="1" /><circle cx="15.5" cy="7.5" r="1" /></>,
  motion: <><path d="M10 8.5v7l5.5-3.5z" /><path d="M3 8h3M2 12h4M3 16h3" /><path d="M8 4.5h10a3 3 0 013 3v9a3 3 0 01-3 3H8" /></>,
}
/** A time in the clip as m:ss */
const mss = (ms: number) => { const t = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` }

const COLORS = ['#ffffff', '#000000', '#FFE600', '#c8ff00', '#22d3ee', '#f472b6', '#ff7a45', '#ef4444']
const WEIGHTS: { v: number; label: string }[] = [{ v: 400, label: 'Regular' }, { v: 700, label: 'Bold' }, { v: 900, label: 'Black' }]
const SHADOWS: { v: NonNullable<TextOverlay['shadow']>; label: string }[] = [
  { v: 'none', label: 'None' }, { v: 'soft', label: 'Soft' }, { v: 'hard', label: 'Hard' }, { v: 'glow', label: 'Glow' },
]

/**
 * Text tool: add text, then style it — trending presets in one click, or font, weight, italic,
 * capitals, size, spacing, colour, outline, background box, shadow / glow, opacity, rotation and an
 * entrance animation. One text is open for styling at a time. (styles: .cap-* / .tx-* in globals.css)
 */
export function TextOverlayPanel({ overlays, currentTimeMs, clipDurationMs, onAdd, onUpdate, onRemove, focusId, onFocused, selectedId = null, onSelect, brand = null, layout = 'stack', styleTools }: Props) {
  const [newText, setNewText] = useState('')
  const [openId, setOpenId] = useState<string | null>(selectedId)
  const tabs = layout === 'tabs'
  const [tab, setTab] = useState<TextTab>('text')
  const listRef = useRef<HTMLDivElement>(null)
  // Picked on the timeline or the preview: open it and bring it into view
  useEffect(() => {
    if (!selectedId) return
    setOpenId(selectedId)
    listRef.current?.querySelector(`[data-text-card="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])
  // Added from the timeline's "+": open it, then put the cursor in its box with the words selected
  useEffect(() => {
    if (!focusId) return
    setOpenId(focusId)
    setTab('text')
    const el = listRef.current?.querySelector<HTMLInputElement>(`[data-text-id="${focusId}"]`)
    if (!el) return
    el.focus(); el.select(); el.scrollIntoView({ block: 'nearest' })
    onFocused?.()
  }, [focusId, overlays, openId, onFocused])

  useEffect(() => { loadVideoFonts() }, [])
  // A newly added text opens for styling straight away
  const [lastCount, setLastCount] = useState(overlays.length)
  useEffect(() => {
    if (overlays.length > lastCount) { setOpenId(overlays[overlays.length - 1].id); if (!focusId) setTab('style') }
    setLastCount(overlays.length)
  }, [overlays, lastCount])

  const newRef = useRef<HTMLTextAreaElement>(null)
  // The Emoji section: an emoji on its own, as a sticker on the video (big, at the playhead, 3 s)
  function addEmoji(e: string) {
    onAdd({
      text: e,
      start_ms: Math.round(currentTimeMs),
      end_ms: Math.round(Math.min(currentTimeMs + 3000, clipDurationMs)),
      x: 0.4, y: 0.4, font: 'sans-serif', size: 160, color: '#ffffff',
    })
  }

  function handleAdd() {
    if (!newText.trim()) return
    onAdd({
      text: newText.trim(),
      start_ms: Math.round(currentTimeMs),
      end_ms: Math.round(Math.min(currentTimeMs + 3000, clipDurationMs)),
      x: 0.1, y: 0.4, font: 'sans-serif', size: 72, color: '#ffffff',
      // (with a brand kit: in its title style)
      ...(brand?.styles[0]?.look ?? TEXT_PRESETS[0].style),
    })
    setNewText('')
  }

  /** Text in one of the brand's ready styles: what's typed, else its own example words (`typed` false: a kit's line as it is — what's typed stays) */
  function addBranded(st: NonNullable<Props['brand']>['styles'][number], typed = true) {
    onAdd({
      text: (typed && newText.trim()) || st.text,
      start_ms: Math.round(currentTimeMs),
      end_ms: Math.round(Math.min(currentTimeMs + 3000, clipDurationMs)),
      x: 0.1, y: st.id === 'cta' ? 0.7 : st.id === 'subtitle' ? 0.5 : 0.3, font: 'sans-serif', size: 72, color: '#ffffff',
      ...st.look,
    })
    if (typed) setNewText('')
  }

  const addBlock = (
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          {/* Enter starts a new line; Ctrl+Enter (or the + button) adds the text */}
          <textarea ref={newRef} value={newText} onChange={e => setNewText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleAdd() } }}
            placeholder="Type your text…" aria-label="New text" title="Enter starts a new line · Ctrl+Enter adds it"
            rows={Math.min(4, Math.max(1, newText.split('\n').length))}
            className="tx-input flex-1 resize-none" style={{ lineHeight: 1.35, paddingTop: 8, paddingBottom: 8 }} />
          <EmojiButton label="Add an emoji to the text" onPick={e => setNewText(insertAtCursor(newRef.current, newText, e))} />
          <button onClick={handleAdd} disabled={!newText.trim()} className="tx-add">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            Add
          </button>
        </div>
        {/* (brand kit Phase 3) the kit's ready styles, one tap each */}
        {brand && (
          <div className="tx-brand" role="group" aria-label={`${brand.name} text styles`}>
            <span className="tx-brand-label">{brand.name}</span>
            <div className="flex gap-1.5 flex-wrap">
              {brand.styles.map(st => (
                <button key={st.id} type="button" className="tx-brand-btn" onClick={() => addBranded(st)} title={`Add text in your ${st.name.toLowerCase()} style`}
                  style={{ fontFamily: st.look.font && st.look.font !== 'sans-serif' ? `"${st.look.font}", sans-serif` : undefined,
                    color: st.look.color ?? undefined, background: st.look.bg_color ?? undefined, textTransform: st.look.uppercase ? 'uppercase' : undefined }}>
                  + {st.name}
                </button>
              ))}
            </div>
            {(() => {
              const cta = brand.styles.find(st => st.id === 'cta')
              return cta && brand.lines?.length ? (
                <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Your lines">
                  {brand.lines.map(line => (
                    <button key={line} type="button" className="tx-brand-line" onClick={() => addBranded({ ...cta, text: line }, false)} title="Add this line in your call to action style">
                      {line}
                    </button>
                  ))}
                </div>
              ) : null
            })()}
            {brand.onFontAll && overlays.length > 0 && (
              <button type="button" className="tx-brand-all" onClick={brand.onFontAll} title="Your brand's title font on every text and frame text of this clip (locked ones stay)">
                Use brand font on all text
              </button>
            )}
          </div>
        )}
        <p className="flex items-center gap-1.5 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
          How it works
          <InfoTip label="How text works" size={12}>It appears at the playhead for 3 seconds. Drag it on the video to move it; drag its bar on the timeline to change when it shows.</InfoTip>
        </p>
      </div>
  )
  // Emoji on their own, as stickers on the video — drawn as they'll be in the download
  const emojiFold = (
      <Fold title="Emoji">
        <EmojiGrid height={200} onPick={addEmoji} />
      </Fold>
  )

  if (tabs) {
    const picked = overlays.find(o => o.id === openId) ?? null
    const shown: TextTab = picked ? tab : 'text'
    const pick = (id: string) => { if (openId !== id) onSelect?.(id); setOpenId(id) }
    const sample = { ...(brand?.styles[0]?.look ?? TEXT_PRESETS[0].style), size: 72 }
    return (
      <div className="flex flex-col">
        {/* Pinned at the top while the panel scrolls, as the Captions panel: the preview and the sub-bar */}
        <div className="sticky top-0 z-10 shrink-0 px-3 pt-2 pb-2" style={{ background: 'var(--ed-panel)' }}>
          {/* The picked text in its own style (none picked: a sample, dimmed) */}
          <div className="cap-preview tx-preview" data-dim={!picked || undefined}>
            <span className="tx-preview-text" style={{ ...textCss(picked ?? sample), fontSize: 26, whiteSpace: 'pre-wrap' }}>
              {picked ? (picked.text || 'Text') : 'Your text'}
            </span>
          </div>
          {/* Copy style: the picked text's look onto other texts (Ctrl+Alt+C / Ctrl+Alt+V); "Aa" in the look copied */}
          {styleTools && (
            <div className="tx-style-bar" role="group" aria-label="Copy style">
              <button type="button" className="tx-style-btn" disabled={!styleTools.copy} onClick={() => styleTools.copy?.()}
                title={styleTools.copy ? 'Copy this text’s style (Ctrl+Alt+C)' : 'Pick one text to copy its style'}>
                Copy style
              </button>
              <button type="button" className="tx-style-btn" disabled={!styleTools.paste} onClick={() => styleTools.paste?.()}
                title={!styleTools.look ? 'Copy a text’s style first' : styleTools.paste ? 'Put the copied style on the picked text (Ctrl+Alt+V)' : 'Pick the texts to put the copied style on'}>
                {styleTools.look && <span className="tx-style-aa" aria-hidden="true" style={{ ...textCss(styleTools.look), fontSize: 13, animation: 'none' }}>Aa</span>}
                Paste style
              </button>
              <button type="button" className="tx-style-btn" disabled={!styleTools.pasteAll} onClick={() => styleTools.pasteAll?.()}
                title={styleTools.look ? 'Put the copied style on every text and frame text of this clip (locked ones stay)' : 'Copy a text’s style first'}>
                Paste to all
              </button>
            </div>
          )}
          {/* Sub-bar: one kind of setting at a time; Style, Look and Motion need a text picked. (user, 2026-11-09:
              "looks so ordinary") each with its icon, a raised pill sliding under the one open, its icon lime */}
          <div role="tablist" aria-label="Text settings" className="ed-subtabs mt-2"
            style={{ '--n': TEXT_TABS.length, '--i': TEXT_TABS.findIndex(t => t.id === shown) } as React.CSSProperties}>
            <span className="ed-subtabs-pill" aria-hidden="true" />
            {TEXT_TABS.map(t => {
              const on = shown === t.id
              const off = t.id !== 'text' && !picked
              return (
                <button key={t.id} type="button" role="tab" aria-selected={on} disabled={off} onClick={() => setTab(t.id)}
                  className="ed-subtab" data-on={on || undefined}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="ed-subtab-icon">
                    {TAB_ICONS[t.id]}
                  </svg>
                  <span>{t.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Text: add, the texts (the picked one's words and when it shows), emoji ── */}
        {shown === 'text' && (
          <div role="tabpanel" aria-label="Text" className="p-4 flex flex-col gap-4">
            {addBlock}
            {overlays.length === 0 ? (
              <EmptyState icon={<path d="M4 7V5h16v2M9 19h6M12 5v14" />} title="No text yet"
                tip="Type above and press Add. Then pick a style in the Style tab." />
            ) : (
              <div ref={listRef} className="flex flex-col gap-1.5" role="list" aria-label="Your texts">
                {overlays.map(o => {
                  const on = o.id === openId
                  return (
                    <div key={o.id} role="listitem" className="tx-row" data-on={on || undefined} data-text-card={o.id}>
                      <div className="flex items-center gap-2">
                        <button type="button" className="tx-row-main" onClick={() => pick(o.id)} aria-pressed={on}>
                          <span className="tx-row-text" style={{ ...textCss(o), fontSize: 14, opacity: 1 }}>{o.text || 'Text'}</span>
                          <span className="tx-row-time">{mss(o.start_ms)} – {mss(o.end_ms)}</span>
                        </button>
                        <button onClick={() => onRemove(o.id)} aria-label="Delete this text" className="tx-del">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
                        </button>
                      </div>
                      {on && <PickedWords o={o} currentTimeMs={currentTimeMs} clipDurationMs={clipDurationMs} onUpdate={u => onUpdate(o.id, u)} />}
                    </div>
                  )
                })}
              </div>
            )}
            {emojiFold}
          </div>
        )}

        {/* ── Style: the trending styles ── */}
        {shown === 'style' && picked && (
          <div role="tabpanel" aria-label="Style" className="p-4 flex flex-col gap-3">
            <span className="cap-heading">Trending styles</span>
            <StyleTiles o={picked} onUpdate={u => onUpdate(picked.id, u)} />
          </div>
        )}

        {/* ── Look: font and size, then colour and effects ── */}
        {shown === 'look' && picked && (
          <div role="tabpanel" aria-label="Look" className="p-4 flex flex-col gap-5">
            <section className="flex flex-col gap-3">
              <span className="cap-heading">Font</span>
              <FontControls o={picked} onUpdate={u => onUpdate(picked.id, u)} />
            </section>
            <section className="flex flex-col gap-3">
              <span className="cap-heading">Colour &amp; effects</span>
              <EffectsControls o={picked} onUpdate={u => onUpdate(picked.id, u)} />
            </section>
          </div>
        )}

        {/* ── Motion: how it comes in ── */}
        {shown === 'motion' && picked && (
          <div role="tabpanel" aria-label="Motion" className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="cap-heading">Animation in</span>
              <ReplayButton id={picked.id} />
            </div>
            <AnimationPicker key={picked.id} value={picked.animation ?? 'none'} onPick={id => { onUpdate(picked.id, { animation: id }); replayTextAnimation(picked.id) }} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {addBlock}
      {emojiFold}

      {overlays.length === 0 ? (
        <EmptyState icon={<path d="M4 7V5h16v2M9 19h6M12 5v14" />} title="No text yet"
          tip="Type above and press Add. Then pick a trending style or make your own." />
      ) : (
        <div ref={listRef} className="flex flex-col gap-2">
          {overlays.map(o => (
            <TextItem key={o.id} o={o} open={openId === o.id} currentTimeMs={currentTimeMs} clipDurationMs={clipDurationMs}
              onToggle={() => { if (openId !== o.id) onSelect?.(o.id); setOpenId(id => (id === o.id ? null : o.id)) }}
              onUpdate={u => onUpdate(o.id, u)} onRemove={() => onRemove(o.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

/** The picked text's words (with an emoji) and when it shows: under its row in the Text tab */
function PickedWords({ o, currentTimeMs, clipDurationMs, onUpdate }: {
  o: TextOverlay; currentTimeMs: number; clipDurationMs: number; onUpdate: (u: Partial<TextOverlay>) => void
}) {
  const textRef = useRef<HTMLTextAreaElement>(null)
  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex gap-2">
        {/* Enter starts a new line, as in any editor */}
        <textarea ref={textRef} className="tx-input flex-1 resize-none" value={o.text} onChange={e => onUpdate({ text: e.target.value })}
          aria-label="Text" data-text-id={o.id}
          rows={Math.min(6, Math.max(1, o.text.split('\n').length))} style={{ lineHeight: 1.35, paddingTop: 8, paddingBottom: 8 }} />
        <EmojiButton label="Add an emoji to the text" onPick={e => onUpdate({ text: insertAtCursor(textRef.current, o.text, e) })} />
      </div>
      <TimeRange startMs={o.start_ms} endMs={o.end_ms} currentTimeMs={currentTimeMs}
        onStart={ms => onUpdate({ start_ms: Math.round(Math.max(0, Math.min(o.end_ms - 200, ms))) })}
        onEnd={ms => onUpdate({ end_ms: Math.round(Math.min(clipDurationMs, Math.max(o.start_ms + 200, ms))) })} />
    </div>
  )
}

function TextItem({ o, open, currentTimeMs, clipDurationMs, onToggle, onUpdate, onRemove }: {
  o: TextOverlay; open: boolean
  currentTimeMs: number; clipDurationMs: number
  onToggle: () => void
  onUpdate: (u: Partial<TextOverlay>) => void
  onRemove: () => void
}) {
  const textRef = useRef<HTMLTextAreaElement>(null)

  return (
    <div className="tx-item" data-open={open || undefined} data-text-card={o.id}>
      {/* Header: the text in its own style, then open / delete */}
      <div className="flex items-center gap-2">
        <button onClick={onToggle} aria-expanded={open} className="tx-head">
          <span className="tx-head-preview" style={{ ...textCss(o), fontSize: 15, opacity: 1 }}>{o.text || 'Text'}</span>
          <svg className="tx-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <button onClick={onRemove} aria-label="Delete this text" title="Delete this text" className="tx-del">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-5 pt-3">
          <div className="flex gap-2">
            {/* Enter starts a new line, as in any editor */}
            <textarea ref={textRef} className="tx-input flex-1 resize-none" value={o.text} onChange={e => onUpdate({ text: e.target.value })}
              aria-label="Text" data-text-id={o.id} title="Enter starts a new line"
              rows={Math.min(6, Math.max(1, o.text.split('\n').length))} style={{ lineHeight: 1.35, paddingTop: 8, paddingBottom: 8 }} />
            <EmojiButton label="Add an emoji to the text" onPick={e => onUpdate({ text: insertAtCursor(textRef.current, o.text, e) })} />
          </div>
          {/* When it shows */}
          <TimeRange startMs={o.start_ms} endMs={o.end_ms} currentTimeMs={currentTimeMs}
            onStart={ms => onUpdate({ start_ms: Math.round(Math.max(0, Math.min(o.end_ms - 200, ms))) })}
            onEnd={ms => onUpdate({ end_ms: Math.round(Math.min(clipDurationMs, Math.max(o.start_ms + 200, ms))) })} />

          <Fold title="Trending styles" defaultOpen><StyleTiles o={o} onUpdate={onUpdate} /></Fold>
          <Fold title="Font"><FontControls o={o} onUpdate={onUpdate} /></Fold>
          <Fold title="Colour & effects"><EffectsControls o={o} onUpdate={onUpdate} /></Fold>
          <Fold title="Animation in" defaultOpen action={<ReplayButton id={o.id} />}>
            <AnimationPicker key={o.id} value={o.animation ?? 'none'} onPick={id => { onUpdate({ animation: id }); replayTextAnimation(o.id) }} />
          </Fold>
        </div>
      )}
    </div>
  )
}

// ── The style controls, shared by the stacked layout (phone: folds in each text's card) and the
// tabbed one (desktop: Style · Look · Motion tabs, as the Captions panel) ──────────────────────────

type Edit = { o: TextOverlay; onUpdate: (u: Partial<TextOverlay>) => void }

/** Trending styles: one tap each (picking one replays the entrance in the preview) */
function StyleTiles({ o, onUpdate }: Edit) {
  const applyPreset = (style: TextStyle) => {
    onUpdate({ ...style, ...(style.font ? {} : o.font === 'monospace' ? { font: 'sans-serif' } : {}) })
    replayTextAnimation(o.id)
  }
  const activePreset = TEXT_PRESETS.find(p => (Object.keys(p.style) as (keyof TextStyle)[])
    .every(k => (o[k] ?? null) === (p.style[k] ?? null)))?.id
  return (
    <div className="grid grid-cols-2 gap-2">
      {TEXT_PRESETS.map(p => (
        <button key={p.id} onClick={() => applyPreset(p.style)} className="cap-tile" data-on={activePreset === p.id || undefined}>
          <span className="cap-tile-screen">
            <span style={{ ...textCss({ ...p.style, size: 72 }), fontSize: 15 }}>Hello</span>
          </span>
          <span className="cap-tile-name">{p.name}</span>
        </button>
      ))}
    </div>
  )
}

/** Font, weight, italic and capitals, size, letter spacing */
function FontControls({ o, onUpdate }: Edit) {
  return (
    <>
      <FontPicker value={o.font ?? null} onChange={family => onUpdate({ font: family })} />
      <div className="cap-row">
        <span className="cap-label">Weight</span>
        <div className="cap-seg" role="radiogroup" aria-label="Weight">
          {WEIGHTS.map(w => (
            <button key={w.v} role="radio" aria-checked={(o.weight ?? 700) === w.v} onClick={() => onUpdate({ weight: w.v })}
              className="cap-seg-btn" data-on={(o.weight ?? 700) === w.v || undefined} style={{ fontWeight: w.v }}>{w.label}</button>
          ))}
        </div>
      </div>
      <div className="cap-row">
        <span className="cap-label">Style</span>
        <div className="flex gap-1.5">
          <button onClick={() => onUpdate({ italic: !o.italic })} aria-pressed={!!o.italic} title="Italic" className="tx-toggle" data-on={o.italic || undefined} style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }}>I</button>
          <button onClick={() => onUpdate({ uppercase: !o.uppercase })} aria-pressed={!!o.uppercase} title="Capitals" className="tx-toggle" data-on={o.uppercase || undefined}>AA</button>
        </div>
      </div>
      <Slider label="Size" value={o.size ?? 72} min={20} max={240} step={2} onChange={v => onUpdate({ size: v })} />
      <Slider label="Letter spacing" value={o.letter_spacing ?? 0} min={-4} max={30} step={1} onChange={v => onUpdate({ letter_spacing: v })} />
    </>
  )
}

/** Colour, outline, background box, shadow / glow, opacity, rotation */
function EffectsControls({ o, onUpdate }: Edit) {
  return (
    <>
      <Swatches label="Text colour" value={o.color ?? '#ffffff'} onChange={c => onUpdate({ color: c })} />

      <OnOff label="Outline" on={!!o.stroke_color && (o.stroke_width ?? 0) > 0}
        onChange={on => onUpdate(on ? { stroke_color: o.stroke_color ?? '#000000', stroke_width: o.stroke_width || 6 } : { stroke_color: null, stroke_width: 0 })} />
      {!!o.stroke_color && (o.stroke_width ?? 0) > 0 && (
        <div className="tx-sub">
          <Swatches label="Outline colour" value={o.stroke_color} onChange={c => onUpdate({ stroke_color: c })} />
          <Slider label="Thickness" value={o.stroke_width ?? 6} min={1} max={16} step={1} onChange={v => onUpdate({ stroke_width: v })} />
        </div>
      )}

      <OnOff label="Background box" on={!!o.bg_color}
        onChange={on => onUpdate(on ? { bg_color: o.bg_color ?? '#000000', bg_opacity: o.bg_opacity ?? 0.7, bg_radius: o.bg_radius ?? 12 } : { bg_color: null })} />
      {!!o.bg_color && (
        <div className="tx-sub">
          <Swatches label="Box colour" value={o.bg_color} onChange={c => onUpdate({ bg_color: c })} />
          <Slider label="Box opacity" value={Math.round((o.bg_opacity ?? 1) * 100)} min={10} max={100} step={5} suffix="%" onChange={v => onUpdate({ bg_opacity: v / 100 })} />
          <Slider label="Roundness" value={o.bg_radius ?? 12} min={0} max={40} step={1} onChange={v => onUpdate({ bg_radius: v })} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="cap-label">Shadow</span>
        <div className="cap-seg w-full" role="radiogroup" aria-label="Shadow">
          {SHADOWS.map(sh => (
            <button key={sh.v} role="radio" aria-checked={(o.shadow ?? 'soft') === sh.v} onClick={() => onUpdate({ shadow: sh.v })}
              className="cap-seg-btn flex-1" data-on={(o.shadow ?? 'soft') === sh.v || undefined}>{sh.label}</button>
          ))}
        </div>
        {(o.shadow === 'hard' || o.shadow === 'glow') && (
          <Swatches label={o.shadow === 'glow' ? 'Glow colour' : 'Shadow colour'} value={o.shadow_color ?? (o.shadow === 'glow' ? o.color ?? '#ffffff' : '#000000')} onChange={c => onUpdate({ shadow_color: c })} />
        )}
      </div>

      <Slider label="Opacity" value={Math.round((o.opacity ?? 1) * 100)} min={10} max={100} step={5} suffix="%" onChange={v => onUpdate({ opacity: v / 100 })} />
      <Slider label="Rotation" value={o.rotation ?? 0} min={-45} max={45} step={1} suffix="°" onChange={v => onUpdate({ rotation: v })} />
    </>
  )
}

/** Play the text's entrance again in the preview */
function ReplayButton({ id }: { id: string }) {
  return (
    <button onClick={() => replayTextAnimation(id)} className="tx-replay" title="Play the animation again in the preview">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
      Replay
    </button>
  )
}

/**
 * The entrance animations, one kind at a time (as the caption styles): a chip per kind (Basic, Move,
 * Stylish — a dot on the kind holding the picked one), and that kind's tiles, each playing its
 * animation on a loop (.tx-an-* in globals.css). Opens on the kind of the text's animation.
 */
function AnimationPicker({ value, onPick }: { value: TextAnimation; onPick: (id: TextAnimation) => void }) {
  const holding = TEXT_ANIMATION_GROUPS.find(g => g.items.some(a => a.id === value))?.name ?? TEXT_ANIMATION_GROUPS[0].name
  const [kind, setKind] = useState(holding)
  const g = TEXT_ANIMATION_GROUPS.find(x => x.name === kind) ?? TEXT_ANIMATION_GROUPS[0]
  return (
    <div className="flex flex-col gap-2.5">
      <div role="tablist" aria-label="Kinds of animation" className="flex flex-wrap gap-1.5">
        {TEXT_ANIMATION_GROUPS.map(x => (
          <button key={x.name} role="tab" aria-selected={kind === x.name} onClick={() => setKind(x.name)}
            className="tx-an-kind" data-on={kind === x.name || undefined}>
            {x.name}
            {x.name === holding && value !== 'none' && <i aria-label="has the animation picked" />}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={`${g.name} animations`}>
        {g.items.map(a => {
          const on = value === a.id
          return (
            <button key={a.id} role="radio" aria-checked={on} onClick={() => onPick(a.id)}
              className="tx-an" data-on={on || undefined} title={a.label}>
              <span className="tx-an-screen" aria-hidden="true">
                <span className={`tx-an-demo tx-an-${a.id}`} data-text="Aa">{a.id === 'typewriter' ? <span className="tx-an-type">Aa</span> : 'Aa'}</span>
              </span>
              <span className="tx-an-name">{a.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** A style section that folds open and closed with the collapse / expand chevron */
function Fold({ title, defaultOpen = false, action, children }: {
  title: string; defaultOpen?: boolean; action?: React.ReactNode; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="tx-fold">
          <span className="cap-heading">{title}</span>
          <span className="ed-collapse" data-open={open || undefined} aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </span>
        </button>
        {open && action}
      </div>
      {open && <div className="flex flex-col gap-3">{children}</div>}
    </section>
  )
}

function Slider({ label, value, min, max, step, suffix = '', onChange }: {
  label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="cap-label">{label}</span>
        <span className="cap-value">{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={e => onChange(Number(e.target.value))}
        className="ed-zoom-range w-full" style={{ '--p': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties} />
    </div>
  )
}

function Swatches({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  // The brand kit's colours first (components/editor/brandPalette.ts)
  const brand = useBrandPalette()
  // (brand lock: the team kit's colours only, and no free picker)
  const lock = useBrandLock()
  const colors = lock ? lock.colors : withBrand(brand, COLORS)
  const isPreset = colors.some(c => c.toLowerCase() === value.toLowerCase())
  return (
    <div className="flex flex-col gap-2">
      <span className="cap-label">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        {colors.map(c => (
          <button key={c} onClick={() => onChange(c)} aria-label={`${label} ${c}${brand.includes(c.toLowerCase()) ? ' (brand colour)' : ''}`} aria-pressed={c.toLowerCase() === value.toLowerCase()}
            title={brand.includes(c.toLowerCase()) ? 'Brand colour' : undefined}
            className="cap-swatch" data-on={c.toLowerCase() === value.toLowerCase() || undefined} style={{ background: c }} />
        ))}
        {!lock && <label title="Pick any colour" className="cap-swatch" data-on={!isPreset || undefined}
          style={{ position: 'relative', cursor: 'pointer', background: 'conic-gradient(red 0deg, yellow 60deg, lime 120deg, cyan 180deg, blue 240deg, magenta 300deg, red 360deg)' }}>
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={e => onChange(e.target.value)} aria-label={`Pick any ${label.toLowerCase()}`}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
        </label>}
      </div>
      {lock && <span className="text-[10.5px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>Brand lock: {lock.by}&rsquo;s colours</span>}
    </div>
  )
}

function OnOff({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="cap-row">
      <span className="cap-label">{label}</span>
      <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
        className="relative shrink-0 rounded-full transition-colors"
        style={{ width: 36, height: 20, background: on ? '#c8ff00' : 'rgb(var(--ed-fg) / 0.15)' }}>
        <span className="absolute rounded-full transition-all"
          style={{ top: 3, left: on ? 19 : 3, width: 14, height: 14, background: on ? '#0a0a0a' : '#fff' }} />
      </button>
    </div>
  )
}
