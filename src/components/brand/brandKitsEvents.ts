/**
 * Opening the Brand kits popup from anywhere (BrandKitDialog listens), and the word that it closed (the
 * editor's and the clip board's views of the kits read them again). On its own so the kit editor
 * (components/editor/BrandKit) and the popup don't import each other.
 */
export const BRAND_KITS_OPEN = 'shortcut:brand-kits'
export const BRAND_KITS_CLOSED = 'shortcut:brand-kits-closed'

export type BrandKitsStart = { kitId?: string; invite?: string }

export function openBrandKits(start: BrandKitsStart = {}) {
  window.dispatchEvent(new CustomEvent<BrandKitsStart>(BRAND_KITS_OPEN, { detail: start }))
}
