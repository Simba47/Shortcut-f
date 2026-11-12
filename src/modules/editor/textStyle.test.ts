// Copy style (textStyle.ts). Run: npx tsx --test src/modules/editor/textStyle.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TextOverlay } from '@chai-cut/shared'
import { textLook, frameTextLook, lookOnText, lookOnFrameText } from './textStyle'

const styled = { id: 'a', clip_id: 'c', text: 'Hello', start_ms: 0, end_ms: 1000, x: 0.2, y: 0.3, font: 'Anton', size: 90, color: '#FFE600',
  weight: 900, uppercase: true, stroke_color: '#000000', stroke_width: 8, shadow: 'hard', shadow_color: '#000000', animation: 'pop', rotation: 12 } as TextOverlay
const plain = { id: 'b', clip_id: 'c', text: 'Step 2', start_ms: 5000, end_ms: 7000, x: 0.5, y: 0.7, font: null, size: 60, color: '#ffffff',
  bg_color: '#ff0000', bg_opacity: 0.5, italic: true, rotation: -5 } as TextOverlay

test('a text\'s look pasted on another: the whole look, nothing of its words, place, rotation or time', () => {
  const after = { ...plain, ...lookOnText(textLook(styled)) }
  assert.deepEqual([after.font, after.size, after.color, after.weight, after.uppercase, after.stroke_width, after.shadow, after.animation],
    ['Anton', 90, '#FFE600', 900, true, 8, 'hard', 'pop'])
  // what the copied look doesn't have goes back to plain (no box, not italic)
  assert.equal(after.bg_color, undefined); assert.equal(after.italic, undefined)
  // its own
  assert.deepEqual([after.text, after.x, after.y, after.start_ms, after.end_ms, after.rotation], ['Step 2', 0.5, 0.7, 5000, 7000, -5])
})

test('onto a frame text: only its font, size, colour and background', () => {
  assert.deepEqual(lookOnFrameText(textLook(styled)), { font: 'Anton', size: 90, color: '#FFE600' })
  assert.deepEqual(lookOnFrameText(textLook(plain)), { font: null, size: 60, color: '#ffffff', bg: '#ff0000' })
})

test('from a frame text: only those four; pasted on a text, the rest of its look stays', () => {
  const look = frameTextLook({ font: 'Bebas Neue', size: 70, color: '#c8ff00', bg: 'none' })
  assert.deepEqual(look, { font: 'Bebas Neue', size: 70, color: '#c8ff00', bg_color: null })
  const after = { ...styled, ...lookOnText(look) }
  assert.deepEqual([after.font, after.size, after.color, after.bg_color, after.stroke_width, after.animation], ['Bebas Neue', 70, '#c8ff00', undefined, 8, 'pop'])
})
