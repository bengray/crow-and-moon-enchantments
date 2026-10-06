# Shop setup

How the Crow & Moon shop connects to Nadine's Square account, and the exact steps to switch it on.

## How it works

```
Square (Nadine's catalog, stock, payments)
   │                       ▲
   │ build: products       │ checkout: one payment link per basket
   ▼                       │ stock: live counts on every page view
Eleventy build ──► Firebase Hosting ──► /api/* ──► Firebase Functions
   ▲                                                    │
   └── GitHub Actions ◄── repository_dispatch ◄─────────┘
                           (Square webhook: catalog changed)
```

- **Products, prices, photos, descriptions** are pulled from Square when the site builds. When Nadine edits her catalog, Square calls the `squareWebhook` function, which asks GitHub to rebuild. The site updates a couple of minutes later.
- **Stock** is fetched live from Square on every shop page, so a sale at a fair shows up online right away. The `/api/stock` function does this. **Sales never rebuild the site.** Only catalog edits do (new items, prices, names, descriptions, photos, categories, variations).
- **The basket** lives in the shopper's browser. At checkout, `/api/checkout` rechecks stock with Square, then creates one Square payment link for the whole basket and sends the shopper there. Prices always come from Square; the browser only sends item ids and quantities.
- **Stock goes down on its own.** Square adjusts inventory when an order made of catalog items is paid, the same as a sale on her reader.
- **Without Square credentials**, the site still builds, using placeholder products. The basket works, but Checkout says "almost ready" instead of opening Square.

## What Nadine controls in Square

| She wants to... | She does this in Square |
|---|---|
| Add a product to the site | Create the item. It appears after the automatic rebuild. |
| Keep an item off the website (fair-only) | Put it in a category named **Not Online** |
| Remove a product everywhere | Archive or delete the item |
| Show stock counts and "Only 2 left" | Turn on **inventory tracking** for the item. Untracked items always show "In stock". |
| Mark something sold out without counting | Set it to **Sold out** at her location |
| Offer sizes or scents | Add **variations**. They become choices on the product page. |
| Set the photo | Upload an image to the item. The first image is used. |
| Write the description | Use the item description. A bulleted list (or lines starting with `* ` or `- `) becomes the starred details list. Everything else becomes paragraphs. |
| Charge sales tax | Set up taxes on the items in Square. Checkout applies them automatically. |

The category filter on the shop page uses each item's first category.

Items with a variable price (priced at the register) are left off the site, because online checkout needs a fixed price.

## One-time setup

Do these in order. **Step 4 must happen before this code reaches `main`**: Firebase refuses to deploy hosting that points at functions which don't exist yet, so pushing early would break the site's deploys.

### 1. Firebase: switch to the Blaze plan

Functions only deploy on the pay-as-you-go Blaze plan. A shop this size stays inside the free monthly allowance, but Blaze needs a card on file.

1. Firebase console → project **crow-and-moon-enchantments** → Upgrade → Blaze.
2. Set a budget alert and a spend cap of a few dollars (Usage and billing → Details and settings), so the worst case is known.

### 2. Square: get the credentials

Log in at [developer.squareup.com/apps](https://developer.squareup.com/apps) **with Nadine's Square login** and create an application (name it anything, like "Crow & Moon website").

Start in **Sandbox**, Square's test account where no real money moves:

- **Credentials** → copy the **Sandbox access token**.
- **Locations** → copy the location ID, if her account has more than one location. (With just one, leave it blank and the shop finds it.)
- **Load test products into the sandbox.** The sandbox's own dashboard is a cut-down version of Square's, so the item editor may be hard to find or missing. Use the seed script instead. Put the sandbox token in a `.env` file at the repo root (copy `.env.example`, set `SQUARE_ACCESS_TOKEN` and `SQUARE_ENVIRONMENT=sandbox`), then run:

  ```bash
  node functions/scripts/seed-sandbox.js
  ```

  It creates seven products with photos, stock counts, and a two-size oil. One is sold out, one doesn't track stock, and one sits in "Not Online" so you can confirm it stays off the site. It only runs against sandbox, and it does nothing if the products are already there. To see them in Square, open the developer console → **Sandbox test accounts** → **Square Dashboard** next to the test account.

Later, for real sales, switch the page to **Production** and copy the **Production access token** and production location ID instead.

> Treat the access token like Nadine's password. It can do anything in her Square account. It only ever goes in Firebase secrets, GitHub secrets, or your local `.env`. Never commit it.

### 3. GitHub: a token that can trigger rebuilds

The webhook function needs permission to start the deploy workflow.

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate.
2. Repository access: **Only select repositories** → this site's repo.
3. Permissions: **Contents → Read and write**. Nothing else.
4. Copy the token. Note its expiry date: when it expires, catalog changes stop triggering rebuilds until you replace it. Pushes and the manual "Run workflow" button still work.

### 4. Deploy the functions

From the repo root, on your machine:

```bash
npm install -g firebase-tools        # once
firebase login                       # once

cd functions
npm install
cp .env.example .env                 # then fill it in, see below
cd ..

firebase functions:secrets:set SQUARE_ACCESS_TOKEN            # paste the Square token
firebase functions:secrets:set SQUARE_WEBHOOK_SIGNATURE_KEY   # paste "pending" for now, step 5 replaces it
firebase functions:secrets:set GITHUB_DISPATCH_TOKEN          # paste the GitHub token

firebase deploy --only functions
```

`functions/.env` settings (not secret):

| Setting | Value |
|---|---|
| `SQUARE_ENVIRONMENT` | `sandbox` while testing, `production` for real |
| `SQUARE_LOCATION_ID` | Blank if one location, otherwise the ID from step 2 |
| `SITE_URL` | `https://www.crowandmoonenchantments.com` (no trailing slash). Shoppers return here after paying. |
| `SQUARE_WEBHOOK_URL` | `https://www.crowandmoonenchantments.com/api/square-webhook` |
| `GITHUB_REPO` | `owner/repo` of this repository |
| `SHOP_SUPPORT_EMAIL` | Shown on Square's checkout page |
| `SHOP_SHIPPING_FLAT_CENTS` | Flat shipping in cents, e.g. `800` for $8. Blank for none. |
| `SHOP_FREE_SHIPPING_OVER_CENTS` | Free shipping at or above this subtotal, e.g. `7500`. Blank for never. |

Use whichever domain the site is actually served on (with or without `www`) for both URLs. The webhook signature check fails if `SQUARE_WEBHOOK_URL` doesn't match Square's setting character for character.

### 4b. Let GitHub's deploy account see the functions

Hosting deploys from GitHub Actions now have to look up the functions they route to, and the service account Firebase created for GitHub can't do that by default. Without this, deploys fail with `Permission 'cloudfunctions.functions.list' denied`.

1. [Google Cloud console](https://console.cloud.google.com/iam-admin/iam) → project **crow-and-moon-enchantments** → IAM.
2. Find the GitHub deploy account. It's named like `github-action-…@crow-and-moon-enchantments.iam.gserviceaccount.com`.
3. Edit it → Add role **Cloud Run Viewer** → Add role **Cloud Functions Viewer** → Save.

### 5. Square: subscribe the webhook

In the Square developer app (same environment, Sandbox or Production) → **Webhooks** → **Subscriptions** → Add subscription:

- URL: `https://www.crowandmoonenchantments.com/api/square-webhook`
- API version: `2026-09-16`
- Event: `catalog.version.updated`

Save it, copy its **Signature key**, then:

```bash
firebase functions:secrets:set SQUARE_WEBHOOK_SIGNATURE_KEY   # paste the real key
firebase deploy --only functions                              # picks up the new secret
```

### 6. GitHub: build settings

Repo → Settings → Secrets and variables → Actions:

- **Secrets** → New repository secret: `SQUARE_ACCESS_TOKEN` (same token as step 4)
- **Variables** → New repository variable:
  - `SQUARE_ENVIRONMENT`: `sandbox` or `production`
  - `SQUARE_LOCATION_ID`: only if needed
  - `SHOP_HIDE_CATEGORY`: only if Nadine wants a name other than `Not Online`

### 7. Ship it

Now merge to `main`. The workflow builds from Square and deploys.

Check:

1. `/shop/` shows the Square items.
2. Add things to the basket and press Checkout. You should land on Square's checkout page.
3. In sandbox, pay with one of [Square's test cards](https://developer.squareup.com/docs/devtools/sandbox/payments). You should come back to `/shop/thanks/`, and the stock in the sandbox dashboard should go down.
4. Make a test purchase and watch the Actions tab: nothing should run, because sales never rebuild.
5. Change an item in the sandbox dashboard if it lets you edit items. If not, open the webhook subscription in the developer console and send a test event, if Square offers that option there. Either way, a new run should appear on the Actions tab within a few minutes.

## Going live with real money

When sandbox works:

1. Square developer app → switch to **Production**. Copy the production access token and location ID, and add the same webhook subscription there (production has its own signature key).
2. `firebase functions:secrets:set SQUARE_ACCESS_TOKEN` (production token) and `SQUARE_WEBHOOK_SIGNATURE_KEY` (production key).
3. `functions/.env`: `SQUARE_ENVIRONMENT=production`, and the production `SQUARE_LOCATION_ID` if needed. Then `firebase deploy --only functions`.
4. GitHub: update the `SQUARE_ACCESS_TOKEN` secret and set the `SQUARE_ENVIRONMENT` variable to `production`, then run the workflow from the Actions tab.

## Local development

- `npm start` works as before. With no `.env`, it uses placeholder products.
- To build from Square locally, copy `.env.example` to `.env` and fill in the token.
- **Try the whole flow with no Square account at all:**

  ```bash
  node functions/test/fake-square.js                  # terminal 1: a fake Square
  SQUARE_ACCESS_TOKEN=test-token SQUARE_API_BASE=http://localhost:4010/v2 npm run build
  node functions/test/dev-server.js                   # terminal 2: http://localhost:8090
  ```

- **Against Square's sandbox**, using Firebase's emulators: put the sandbox settings in `functions/.env`, put the secrets in `functions/.secret.local` (same `NAME=value` format, ignored by git), run `npm run build`, then `firebase emulators:start --only functions,hosting`. The site is on http://localhost:5000.
- **Tests:** `cd functions && npm test`

## Where things live

| File | What it does |
|---|---|
| `functions/lib/square.js` | Square API calls and catalog-to-product mapping. Used by both the build and the functions. |
| `functions/lib/handlers.js` | Stock, checkout, and webhook logic |
| `functions/index.js` | Wraps the handlers as Firebase functions, declares secrets |
| `functions/scripts/seed-sandbox.js` | Loads test products into a Square sandbox account |
| `firebase.json` | Maps `/api/stock`, `/api/checkout`, `/api/square-webhook` to the functions |
| `src/_data/shop.js` | Build-time catalog fetch (falls back to `src/config/shop/mock-products.js`) |
| `src/shop/` | Shop grid, product pages, thank-you page, `catalog.json` for the basket |
| `src/assets/js/basket-store.js`, `basket.js`, `shop.js` | Basket storage, drawer, product page |
| `src/_includes/sections/basket.html`, `src/assets/sass/_basket.scss` | Basket markup and styles (every page) |
| `.github/workflows/firebase-hosting-merge.yml` | Deploys on push, on catalog change, or by hand |

## Troubleshooting

- **Shop shows placeholder products after deploy:** the `SQUARE_ACCESS_TOKEN` repository secret is missing.
- **Build fails with "Set SQUARE_LOCATION_ID":** her account has several locations. The error lists them; pick one.
- **Build fails with a 401:** the token and `SQUARE_ENVIRONMENT` don't match (a sandbox token used against production, or the reverse).
- **Checkout says it couldn't open:** run `firebase functions:log` and look for the Square error.
- **Catalog edits don't show up:** check the webhook's delivery log in the Square developer app, then `firebase functions:log`. A 403 means the signature key or `SQUARE_WEBHOOK_URL` is wrong. "rebuilt: false" means the GitHub token is missing or expired.
- **Something sold out but the page still shows it:** stock is live, so this means `/api/stock` is failing. Check the functions log.
