// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER PRODUCTS
// Used when the build has no SQUARE_ACCESS_TOKEN, so the site still builds and
// the shop still has something to show. Same shape buildProducts() produces
// from Nadine's real Square catalog (functions/lib/square.js).
//
// Only the two candle names and taglines are real (read off the labels).
// ─────────────────────────────────────────────────────────────────────────────

const { summarize } = require("../../../functions/lib/square");

const variation = (id, price, stock, name = "") => ({
  id,
  name,
  price,
  currency: "USD",
  stock,
  maxQuantity: stock === null ? 20 : Math.min(stock, 20),
});

module.exports = [
  {
    id: "MOCKITEM1",
    slug: "blue-moon-new-you",
    name: "Blue Moon, New You",
    category: "Candles",
    tagline: "Restart, renew, new you",
    paragraphs: [
      "A fresh-start candle, poured for the moment you decide to begin again. Infused with sweet orange and topped with dried citrus, crystals, and a wooden wick that crackles like a small hearth.",
    ],
    details: ["Infused sweet orange", "Crystals and dried citrus on top", "Wooden wick", "Container smudged before pouring"],
    image: "/assets/images/shop/blue-moon-new-you.jpg",
    variations: [variation("MOCKVAR1", 2800, 4)],
  },
  {
    id: "MOCKITEM2",
    slug: "sanctuary-of-divine",
    name: "Sanctuary of Divine",
    category: "Candles",
    tagline: "Grounding & clarification",
    paragraphs: [
      "For the quiet hour after a long day. Sandalwood-infused and set with amethyst and citrus peel, meant to settle a room and the person in it.",
    ],
    details: ["Infused sandalwood", "Amethyst and citrus peel on top", "Wooden wick", "Container smudged before pouring"],
    image: "/assets/images/shop/sanctuary-of-divine.jpg",
    variations: [variation("MOCKVAR2", 2800, 1)],
  },
  {
    id: "MOCKITEM3",
    slug: "money-draw-oil",
    name: "Money Draw Oil",
    category: "Oils",
    tagline: "Abundance & open doors",
    paragraphs: [
      "A roll-on ritual oil for prosperity work. Dress a candle with it, or wear it on your wrists before the meeting that matters.",
    ],
    details: ["Roll-on bottle", "Patchouli and citrus base", "Quartz chips in every bottle"],
    image: "/assets/images/shop/roll-on-oil.jpg",
    variations: [variation("MOCKVAR3A", 1600, 7, "10 ml"), variation("MOCKVAR3B", 3200, 2, "30 ml")],
  },
  {
    id: "MOCKITEM4",
    slug: "protection-spell-jar",
    name: "Protection Spell Jar",
    category: "Spell Kits",
    tagline: "Hang by the door",
    paragraphs: [
      "A sealed spell jar of lavender, rose, and a written intention, finished with wax and a pentacle charm. Hang it near an entrance or keep it on your altar.",
    ],
    details: ["Sealed glass vial", "Lavender, rose petals, written intention", "Pentacle charm"],
    image: "/assets/images/shop/protection-spell-kit.jpg",
    variations: [variation("MOCKVAR4", 2200, 0)],
  },
  {
    id: "MOCKITEM5",
    slug: "full-moon-incense-blend",
    name: "Full Moon Incense Blend",
    category: "Herbal Blends",
    tagline: "For charging & release",
    paragraphs: [
      "Loose resin and herb incense for burning on charcoal during full moon work. Blended by hand in small batches.",
    ],
    details: ["Loose blend, burn on charcoal", "Frankincense, mugwort, and rose", "About 1 oz"],
    image: null,
    variations: [variation("MOCKVAR5", 1400, 9)],
  },
  {
    id: "MOCKITEM6",
    slug: "hearthfire",
    name: "Hearthfire",
    category: "Candles",
    tagline: "Warmth & home",
    paragraphs: ["Cinnamon, clove, and a little smoke. The candle for the first cold night of the year."],
    details: ["Infused cinnamon and clove", "Wooden wick", "Container smudged before pouring"],
    image: null,
    variations: [variation("MOCKVAR6", 3000, 2)],
  },
].map(summarize);
