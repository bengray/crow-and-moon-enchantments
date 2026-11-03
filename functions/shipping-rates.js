// ─────────────────────────────────────────────────────────────────────────────
// SHIPPING RATES
// Nadine ships FedEx flat rate (One Rate), US only, or the shopper picks the
// order up locally. For shipping, the basket counts every item (2 of the same
// oil = 2 items) and picks the smallest box below that holds that many.
//
//   name           shown to shoppers: "Shipping (Medium box)"
//   maxItems       the most items that box holds
//   fedexPackaging FedEx's name for the box, used to ask FedEx for its price
//   backupPrice    dollars; used ONLY if FedEx has never answered (see below)
//
// PRICES COME FROM FEDEX. Once a day, the refreshShippingRates function asks
// FedEx what each box costs Nadine to ship across the country, and saves it.
// The basket and checkout both use that saved price. If FedEx is down,
// yesterday's price stays in use. backupPrice only matters before the very
// first successful check, so keep it roughly right, not exact.
//
// Box names FedEx accepts for One Rate: FEDEX_ENVELOPE, FEDEX_PAK, FEDEX_TUBE,
// FEDEX_EXTRA_SMALL_BOX, FEDEX_SMALL_BOX, FEDEX_MEDIUM_BOX, FEDEX_LARGE_BOX,
// FEDEX_EXTRA_LARGE_BOX.
//
// Add, remove, or reorder boxes freely; they're sorted by maxItems. A shipped
// basket with more items than the biggest box holds can't check out online.
// The shopper is asked to email for a shipping quote, or to pick up instead.
//
// LOCAL PICKUP (the `pickup` section below) has no shipping charge and no box
// limit. Square doesn't ask pickup shoppers for an address, and the payment
// in Square is marked with `pickup.squareNote` so Nadine knows not to ship it.
//
// After changing anything here, update BOTH places that use it:
//   1. Checkout (what Square charges):  cd functions && npm run deploy
//   2. The site (the basket):  push to main, or run the deploy workflow
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  boxes: [
    {
      name: "Small",
      maxItems: 2,
      fedexPackaging: "FEDEX_SMALL_BOX",
      backupPrice: 17.15,
    },
    {
      name: "Medium",
      maxItems: 5,
      fedexPackaging: "FEDEX_MEDIUM_BOX",
      backupPrice: 20.9,
    },
    {
      name: "Large",
      maxItems: 10,
      fedexPackaging: "FEDEX_LARGE_BOX",
      backupPrice: 29.25,
    },
  ],

  pickup: {
    // false hides the pickup choice in the basket and checkout refuses it
    enabled: true,
    // Shown under "Local pickup" in the basket
    details: "Pick up in Warrenville, IL. I'll email you to set a time.", // PLACEHOLDER: confirm with Nadine
    // Added to the payment in Square, so Nadine can tell pickup orders apart
    squareNote: "LOCAL PICKUP - do not ship",
  },

  // Where shoppers send a request for a shipping quote on big orders
  quoteEmail: "crowandmoonenchantments@gmail.com",
};
