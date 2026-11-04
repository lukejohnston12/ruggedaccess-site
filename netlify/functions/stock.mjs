// GET /api/stock  →  { "RAP-HAT-001": 22, ... }
// Remaining stock per SKU: each hat's `stock` metadata minus units sold since
// `stock_as_of` (see remainingStock in ../lib/shop.mjs). Untracked hats are left out.

import { CartError, SKU_PREFIX, getStripe, json, remainingStock } from '../lib/shop.mjs';

export function createHandler(stripeFactory = getStripe) {
  return async function handler(req) {
    const origin = req.headers.get('origin');
    if (req.method === 'OPTIONS') return json(204, {}, origin, 'GET, OPTIONS');
    try {
      const stripe = stripeFactory();
      const hats = [];
      for await (const product of stripe.products.list({ active: true, limit: 100 })) {
        const sku = product.metadata && (product.metadata.SKU || product.metadata.sku);
        if (typeof sku === 'string' && sku.startsWith(SKU_PREFIX)) hats.push(product);
      }
      const remaining = await remainingStock(stripe, hats);
      const out = {};
      for (const product of hats) {
        if (remaining.has(product.id)) out[product.metadata.SKU || product.metadata.sku] = remaining.get(product.id);
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
