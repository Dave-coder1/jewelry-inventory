// Step 2: IndexedDB. The list now renders from the `items` store via db.js
// instead of a hardcoded array. On first run (empty store) it seeds the same
// 8 fake items so there is something to look at — after that they are real,
// persisted records. See JEWELRY-PWA-SPEC.md §17.
//
// No raw IndexedDB calls in this file — everything goes through DB (db.js).

const TYPES = ["մատանի", "բրասլետ", "կուլոն", "ցեպ", "կոպեկ", "օղեր", "այլ"];

const SEED_ITEMS = [
  { code: "A1", name: "Yellow gold bracelet", type: TYPES[1], note: "Grandmother's, from the 1980s", status: "bank" },
  { code: "A2", name: "Wedding ring", type: TYPES[0], note: "Engraved inside band", status: "home" },
  { code: "A3", name: "Small pendant with cross", type: TYPES[2], note: "", status: "bank" },
  { code: "A4", name: "Thin chain necklace", type: TYPES[3], note: "Tangles easily, keep in pouch", status: "bank" },
  { code: "A5", name: "Old coin, framed", type: TYPES[4], note: "1915, family heirloom", status: "bank" },
  { code: "A6", name: "Gold hoop earrings", type: TYPES[5], note: "Pair, small size", status: "home" },
  { code: "A7", name: "Signet ring", type: TYPES[0], note: "Slightly bent, needs resizing", status: "bank" },
  { code: "A8", name: "Miscellaneous gold chain fragment", type: TYPES[6], note: "Not sure what this belonged to", status: "bank" },
];

function makeItemFromSeed(seed, position) {
  const now = new Date();
  return {
    uid: crypto.randomUUID(),
    code: seed.code,
    position,
    name: seed.name,
    type: seed.type,
    note: seed.note,
    status: seed.status,
    photo1Thumb: null,
    photo1Full: null,
    photo2Thumb: null,
    photo2Full: null,
    history: [{ id: crypto.randomUUID(), to: seed.status, date: now.toISOString().slice(0, 10) }],
    createdAt: now.toISOString(),
    deletedAt: null,
  };
}

// First run only: the `items` store is empty, so there is nothing to show.
// Seed it with the same 8 fake items step 1 used, now as real records.
async function seedIfEmpty() {
  const existing = await DB.getAllItems();
  if (existing.length > 0) return existing;

  const seeded = [];
  for (let i = 0; i < SEED_ITEMS.length; i++) {
    const item = makeItemFromSeed(SEED_ITEMS[i], i + 1);
    await DB.putItem(item);
    seeded.push(item);
  }
  return seeded;
}

function renderRow(item) {
  const row = document.createElement("div");
  row.className = "row";
  row.dataset.uid = item.uid;

  const pillClass = item.status === "bank" ? "pill-bank" : "pill-home";
  const pillIcon = item.status === "bank" ? "🏦" : "🏠";

  row.innerHTML = `
    <div class="cell cell-code">${item.code}</div>
    <div class="cell cell-photo1"><div class="thumb thumb-1">📷</div></div>
    <div class="cell cell-name">${item.name}</div>
    <div class="cell cell-status"><button class="pill ${pillClass}">${pillIcon}</button></div>
    <div class="cell cell-type">${item.type}</div>
    <div class="cell cell-photo2"><div class="thumb thumb-2">📦</div></div>
    <div class="cell cell-note">${item.note}</div>
  `;

  return row;
}

function render(items) {
  const rowsEl = document.getElementById("rows");
  rowsEl.innerHTML = "";
  items
    .filter((item) => !item.deletedAt)
    .sort((a, b) => a.position - b.position)
    .forEach((item) => rowsEl.appendChild(renderRow(item)));
}

async function init() {
  const items = await seedIfEmpty();
  render(items);
}

init();
