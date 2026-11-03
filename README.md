# Crow & Moon Enchantments

The website and online shop for **Crow & Moon Enchantments**, Nadine's shop in Warrenville, IL.

- **Live site:** https://crowandmoonenchantments.net
- **Repository:** `bengray/crow-and-moon-enchantments` (GitHub)
- **Hosting and shop API:** Firebase project `crow-and-moon-enchantments`
- **Products, stock, payments:** Nadine's Square account (production)
- **Shipping prices:** Nadine's FedEx account (One Rate, Express Saver)

It's a static [Eleventy](https://www.11ty.dev) site (Nunjucks templates, Sass, esbuild), started from the CodeStitch Intermediate kit and hosted on Firebase. The shop is backed by Square, with a few small Firebase Functions for live stock, checkout and shipping prices.

This README is the "coming back to it later" guide. For the full, one-time setup of Square, Firebase, GitHub and FedEx, see [SHOP-SETUP.md](SHOP-SETUP.md).

---

## How it all fits together

```
Square (Nadine's catalog, stock, payments)          FedEx (One Rate box prices)
   │                       ▲                              │
   │ build: products       │ checkout: payment link       │ daily, 4 a.m. Central
   ▼                       │ stock: live on every view    ▼
Eleventy build ──► Firebase Hosting ──► /api/* ──► Firebase Functions ──► Firestore
   ▲                                                    │                (saved prices)
   └── GitHub Actions ◄── repository_dispatch ◄─────────┘
                           (Square webhook: catalog changed)
```

- **Products** (names, prices, photos, descriptions) are read from Square when the site builds. When Nadine edits her catalog, Square calls a webhook, the webhook asks GitHub to rebuild, and the site updates a few minutes later.
- **Stock** is fetched live from Square every time a shop page loads, so a sale at a fair shows online right away. **Sales never rebuild the site.**
- **Sold-out items** stay visible, greyed out, at the end of the shop grid, and can't be added to the basket. Nadine can hide any item completely by putting it in her Square category **Not Online**.
- **The basket** lives in the shopper's browser. At checkout, the server rechecks stock, works out shipping, and creates a single Square payment link. The browser only ever sends item IDs, quantities and "ship" or "pickup"; prices always come from Square and FedEx on the server.
- **Shipping** is a FedEx One Rate box picked by item count (1–2 Small, 3–5 Medium, 6–10 Large). Prices come from FedEx once a day and are saved in Firestore, and the basket and checkout both use them. They're quoted for the far ("national") distance band, so one price covers anywhere in the US. More than 10 items can't be shipped online, and the shopper is asked to email for a quote.
- **Local pickup** has no shipping charge and no item limit. Square doesn't ask for an address, and the payment is marked `LOCAL PICKUP - do not ship` in Nadine's Square dashboard.

---

## Running it locally

```bash
npm install
npm start            # http://localhost:8080, rebuilds as you edit
```

- With no `.env` at the repo root, the shop uses placeholder products and checkout says "almost ready." To build from real Square data, copy `.env.example` to `.env` and fill in a Square token and `SQUARE_ENVIRONMENT`.
- Local builds have no `/api/*` functions, so live stock, shipping prices and checkout don't work under `npm start`. The page keeps the stock numbers from the build, and the basket uses the backup shipping prices.
- **The full shop flow without any Square account:**
  ```bash
  node functions/test/fake-square.js                  # terminal 1: a fake Square
  SQUARE_ACCESS_TOKEN=test-token SQUARE_API_BASE=http://localhost:4010/v2 npm run build
  node functions/test/dev-server.js                   # terminal 2: http://localhost:8090
  ```

**Shop API tests** (Square, FedEx, checkout, shipping, pickup; all faked, no network):

```bash
cd functions && npm install && npm test
```

**Check the FedEx connection** (prints today's price for each box, saves nothing):

```bash
node functions/scripts/check-fedex.js
```

---

## Deploying

There are two separate things to deploy, and they update in different ways.

| What | How it deploys |
|---|---|
| **The site** (pages, styles, basket script, products from Square) | Automatically, by GitHub Actions, on every push to `main`, every Square catalog change, or "Run workflow" on the Actions tab. |
| **The functions** (stock, checkout, webhook, shipping prices) | **By hand only**, from your machine: `firebase deploy --only functions` |

Rules that will save you an afternoon:

1. **Changed a Firebase secret or `functions/.env`? Redeploy the functions.** Functions lock in their settings when they're deployed, so changes don't take effect until you run `firebase deploy --only functions`. (A stale deploy once made every product show "Sold out.")
2. **Deploy functions before the site** whenever `firebase.json` points at a new function. Firebase rejects a site deploy that routes to a function that doesn't exist yet.
3. **Pull request previews use the real, production functions.** Opening a PR publishes a temporary preview site, but its stock, checkout and shipping calls go to the live functions. **A checkout on a preview is a real payment** on Nadine's account. Refund test orders.
4. **The site and the functions must use the same Square environment.** If the site is built from one account or environment and the functions use another, Square won't recognize any item and the whole shop shows as sold out. The stock function logs a warning when this happens.

---

## Settings and secrets: where everything lives

| Setting | Where | Notes |
|---|---|---|
| Square access token | Firebase secret `SQUARE_ACCESS_TOKEN` **and** GitHub secret `SQUARE_ACCESS_TOKEN` | Same production token in both. The site build uses GitHub's copy; the functions use Firebase's. |
| Square environment | `functions/.env` **and** GitHub variable `SQUARE_ENVIRONMENT` | `production` in both. |
| Square location | `functions/.env` and GitHub variable `SQUARE_LOCATION_ID` | Leave blank if Nadine has one location. |
| Square webhook signature key | Firebase secret `SQUARE_WEBHOOK_SIGNATURE_KEY` | From the webhook subscription in Square's developer app (Production). |
| GitHub token for rebuilds | Firebase secret `GITHUB_DISPATCH_TOKEN` | Fine-grained token, Contents read/write on this repo. **It expires**; when it does, catalog edits stop rebuilding the site. |
| FedEx API key, secret key, account number | Firebase secrets `FEDEX_API_KEY`, `FEDEX_SECRET_KEY`, `FEDEX_ACCOUNT_NUMBER` | The account must be linked to the API project in the FedEx Developer Portal. |
| Site address, webhook URL | `functions/.env`: `SITE_URL`, `SQUARE_WEBHOOK_URL` | `https://crowandmoonenchantments.net`. The webhook URL must match Square's setting character for character. |
| FedEx ship-from ZIP, speed, drop-off/pickup | `functions/.env`: `FEDEX_*` | See `functions/.env.example` for every option. |
| Boxes, items per box, backup prices, pickup text | `functions/shipping-rates.js` | Committed to git. |
| The Square **Application ID** | Not used anywhere | Only needed for on-site card forms; this shop uses Square's hosted checkout. |

The `.env` files are git-ignored.

- **`functions/.env`** is uploaded to Firebase with the functions, so **never put secrets in it**; they'd be uploaded as plain text.
- **The repo-root `.env`** is only for your machine: local builds and `check-fedex.js`. Keep local copies of tokens there if you want them.

To set or change a Firebase secret: `firebase functions:secrets:set NAME`, paste the value, then `firebase deploy --only functions`.

---

## Common jobs

**Change the pickup text, or turn pickup off.** Edit the `pickup` section of `functions/shipping-rates.js` (`details` is what shoppers see; `enabled: false` hides the option). Then deploy the functions and push to `main`; the basket and checkout both read this file.

**Change box sizes or items per box.** Edit `boxes` in `functions/shipping-rates.js`. Deploy the functions, push to `main`, then refresh the FedEx prices (below) so any new box gets a price.

**FedEx raised its prices.** Nothing to do; the daily check picks them up. To refresh right away:
```bash
gcloud scheduler jobs run firebase-schedule-refreshShippingRates-us-central1 --location=us-central1 --project=crow-and-moon-enchantments
```
Then check `https://crowandmoonenchantments.net/api/shipping-rates`, which should say `"live": true`. Nudge the `backupPrice` values in `shipping-rates.js` now and then so the fallback stays close.

**Nadine adds, edits or hides products.** She does it all in Square (see the table in [SHOP-SETUP.md](SHOP-SETUP.md#what-nadine-controls-in-square)). The site rebuilds itself. To force a rebuild: GitHub → Actions → "Deploy to Firebase Hosting on merge" → Run workflow.

**A token expired or was replaced** (Square, FedEx, or the GitHub dispatch token). `firebase functions:secrets:set NAME`, then `firebase deploy --only functions`. For the Square token, also update the GitHub secret, and run the deploy workflow.

**The domain changes.** Update `SITE_URL` and `SQUARE_WEBHOOK_URL` in `functions/.env`, `domain` in `src/_data/client.js`, the webhook subscription URL in Square, and the custom domain in Firebase Hosting. Then deploy the functions and the site. The address must serve the site directly; a redirect (for example, bare domain → `www.`) breaks Square's webhook.

**Something's wrong.** Start with `firebase functions:log`. [SHOP-SETUP.md has a troubleshooting list](SHOP-SETUP.md#troubleshooting) for the known failures: everything sold out, no rebuild after catalog edits, backup shipping prices, checkout errors.

---

## Where things live

| Path | What it is |
|---|---|
| `src/index.html` | Home page |
| `src/shop/` | Shop grid, product pages, thank-you page, `catalog.json` for the basket |
| `src/_includes/layouts/base.html` | Page shell on every page |
| `src/_includes/sections/` | Header, footer, CTA, about, order-inquire, basket drawer markup |
| `src/_data/client.js` | Site name and domain (used for meta tags, sitemap, robots.txt) |
| `src/_data/shop.js` | Build-time catalog fetch from Square (placeholder products if no token) |
| `src/config/filters/shop.js` | Template filters: prices, stock labels, sold-out-last ordering |
| `src/assets/js/basket-store.js`, `basket.js`, `shop.js` | Basket storage, basket drawer (shipping and pickup), shop and product pages (live stock) |
| `src/assets/sass/` | Styles. `_basket.scss` and `shop.scss` are the shop's. |
| `functions/index.js` | The Firebase functions: `stock`, `checkout`, `squareWebhook`, `shippingRates`, `refreshShippingRates` |
| `functions/lib/handlers.js` | What each function does (plain, tested code) |
| `functions/lib/square.js`, `fedex.js` | Small API clients for Square and FedEx (no SDKs) |
| `functions/lib/shipping.js` | Item count → box and price; shared by checkout and the basket |
| `functions/lib/rate-store.js` | Saved FedEx prices (Firestore `shop/shippingRates`) |
| `functions/shipping-rates.js` | **The shipping and pickup settings file** |
| `functions/scripts/` | `check-fedex.js` (test FedEx), `seed-sandbox.js` (test products for Square sandbox) |
| `functions/test/` | Tests, plus fake Square and FedEx servers |
| `firebase.json` | Hosting settings and the `/api/*` → function routes |
| `.github/workflows/` | Site deploys: on push to `main` (live) and on pull requests (preview) |

---

## Loose ends

- The pickup text (`"Pick up in Warrenville, IL. I'll email you to set a time."`) is a placeholder until Nadine confirms the wording.
- Pickup orders are marked with a note on the Square payment, not as an official Square "pickup order." Square supports the latter, but it was left out until it can be tested.
- `npm start` also runs `decap-server` (the `watch:cms` script) from the starter kit. The site has no CMS anymore, so that script can be removed.

## Credits

Built on the [CodeStitch Intermediate Website Kit (SASS)](https://github.com/CodeStitchOfficial/Intermediate-Website-Kit-SASS). See [LICENSE.md](LICENSE.md).
