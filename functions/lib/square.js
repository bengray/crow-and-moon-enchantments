// ─────────────────────────────────────────────────────────────────────────────
// SQUARE CLIENT
// A small, dependency-free client for the handful of Square API calls the shop
// needs. Shared by the Eleventy build (src/_data/shop.js) and the Firebase
// functions (functions/index.js), so the two always agree on what a product is.
//
// Uses plain fetch (Node 18+). No Square SDK, so there's nothing to keep
// upgrading. Square API version is pinned below; bump it deliberately.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require("node:crypto");

const SQUARE_VERSION = "2026-09-16";

const BASE_URLS = {
  production: "https://connect.squareup.com/v2",
  sandbox: "https://connect.squareupsandbox.com/v2",
};

// Without inventory tracking there's no count to cap at, so cap here instead
const UNTRACKED_MAX_QUANTITY = 20;

class SquareError extends Error {
  constructor(message, { status, errors } = {}) {
    super(message);
    this.name = "SquareError";
    this.status = status;
    this.errors = errors || [];
  }
}

/**
 * Build a client from a config object (usually process.env).
 *   SQUARE_ACCESS_TOKEN   required
 *   SQUARE_ENVIRONMENT    "production" (default) or "sandbox"
 *   SQUARE_LOCATION_ID    optional; if missing and the account has exactly one
 *                         active location, that one is used
 *   SQUARE_API_BASE       test-only override of the API base URL
 */
function createClient(config = process.env, { fetchImpl = globalThis.fetch } = {}) {
  const token = (config.SQUARE_ACCESS_TOKEN || "").trim();
  if (!token) throw new SquareError("SQUARE_ACCESS_TOKEN is not set");

  const environment = (config.SQUARE_ENVIRONMENT || "production").trim().toLowerCase();
  const base = (config.SQUARE_API_BASE || BASE_URLS[environment] || "").replace(/\/$/, "");
  if (!base) {
    throw new SquareError(`SQUARE_ENVIRONMENT must be "production" or "sandbox", got "${environment}"`);
  }

  let locationId = (config.SQUARE_LOCATION_ID || "").trim() || null;

  async function call(method, path, body) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      // Square always answers JSON; anything else is a proxy or outage page
    }

    if (!response.ok || (data.errors && data.errors.length)) {
      const detail = (data.errors || []).map((e) => `${e.code}: ${e.detail || e.category}`).join("; ");
      throw new SquareError(`Square ${method} ${path} failed (${response.status})${detail ? `: ${detail}` : ""}`, {
        status: response.status,
        errors: data.errors,
      });
    }
    return data;
  }

  async function getLocationId() {
    if (locationId) return locationId;
    const { locations = [] } = await call("GET", "/locations");
    const active = locations.filter((l) => l.status === "ACTIVE");
    if (active.length === 1) {
      locationId = active[0].id;
      return locationId;
    }
    const list = active.map((l) => `${l.id} (${l.name})`).join(", ") || "none";
    throw new SquareError(
      `Set SQUARE_LOCATION_ID. This Square account has ${active.length} active locations: ${list}`,
    );
  }

  // Every ITEM, IMAGE, and CATEGORY in the catalog, following pagination
  async function listCatalog() {
    const objects = [];
    let cursor;
    do {
      const query = new URLSearchParams({ types: "ITEM,IMAGE,CATEGORY" });
      if (cursor) query.set("cursor", cursor);
      const data = await call("GET", `/catalog/list?${query}`);
      objects.push(...(data.objects || []));
      cursor = data.cursor;
    } while (cursor);
    return objects;
  }

  // { variationId: quantityInStock } at our location. Untracked variations are
  // simply absent from Square's answer, so callers decide what absence means.
  async function getInStockCounts(variationIds) {
    const ids = [...new Set(variationIds)].filter(Boolean);
    const counts = {};
    if (!ids.length) return counts;
    const location = await getLocationId();

    for (let i = 0; i < ids.length; i += 1000) {
      let cursor;
      do {
        const data = await call("POST", "/inventory/counts/batch-retrieve", {
          catalog_object_ids: ids.slice(i, i + 1000),
          location_ids: [location],
          states: ["IN_STOCK"],
          cursor,
        });
        for (const count of data.counts || []) {
          const quantity = Math.floor(Number(count.quantity) || 0);
          counts[count.catalog_object_id] = (counts[count.catalog_object_id] || 0) + quantity;
        }
        cursor = data.cursor;
      } while (cursor);
    }
    return counts;
  }

  // Fetch specific catalog objects by id (used to check checkout lines)
  async function retrieveObjects(ids) {
    const data = await call("POST", "/catalog/batch-retrieve", {
      object_ids: [...new Set(ids)],
    });
    return data.objects || [];
  }

  async function createPaymentLink({ lineItems, redirectUrl, supportEmail, shippingFee }) {
    const location = await getLocationId();
    const checkoutOptions = {
      ask_for_shipping_address: true,
      allow_tipping: false,
    };
    if (redirectUrl) checkoutOptions.redirect_url = redirectUrl;
    if (supportEmail) checkoutOptions.merchant_support_email = supportEmail;
    if (shippingFee && shippingFee.amount > 0) {
      checkoutOptions.shipping_fee = {
        name: shippingFee.name || "Shipping",
        charge: { amount: shippingFee.amount, currency: shippingFee.currency || "USD" },
      };
    }

    const data = await call("POST", "/online-checkout/payment-links", {
      idempotency_key: crypto.randomUUID(),
      order: {
        location_id: location,
        line_items: lineItems.map((line) => ({
          catalog_object_id: line.variationId,
          quantity: String(line.quantity),
        })),
        // Taxes Nadine set up on items in Square get applied automatically
        pricing_options: { auto_apply_taxes: true, auto_apply_discounts: true },
      },
      checkout_options: checkoutOptions,
    });
    return data.payment_link;
  }

  return {
    environment,
    getLocationId,
    listCatalog,
    getInStockCounts,
    retrieveObjects,
    createPaymentLink,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CATALOG → SHOP PRODUCTS
// ─────────────────────────────────────────────────────────────────────────────

function isPresentAt(object, locationId) {
  if (!object) return false;
  if (object.present_at_all_locations) {
    return !(object.absent_at_location_ids || []).includes(locationId);
  }
  return (object.present_at_location_ids || []).includes(locationId);
}

function overrideFor(variation, locationId) {
  const overrides = (variation.item_variation_data || {}).location_overrides || [];
  return overrides.find((o) => o.location_id === locationId) || {};
}

// Does Square track stock for this variation here? A per-location setting wins.
function tracksInventory(variation, locationId) {
  const override = overrideFor(variation, locationId);
  if (typeof override.track_inventory === "boolean") return override.track_inventory;
  return Boolean((variation.item_variation_data || {}).track_inventory);
}

/**
 * Stock for one variation:
 *   0..n  tracked count (or 0 if marked sold out at this location)
 *   null  not tracked, so effectively always available
 */
function stockFor(variation, locationId, counts) {
  if (overrideFor(variation, locationId).sold_out) return 0;
  if (!tracksInventory(variation, locationId)) return null;
  return Math.max(0, counts[variation.id] || 0);
}

// Highest quantity one checkout line may ask for
function maxQuantity(stock) {
  return stock === null ? UNTRACKED_MAX_QUANTITY : Math.min(stock, UNTRACKED_MAX_QUANTITY);
}

function slugify(text) {
  return (
    String(text)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  );
}

/**
 * Turn Nadine's plain-text Square description into page content.
 *   Lines starting with "*" or "-" become the starred details list.
 *   Everything else becomes paragraphs (blank lines separate them).
 */
function parseDescription(text) {
  const paragraphs = [];
  const details = [];
  let current = [];
  const flush = () => {
    if (current.length) paragraphs.push(current.join(" "));
    current = [];
  };

  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
    } else if (/^[*\-•]\s+/.test(line)) {
      flush();
      details.push(line.replace(/^[*\-•]\s+/, ""));
    } else {
      current.push(line);
    }
  }
  flush();
  return { paragraphs, details };
}

/**
 * Map raw catalog objects to the product shape the templates use.
 *
 * Shown on the site: items that aren't archived, exist at this location, have
 * at least one sellable fixed-price variation, and aren't in the hide category
 * (default "Not Online"). Square's own "unavailable online" setting is honored too.
 */
function buildProducts(objects, { locationId, counts = {}, hideCategory = "Not Online" } = {}) {
  const images = new Map();
  const categories = new Map();
  for (const o of objects) {
    if (o.type === "IMAGE" && o.image_data && o.image_data.url) images.set(o.id, o.image_data.url);
    if (o.type === "CATEGORY" && o.category_data) categories.set(o.id, o.category_data.name);
  }
  const hidden = String(hideCategory || "").trim().toLowerCase();
  const usedSlugs = new Set();
  const products = [];

  for (const item of objects) {
    if (item.type !== "ITEM" || item.is_deleted) continue;
    const data = item.item_data || {};
    if (data.is_archived) continue;
    if (data.ecom_visibility === "UNAVAILABLE") continue;
    if (locationId && !isPresentAt(item, locationId)) continue;

    const categoryIds = (data.categories || []).map((c) => c.id);
    if (data.reporting_category && data.reporting_category.id) categoryIds.push(data.reporting_category.id);
    if (data.category_id) categoryIds.push(data.category_id);
    const categoryNames = [...new Set(categoryIds.map((id) => categories.get(id)).filter(Boolean))];
    if (hidden && categoryNames.some((name) => name.toLowerCase() === hidden)) continue;

    const variations = (data.variations || [])
      .filter((v) => !v.is_deleted && (!locationId || isPresentAt(v, locationId)))
      .filter((v) => {
        const vd = v.item_variation_data || {};
        return vd.sellable !== false && vd.pricing_type !== "VARIABLE_PRICING" && vd.price_money;
      })
      .sort((a, b) => (a.item_variation_data.ordinal || 0) - (b.item_variation_data.ordinal || 0))
      .map((v) => {
        const vd = v.item_variation_data;
        const stock = stockFor(v, locationId, counts);
        return {
          id: v.id,
          name: vd.name || "",
          price: vd.price_money.amount,
          currency: vd.price_money.currency || "USD",
          stock,
          maxQuantity: maxQuantity(stock),
        };
      });
    if (!variations.length) continue;

    let slug = slugify(data.name);
    for (let n = 2; usedSlugs.has(slug); n++) slug = `${slugify(data.name)}-${n}`;
    usedSlugs.add(slug);

    const { paragraphs, details } = parseDescription(data.description_plaintext || data.description || "");
    const imageUrls = (data.image_ids || []).map((id) => images.get(id)).filter(Boolean);

    products.push(summarize({
      id: item.id,
      slug,
      name: data.name,
      category: categoryNames[0] || "Other",
      tagline: "",
      paragraphs,
      details,
      image: imageUrls[0] || null,
      images: imageUrls,
      variations,
    }));
  }

  return products;
}

// Derived fields the templates lean on: price range and overall stock
function summarize(product) {
  const prices = product.variations.map((v) => v.price);
  const stocks = product.variations.map((v) => v.stock);
  const untracked = stocks.some((s) => s === null);
  return {
    ...product,
    priceMin: Math.min(...prices),
    priceMax: Math.max(...prices),
    // null means at least one variation is untracked, so treat as available
    stock: untracked ? null : stocks.reduce((sum, s) => sum + s, 0),
    // Hide the option picker when Square's default single "Regular" variation is all there is
    hasOptions: product.variations.length > 1,
    // Preselected on the product page: the first option that isn't sold out
    defaultVariation: product.variations.find((v) => v.stock !== 0) || product.variations[0],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK SIGNATURES
// Square signs HMAC-SHA256(signature key, notification URL + raw body), base64.
// ─────────────────────────────────────────────────────────────────────────────

function isValidWebhookSignature({ rawBody, signature, signatureKey, notificationUrl }) {
  if (!rawBody || !signature || !signatureKey || !notificationUrl) return false;
  const expected = crypto
    .createHmac("sha256", signatureKey)
    .update(notificationUrl + rawBody.toString("utf8"))
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  SQUARE_VERSION,
  UNTRACKED_MAX_QUANTITY,
  SquareError,
  createClient,
  buildProducts,
  summarize,
  stockFor,
  maxQuantity,
  isPresentAt,
  parseDescription,
  slugify,
  isValidWebhookSignature,
};
