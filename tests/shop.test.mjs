// Run with: npm test   (Node's built-in test runner; Stripe is faked, no network)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCart, isAllowedOrigin, verifyCart, remainingStock, readStockBaseline } from '../netlify/lib/shop.mjs';
import { createHandler as checkoutHandler } from '../netlify/functions/checkout.mjs';
import { createHandler as statusHandler } from '../netlify/functions/session-status.mjs';
import { createHandler as stockHandler } from '../netlify/functions/stock.mjs';

const HAT = (id, sku, extra = {}) => ({ id, active: true, name: `Hat ${sku}`, metadata: { SKU: sku, ...extra } });
const PRICES = {
  price_camo: { id: 'price_camo', active: true, type: 'one_time', currency: 'usd', unit_amount: 4000, product: HAT('prod_camo', 'RAP-HAT-004', { stock: '22', stock_as_of: '2026-11-01' }) },
  price_black: { id: 'price_black', active: true, type: 'one_time', currency: 'usd', unit_amount: 4000, product: HAT('prod_black', 'RAP-HAT-003', { stock: '2' }) },
  price_donation: { id: 'price_donation', active: true, type: 'one_time', currency: 'usd', unit_amount: null, product: { id: 'prod_don', active: true, name: 'Donation', metadata: {} } },
  price_old: { id: 'price_old', active: false, type: 'one_time', currency: 'usd', unit_amount: 4000, product: HAT('prod_old', 'RAP-HAT-009') },
};

const NOV1 = Math.floor(Date.parse('2026-11-01') / 1000);
const SESSIONS = [
  // after the count: 2 camo sold (paid) -> counts
  { created: NOV1 + 3600, payment_status: 'paid', line_items: { data: [{ quantity: 2, price: { id: 'price_camo', product: 'prod_camo' } }] } },
  // before the count -> ignored
  { created: NOV1 - 3600, payment_status: 'paid', line_items: { data: [{ quantity: 5, price: { id: 'price_camo', product: 'prod_camo' } }] } },
  // unpaid (async payment pending) -> ignored
  { created: NOV1 + 7200, payment_status: 'unpaid', line_items: { data: [{ quantity: 9, price: { id: 'price_camo', product: 'prod_camo' } }] } },
];

function fakeStripe() {
  const calls = { created: [], productUpdates: [], sessionUpdates: [], listed: [] };
  const products = { prod_camo: PRICES.price_camo.product, prod_black: PRICES.price_black.product };
  return {
    calls,
    prices: {
      async retrieve(id) {
        if (!PRICES[id]) throw new Error('No such price');
        return structuredClone(PRICES[id]);
      },
    },
    products: {
      async retrieve(id) { return structuredClone(products[id]); },
      async update(id, params) { calls.productUpdates.push([id, params]); products[id].metadata = { ...products[id].metadata, ...params.metadata }; return products[id]; },
      list() {
        const all = Object.values(PRICES).map((p) => p.product);
        return { async *[Symbol.asyncIterator]() { yield* all; } };
      },
    },
    checkout: {
      sessions: {
        async create(params) { calls.created.push(params); return { id: 'cs_test_123', client_secret: 'cs_test_123_secret_abc' }; },
        async retrieve(id) {
          return {
            id, status: 'complete', payment_status: 'paid', amount_total: 8000, currency: 'usd',
            shipping_cost: { amount_total: 0, shipping_rate: { id: 'shr_x', display_name: 'Pickup in Minturn' } }, metadata: {},
            customer_details: { email: 'buyer@example.com', address: { line1: 'secret street' } },
            line_items: { data: [{ description: 'Hat RAP-HAT-004', quantity: 2, amount_total: 8000, price: { id: 'price_camo', product: { id: 'prod_camo', metadata: { SKU: 'RAP-HAT-004' } } } }] },
          };
        },
        async update(id, params) { calls.sessionUpdates.push([id, params]); return {}; },
        list(params) {
          calls.listed.push(params);
          const rows = SESSIONS.filter((x) => x.created >= params.created.gte);
          return { async *[Symbol.asyncIterator]() { yield* rows; } };
        },
      },
    },
    webhooks: {
      async constructEventAsync(payload, sig) {
        if (sig !== 'good') throw new Error('bad sig');
        return JSON.parse(payload);
      },
    },
  };
}

const post = (body, origin = 'https://ruggedaccess.org') => new Request('https://ruggedaccess.netlify.app/api/checkout', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
});

test('normalizeCart merges duplicates and enforces limits', () => {
  assert.deepEqual(normalizeCart([{ price: 'price_a', quantity: 1 }, { price: 'price_a', quantity: 2 }]), [{ price: 'price_a', quantity: 3 }]);
  assert.throws(() => normalizeCart([]), /empty/);
  assert.throws(() => normalizeCart([{ price: 'price_a', quantity: 6 }]), /up to 5/);
  assert.throws(() => normalizeCart([{ price: 'bad', quantity: 1 }]), /not valid/);
  assert.throws(() => normalizeCart([{ price: 'price_a', quantity: 0 }]), /not valid/);
  const eleven = ['a', 'b', 'c'].map((x) => ({ price: `price_${x}`, quantity: 4 }));
  assert.throws(() => normalizeCart(eleven), /up to 10 hats/);
});

test('origins: site, Netlify previews and localhost only', () => {
  for (const o of ['https://ruggedaccess.org', 'https://www.ruggedaccess.org', 'https://ruggedaccess.netlify.app', 'https://deploy-preview-42--ruggedaccess.netlify.app', 'http://localhost:4000']) {
    assert.equal(isAllowedOrigin(o), true, o);
  }
  for (const o of ['https://evil.com', 'https://ruggedaccess.org.evil.com', 'https://evil--other.netlify.app', null]) {
    assert.equal(isAllowedOrigin(o), false, String(o));
  }
});

test('verifyCart rejects non-hat, inactive and over-stock lines', async () => {
  const stripe = fakeStripe();
  await assert.rejects(verifyCart(stripe, [{ price: 'price_donation', quantity: 1 }]), /no longer available/);
  await assert.rejects(verifyCart(stripe, [{ price: 'price_old', quantity: 1 }]), /no longer available/);
  await assert.rejects(verifyCart(stripe, [{ price: 'price_missing', quantity: 1 }]), /no longer available/);
  await assert.rejects(verifyCart(stripe, [{ price: 'price_black', quantity: 3 }]), /Only 2 left/);
  const ok = await verifyCart(stripe, [{ price: 'price_camo', quantity: 2 }]);
  assert.equal(ok[0].sku, 'RAP-HAT-004');
});

test('checkout creates an embedded session with shipping and a return URL', async () => {
  const stripe = fakeStripe();
  const res = await checkoutHandler(() => stripe)(post({ items: [{ price: 'price_camo', quantity: 2 }] }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { clientSecret: 'cs_test_123_secret_abc' });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://ruggedaccess.org');
  const p = stripe.calls.created[0];
  assert.equal(p.ui_mode, 'embedded_page');
  assert.equal(p.mode, 'payment');
  assert.deepEqual(p.line_items, [{ price: 'price_camo', quantity: 2 }]);
  assert.deepEqual(p.shipping_address_collection, { allowed_countries: ['US'] });
  assert.equal(p.shipping_options.length, 2);
  assert.equal(p.shipping_options[0].shipping_rate, 'shr_1UTUcD44cvWiByNhO2rkMIdV'); // $7.99 shipping is the default
  assert.deepEqual(p.branding_settings, { background_color: '#F3EFE6', button_color: '#F26621', border_style: 'rectangular', font_family: 'source_sans_pro', display_name: 'Rugged Access Project' });
  assert.equal(p.return_url, 'https://ruggedaccess.org/shop/thank-you/?session_id={CHECKOUT_SESSION_ID}');
  assert.equal(p.metadata.skus, 'RAP-HAT-004x2');
});

test('checkout returns to the preview site when called from a deploy preview', async () => {
  const stripe = fakeStripe();
  const origin = 'https://deploy-preview-42--ruggedaccess.netlify.app';
  await checkoutHandler(() => stripe)(post({ items: [{ price: 'price_camo', quantity: 1 }] }, origin));
  assert.ok(stripe.calls.created[0].return_url.startsWith(origin + '/shop/thank-you/'));
});

test('checkout errors are friendly and never create a session', async () => {
  const stripe = fakeStripe();
  const h = checkoutHandler(() => stripe);
  let res = await h(post({ items: [{ price: 'price_black', quantity: 3 }] }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Only 2 left/);
  res = await h(post({ items: [] }));
  assert.equal(res.status, 400);
  res = await h(new Request('https://x/api/checkout', { method: 'GET' }));
  assert.equal(res.status, 405);
  res = await h(new Request('https://x/api/checkout', { method: 'OPTIONS', headers: { Origin: 'https://ruggedaccess.org' } }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(stripe.calls.created.length, 0);
});

test('checkout reports 503 when the secret key is missing', async () => {
  const saved = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  const { createHandler } = await import('../netlify/functions/checkout.mjs');
  const res = await createHandler()(post({ items: [{ price: 'price_camo', quantity: 1 }] }));
  assert.equal(res.status, 503);
  if (saved) process.env.STRIPE_SECRET_KEY = saved;
});

test('session status returns a summary without address details', async () => {
  const stripe = fakeStripe();
  const h = statusHandler(() => stripe);
  let res = await h(new Request('https://x/api/session-status?session_id=cs_live_abc123', { headers: { Origin: 'https://ruggedaccess.org' } }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'complete');
  assert.equal(body.amount_total, 8000);
  assert.equal(body.items[0].sku, 'RAP-HAT-004');
  assert.equal(body.shipping_name, 'Pickup in Minturn');
  assert.equal(JSON.stringify(body).includes('secret street'), false);
  res = await h(new Request('https://x/api/session-status?session_id=nope'));
  assert.equal(res.status, 400);
});

test('stock lists only tracked hat SKUs', async () => {
  const res = await stockHandler(() => fakeStripe())(new Request('https://x/api/stock'));
  assert.deepEqual(await res.json(), { 'RAP-HAT-004': 20, 'RAP-HAT-003': 2 });
});

test('stock = count minus paid units sold since stock_as_of, never written back', async () => {
  const stripe = fakeStripe();
  const camo = PRICES.price_camo.product;
  const left = await remainingStock(stripe, [camo, PRICES.price_black.product, PRICES.price_donation.product]);
  assert.equal(left.get('prod_camo'), 20);      // 22 counted, 2 paid since (pre-count and unpaid ignored)
  assert.equal(left.get('prod_black'), 2);      // no stock_as_of: used as-is
  assert.equal(left.has('prod_don'), false);    // untracked
  assert.deepEqual(stripe.calls.listed[0], { status: 'complete', created: { gte: NOV1 }, limit: 100, expand: ['data.line_items'] });
  assert.equal(stripe.calls.productUpdates.length, 0);
  assert.equal(stripe.calls.sessionUpdates.length, 0);
});

test('checkout blocks a cart that exceeds computed stock', async () => {
  const stripe = fakeStripe();
  await assert.rejects(verifyCart(stripe, [{ price: 'price_camo', quantity: 5 }]).then(() => verifyCart(stripe, [{ price: 'price_camo', quantity: 21 }])), /Only 20 left/);
});

test('stock baseline parsing', () => {
  assert.equal(readStockBaseline({ metadata: {} }), null);
  assert.equal(readStockBaseline({ metadata: { stock: 'abc' } }), null);
  assert.deepEqual(readStockBaseline({ metadata: { stock: '7' } }), { count: 7, since: null });
  assert.deepEqual(readStockBaseline({ metadata: { stock: '7', stock_as_of: '1793750400' } }), { count: 7, since: 1793750400 });
  assert.deepEqual(readStockBaseline({ metadata: { stock: '-3', stock_as_of: '2026-11-01' } }), { count: 0, since: NOV1 });
});
