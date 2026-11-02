// ─────────────────────────────────────────────────────────────────────────────
// FAKE FEDEX
// Answers the two FedEx endpoints the shop uses, shaped like FedEx's REST API,
// as a fetch stand-in for the tests. Prices are samples, not FedEx's.
// ─────────────────────────────────────────────────────────────────────────────

const PRICES = { FEDEX_SMALL_BOX: 22.95, FEDEX_MEDIUM_BOX: 28.95, FEDEX_LARGE_BOX: 37.95 };

function createFakeFedex({ prices = PRICES, accountDiscount = 0, failFor = [], amountAsObject = false } = {}) {
  const state = { tokenRequests: 0, quotes: [] };

  async function fetch(url, options = {}) {
    const { pathname } = new URL(url);
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

    if (pathname === "/oauth/token") {
      state.tokenRequests++;
      const form = new URLSearchParams(String(options.body));
      if (form.get("client_id") !== "key" || form.get("client_secret") !== "secret") {
        return reply(401, { errors: [{ code: "NOT.AUTHORIZED.ERROR", message: "Bad credentials" }] });
      }
      return reply(200, { access_token: "TOKEN", token_type: "bearer", expires_in: 3599 });
    }

    if (pathname === "/rate/v1/rates/quotes") {
      if (options.headers.Authorization !== "Bearer TOKEN") return reply(401, { errors: [{ code: "NOT.AUTHORIZED.ERROR", message: "Bad token" }] });
      const body = JSON.parse(options.body);
      state.quotes.push(body);
      const packaging = body.requestedShipment.packagingType;
      if (failFor.includes(packaging) || !(packaging in prices)) {
        return reply(400, { errors: [{ code: "PACKAGING.TYPE.INVALID", message: "Packaging type is invalid" }] });
      }
      const list = prices[packaging];
      const money = (n) => (amountAsObject ? { amount: n, currency: "USD" } : n);
      return reply(200, {
        output: {
          rateReplyDetails: [
            {
              serviceType: body.requestedShipment.serviceType,
              packagingType: packaging,
              ratedShipmentDetails: [
                { rateType: "LIST", totalNetCharge: money(list), currency: "USD" },
                ...(accountDiscount
                  ? [{ rateType: "ACCOUNT", totalNetCharge: money(+(list - accountDiscount).toFixed(2)), currency: "USD" }]
                  : []),
              ],
            },
          ],
        },
      });
    }
    return reply(404, {});
  }

  return { fetch, state };
}

module.exports = { createFakeFedex, PRICES };
