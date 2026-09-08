// Step 4: Add and delete. The + button creates an item with the lowest free
// code (§4) and opens it straight into the detail sheet. "Delete item" soft-
// deletes (sets deletedAt, §12) after a confirm; the recycle bin icon opens
// Recently deleted, where items can be restored or purged. Anything past
// its 30-day window is purged on app start. See §17.
//
// Photo replace/enlarge (§9.1), the status pill's toggle+history write, and
// history editing/"Add entry" (§8, §17 step 6) are still not wired up —
// those controls render but stay inert until their step.
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

// The lowest code not currently in use — including codes held by items in
// Recently deleted, which stay reserved until they're restored or purged
// (§4). Only a fully purged item's code is actually free again.
function nextAvailableCode(currentItems) {
  const used = new Set(currentItems.map((it) => it.code));
  for (let letter = 65; letter <= 90; letter++) {
    for (let digit = 1; digit <= 9; digit++) {
      const code = String.fromCharCode(letter) + digit;
      if (!used.has(code)) return code;
    }
  }
  return null; // all 234 codes taken — not a case the spec expects (§1)
}

// End of the current sort order among active (non-deleted) items, so a new
// or restored item lands at the bottom of the list.
function nextPosition(currentItems) {
  const positions = currentItems.filter((it) => !it.deletedAt).map((it) => it.position);
  return positions.length ? Math.max(...positions) + 1 : 1;
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
  const active = items.filter((item) => !item.deletedAt).sort((a, b) => a.position - b.position);
  rowsEl.innerHTML = "";
  active.forEach((item) => rowsEl.appendChild(renderRow(item)));
  allCountEl.textContent = active.length;
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
const deleteItemEl = document.getElementById("deleteItem");
const addButtonEl = document.getElementById("addButton");
const allCountEl = document.getElementById("allCount");
const recentlyDeletedButtonEl = document.getElementById("recentlyDeletedButton");
const deletedBackdropEl = document.getElementById("deletedBackdrop");
const deletedSheetEl = document.getElementById("deletedSheet");
const deletedListEl = document.getElementById("deletedList");
const deletedDoneEl = document.getElementById("deletedDone");

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
  if (deletedSheetEl.classList.contains("open")) hideDeletedList();
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

  // Deleted-but-not-purged items still reserve their code (§4), so they
  // count as a conflict too, same as nextAvailableCode() treats them.
  const conflict = items.find((it) => it.uid !== item.uid && it.code === value);
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

// ---- delete (§12) ----

deleteItemEl.addEventListener("click", async () => {
  const item = findItem(openUid);
  if (!item) return;

  const label = item.name || "this item";
  const ok = confirm(`Delete "${label}"? It moves to Recently deleted for 30 days.`);
  if (!ok) return;

  item.deletedAt = new Date().toISOString();
  await persist(item);
  closeSheet();
});

// ---- add (§4) ----

addButtonEl.addEventListener("click", async () => {
  const code = nextAvailableCode(items);
  if (!code) return; // all 234 codes taken — see nextAvailableCode()

  const now = new Date();
  const status = "home"; // no default is specified by the spec; a newly
                          // added item is most likely still on hand, not
                          // yet placed in the bank
  const item = {
    uid: crypto.randomUUID(),
    code,
    position: nextPosition(items),
    name: "",
    type: TYPES[6], // "այլ" — the default for a new item (§5)
    note: "",
    status,
    photo1Thumb: null,
    photo1Full: null,
    photo2Thumb: null,
    photo2Full: null,
    history: [{ id: crypto.randomUUID(), to: status, date: now.toISOString().slice(0, 10) }],
    createdAt: now.toISOString(),
    deletedAt: null,
  };

  await DB.putItem(item);
  items.push(item);
  render();
  openSheet(item.uid);
  fieldName.focus();
});

// ---- Recently deleted (§12) ----

function daysLeft(deletedAtIso) {
  const msLeft = new Date(deletedAtIso).getTime() + 30 * 24 * 60 * 60 * 1000 - Date.now();
  return Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
}

function renderDeletedList() {
  const deleted = items
    .filter((item) => item.deletedAt)
    .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));

  deletedListEl.innerHTML = "";

  if (deleted.length === 0) {
    deletedListEl.innerHTML = `<div class="deleted-empty">Nothing here.</div>`;
    return;
  }

  deleted.forEach((item) => {
    const left = daysLeft(item.deletedAt);
    const row = document.createElement("div");
    row.className = "deleted-row";
    row.innerHTML = `
      <div class="deleted-info">
        <div class="deleted-name">${item.name || "(unnamed)"} · ${item.code}</div>
        <div class="deleted-meta">${left} day${left === 1 ? "" : "s"} left</div>
      </div>
      <div class="deleted-actions">
        <button class="deleted-restore" data-action="restore" data-uid="${item.uid}">Restore</button>
        <button class="deleted-purge" data-action="purge" data-uid="${item.uid}">Delete permanently</button>
      </div>
    `;
    deletedListEl.appendChild(row);
  });
}

deletedListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const uid = btn.dataset.uid;
  const item = findItem(uid);
  if (!item) return;

  if (btn.dataset.action === "restore") {
    // Original code, unless something else has taken it in the meantime (§12)
    const codeTaken = items.some((it) => it.uid !== uid && !it.deletedAt && it.code === item.code);
    if (codeTaken) item.code = nextAvailableCode(items.filter((it) => it.uid !== uid));
    item.position = nextPosition(items);
    item.deletedAt = null;
    await persist(item);
    renderDeletedList();
  } else if (btn.dataset.action === "purge") {
    await DB.deleteItem(uid);
    items = items.filter((it) => it.uid !== uid);
    renderDeletedList();
  }
});

function openDeletedList() {
  renderDeletedList();
  deletedBackdropEl.classList.add("open");
  deletedSheetEl.classList.add("open");
  history.pushState({ deletedOpen: true }, "");
}

function hideDeletedList() {
  deletedBackdropEl.classList.remove("open");
  deletedSheetEl.classList.remove("open");
}

function closeDeletedList() {
  if (!deletedSheetEl.classList.contains("open")) return;
  if (history.state && history.state.deletedOpen) {
    history.back();
  } else {
    hideDeletedList();
  }
}

// The recycle bin icon is the only way into Recently deleted.
recentlyDeletedButtonEl.addEventListener("click", openDeletedList);

deletedDoneEl.addEventListener("click", closeDeletedList);
deletedBackdropEl.addEventListener("click", closeDeletedList);

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

// Anything that's been in Recently deleted for more than 30 days is gone
// for good, checked once on every app start (§12).
async function purgeExpired(loadedItems) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const kept = [];
  for (const item of loadedItems) {
    if (item.deletedAt && new Date(item.deletedAt).getTime() < cutoff) {
      await DB.deleteItem(item.uid);
    } else {
      kept.push(item);
    }
  }
  return kept;
}

async function init() {
  const loaded = await seedIfEmpty();
  items = await purgeExpired(loaded);
  render();
}

init();
