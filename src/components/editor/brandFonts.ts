'use client'

import { createContext, useContext, useSyncExternalStore } from 'react'
import { isBrandFont } from '@/lib/shared/brandKit'

/**
 * Brand kits' own fonts in the editor (uploaded TTF / OTF, lib/shared/brandKit.ts BrandFont): the
 * list the font pickers show first (set by EditorShell from the account's kits), and each font
 * loaded into the page under its family name ("BrandFont-<id>") so text and captions draw in it.
 * The file comes through our own API (api/brand-kits/font), not straight from storage.
 */
export interface BrandFontItem { family: string; name: string }

let fonts: BrandFontItem[] = []
const EMPTY: BrandFontItem[] = []
const listeners = new Set<() => void>()
const loading = new Map<string, Promise<void>>()

export function setBrandFonts(next: BrandFontItem[]) {
  if (next.length === fonts.length && next.every((f, i) => f.family === fonts[i].family && f.name === fonts[i].name)) return
  fonts = next
  next.forEach(f => { ensureBrandFont(f.family) })
  listeners.forEach(f => f())
}

/** Inside a kit's own settings: its fonts, wherever it's opened (the list above is the editor's alone) */
export const KitFontsContext = createContext<BrandFontItem[] | null>(null)

export function useBrandFonts(): BrandFontItem[] {
  const kit = useContext(KitFontsContext)
  const shared = useSyncExternalStore(f => { listeners.add(f); return () => { listeners.delete(f) } }, () => fonts, () => EMPTY)
  if (!kit) return shared
  return [...kit, ...shared.filter(f => !kit.some(k => k.family === f.family))]
}

/** Load a brand font into the page (once); anything that isn't one is left to the font list it came from */
export function ensureBrandFont(family: string | null | undefined): Promise<void> {
  if (typeof document === 'undefined' || !family || !isBrandFont(family)) return Promise.resolve()
  const had = loading.get(family)
  if (had) return had
  const p = new FontFace(family, `url(/api/brand-kits/font?family=${encodeURIComponent(family)})`)
    .load()
    .then(face => { document.fonts.add(face) })
    .catch(e => { loading.delete(family); console.warn('[brand font] could not load', family, e) })
  loading.set(family, p)
  return p
}
