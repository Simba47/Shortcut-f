import { test, before } from 'node:test'
import assert from 'node:assert/strict'

// AI's key words put in by themselves (addToCaptionStyleQuietly, CaptionKeyWords useAutoKeyWords):
// not an undo step, never undone, and the clip stays "not edited" when it wasn't.
//   npx tsx --test src/modules/editor/history.test.ts
before(() => {
  // (startHistory listens for the pointer on the page)
  const g = globalThis as unknown as { window?: unknown }
  g.window ??= { addEventListener() {}, removeEventListener() {} }
})

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

test('key words put in quietly: no undo step, an undo keeps them, the loaded clip stays unedited', async () => {
  const { useCaptionStore } = await import('@/modules/captions/store')
  const h = await import('./history')
  useCaptionStore.setState({ captionStyle: { color: '#fff' } })
  const stop = h.startHistory()
  const loaded = h.editableSnapshot()

  // AI's key words arrive with nothing edited: the clip as loaded takes them in (what the editor does)
  const untouched = h.sameEditable(h.editableSnapshot(), loaded)
  h.addToCaptionStyleQuietly({ emphasis: { '2600': true } })
  const loadedNow = untouched ? h.editableSnapshot() : loaded
  assert.equal(untouched, true)
  assert.equal(h.useHistory.getState().canUndo, false, 'not an undo step')
  assert.equal(h.sameEditable(h.editableSnapshot(), loadedNow), true, 'the auto-save sees no edit')

  // The user's own edit, then undo: their edit goes, the key words stay
  useCaptionStore.getState().updateCaptionStyle({ color: '#f00' })
  await wait(700)
  assert.equal(h.useHistory.getState().canUndo, true)
  h.undo()
  assert.equal(useCaptionStore.getState().captionStyle.color, '#fff')
  assert.deepEqual(useCaptionStore.getState().captionStyle.emphasis, { '2600': true })
  // …and redo brings the edit back with them
  h.redo()
  assert.equal(useCaptionStore.getState().captionStyle.color, '#f00')
  assert.deepEqual(useCaptionStore.getState().captionStyle.emphasis, { '2600': true })
  stop()
})

test('key words arriving after the user edited (in the middle of a step): kept by every step', async () => {
  const { useCaptionStore } = await import('@/modules/captions/store')
  const h = await import('./history')
  useCaptionStore.setState({ captionStyle: { color: '#fff' } })
  const stop = h.startHistory()
  useCaptionStore.getState().updateCaptionStyle({ color: '#0f0' })
  // (still within the burst)
  h.addToCaptionStyleQuietly({ emphasis: { '1000': true } })
  await wait(700)
  h.undo()
  assert.equal(useCaptionStore.getState().captionStyle.color, '#fff')
  assert.deepEqual(useCaptionStore.getState().captionStyle.emphasis, { '1000': true })
  stop()
})
