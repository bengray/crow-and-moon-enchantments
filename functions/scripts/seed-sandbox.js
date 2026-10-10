// ─────────────────────────────────────────────────────────────────────────────
// SEED SQUARE SANDBOX
// Fills a Square *sandbox* account with test products so the shop has
// something to show: categories, items, a two-size oil, photos, and stock
// counts, including one sold-out item, one untracked item, and one item in
// "Not Online" that should stay off the website.
//
// Run from the repo root, with the sandbox token in .env:
//   node functions/scripts/seed-sandbox.js
//
// It refuses to run against production, and refuses to run twice (it checks
// for "Blue Moon, New You" first) so you don't end up with duplicates.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createClient, SQUARE_VERSION } = require("../lib/square");

try {
  process.loadEnvFile(".env");
} catch {
  // Settings can also come from the shell
}

const IMAGE_DIR = path.resolve(__dirname, "../../src/assets/images/shop");

const CATEGORIES = ["Candles", "Oils", "Spell Kits", "Herbal Blends", "Not Online"];

// stock: a number to track inventory, null to leave it untracked
const PRODUCTS = [
  {
    key: "blue",
    name: "Blue Moon, New You",
    category: "Candles",
    image: "blue-moon-new-you.jpg",
    description:
      "A fresh-start candle, poured for the moment you decide to begin again.\n\n* Infused sweet orange\n* Crystals and dried citrus on top\n* Wooden wick",
    variations: [{ name: "Regular", price: 2800, stock: 4 }],
  },
  {
    key: "sanct",
    name: "Sanctuary of Divine",
    category: "Candles",
    image: "sanctuary-of-divine.jpg",
    description:
      "For the quiet hour after a long day.\n\n* Infused sandalwood\n* Amethyst and citrus peel on top\n* Wooden wick",
    variations: [{ name: "Regular", price: 2800, stock: 1 }],
  },
  {
    key: "oil",
    name: "Money Draw Oil",
    category: "Oils",
    image: "roll-on-oil.jpg",
    description: "A roll-on ritual oil for prosperity work.\n\n* Patchouli and citrus base\n* Quartz chips in every bottle",
    variations: [
      { name: "10 ml", price: 1600, stock: 7 },
      { name: "30 ml", price: 3200, stock: 2 },
    ],
  },
  {
    key: "jar",
    name: "Protection Spell Jar",
    category: "Spell Kits",
    image: "protection-spell-kit.jpg",
    description: "A sealed spell jar of lavender, rose, and a written intention.\n\n* Pentacle charm",
    variations: [{ name: "Regular", price: 2200, stock: 0 }],
  },
  {
    key: "incense",
    name: "Full Moon Incense Blend",
    category: "Herbal Blends",
    description: "Loose resin and herb incense for full moon work. Stock isn't tracked for this one.",
    variations: [{ name: "Regular", price: 1400, stock: null }],
  },
  {
    key: "hearth",
    name: "Hearthfire",
    category: "Candles",
    description: "Cinnamon, clove, and a little smoke.\n\n* Infused cinnamon and clove",
    variations: [{ name: "Regular", price: 3000, stock: 2 }],
  },
  {
    key: "fair",
    name: "Fair-Only Mystery Box",
    category: "Not Online",
    description: "Sold only at fairs. Should NOT appear on the website.",
    variations: [{ name: "Regular", price: 1000, stock: 5 }],
  },
];

const tempId = (...parts) => `#${parts.join("-")}`;

// The descriptions above, as the simple HTML Square's own editor saves
function toHtml(text) {
  const escape = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => l.startsWith("* "))) {
        return `<ul>${lines.map((l) => `<li>${escape(l.slice(2))}</li>`).join("")}</ul>`;
      }
      return `<p>${escape(lines.join(" "))}</p>`;
    })
    .join("");
}

async function main() {
  if ((process.env.SQUARE_ENVIRONMENT || "").toLowerCase() !== "sandbox") {
    throw new Error('Set SQUARE_ENVIRONMENT=sandbox. This script only touches test accounts.');
  }

  const client = createClient(process.env);
  const locationId = await client.getLocationId();
  console.log(`Sandbox location: ${locationId}`);

  // Don't seed twice
  const existing = await client.listCatalog();
  if (existing.some((o) => o.type === "ITEM" && o.item_data && o.item_data.name === PRODUCTS[0].name)) {
    console.log(`"${PRODUCTS[0].name}" is already in this sandbox. Nothing to do.`);
    return;
  }

  // 1. Categories, items, and variations in one batch
  const objects = CATEGORIES.map((name) => ({
    type: "CATEGORY",
    id: tempId("cat", name.replace(/\W+/g, "").toLowerCase()),
    present_at_all_locations: true,
    category_data: { name },
  }));

  for (const product of PRODUCTS) {
    const itemId = tempId("item", product.key);
    const categoryId = tempId("cat", product.category.replace(/\W+/g, "").toLowerCase());
    objects.push({
      type: "ITEM",
      id: itemId,
      present_at_all_locations: true,
      item_data: {
        name: product.name,
        description_html: toHtml(product.description),
        categories: [{ id: categoryId }],
        reporting_category: { id: categoryId },
        variations: product.variations.map((v, i) => ({
          type: "ITEM_VARIATION",
          id: tempId("var", product.key, i),
          present_at_all_locations: true,
          item_variation_data: {
            item_id: itemId,
            name: v.name,
            ordinal: i,
            pricing_type: "FIXED_PRICING",
            price_money: { amount: v.price, currency: "USD" },
            track_inventory: v.stock !== null,
            sellable: true,
            stockable: true,
          },
        })),
      },
    });
  }

  const upsert = await client.request("POST", "/catalog/batch-upsert", {
    idempotency_key: crypto.randomUUID(),
    batches: [{ objects }],
  });
  const realId = Object.fromEntries((upsert.id_mappings || []).map((m) => [m.client_object_id, m.object_id]));
  console.log(`Created ${PRODUCTS.length} items in ${CATEGORIES.length} categories.`);

  // 2. Stock counts for tracked variations
  const now = new Date().toISOString();
  const changes = [];
  for (const product of PRODUCTS) {
    product.variations.forEach((v, i) => {
      if (v.stock === null) return;
      changes.push({
        type: "PHYSICAL_COUNT",
        physical_count: {
          catalog_object_id: realId[tempId("var", product.key, i)],
          state: "IN_STOCK",
          location_id: locationId,
          quantity: String(v.stock),
          occurred_at: now,
        },
      });
    });
  }
  await client.request("POST", "/inventory/changes/batch-create", {
    idempotency_key: crypto.randomUUID(),
    ignore_unchanged_counts: false,
    changes,
  });
  console.log(`Set stock for ${changes.length} variations.`);

  // 3. Photos (multipart upload, one per item)
  for (const product of PRODUCTS.filter((p) => p.image)) {
    const file = path.join(IMAGE_DIR, product.image);
    if (!fs.existsSync(file)) continue;
    const form = new FormData();
    form.append(
      "request",
      JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        object_id: realId[tempId("item", product.key)],
        image: { type: "IMAGE", id: "#image", image_data: { name: product.name, caption: product.name } },
      }),
    );
    form.append("file", new Blob([fs.readFileSync(file)], { type: "image/jpeg" }), product.image);

    const response = await fetch(`${client.base}/catalog/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${client.token}`,
        "Square-Version": SQUARE_VERSION,
        Accept: "application/json",
      },
      body: form,
    });
    if (!response.ok) {
      console.warn(`  Photo for ${product.name} failed (${response.status}): ${await response.text()}`);
    } else {
      console.log(`  Photo added: ${product.name}`);
    }
  }

  console.log("\nDone. Build the site (npm run build) and visit /shop/.");
  console.log('You should see 6 products. "Fair-Only Mystery Box" should be missing.');
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
