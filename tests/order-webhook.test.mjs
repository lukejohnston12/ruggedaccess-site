import { test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { createHandler, isHatOrder } from '../netlify/functions/order-webhook.mjs';

const stripe = new Stripe('sk_test_unused');
const SECRET = 'whsec_test_secret';
const ENV = { STRIPE_WEBHOOK_SECRET: SECRET, ROUTINE_FIRE_URL: 'https://api.anthropic.com/v1/claude_code/routines/trig_x/fire', ROUTINE_FIRE_TOKEN: 'tok' };

const cartSession = { id: 'cs_live_1', mode: 'payment', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 8799, created: 1794000000, metadata: { source: 'ruggedaccess.org cart' }, payment_link: null };

function signed(event, secret = SECRET) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request('https://ruggedaccess.netlify.app/api/order-webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': header } });
}
function recorder(ok = true) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok, status: ok ? 200 : 500 }; };
  return { calls, fetchImpl };
}

test('paid hat order starts the fix-up task with the order IDs', async () => {
  const r = recorder();
  const res = await createHandler({ env: ENV, fetchImpl: r.fetchImpl, stripe })(signed({ type: 'checkout.session.completed', data: { object: cartSession } }));
  assert.equal(res.status, 200);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].url, ENV.ROUTINE_FIRE_URL);
  assert.equal(r.calls[0].init.headers.authorization, 'Bearer tok');
  assert.equal(r.calls[0].init.headers['anthropic-beta'], 'experimental-cc-routine-2026-04-01');
  assert.match(JSON.parse(r.calls[0].init.body).text, /checkout_session=cs_live_1 payment_intent=pi_1 amount_total=8799/);
});

test('bad signature is rejected and nothing is started', async () => {
  const r = recorder();
  const res = await createHandler({ env: ENV, fetchImpl: r.fetchImpl, stripe })(signed({ type: 'checkout.session.completed', data: { object: cartSession } }, 'whsec_wrong'));
  assert.equal(res.status, 400);
  assert.equal(r.calls.length, 0);
});

test('donations, unpaid sessions and other events are ignored', async () => {
  assert.equal(isHatOrder({ ...cartSession, metadata: {}, payment_link: 'plink_1SW8AB44cvWiByNhQxcMZY62' }), false);
  assert.equal(isHatOrder({ ...cartSession, payment_status: 'unpaid' }), false);
  assert.equal(isHatOrder({ ...cartSession, metadata: {}, payment_link: 'plink_1UTUaS44cvWiByNhxkBCa1nT' }), true);
  const r = recorder();
  const res = await createHandler({ env: ENV, fetchImpl: r.fetchImpl, stripe })(signed({ type: 'payment_intent.succeeded', data: { object: cartSession } }));
  assert.equal(res.status, 200);
  assert.equal(r.calls.length, 0);
});

test('a failed or unconfigured fire returns non-2xx so Stripe retries', async () => {
  const ev = { type: 'checkout.session.completed', data: { object: cartSession } };
  assert.equal((await createHandler({ env: ENV, fetchImpl: recorder(false).fetchImpl, stripe })(signed(ev))).status, 502);
  assert.equal((await createHandler({ env: { STRIPE_WEBHOOK_SECRET: SECRET }, fetchImpl: recorder().fetchImpl, stripe })(signed(ev))).status, 503);
});
