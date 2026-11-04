// POST /api/stripe-webhook  (Stripe → us, signed)
// On a paid checkout (cart or Payment Link), lower each hat's `stock` metadata
// in Stripe by the quantity sold. Each session is counted once: we mark it with
// metadata.stock_counted = "true" after updating.

import { SKU_PREFIX, getStripe, readStock } from '../lib/shop.mjs';

const HANDLED = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);

export async function applySale(stripe, sessionId) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items.data.price.product'] });
  if (session.payment_status !== 'paid') return { skipped: 'not paid' };
  if (session.metadata && session.metadata.stock_counted === 'true') return { skipped: 'already counted' };
  const changes = [];
  for (const li of (session.line_items && session.line_items.data) || []) {
    const product = li.price && li.price.product;
    const sku = product && product.metadata && (product.metadata.SKU || product.metadata.sku);
    if (!product || typeof sku !== 'string' || !sku.startsWith(SKU_PREFIX)) continue;
    const fresh = await stripe.products.retrieve(product.id); // re-read to avoid a stale count
    const stock = readStock(fresh);
    if (stock === null) continue;
    const next = Math.max(0, stock - (li.quantity || 0));
    await stripe.products.update(product.id, { metadata: { stock: String(next) } });
    changes.push({ sku, from: stock, to: next });
  }
  await stripe.checkout.sessions.update(session.id, { metadata: { ...(session.metadata || {}), stock_counted: 'true' } });
  return { changes };
}

export function createHandler(stripeFactory = getStripe, secret = process.env.STRIPE_WEBHOOK_SECRET) {
  return async function handler(req) {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (!secret) return new Response('Webhook not configured', { status: 501 });
    const signature = req.headers.get('stripe-signature');
    const payload = await req.text();
    let stripe;
    let event;
    try {
      stripe = stripeFactory();
      event = await stripe.webhooks.constructEventAsync(payload, signature, secret);
    } catch (err) {
      return new Response('Bad signature', { status: 400 });
    }
    if (!HANDLED.has(event.type)) return new Response('Ignored', { status: 200 });
    try {
      const result = await applySale(stripe, event.data.object.id);
      console.log('stock update', event.id, JSON.stringify(result));
      return new Response('OK', { status: 200 });
    } catch (err) {
      console.error('stock update failed', event.id, err && err.message);
      return new Response('Retry later', { status: 500 }); // Stripe retries
    }
  };
}

export default createHandler();
export const config = { path: '/api/stripe-webhook' };
