// ─────────────────────────────────────────────────────────────────────────────
// SHOP DATA
// At build time, pull Nadine's catalog and stock from Square. Templates use:
//   shop.live      true when products came from Square (checkout enabled)
//   shop.products  the product list
//
// No SQUARE_ACCESS_TOKEN → placeholder products, and the basket says checkout
// is almost ready instead of sending anyone to Square.
// Token set but Square fails → the build fails, rather than publishing an
// empty or stale shop.
// ─────────────────────────────────────────────────────────────────────────────

const { createClient, buildProducts } = require("../../functions/lib/square");
const mockProducts = require("../config/shop/mock-products");

// Local builds can keep settings in a .env file (CI uses repository secrets)
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file is fine
}

module.exports = async function () {
  if (!process.env.SQUARE_ACCESS_TOKEN) {
    console.log("[shop] No SQUARE_ACCESS_TOKEN, using placeholder products.");
    return { live: false, source: "placeholder", products: mockProducts };
  }

  const client = createClient(process.env);
  const locationId = await client.getLocationId();
  const objects = await client.listCatalog();

  const variationIds = objects
    .filter((o) => o.type === "ITEM")
    .flatMap((o) => ((o.item_data || {}).variations || []).map((v) => v.id));
  const counts = await client.getInStockCounts(variationIds);

  const products = buildProducts(objects, {
    locationId,
    counts,
    hideCategory: process.env.SHOP_HIDE_CATEGORY ?? "Not Online",
  });

  console.log(`[shop] Loaded ${products.length} products from Square (${client.environment}).`);
  return { live: true, source: `square-${client.environment}`, products };
};
