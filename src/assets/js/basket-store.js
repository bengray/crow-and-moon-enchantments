// ─────────────────────────────────────────────────────────────────────────────
// BASKET STORE
// The basket lives in the shopper's browser (localStorage) as a list of
// { variationId, quantity }. Names, prices, and photos come from
// /shop/catalog.json; live stock comes from /api/stock. Square is only
// involved at checkout, and it always reprices from Nadine's catalog.
//
// Imported by basket.js (the drawer) and shop.js (shop pages). Each change
// fires a "basket:change" event on window so every part of the page updates.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "crowandmoon:basket:v1";
export const STOCK_ENDPOINT = "/api/stock";
export const CHECKOUT_ENDPOINT = "/api/checkout";
export const CATALOG_URL = "/shop/catalog.json";
export const SHIPPING_RATES_ENDPOINT = "/api/shipping-rates";

const FULFILLMENT_KEY = "crowandmoon:fulfillment:v1";

let memoryFallback = [];
let fulfillmentFallback = "ship";

/* ---------- Reading and writing ---------- */

export function readBasket() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (line) => line && typeof line.variationId === "string" && Number.isInteger(line.quantity) && line.quantity > 0,
    );
  } catch {
    return memoryFallback.slice();
  }
}

function writeBasket(lines) {
  const clean = lines.filter((line) => line.quantity > 0);
  memoryFallback = clean;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Private browsing or storage full: the basket still works for this page
  }
  window.dispatchEvent(new CustomEvent("basket:change", { detail: { lines: clean } }));
  return clean;
}

export function quantityOf(variationId) {
  const line = readBasket().find((l) => l.variationId === variationId);
  return line ? line.quantity : 0;
}

export function basketCount() {
  return readBasket().reduce((sum, line) => sum + line.quantity, 0);
}

/**
 * Add to the basket without going over `max` in total.
 * Returns how many were actually added (0 if already at the limit).
 */
export function addToBasket(variationId, quantity, max = Infinity) {
  const lines = readBasket();
  const line = lines.find((l) => l.variationId === variationId);
  const current = line ? line.quantity : 0;
  const next = Math.min(current + quantity, max);
  const added = Math.max(0, next - current);
  if (!added) return 0;
  if (line) line.quantity = next;
  else lines.push({ variationId, quantity: next });
  writeBasket(lines);
  return added;
}

export function setQuantity(variationId, quantity) {
  const lines = readBasket()
    .map((l) => (l.variationId === variationId ? { ...l, quantity } : l))
    .filter((l) => l.quantity > 0);
  writeBasket(lines);
}

export function removeFromBasket(variationId) {
  writeBasket(readBasket().filter((l) => l.variationId !== variationId));
}

export function clearBasket() {
  writeBasket([]);
}

/* ---------- Ship or pick up ---------- */

// The shopper's last choice, "ship" (default) or "pickup"
export function readFulfillment() {
  try {
    const value = localStorage.getItem(FULFILLMENT_KEY);
    return value === "pickup" ? "pickup" : "ship";
  } catch {
    return fulfillmentFallback;
  }
}

export function writeFulfillment(value) {
  fulfillmentFallback = value === "pickup" ? "pickup" : "ship";
  try {
    localStorage.setItem(FULFILLMENT_KEY, fulfillmentFallback);
  } catch {
    // Private browsing: the choice still holds for this page
  }
}

// Another tab changed the basket: tell this page
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) {
    window.dispatchEvent(new CustomEvent("basket:change", { detail: { lines: readBasket() } }));
  }
});

/* ---------- Shop state ---------- */

// True once the site is built from Square (see src/_data/shop.js)
export function shopIsLive() {
  return document.body.dataset.shopLive === "true";
}

let catalogPromise = null;
export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch(CATALOG_URL)
      .then((r) => (r.ok ? r.json() : { variations: {} }))
      .catch(() => ({ variations: {} }));
  }
  return catalogPromise;
}

/**
 * Live stock from Square: { [variationId]: number | null }, where null means
 * "not tracked, always available". Returns null if live stock isn't available
 * (placeholder build, or the network failed), so callers keep what they have.
 */
export async function fetchStock(ids) {
  const unique = [...new Set(ids)].filter(Boolean);
  if (!shopIsLive() || !unique.length) return null;
  try {
    const response = await fetch(`${STOCK_ENDPOINT}?ids=${encodeURIComponent(unique.join(","))}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data && data.stock ? data.stock : null;
  } catch {
    return null;
  }
}

/**
 * Today's FedEx price for each box, by box name: { Small: 1955, ... }.
 * Fetched once per page. Returns {} on a placeholder build or if the request
 * fails, so the basket falls back to the backup prices in shipping-rates.js.
 */
let shippingRatesPromise = null;
export function loadShippingRates() {
  if (!shopIsLive()) return Promise.resolve({});
  if (!shippingRatesPromise) {
    shippingRatesPromise = fetch(SHIPPING_RATES_ENDPOINT, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => (data && data.cents) || {})
      .catch(() => {
        shippingRatesPromise = null; // try again next time the basket opens
        return {};
      });
  }
  return shippingRatesPromise;
}

/* ---------- Formatting (keep in sync with src/config/filters/shop.js) ---------- */

export function money(cents) {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

export function stockLabel(count) {
  if (count === null || count === undefined) return "In stock";
  if (count <= 0) return "Sold out";
  if (count === 1) return "The last one";
  if (count <= 3) return `Only ${count} left`;
  return "In stock";
}

export function stockAttr(count) {
  return count === null || count === undefined ? "untracked" : String(count);
}

// Most a shopper can buy of one variation
export const UNTRACKED_MAX = 20;
export function maxFor(stock) {
  return stock === null || stock === undefined ? UNTRACKED_MAX : Math.min(stock, UNTRACKED_MAX);
}
