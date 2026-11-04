// GET /api/session-status?session_id=cs_…  →  order summary for the thank-you page.
// Returns status, totals, the buyer's email and line items only (no address or card details).

import { CartError, getStripe, json, summarizeSession } from '../lib/shop.mjs';

export function createHandler(stripeFactory = getStripe) {
  return async function handler(req) {
    const origin = req.headers.get('origin');
    if (req.method === 'OPTIONS') return json(204, {}, origin, 'GET, OPTIONS');
    if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' }, origin, 'GET, OPTIONS');
    const id = new URL(req.url).searchParams.get('session_id') || '';
    if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(id)) return json(400, { error: 'Missing or invalid session_id.' }, origin, 'GET, OPTIONS');
    try {
      const stripe = stripeFactory();
      const session = await stripe.checkout.sessions.retrieve(id, { expand: ['line_items.data.price.product'] });
      return json(200, summarizeSession(session), origin, 'GET, OPTIONS');
    } catch (err) {
      if (err instanceof CartError) return json(err.status, { error: err.message }, origin, 'GET, OPTIONS');
      return json(404, { error: 'Order not found.' }, origin, 'GET, OPTIONS');
    }
  };
}

export default createHandler();
export const config = { path: '/api/session-status' };
