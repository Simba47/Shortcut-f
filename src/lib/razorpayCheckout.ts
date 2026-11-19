'use client'

// Razorpay's payment window in the browser, shared by the Pricing page and the billing page (user,
// 2026-11-19: buy credits on the billing page too). The server makes the order and checks the payment;
// this only opens the window and passes Razorpay's answer back to the server.

declare global {
  interface Window { Razorpay: new (o: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: never) => void) => void } }
}

export const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js'

export function loadCheckoutScript(src: string = CHECKOUT_SCRIPT): Promise<void> {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('The payment window could not load. Check your connection and try again.'))
    document.body.appendChild(el)
  })
}

/**
 * Buying a credit pack (or the Trial pack): an order, Razorpay's payment window, then the server checks
 * the payment and adds the credits. What was added and the new balance; null when the window was closed
 * without paying. Throws with a message to show when anything fails.
 */
export async function buyCreditPack(packKey: string): Promise<{ credits: number; balance: number } | null> {
  const res = await fetch('/api/billing/topup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pack: packKey }) })
  const d = await res.json()
  if (!res.ok) throw new Error(d.error ?? 'Failed')
  await loadCheckoutScript(d.checkoutScript ?? CHECKOUT_SCRIPT)
  return new Promise((resolve, reject) => {
    const rz = new window.Razorpay({
      key: d.keyId, order_id: d.orderId, amount: d.amountPaise, currency: 'INR',
      name: 'Shortcut', description: `${d.packName}, one time`,
      prefill: d.email ? { email: d.email } : undefined, theme: { color: '#c8ff00' },
      handler: async (r: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
        try {
          const v = await fetch('/api/billing/topup/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) })
          const out = await v.json()
          if (!v.ok) throw new Error(out.error ?? 'The payment could not be verified. If money was taken, the credits will show shortly.')
          resolve({ credits: out.credits, balance: out.balance })
        } catch (e) { reject(e) }
      },
      modal: { ondismiss: () => resolve(null) },
    })
    rz.on('payment.failed', (f: { error?: { description?: string } }) => reject(new Error(f.error?.description ?? 'The payment failed. Please try again.')))
    rz.open()
  })
}
