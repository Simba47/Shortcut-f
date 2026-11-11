'use client'

import { createContext, useContext, useSyncExternalStore } from 'react'

/**
 * The brand colours the editor's colour choices show first (text, captions, frame text): the
 * account's default brand kit's, else the kit picked in the Brand kit tool (lib/shared/brandKit.ts
 * brandPalette). Set by the editor (EditorShell) as kits load and change; empty without a kit.
 */
let palette: string[] = []
const EMPTY: string[] = []
const listeners = new Set<() => void>()

export function setBrandPalette(next: string[]) {
  if (next.length === palette.length && next.every((c, i) => c === palette[i])) return
  palette = next
  listeners.forEach(f => f())
}

/** Inside a kit's own settings: that kit's colours, whichever kit the editor's choices follow */
export interface KitColours { primary: string; secondary: string; extra: string[] }
export const KitColoursContext = createContext<KitColours | null>(null)

export function useBrandPalette(): string[] {
  const kit = useContext(KitColoursContext)
  const shared = useSyncExternalStore(
    f => { listeners.add(f); return () => { listeners.delete(f) } },
    () => palette,
    () => EMPTY,
  )
  return kit ? [...new Set([kit.primary, kit.secondary, ...kit.extra].map(c => c.toLowerCase()))] : shared
}

/**
 * Brand lock (a kit shared with this user by their team, its lock on): the only colours and fonts
 * the editor's choices offer — no free colour picker. null = no lock. Set by the editor (EditorShell).
 */
export type BrandLock = { colors: string[]; fonts: string[]; by: string }
let lock: BrandLock | null = null
const lockListeners = new Set<() => void>()

export function setBrandLock(next: BrandLock | null) {
  if (JSON.stringify(next) === JSON.stringify(lock)) return
  lock = next
  lockListeners.forEach(f => f())
}

export function useBrandLock(): BrandLock | null {
  return useSyncExternalStore(
    f => { lockListeners.add(f); return () => { lockListeners.delete(f) } },
    () => lock,
    () => null,
  )
}

/** A colour list with the brand colours first (no repeats, any letter case) */
export function withBrand(brand: string[], colors: string[]): string[] {
  const seen = new Set(brand.map(c => c.toLowerCase()))
  return [...brand, ...colors.filter(c => !seen.has(c.toLowerCase()))]
}
