/* A stand-in for Razorpay's payment window (https://checkout.razorpay.com/v1/checkout.js), used only
 * with dummy keys (RAZORPAY_MOCK=1). It takes the same options and calls the same handler with the
 * same fields, so the site's code is the one that runs with real keys. No real money moves.
 *
 * Test details (the same ones Razorpay's own test mode uses):
 *   UPI       success@razorpay pays, failure@razorpay fails
 *   Card      4111 1111 1111 1111, any future expiry, any CVV, any name  (a card ending 0002 fails)
 *   Netbanking and wallets: pick one, then choose Success or Failure on the test bank page
 */
(function () {
  var CSS =
    '.rzpd{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:12px}' +
    '.rzpd *{box-sizing:border-box}' +
    '.rzpd-sheet{background:#fff;color:#1c2330;width:min(760px,100%);max-height:94vh;border-radius:14px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.45);display:flex;flex-direction:column}' +
    '.rzpd-head{background:#072654;color:#fff;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}' +
    '.rzpd-badge{font-size:10.5px;letter-spacing:.1em;opacity:.7}' +
    '.rzpd-name{font-size:17px;font-weight:700;margin-top:2px}.rzpd-desc{font-size:12.5px;opacity:.78;margin-top:2px}' +
    '.rzpd-amt{text-align:right}.rzpd-amt b{font-size:22px;display:block}.rzpd-amt span{font-size:11px;opacity:.7}' +
    '.rzpd-x{background:none;border:0;color:#fff;opacity:.7;font-size:22px;cursor:pointer;line-height:1;margin-left:6px}' +
    '.rzpd-body{display:flex;min-height:330px;overflow:auto}' +
    '.rzpd-nav{width:210px;flex:none;background:#f5f7fa;border-right:1px solid #e4e8ee;padding:8px 0}' +
    '.rzpd-nav button{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:none;padding:13px 18px;font-size:14px;color:#1c2330;cursor:pointer;border-left:3px solid transparent}' +
    '.rzpd-nav button small{display:block;color:#7a8594;font-size:11px;margin-top:1px}' +
    '.rzpd-nav button[aria-selected=true]{background:#fff;border-left-color:#3395ff;font-weight:600}' +
    '.rzpd-ico{width:22px;text-align:center;font-size:17px}' +
    '.rzpd-pane{flex:1;padding:20px 22px;min-width:0;position:relative}' +
    '.rzpd-pane h4{margin:0 0 12px;font-size:14px}' +
    '.rzpd label{display:block;font-size:12px;color:#5b6675;margin:12px 0 4px}' +
    '.rzpd input[type=text],.rzpd input[type=tel]{width:100%;padding:11px 12px;border:1px solid #cdd4de;border-radius:8px;font-size:15px;outline:none;color:#1c2330}' +
    '.rzpd input:focus{border-color:#3395ff;box-shadow:0 0 0 3px rgba(51,149,255,.15)}' +
    '.rzpd .row{display:flex;gap:12px}.rzpd .row>div{flex:1}' +
    '.rzpd-hint{font-size:11.5px;color:#7a8594;margin-top:8px;line-height:1.45}' +
    '.rzpd-chip{display:inline-block;margin:6px 6px 0 0;padding:4px 9px;border:1px dashed #9fb4d1;border-radius:99px;font-size:11.5px;color:#26508a;background:#f1f6fd;cursor:pointer}' +
    '.rzpd-pay{margin-top:18px;width:100%;padding:13px;border:0;border-radius:9px;background:#3395ff;color:#fff;font-weight:700;font-size:15px;cursor:pointer}' +
    '.rzpd-pay:hover{background:#2784f0}' +
    '.rzpd-err{color:#d33;font-size:12.5px;margin-top:10px;min-height:16px}' +
    '.rzpd-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
    '.rzpd-opt{border:1px solid #cdd4de;border-radius:9px;padding:11px 12px;font-size:13.5px;cursor:pointer;background:#fff;text-align:left;color:#1c2330}' +
    '.rzpd-opt[aria-pressed=true]{border-color:#3395ff;background:#eef6ff;font-weight:600}' +
    '.rzpd-foot{border-top:1px solid #e4e8ee;padding:9px 20px;font-size:11.5px;color:#7a8594;display:flex;justify-content:space-between;gap:10px;background:#fafbfc}' +
    '.rzpd-cover{position:absolute;inset:0;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;gap:10px}' +
    '.rzpd-spin{width:34px;height:34px;border:3px solid #dbe6f5;border-top-color:#3395ff;border-radius:50%;animation:rzpdspin .8s linear infinite}' +
    '@keyframes rzpdspin{to{transform:rotate(360deg)}}' +
    '.rzpd-big{font-size:42px;line-height:1}.rzpd-cover h3{margin:0;font-size:17px}.rzpd-cover p{margin:0;color:#5b6675;font-size:13px}' +
    '.rzpd-ghost{border:1px solid #cdd4de;background:#fff;border-radius:9px;padding:10px 16px;font-size:13.5px;cursor:pointer;color:#1c2330}' +
    '.rzpd-ok{background:#1aa35a;color:#fff;border:0;border-radius:9px;padding:10px 18px;font-weight:700;font-size:13.5px;cursor:pointer}' +
    '.rzpd-no{background:#fff;color:#d33;border:1px solid #d33;border-radius:9px;padding:10px 18px;font-weight:700;font-size:13.5px;cursor:pointer}' +
    '@media(max-width:620px){.rzpd-body{flex-direction:column}.rzpd-nav{width:100%;display:flex;border-right:0;border-bottom:1px solid #e4e8ee;padding:0;overflow:auto}.rzpd-nav button{border-left:0;border-bottom:3px solid transparent;white-space:nowrap;padding:11px 14px}.rzpd-nav button small{display:none}.rzpd-nav button[aria-selected=true]{border-bottom-color:#3395ff}}'

  var BANKS = ['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Kotak Mahindra Bank', 'Yes Bank']
  var WALLETS = ['Paytm', 'PhonePe', 'Amazon Pay', 'MobiKwik', 'Freecharge', 'Airtel Money']
  var METHODS = [
    { id: 'upi', ico: '\u21C4', name: 'UPI', sub: 'Google Pay, PhonePe, any UPI app' },
    { id: 'card', ico: '\u25AD', name: 'Card', sub: 'Visa, Mastercard, RuPay' },
    { id: 'netbanking', ico: '\u2302', name: 'Netbanking', sub: 'All major banks' },
    { id: 'wallet', ico: '\u25C8', name: 'Wallet', sub: 'Paytm, PhonePe and more' },
  ]

  function h(tag, attrs, kids) {
    var el = document.createElement(tag)
    for (var k in attrs || {}) {
      if (k === 'text') el.textContent = attrs[k]
      else if (k === 'class') el.className = attrs[k]
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k])
      else el.setAttribute(k, attrs[k])
    }
    ;(kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c) })
    return el
  }
  function rupees(paise) { return '\u20B9' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
  function luhn(num) {
    var sum = 0, alt = false
    for (var i = num.length - 1; i >= 0; i--) { var n = +num[i]; if (alt) { n *= 2; if (n > 9) n -= 9 } sum += n; alt = !alt }
    return sum % 10 === 0
  }

  function Razorpay(options) { this.options = options || {}; this.listeners = {} }
  Razorpay.prototype.on = function (event, cb) { this.listeners[event] = cb }

  Razorpay.prototype.open = function () {
    var self = this, o = this.options, method = 'upi', amount = null, busy = false
    if (!document.getElementById('rzpd-css')) { var st = h('style', { id: 'rzpd-css' }); st.textContent = CSS; document.head.appendChild(st) }

    var amtB = h('b', { text: '\u2026' })
    var wrap = h('div', { class: 'rzpd', role: 'dialog', 'aria-modal': 'true' })
    var nav = h('div', { class: 'rzpd-nav', role: 'tablist' })
    var pane = h('div', { class: 'rzpd-pane' })
    var closeBtn = h('button', { class: 'rzpd-x', 'aria-label': 'Close', text: '\u00D7', onclick: function () { dismiss() } })
    var sheet = h('div', { class: 'rzpd-sheet' }, [
      h('div', { class: 'rzpd-head' }, [
        h('div', {}, [h('div', { class: 'rzpd-badge', text: 'RAZORPAY \u00B7 TEST MODE \u00B7 DUMMY' }), h('div', { class: 'rzpd-name', text: o.name || 'Payment' }), h('div', { class: 'rzpd-desc', text: o.description || '' })]),
        h('div', { style: 'display:flex;align-items:center' }, [h('div', { class: 'rzpd-amt' }, [amtB, h('span', { text: o.subscription_id ? 'per month' : 'one time' })]), closeBtn]),
      ]),
      h('div', { class: 'rzpd-body' }, [nav, pane]),
      h('div', { class: 'rzpd-foot' }, [h('span', { text: 'Dummy payment: nothing is charged.' }), h('span', { text: 'Secured by Razorpay (dummy)' })]),
    ])
    wrap.appendChild(sheet)
    document.body.appendChild(wrap)

    function close() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); document.removeEventListener('keydown', onKey) }
    function dismiss() { if (busy) return; close(); if (o.modal && o.modal.ondismiss) o.modal.ondismiss() }
    function onKey(e) { if (e.key === 'Escape') dismiss() }
    document.addEventListener('keydown', onKey)
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) dismiss() })

    // how much: asked from the fake Razorpay (the same way Razorpay's window knows its order or plan)
    var q = o.subscription_id ? 'subscription_id=' + encodeURIComponent(o.subscription_id) : 'order_id=' + encodeURIComponent(o.order_id || '')
    fetch('/api/dev/razorpay/pay?' + q).then(function (r) { return r.json() }).then(function (d) {
      if (d && d.ok) { amount = d.amount; amtB.textContent = rupees(d.amount); render() }
    }).catch(function () { amtB.textContent = '' })

    function renderNav() {
      nav.innerHTML = ''
      METHODS.forEach(function (m) {
        nav.appendChild(h('button', { role: 'tab', 'aria-selected': String(m.id === method), onclick: function () { if (busy) return; method = m.id; renderNav(); render() } }, [
          h('span', { class: 'rzpd-ico', text: m.ico }), h('span', {}, [m.name, h('small', { text: m.sub })]),
        ]))
      })
    }

    function cover(kids) { var c = h('div', { class: 'rzpd-cover' }, kids); pane.appendChild(c); return c }

    /** The customer pressed pay on valid details: processing, then the fake Razorpay settles it */
    function submit(shouldFail, label) {
      busy = true
      var c = cover([h('div', { class: 'rzpd-spin' }), h('h3', { text: 'Processing payment\u2026' }), h('p', { text: label })])
      setTimeout(function () {
        fetch('/api/dev/razorpay/pay', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription_id: o.subscription_id, order_id: o.order_id, outcome: shouldFail ? 'fail' : 'success', method: method }),
        }).then(function (r) { return r.json() }).then(function (res) {
          c.parentNode && c.parentNode.removeChild(c)
          if (res && res.ok) {
            var out = {}; for (var k in res) if (k.indexOf('razorpay_') === 0) out[k] = res[k]
            cover([h('div', { class: 'rzpd-big', style: 'color:#1aa35a', text: '\u2713' }), h('h3', { text: 'Payment successful' }), h('p', { text: rupees(amount || 0) + ' paid \u00B7 ' + out.razorpay_payment_id })])
            setTimeout(function () { busy = false; close(); if (o.handler) o.handler(out) }, 1100)
          } else {
            var reason = (res && res.error) || 'The payment failed.'
            if (self.listeners['payment.failed']) self.listeners['payment.failed']({ error: { description: reason } })
            busy = false
            var retry = h('button', { class: 'rzpd-ok', text: 'Try again', onclick: function () { render() } })
            cover([h('div', { class: 'rzpd-big', style: 'color:#d33', text: '\u2715' }), h('h3', { text: 'Payment failed' }), h('p', { text: reason }), h('div', {}, [retry, ' ', h('button', { class: 'rzpd-ghost', text: 'Close', onclick: dismiss })])])
          }
        }).catch(function () { busy = false; c.parentNode && c.parentNode.removeChild(c); cover([h('h3', { text: 'Could not reach the dummy payment service' }), h('button', { class: 'rzpd-ghost', text: 'Close', onclick: dismiss })]) })
      }, 1100)
    }

    function payButton(onclick) { return h('button', { class: 'rzpd-pay', text: amount ? 'Pay ' + rupees(amount) : 'Pay', onclick: onclick }) }
    function errBox() { return h('div', { class: 'rzpd-err' }) }

    /** Net banking and wallets: a test page of the bank or wallet, where the customer approves or declines */
    function bankPage(title, who) {
      busy = true
      cover([h('h3', { text: who }), h('p', { text: title }), h('p', { text: rupees(amount || 0) }),
        h('div', {}, [
          h('button', { class: 'rzpd-ok', text: 'Success', onclick: function () { busy = false; submit(false, who) } }), ' ',
          h('button', { class: 'rzpd-no', text: 'Failure', onclick: function () { busy = false; submit(true, who) } }),
        ]), h('button', { class: 'rzpd-ghost', text: 'Back', onclick: function () { busy = false; render() } })])
    }

    function render() {
      pane.innerHTML = ''
      if (method === 'upi') {
        var upi = h('input', { type: 'text', placeholder: 'success@razorpay', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' })
        var e1 = errBox()
        pane.appendChild(h('h4', { text: 'Pay with UPI' }))
        pane.appendChild(h('label', { text: 'UPI ID' })); pane.appendChild(upi)
        pane.appendChild(h('div', {}, [
          h('span', { class: 'rzpd-chip', text: 'success@razorpay', onclick: function () { upi.value = 'success@razorpay' } }),
          h('span', { class: 'rzpd-chip', text: 'failure@razorpay', onclick: function () { upi.value = 'failure@razorpay' } }),
        ]))
        pane.appendChild(h('div', { class: 'rzpd-hint', text: 'Test: success@razorpay pays, failure@razorpay fails.' }))
        pane.appendChild(e1)
        pane.appendChild(payButton(function () {
          var v = upi.value.trim()
          if (!/^[\w.\-]{2,}@[\w]{2,}$/.test(v)) { e1.textContent = 'Enter a valid UPI ID, like name@bank'; return }
          submit(/^failure@/i.test(v), 'Waiting for ' + v + ' to approve')
        }))
      } else if (method === 'card') {
        var num = h('input', { type: 'tel', placeholder: '1234 5678 9012 3456', inputmode: 'numeric', autocomplete: 'off', maxlength: '19' })
        var exp = h('input', { type: 'tel', placeholder: 'MM / YY', inputmode: 'numeric', autocomplete: 'off', maxlength: '7' })
        var cvv = h('input', { type: 'tel', placeholder: 'CVV', inputmode: 'numeric', autocomplete: 'off', maxlength: '4' })
        var nm = h('input', { type: 'text', placeholder: 'Name on card', autocomplete: 'off' })
        var e2 = errBox()
        num.addEventListener('input', function () { num.value = num.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim() })
        exp.addEventListener('input', function () { var d = exp.value.replace(/\D/g, '').slice(0, 4); exp.value = d.length > 2 ? d.slice(0, 2) + ' / ' + d.slice(2) : d })
        cvv.addEventListener('input', function () { cvv.value = cvv.value.replace(/\D/g, '').slice(0, 4) })
        pane.appendChild(h('h4', { text: 'Pay with card' }))
        pane.appendChild(h('label', { text: 'Card number' })); pane.appendChild(num)
        pane.appendChild(h('div', { class: 'row' }, [h('div', {}, [h('label', { text: 'Expiry' }), exp]), h('div', {}, [h('label', { text: 'CVV' }), cvv])]))
        pane.appendChild(h('label', { text: 'Name' })); pane.appendChild(nm)
        pane.appendChild(h('div', {}, [h('span', { class: 'rzpd-chip', text: 'Fill the test card', onclick: function () { num.value = '4111 1111 1111 1111'; exp.value = '12 / 34'; cvv.value = '123'; nm.value = 'Test User' } })]))
        pane.appendChild(h('div', { class: 'rzpd-hint', text: 'Test card 4111 1111 1111 1111, any future expiry, any CVV. A card ending 0002 fails.' }))
        pane.appendChild(e2)
        pane.appendChild(payButton(function () {
          var digits = num.value.replace(/\D/g, '')
          var m = exp.value.replace(/\D/g, '')
          var mm = +m.slice(0, 2), yy = 2000 + +m.slice(2, 4)
          var now = new Date()
          if (digits.length !== 16 || !luhn(digits)) { e2.textContent = 'Enter a valid 16-digit card number'; return }
          if (m.length !== 4 || mm < 1 || mm > 12 || yy < now.getFullYear() || (yy === now.getFullYear() && mm < now.getMonth() + 1)) { e2.textContent = 'Enter a valid expiry date in the future'; return }
          if (cvv.value.length < 3) { e2.textContent = 'Enter the 3 or 4 digit CVV'; return }
          if (!nm.value.trim()) { e2.textContent = 'Enter the name on the card'; return }
          submit(/0002$/.test(digits), 'Card ending ' + digits.slice(-4))
        }))
      } else {
        var list = method === 'netbanking' ? BANKS : WALLETS, picked = null
        var e3 = errBox()
        pane.appendChild(h('h4', { text: method === 'netbanking' ? 'Choose your bank' : 'Choose a wallet' }))
        var grid = h('div', { class: 'rzpd-grid' })
        list.forEach(function (name) {
          var b = h('button', { class: 'rzpd-opt', 'aria-pressed': 'false', text: name, onclick: function () {
            picked = name; Array.prototype.forEach.call(grid.children, function (x) { x.setAttribute('aria-pressed', String(x === b)) })
          } })
          grid.appendChild(b)
        })
        pane.appendChild(grid)
        pane.appendChild(h('div', { class: 'rzpd-hint', text: 'You will see a test page where you choose Success or Failure.' }))
        pane.appendChild(e3)
        pane.appendChild(payButton(function () {
          if (!picked) { e3.textContent = method === 'netbanking' ? 'Pick a bank' : 'Pick a wallet'; return }
          bankPage(method === 'netbanking' ? 'Test bank page: approve this payment' : 'Test wallet page: approve this payment', picked)
        }))
      }
    }

    renderNav()
    render()
  }

  window.Razorpay = Razorpay
})()
