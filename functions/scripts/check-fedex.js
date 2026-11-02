// ─────────────────────────────────────────────────────────────────────────────
// CHECK FEDEX
// Asks FedEx for today's price of every box in shipping-rates.js, using the
// same request the daily job makes, and prints them. Saves nothing. Use it to
// confirm the FedEx credentials and settings work before deploying.
//
// Run from the repo root, with the FedEx settings in functions/.env and the
// three secrets in the repo-root .env (both are git-ignored):
//
//   FEDEX_API_KEY=...          (repo-root .env)
//   FEDEX_SECRET_KEY=...
//   FEDEX_ACCOUNT_NUMBER=...
//
//   node functions/scripts/check-fedex.js
// ─────────────────────────────────────────────────────────────────────────────

const path = require("node:path");
for (const file of [path.join(__dirname, "../.env"), path.join(process.cwd(), ".env")]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Missing file is fine; the client says what's missing
  }
}

const { createFedexClient } = require("../lib/fedex");
const { boxes } = require("../lib/shipping");

(async () => {
  const client = createFedexClient(process.env);
  console.log(
    `FedEx ${client.environment}: ${client.serviceType}, ${process.env.FEDEX_SHIP_FROM_ZIP} → ${client.toZip} (national band)\n`,
  );
  let failed = false;
  for (const box of boxes) {
    try {
      const { cents, rateType } = await client.quoteOneRate(box.fedexPackaging);
      console.log(`  ${box.name.padEnd(8)} ${box.fedexPackaging.padEnd(22)} $${(cents / 100).toFixed(2)}  (${rateType} rate)`);
    } catch (error) {
      failed = true;
      console.log(`  ${box.name.padEnd(8)} ${box.fedexPackaging.padEnd(22)} FAILED: ${error.message}`);
    }
  }
  process.exitCode = failed ? 1 : 0;
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
