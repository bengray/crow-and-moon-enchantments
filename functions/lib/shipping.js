// ─────────────────────────────────────────────────────────────────────────────
// SHIPPING
// Turns an item count into a box and a price, using functions/shipping-rates.js.
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
    cents: Math.round(Number(box.price) * 100),
  }))
  .sort((a, b) => a.maxItems - b.maxItems);

for (const box of boxes) {
  if (!(box.maxItems > 0) || !Number.isFinite(box.cents) || box.cents < 0) {
    throw new Error(`shipping-rates.js: box "${box.name}" needs a maxItems above 0 and a price of 0 or more`);
  }
}
if (!boxes.length) throw new Error("shipping-rates.js: add at least one box");

// The most items one box holds; above this, shoppers ask for a quote
const MAX_ITEMS = boxes[boxes.length - 1].maxItems;

/**
 * Shipping for a basket of `itemCount` items (total quantity, not lines).
 *   { box: "Medium", cents: 1800, label: "Shipping (Medium box)" }
 *   null when it's more than the biggest box holds (ask for a quote)
 */
function shippingFor(itemCount) {
  const box = boxes.find((b) => itemCount <= b.maxItems);
  if (!box) return null;
  return { box: box.name, cents: box.cents, label: `Shipping (${box.name} box)` };
}

module.exports = { shippingFor, MAX_ITEMS, QUOTE_EMAIL: rates.quoteEmail, boxes };
