// Undo / Redo / Start over in the brand kit window (kitHistory).
// Run: npx tsx --test src/modules/brand/kitHistory.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_BRAND_KIT, type BrandKitData } from '@/lib/shared/brandKit'
import { emptyHistory, record, undo, redo, changedSinceOpen, STEP_GAP_MS, type KitState, type KitHistory } from './kitHistory'

const kit = (name: string, main = '#000000', extra: Partial<BrandKitData> = {}): KitState =>
  ({ name, logo_url: null, data: { ...DEFAULT_BRAND_KIT, ...extra, colors: { ...DEFAULT_BRAND_KIT.colors, main } } })

/** Kits on screen, changed the way the hook does: recorded, then set */
function screen(start: Record<string, KitState>) {
  const kits = { ...start }
  let h: KitHistory = emptyHistory()
  return {
    kits, get h() { return h },
    change(id: string, to: KitState, at: number) { h = record(h, id, kits[id], at); kits[id] = to },
    startOver(id: string, at: number) { h = record(h, id, kits[id], at, true); kits[id] = h.first[id] },
    undo() { const r = undo(h, id => kits[id]); if (r) { h = r.h; Object.assign(kits, r.put) } return !!r },
    redo() { const r = redo(h, id => kits[id]); if (r) { h = r.h; Object.assign(kits, r.put) } return !!r },
  }
}

test('each change apart is a step of its own: Undo goes back one at a time, Redo forward', () => {
  const s = screen({ a: kit('Insta') })
  s.change('a', kit('Insta', '#ff0000'), 1000)
  s.change('a', kit('Insta', '#00ff00'), 5000)
  assert.equal(s.kits.a.data.colors.main, '#00ff00')
  s.undo(); assert.equal(s.kits.a.data.colors.main, '#ff0000')
  s.undo(); assert.equal(s.kits.a.data.colors.main, '#000000')
  assert.equal(s.undo(), false)
  s.redo(); assert.equal(s.kits.a.data.colors.main, '#ff0000')
  s.redo(); assert.equal(s.kits.a.data.colors.main, '#00ff00')
  assert.equal(s.redo(), false)
})

test('quick changes in a row (a name typed) are one step', () => {
  const s = screen({ a: kit('B') })
  let t = 1000
  for (const name of ['Br', 'Bra', 'Bran', 'Brand']) { s.change('a', kit(name), t); t += STEP_GAP_MS - 100 }
  assert.equal(s.h.undo.length, 1)
  s.undo(); assert.equal(s.kits.a.name, 'B')
})

test('Make default (two kits at once) is one step', () => {
  const s = screen({ a: kit('A', '#000000', { is_default: true }), b: kit('B') })
  s.change('a', kit('A', '#000000', { is_default: false }), 1000)
  s.change('b', kit('B', '#000000', { is_default: true }), 1000)
  assert.equal(s.h.undo.length, 1)
  s.undo()
  assert.equal(s.kits.a.data.is_default, true)
  assert.equal(s.kits.b.data.is_default, false)
})

test('a new change after Undo clears Redo, and is not folded into the undone step', () => {
  const s = screen({ a: kit('A') })
  s.change('a', kit('A', '#111111'), 1000)
  s.undo()
  s.change('a', kit('A', '#222222'), 1100)
  assert.equal(s.h.redo.length, 0)
  s.undo(); assert.equal(s.kits.a.data.colors.main, '#000000')
})

test('Start over knows the kit as it was when the window opened, after many steps', () => {
  const s = screen({ a: kit('A') })
  assert.equal(changedSinceOpen(s.h, 'a', s.kits.a), false)
  s.change('a', kit('A', '#111111'), 1000)
  s.change('a', kit('A2', '#222222'), 5000)
  assert.equal(changedSinceOpen(s.h, 'a', s.kits.a), true)
  assert.equal(s.h.first.a.data.colors.main, '#000000')
  assert.equal(s.h.first.a.name, 'A')
  // put back by hand to the start: nothing left to start over
  s.change('a', kit('A'), 9000)
  assert.equal(changedSinceOpen(s.h, 'a', s.kits.a), false)
})

test('a kit deleted meanwhile is left out of Undo', () => {
  const s = screen({ a: kit('A'), b: kit('B') })
  s.change('a', kit('A', '#111111'), 1000)
  s.change('b', kit('B', '#111111'), 1000)
  delete s.kits.b
  s.undo()
  assert.equal(s.kits.a.data.colors.main, '#000000')
  assert.equal('b' in s.kits, false)
})

test('Start over is a step of its own: Undo takes it back, and a quick change after it is not folded in', () => {
  const s = screen({ a: kit('A') })
  s.change('a', kit('A', '#111111'), 1000)
  s.startOver('a', 1200)
  assert.equal(s.kits.a.data.colors.main, '#000000')
  s.change('a', kit('A', '#222222'), 1300)
  assert.equal(s.h.undo.length, 3)
  s.undo(); assert.equal(s.kits.a.data.colors.main, '#000000')
  s.undo(); assert.equal(s.kits.a.data.colors.main, '#111111')
})
