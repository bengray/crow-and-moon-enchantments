// ─────────────────────────────────────────────────────────────────────────────
// SHIPPING
// Turns an item count into a box and a price. The boxes come from
// functions/shipping-rates.js; the prices come from FedEx (saved once a day by
// the shippingRates function), falling back to each box's backupPrice.
//
// Used in two places so they always agree:
//   - checkout (handlers.js), which sets the shipping fee Square charges
//   - the basket drawer (src/assets/js/basket.js), which shows it to shoppers
// No Node-only code in here: esbuild bundles it into the browser script.
// ─────────────────────────────────────────────────────────────────────────────

const rates = require("../shipping-rates");

// Smallest box first. Prices to whole cents so dollars like 12.4 don't drift.
const boxes = rates.boxes
  .map((box) => ({
    name: String(box.name),
    maxItems: Number(box.maxItems),
    fedexPackaging: String(box.fedexPackaging || ""),
    backupCents: Math.round(Number(box.backupPrice) * 100),
  }))
  .sort((a, b) => a.maxItems - b.maxItems);

for (const box of boxes) {
  if (!(box.maxItems > 0) || !Number.isFinite(box.backupCents) || box.backupCents < 0 || !box.fedexPackaging) {
    throw new Error(
      `shipping-rates.js: box "${box.name}" needs a maxItems above 0, a fedexPackaging, and a backupPrice of 0 or more`,
    );
  }
}
if (!boxes.length) throw new Error("shipping-rates.js: add at least one box");

// The most items one box holds; above this, shoppers ask for a quote
const MAX_ITEMS = boxes[boxes.length - 1].maxItems;

function isPrice(value) {
  return Number.isInteger(value) && value > 0;
}

/**
 * Shipping for a basket of `itemCount` items (total quantity, not lines).
 * `liveCents` is FedEx's saved prices by box name, like { Medium: 2435 };
 * any box missing from it uses its backupPrice.
 *   { box: "Medium", cents: 2435, label: "Shipping (Medium box)" }
 *   null when it's more than the biggest box holds (ask for a quote)
 */
function shippingFor(itemCount, liveCents = {}) {
  const box = boxes.find((b) => itemCount <= b.maxItems);
  if (!box) return null;
  const live = liveCents && liveCents[box.name];
  return {
    box: box.name,
    cents: isPrice(live) ? live : box.backupCents,
    label: `Shipping (${box.name} box)`,
  };
}

// Local pickup: no shipping charge, no box limit (see shipping-rates.js)
const pickupSettings = rates.pickup || {};
const PICKUP = {
  enabled: pickupSettings.enabled === true,
  details: String(pickupSettings.details || ""),
  squareNote: String(pickupSettings.squareNote || "LOCAL PICKUP").slice(0, 500), // Square's limit
};

// How the shopper gets the order: shipped (the default) or local pickup
const FULFILLMENTS = ["ship", "pickup"];

module.exports = { shippingFor, isPrice, MAX_ITEMS, QUOTE_EMAIL: rates.quoteEmail, boxes, PICKUP, FULFILLMENTS };
