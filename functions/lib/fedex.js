// ─────────────────────────────────────────────────────────────────────────────
// FEDEX CLIENT
// Asks FedEx what a One Rate (flat-rate) box costs. Small and dependency-free,
// like the Square client: plain fetch, two calls.
//
//   POST /oauth/token              API key + secret → a token good for an hour
//   POST /rate/v1/rates/quotes     one box → what Nadine's account pays for it
//
// One Rate prices depend on the box, the delivery speed, and the distance band
// (local, regional, national). We always quote the national band, so the price
// covers shipping anywhere in the US. See functions/shipping-rates.js.
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URLS = {
  production: "https://apis.fedex.com",
  sandbox: "https://apis-sandbox.fedex.com",
};

class FedexError extends Error {
  constructor(message, { status, errors } = {}) {
    super(message);
    this.name = "FedexError";
    this.status = status;
    this.errors = errors || [];
  }
}

/**
 * Build a client from a config object (usually process.env).
 *   FEDEX_API_KEY, FEDEX_SECRET_KEY, FEDEX_ACCOUNT_NUMBER   required (secrets)
 *   FEDEX_SHIP_FROM_ZIP     required: the ZIP Nadine ships from
 *   FEDEX_RATE_TO_ZIP       a ZIP in the national band from her (default 90001)
 *   FEDEX_SERVICE_TYPE      delivery speed (default FEDEX_EXPRESS_SAVER)
 *   FEDEX_PICKUP_TYPE       default DROPOFF_AT_FEDEX_LOCATION
 *   FEDEX_ENVIRONMENT       "production" (default) or "sandbox"
 *   FEDEX_API_BASE          test-only override of the API base URL
 */
function createFedexClient(config = process.env, { fetchImpl = globalThis.fetch } = {}) {
  const setting = (name, fallback = "") => String(config[name] || fallback).trim();

  const apiKey = setting("FEDEX_API_KEY");
  const secretKey = setting("FEDEX_SECRET_KEY");
  const accountNumber = setting("FEDEX_ACCOUNT_NUMBER");
  const fromZip = setting("FEDEX_SHIP_FROM_ZIP");
  const missing = Object.entries({
    FEDEX_API_KEY: apiKey,
    FEDEX_SECRET_KEY: secretKey,
    FEDEX_ACCOUNT_NUMBER: accountNumber,
    FEDEX_SHIP_FROM_ZIP: fromZip,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) throw new FedexError(`Missing FedEx settings: ${missing.join(", ")}`);

  const environment = setting("FEDEX_ENVIRONMENT", "production").toLowerCase();
  const base = (setting("FEDEX_API_BASE") || BASE_URLS[environment] || "").replace(/\/$/, "");
  if (!base) throw new FedexError(`FEDEX_ENVIRONMENT must be "production" or "sandbox", got "${environment}"`);

  const toZip = setting("FEDEX_RATE_TO_ZIP", "90001");
  const serviceType = setting("FEDEX_SERVICE_TYPE", "FEDEX_EXPRESS_SAVER");
  const pickupType = setting("FEDEX_PICKUP_TYPE", "DROPOFF_AT_FEDEX_LOCATION");

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  function failure(what, response, data) {
    const errors = data.errors || [];
    const detail = errors.map((e) => `${e.code}: ${e.message}`).join("; ");
    return new FedexError(`FedEx ${what} failed (${response.status})${detail ? `: ${detail}` : ""}`, {
      status: response.status,
      errors,
    });
  }

  let token = null;
  let tokenExpires = 0;

  async function getToken() {
    if (token && Date.now() < tokenExpires) return token;
    const response = await fetchImpl(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: apiKey, client_secret: secretKey }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await readJson(response);
    if (!response.ok || !data.access_token) throw failure("sign-in", response, data);
    token = data.access_token;
    // Renew a minute early so a token never expires mid-request
    tokenExpires = Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60000;
    return token;
  }

  /**
   * What one One Rate box costs Nadine to ship to the national band, in cents.
   * `packagingType` is FedEx's name for the box, like "FEDEX_MEDIUM_BOX".
   * Returns { cents, rateType } where rateType is "ACCOUNT" (her account's
   * price) when FedEx gives one, otherwise "LIST" (FedEx's published price).
   */
  async function quoteOneRate(packagingType) {
    const body = {
      accountNumber: { value: accountNumber },
      rateRequestControlParameters: { returnTransitTimes: false },
      requestedShipment: {
        shipper: { address: { postalCode: fromZip, countryCode: "US" } },
        recipient: { address: { postalCode: toZip, countryCode: "US", residential: true } },
        serviceType,
        packagingType,
        pickupType,
        rateRequestType: ["ACCOUNT", "LIST"],
        shipmentSpecialServices: { specialServiceTypes: ["FEDEX_ONE_RATE"] },
        // One Rate doesn't price by weight (up to 50 lb), but FedEx wants one
        requestedPackageLineItems: [{ weight: { units: "LB", value: 1 } }],
      },
    };

    const response = await fetchImpl(`${base}/rate/v1/rates/quotes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-locale": "en_US",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await readJson(response);
    if (!response.ok) throw failure(`rate for ${packagingType}`, response, data);
    return pickRate(data, packagingType);
  }

  return { quoteOneRate, environment, serviceType, toZip };
}

// The account price if FedEx sent one, otherwise the list price, in cents
function pickRate(data, packagingType) {
  const replies = (data.output && data.output.rateReplyDetails) || [];
  const details = replies.flatMap((reply) => reply.ratedShipmentDetails || []);
  const chosen =
    details.find((d) => d.rateType === "ACCOUNT") || details.find((d) => d.rateType === "LIST") || details[0];

  const raw = chosen && (chosen.totalNetCharge ?? chosen.totalNetFedExCharge);
  const amount = typeof raw === "object" && raw !== null ? raw.amount : raw;
  const currency = (chosen && (chosen.currency || (typeof raw === "object" && raw && raw.currency))) || "USD";
  const cents = Math.round(Number(amount) * 100);

  if (!chosen || !Number.isFinite(cents) || cents <= 0) {
    throw new FedexError(`FedEx sent no usable price for ${packagingType}`);
  }
  if (currency !== "USD") throw new FedexError(`FedEx priced ${packagingType} in ${currency}, expected USD`);
  return { cents, rateType: chosen.rateType || "UNKNOWN" };
}

module.exports = { createFedexClient, FedexError, pickRate };
