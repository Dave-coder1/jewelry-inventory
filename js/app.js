// Step 3: Detail sheet. Tapping a row opens a bottom sheet with every field
// editable in place — no Save button, each field commits on blur (or change,
// for the select). The Android back button, a downward swipe on the handle,
// or tapping the backdrop all close it. See JEWELRY-PWA-SPEC.md §9, §17.
//
// Photo replace/enlarge (§9.1), the status pill's toggle+history write
// (§8, §17 step 6), history editing and "Add entry" (§17 step 6), and
// "Delete item" (§17 step 4) are not wired up yet — those controls render
// but stay inert (disabled, or simply not clickable) until their step.
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

// In-memory mirror of the `items` store, kept in sync with IndexedDB by
// every write below. The list and the sheet both read from this.
let items = [];

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

function render() {
  const rowsEl = document.getElementById("rows");
  rowsEl.innerHTML = "";
  items
    .filter((item) => !item.deletedAt)
    .sort((a, b) => a.position - b.position)
    .forEach((item) => rowsEl.appendChild(renderRow(item)));
}

// ---- Detail sheet ----

const backdropEl = document.getElementById("backdrop");
const sheetEl = document.getElementById("sheet");
const sheetDragEl = document.getElementById("sheetDrag");
const sheetTitleEl = document.getElementById("sheetTitle");
const fieldName = document.getElementById("fieldName");
const fieldType = document.getElementById("fieldType");
const fieldNote = document.getElementById("fieldNote");
const noteCountEl = document.getElementById("noteCount");
const fieldCode = document.getElementById("fieldCode");
const codeErrorEl = document.getElementById("codeError");
const fieldStatus = document.getElementById("fieldStatus");
const historyListEl = document.getElementById("historyList");

TYPES.forEach((type) => {
  const opt = document.createElement("option");
  opt.value = type;
  opt.textContent = type;
  fieldType.appendChild(opt);
});

let openUid = null;

function findItem(uid) {
  return items.find((item) => item.uid === uid) || null;
}

function formatHistoryDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function renderHistory(item) {
  historyListEl.innerHTML = "";

  if (item.history.length === 0) {
    historyListEl.innerHTML = `<div class="history-empty">No history yet.</div>`;
    return;
  }

  // Newest first by date; ties broken by insertion order (§3).
  const sorted = item.history
    .map((entry, insertionIndex) => ({ ...entry, insertionIndex }))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.insertionIndex - a.insertionIndex;
    });

  sorted.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "history-row";
    const label = entry.to === "bank" ? "To Bank" : "To Home";
    row.innerHTML = `
      <span class="history-to">${label}</span>
      <span class="history-date">${formatHistoryDate(entry.date)}</span>
    `;
    historyListEl.appendChild(row);
  });
}

function updateNoteCount() {
  const len = fieldNote.value.length;
  noteCountEl.textContent = `${len} / 120`;
  noteCountEl.classList.toggle("visible", len >= 100);
}

function fillSheet(item) {
  sheetTitleEl.textContent = item.code;

  fieldName.value = item.name;
  fieldType.value = item.type;
  fieldNote.value = item.note;
  updateNoteCount();
  fieldCode.value = item.code;
  codeErrorEl.classList.remove("visible");
  codeErrorEl.textContent = "";

  const isBank = item.status === "bank";
  fieldStatus.className = "sheet-status-pill " + (isBank ? "pill-bank" : "pill-home");
  fieldStatus.textContent = isBank ? "🏦 Bank" : "🏠 Home";

  renderHistory(item);
}

// Persist a field change: write to IndexedDB, update the in-memory mirror,
// and re-render the (hidden, behind the sheet) list so it's consistent
// whenever the sheet is closed.
async function persist(item) {
  await DB.putItem(item);
  const idx = items.findIndex((it) => it.uid === item.uid);
  if (idx !== -1) items[idx] = item;
  render();
}

function openSheet(uid) {
  const item = findItem(uid);
  if (!item) return;
  openUid = uid;
  fillSheet(item);
  backdropEl.classList.add("open");
  sheetEl.classList.add("open");
  history.pushState({ sheetOpen: true }, "");
}

function hideSheet() {
  backdropEl.classList.remove("open");
  sheetEl.classList.remove("open");
  sheetEl.style.transform = "";
  openUid = null;
}

// Closing always goes through history.back() so the pushState from
// openSheet() gets popped; the popstate listener below does the actual
// hiding. That keeps "swipe down" / "tap backdrop" / "Android back" as one
// code path, per §6: back must never exit the app while the sheet is open.
function closeSheet() {
  if (!openUid) return;
  if (history.state && history.state.sheetOpen) {
    history.back();
  } else {
    hideSheet();
  }
}

window.addEventListener("popstate", () => {
  if (openUid) hideSheet();
});

backdropEl.addEventListener("click", closeSheet);

// Tap on a row opens the sheet, except on the pill or a thumbnail — those
// get their own gestures in later steps (§8).
document.getElementById("rows").addEventListener("click", (e) => {
  if (e.target.closest(".pill") || e.target.closest(".thumb")) return;
  const row = e.target.closest(".row");
  if (!row || !row.dataset.uid) return;
  openSheet(row.dataset.uid);
});

// ---- field commits ----

fieldName.addEventListener("blur", async () => {
  const item = findItem(openUid);
  if (!item) return;
  const value = fieldName.value.trim();
  if (!value) {
    fieldName.value = item.name; // required — revert rather than save empty
    return;
  }
  if (value === item.name) return;
  item.name = value;
  await persist(item);
});

fieldType.addEventListener("change", async () => {
  const item = findItem(openUid);
  if (!item) return;
  item.type = fieldType.value;
  await persist(item);
});

fieldNote.addEventListener("input", updateNoteCount);

fieldNote.addEventListener("blur", async () => {
  const item = findItem(openUid);
  if (!item) return;
  if (fieldNote.value === item.note) return;
  item.note = fieldNote.value;
  await persist(item);
});

fieldCode.addEventListener("blur", async () => {
  const item = findItem(openUid);
  if (!item) return;

  const value = fieldCode.value.trim().toUpperCase();
  if (value === item.code) {
    fieldCode.value = item.code;
    return;
  }

  const conflict = items.find(
    (it) => it.uid !== item.uid && !it.deletedAt && it.code === value
  );
  if (!value || conflict) {
    codeErrorEl.textContent = conflict
      ? `Code ${value} is already used by "${conflict.name}".`
      : "Code can't be empty.";
    codeErrorEl.classList.add("visible");
    fieldCode.value = item.code;
    return;
  }

  codeErrorEl.classList.remove("visible");
  item.code = value;
  await persist(item);
  sheetTitleEl.textContent = item.code;
});

// ---- drag the handle down to dismiss ----

let dragStartY = null;
let dragCurrentY = 0;

sheetDragEl.addEventListener("pointerdown", (e) => {
  dragStartY = e.clientY;
  sheetDragEl.setPointerCapture(e.pointerId);
  sheetEl.style.transition = "none";
});

sheetDragEl.addEventListener("pointermove", (e) => {
  if (dragStartY === null) return;
  dragCurrentY = Math.max(0, e.clientY - dragStartY);
  sheetEl.style.transform = `translateY(${dragCurrentY}px)`;
});

function endDrag() {
  if (dragStartY === null) return;
  sheetEl.style.transition = "";
  if (dragCurrentY > 120) {
    closeSheet();
  } else {
    sheetEl.style.transform = "";
  }
  dragStartY = null;
  dragCurrentY = 0;
}

sheetDragEl.addEventListener("pointerup", endDrag);
sheetDragEl.addEventListener("pointercancel", endDrag);

// ---- boot ----

async function init() {
  items = await seedIfEmpty();
  render();
}

init();
