// ─────────────────────────────────────────────────────────────────────────────
// SHOP
// Category filter, quantity stepper, live stock, and the buy button.
//
// Live stock and checkout both need a small server function (Square keeps the
// real counts, and the Square key can't live in the browser). Until that
// exists, STOCK_ENDPOINT and CHECKOUT_ENDPOINT are null and the page uses the
// stock numbers baked in at build time.
// ─────────────────────────────────────────────────────────────────────────────

// e.g. "/api/stock"    → GET ?ids=VAR1,VAR2  returns { "VAR1": 3, "VAR2": 0 }
const STOCK_ENDPOINT = null;
// e.g. "/api/checkout" → POST { variationId, quantity } returns { url }
const CHECKOUT_ENDPOINT = null;

// Keep in sync with src/config/filters/shop.js
function stockLabel(count) {
  if (count <= 0) return "Sold out";
  if (count === 1) return "The last one";
  if (count <= 3) return `Only ${count} left`;
  return "In stock";
}

/* ---------- Category filter (shop page) ---------- */

const filter = document.querySelector(".shop-filter");
const cards = document.querySelectorAll(".shop-card");

if (filter) {
  filter.hidden = false;
  const buttons = filter.querySelectorAll(".shop-filter-button");

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const chosen = button.dataset.category;
      buttons.forEach((b) =>
        b.setAttribute("aria-pressed", String(b === button)),
      );
      cards.forEach((card) => {
        card.hidden = chosen !== "all" && card.dataset.category !== chosen;
      });
    });
  });
}

/* ---------- Quantity stepper (product page) ---------- */

const buyForm = document.querySelector(".product-buy");
const qtyInput = document.querySelector("#qty");

function clampQuantity() {
  if (!qtyInput) return;
  const max = Number(qtyInput.max) || 1;
  let value = Math.round(Number(qtyInput.value)) || 1;
  value = Math.min(Math.max(value, 1), max);
  qtyInput.value = value;
}

if (qtyInput) {
  document.querySelector(".quantity-down").addEventListener("click", () => {
    qtyInput.value = Number(qtyInput.value) - 1;
    clampQuantity();
  });
  document.querySelector(".quantity-up").addEventListener("click", () => {
    qtyInput.value = Number(qtyInput.value) + 1;
    clampQuantity();
  });
  qtyInput.addEventListener("change", clampQuantity);
}

/* ---------- Live stock ---------- */

function applyStock(variationId, count) {
  const selector = `[data-variation-id="${variationId}"]`;

  // Shop grid card
  document.querySelectorAll(`.shop-card${selector}`).forEach((card) => {
    card.classList.toggle("is-sold-out", count <= 0);
    const stock = card.querySelector(".shop-stock");
    stock.dataset.stock = count;
    stock.textContent = stockLabel(count);
  });

  // Product page
  const product = document.querySelector(`#clt-product${selector}`);
  if (product) {
    product.classList.toggle("is-sold-out", count <= 0);
    const stock = product.querySelector(".shop-stock");
    stock.dataset.stock = count;
    stock.textContent = stockLabel(count);

    const button = product.querySelector(".buy-button");
    button.disabled = count <= 0;
    button.textContent = count <= 0 ? "Sold out" : "Buy now";
    product.querySelector(".quantity").hidden = count <= 0;
    if (qtyInput) {
      qtyInput.max = Math.max(count, 1);
      clampQuantity();
    }
  }
}

async function refreshStock() {
  if (!STOCK_ENDPOINT) return;
  const ids = [...document.querySelectorAll("[data-variation-id]")]
    .map((el) => el.dataset.variationId)
    .filter((id, i, all) => all.indexOf(id) === i);
  if (!ids.length) return;

  try {
    const response = await fetch(`${STOCK_ENDPOINT}?ids=${ids.join(",")}`);
    if (!response.ok) return;
    const counts = await response.json();
    Object.entries(counts).forEach(([id, count]) => applyStock(id, count));
  } catch (error) {
    // Network trouble: the build-time numbers stay on screen
    console.warn("Live stock unavailable", error);
  }
}

refreshStock();

// Someone who leaves the tab open over a fair weekend comes back to fresh numbers
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshStock();
});

/* ---------- Buy button ---------- */

if (buyForm) {
  const note = buyForm.querySelector(".buy-note");
  const button = buyForm.querySelector(".buy-button");

  buyForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!CHECKOUT_ENDPOINT) {
      note.textContent =
        "Online checkout is almost ready. Until then, find me at a fair or send me a note.";
      return;
    }

    button.disabled = true;
    note.textContent = "Opening checkout…";
    try {
      const response = await fetch(CHECKOUT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variationId: buyForm.dataset.variationId,
          quantity: Number(qtyInput.value),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.url)
        throw new Error(result.error || "Checkout failed");
      window.location.href = result.url;
    } catch (error) {
      note.textContent =
        "Something went wrong opening checkout. Please try again in a moment.";
      button.disabled = false;
      refreshStock(); // It may have just sold out
    }
  });
}
