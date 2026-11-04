// GET /api/stock  →  { "RAP-HAT-001": 22, ... }
// Remaining stock per SKU, from each Stripe product's `stock` metadata.
// Hats without a `stock` value are left out (treated as untracked).

import { CartError, SKU_PREFIX, getStripe, json, readStock } from '../lib/shop.mjs';

export function createHandler(stripeFactory = getStripe) {
  return async function handler(req) {
    const origin = req.headers.get('origin');
    if (req.method === 'OPTIONS') return json(204, {}, origin, 'GET, OPTIONS');
    try {
      const stripe = stripeFactory();
      const out = {};
      for await (const product of stripe.products.list({ active: true, limit: 100 })) {
        const sku = product.metadata && (product.metadata.SKU || product.metadata.sku);
        const stock = readStock(product);
        if (typeof sku === 'string' && sku.startsWith(SKU_PREFIX) && stock !== null) out[sku] = stock;
      }
      const res = json(200, out, origin, 'GET, OPTIONS');
      res.headers.set('Cache-Control', 'public, max-age=60');
      return res;
    } catch (err) {
      if (err instanceof CartError) return json(err.status, { error: err.message }, origin, 'GET, OPTIONS');
      return json(502, { error: 'Stock is unavailable right now.' }, origin, 'GET, OPTIONS');
    }
  };
}

export default createHandler();
export const config = { path: '/api/stock' };
