// ─────────────────────────────────────────────────────────────────────────────
// LOCAL SHOP PREVIEW (no Square account needed)
// Serves the built site from public/ and answers /api/* with the real
// handlers, talking to the fake Square. For trying the basket end to end.
//
//   node functions/test/fake-square.js          (terminal 1)
//   SQUARE_ACCESS_TOKEN=test-token SQUARE_API_BASE=http://localhost:4010/v2 npm run build
//   node functions/test/dev-server.js           (terminal 2) → http://localhost:8090
//
// For the real thing with Square's sandbox, use the Firebase emulators instead
// (see SHOP-SETUP.md).
// ─────────────────────────────────────────────────────────────────────────────

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const handlers = require("../lib/handlers");

const PORT = Number(process.env.PORT) || 8090;
const ROOT = path.resolve(__dirname, "../../public");
const config = {
  SQUARE_ACCESS_TOKEN: "test-token",
  SQUARE_API_BASE: process.env.SQUARE_API_BASE || "http://localhost:4010/v2",
  SITE_URL: `http://localhost:${PORT}`,
  SHOP_SHIPPING_FLAT_CENTS: process.env.SHOP_SHIPPING_FLAT_CENTS || "",
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

function sendJson(res, { status, body }) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    try {
      if (url.pathname === "/api/stock" && req.method === "GET") {
        return sendJson(res, await handlers.getStock({ ids: url.searchParams.get("ids") }, config));
      }
      if (url.pathname === "/api/checkout" && req.method === "POST") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        return sendJson(res, await handlers.createCheckout(JSON.parse(raw || "{}"), config));
      }
    } catch (error) {
      console.error(error);
      return sendJson(res, { status: 502, body: { error: "Checkout couldn't open just now." } });
    }

    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`Shop preview on http://localhost:${PORT}`));
