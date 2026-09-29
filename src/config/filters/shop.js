// ─────────────────────────────────────────────────────────────────────────────
// SHOP FILTERS
// Keep stockLabel in sync with the same function in src/assets/js/shop.js,
// which updates the labels in the browser when live stock comes back.
// ─────────────────────────────────────────────────────────────────────────────

// 2800 → "$28", 2850 → "$28.50"
function money(cents) {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

function stockLabel(count) {
  if (count <= 0) return "Sold out";
  if (count === 1) return "The last one";
  if (count <= 3) return `Only ${count} left`;
  return "In stock";
}

module.exports = { money, stockLabel };
