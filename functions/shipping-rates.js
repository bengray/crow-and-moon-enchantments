// ─────────────────────────────────────────────────────────────────────────────
// SHIPPING RATES
// The one place to change shipping. Nadine ships FedEx flat rate (One Rate),
// US only. The basket counts every item (2 of the same oil = 2 items) and
// picks the smallest box below that holds that many.
//
//   name      shown to shoppers: "Shipping (Medium box)"
//   maxItems  the most items that box holds
//   price     what FedEx charges for that box, in dollars
//
// Add, remove, or reorder boxes freely; they're sorted by maxItems. A basket
// with more items than the biggest box holds can't check out online. The
// shopper is asked to email for a shipping quote instead.
//
// After changing anything here, update BOTH places that use it:
//   1. The site (the basket):  push to main, or run the deploy workflow
//   2. Checkout (what Square charges):  cd functions && npm run deploy
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  boxes: [
    { name: "Small", maxItems: 2, price: 12.0 }, // PLACEHOLDER price
    { name: "Medium", maxItems: 5, price: 18.0 }, // PLACEHOLDER price
    { name: "Large", maxItems: 10, price: 24.0 }, // PLACEHOLDER price
  ],

  // Where shoppers send a request for a shipping quote on big orders
  quoteEmail: "crowandmoonenchantments@gmail.com",
};
