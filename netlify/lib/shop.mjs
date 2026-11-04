// Shared helpers for the ruggedaccess.org checkout API (Netlify Functions).
//
// Stripe is the source of truth for what can be sold: a cart line is accepted
// only if its price is active, one-time, in USD, and belongs to an active
// product whose metadata SKU starts with "RAP-HAT-". Prices and names always
// come from Stripe, never from the browser.

import Stripe from 'stripe';

export const SITE_URL = (process.env.SITE_URL || 'https://ruggedaccess.org').replace(/\/$/, '');
export const SKU_PREFIX = 'RAP-HAT-';
export const MAX_PER_LINE = 5;
export const MAX_PER_ORDER = 10;
export const MAX_LINES = 10;

// The two shipping options the Payment Links already use: free and $7.99.
export const SHIPPING_RATES = (process.env.STRIPE_SHIPPING_RATES ||
  'shr_1UTUgZ44cvWiByNhdTihS9rm,shr_1UTUcD44cvWiByNhO2rkMIdV')
  .split(',').map((s) => s.trim()).filter(Boolean);

const ALLOWED_ORIGINS = [
  /^https:\/\/(www\.)?ruggedaccess\.org$/,
  /^https:\/\/([a-z0-9-]+--)?ruggedaccess\.netlify\.app$/, // production + deploy previews
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

export function isAllowedOrigin(origin) {
  return typeof origin === 'string' && ALLOWED_ORIGINS.some((re) => re.test(origin));
}

export function corsHeaders(origin, methods = 'GET, POST, OPTIONS') {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = methods;
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '600';
  }
  return headers;
}

export function json(status, body, origin, methods) {
  // 204 (CORS preflight) must not carry a body.
  const payload = status === 204 ? null : JSON.stringify(body);
  return new Response(payload, { status, headers: corsHeaders(origin, methods) });
}

export class CartError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

let cachedStripe = null;
export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new CartError('Online checkout is not configured yet.', 503);
  }
  if (!cachedStripe) cachedStripe = new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 });
  return cachedStripe;
}

// Cart from the browser: [{ price: "price_…", quantity: 1..5 }]. Merges duplicates.
export function normalizeCart(items) {
  if (!Array.isArray(items) || items.length === 0) throw new CartError('Your cart is empty.');
  const merged = new Map();
  for (const item of items) {
    const price = item && item.price;
    const quantity = Number(item && item.quantity);
    if (typeof price !== 'string' || !/^price_[A-Za-z0-9]+$/.test(price)) throw new CartError('A cart item is not valid.');
    if (!Number.isInteger(quantity) || quantity < 1) throw new CartError('A cart quantity is not valid.');
    merged.set(price, (merged.get(price) || 0) + quantity);
  }
  if (merged.size > MAX_LINES) throw new CartError(`Please keep your cart to ${MAX_LINES} different items.`);
  const lines = [...merged].map(([price, quantity]) => ({ price, quantity }));
  for (const line of lines) {
    if (line.quantity > MAX_PER_LINE) throw new CartError(`You can buy up to ${MAX_PER_LINE} of each hat per order.`);
  }
  const total = lines.reduce((n, l) => n + l.quantity, 0);
  if (total > MAX_PER_ORDER) throw new CartError(`You can buy up to ${MAX_PER_ORDER} hats per order.`);
  return lines;
}

export function readStock(product) {
  const raw = product && product.metadata && product.metadata.stock;
  if (raw === undefined || raw === null || raw === '') return null; // not tracked
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

// Check each line against Stripe and return the lines with their products attached.
export async function verifyCart(stripe, lines) {
  const checked = [];
  for (const line of lines) {
    let price;
    try {
      price = await stripe.prices.retrieve(line.price, { expand: ['product'] });
    } catch (err) {
      throw new CartError('One of the hats in your cart is no longer available.');
    }
    const product = price.product;
    const sku = product && product.metadata && (product.metadata.SKU || product.metadata.sku);
    const sellable = price.active && price.type === 'one_time' && price.currency === 'usd' &&
      product && typeof product === 'object' && product.active && typeof sku === 'string' && sku.startsWith(SKU_PREFIX);
    if (!sellable) throw new CartError('One of the hats in your cart is no longer available.');
    const stock = readStock(product);
    if (stock !== null && line.quantity > stock) {
      throw new CartError(stock === 0
        ? `${product.name} just sold out. Please remove it from your cart.`
        : `Only ${stock} left of ${product.name}. Please lower the quantity.`, 409);
    }
    checked.push({ ...line, sku, name: product.name, unit_amount: price.unit_amount });
  }
  return checked;
}

export function returnBase(origin) {
  return isAllowedOrigin(origin) ? origin : SITE_URL;
}

export function buildSessionParams(checked, origin) {
  const skus = checked.map((l) => `${l.sku}x${l.quantity}`).join(',');
  return {
    mode: 'payment',
    ui_mode: 'embedded_page',
    line_items: checked.map((l) => ({ price: l.price, quantity: l.quantity })),
    shipping_address_collection: { allowed_countries: ['US'] },
    shipping_options: SHIPPING_RATES.map((id) => ({ shipping_rate: id })),
    billing_address_collection: 'required',
    phone_number_collection: { enabled: true },
    customer_creation: 'always',
    return_url: `${returnBase(origin)}/shop/thank-you/?session_id={CHECKOUT_SESSION_ID}`,
    metadata: { source: 'ruggedaccess.org cart', skus },
    payment_intent_data: { description: 'Rugged Access hats', metadata: { source: 'ruggedaccess.org cart', skus } },
  };
}

// Only what the thank-you page needs; no addresses or payment details.
export function summarizeSession(session) {
  const items = ((session.line_items && session.line_items.data) || []).map((li) => {
    const product = li.price && li.price.product;
    return {
      name: li.description,
      quantity: li.quantity,
      amount_total: li.amount_total,
      price: li.price && li.price.id,
      sku: (product && product.metadata && (product.metadata.SKU || product.metadata.sku)) || null,
    };
  });
  return {
    status: session.status,
    payment_status: session.payment_status,
    amount_total: session.amount_total,
    amount_shipping: (session.shipping_cost && session.shipping_cost.amount_total) || 0,
    currency: session.currency,
    email: (session.customer_details && session.customer_details.email) || null,
    items,
  };
}
