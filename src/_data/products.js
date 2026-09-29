// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTS (MOCK DATA)
// Stand-in for Nadine's Square catalog until the Square connection exists.
//
// The shape mirrors what we'll pull from Square:
//   id           → Square catalog item id
//   variationId  → Square item variation id (what checkout and stock use)
//   name         → item name
//   category     → Square category name
//   description  → item description (Square allows plain text or basic HTML)
//   price        → variation price_money.amount, in cents
//   stock        → inventory count for the variation at her location
//   image        → first item image URL
//
// "tagline" and "details" aren't standard Square fields. Nadine could put
// them in Square custom attributes, or we drop them. Decide when we wire it up.
//
// When Square is connected, this file becomes a fetch of her catalog at build
// time. The templates shouldn't need to change.
//
// PLACEHOLDERS: everything except the two candle names and taglines (read off
// the real labels) is invented. Prices, stock, and descriptions all need
// Nadine's real numbers and words.
// ─────────────────────────────────────────────────────────────────────────────

const products = [
  {
    id: "MOCK-ITEM-1",
    variationId: "MOCK-VAR-1",
    slug: "blue-moon-new-you",
    name: "Blue Moon, New You",
    category: "Candles",
    tagline: "Restart, renew, new you",
    description:
      "A fresh-start candle, poured for the moment you decide to begin again. Infused with sweet orange and topped with dried citrus, crystals, and a wooden wick that crackles like a small hearth.",
    details: [
      "Infused sweet orange",
      "Crystals and dried citrus on top",
      "Wooden wick",
      "Container smudged before pouring",
    ],
    price: 2800,
    stock: 4,
    image: "/assets/images/shop/blue-moon-new-you.jpg",
  },
  {
    id: "MOCK-ITEM-2",
    variationId: "MOCK-VAR-2",
    slug: "sanctuary-of-divine",
    name: "Sanctuary of Divine",
    category: "Candles",
    tagline: "Grounding & clarification",
    description:
      "For the quiet hour after a long day. Sandalwood-infused and set with amethyst and citrus peel, meant to settle a room and the person in it.",
    details: [
      "Infused sandalwood",
      "Amethyst and citrus peel on top",
      "Wooden wick",
      "Container smudged before pouring",
    ],
    price: 2800,
    stock: 1,
    image: "/assets/images/shop/sanctuary-of-divine.jpg",
  },
  {
    id: "MOCK-ITEM-3",
    variationId: "MOCK-VAR-3",
    slug: "money-draw-oil",
    name: "Money Draw Oil",
    category: "Oils",
    tagline: "Abundance & open doors",
    description:
      "A roll-on ritual oil for prosperity work. Dress a candle with it, or wear it on your wrists before the meeting that matters.",
    details: [
      "10 ml roll-on",
      "Patchouli and citrus base",
      "Quartz chips in every bottle",
    ],
    price: 1600,
    stock: 7,
    image: "/assets/images/shop/roll-on-oil.jpg",
  },
  {
    id: "MOCK-ITEM-4",
    variationId: "MOCK-VAR-4",
    slug: "protection-spell-jar",
    name: "Protection Spell Jar",
    category: "Spell Kits",
    tagline: "Hang by the door",
    description:
      "A sealed spell jar of lavender, rose, and a written intention, finished with wax and a pentacle charm. Hang it near an entrance or keep it on your altar.",
    details: [
      "Sealed glass vial",
      "Lavender, rose petals, written intention",
      "Pentacle charm",
    ],
    price: 2200,
    stock: 0,
    image: "/assets/images/shop/protection-spell-kit.jpg",
  },
  {
    id: "MOCK-ITEM-5",
    variationId: "MOCK-VAR-5",
    slug: "full-moon-incense-blend",
    name: "Full Moon Incense Blend",
    category: "Herbal Blends",
    tagline: "For charging & release",
    description:
      "Loose resin and herb incense for burning on charcoal during full moon work. Blended by hand in small batches.",
    details: [
      "Loose blend, burn on charcoal",
      "Frankincense, mugwort, and rose",
      "About 1 oz",
    ],
    price: 1400,
    stock: 9,
    image: null,
  },
  {
    id: "MOCK-ITEM-6",
    variationId: "MOCK-VAR-6",
    slug: "hearthfire",
    name: "Hearthfire",
    category: "Candles",
    tagline: "Warmth & home",
    description:
      "Cinnamon, clove, and a little smoke. The candle for the first cold night of the year.",
    details: [
      "Infused cinnamon and clove",
      "Wooden wick",
      "Container smudged before pouring",
    ],
    price: 3000,
    stock: 2,
    image: null,
  },
];

module.exports = products;
