// ─────────────────────────────────────────────────────────────────────────────
// SHOP API HANDLERS
// Plain functions: (input, config, deps) → { status, body }. No Firebase in
// here, so they can be tested and reused anywhere. functions/index.js wraps
// them in HTTP endpoints.
// ─────────────────────────────────────────────────────────────────────────────

const square = require("./square");
const { shippingFor, isPrice, boxes, MAX_ITEMS, QUOTE_EMAIL, PICKUP, FULFILLMENTS } = require("./shipping");
const fedex = require("./fedex");

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

  // One unknown id is normal (an item deleted since the last build). Every id
  // unknown means the site and these functions are using different Square
  // accounts or environments, and the whole shop shows as sold out.
  const known = new Set(objects.map((o) => o.id));
  const unknown = requested.filter((id) => !known.has(id));
  if (unknown.length) {
    log("warn", unknown.length === requested.length
      ? "Square doesn't recognize ANY of these items. Is the site built from a different Square account or environment than the functions use? Redeploy whichever is out of date."
      : "Square doesn't recognize some items (probably deleted since the last build); showing them as sold out", {
      environment: client.environment,
      unknown: unknown.slice(0, 10),
      unknownCount: unknown.length,
      requestedCount: requested.length,
    });
  }
  return { status: 200, body: { stock } };
}

/* ---------- POST /api/checkout ---------- */

/**
 * Body: { items: [{ variationId, quantity }], fulfillment?: "ship" | "pickup" }
 *   fulfillment defaults to "ship". "pickup" has no shipping charge or box
 *   limit, and Square doesn't ask for an address.
 *
 * Checks every line against Square (exists, sellable, enough in stock), then
 * creates a Square payment link for the whole basket. Prices always come from
 * Square's catalog; the browser only ever sends ids and quantities.
 *
 * 200 { url }                                   send the shopper here
 * 409 { error, problems: [{ variationId, available }] }
 *                                               something sold out or ran short;
 *                                               the basket should adjust and retry
 * 422 { error, needsQuote: true }               more items than the biggest box
 *                                               holds; ask Nadine for a quote
 *
 * Shipping is a FedEx flat-rate box chosen by item count (functions/shipping-rates.js),
 * priced from FedEx's saved rates in `rateStore` (see refreshShippingRates).
 */
async function createCheckout(body, config, { client, rateStore } = {}) {
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

  const fulfillment = (body && body.fulfillment) || "ship";
  if (!FULFILLMENTS.includes(fulfillment)) {
    return { status: 400, body: { error: "Something in your basket doesn't look right." } };
  }
  const pickup = fulfillment === "pickup";
  if (pickup && !PICKUP.enabled) {
    return { status: 400, body: { error: "Local pickup isn't available right now. Please choose shipping." } };
  }

  // Pick the box before asking Square anything: too big an order can't ship.
  // Pickup orders don't go in a box, so they have no limit.
  const itemCount = [...wanted.values()].reduce((sum, quantity) => sum + quantity, 0);
  if (!pickup && !shippingFor(itemCount)) {
    return {
      status: 422,
      body: {
        error: `That's more than fits in one shipping box (${MAX_ITEMS} items). Email me at ${QUOTE_EMAIL} and I'll quote shipping for you.${PICKUP.enabled ? " Or choose local pickup, which has no limit." : ""}`,
        needsQuote: true,
      },
    };
  }

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

  const priced = pickup ? null : shippingFor(itemCount, await savedCents(rateStore));
  const shippingFee = priced && priced.cents > 0 ? { name: `FedEx ${priced.label}`, amount: priced.cents } : null;

  const siteUrl = String(config.SITE_URL || "").replace(/\/$/, "");
  const link = await client.createPaymentLink({
    lineItems: [...wanted].map(([variationId, quantity]) => ({ variationId, quantity })),
    redirectUrl: siteUrl ? `${siteUrl}/shop/thanks/` : undefined,
    supportEmail: config.SHOP_SUPPORT_EMAIL,
    shippingFee,
    askForShippingAddress: !pickup,
    paymentNote: pickup ? PICKUP.squareNote : undefined,
  });

  log("info", "Created payment link", { orderId: link.order_id, lines: wanted.size, fulfillment, box: priced ? priced.box : null, shippingCents: priced ? priced.cents : 0 });
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

/* ---------- Shipping rates from FedEx ---------- */

/**
 * The saved FedEx record, or null if there's no store, nothing saved yet, or
 * the store can't be read. Callers then use each box's backupPrice, so
 * checkout never fails over shipping.
 */
async function savedRecord(rateStore) {
  if (!rateStore) return null;
  try {
    return await rateStore.read();
  } catch (error) {
    log("error", "Couldn't read saved shipping rates; using backup prices", { error: error.message });
    return null;
  }
}

// FedEx's saved prices by box name, like { Medium: 2435 }
async function savedCents(rateStore) {
  const record = await savedRecord(rateStore);
  return (record && record.cents) || {};
}

/**
 * GET /api/shipping-rates
 * 200 { cents: { Small: 1955, ... }, live: true, fetchedAt }
 *   cents     the price of every box, FedEx's where saved, otherwise the backup
 *   live      true when every box's price came from FedEx
 */
async function getShippingRates(config, { rateStore } = {}) {
  const record = await savedRecord(rateStore);
  const saved = (record && record.cents) || {};
  const cents = {};
  let live = true;
  for (const box of boxes) {
    cents[box.name] = isPrice(saved[box.name]) ? saved[box.name] : box.backupCents;
    if (!isPrice(saved[box.name])) live = false;
  }
  return { status: 200, body: { cents, live, fetchedAt: (record && record.fetchedAt) || null } };
}

/**
 * Runs once a day (functions/index.js). Asks FedEx what each box in
 * shipping-rates.js costs to ship to the national band and saves the prices.
 * All boxes or nothing: if any quote fails, the saved prices stay as they were
 * and this throws, so the failure shows in the logs.
 */
async function refreshShippingRates(config, { fedexClient, rateStore, now = () => new Date() } = {}) {
  fedexClient = fedexClient || fedex.createFedexClient(config);

  const cents = {};
  const rateTypes = new Set();
  for (const box of boxes) {
    const quote = await fedexClient.quoteOneRate(box.fedexPackaging);
    cents[box.name] = quote.cents;
    rateTypes.add(quote.rateType);
  }

  const previous = await savedRecord(rateStore);
  const record = {
    cents,
    fetchedAt: now().toISOString(),
    serviceType: fedexClient.serviceType,
    toZip: fedexClient.toZip,
    rateType: [...rateTypes].join(","),
  };
  await rateStore.write(record);

  const changed = boxes.filter((b) => !previous || !previous.cents || previous.cents[b.name] !== cents[b.name]);
  log("info", "Saved FedEx shipping rates", {
    cents,
    rateType: record.rateType,
    changed: changed.map((b) => b.name),
  });
  return record;
}

module.exports = { getStock, createCheckout, handleWebhook, getShippingRates, refreshShippingRates };
