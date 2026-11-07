// Every setting a clip's texts, photos and videos on top, music, transitions, caption style and frame
// items carry, and how it reaches the export. A new field fails this test until it says how — saved
// and drawn by the worker, or the editor's own — so nothing again shows in the preview and goes
// missing in the export (user, 2026-11-04: text looks, word corrections and 8 transitions did).
// Run: npx tsx --test src/lib/shared/exportFields.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TEXT_STYLE_KEYS } from '@/modules/editor/textStyle'

/** saved: a column the save writes (services/clips.ts) and the worker reads; style: text_overlays.style
 * (worker python/text_style.py); layers: clips.layers; frame: inside segments.frame (frames.py); editor: the editor's own */
type How = 'saved' | 'style' | 'layers' | 'frame' | 'editor'

const FIELDS: Record<string, Record<string, How>> = {
  TextOverlay: {
    id: 'saved', clip_id: 'saved', text: 'saved', start_ms: 'saved', end_ms: 'saved', x: 'saved', y: 'saved',
    font: 'saved', size: 'saved', color: 'saved', hidden: 'saved', locked: 'editor', w: 'saved', h: 'saved', rotation: 'saved',
    // (which track it sits on: clips.layers.lanes; the export stacks by it)
    track: 'layers',
    ...Object.fromEntries(TEXT_STYLE_KEYS.map(k => [k, 'style' as const])),
  },
  Overlay: {
    id: 'saved', clip_id: 'saved', type: 'saved', storage_path: 'saved', source_video_id: 'saved', source_offset_ms: 'saved',
    x: 'saved', y: 'saved', w: 'saved', h: 'saved', start_ms: 'saved', end_ms: 'saved', z_index: 'saved', rotation: 'saved',
    opacity: 'saved', hidden: 'saved', muted: 'saved', locked: 'editor',
    // (a signed link to show it; when it was added; its track: saved as z_index for photos, and layers.lanes)
    preview_url: 'editor', created_at: 'editor', track: 'layers',
  },
  AudioTrack: {
    id: 'saved', clip_id: 'saved', storage_path: 'saved', start_ms: 'saved', volume: 'saved', duck_under_speech: 'saved',
    offset_ms: 'saved', end_ms: 'saved', fade_in: 'saved', fade_out: 'saved', muted: 'saved', locked: 'editor', track: 'layers',
  },
  Transition: { id: 'saved', clip_id: 'saved', after_segment_id: 'saved', type: 'saved', duration_ms: 'saved' },
  CaptionStyle: {
    id: 'saved', clip_id: 'saved', font: 'saved', size: 'saved', color: 'saved', position: 'saved', position_y: 'saved',
    position_x: 'saved', animation: 'saved', language: 'saved', translated_from_language: 'saved', timing_offset_ms: 'saved',
    enabled: 'saved', highlight_color: 'saved', words_per_line: 'saved', uppercase: 'saved', text_case: 'saved',
    stroke_width: 'saved', emphasis: 'saved', line_keys: 'saved', template: 'saved',
  },
  FrameItem: {
    id: 'frame', lane: 'frame', kind: 'frame', start_ms: 'frame', end_ms: 'frame', source_video_id: 'frame',
    source_offset_ms: 'frame', volume: 'frame', muted: 'frame', hidden: 'frame', rect: 'frame', image_path: 'frame',
    motion: 'frame', corners: 'frame', text: 'frame', bg: 'frame', color: 'frame', size: 'frame', font: 'frame',
    x: 'frame', y: 'frame', w: 'frame', h: 'frame', rotation: 'frame', captions: 'frame',
    pan: 'frame', freeze: 'frame', dim: 'frame',
    // (a signed link to show the photo; which stock clip was picked; the lock)
    image_url: 'editor', broll: 'editor', locked: 'editor',
  },
}

function fieldsOf(src: string, name: string): string[] {
  const start = src.indexOf(`export interface ${name} {`)
  assert.ok(start >= 0, `interface ${name} not found in types.ts`)
  const body = src.slice(start, src.indexOf('\n}', start))
  return [...body.matchAll(/^\s{2}([a-z_0-9]+)\??:/gm)].map(m => m[1])
}

test('every field of what a clip shows says how the export gets it', () => {
  const src = readFileSync(fileURLToPath(new URL('./types.ts', import.meta.url)), 'utf8')
  for (const [name, known] of Object.entries(FIELDS)) {
    const fields = fieldsOf(src, name)
    const unknown = fields.filter(f => !(f in known))
    assert.deepEqual(unknown, [], `${name} has new field(s) ${unknown.join(', ')}: save them and have the export draw them (worker render.py), then add them here`)
    const gone = Object.keys(known).filter(f => !fields.includes(f))
    assert.deepEqual(gone, [], `${name} no longer has ${gone.join(', ')}: take them out of this list`)
  }
})

test('every Text-tool look setting is a field of a text', () => {
  const src = readFileSync(fileURLToPath(new URL('./types.ts', import.meta.url)), 'utf8')
  const fields = fieldsOf(src, 'TextOverlay')
  assert.deepEqual(TEXT_STYLE_KEYS.filter(k => !fields.includes(k)), [])
})
