import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PUBLIC_PATHS } from './publicPaths'

test('Razorpay reviews the site signed out (user, 2026-11-12: payment blocked): prices and the refund policy open without login', () => {
  for (const p of ['/', '/pricing', '/refunds', '/terms', '/privacy', '/support']) assert.ok(PUBLIC_PATHS.includes(p), p)
})
