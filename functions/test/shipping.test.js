const test = require("node:test");
const assert = require("node:assert/strict");

const handlers = require("../lib/handlers");
const { createFedexClient, FedexError, pickRate } = require("../lib/fedex");
const { shippingFor, boxes } = require("../lib/shipping");
const { memoryRateStore } = require("../lib/rate-store");
const { createFakeFedex, PRICES } = require("./fake-fedex");
const { createFakeSquare } = require("./fake-square");
const square = require("../lib/square");

const fedexConfig = {
  FEDEX_API_KEY: "key",
  FEDEX_SECRET_KEY: "secret",
  FEDEX_ACCOUNT_NUMBER: "123456789",
  FEDEX_SHIP_FROM_ZIP: "60555",
  FEDEX_API_BASE: "http://fedex.test",
};

function fedexSetup(options, config = fedexConfig) {
  const fake = createFakeFedex(options);
  return { fake, fedexClient: createFedexClient(config, { fetchImpl: fake.fetch }) };
}

const squareConfig = {
  SQUARE_ACCESS_TOKEN: "test-token",
  SQUARE_API_BASE: "http://localhost:4010/v2",
  SITE_URL: "https://www.crowandmoonenchantments.com",
};
function squareSetup() {
  const fake = createFakeSquare();
  return { fake, client: square.createClient(squareConfig, { fetchImpl: fake.fetch }) };
}

const cents = (dollars) => Math.round(dollars * 100);

/* ---------- FedEx client ---------- */

test("FedEx: asks for a One Rate box quote to the national band", async () => {
  const { fake, fedexClient } = fedexSetup();
  const quote = await fedexClient.quoteOneRate("FEDEX_MEDIUM_BOX");
  assert.deepEqual(quote, { cents: cents(PRICES.FEDEX_MEDIUM_BOX), rateType: "LIST" });

  const sent = fake.state.quotes[0];
  assert.equal(sent.accountNumber.value, "123456789");
  const shipment = sent.requestedShipment;
  assert.equal(shipment.shipper.address.postalCode, "60555");
  assert.equal(shipment.recipient.address.postalCode, "90001");
  assert.equal(shipment.serviceType, "FEDEX_EXPRESS_SAVER");
  assert.equal(shipment.packagingType, "FEDEX_MEDIUM_BOX");
  assert.deepEqual(shipment.shipmentSpecialServices.specialServiceTypes, ["FEDEX_ONE_RATE"]);
});

test("FedEx: signs in once and reuses the token", async () => {
  const { fake, fedexClient } = fedexSetup();
  await fedexClient.quoteOneRate("FEDEX_SMALL_BOX");
  await fedexClient.quoteOneRate("FEDEX_LARGE_BOX");
  assert.equal(fake.state.tokenRequests, 1);
});

test("FedEx: prefers Nadine's account price over the list price", async () => {
  const { fedexClient } = fedexSetup({ accountDiscount: 2 });
  const quote = await fedexClient.quoteOneRate("FEDEX_SMALL_BOX");
  assert.deepEqual(quote, { cents: cents(PRICES.FEDEX_SMALL_BOX - 2), rateType: "ACCOUNT" });
});

test("FedEx: reads prices sent as numbers or as { amount, currency }", async () => {
  const { fedexClient } = fedexSetup({ amountAsObject: true });
  assert.equal((await fedexClient.quoteOneRate("FEDEX_SMALL_BOX")).cents, cents(PRICES.FEDEX_SMALL_BOX));
  assert.throws(() => pickRate({ output: { rateReplyDetails: [] } }, "X"), FedexError);
});

test("FedEx: settings and credential problems are clear errors", async () => {
  assert.throws(() => createFedexClient({}), /FEDEX_API_KEY, FEDEX_SECRET_KEY, FEDEX_ACCOUNT_NUMBER, FEDEX_SHIP_FROM_ZIP/);
  const { fedexClient } = fedexSetup({}, { ...fedexConfig, FEDEX_SECRET_KEY: "wrong" });
  await assert.rejects(fedexClient.quoteOneRate("FEDEX_SMALL_BOX"), (e) => e instanceof FedexError && e.status === 401);
});

/* ---------- Daily refresh ---------- */

test("refresh saves every box's FedEx price", async () => {
  const { fedexClient } = fedexSetup();
  const rateStore = memoryRateStore();
  const now = () => new Date("2026-10-22T09:00:00Z");
  await handlers.refreshShippingRates(fedexConfig, { fedexClient, rateStore, now });

  const saved = await rateStore.read();
  for (const box of boxes) assert.equal(saved.cents[box.name], cents(PRICES[box.fedexPackaging]), box.name);
  assert.equal(saved.fetchedAt, "2026-10-22T09:00:00.000Z");
  assert.equal(saved.serviceType, "FEDEX_EXPRESS_SAVER");
});

test("refresh keeps yesterday's prices if FedEx fails for any box", async () => {
  const yesterday = { cents: { Small: 1111, Medium: 2222, Large: 3333 }, fetchedAt: "2026-10-21T09:00:00.000Z" };
  const rateStore = memoryRateStore(yesterday);
  const { fedexClient } = fedexSetup({ failFor: [boxes[boxes.length - 1].fedexPackaging] });
  await assert.rejects(handlers.refreshShippingRates(fedexConfig, { fedexClient, rateStore }), FedexError);
  assert.deepEqual(await rateStore.read(), yesterday);
});

/* ---------- Basket endpoint and checkout ---------- */

test("shipping-rates endpoint: saved FedEx prices, else backup prices", async () => {
  let result = await handlers.getShippingRates({}, { rateStore: memoryRateStore() });
  assert.equal(result.body.live, false);
  for (const box of boxes) assert.equal(result.body.cents[box.name], box.backupCents);

  const saved = Object.fromEntries(boxes.map((b, i) => [b.name, 2000 + i]));
  result = await handlers.getShippingRates({}, { rateStore: memoryRateStore({ cents: saved, fetchedAt: "x" }) });
  assert.deepEqual(result.body, { cents: saved, live: true, fetchedAt: "x" });
});

test("checkout charges the saved FedEx price", async () => {
  const { client, fake } = squareSetup();
  const small = boxes[0];
  const rateStore = memoryRateStore({ cents: { [small.name]: 2295 } });
  const result = await handlers.createCheckout(
    { items: [{ variationId: "VAR_INCENSE", quantity: 1 }] },
    squareConfig,
    { client, rateStore },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(fake.state.paymentLinks[0].checkout_options.shipping_fee, {
    name: `FedEx Shipping (${small.name} box)`,
    charge: { amount: 2295, currency: "USD" },
  });
});

test("checkout uses the backup price if the saved prices can't be read", async () => {
  const { client, fake } = squareSetup();
  const broken = { read: async () => { throw new Error("Firestore down"); } };
  const result = await handlers.createCheckout(
    { items: [{ variationId: "VAR_INCENSE", quantity: 1 }] },
    squareConfig,
    { client, rateStore: broken },
  );
  assert.equal(result.status, 200);
  assert.equal(fake.state.paymentLinks[0].checkout_options.shipping_fee.charge.amount, boxes[0].backupCents);
});

test("shippingFor ignores junk saved prices", () => {
  const name = boxes[0].name;
  for (const junk of [0, -5, 12.5, "1955", null]) {
    assert.equal(shippingFor(1, { [name]: junk }).cents, boxes[0].backupCents, String(junk));
  }
  assert.equal(shippingFor(1, { [name]: 1955 }).cents, 1955);
});

/* ---------- Local pickup ---------- */

const { PICKUP, MAX_ITEMS } = require("../lib/shipping");

test("pickup: no shipping charge, no address, marked for Nadine", async () => {
  const { client, fake } = squareSetup();
  const rateStore = memoryRateStore({ cents: { [boxes[0].name]: 2295 } });
  const result = await handlers.createCheckout(
    { items: [{ variationId: "VAR_INCENSE", quantity: 1 }], fulfillment: "pickup" },
    squareConfig,
    { client, rateStore },
  );
  assert.equal(result.status, 200);
  const sent = fake.state.paymentLinks[0];
  assert.equal(sent.checkout_options.shipping_fee, undefined, "no shipping fee");
  assert.equal(sent.checkout_options.ask_for_shipping_address, false, "no address");
  assert.equal(sent.payment_note, PICKUP.squareNote);
});

test("pickup: no box limit", async () => {
  const { client, fake } = squareSetup();
  const result = await handlers.createCheckout(
    { items: [{ variationId: "VAR_INCENSE", quantity: MAX_ITEMS + 1 }], fulfillment: "pickup" },
    squareConfig,
    { client },
  );
  assert.equal(result.status, 200);
  assert.equal(fake.state.paymentLinks.length, 1);
});

test("shipping stays the default, and shipped orders aren't marked as pickup", async () => {
  const { client, fake } = squareSetup();
  await handlers.createCheckout({ items: [{ variationId: "VAR_INCENSE", quantity: 1 }] }, squareConfig, { client });
  const sent = fake.state.paymentLinks[0];
  assert.equal(sent.checkout_options.ask_for_shipping_address, true);
  assert.ok(sent.checkout_options.shipping_fee, "shipping charged");
  assert.equal(sent.payment_note, undefined);
});

test("unknown fulfillment is rejected before Square is asked", async () => {
  const { client, fake } = squareSetup();
  for (const fulfillment of ["delivery", "", 1, { pickup: true }]) {
    const result = await handlers.createCheckout(
      { items: [{ variationId: "VAR_INCENSE", quantity: 1 }], fulfillment },
      squareConfig,
      { client },
    );
    // "" falls back to shipping, like leaving it out
    if (fulfillment === "") assert.equal(result.status, 200);
    else assert.equal(result.status, 400, JSON.stringify(fulfillment));
  }
  assert.equal(fake.state.paymentLinks.length, 1, "only the empty one checked out");
});
