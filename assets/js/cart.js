/* Rugged Access Project — on-site cart and Stripe embedded checkout.
   Loaded only when site.shop.onsite_checkout is true (see _config.yml).
   Prices shown here are for display; the checkout API re-checks every line with Stripe. */
(function () {
  'use strict';

  var CFG = window.RAP_SHOP || {};
  var API = (CFG.api || '/api').replace(/\/$/, '');
  var STRIPE_JS = 'https://js.stripe.com/endive/stripe.js';
  var KEY = 'rap_cart_v1';
  var MAX_PER_LINE = 5;
  var MAX_PER_ORDER = 10;

  var money = function (cents) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
  };
  var track = function (name, params) { if (typeof window.gtag === 'function') window.gtag('event', name, params || {}); };
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  /* ── Cart store ─────────────────────────────────────────────────────── */
  var memory = [];
  var read = function () {
    try { var v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return memory; }
  };
  var write = function (items) {
    memory = items;
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {}
    renderCount();
  };
  var count = function (items) { return (items || read()).reduce(function (n, i) { return n + i.quantity; }, 0); };
  var subtotal = function (items) { return (items || read()).reduce(function (n, i) { return n + i.quantity * i.unit_amount; }, 0); };

  var Cart = {
    items: read,
    add: function (item, qty) {
      var items = read();
      var room = MAX_PER_ORDER - count(items);
      var existing = items.filter(function (i) { return i.price === item.price; })[0];
      var current = existing ? existing.quantity : 0;
      var add = Math.max(0, Math.min(qty, MAX_PER_LINE - current, room));
      if (add === 0) return 0;
      if (existing) existing.quantity += add;
      else items.push(Object.assign({}, item, { quantity: add }));
      write(items);
      return add;
    },
    set: function (price, qty) {
      var items = read().map(function (i) { return i.price === price ? Object.assign(i, { quantity: Math.max(1, Math.min(MAX_PER_LINE, qty)) }) : i; });
      write(items);
    },
    remove: function (price) { write(read().filter(function (i) { return i.price !== price; })); },
    clear: function () { write([]); },
  };
  window.RAPCart = Cart;

  /* Which hats went into each checkout, so the thank-you page removes only those
     (and only for cart checkouts, never for "Buy now"). Keyed by Checkout Session id. */
  var PENDING = 'rap_pending_checkouts_v1';
  var readPending = function () { try { return JSON.parse(localStorage.getItem(PENDING) || '{}') || {}; } catch (e) { return {}; } };
  var writePending = function (v) { try { localStorage.setItem(PENDING, JSON.stringify(v)); } catch (e) {} };
  var rememberCheckout = function (clientSecret, mode, lines) {
    var id = String(clientSecret || '').split('_secret_')[0];
    if (!/^cs_/.test(id)) return;
    var all = readPending();
    var cutoff = Date.now() - 2 * 24 * 3600 * 1000; // sessions expire after 24h
    Object.keys(all).forEach(function (k) { if (all[k].at < cutoff) delete all[k]; });
    all[id] = { mode: mode, at: Date.now(), lines: lines.map(function (l) { return { price: l.price, quantity: l.quantity }; }) };
    writePending(all);
  };
  var settleCheckout = function (sessionId) {
    var all = readPending();
    var rec = all[sessionId];
    if (!rec) return; // Payment Link order, another device, or already handled
    if (rec.mode === 'cart') {
      var left = Cart.items().map(function (i) {
        var bought = rec.lines.filter(function (l) { return l.price === i.price; })[0];
        return bought ? Object.assign({}, i, { quantity: i.quantity - bought.quantity }) : i;
      }).filter(function (i) { return i.quantity > 0; });
      write(left);
    }
    delete all[sessionId];
    writePending(all);
  };

  /* ── API ────────────────────────────────────────────────────────────── */
  var api = function (path, opts) {
    return fetch(API + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) { var err = new Error(body.error || 'Something went wrong.'); err.status = res.status; throw err; }
        return body;
      });
    });
  };
  var stockPromise = null;
  var getStock = function () {
    if (!stockPromise) stockPromise = api('/stock').catch(function () { return {}; });
    return stockPromise;
  };

  /* ── Header count + toast ───────────────────────────────────────────── */
  function renderCount() {
    var n = count();
    document.querySelectorAll('[data-cart-count]').forEach(function (el) { el.textContent = n; el.hidden = n === 0; });
    document.querySelectorAll('[data-cart-link]').forEach(function (el) { el.setAttribute('aria-label', 'Cart, ' + n + (n === 1 ? ' item' : ' items')); });
  }
  var toastTimer;
  function toast(html) {
    var el = $('[data-toast]');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('data-toast', '');
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.innerHTML = html;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 5000);
  }

  /* ── Product page: quantity + add to cart / buy now ─────────────────── */
  var form = $('[data-add-form]');
  if (form) {
    var input = $('[data-qty-input]', form);
    var addBtn = $('[data-add-to-cart]', form);
    var buyBtn = $('[data-buy-now]', form);
    var note = $('[data-stock-note]', form);
    var max = MAX_PER_LINE;
    var item = {
      price: form.dataset.priceId, sku: form.dataset.sku, name: form.dataset.name, colorway: form.dataset.colorway,
      unit_amount: Number(form.dataset.unitAmount), url: form.dataset.url, image: form.dataset.image, swatch: form.dataset.swatch,
    };
    var qty = function () { var v = parseInt(input.value, 10); return Math.max(1, Math.min(max, isNaN(v) ? 1 : v)); };
    form.addEventListener('click', function (e) {
      var step = e.target.closest('[data-qty-step]');
      if (step) { input.value = Math.max(1, Math.min(max, qty() + Number(step.dataset.qtyStep))); }
    });
    input.addEventListener('change', function () { input.value = qty(); });

    addBtn.addEventListener('click', function () {
      var added = Cart.add(item, qty());
      if (!added) { toast('You already have the most we can sell of this hat in one order. <a href="/shop/cart/">View cart</a>'); return; }
      track('add_to_cart', { currency: 'USD', value: (item.unit_amount * added) / 100, items: [{ item_id: item.sku, item_name: item.name + ' ' + item.colorway, price: item.unit_amount / 100, quantity: added }] });
      toast('<strong>Added to cart:</strong> ' + esc(item.name) + ' × ' + added + ' <a class="toast__link" href="/shop/cart/">View cart</a>');
    });
    buyBtn.addEventListener('click', function () {
      location.href = '/shop/checkout/?buy=' + encodeURIComponent(item.price) + '&qty=' + qty();
    });

    getStock().then(function (stock) {
      if (!(item.sku in stock)) return;
      var left = stock[item.sku];
      if (left === 0) {
        addBtn.disabled = true; buyBtn.disabled = true;
        addBtn.textContent = 'Sold out';
        note.textContent = 'This hat just sold out.'; note.hidden = false;
      } else if (left <= 5) {
        max = Math.min(MAX_PER_LINE, left);
        input.max = max;
        note.textContent = 'Only ' + left + ' left.'; note.hidden = false;
      }
    });
  }

  /* ── Cart page ──────────────────────────────────────────────────────── */
  var cartRoot = $('[data-cart-page]');
  function renderCart() {
    var items = Cart.items();
    var list = $('[data-cart-lines]', cartRoot);
    var empty = $('[data-cart-empty]', cartRoot);
    var summary = $('[data-cart-summary]', cartRoot);
    empty.hidden = items.length > 0;
    summary.hidden = items.length === 0;
    list.innerHTML = items.map(function (i) {
      var opts = [1, 2, 3, 4, 5].map(function (n) { return '<option' + (n === i.quantity ? ' selected' : '') + '>' + n + '</option>'; }).join('');
      var thumb = i.image
        ? '<img src="' + esc(i.image) + '" alt="" width="96" height="128" loading="lazy">'
        : '<span class="cart-line__swatch" style="--swatch:' + esc(i.swatch || '#181E1C') + '"></span>';
      return '<li class="cart-line" data-line="' + esc(i.price) + '">' +
        '<a class="cart-line__media" href="' + esc(i.url) + '" tabindex="-1" aria-hidden="true">' + thumb + '</a>' +
        '<div class="cart-line__info"><a class="cart-line__name" href="' + esc(i.url) + '">' + esc(i.name) + '</a>' +
        '<span class="meta">' + esc(i.colorway) + ' · ' + money(i.unit_amount) + '</span>' +
        '<span class="meta cart-line__stock" data-line-stock hidden></span></div>' +
        '<label class="visually-hidden" for="q-' + esc(i.price) + '">Quantity</label>' +
        '<select class="select cart-line__qty" id="q-' + esc(i.price) + '" data-line-qty>' + opts + '</select>' +
        '<span class="price cart-line__total">' + money(i.unit_amount * i.quantity) + '</span>' +
        '<button class="cart-line__remove" type="button" data-line-remove aria-label="Remove ' + esc(i.name) + '">Remove</button>' +
        '</li>';
    }).join('');
    $('[data-cart-subtotal]', cartRoot).textContent = money(subtotal(items));
    $('[data-cart-count-label]', cartRoot).textContent = count(items) + (count(items) === 1 ? ' hat' : ' hats');
    getStock().then(function (stock) {
      items.forEach(function (i) {
        var el = cartRoot.querySelector('[data-line="' + i.price + '"] [data-line-stock]');
        if (!el || !(i.sku in stock)) return;
        var left = stock[i.sku];
        if (left === 0) { el.textContent = 'Sold out. Please remove it to check out.'; el.hidden = false; }
        else if (i.quantity > left) { el.textContent = 'Only ' + left + ' left.'; el.hidden = false; }
      });
    });
  }
  if (cartRoot) {
    renderCart();
    cartRoot.addEventListener('change', function (e) {
      if (e.target.matches('[data-line-qty]')) { Cart.set(e.target.closest('[data-line]').dataset.line, Number(e.target.value)); renderCart(); }
    });
    cartRoot.addEventListener('click', function (e) {
      if (e.target.closest('[data-line-remove]')) { Cart.remove(e.target.closest('[data-line]').dataset.line); renderCart(); }
    });
  }

  /* ── Checkout page: Stripe embedded checkout ────────────────────────── */
  var checkoutRoot = $('[data-checkout-page]');
  function loadStripe() {
    return new Promise(function (resolve, reject) {
      if (window.Stripe) return resolve(window.Stripe);
      var s = document.createElement('script');
      s.src = STRIPE_JS;
      s.onload = function () { window.Stripe ? resolve(window.Stripe) : reject(new Error('Stripe failed to load')); };
      s.onerror = function () { reject(new Error('Stripe failed to load')); };
      document.head.appendChild(s);
    });
  }
  function showCheckoutError(message, lines) {
    var box = $('[data-checkout-error]', checkoutRoot);
    var fallback = (lines || []).filter(function (l) { return l.payment_link; });
    var html = '<p><strong>' + esc(message) + '</strong></p>';
    if (fallback.length) {
      html += '<p class="text-muted">You can still buy each hat on Stripe’s secure page:</p><ul class="blaze-list">' +
        fallback.map(function (l) { return '<li><a href="' + esc(l.payment_link) + '">' + esc(l.name) + ' (' + esc(l.colorway) + ')</a></li>'; }).join('') + '</ul>';
    }
    html += '<p><a class="link-arrow" href="/shop/cart/">Back to cart</a></p>';
    box.innerHTML = html;
    box.hidden = false;
    $('[data-checkout-loading]', checkoutRoot).hidden = true;
  }
  if (checkoutRoot) {
    var params = new URLSearchParams(location.search);
    var buy = params.get('buy');
    // "Buy now" checks out one hat without touching the saved cart.
    var catalog = JSON.parse($('[data-catalog]').textContent || '{}');
    var lines = buy && catalog[buy]
      ? [Object.assign({}, catalog[buy], { price: buy, quantity: Math.max(1, Math.min(MAX_PER_LINE, parseInt(params.get('qty'), 10) || 1)) })]
      : Cart.items().map(function (i) { return Object.assign({}, catalog[i.price] || {}, i); });
    if (!lines.length) {
      $('[data-checkout-loading]', checkoutRoot).hidden = true;
      $('[data-checkout-empty]', checkoutRoot).hidden = false;
    } else {
      track('begin_checkout', {
        currency: 'USD', value: subtotal(lines) / 100,
        items: lines.map(function (l) { return { item_id: l.sku, item_name: l.name + ' ' + l.colorway, price: l.unit_amount / 100, quantity: l.quantity }; }),
      });
      var fetchClientSecret = function () {
        return api('/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: lines.map(function (l) { return { price: l.price, quantity: l.quantity }; }) }),
        }).then(function (body) { rememberCheckout(body.clientSecret, buy && catalog[buy] ? 'buy' : 'cart', lines); return body.clientSecret; });
      };
      loadStripe()
        .then(function (StripeCtor) {
          var stripe = StripeCtor(CFG.pk);
          return stripe.createEmbeddedCheckoutPage({ fetchClientSecret: fetchClientSecret });
        })
        .then(function (checkout) {
          $('[data-checkout-loading]', checkoutRoot).hidden = true;
          checkout.mount('#stripe-checkout');
        })
        .catch(function (err) {
          showCheckoutError(err.status === 503 || err.status === 502 || !err.status
            ? 'Our checkout is having trouble connecting right now.'
            : err.message, lines);
        });
    }
  }

  /* ── Thank-you page: confirm the order ──────────────────────────────── */
  var thanks = $('[data-order-summary]');
  if (thanks) {
    var sid = new URLSearchParams(location.search).get('session_id');
    if (sid && /^cs_/.test(sid)) {
      api('/session-status?session_id=' + encodeURIComponent(sid)).then(function (order) {
        if (order.status === 'open') {
          thanks.innerHTML = '<p><strong>Your payment didn’t go through.</strong> Nothing was charged.</p><p><a class="btn btn--primary" href="/shop/checkout/">Try again</a></p>';
          thanks.hidden = false;
          return;
        }
        if (order.status !== 'complete') return;
        settleCheckout(sid);
        var rows = order.items.map(function (i) {
          return '<li><span>' + esc(i.name) + ' × ' + i.quantity + '</span><span>' + money(i.amount_total) + '</span></li>';
        }).join('');
        thanks.innerHTML = '<h2 class="eyebrow eyebrow--plain">Your order</h2><ul class="order-lines">' + rows +
          '<li><span>' + esc(order.shipping_name || 'Shipping') + '</span><span>' + (order.amount_shipping ? money(order.amount_shipping) : 'Free') + '</span></li>' +
          '<li class="order-lines__total"><span>Total</span><span>' + money(order.amount_total) + '</span></li></ul>' +
          (order.email ? '<p class="meta">Receipt sent to ' + esc(order.email) + '</p>' : '');
        thanks.hidden = false;
        var seen = false;
        try { seen = !!localStorage.getItem('rap_purchase_' + sid); localStorage.setItem('rap_purchase_' + sid, '1'); } catch (e) {}
        if (!seen) {
          track('purchase', {
            transaction_id: sid, currency: 'USD', value: order.amount_total / 100, shipping: (order.amount_shipping || 0) / 100,
            items: order.items.map(function (i) { return { item_id: i.sku, item_name: i.name, quantity: i.quantity, price: i.amount_total / 100 / i.quantity }; }),
          });
        }
      }).catch(function () { /* keep the generic thank-you message */ });
    }
  }

  renderCount();
  window.addEventListener('storage', function (e) { if (e.key === KEY) renderCount(); });
})();
