// ─────────────────────────────────────────────────────────────────────────────
// CROW & MOON SHOP API (Firebase Functions, 2nd gen)
//
//   GET  /api/stock?ids=A,B   live stock from Square        → stock
//   POST /api/checkout        basket → Square checkout link → checkout
//   POST /api/square-webhook  catalog changed → rebuild     → squareWebhook
//
// The /api/* paths are mapped to these functions in firebase.json, so the site
// calls them on its own domain. Setup steps: SHOP-SETUP.md in the repo root.
//
// Secrets (set once with `firebase functions:secrets:set NAME`):
//   SQUARE_ACCESS_TOKEN, SQUARE_WEBHOOK_SIGNATURE_KEY, GITHUB_DISPATCH_TOKEN
// Everything else comes from functions/.env (see functions/.env.example).
// ─────────────────────────────────────────────────────────────────────────────

const { onRequest } = require("firebase-functions/https");
const { defineSecret } = require("firebase-functions/params");
const handlers = require("./lib/handlers");
const { SquareError } = require("./lib/square");

const SQUARE_ACCESS_TOKEN = defineSecret("SQUARE_ACCESS_TOKEN");
const SQUARE_WEBHOOK_SIGNATURE_KEY = defineSecret("SQUARE_WEBHOOK_SIGNATURE_KEY");
const GITHUB_DISPATCH_TOKEN = defineSecret("GITHUB_DISPATCH_TOKEN");

const common = {
  region: "us-central1",
  invoker: "public",
  memory: "256MiB",
  timeoutSeconds: 30,
  // A ceiling on how many copies can run at once, which also caps runaway cost
  maxInstances: 5,
};

function send(res, { status, body }) {
  res.set("Cache-Control", "private, no-store");
  res.status(status).json(body);
}

function fail(res, error, friendly) {
  const isSquare = error instanceof SquareError;
  console.error(JSON.stringify({ message: error.message, square: isSquare, errors: error.errors }));
  res.set("Cache-Control", "private, no-store");
  res.status(isSquare ? 502 : 500).json({ error: friendly });
}

exports.stock = onRequest({ ...common, secrets: [SQUARE_ACCESS_TOKEN] }, async (req, res) => {
  if (req.method !== "GET") return send(res, { status: 405, body: { error: "GET only" } });
  try {
    send(res, await handlers.getStock({ ids: req.query.ids }, process.env));
  } catch (error) {
    fail(res, error, "Couldn't reach the shop's stock just now.");
  }
});

exports.checkout = onRequest({ ...common, secrets: [SQUARE_ACCESS_TOKEN] }, async (req, res) => {
  if (req.method !== "POST") return send(res, { status: 405, body: { error: "POST only" } });
  try {
    send(res, await handlers.createCheckout(req.body, process.env));
  } catch (error) {
    fail(res, error, "Checkout couldn't open just now. Please try again in a minute.");
  }
});

exports.squareWebhook = onRequest(
  { ...common, secrets: [SQUARE_WEBHOOK_SIGNATURE_KEY, GITHUB_DISPATCH_TOKEN] },
  async (req, res) => {
    if (req.method !== "POST") return send(res, { status: 405, body: { error: "POST only" } });
    try {
      send(
        res,
        await handlers.handleWebhook(
          { rawBody: req.rawBody, signature: req.get("x-square-hmacsha256-signature") },
          process.env,
        ),
      );
    } catch (error) {
      fail(res, error, "Webhook failed");
    }
  },
);
