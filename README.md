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

## Stripe checkout for hats

GitHub Pages can't run server code, so each hat uses a **Stripe Payment Link**:

1. Stripe Dashboard → Product catalog → add the hat (name, price, photo).
2. Payment Links → New → choose the product. Recommended settings:
   - Turn on **Let customers adjust quantity**.
   - Turn on **Collect shipping address** and add shipping rates.
   - Under **After payment**, choose **Don't show confirmation page** → redirect to `https://ruggedaccess.org/shop/thank-you/`.
3. Paste the link (`https://buy.stripe.com/...`) into `stripe_payment_link:` in the hat's `_products/` file.

Until a link is set, the product page shows an **Order by email** button instead.

A multi-item cart would need a small serverless function (for example a Cloudflare Worker) to create Stripe Checkout Sessions. The product data is already structured to support that later.

Donations keep using the existing Stripe Buy Button (IDs in `_config.yml`).

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
