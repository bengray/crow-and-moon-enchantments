// ─────────────────────────────────────────────────────────────────────────────
// BASKET DRAWER
// Loaded on every page. Shows the floating basket button when there's
// something in it, renders the drawer, and sends the basket to Square.
// Markup: src/_includes/sections/basket.html
// ─────────────────────────────────────────────────────────────────────────────

import {
  readBasket,
  basketCount,
  setQuantity,
  removeFromBasket,
  clearBasket,
  loadCatalog,
  fetchStock,
  shopIsLive,
  money,
  maxFor,
  CHECKOUT_ENDPOINT,
} from "./basket-store.js";
// Same box rules and prices checkout uses (edit functions/shipping-rates.js)
import { shippingFor, QUOTE_EMAIL } from "../../../functions/lib/shipping.js";

const drawer = document.querySelector("#basket");
const toggle = document.querySelector("#basket-toggle");

// The thank-you page empties the basket: the order went through
if (document.querySelector("[data-clear-basket]")) clearBasket();

if (drawer && toggle) {
  const linesEl = drawer.querySelector(".basket-lines");
  const emptyEl = drawer.querySelector(".basket-empty");
  const footerEl = drawer.querySelector(".basket-footer");
  const subtotalEl = drawer.querySelector(".basket-subtotal-amount");
  const shippingRowEl = drawer.querySelector(".basket-shipping");
  const shippingLabelEl = drawer.querySelector(".basket-shipping-label");
  const shippingAmountEl = drawer.querySelector(".basket-shipping-amount");
  const totalRowEl = drawer.querySelector(".basket-total");
  const totalEl = drawer.querySelector(".basket-total-amount");
  const quoteEl = drawer.querySelector(".basket-quote");
  const quoteLinkEl = drawer.querySelector(".basket-quote-link");
  const noteEl = drawer.querySelector(".basket-note");
  const checkoutButton = drawer.querySelector(".basket-checkout");
  const countEls = document.querySelectorAll("[data-basket-count]");

  // Latest known stock per variation, from catalog.json then /api/stock
  const liveStock = {};
  let checkingOut = false;

  /* ---------- Badge ---------- */

  function updateBadge() {
    const count = basketCount();
    countEls.forEach((el) => (el.textContent = count));
    toggle.hidden = count === 0;
    toggle.setAttribute("aria-label", `Basket, ${count} ${count === 1 ? "item" : "items"}`);
  }

  /* ---------- Drawer ---------- */

  function setNote(message) {
    noteEl.textContent = message || "";
  }

  function stockFor(id, entry) {
    return id in liveStock ? liveStock[id] : entry.stock;
  }

  function lineTemplate(line, entry) {
    const max = maxFor(stockFor(line.variationId, entry));
    const image = entry.image
      ? `<img src="${escapeHtml(entry.image)}" alt="" loading="lazy" />`
      : `<img src="/assets/images/moon.png" alt="" class="is-placeholder" loading="lazy" />`;
    const option = entry.variationName ? `<span class="basket-line-option">${escapeHtml(entry.variationName)}</span>` : "";

    return `
      <li class="basket-line" data-variation-id="${line.variationId}">
        <a class="basket-line-photo" href="/shop/${entry.slug}/" tabindex="-1" aria-hidden="true">${image}</a>
        <div class="basket-line-info">
          <a class="basket-line-name" href="/shop/${entry.slug}/">${escapeHtml(entry.productName)}</a>
          ${option}
          <span class="basket-line-unit">${money(entry.price)} each</span>
          <div class="basket-line-controls">
            <div class="quantity-stepper small">
              <button type="button" data-action="down" aria-label="One fewer ${escapeHtml(entry.productName)}">&minus;</button>
              <span class="quantity-value" aria-live="polite">${line.quantity}</span>
              <button type="button" data-action="up" aria-label="One more ${escapeHtml(entry.productName)}" ${line.quantity >= max ? "disabled" : ""}>&plus;</button>
            </div>
            <button type="button" class="basket-line-remove" data-action="remove">Remove</button>
          </div>
        </div>
        <span class="basket-line-total">${money(entry.price * line.quantity)}</span>
      </li>`;
  }

  // Renders can be requested while one is running (fixing the basket fires
  // basket:change). Run one at a time and finish with the newest state.
  let rendering = null;
  let renderAgain = false;
  function render() {
    if (rendering) {
      renderAgain = true;
      return rendering;
    }
    rendering = (async () => {
      do {
        renderAgain = false;
        await renderOnce();
      } while (renderAgain);
      rendering = null;
    })();
    return rendering;
  }

  async function renderOnce() {
    const catalog = await loadCatalog();
    const variations = catalog.variations || {};
    let lines = readBasket();

    // Drop anything no longer sold on the site, and trim to what's in stock
    const notes = [];
    for (const line of lines) {
      const entry = variations[line.variationId];
      if (!entry) {
        removeFromBasket(line.variationId);
        notes.push("Something in your basket is no longer in the shop, so I took it out.");
        continue;
      }
      const max = maxFor(stockFor(line.variationId, entry));
      if (line.quantity > max) {
        setQuantity(line.variationId, max);
        notes.push(
          max === 0
            ? `${entry.productName} just sold out, so I took it out of your basket.`
            : `Only ${max} ${entry.productName} left, so I've adjusted your basket.`,
        );
      }
    }
    lines = readBasket();
    if (notes.length) setNote(notes.join(" "));

    const empty = lines.length === 0;
    emptyEl.hidden = !empty;
    footerEl.hidden = empty;
    // Keep keyboard focus on the same control after re-rendering
    const focused = document.activeElement && document.activeElement.closest(".basket-line");
    const focusId = focused && focused.dataset.variationId;
    const focusAction = focusId && document.activeElement.dataset.action;

    linesEl.innerHTML = lines.map((line) => lineTemplate(line, variations[line.variationId])).join("");

    if (focusId) {
      const target =
        linesEl.querySelector(`[data-variation-id="${focusId}"] [data-action="${focusAction}"]:not([disabled])`) ||
        linesEl.querySelector(`[data-variation-id="${focusId}"] [data-action="remove"]`);
      (target || drawer.querySelector(".basket-close")).focus();
    }

    const subtotal = lines.reduce((sum, line) => sum + variations[line.variationId].price * line.quantity, 0);
    subtotalEl.textContent = money(subtotal);

    // Shipping: one FedEx flat-rate box, picked by how many items there are
    const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
    const shipping = shippingFor(itemCount);
    const needsQuote = !empty && !shipping;
    shippingRowEl.hidden = needsQuote;
    totalRowEl.hidden = needsQuote;
    quoteEl.hidden = !needsQuote;
    if (shipping) {
      shippingLabelEl.textContent = shipping.label;
      shippingAmountEl.textContent = money(shipping.cents);
      totalEl.textContent = money(subtotal + shipping.cents);
    }
    if (needsQuote) quoteLinkEl.href = quoteMailto(lines, variations);

    checkoutButton.disabled = empty || checkingOut || needsQuote;
    updateBadge();
  }

  async function refreshStock() {
    const ids = readBasket().map((l) => l.variationId);
    const stock = await fetchStock(ids);
    if (stock) Object.assign(liveStock, stock);
  }

  async function open() {
    setNote("");
    if (!drawer.open) drawer.showModal();
    await render();
    await refreshStock();
    await render();
  }

  function close() {
    drawer.close();
  }

  /* ---------- Checkout ---------- */

  async function checkout() {
    if (!shopIsLive()) {
      setNote("Online checkout is almost ready. Until then, find me at a fair or send me a note.");
      return;
    }

    checkingOut = true;
    checkoutButton.disabled = true;
    checkoutButton.textContent = "Opening checkout…";
    setNote("");

    try {
      const response = await fetch(CHECKOUT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ items: readBasket() }),
      });
      const result = await response.json().catch(() => ({}));

      if (response.ok && result.url) {
        window.location.href = result.url;
        return;
      }

      if (response.status === 409 && Array.isArray(result.problems)) {
        // Something sold out mid-shop: adjust the basket to what's really left,
        // and say exactly what changed
        const { variations = {} } = await loadCatalog();
        const changes = result.problems.map((problem) => {
          liveStock[problem.variationId] = problem.available;
          const entry = variations[problem.variationId];
          const name = entry
            ? `${entry.productName}${entry.variationName ? ` (${entry.variationName})` : ""}`
            : "One item";
          if (problem.available > 0) {
            setQuantity(problem.variationId, problem.available);
            return `Only ${problem.available} ${name} left, so I've adjusted your basket.`;
          }
          removeFromBasket(problem.variationId);
          return `${name} just sold out, so I took it out of your basket.`;
        });
        throw new Error(`${changes.join(" ")} Take a look and check out again when you're ready.`);
      }
      throw new Error(result.error || "Checkout couldn't open just now. Please try again in a minute.");
    } catch (error) {
      checkingOut = false;
      checkoutButton.textContent = "Checkout";
      await render();
      setNote(error.message);
    }
  }

  /* ---------- Events ---------- */

  document.querySelectorAll("[data-basket-open]").forEach((el) => el.addEventListener("click", open));
  drawer.querySelectorAll("[data-basket-close]").forEach((el) => el.addEventListener("click", close));
  checkoutButton.addEventListener("click", checkout);

  // Click on the dimmed backdrop closes the drawer
  drawer.addEventListener("click", (event) => {
    if (event.target === drawer) close();
  });

  linesEl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = button.closest(".basket-line").dataset.variationId;
    const current = readBasket().find((l) => l.variationId === id);
    if (!current) return;
    setNote("");
    if (button.dataset.action === "up") setQuantity(id, current.quantity + 1);
    if (button.dataset.action === "down") setQuantity(id, current.quantity - 1);
    if (button.dataset.action === "remove") removeFromBasket(id);
  });

  window.addEventListener("basket:change", () => {
    updateBadge();
    if (drawer.open) render();
  });

  // shop.js asks for this after "Add to basket"
  window.addEventListener("basket:open", open);

  // Coming back from Square's checkout with the back button: re-enable checkout
  window.addEventListener("pageshow", () => {
    checkingOut = false;
    checkoutButton.textContent = "Checkout";
    updateBadge();
  });

  updateBadge();
}

// An email to Nadine with the basket already written in
function quoteMailto(lines, variations) {
  const items = lines.map((line) => {
    const entry = variations[line.variationId];
    const name = `${entry.productName}${entry.variationName ? ` (${entry.variationName})` : ""}`;
    return `- ${line.quantity} × ${name}`;
  });
  const body = [
    "Hi,",
    "",
    "I'd like to order these, and need a shipping quote:",
    "",
    ...items,
    "",
    "Shipping to (city, state, ZIP):",
    "",
    "Thank you!",
  ].join("\n");
  return `mailto:${QUOTE_EMAIL}?subject=${encodeURIComponent("Shipping quote")}&body=${encodeURIComponent(body)}`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
