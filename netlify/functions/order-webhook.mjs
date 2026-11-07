// POST /api/order-webhook  ←  Stripe webhook (checkout.session.completed / async_payment_succeeded)
//
// When a hat order is paid, this starts the "QuickBooks order fix-up" Claude task through its
// API trigger. QuickBooks' built-in Stripe connection records every order on a single hat
// and folds shipping into the hat line; the task corrects that receipt from Stripe's real
// line items. This function only verifies the event and passes along the order IDs.
//
// Netlify environment variables:
//   STRIPE_WEBHOOK_SECRET  signing secret of the Stripe webhook endpoint (whsec_…)
//   ROUTINE_FIRE_URL       the task's API trigger URL (…/v1/claude_code/routines/trig_…/fire)
//   ROUTINE_FIRE_TOKEN     the task's API trigger token

import Stripe from 'stripe';

// Hat Payment Links (orders that don't go through the on-site cart).
export const HAT_PAYMENT_LINKS = new Set([
  'plink_1UTUPG44cvWiByNhaLnT2U0D', // RAP-HAT-001
  'plink_1UTUZy44cvWiByNhBHTAJ2jy', // RAP-HAT-002
  'plink_1UTUaS44cvWiByNhxkBCa1nT', // RAP-HAT-003
  'plink_1USoNN44cvWiByNh7KJsrlVo', // RAP-HAT-004
]);
const EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);

export function isHatOrder(session) {
  if (!session || session.mode !== 'payment' || session.payment_status !== 'paid') return false;
  return (session.metadata && session.metadata.source === 'ruggedaccess.org cart') ||
    HAT_PAYMENT_LINKS.has(session.payment_link);
}

export function firePayload(session) {
  return {
    text: `Paid hat order. checkout_session=${session.id} payment_intent=${session.payment_intent || ''} ` +
      `amount_total=${session.amount_total} created=${new Date(session.created * 1000).toISOString()}`,
  };
}

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function createHandler({ env = process.env, fetchImpl = fetch, stripe = new Stripe(env.STRIPE_SECRET_KEY || 'sk_unused') } = {}) {
  return async function handler(req) {
    if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' });
    if (!env.STRIPE_WEBHOOK_SECRET) return reply(503, { error: 'Webhook is not configured.' });

    const raw = await req.text();
    let event;
    try {
      event = await stripe.webhooks.constructEventAsync(raw, req.headers.get('stripe-signature') || '', env.STRIPE_WEBHOOK_SECRET);
    } catch {
      return reply(400, { error: 'Invalid signature.' });
    }

    const session = event.data && event.data.object;
    if (!EVENTS.has(event.type) || !isHatOrder(session)) return reply(200, { ignored: true });

    if (!env.ROUTINE_FIRE_URL || !env.ROUTINE_FIRE_TOKEN) {
      console.error('order-webhook: ROUTINE_FIRE_URL / ROUTINE_FIRE_TOKEN not set; order', session.id, 'not forwarded');
      return reply(503, { error: 'Fix-up task is not configured.' }); // Stripe retries for up to 3 days
    }

    const res = await fetchImpl(env.ROUTINE_FIRE_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.ROUTINE_FIRE_TOKEN}`,
        'anthropic-beta': 'experimental-cc-routine-2026-04-01',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(firePayload(session)),
    }).catch((err) => ({ ok: false, status: 0, err }));

    if (!res.ok) {
      console.error('order-webhook: fire failed', res.status, session.id);
      return reply(502, { error: 'Could not start the fix-up task.' }); // non-2xx so Stripe retries
    }
    return reply(200, { forwarded: session.id });
  };
}

export default createHandler();
export const config = { path: '/api/order-webhook' };
