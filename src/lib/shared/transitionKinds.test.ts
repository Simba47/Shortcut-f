// Every transition the editor offers is one the database takes and the export draws.
// Run: npx tsx --test src/lib/shared/transitionKinds.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TRANSITION_KINDS } from './transitionKinds'

test('the Transitions panel offers only kinds the export draws', () => {
  const src = readFileSync(fileURLToPath(new URL('../../components/editor/TransitionsPanel.tsx', import.meta.url)), 'utf8')
  const list = src.slice(src.indexOf('export const TRANSITION_KINDS'), src.indexOf('\n]', src.indexOf('export const TRANSITION_KINDS')))
  const offered = [...list.matchAll(/type: '([a-z]+)'/g)].map(m => m[1])
  assert.ok(offered.length >= 20, `read ${offered.length} kinds from the panel`)
  assert.deepEqual(offered.filter(k => !(TRANSITION_KINDS as readonly string[]).includes(k)), [])
})
