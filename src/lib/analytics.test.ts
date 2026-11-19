import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { API_EVENTS, apiEvent, campaignQuery, cleanParams, jsonBody, linkService, pageKind } from './analytics.ts'
import { accountClientId, clientIdFromCookie, eventBody, purchaseParams, sessionIdFromCookie } from '../server/analytics.ts'
import { describeEdits, type EditParts } from '../modules/editor/editTracking.ts'

// Google Analytics: what is sent, and that nothing personal is (lib/analytics.ts, server/analytics.ts,
// modules/editor/editTracking.ts)

const ID = '3f2c9a1e-8b7d-4c6e-9f10-a1b2c3d4e5f6'

test('nothing personal goes out: no email, no ids, short values, only GA-shaped names', () => {
  assert.deepEqual(cleanParams({
    tool: 'captions', count: 3, on: true, email: 'ravi@example.com', who: 'ravi@example.com', clip: ID,
    long: 'x'.repeat(300), 'Bad-Name': 'x', empty: '', none: null, nan: NaN, missing: undefined,
  }), { tool: 'captions', count: 3, on: true, clip: '[id]', long: 'x'.repeat(100) })
})

test('pages by their kind, never whose page', () => {
  assert.equal(pageKind(`/editor/${ID}`), '/editor/[clip]')
  assert.equal(pageKind(`/videos/${ID}/clips`), '/videos/[video]/clips')
  assert.equal(pageKind(`/billing/invoice/${ID}`), '/billing/invoice/[invoice]')
  assert.equal(pageKind('/dashboard'), '/dashboard')
  assert.equal(pageKind('/'), '/')
  assert.equal(pageKind('/share/AbCdEfGhIjKlMnOpQrStUv'), '/share/[id]')
})

test('only campaign tags stay on a page address (where the visitor came from)', () => {
  assert.equal(campaignQuery('?utm_source=instagram&utm_medium=bio&email=a@b.c&next=/editor/x&gclid=abc'), '?utm_source=instagram&utm_medium=bio&gclid=abc')
  assert.equal(campaignQuery('?video=123'), '')
  assert.equal(campaignQuery(''), '')
})

test('a link import says which service, never the link', () => {
  assert.equal(linkService('https://drive.google.com/file/d/abc/view?usp=sharing'), 'google_drive')
  assert.equal(linkService('https://www.dropbox.com/scl/fi/x/video.mp4?dl=0'), 'dropbox')
  assert.equal(linkService('https://youtu.be/abc'), 'youtube')
  assert.equal(linkService('https://example.com/a.mp4'), 'other')
  assert.equal(linkService('not a link'), 'unknown')
})

test('actions: each server address that worked is its event, with only the safe details', () => {
  const ev = (m: string, p: string, body?: object) => { const e = apiEvent(m, p); return e && { event: e.event, params: cleanParams({ ...e.params?.(jsonBody(body ? JSON.stringify(body) : undefined)) }) } }
  assert.deepEqual(ev('POST', '/api/export', { clip_id: ID, quality: '1080p', remove_fillers: true }), { event: 'export_clip', params: { quality: '1080p', remove_fillers: true, captions_read_again: false } })
  assert.deepEqual(ev('POST', '/api/ingest/link', { url: 'https://drive.google.com/file/d/x' }), { event: 'link_import', params: { service: 'google_drive' } })
  assert.deepEqual(ev('POST', '/api/ingest/complete', { duration_ms: 754_000, title: 'My secret video.mp4', storage_path: 'u/x' }), { event: 'upload_complete', params: { video_minutes: 12.6 } })
  assert.deepEqual(ev('POST', `/api/videos/${ID}/auto-clips`, { clip_count: 5, aspect: '9:16', caption_language: 'te', brand_kit: ID }), { event: 'make_clips', params: { clip_count: 5, aspect: '9:16', caption_language: 'te', add_broll: false, search: 'more', brand_kit: 'yes' } })
  assert.deepEqual(ev('POST', `/api/videos/${ID}/auto-clips`, { confirm: true }), { event: 'make_clips', params: { step: 'confirm_fewer' } })
  assert.deepEqual(ev('POST', '/api/billing/subscribe', { plan: 'creator' }), { event: 'begin_checkout', params: { item_id: 'creator', value: 999, currency: 'INR' } })
  assert.deepEqual(ev('POST', '/api/billing/topup', { pack: 'medium' }), { event: 'begin_checkout', params: { item_id: 'topup:medium', value: 489, currency: 'INR' } })
  assert.deepEqual(ev('POST', `/api/clips/${ID}/silences`), { event: 'editor_ai', params: { feature: 'cleanup_detect' } })
  assert.equal(apiEvent('GET', `/api/clips/${ID}/status`), undefined)          // polling: not an action
  assert.equal(apiEvent('POST', `/api/clips/${ID}/save`), undefined)           // the auto-save: edits are counted by kind instead
  assert.equal(apiEvent('GET', `/api/clips/${ID}/silences`), undefined)        // reading what was found isn't finding
  assert.equal(apiEvent('post', '/api/export')?.event, 'export_clip')
  assert.equal(jsonBody('{not json'), null)
})

/** Every address in the table is a real route of the site, with that method (the table can't go stale quietly) */
test('every action in the table is a real route with that method', () => {
  const root = path.join(import.meta.dirname, '..', 'app', 'api')
  const routes: { path: RegExp; methods: string[] }[] = []
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name)
      if (f.isDirectory()) walk(p)
      else if (f.name === 'route.ts') {
        const rel = path.relative(root, dir).split(path.sep).map(s => (/^\[.+\]$/.test(s) ? '[^/]+' : s)).join('/')
        const methods = [...fs.readFileSync(p, 'utf8').matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE)/g)].map(m => m[1])
        routes.push({ path: new RegExp(`^/api/${rel}$`), methods })
      }
    }
  }
  walk(root)
  for (const e of API_EVENTS) {
    // (the pattern back into an address: "^\/api\/clips\/[0-9a-f-]{36}\/silences$" → "/api/clips/<id>/silences")
    const sample = e.path.source.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/').replace(/\[0-9a-f-\]\{36\}/g, ID)
    const r = routes.find(x => x.path.test(sample))
    assert.ok(r, `${e.event}: no route at ${sample}`)
    assert.ok(r.methods.includes(e.method), `${e.event}: ${sample} has no ${e.method} (has ${r.methods.join(',')})`)
  }
})

test("server events: GA's cookies read, else an id made from the account (the same every time)", () => {
  assert.equal(clientIdFromCookie('GA1.1.1234567890.1731830000'), '1234567890.1731830000')
  assert.equal(clientIdFromCookie('nonsense'), null)
  assert.equal(clientIdFromCookie(undefined), null)
  assert.equal(sessionIdFromCookie('GS1.1.1731830000.3.1.1731830100.0.0.0'), '1731830000')
  assert.equal(sessionIdFromCookie('GS2.1.s1731830000$o3$g1$t1731830100$j60$l0$h0'), '1731830000')
  assert.equal(sessionIdFromCookie('x'), null)
  assert.equal(accountClientId(ID), accountClientId(ID))
  assert.notEqual(accountClientId(ID), accountClientId('another'))
  assert.match(accountClientId(ID), /^\d+\.1$/)

  const withCookie = eventBody('sign_up', { method: 'email', gone: undefined }, { userId: ID, clientId: '1.2', sessionId: '1731830000' })
  assert.deepEqual(withCookie, { client_id: '1.2', user_id: ID, events: [{ name: 'sign_up', params: { method: 'email', session_id: '1731830000', engagement_time_msec: 1 } }] })
  const without = eventBody('login', { method: 'google' }, { userId: ID, clientId: null, sessionId: null })
  assert.equal(without.client_id, accountClientId(ID))
  assert.deepEqual(without.events[0].params, { method: 'google', engagement_time_msec: 1 })
})

test('purchase: the amount in rupees, what was bought; the ₹1 test pack left out', () => {
  assert.deepEqual(purchaseParams({ transactionId: 'pay_1', plan: 'creator', itemName: 'Creator', amountPaise: 99900 }), {
    transaction_id: 'pay_1', value: 999, currency: 'INR', items: [{ item_id: 'creator', item_name: 'Creator', item_category: 'plan', price: 999, quantity: 1 }],
  })
  assert.equal((purchaseParams({ transactionId: 'pay_2', plan: 'topup:medium', itemName: '500 credits top-up', amountPaise: 48900 })!.items as { item_category: string }[])[0].item_category, 'topup')
  assert.equal((purchaseParams({ transactionId: 'pay_3', plan: 'topup:trial', itemName: 'Trial pack', amountPaise: 5000 })!.items as { item_category: string }[])[0].item_category, 'trial')
  assert.equal(purchaseParams({ transactionId: 'pay_4', plan: 'topup:test', itemName: 'Test', amountPaise: 100 }), null)
})

test('editor edits: which part changed and how, never what it says', () => {
  const seg = (id: string, layout = 'vertical', video?: string) => ({ id, layout, start_ms: 0, end_ms: 1000, sort_order: 0, crop_boxes: video ? [{ source_video_id: video }] : [] }) as never
  const base: EditParts = {
    segments: [seg('a')], keyframes: {}, trims: [], clipRange: null, overlays: [], textOverlays: [], audioTracks: [], transitions: [],
    filters: {}, captionStyle: { font_family: 'Inter', color: '#fff', size: 52 }, captionParts: [], brand: false, groups: [],
  }
  const k = (p: Partial<EditParts>) => describeEdits(base, { ...base, ...p }, 'main-video')
  assert.deepEqual(k({ segments: [seg('a'), seg('b')] }), [{ area: 'formats', change: 'add', detail: 'section' }])
  assert.deepEqual(k({ segments: [seg('a'), seg('b', 'vertical', 'stock-video')] }), [{ area: 'formats', change: 'add', detail: 'video_on_top' }])
  assert.deepEqual(k({ segments: [seg('a', 'split')] }), [{ area: 'formats', change: 'change', detail: 'layout_split' }])
  assert.deepEqual(k({ segments: [] }), [{ area: 'formats', change: 'remove', detail: 'section' }])
  assert.deepEqual(k({ keyframes: { x: [] } }), [{ area: 'framing', change: 'change' }])
  assert.deepEqual(k({ textOverlays: [{ text: 'Secret words' }] }), [{ area: 'text', change: 'add' }])
  assert.deepEqual(k({ transitions: [{}], audioTracks: [{}] }), [{ area: 'music', change: 'add' }, { area: 'transitions', change: 'add' }])
  assert.deepEqual(k({ captionStyle: { font_family: 'Anton', color: '#ff0', size: 52 } }), [{ area: 'captions', change: 'change', detail: 'font_family,color' }])
  assert.deepEqual(k({ brand: true }), [{ area: 'brand_kit', change: 'on' }])
  assert.deepEqual(k({ trims: [[0, 500]] }), [{ area: 'trim', change: 'add' }])
  assert.deepEqual(describeEdits(base, base, null), [])
  // what the text says never appears
  assert.ok(!JSON.stringify(k({ textOverlays: [{ text: 'Secret words' }] })).includes('Secret'))
})
