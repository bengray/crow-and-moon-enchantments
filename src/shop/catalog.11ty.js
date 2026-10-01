// ─────────────────────────────────────────────────────────────────────────────
// /shop/catalog.json
// What the basket needs to draw itself on any page: names, option names,
// prices, photos, and build-time stock for every variation. Live stock still
// comes from /api/stock, and Square reprices everything at checkout.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = class {
  data() {
    return {
      permalink: "/shop/catalog.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render({ shop }) {
    const variations = {};
    for (const product of shop.products) {
      for (const v of product.variations) {
        variations[v.id] = {
          productName: product.name,
          variationName: product.hasOptions ? v.name : "",
          slug: product.slug,
          price: v.price,
          image: product.image,
          stock: v.stock,
        };
      }
    }
    return JSON.stringify({ live: shop.live, variations });
  }
};
