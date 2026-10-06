// Run with: cd functions && npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const square = require("../lib/square");
const handlers = require("../lib/handlers");
const { createFakeSquare } = require("./fake-square");

const config = {
  SQUARE_ACCESS_TOKEN: "test-token",
  SQUARE_ENVIRONMENT: "sandbox",
  SITE_URL: "https://www.crowandmoonenchantments.com/",
  SHOP_SUPPORT_EMAIL: "crowandmoonenchantments@gmail.com",
};

function setup(extra = {}) {
  const fake = createFakeSquare();
  const client = square.createClient({ ...config, ...extra }, { fetchImpl: fake.fetch });
  return { fake, client };
}

async function loadProducts(client) {
  const locationId = await client.getLocationId();
  const objects = await client.listCatalog();
  const ids = objects.filter((o) => o.type === "ITEM").flatMap((o) => o.item_data.variations.map((v) => v.id));
  const counts = await client.getInStockCounts(ids);
  return square.buildProducts(objects, { locationId, counts });
}

test("finds the only active location when none is configured", async () => {
  const { client, fake } = setup();
  assert.equal(await client.getLocationId(), fake.LOCATION);
});

test("builds the product list from the catalog", async () => {
  const { client } = setup();
  const products = await loadProducts(client);
  const names = products.map((p) => p.name);

  assert.deepEqual(names, [
    "Blue Moon, New You",
    "Sanctuary of Divine",
    "Money Draw Oil",
    "Protection Spell Jar",
    "Full Moon Incense",
    "Hearthfire",
  ]);
  // Hidden category, archived, other location, variable price: all left off
  for (const absent of ["Fair-Only Mystery Box", "Last Year's Candle", "Other Shop Only", "Custom Order"]) {
    assert.ok(!names.includes(absent), `${absent} should be hidden`);
  }

  const blue = products.find((p) => p.slug === "blue-moon-new-you");
  assert.equal(blue.category, "Candles");
  assert.equal(blue.image, "/assets/images/shop/blue-moon-new-you.jpg");
  assert.deepEqual(blue.paragraphs, [
    "A fresh-start candle, poured for the moment you decide to begin again.",
    "Topped with dried citrus and crystals.",
  ]);
  assert.deepEqual(blue.details, ["Infused sweet orange", "Wooden wick"]);
  assert.equal(blue.stock, 4);
  assert.equal(blue.hasOptions, false);

  const oil = products.find((p) => p.slug === "money-draw-oil");
  assert.deepEqual(oil.variations.map((v) => v.name), ["10 ml", "30 ml"], "sorted by ordinal, variable price dropped");
  assert.equal(oil.priceMin, 1600);
  assert.equal(oil.priceMax, 3200);
  assert.equal(oil.stock, 9);
  assert.equal(oil.hasOptions, true);

  assert.equal(products.find((p) => p.name === "Protection Spell Jar").stock, 0);
  assert.equal(products.find((p) => p.name === "Full Moon Incense").stock, null, "untracked");
  assert.equal(products.find((p) => p.name === "Hearthfire").stock, 0, "sold_out override");
});

test("stock endpoint reports live counts, untracked as null, unknown as 0", async () => {
  const { client, fake } = setup();
  fake.state.inventory.VAR_BLUE_MOON = 3;
  const result = await handlers.getStock({ ids: "VAR_BLUE_MOON,VAR_INCENSE,VAR_HEARTH,NOPE" }, config, { client });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.stock, { VAR_BLUE_MOON: 3, VAR_INCENSE: null, VAR_HEARTH: 0, NOPE: 0 });
});

test("stock endpoint rejects junk ids", async () => {
  const { client } = setup();
  assert.equal((await handlers.getStock({ ids: "" }, config, { client })).status, 400);
  assert.equal((await handlers.getStock({ ids: "A,<script>" }, config, { client })).status, 400);
});

test("checkout creates one payment link for the whole basket", async () => {
  const { client, fake } = setup();
  const result = await handlers.createCheckout(
    {
      items: [
        { variationId: "VAR_BLUE_MOON", quantity: 1 },
        { variationId: "VAR_OIL_30", quantity: 2 },
        { variationId: "VAR_BLUE_MOON", quantity: 1 }, // merged with the first line
        { variationId: "VAR_INCENSE", quantity: 5 },
      ],
    },
    config,
    { client },
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.url, "http://localhost:4010/pay/PL_1");

  const sent = fake.state.paymentLinks[0];
  assert.deepEqual(sent.order.line_items, [
    { catalog_object_id: "VAR_BLUE_MOON", quantity: "2" },
    { catalog_object_id: "VAR_OIL_30", quantity: "2" },
    { catalog_object_id: "VAR_INCENSE", quantity: "5" },
  ]);
  assert.equal(sent.order.location_id, fake.LOCATION);
  assert.deepEqual(sent.order.pricing_options, { auto_apply_taxes: true, auto_apply_discounts: true });
  assert.equal(sent.checkout_options.redirect_url, "https://www.crowandmoonenchantments.com/shop/thanks/");
  assert.equal(sent.checkout_options.ask_for_shipping_address, true);
  assert.equal(sent.checkout_options.merchant_support_email, "crowandmoonenchantments@gmail.com");
  assert.equal(sent.checkout_options.shipping_fee, undefined, "no shipping configured");
  assert.ok(!JSON.stringify(sent).includes("price"), "the browser never sets prices");
});

test("checkout refuses quantities beyond stock and says what's left", async () => {
  const { client, fake } = setup();
  const result = await handlers.createCheckout(
    {
      items: [
        { variationId: "VAR_SANCTUARY", quantity: 2 }, // only 1
        { variationId: "VAR_JAR", quantity: 1 }, // sold out
        { variationId: "VAR_HEARTH", quantity: 1 }, // marked sold out
        { variationId: "VAR_OIL_CUSTOM", quantity: 1 }, // variable price, not sold online
        { variationId: "VAR_BLUE_MOON", quantity: 1 }, // fine
      ],
    },
    config,
    { client },
  );
  assert.equal(result.status, 409);
  assert.deepEqual(result.body.problems, [
    { variationId: "VAR_SANCTUARY", available: 1 },
    { variationId: "VAR_JAR", available: 0 },
    { variationId: "VAR_HEARTH", available: 0 },
    { variationId: "VAR_OIL_CUSTOM", available: 0 },
  ]);
  assert.equal(fake.state.paymentLinks.length, 0, "no link created");
});

test("checkout rejects malformed baskets", async () => {
  const { client } = setup();
  for (const body of [{}, { items: [] }, { items: [{ variationId: "X", quantity: 0 }] }, { items: [{ variationId: "X", quantity: 1.5 }] }]) {
    assert.equal((await handlers.createCheckout(body, config, { client })).status, 400);
  }
});

test("flat shipping, free over a threshold", async () => {
  const shipConfig = { ...config, SHOP_SHIPPING_FLAT_CENTS: "800", SHOP_FREE_SHIPPING_OVER_CENTS: "7500" };

  let { client, fake } = setup();
  await handlers.createCheckout({ items: [{ variationId: "VAR_BLUE_MOON", quantity: 1 }] }, shipConfig, { client });
  assert.deepEqual(fake.state.paymentLinks[0].checkout_options.shipping_fee, {
    name: "Shipping",
    charge: { amount: 800, currency: "USD" },
  });

  ({ client, fake } = setup());
  await handlers.createCheckout({ items: [{ variationId: "VAR_BLUE_MOON", quantity: 3 }] }, shipConfig, { client });
  assert.equal(fake.state.paymentLinks[0].checkout_options.shipping_fee, undefined, "$84 ships free");
});

test("Square errors surface as SquareError", async () => {
  const fake = createFakeSquare();
  const client = square.createClient({ ...config, SQUARE_ACCESS_TOKEN: "wrong" }, { fetchImpl: fake.fetch });
  await assert.rejects(client.getLocationId(), (e) => e instanceof square.SquareError && e.status === 401);
});

test("missing token fails loudly", () => {
  assert.throws(() => square.createClient({}), /SQUARE_ACCESS_TOKEN/);
});

/* ---------- Webhook ---------- */

const hookConfig = {
  SQUARE_WEBHOOK_SIGNATURE_KEY: "sig-key",
  SQUARE_WEBHOOK_URL: "https://www.crowandmoonenchantments.com/api/square-webhook",
  GITHUB_REPO: "bendoylegray/crow-and-moon-enchantments",
  GITHUB_DISPATCH_TOKEN: "gh-token",
};

function signed(event) {
  const rawBody = Buffer.from(JSON.stringify(event));
  const signature = crypto
    .createHmac("sha256", hookConfig.SQUARE_WEBHOOK_SIGNATURE_KEY)
    .update(hookConfig.SQUARE_WEBHOOK_URL + rawBody.toString())
    .digest("base64");
  return { rawBody, signature };
}

function fakeGitHub(status = 204) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status < 300, status, text: async () => "" };
  };
  return { calls, fetchImpl };
}

test("catalog change triggers a GitHub rebuild", async () => {
  const gh = fakeGitHub();
  const result = await handlers.handleWebhook(
    signed({ type: "catalog.version.updated", event_id: "e1" }),
    hookConfig,
    { fetchImpl: gh.fetchImpl },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.rebuilt, true);
  assert.equal(gh.calls[0].url, "https://api.github.com/repos/bendoylegray/crow-and-moon-enchantments/dispatches");
  assert.equal(gh.calls[0].init.headers.Authorization, "Bearer gh-token");
  assert.deepEqual(JSON.parse(gh.calls[0].init.body), { event_type: "square-catalog-updated" });
});

test("bad signatures are rejected and nothing rebuilds", async () => {
  const gh = fakeGitHub();
  const { rawBody } = signed({ type: "catalog.version.updated" });
  const result = await handlers.handleWebhook({ rawBody, signature: "forged" }, hookConfig, { fetchImpl: gh.fetchImpl });
  assert.equal(result.status, 403);
  assert.equal(gh.calls.length, 0);
});

test("other events are acknowledged and ignored", async () => {
  const gh = fakeGitHub();
  const result = await handlers.handleWebhook(signed({ type: "inventory.count.updated" }), hookConfig, {
    fetchImpl: gh.fetchImpl,
  });
  assert.equal(result.status, 200);
  assert.equal(gh.calls.length, 0);
});

test("GitHub failure asks Square to retry", async () => {
  const gh = fakeGitHub(500);
  const result = await handlers.handleWebhook(signed({ type: "catalog.version.updated" }), hookConfig, {
    fetchImpl: gh.fetchImpl,
  });
  assert.equal(result.status, 500);
});

/* ---------- Small helpers ---------- */

test("slugs and descriptions", () => {
  assert.equal(square.slugify("Blue Moon, New You"), "blue-moon-new-you");
  assert.equal(square.slugify("Salt & Smoke Café"), "salt-and-smoke-cafe");
  assert.deepEqual(square.parseDescription("One\ntwo\n\n• dot\n- dash\n* star\nThree"), {
    paragraphs: ["One two", "Three"],
    details: ["dot", "dash", "star"],
  });
});

test("Square's HTML descriptions become paragraphs and a details list", () => {
  const html =
    "<p>A fresh-start candle &amp; more.</p><p>Second <strong>part</strong>.</p><ul><li>Infused sweet orange</li><li>Wooden wick</li></ul>";
  assert.deepEqual(square.parseDescription(square.htmlToText(html)), {
    paragraphs: ["A fresh-start candle & more.", "Second part."],
    details: ["Infused sweet orange", "Wooden wick"],
  });
});
