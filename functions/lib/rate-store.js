// ─────────────────────────────────────────────────────────────────────────────
// RATE STORE
// Where FedEx's prices are kept between the daily check and checkout. One
// Firestore document, shop/shippingRates:
//
//   { cents: { Small: 1955, Medium: 2435, Large: 3205 },
//     fetchedAt: "2026-10-22T09:00:00.000Z", serviceType, rateType }
//
// Only the functions read and write it (the admin SDK skips security rules),
// so Firestore can stay locked to the public.
// ─────────────────────────────────────────────────────────────────────────────

function firestoreRateStore(db) {
  const doc = db.collection("shop").doc("shippingRates");
  return {
    async read() {
      const snapshot = await doc.get();
      return snapshot.exists ? snapshot.data() : null;
    },
    async write(record) {
      await doc.set(record);
    },
  };
}

// For tests and the local dev server
function memoryRateStore(initial = null) {
  let record = initial;
  return {
    async read() {
      return record;
    },
    async write(next) {
      record = next;
    },
  };
}

module.exports = { firestoreRateStore, memoryRateStore };
