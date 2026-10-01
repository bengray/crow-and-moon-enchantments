// ─────────────────────────────────────────────────────────────────────────────
// SHOP API HANDLERS
// Plain functions: (input, config, deps) → { status, body }. No Firebase in
// here, so they can be tested and reused anywhere. functions/index.js wraps
// them in HTTP endpoints.
// ─────────────────────────────────────────────────────────────────────────────

const square = require("./square");

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_IDS = 100;
const MAX_LINES = 30;

function log(level, message, extra) {
  // Firebase picks up console output as structured logs
  console[level](JSON.stringify({ message, ...extra }));
}

/* ---------- GET /api/stock?ids=A,B,C ---------- */

/**
 * Live stock for the given variation ids.
 * Response: { stock: { [variationId]: number | null } }
 *   number  how many are in stock right now
 *   null    Square doesn't track stock for it (always available)
 */
async function getStock({ ids }, config, { client } = {}) {
  const requested = String(ids || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!requested.length) return { status: 400, body: { error: "No ids given" } };
  if (requested.length > MAX_IDS) return { status: 400, body: { error: `At most ${MAX_IDS} ids` } };
  if (!requested.every((id) => ID_PATTERN.test(id))) return { status: 400, body: { error: "Bad id" } };

  client = client || square.createClient(config);
  const locationId = await client.getLocationId();
  const [objects, counts] = await Promise.all([
    client.retrieveObjects(requested),
    client.getInStockCounts(requested),
  ]);

  const stock = {};
  for (const id of requested) stock[id] = 0; // unknown or deleted → sold out
  for (const object of objects) {
    if (object.type !== "ITEM_VARIATION" || object.is_deleted) continue;
    if (!square.isPresentAt(object, locationId)) continue;
    stock[object.id] = square.stockFor(object, locationId, counts);
  }
  return { status: 200, body: { stock } };
}

/* ---------- POST /api/checkout ---------- */

/**
 * Body: { items: [{ variationId, quantity }] }
 *
 * Checks every line against Square (exists, sellable, enough in stock), then
 * creates a Square payment link for the whole basket. Prices always come from
 * Square's catalog; the browser only ever sends ids and quantities.
 *
 * 200 { url }                                   send the shopper here
 * 409 { error, problems: [{ variationId, available }] }
 *                                               something sold out or ran short;
 *                                               the basket should adjust and retry
 */
async function createCheckout(body, config, { client } = {}) {
  const items = Array.isArray(body && body.items) ? body.items : null;
  if (!items || !items.length) return { status: 400, body: { error: "Your basket is empty." } };
  if (items.length > MAX_LINES) return { status: 400, body: { error: "Too many different items." } };

  // Merge duplicate lines and validate shape
  const wanted = new Map();
  for (const item of items) {
    const id = item && item.variationId;
    const quantity = Number(item && item.quantity);
    if (!ID_PATTERN.test(String(id)) || !Number.isInteger(quantity) || quantity < 1) {
      return { status: 400, body: { error: "Something in your basket doesn't look right." } };
    }
    wanted.set(id, (wanted.get(id) || 0) + quantity);
  }
  const ids = [...wanted.keys()];

  client = client || square.createClient(config);
  const locationId = await client.getLocationId();
  const [objects, counts] = await Promise.all([client.retrieveObjects(ids), client.getInStockCounts(ids)]);
  const byId = new Map(objects.map((o) => [o.id, o]));

  const problems = [];
  for (const [id, quantity] of wanted) {
    const variation = byId.get(id);
    const data = (variation && variation.item_variation_data) || {};
    const sellable =
      variation &&
      variation.type === "ITEM_VARIATION" &&
      !variation.is_deleted &&
      square.isPresentAt(variation, locationId) &&
      data.sellable !== false &&
      data.pricing_type !== "VARIABLE_PRICING" &&
      data.price_money;

    const available = sellable ? square.maxQuantity(square.stockFor(variation, locationId, counts)) : 0;
    if (quantity > available) problems.push({ variationId: id, available });
  }

  if (problems.length) {
    return {
      status: 409,
      body: {
        error: "Some of your basket sold out while you were shopping. I've updated it, so take a look and check out again.",
        problems,
      },
    };
  }

  const shippingAmount = parseInt(config.SHOP_SHIPPING_FLAT_CENTS, 10) || 0;
  const freeOver = parseInt(config.SHOP_FREE_SHIPPING_OVER_CENTS, 10) || 0;
  let shippingFee = null;
  if (shippingAmount > 0) {
    const subtotal = [...wanted].reduce(
      (sum, [id, quantity]) => sum + byId.get(id).item_variation_data.price_money.amount * quantity,
      0,
    );
    if (!(freeOver > 0 && subtotal >= freeOver)) {
      shippingFee = { name: config.SHOP_SHIPPING_LABEL || "Shipping", amount: shippingAmount };
    }
  }

  const siteUrl = String(config.SITE_URL || "").replace(/\/$/, "");
  const link = await client.createPaymentLink({
    lineItems: [...wanted].map(([variationId, quantity]) => ({ variationId, quantity })),
    redirectUrl: siteUrl ? `${siteUrl}/shop/thanks/` : undefined,
    supportEmail: config.SHOP_SUPPORT_EMAIL,
    shippingFee,
  });

  log("info", "Created payment link", { orderId: link.order_id, lines: wanted.size });
  return { status: 200, body: { url: link.url || link.long_url } };
}

/* ---------- POST /api/square-webhook ---------- */

/**
 * Square calls this when Nadine changes her catalog. We check the signature,
 * then ask GitHub to rebuild the site so new products, prices, photos, and
 * descriptions go live. Stock changes don't need a rebuild; pages fetch live
 * stock from /api/stock.
 */
async function handleWebhook({ rawBody, signature }, config, { fetchImpl = globalThis.fetch } = {}) {
  const valid = square.isValidWebhookSignature({
    rawBody,
    signature,
    signatureKey: config.SQUARE_WEBHOOK_SIGNATURE_KEY,
    notificationUrl: config.SQUARE_WEBHOOK_URL,
  });
  if (!valid) {
    log("warn", "Rejected webhook with a bad signature", {});
    return { status: 403, body: { error: "Bad signature" } };
  }

  let event = {};
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { status: 400, body: { error: "Bad JSON" } };
  }

  if (event.type !== "catalog.version.updated") {
    return { status: 200, body: { ignored: event.type || "unknown" } };
  }

  const repo = String(config.GITHUB_REPO || "").trim();
  const token = String(config.GITHUB_DISPATCH_TOKEN || "").trim();
  if (!repo || !token) {
    log("error", "Catalog changed but GITHUB_REPO or GITHUB_DISPATCH_TOKEN is missing", {});
    // Still 200: Square retries failures, and retrying won't fix configuration
    return { status: 200, body: { rebuilt: false } };
  }

  const response = await fetchImpl(`https://api.github.com/repos/${repo}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "crow-and-moon-shop",
    },
    body: JSON.stringify({ event_type: "square-catalog-updated" }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    log("error", "GitHub rebuild request failed", { status: response.status, text: text.slice(0, 300) });
    // 500 so Square retries later; GitHub hiccups are usually temporary
    return { status: 500, body: { rebuilt: false } };
  }

  log("info", "Requested site rebuild after catalog change", { eventId: event.event_id });
  return { status: 200, body: { rebuilt: true } };
}

module.exports = { getStock, createCheckout, handleWebhook };
