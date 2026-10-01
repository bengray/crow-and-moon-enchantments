// ─────────────────────────────────────────────────────────────────────────────
// FAKE SQUARE
// Answers the five Square endpoints the shop uses, shaped like Square's API
// reference. Used by the tests (as a fetch stand-in) and can run as a little
// HTTP server for trying the whole site locally without a Square account:
//
//   node functions/test/fake-square.js        → http://localhost:4010/v2
//
// Then build with SQUARE_ACCESS_TOKEN=test SQUARE_API_BASE=http://localhost:4010/v2
// ─────────────────────────────────────────────────────────────────────────────

const LOCATION = "LOC_WARRENVILLE";
const OTHER_LOCATION = "LOC_OTHER";

function variation(id, itemId, name, amount, extra = {}) {
  return {
    type: "ITEM_VARIATION",
    id,
    present_at_all_locations: true,
    item_variation_data: {
      item_id: itemId,
      name,
      ordinal: extra.ordinal || 0,
      pricing_type: extra.pricing_type || "FIXED_PRICING",
      price_money: extra.pricing_type === "VARIABLE_PRICING" ? undefined : { amount, currency: "USD" },
      track_inventory: extra.track_inventory ?? true,
      sellable: true,
      stockable: true,
      location_overrides: extra.location_overrides,
    },
  };
}

function item(id, name, { description = "", categories = [], images = [], variations, ...rest }) {
  return {
    type: "ITEM",
    id,
    present_at_all_locations: true,
    ...rest.object,
    item_data: {
      name,
      description_plaintext: description,
      categories: categories.map((cid, ordinal) => ({ id: cid, ordinal })),
      image_ids: images,
      variations,
      product_type: "REGULAR",
      ...rest.data,
    },
  };
}

function createFakeSquare() {
  const state = {
    requests: [],
    paymentLinks: [],
    inventory: {
      VAR_BLUE_MOON: 4,
      VAR_SANCTUARY: 1,
      VAR_OIL_10: 7,
      VAR_OIL_30: 2,
      VAR_JAR: 0,
      VAR_HIDDEN: 5,
      VAR_ARCHIVED: 5,
    },
  };

  const objects = [
    { type: "CATEGORY", id: "CAT_CANDLES", category_data: { name: "Candles" } },
    { type: "CATEGORY", id: "CAT_OILS", category_data: { name: "Oils" } },
    { type: "CATEGORY", id: "CAT_KITS", category_data: { name: "Spell Kits" } },
    { type: "CATEGORY", id: "CAT_HIDE", category_data: { name: "Not Online" } },
    { type: "IMAGE", id: "IMG_BLUE", image_data: { name: "blue", url: "/assets/images/shop/blue-moon-new-you.jpg" } },
    { type: "IMAGE", id: "IMG_SANCT", image_data: { name: "sanct", url: "/assets/images/shop/sanctuary-of-divine.jpg" } },
    { type: "IMAGE", id: "IMG_OIL", image_data: { name: "oil", url: "/assets/images/shop/roll-on-oil.jpg" } },

    item("ITEM_BLUE_MOON", "Blue Moon, New You", {
      description:
        "A fresh-start candle, poured for the moment you decide to begin again.\n\nTopped with dried citrus and crystals.\n\n* Infused sweet orange\n* Wooden wick",
      categories: ["CAT_CANDLES"],
      images: ["IMG_BLUE"],
      variations: [variation("VAR_BLUE_MOON", "ITEM_BLUE_MOON", "Regular", 2800)],
    }),
    item("ITEM_SANCTUARY", "Sanctuary of Divine", {
      description: "For the quiet hour after a long day.\n- Infused sandalwood\n- Amethyst on top",
      categories: ["CAT_CANDLES"],
      images: ["IMG_SANCT"],
      variations: [variation("VAR_SANCTUARY", "ITEM_SANCTUARY", "Regular", 2800)],
    }),
    item("ITEM_OIL", "Money Draw Oil", {
      description: "A roll-on ritual oil for prosperity work.",
      categories: ["CAT_OILS"],
      images: ["IMG_OIL"],
      variations: [
        variation("VAR_OIL_30", "ITEM_OIL", "30 ml", 3200, { ordinal: 2 }),
        variation("VAR_OIL_10", "ITEM_OIL", "10 ml", 1600, { ordinal: 1 }),
        variation("VAR_OIL_CUSTOM", "ITEM_OIL", "Custom blend", 0, { ordinal: 3, pricing_type: "VARIABLE_PRICING" }),
      ],
    }),
    item("ITEM_JAR", "Protection Spell Jar", {
      description: "A sealed spell jar.",
      categories: ["CAT_KITS"],
      variations: [variation("VAR_JAR", "ITEM_JAR", "Regular", 2200)],
    }),
    item("ITEM_INCENSE", "Full Moon Incense", {
      description: "Loose incense. Stock isn't tracked for this one.",
      categories: ["CAT_KITS"],
      variations: [variation("VAR_INCENSE", "ITEM_INCENSE", "Regular", 1400, { track_inventory: false })],
    }),
    item("ITEM_SOLDOUT_FLAG", "Hearthfire", {
      description: "Marked sold out at the location in Square.",
      categories: ["CAT_CANDLES"],
      variations: [
        variation("VAR_HEARTH", "ITEM_SOLDOUT_FLAG", "Regular", 3000, {
          location_overrides: [{ location_id: LOCATION, sold_out: true }],
        }),
      ],
    }),
    // Should NOT appear on the site:
    item("ITEM_HIDDEN", "Fair-Only Mystery Box", {
      categories: ["CAT_HIDE"],
      variations: [variation("VAR_HIDDEN", "ITEM_HIDDEN", "Regular", 1000)],
    }),
    item("ITEM_ARCHIVED", "Last Year's Candle", {
      variations: [variation("VAR_ARCHIVED", "ITEM_ARCHIVED", "Regular", 1000)],
      data: { is_archived: true },
    }),
    item("ITEM_ELSEWHERE", "Other Shop Only", {
      variations: [variation("VAR_ELSEWHERE", "ITEM_ELSEWHERE", "Regular", 1000)],
      object: { present_at_all_locations: false, present_at_location_ids: [OTHER_LOCATION] },
    }),
    item("ITEM_VARIABLE", "Custom Order", {
      variations: [variation("VAR_VARIABLE", "ITEM_VARIABLE", "Regular", 0, { pricing_type: "VARIABLE_PRICING" })],
    }),
  ];

  function find(id) {
    for (const o of objects) {
      if (o.id === id) return o;
      for (const v of (o.item_data && o.item_data.variations) || []) if (v.id === id) return v;
    }
    return null;
  }

  function error(status, code, detail) {
    return { status, json: { errors: [{ category: "INVALID_REQUEST_ERROR", code, detail }] } };
  }

  // (method, url, headers, bodyObject) → { status, json }
  function handle(method, url, headers, body) {
    const { pathname, searchParams } = new URL(url, "http://fake");
    const path = pathname.replace(/^\/v2/, "");
    state.requests.push({ method, path, body });

    if (headers.authorization !== "Bearer test-token") return error(401, "UNAUTHORIZED", "Bad token");
    if (!headers["square-version"]) return error(400, "MISSING_VERSION", "No Square-Version");

    if (method === "GET" && path === "/locations") {
      return {
        status: 200,
        json: {
          locations: [
            { id: LOCATION, name: "Crow & Moon", status: "ACTIVE" },
            { id: "LOC_OLD", name: "Closed booth", status: "INACTIVE" },
          ],
        },
      };
    }

    if (method === "GET" && path === "/catalog/list") {
      const types = (searchParams.get("types") || "").split(",");
      const all = objects.filter((o) => types.includes(o.type));
      // Two pages, to exercise the cursor
      const page = searchParams.get("cursor") === "page2" ? 1 : 0;
      const half = Math.ceil(all.length / 2);
      return {
        status: 200,
        json: page === 0 ? { objects: all.slice(0, half), cursor: "page2" } : { objects: all.slice(half) },
      };
    }

    if (method === "POST" && path === "/catalog/batch-retrieve") {
      return { status: 200, json: { objects: body.object_ids.map(find).filter(Boolean) } };
    }

    if (method === "POST" && path === "/inventory/counts/batch-retrieve") {
      if (!body.location_ids || body.location_ids[0] !== LOCATION) return error(400, "BAD_LOCATION", "Location");
      const counts = body.catalog_object_ids
        .filter((id) => id in state.inventory)
        .map((id) => ({
          catalog_object_id: id,
          catalog_object_type: "ITEM_VARIATION",
          state: "IN_STOCK",
          location_id: LOCATION,
          quantity: String(state.inventory[id]),
          calculated_at: "2026-10-01T12:00:00Z",
        }));
      return { status: 200, json: { counts } };
    }

    if (method === "POST" && path === "/online-checkout/payment-links") {
      if (!body.idempotency_key) return error(400, "MISSING_IDEMPOTENCY", "idempotency_key");
      const order = body.order || {};
      if (order.location_id !== LOCATION) return error(400, "BAD_LOCATION", "order.location_id");
      for (const line of order.line_items || []) {
        const v = find(line.catalog_object_id);
        if (!v || v.type !== "ITEM_VARIATION") return error(400, "NOT_FOUND", line.catalog_object_id);
        if (typeof line.quantity !== "string") return error(400, "BAD_QUANTITY", "quantity must be a string");
      }
      const id = `PL_${state.paymentLinks.length + 1}`;
      state.paymentLinks.push(body);
      return {
        status: 200,
        json: {
          payment_link: {
            id,
            version: 1,
            order_id: `ORDER_${id}`,
            url: `http://localhost:4010/pay/${id}`,
            long_url: `http://localhost:4010/pay/${id}?long=1`,
            created_at: "2026-10-01T12:00:00Z",
          },
        },
      };
    }

    return error(404, "NOT_FOUND", `${method} ${path}`);
  }

  // A fetch stand-in for tests
  async function fetch(url, init = {}) {
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const { status, json } = handle(init.method || "GET", url, headers, init.body ? JSON.parse(init.body) : null);
    return { ok: status >= 200 && status < 300, status, json: async () => json, text: async () => JSON.stringify(json) };
  }

  return { state, handle, fetch, LOCATION };
}

module.exports = { createFakeSquare };

// Run as a server: node functions/test/fake-square.js
if (require.main === module) {
  const http = require("node:http");
  const fake = createFakeSquare();
  http
    .createServer((req, res) => {
      if (req.url.startsWith("/pay/")) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<h1>Fake Square checkout</h1><p id="link">${req.url}</p>`);
        return;
      }
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        // Test hook: POST /__inventory {"VAR_X": 0} sets stock
        if (req.url === "/__inventory") {
          Object.assign(fake.state.inventory, JSON.parse(raw || "{}"));
          res.writeHead(200).end("{}");
          return;
        }
        if (req.url === "/__links") {
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(fake.state.paymentLinks));
          return;
        }
        const { status, json } = fake.handle(req.method, req.url, req.headers, raw ? JSON.parse(raw) : null);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(json));
      });
    })
    .listen(4010, () => console.log("Fake Square on http://localhost:4010/v2 (token: test-token)"));
}
