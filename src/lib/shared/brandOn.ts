import type { BoxKeyframe, CaptionStyle, CornerStyle, SegmentLocal, Transition } from './types'
import { cleanBrandKitData, type BrandKitData } from './brandKit'

// A clip's brand kit, on or off (user, 2026-10-19): what the editor keeps (modules/editor/brandState.ts)
// and the clip saves (clips.brand). Shared so the server can check what it saves.

/** What a frame section was before the brand went on it */
export interface FrameBefore {
  /** The layout it was branded as (a new layout picked there gets branded again) */
  layout: string
  band: { bg: string; color: string }
  /** Its text items' colours, and their font (absent on frames branded before fonts were kept) */
  items: Record<string, { color?: string | null; bg?: string | null; font?: string | null }>
  main_corners?: Record<string, CornerStyle> | null
  /** Items' own corners (photos and videos in its slots) */
  item_corners?: Record<string, CornerStyle | null>
  /** A Branded card's look before (absent: none) and the text the brand added to it */
  card?: unknown
  added?: string[]
}

export interface BrandBefore {
  /** Each text's font, colour and size before (size: absent on clips branded before it was kept) */
  texts: Record<string, { font: string | null; color: string | null; size?: number | null }>
  caption: Partial<CaptionStyle> | null
  text_case: string | null
  frames: Record<string, FrameBefore>
  /** The end card the brand made, if it made one (modules/brand/endCard.ts) */
  end_card: EndCardBefore | null
  /** The intro and outro videos the brand put in (modules/brand/bookends.ts); absent on clips from before them */
  intro?: InsertBefore | null
  outro?: InsertBefore | null
}

/** A video the brand put in: the part showing it, which video, how long */
export interface InsertBefore { id: string; video: string; ms: number }

/**
 * The end card the brand made, and what was there before, to put back when it comes off: the card
 * (its id, where it starts), the part cut short for it (`cut`: its id and where it ended), the parts
 * it took the place of with their views, and the transitions after them
 */
export interface EndCardBefore {
  id: string
  at: number
  cut: { id: string; end_ms: number } | null
  replaced: SegmentLocal[]
  keyframes: Record<string, BoxKeyframe[]>
  transitions: Transition[]
}

export interface BrandOn {
  kit_id: string
  /** null: on since the clip was made (its default kit), nothing to put back but what the brand adds */
  before: BrandBefore | null
  /**
   * The kit's settings as they were when the clip last took them (brand engine, updateBrand): when the
   * kit has changed since, the clip follows it. Absent on clips branded before this was kept: the
   * editor takes the kit as it is then, and follows it from there.
   */
  applied?: BrandKitData | null
}

function cleanInsert(raw: unknown): InsertBefore | null {
  const r = raw && typeof raw === 'object' ? raw as Partial<InsertBefore> : null
  return r && typeof r.id === 'string' && typeof r.video === 'string' && typeof r.ms === 'number' ? { id: r.id, video: r.video, ms: r.ms } : null
}

/** A saved end card record; one from before Phase 4 (just the card's id) has nothing to put back */
function cleanEndCard(raw: unknown): EndCardBefore | null {
  if (typeof raw === 'string') return /^[0-9a-f-]{36}$/i.test(raw) ? { id: raw, at: -1, cut: null, replaced: [], keyframes: {}, transitions: [] } : null
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Partial<EndCardBefore>
  if (typeof e.id !== 'string' || typeof e.at !== 'number') return null
  return {
    id: e.id, at: e.at,
    cut: e.cut && typeof e.cut.id === 'string' && typeof e.cut.end_ms === 'number' ? { id: e.cut.id, end_ms: e.cut.end_ms } : null,
    replaced: Array.isArray(e.replaced) ? e.replaced : [],
    keyframes: e.keyframes && typeof e.keyframes === 'object' ? e.keyframes : {},
    transitions: Array.isArray(e.transitions) ? e.transitions : [],
  }
}

/** A saved clip's brand state made safe (clips.brand); null when off or not one */
export function cleanBrandOn(raw: unknown): BrandOn | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { kit_id?: unknown; before?: unknown }
  if (typeof r.kit_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(r.kit_id)) return null
  const b = r.before && typeof r.before === 'object' ? r.before as Partial<BrandBefore> : null
  const applied = (raw as { applied?: unknown }).applied
  return {
    kit_id: r.kit_id.toLowerCase(),
    applied: applied && typeof applied === 'object' ? cleanBrandKitData(applied) : null,
    before: b ? {
      texts: b.texts && typeof b.texts === 'object' ? b.texts : {},
      caption: b.caption && typeof b.caption === 'object' ? b.caption : null,
      text_case: typeof b.text_case === 'string' ? b.text_case : null,
      frames: b.frames && typeof b.frames === 'object' ? b.frames : {},
      end_card: cleanEndCard(b.end_card),
      intro: cleanInsert(b.intro),
      outro: cleanInsert(b.outro),
    } : null,
  }
}
