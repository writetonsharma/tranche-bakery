export const catalogSeed = {
  categories: [
    { id: "loaves", label: "Loaves", active: true },
    { id: "buns-rolls", label: "Buns & Rolls", active: true },
    { id: "breakfast", label: "Breakfast", active: true },
    { id: "sweet-bakes", label: "Sweet Bakes", active: true }
  ],
  items: [
    item("everyday-sandwich-loaf", "loaves", "Everyday Sandwich Loaf"),
    item("whole-wheat-loaf-50", "loaves", "Whole Wheat Loaf - 50%"),
    item("whole-wheat-loaf-80", "loaves", "Whole Wheat Loaf - 80%"),
    item("multi-seeded-loaf", "loaves", "Multi-Seeded Loaf"),
    item("country-loaf", "loaves", "Country Loaf"),
    item("enriched-white-loaf", "loaves", "Enriched White Loaf"),
    item("honey-walnut-loaf", "loaves", "Honey & Walnut Loaf"),
    item("olive-loaf", "loaves", "Olive Loaf"),
    item("caramelized-onion-loaf", "loaves", "Caramelized Onion Loaf"),
    item("honey-oat-loaf", "loaves", "Honey & Oat Loaf"),
    item("whole-wheat-rolls", "buns-rolls", "Whole Wheat Rolls", "set"),
    item("multi-seed-rolls", "buns-rolls", "Multi Seed Rolls", "set"),
    item("milk-buns", "buns-rolls", "Milk Buns", "set"),
    item("sesame-burger-buns", "buns-rolls", "Sesame Burger Buns", "set"),
    item("potato-buns", "buns-rolls", "Potato Buns", "set"),
    item("eggless-brioche-buns", "buns-rolls", "Eggless Brioche Buns", "set"),
    item("pretzel-buns", "buns-rolls", "Pretzel Buns", "set"),
    item("kaiser-rolls", "buns-rolls", "Kaiser Rolls", "set"),
    item("plain-bagel", "breakfast", "Plain Bagel", "set"),
    item("caramelized-onion-bagel", "breakfast", "Caramelized Onion Bagel", "set"),
    item("rosemary-sea-salt-focaccia", "breakfast", "Rosemary Sea Salt Focaccia", "tray"),
    item("olive-tomato-focaccia", "breakfast", "Olive & Tomato Focaccia", "tray"),
    item("garlic-knots", "breakfast", "Garlic Knots", "set"),
    item("cinnamon-rolls", "sweet-bakes", "Cinnamon Rolls", "set"),
    item("chocolate-rolls", "sweet-bakes", "Chocolate Rolls", "set"),
    item("cardamom-buns", "sweet-bakes", "Cardamom Buns", "set")
  ]
};

function item(id, categoryId, name, unit = "piece") {
  return {
    id,
    categoryId,
    name,
    unit,
    pricePaise: 0,
    active: true
  };
}
