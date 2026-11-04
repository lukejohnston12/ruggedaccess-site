# ruggedaccess.org

Site for Rugged Access Project, a Colorado 501(c)(3) getting people of all abilities into the backcountry.

Hosted on **GitHub Pages**, which builds the site with **Jekyll** automatically on every push to `main`. There is no separate build step to run.

## Where things live

| What | Where |
| --- | --- |
| Homepage | `index.html` |
| Shop listing | `shop/index.html` → `/shop/` |
| Hat product pages | `_products/*.md` → `/shop/<file-name>/` |
| Order thank-you page | `shop/thank-you.html` → `/shop/thank-you/` |
| Campaign data (goal, raised, gear list) | `_data/campaign.yml` |
| Site settings (email, EIN, Stripe, GA) | `_config.yml` |
| Shared header/footer/cards | `_includes/` |
| Design system (CSS) | `_includes/css/` → built into `/assets/css/main.css` |
| Living style guide | `/design-system/` (not linked, not indexed) |
| Logos, favicon, share image | `assets/brand/` |
| JavaScript | `assets/js/site.js`, `assets/js/shop.js` |

## Common updates

**Update campaign progress:** edit `raised:` in `_data/campaign.yml`. The progress bar appears once it's above `0`.

**Add a hat:** copy a file in `_products/`, rename it (the file name becomes the URL), then update the front matter: title, colorway, price, images and details. Put photos in `images/shop/` (a 768px-wide main image plus a 400px `-400` version). The shop page, filters, sorting and "more from the collection" pick it up automatically.

**Mark a hat sold out:** set `status: sold-out`.

## Hat checkout

There are two ways to check out. A switch in `_config.yml` (`shop.onsite_checkout`) picks one.

**Off (Payment Links):** each hat's **Buy now** button opens its Stripe Payment Link (`stripe_payment_link` in its `_products/` file). Stripe hosts the checkout page.

**On (on-site cart):** shoppers add hats to a cart and pay at `/shop/checkout/`. Stripe's embedded checkout form appears inside our page, so everything stays on ruggedaccess.org. The pieces:

- **Browser:** `assets/js/cart.js` (cart, embedded checkout, order summary) with the pages `shop/cart.html`, `shop/checkout.html` and `shop/thank-you.html`.
- **Server:** Netlify Functions in `netlify/functions/`, served from `ruggedaccess.netlify.app/api`:
  - `checkout` creates the Stripe Checkout Session. It re-checks every price, product and stock level with Stripe, so prices can't be changed from the browser.
  - `session-status` gives the thank-you page the order summary.
  - `stock` reports how many of each hat are left.
- **Netlify builds:** these always turn the switch on (`_config.netlify.yml`), so deploy previews can test it.

Payment Links stay set up either way. They're the fallback if the checkout API is ever down.

### One-time setup for the on-site checkout

1. **Create a restricted Stripe key:** Stripe Dashboard → Developers → API keys → Create restricted key. Give it these permissions:
   - Checkout Sessions: Write
   - Products: Read
   - Prices: Read
   - Shipping rates: Read
   - Customers: Write
2. **Add it to Netlify:** Netlify → Site configuration → Environment variables. Add `STRIPE_SECRET_KEY` with that key, then redeploy.
3. **(Optional) Track stock:** on each hat product in Stripe, add two metadata values:
   - `stock`: how many you had when you counted, for example `21`
   - `stock_as_of`: the date of that count, for example `2026-11-04`

   The site works out what's left by subtracting every paid order since that date, from the cart or Payment Links. It shows "Only N left" at 5 or fewer and blocks overselling. Nothing is written back to Stripe. After a restock, set a new count and date.
4. **Test, then go live:** place a test order on a deploy preview. When it works, set `shop.onsite_checkout: true` in `_config.yml`.

Every hat's `_products/` file needs `stripe_price_id` (its Stripe price) for the cart, and `stripe_payment_link` for the fallback.

**Tests:** `npm install && npm test` runs the API tests. Stripe is faked, so no network is needed.

## Design system

The tokens are layered: primitives, then semantic tokens, then themes (`_includes/css/01-tokens.css`). Components only use semantic tokens, so adding `.theme-ink`, `.theme-olive` or `.theme-blaze` to a section recolors everything inside it. Partials follow atomic design: tokens → base → layout → atoms → molecules → organisms → utilities.

Brand colors are sampled from the logo artwork:

- Ink `#060A0A`
- Olive `#6D765C`
- Blaze `#F26621`
- Bone `#F3EFE6` (canvas)

Contrast rule: blaze fills always carry ink text, never white.

## Local preview (optional)

```sh
gem install jekyll -v 3.10.0   # GitHub Pages' version
jekyll serve                   # http://localhost:4000
```
