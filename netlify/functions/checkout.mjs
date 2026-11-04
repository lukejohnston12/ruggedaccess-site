// POST /api/checkout  { items: [{ price, quantity }] }  →  { clientSecret }
// Creates an embedded Stripe Checkout Session for the cart. Every line is
// re-checked against Stripe (price, product, stock) before the session is made.

import { CartError, buildSessionParams, getStripe, json, normalizeCart, verifyCart } from '../lib/shop.mjs';

export function createHandler(stripeFactory = getStripe) {
  return async function handler(req) {
    const origin = req.headers.get('origin');
    if (req.method === 'OPTIONS') return json(204, {}, origin, 'POST, OPTIONS');
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' }, origin, 'POST, OPTIONS');
    try {
      let body;
      try { body = await req.json(); } catch { throw new CartError('Request body must be JSON.'); }
      const lines = normalizeCart(body && body.items);
      const stripe = stripeFactory();
      const checked = await verifyCart(stripe, lines);
      const session = await stripe.checkout.sessions.create(buildSessionParams(checked, origin));
      return json(200, { clientSecret: session.client_secret }, origin, 'POST, OPTIONS');
    } catch (err) {
      if (err instanceof CartError) return json(err.status, { error: err.message }, origin, 'POST, OPTIONS');
      console.error('checkout failed', err && err.message);
      return json(502, { error: 'Checkout is unavailable right now. Please try again in a moment.' }, origin, 'POST, OPTIONS');
    }
  };
}

export default createHandler();
export const config = { path: '/api/checkout' };
