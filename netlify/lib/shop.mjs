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

// Shipping options, in the order shoppers see them. The first is the default,
// so standard shipping ($7.99) leads and pickup in Minturn ($0) is the opt-in.
export const SHIPPING_RATES = (process.env.STRIPE_SHIPPING_RATES ||
  'shr_1UTUcD44cvWiByNhO2rkMIdV,shr_1UTUgZ44cvWiByNhdTihS9rm')
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

// Stock lives on each Stripe hat product as metadata:
//   stock        = how many were on hand when counted, e.g. "21"
//   stock_as_of  = when that count was taken, e.g. "2026-11-04" (or a Unix timestamp)
// Remaining = stock minus hats sold (paid Checkout Sessions, cart or Payment Link)
// since stock_as_of. Nothing is ever written back, so concurrent orders and retries
// can't corrupt the count. Without stock_as_of the stock value is used as-is.
export function readStockBaseline(product) {
  const meta = (product && product.metadata) || {};
  if (meta.stock === undefined || meta.stock === null || meta.stock === '') return null; // untracked
  const count = Number.parseInt(meta.stock, 10);
  if (!Number.isFinite(count)) return null;
  let since = null;
  if (meta.stock_as_of) {
    const raw = String(meta.stock_as_of).trim();
    since = /^\d+$/.test(raw) ? Number(raw) : Math.floor(Date.parse(raw) / 1000);
    if (!Number.isFinite(since)) since = null;
  }
  return { count: Math.max(0, count), since };
}

// Units sold per product id since `since` (Unix seconds), from completed, paid sessions.
export async function unitsSoldSince(stripe, since) {
  const sales = []; // { product, created, quantity }
  const list = stripe.checkout.sessions.list({ status: 'complete', created: { gte: since }, limit: 100, expand: ['data.line_items'] });
  for await (const session of list) {
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') continue;
    for (const li of (session.line_items && session.line_items.data) || []) {
      const product = li.price && (typeof li.price.product === 'string' ? li.price.product : li.price.product && li.price.product.id);
      if (product) sales.push({ product, created: session.created, quantity: li.quantity || 0 });
    }
  }
  return sales;
}

// products: Stripe product objects. Returns Map(productId -> remaining) for tracked hats.
export async function remainingStock(stripe, products) {
  const tracked = products.map((p) => ({ p, base: readStockBaseline(p) })).filter((t) => t.base);
  const result = new Map();
  const withSince = tracked.filter((t) => t.base.since !== null);
  const sales = withSince.length ? await unitsSoldSince(stripe, Math.min(...withSince.map((t) => t.base.since))) : [];
  for (const { p, base } of tracked) {
    const sold = base.since === null ? 0 : sales
      .filter((s) => s.product === p.id && s.created >= base.since)
      .reduce((n, s) => n + s.quantity, 0);
    result.set(p.id, Math.max(0, base.count - sold));
  }
  return result;
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
    checked.push({ ...line, sku, name: product.name, unit_amount: price.unit_amount, product });
  }
  const stock = await remainingStock(stripe, checked.map((l) => l.product));
  for (const l of checked) {
    if (!stock.has(l.product.id)) continue;
    const left = stock.get(l.product.id);
    if (l.quantity > left) {
      throw new CartError(left === 0
        ? `${l.name} just sold out. Please remove it from your cart.`
        : `Only ${left} left of ${l.name}. Please lower the quantity.`, 409);
    }
  }
  return checked.map(({ product, ...rest }) => rest);
}

export function returnBase(origin) {
  return isAllowedOrigin(origin) ? origin : SITE_URL;
}

// Itemized order text for the payment's description, e.g.
// "Rugged Access hats: 1 × Black 5 panel Trucker (RAP-HAT-003), 1 × Camo Rope Hat (RAP-HAT-004)".
// The Stripe → QuickBooks sync copies this onto each sales receipt, and it shows on the
// payment in the Stripe Dashboard, so every order says exactly which hats were bought.
export function orderDescription(checked) {
  const items = checked.map((l) => `${l.quantity} × ${l.name || 'Hat'} (${l.sku})`).join(', ');
  const text = `Rugged Access hats: ${items}`;
  return text.length > 1000 ? `${text.slice(0, 997)}...` : text;
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
    // Match the embedded form to the site: bone background, blaze-orange Pay button
    // (the site's primary CTA color), square-ish corners.
    branding_settings: {
      background_color: '#F3EFE6',
      button_color: '#F26621',
      border_style: 'rounded', // closest preset to the site's 6px button radius
      font_family: 'source_sans_pro',
      display_name: 'Rugged Access Project',
    },
    metadata: { source: 'ruggedaccess.org cart', skus },
    payment_intent_data: { description: orderDescription(checked), metadata: { source: 'ruggedaccess.org cart', skus } },
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
    shipping_name: (session.shipping_cost && session.shipping_cost.shipping_rate &&
      typeof session.shipping_cost.shipping_rate === 'object' && session.shipping_cost.shipping_rate.display_name) || null,
    currency: session.currency,
    email: (session.customer_details && session.customer_details.email) || null,
    items,
  };
}
