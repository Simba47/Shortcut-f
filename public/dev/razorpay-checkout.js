/* A stand-in for Razorpay's payment window (https://checkout.razorpay.com/v1/checkout.js), used only
 * with dummy keys (RAZORPAY_MOCK=1). It takes the same options and calls the same handler with the
 * same fields, so the site's code is the one that runs with real keys. No real money moves. */
(function () {
  function Razorpay(options) { this.options = options || {}; this.listeners = {} }
  Razorpay.prototype.on = function (event, cb) { this.listeners[event] = cb }
  Razorpay.prototype.open = function () {
    var self = this, o = this.options
    var wrap = document.createElement('div')
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif'
    wrap.innerHTML =
      '<div style="background:#fff;color:#111;width:340px;border-radius:14px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4)">' +
      '<div style="background:#072654;color:#fff;padding:16px 18px"><div style="font-size:11px;letter-spacing:.08em;opacity:.7">RAZORPAY · DUMMY</div>' +
      '<div style="font-size:16px;font-weight:700;margin-top:4px">' + (o.name || 'Payment') + '</div>' +
      '<div style="font-size:12px;opacity:.8;margin-top:2px">' + (o.description || '') + '</div></div>' +
      '<div style="padding:16px 18px"><p style="font-size:12px;color:#555;margin:0 0 14px">Test payment with dummy keys. Nothing is charged.</p>' +
      '<button data-a="pay" style="width:100%;padding:11px;border:0;border-radius:8px;background:#3395ff;color:#fff;font-weight:700;font-size:14px;cursor:pointer;margin-bottom:8px">Pay now (success)</button>' +
      '<button data-a="fail" style="width:100%;padding:11px;border:1px solid #d33;border-radius:8px;background:#fff;color:#d33;font-weight:600;font-size:13px;cursor:pointer;margin-bottom:8px">Make the payment fail</button>' +
      '<button data-a="close" style="width:100%;padding:9px;border:0;background:none;color:#666;font-size:12px;cursor:pointer">Close</button>' +
      '<p data-r="msg" style="font-size:12px;color:#d33;margin:8px 0 0"></p></div></div>'
    document.body.appendChild(wrap)
    function done() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap) }
    function pay(outcome) {
      wrap.querySelector('[data-r=msg]').textContent = ''
      fetch('/api/dev/razorpay/pay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription_id: o.subscription_id, order_id: o.order_id, outcome: outcome }),
      }).then(function (r) { return r.json() }).then(function (res) {
        if (res && res.ok) { done(); var out = {}; for (var k in res) if (k.indexOf('razorpay_') === 0) out[k] = res[k]; if (o.handler) o.handler(out) }
        else { done(); if (self.listeners['payment.failed']) self.listeners['payment.failed']({ error: { description: (res && res.error) || 'The payment failed.' } }) }
      }).catch(function () { wrap.querySelector('[data-r=msg]').textContent = 'The dummy payment service is not reachable.' })
    }
    wrap.addEventListener('click', function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a')
      if (a === 'pay') pay('success')
      else if (a === 'fail') pay('fail')
      else if (a === 'close' || e.target === wrap) { done(); if (o.modal && o.modal.ondismiss) o.modal.ondismiss() }
    })
  }
  window.Razorpay = Razorpay
})()
