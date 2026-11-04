'use client'

import { create } from 'zustand'
import type { TranscriptWord, CaptionStyle } from '@chai-cut/shared'
import type { TextCase } from '@/components/editor/CaptionStyler'
import type { CaptionPart } from './parts'

interface CaptionState {
  words: TranscriptWord[]
  captionStyle: Partial<CaptionStyle> & { enabled?: boolean }
  captionTextCase: TextCase
  showCaptions: boolean
  romanize: boolean
  retranscribing: boolean
  retranscribeElapsed: number
  retranscribeError: string | null
  /** While captions are being made: their place in line when they wait their turn (1 = next), else null */
  retranscribePlace: number | null
  /** The caption line on the preview now (VideoPreview sets it when it changes): the Captions panel's key words */
  liveLine: Array<{ word: string; start_ms: number; end_ms: number }> | null
  /** The parts after the first, each in its own look (parts.ts); the first part is captionStyle */
  captionParts: CaptionPart[]
  /** The caption part picked (on the timeline's Captions row): the Captions panel styles it. null: the first part; 'all': every part */
  pickedCaptionPart: string | null
}

interface CaptionActions {
  hydrate: (words: TranscriptWord[], style?: Partial<CaptionStyle>, showCaptions?: boolean) => void
  setWords: (words: TranscriptWord[]) => void
  updateWord: (id: string, text: string, field?: 'word' | 'word_roman') => void
  updateCaptionStyle: (updates: Partial<CaptionStyle>) => void
  setCaptionTextCase: (tc: TextCase) => void
  setShowCaptions: (show: boolean) => void
  setRomanize: (v: boolean) => void
  setRetranscribing: (v: boolean) => void
  setRetranscribeElapsed: (n: number) => void
  setRetranscribeError: (e: string | null) => void
  setRetranscribePlace: (place: number | null) => void
  setLiveLine: (line: CaptionState['liveLine']) => void
  setCaptionParts: (parts: CaptionPart[]) => void
  pickCaptionPart: (id: string | null) => void
}

export const useCaptionStore = create<CaptionState & CaptionActions>()(set => ({
  words: [],
  captionStyle: { color: '#FFE700' },
  captionTextCase: 'title',
  showCaptions: false,
  romanize: false,
  retranscribing: false,
  retranscribeElapsed: 0,
  retranscribeError: null,
  retranscribePlace: null,
  liveLine: null,
  captionParts: [],
  pickedCaptionPart: null,

  // Which letters captions use is saved with the caption style (language: 'roman' = English letters),
  // and so is their case (text_case; a style saved before that field: UPPER when uppercase, else Title)
  hydrate: (words, style = { color: '#FFE700' }, showCaptions = false) =>
    set({ words, captionStyle: { ...style, enabled: showCaptions }, captionTextCase: captionCaseOf(style), showCaptions, romanize: style.language === 'roman' }),

  setWords: (words) => set({ words }),
  updateWord: (id, text, field = 'word') => set(s => ({
    words: s.words.map(w => w.id === id ? { ...w, [field]: text } : w),
  })),
  updateCaptionStyle: (updates) => set(s => ({ captionStyle: { ...s.captionStyle, ...updates } })),
  // (kept on the style too, so it is saved and the export writes the words in the same case)
  setCaptionTextCase: (tc) => set(s => ({ captionTextCase: tc, captionStyle: { ...s.captionStyle, text_case: tc } })),
  setShowCaptions: (show) => set(s => ({ showCaptions: show, captionStyle: { ...s.captionStyle, enabled: show } })),
  setRomanize: (v) => set(s => ({ romanize: v, captionStyle: { ...s.captionStyle, language: v ? 'roman' : 'auto' } })),
  setRetranscribing: (v) => set({ retranscribing: v }),
  setRetranscribeElapsed: (n) => set({ retranscribeElapsed: n }),
  setRetranscribeError: (e) => set({ retranscribeError: e }),
  setRetranscribePlace: (place) => set({ retranscribePlace: place }),
  setLiveLine: (line) => set({ liveLine: line }),
  setCaptionParts: (parts) => set(s => ({ captionParts: parts, pickedCaptionPart: s.pickedCaptionPart && s.pickedCaptionPart !== 'all' && !parts.some(p => p.id === s.pickedCaptionPart) ? null : s.pickedCaptionPart })),
  pickCaptionPart: (id) => set({ pickedCaptionPart: id }),
}))

/**
 * The case captions are written in (the preview's applyCase, the export's render.py _apply_case):
 * the one saved, else (a style saved before text_case) UPPER when uppercase, else Title
 */
export function captionCaseOf(style: Partial<CaptionStyle> | null | undefined): TextCase {
  const saved = style?.text_case
  if (saved === 'title' || saved === 'upper' || saved === 'lower') return saved
  return style?.uppercase ? 'upper' : 'title'
}
