import { createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import { after } from 'next/server'

// Google Analytics events sent by the server (GA4's Measurement Protocol): the ones that must not be
// lost to an ad blocker or a closed tab — sign_up, login, purchase. The browser's events are in
// lib/analytics.ts.
//
// On only where both are set (Railway own-model, the live site):
//   NEXT_PUBLIC_GA_ID   the Measurement ID (G-…)
//   GA4                 the stream's Measurement Protocol API secret (GA_API_SECRET also read). SECRET
// The event joins the visitor's own visit when their browser has GA's cookies (_ga, _ga_<id>); a call
// without them (Razorpay's webhook, an ad blocker) still counts, under an id made from the account.
// Never personal: the account's internal id only, no email or name.

const GA_ID = () => process.env.NEXT_PUBLIC_GA_ID ?? ''
const SECRET = () => process.env.GA_API_SECRET || process.env.GA4 || ''

/** "GA1.1.123456789.1700000000" (the _ga cookie) → "123456789.1700000000" */
export function clientIdFromCookie(v: string | undefined | null): string | null {
  const m = /^GA\d\.\d+\.(\d+\.\d+)$/.exec((v ?? '').trim())
  return m ? m[1] : null
}

/** The visit's id from the _ga_<id> cookie: "GS1.1.1700000000.3.1…" or "GS2.1.s1700000000$o3$g1…" → "1700000000" */
export function sessionIdFromCookie(v: string | undefined | null): string | null {
  const s = (v ?? '').trim()
  const m = /^GS1\.\d+\.(\d+)\./.exec(s) ?? /^GS2\.\d+\.s(\d+)/.exec(s)
  return m ? m[1] : null
}

/** An id for a call with no GA cookie: the same for an account every time, nothing about who it is */
export function accountClientId(userId: string): string {
  return `${parseInt(createHash('sha256').update(`shortcut-ga:${userId}`).digest('hex').slice(0, 8), 16)}.1`
}

/** This request's GA cookies, if any (none outside a request, e.g. a script) */
async function browserIds(): Promise<{ clientId: string | null; sessionId: string | null }> {
  try {
    const jar = await cookies()
    const stream = GA_ID().replace(/^G-/, '')
    return { clientId: clientIdFromCookie(jar.get('_ga')?.value), sessionId: sessionIdFromCookie(jar.get(`_ga_${stream}`)?.value) }
  } catch {
    return { clientId: null, sessionId: null }
  }
}

type Value = string | number | boolean
export type ServerParams = Record<string, Value | Record<string, Value>[] | undefined>

/** What gets sent (built apart from the sending, for the tests) */
export function eventBody(name: string, params: ServerParams, ids: { userId: string; clientId: string | null; sessionId: string | null }) {
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) if (v !== undefined) clean[k] = v
  if (ids.sessionId) clean.session_id = ids.sessionId
  // (counted as an engaged moment, so it shows in the reports like the browser's events)
  clean.engagement_time_msec = 1
  return { client_id: ids.clientId ?? accountClientId(ids.userId), user_id: ids.userId, events: [{ name, params: clean }] }
}

/** Sends one event; never throws and never holds up the request for long (3 s at most) */
export async function sendServerEvent(name: string, params: ServerParams, userId: string): Promise<void> {
  const id = GA_ID(), secret = SECRET()
  if (!id || !secret || !userId) return
  try {
    const body = eventBody(name, params, { userId, ...(await browserIds()) })
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(id)}&api_secret=${encodeURIComponent(secret)}`
    const r = await fetch(url, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(3000) })
    if (!r.ok) console.error(`[analytics] ${name}: Google answered ${r.status}`)
  } catch (e) {
    console.error(`[analytics] ${name} not sent:`, e instanceof Error ? e.message : e)
  }
}

/**
 * Sends it once the answer has gone back (next/server `after`), so a sign-in or a payment never waits
 * on Google; outside a request (a script) it's simply sent.
 */
export function queueServerEvent(name: string, params: ServerParams, userId: string): void {
  if (!GA_ID() || !SECRET() || !userId) return
  try { after(() => sendServerEvent(name, params, userId)) } catch { void sendServerEvent(name, params, userId) }
}

/** The purchase event's details (plans, top-ups, the Trial pack); null for the ₹1 test pack */
export function purchaseParams(p: { transactionId: string; plan: string; itemName: string; amountPaise: number }): ServerParams | null {
  if (p.plan === 'topup:test') return null
  const value = Math.round(p.amountPaise) / 100
  const category = p.plan === 'topup:trial' ? 'trial' : p.plan.startsWith('topup:') ? 'topup' : 'plan'
  return {
    transaction_id: p.transactionId, value, currency: 'INR',
    items: [{ item_id: p.plan, item_name: p.itemName, item_category: category, price: value, quantity: 1 }],
  }
}

/** A payment, once (invoices.ts recordPayment) */
export function queuePurchase(userId: string, p: { transactionId: string; plan: string; itemName: string; amountPaise: number }): void {
  const params = purchaseParams(p)
  if (params) queueServerEvent('purchase', params, userId)
}
