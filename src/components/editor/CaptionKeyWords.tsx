'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import type { CaptionStyle } from '@chai-cut/shared'
import { useCaptionStore } from '@/modules/captions/store'
import { creatorKeyIndex, creatorKeys } from '@/modules/captions/creator'
import type { CaptionTemplate, CreatorLook } from '@/modules/captions/templates'

type Marks = Record<string, boolean>
/** What the emphasis route answers: the key words, and the line words (a Creator line's big word when it has no key word) */
type Picks = { emphasis?: Marks | null; line_keys?: Marks | null } | null
/** The picks as a style change (line words only when there are some: an older server has none) */
const picksChange = (d: NonNullable<Picks>): Partial<CaptionStyle> => ({ emphasis: d.emphasis ?? {}, ...(d.line_keys ? { line_keys: d.line_keys } : {}) })

/** The Creator styles that make one word of every line big (its key word, else its line word) */
const LINE_WORD_LOOKS: CreatorLook[] = ['difference', 'build', 'multi', 'split']

/** The clips AI was asked about on this page (once each, whoever asks) */
const askedFor = new Set<string>()

/**
 * AI picks a clip's key words the first time a Creator style is on it with none
 * (api/clips/[clipId]/emphasis, saved on the caption style). Used by the Captions panel
 * whichever of its tabs is open, so the preview shows them before Key words is opened.
 */
export function useKeyWordsPick(clipId: string | undefined, style: Partial<CaptionStyle>, on: boolean, onChange: (updates: Partial<CaptionStyle>) => void) {
  const emphasis = style.emphasis ?? null
  useEffect(() => {
    if (!on || emphasis || !clipId || askedFor.has(clipId)) return
    askedFor.add(clipId)
    useCaptionStore.getState().setKeyWordsAsking(true)
    fetch(`/api/clips/${clipId}/emphasis`, { method: 'POST' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: Picks) => {
        // (only if nothing was picked meanwhile)
        if (d?.emphasis && !useCaptionStore.getState().captionStyle.emphasis) onChange(picksChange(d))
      })
      .catch(() => {})
      .finally(() => useCaptionStore.getState().setKeyWordsAsking(false))
  }, [on, emphasis, clipId, onChange])
}

/**
 * Key words for the Creator caption styles: the words they make big, coloured or underlined.
 * AI picks them when a Creator style is first chosen (useKeyWordsPick); here the line playing on
 * the preview is shown and a tap makes a word a key word or takes it off. In a Creator style a line
 * with none uses its line word (shown dashed: "auto"; set below, under Line words), else its longest.
 * The other styles that use them (a caption style or an animated preset: templates.ts usesKeyWords)
 * draw them bigger, in the highlight colour.
 */
export function CaptionKeyWords({ style, tpl, onChange }: {
  style: Partial<CaptionStyle>
  /** The caption style picked, if any (a Creator one has its own way to mark them) */
  tpl?: CaptionTemplate
  onChange: (updates: Partial<CaptionStyle>) => void
}) {
  const line = useCaptionStore(s => s.liveLine)
  const asking = useCaptionStore(s => s.keyWordsAsking)
  const { clipId } = useParams<{ clipId?: string }>() ?? {}
  const emphasis = style.emphasis ?? null
  const lineKeys = style.line_keys ?? null
  useKeyWordsPick(clipId, style, true, onChange)

  const words = line ?? []
  const texts = words.map(w => w.word)
  const emph = words.map(w => !!emphasis?.[String(w.start_ms)])
  const lineWord = words.map(w => !!lineKeys?.[String(w.start_ms)])
  const look = tpl?.look
  const auto = words.length && look ? creatorKeys(texts, emph, look, !!emphasis && Object.values(emphasis).some(Boolean), lineWord) : new Set<number>()
  /** This style makes one word of every line big: its line words can be chosen (the sub-section below) */
  const lineWords = !!look && LINE_WORD_LOOKS.includes(look)
  /** The word the line shows big when it has no key word: its line word, else its longest */
  const lineBig = words.length && look ? creatorKeyIndex(texts, words.map(() => false), look, lineWord) : -1
  const hasKey = emph.some(Boolean)

  /** "Pick again with AI": new key words for the whole clip, in place of these (taps too; Undo brings them back) */
  const pickAgain = () => {
    if (!clipId || asking) return
    useCaptionStore.getState().setKeyWordsAsking(true)
    fetch(`/api/clips/${clipId}/emphasis`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fresh: true }) })
      .then(r => (r.ok ? r.json() : null))
      .then((d: Picks) => { if (d?.emphasis) onChange(picksChange(d)) })
      .catch(() => {})
      .finally(() => useCaptionStore.getState().setKeyWordsAsking(false))
  }

  const toggle = (start: number, on: boolean) => {
    const next = { ...(emphasis ?? {}) }
    if (on) next[String(start)] = true
    else delete next[String(start)]
    onChange({ emphasis: next })
  }
  /** A word made this line's line word (only one a line); tapped again: none (its longest word is used) */
  const setLineWord = (j: number) => {
    const next = { ...(lineKeys ?? {}) }
    const was = lineWord[j]
    for (const w of words) delete next[String(w.start_ms)]
    if (!was) next[String(words[j].start_ms)] = true
    onChange({ line_keys: next })
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="cap-heading">Key words</h3>
        {asking ? <span className="cap-value">AI is picking…</span> : clipId && (
          <button type="button" onClick={pickAgain} className="cap-apply-chip"
            title={`AI reads the whole clip and picks its key words${lineWords ? ' and line words' : ''} again (your own picks are replaced; Undo brings them back)`}>
            Pick again with AI
          </button>
        )}
      </div>
      {words.length === 0 ? (
        <p className="text-[11.5px] leading-snug" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
          Play the clip or move the playhead to a caption, then tap its words to make them stand out.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {words.map((w, j) => {
              const picked = emph[j]
              const byLine = !picked && auto.has(j)
              return (
                // (two words can start at the same moment — one spoken word written as two: its place keeps them apart)
                <button key={`${w.start_ms}-${j}`} type="button" aria-pressed={picked}
                  title={picked ? 'Key word: tap to take it off' : byLine ? 'Used as this line’s key word: tap to keep it' : 'Tap to make it a key word'}
                  onClick={() => toggle(w.start_ms, !picked)}
                  className="h-7 rounded-full px-2.5 text-[12px] font-semibold transition-colors"
                  style={picked
                    ? { background: '#c8ff00', color: '#0a0a0a' }
                    : byLine
                      ? { color: 'var(--ed-text)', boxShadow: 'inset 0 0 0 1px rgba(200,255,0,0.7)', outline: '1px dashed rgba(200,255,0,0.5)', outlineOffset: -4 }
                      : { background: 'rgb(var(--ed-fg) / 0.05)', color: 'rgb(var(--ed-fg) / 0.75)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.08)' }}>
                  {w.word}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] leading-snug" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
            {look
              ? <>The caption on the preview now. Lime = key word{look === 'scribble' ? ' (underlined)' : ''}; a dashed one is {lineWords ? 'the line word (below), used when the line has no key word' : 'picked for you'}.</>
              : <>The caption on the preview now. Lime = key word: drawn bigger{tpl?.box ? '' : ', in the highlight colour'}.</>}
          </p>
        </>
      )}

      {/* ── Line words (2026-11-07): the word a line makes big when it has no key word — AI picks
          the one that carries each phrase; a tap picks another for this line ── */}
      {lineWords && words.length > 0 && (
        <div className="flex flex-col gap-2 pt-3 mt-1" style={{ borderTop: '1px solid rgb(var(--ed-fg) / 0.07)' }}>
          <h4 className="cap-label">Line words</h4>
          <div className="flex flex-wrap gap-1.5" style={{ opacity: hasKey ? 0.55 : 1 }}>
            {words.map((w, j) => {
              const on = j === lineBig
              return (
                <button key={`${w.start_ms}-${j}`} type="button" aria-pressed={lineWord[j]}
                  title={lineWord[j] ? 'This line’s line word: tap to take it off (its longest word is used)' : on ? 'Its longest word, used for now: tap to keep it' : 'Tap to make it this line’s line word'}
                  onClick={() => setLineWord(j)}
                  className="h-7 rounded-full px-2.5 text-[12px] font-semibold transition-colors"
                  style={on
                    ? { background: 'rgb(var(--ed-fg) / 0.14)', color: 'var(--ed-text)', boxShadow: `inset 0 0 0 1.5px ${lineWord[j] ? 'rgba(200,255,0,0.8)' : 'rgb(var(--ed-fg) / 0.35)'}` }
                    : { background: 'rgb(var(--ed-fg) / 0.05)', color: 'rgb(var(--ed-fg) / 0.6)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.08)' }}>
                  {w.word}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] leading-snug" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
            {hasKey
              ? 'This line has a key word, so it shows that one. Its line word is used if you take the key word off.'
              : 'The word this line shows big, as it has no key word. AI picks the one that carries the line; tap another to use it.'}
          </p>
        </div>
      )}
    </section>
  )
}
