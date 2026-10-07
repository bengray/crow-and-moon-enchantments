// ─────────────────────────────────────────────────────────────────────────────
// SHOP PAGES
// Category filter (/shop/), option picker and "Add to basket" (/shop/<slug>/),
// and live stock from Square on both. The basket drawer itself is basket.js.
// ─────────────────────────────────────────────────────────────────────────────

// scroll to the id "clt-shop" any time the /shop/ page is loaded.
window.addEventListener("DOMContentLoaded", () => {
  const shopSection = document.querySelector("#clt-shop");
  const backButton = document.querySelector(".shop-back");
  // if (backButton) {
  //   backButton.scrollIntoView({ behavior: "smooth" });
  //   // offset about 50px from the top of the viewport
  // }
  if (shopSection) {
    shopSection.scrollIntoView({ behavior: "smooth" });
  } else if (backButton) {
    backButton.scrollIntoView({ behavior: "smooth" });
    // offset about 50px from the top of the viewport
  }
});

import {
  addToBasket,
  quantityOf,
  fetchStock,
  stockLabel,
  stockAttr,
  money,
  maxFor,
} from "./basket-store.js";

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

/* ---------- Product page ---------- */

const product = document.querySelector("#clt-product");
const buyForm = document.querySelector(".product-buy");
const qtyInput = document.querySelector("#qty");
const options = [...document.querySelectorAll(".product-option input")];
const singleVariation =
  buyForm && !options.length ? buyForm.dataset.variationId : null;

// Stock per variation on this page, from the build, then refreshed live
const stockById = {};
if (buyForm) {
  if (singleVariation)
    stockById[singleVariation] = parseStock(buyForm.dataset.stock);
  options.forEach(
    (input) => (stockById[input.value] = parseStock(input.dataset.stock)),
  );
}

function parseStock(value) {
  return value === "untracked" || value === undefined ? null : Number(value);
}

function selectedVariation() {
  if (singleVariation) return singleVariation;
  const checked = options.find((input) => input.checked);
  return checked ? checked.value : null;
}

function clampQuantity() {
  if (!qtyInput) return;
  const max = Number(qtyInput.max) || 1;
  let value = Math.round(Number(qtyInput.value)) || 1;
  value = Math.min(Math.max(value, 1), max);
  qtyInput.value = value;
}

// Show the price, stock, and button state for the chosen option
function updateProduct() {
  if (!buyForm) return;
  const id = selectedVariation();
  const stock = stockById[id];
  const soldOut = stock !== null && stock <= 0;
  const available = maxFor(stock) - quantityOf(id);

  const stockEl = product.querySelector(".product-stock");
  stockEl.dataset.stock = stockAttr(stock);
  stockEl.textContent = stockLabel(stock);

  const chosen = options.find((input) => input.checked);
  if (chosen)
    product.querySelector(".product-price").textContent = money(
      Number(chosen.dataset.price),
    );

  // Mark sold-out options
  options.forEach((input) => {
    const optionStock = stockById[input.value];
    input
      .closest(".product-option")
      .classList.toggle(
        "is-sold-out",
        optionStock !== null && optionStock <= 0,
      );
  });

  const allSoldOut = Object.values(stockById).every(
    (s) => s !== null && s <= 0,
  );
  product.classList.toggle("is-sold-out", allSoldOut);

  const button = buyForm.querySelector(".buy-button");
  button.disabled = soldOut || available <= 0;
  button.textContent = soldOut
    ? "Sold out"
    : available <= 0
      ? "All in your basket"
      : "Add to basket";

  buyForm.querySelector(".quantity").hidden = soldOut;
  if (qtyInput) {
    qtyInput.max = Math.max(available, 1);
    clampQuantity();
  }
}

if (buyForm) {
  buyForm.querySelector(".quantity-down").addEventListener("click", () => {
    qtyInput.value = Number(qtyInput.value) - 1;
    clampQuantity();
  });
  buyForm.querySelector(".quantity-up").addEventListener("click", () => {
    qtyInput.value = Number(qtyInput.value) + 1;
    clampQuantity();
  });
  qtyInput.addEventListener("change", clampQuantity);
  options.forEach((input) =>
    input.addEventListener("change", () => {
      qtyInput.value = 1;
      buyForm.querySelector(".buy-note").textContent = "";
      updateProduct();
    }),
  );

  buyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const id = selectedVariation();
    if (!id) return;
    const added = addToBasket(
      id,
      Number(qtyInput.value),
      maxFor(stockById[id]),
    );
    const note = buyForm.querySelector(".buy-note");
    if (!added) {
      note.textContent = "You already have every one I've got in your basket.";
      return;
    }
    note.textContent = "";
    qtyInput.value = 1;
    window.dispatchEvent(new CustomEvent("basket:open"));
  });

  // The basket changed (here, in the drawer, or in another tab)
  window.addEventListener("basket:change", updateProduct);
  updateProduct();
}

/* ---------- Live stock ---------- */

function applyCardStock(card, stock) {
  const ids = card.dataset.variationIds.split(",");
  const values = ids.map((id) => (id in stock ? stock[id] : undefined));
  if (values.some((v) => v === undefined)) return; // partial answer, keep build-time label
  const total = values.some((v) => v === null)
    ? null
    : values.reduce((sum, v) => sum + v, 0);
  const label = card.querySelector(".shop-stock");
  label.dataset.stock = stockAttr(total);
  label.textContent = stockLabel(total);
  card.classList.toggle("is-sold-out", total !== null && total <= 0);
}

async function refreshStock() {
  const ids = [
    ...[...cards].flatMap((card) => card.dataset.variationIds.split(",")),
    ...Object.keys(stockById),
  ];
  const stock = await fetchStock(ids);
  if (!stock) return; // placeholder build or network trouble: keep build-time numbers

  cards.forEach((card) => applyCardStock(card, stock));
  Object.keys(stockById).forEach((id) => {
    if (id in stock) stockById[id] = stock[id];
  });
  updateProduct();
}

refreshStock();

// Someone who leaves the tab open over a fair weekend comes back to fresh numbers
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshStock();
});
