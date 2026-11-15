import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PUBLIC_PATHS, AUTH_PAGES, SIGNED_IN_AREAS, needsSignIn, isAuthPage } from './publicPaths'

test('Razorpay reviews the site signed out (user, 2026-11-12: payment blocked): prices and the refund policy open without login', () => {
  for (const p of ['/', '/pricing', '/refunds', '/terms', '/privacy', '/support']) assert.ok(PUBLIC_PATHS.includes(p), p)
  // (and the sign-in check never sends them to sign in)
  for (const p of ['/', '/pricing', '/refunds', '/terms', '/privacy', '/support']) assert.equal(needsSignIn(p), false, p)
})

const APP = join(__dirname, '..', 'app')

/** The first part of every page's address ('/dashboard', '/login', …), route groups like (auth) opened up */
function pageAreas(dir = APP, base = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (!statSync(full).isDirectory() || name === 'api' || name.startsWith('_')) continue
    if (name.startsWith('(') && name.endsWith(')')) { out.push(...pageAreas(full, base)); continue }
    out.push(`/${name}`)
  }
  return out
}

test('every page folder is public, a sign-in page or a signed-in area', () => {
  const known = new Set([...PUBLIC_PATHS, ...AUTH_PAGES, ...SIGNED_IN_AREAS])
  const missing = pageAreas().filter(a => !known.has(a))
  assert.deepEqual(missing, [], `add these to a list in publicPaths.ts: ${missing.join(', ')}`)
})

test('signed-in areas ask to sign in, other addresses do not', () => {
  for (const p of ['/dashboard', '/editor/abc', '/videos/1/clips', '/upload', '/settings', '/billing/invoice/9', '/brand']) {
    assert.equal(needsSignIn(p), true, p)
  }
  for (const p of ['/', '/abc', '/pricing', '/terms', '/login', '/verify-otp', '/dashboards', '/editorial', '/api/clips']) {
    assert.equal(needsSignIn(p), false, p)
  }
})

test('sign-in pages are matched by their own path only', () => {
  assert.equal(isAuthPage('/login'), true)
  assert.equal(isAuthPage('/reset-password'), true)
  assert.equal(isAuthPage('/loginx'), false)
  assert.equal(isAuthPage('/dashboard'), false)
})
