import type { SegmentLocal } from '@chai-cut/shared'
import { isShot } from './shots'

// What kind of edit one undo step was, for Google Analytics (lib/analytics.ts): which part of the clip
// changed and how, never what it now says. history.ts calls it when a step ends.

/** The parts of the editor's saved state this reads (history.ts's snapshot has them all) */
export interface EditParts {
  segments: SegmentLocal[]
  keyframes: unknown
  trims: unknown
  clipRange: unknown
  overlays: unknown
  textOverlays: unknown
  audioTracks: unknown
  transitions: unknown
  filters: unknown
  captionStyle: object
  captionParts: unknown
  brand: unknown
  groups: unknown
}

export interface EditKind { area: string; change: 'add' | 'remove' | 'change' | 'on' | 'off'; detail?: string }

const countChange = (a: unknown, b: unknown): EditKind['change'] => {
  const n = Array.isArray(a) ? a.length : 0, m = Array.isArray(b) ? b.length : 0
  return m > n ? 'add' : m < n ? 'remove' : 'change'
}

/** The caption style's settings that changed ("font_family,color"), at most three */
function changedKeys(a: object, b: object): string | undefined {
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>
  const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(k => JSON.stringify(x[k]) !== JSON.stringify(y[k]))
  return keys.length ? keys.slice(0, 3).join(',') : undefined
}

/** The formats (sections) and videos on top: added, removed, or a new layout */
function segmentsChange(a: SegmentLocal[], b: SegmentLocal[], mainVideoId: string | null): EditKind {
  const before = new Map(a.map(s => [s.id, s]))
  const after = new Map(b.map(s => [s.id, s]))
  const added = b.filter(s => !before.has(s.id))
  const removed = a.filter(s => !after.has(s.id))
  const onTop = (s: SegmentLocal) => isShot(s, mainVideoId)
  if (added.length > removed.length) return { area: 'formats', change: 'add', detail: added.some(onTop) ? 'video_on_top' : added.length === 1 && removed.length === 0 ? 'section' : 'split' }
  if (removed.length > added.length) return { area: 'formats', change: 'remove', detail: removed.some(onTop) ? 'video_on_top' : 'section' }
  const relaid = b.find(s => before.has(s.id) && before.get(s.id)!.layout !== s.layout)
  if (relaid) return { area: 'formats', change: 'change', detail: `layout_${relaid.layout}` }
  return { area: 'formats', change: 'change' }
}

/** Each part that changed between the start and the end of one step (a whole drag counts once) */
export function describeEdits(a: EditParts, b: EditParts, mainVideoId: string | null): EditKind[] {
  const out: EditKind[] = []
  if (a.segments !== b.segments) out.push(segmentsChange(a.segments, b.segments, mainVideoId))
  else if (a.keyframes !== b.keyframes) out.push({ area: 'framing', change: 'change' })
  if (a.trims !== b.trims || a.clipRange !== b.clipRange) out.push({ area: 'trim', change: countChange(a.trims, b.trims) })
  if (a.overlays !== b.overlays) out.push({ area: 'media', change: countChange(a.overlays, b.overlays) })
  if (a.textOverlays !== b.textOverlays) out.push({ area: 'text', change: countChange(a.textOverlays, b.textOverlays) })
  if (a.audioTracks !== b.audioTracks) out.push({ area: 'music', change: countChange(a.audioTracks, b.audioTracks) })
  if (a.transitions !== b.transitions) out.push({ area: 'transitions', change: countChange(a.transitions, b.transitions) })
  if (a.filters !== b.filters) out.push({ area: 'filters', change: 'change' })
  if (a.captionStyle !== b.captionStyle) out.push({ area: 'captions', change: 'change', detail: changedKeys(a.captionStyle, b.captionStyle) })
  if (a.captionParts !== b.captionParts) out.push({ area: 'captions', change: countChange(a.captionParts, b.captionParts), detail: 'parts' })
  if (a.brand !== b.brand) out.push({ area: 'brand_kit', change: b.brand ? 'on' : 'off' })
  if (a.groups !== b.groups) out.push({ area: 'groups', change: countChange(a.groups, b.groups) })
  return out
}
