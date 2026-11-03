// ─────────────────────────────────────────────────────────────────────────────
// SHOP FILTERS
// Keep stockLabel in sync with the same function in src/assets/js/basket-store.js,
// which relabels stock in the browser when live counts come back.
// ─────────────────────────────────────────────────────────────────────────────

// 2800 → "$28", 2850 → "$28.50"
function money(cents) {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

// One price, or "From $16" when options are priced differently
function priceRange(product) {
  if (product.priceMin === product.priceMax) return money(product.priceMin);
  return `From ${money(product.priceMin)}`;
}

// null = Square doesn't track stock for it, so it's always available
function stockLabel(count) {
  if (count === null || count === undefined) return "In stock";
  if (count <= 0) return "Sold out";
  if (count === 1) return "The last one";
  if (count <= 3) return `Only ${count} left`;
  return "In stock";
}

// For data-stock attributes: "untracked" instead of an empty string
function stockAttr(count) {
  return count === null || count === undefined ? "untracked" : String(count);
}

// The shop grid: in-stock products first, sold-out ones at the end, each group
// keeping Nadine's catalog order. catalogOrder lets the browser re-sort the
// same way when live stock changes (src/assets/js/shop.js).
function soldOutLast(products) {
  return (products || [])
    .map((product, catalogOrder) => ({ ...product, catalogOrder }))
    .sort((a, b) => (a.stock === 0) - (b.stock === 0) || a.catalogOrder - b.catalogOrder);
}

module.exports = { money, priceRange, stockLabel, stockAttr, soldOutLast };
