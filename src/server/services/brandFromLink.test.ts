// The addresses "Fill from a link" must never fetch (brandFromLink.ts privateAddress).
// Run: npm run test:brand-link
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { privateAddress } from './brandFromLink'

/** The host as the server sees it once the link is parsed ([::ffff:127.0.0.1] becomes ::ffff:7f00:1) */
const host = (link: string) => new URL(link).hostname.replace(/^\[|\]$/g, '')

test('private and local IPv4 addresses are refused', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0'])
    assert.equal(privateAddress(ip), true, ip)
})

test('public addresses are allowed', () => {
  for (const ip of ['8.8.8.8', '142.250.183.14', '2606:4700::6810:84e5'])
    assert.equal(privateAddress(ip), false, ip)
})

test('an IPv4 address inside an IPv6 one is checked as IPv4, however the link writes it', () => {
  for (const link of ['http://[::ffff:127.0.0.1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://[::ffff:10.0.0.1]/', 'http://[::127.0.0.1]/', 'http://[64:ff9b::7f00:1]/'])
    assert.equal(privateAddress(host(link)), true, link)
  assert.equal(privateAddress(host('http://[::ffff:8.8.8.8]/')), false)
})
